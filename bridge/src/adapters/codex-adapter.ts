/**
 * OpenAI Codex CLI adapter (real agent) — v2 `app-server` turn protocol.
 *
 * ## Why app-server (refactor of the old `codex exec --json` adapter)
 *
 * `codex exec` is one-shot and non-interactive: it does not surface tool
 * approvals, so the bridge couldn't actually gate sensitive tools — every
 * sensitive call was either auto-approved (with `-s workspace-write`) or
 * silently denied (with `-s read-only`). The `codex app-server` JSON-RPC
 * protocol is the same one the desktop app uses; it is turn-based and
 * surfaces the approval elicitations the bridge needs:
 *
 *   - `item/commandExecution/requestApproval`  (v2, current codex-cli 0.98+)
 *   - `item/fileChange/requestApproval`        (v2)
 *   - `item/permissions/requestApproval`       (v2)
 *   - `mcpServer/elicitation/request`          (v2 MCP servers)
 *   - `item/tool/requestUserInput`             (v2, EXPERIMENTAL)
 *   - `execCommandApproval`                    (v1, legacy)
 *   - `applyPatchApproval`                     (v1, legacy)
 *
 * All of these are routed to the bridge's existing `requestApproval` flow
 * (the same `approval` content block the Claude `PreToolUse` hook uses), so
 * the phone's approval card just works. See `codex-approval.ts` for the
 * per-kind mapping.
 *
 * ## Process model — the app-server lives for the turn, not for the session
 *
 * A `codex app-server` process is spawned lazily on the first turn, the bridge
 * speaks JSON-RPC over its stdio, and it is **shut down as soon as no turn is
 * in flight**. The next turn spawns a fresh one and re-attaches to the thread
 * with `thread/resume`.
 *
 * That handover is not an optimization, it is the contract: **Codex allows
 * exactly ONE writer per thread, held for as long as the thread is loaded in a
 * process.** A long-lived app-server therefore keeps every thread the phone has
 * ever touched locked, and Codex Desktop / `codex resume` answer
 * `thread <id> already has an active writer` — the phone's conversation cannot
 * be opened there at all. Measured against codex-cli 0.147.0:
 *
 *   - `thread/unsubscribe` replies `{status:'unsubscribed'}` but the thread
 *     STAYS in `thread/loaded/list` and the writer stays held — it does NOT
 *     hand the thread over;
 *   - once the holding process exits, another client's `thread/resume` succeeds
 *     immediately.
 *
 * So ending the process is the handover. It costs ~250ms to respawn plus
 * ~200–750ms to `thread/resume` (measured, the upper end on a 7k-line rollout),
 * paid once per turn against a model call that takes seconds to minutes.
 *
 * Threads still live inside the app-server for the duration of a turn, so
 * streaming, approvals and steering are unchanged. The bridge persists each
 * thread's `nativeSessionId` so both a later turn and a bridge restart resume
 * the same Codex thread instead of starting a new one.
 *
 * Captured app-server JSON-RPC events (one JSON object per line):
 *   { "method":"turn/started", "params":{...} }
 *   { "method":"item/agentMessage/delta", "params":{ delta } }
 *   { "method":"item/reasoning/summaryTextDelta", "params":{ delta } }
 *   { "method":"item/commandExecution/outputDelta", "params":{ delta } }
 *   { "method":"item/completed", "params":{ item:{ type:'commandExecution'|'fileChange'|'agentMessage'|'reasoning'|... } } }
 *   { "method":"turn/completed", "params":{ turn:{ id, items, status, error?, … } } }
 *   { "method":"thread/tokenUsage/updated", "params":{ threadId, turnId,
 *       tokenUsage:{ total:{ totalTokens, inputTokens, cachedInputTokens,
 *       outputTokens, reasoningOutputTokens }, last:{…}, modelContextWindow } } }
 *
 * Server requests that need a reply (handled by the bridge):
 *   { "id":N, "method":"item/commandExecution/requestApproval", "params":{...} }
 *   { "id":N, "method":"item/fileChange/requestApproval", "params":{...} }
 *   { "id":N, "method":"applyPatchApproval", "params":{...} }
 *   { "id":N, "method":"execCommandApproval", "params":{...} }
 *   { "id":N, "method":"item/permissions/requestApproval", "params":{...} }
 *   { "id":N, "method":"mcpServer/elicitation/request", "params":{...} }
 *   { "id":N, "method":"item/tool/requestUserInput", "params":{...} }
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md
 * (validating adapters).
 */
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  ApprovalDecision,
  DesktopTools,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { DESKTOP_CWD_HEADER, DESKTOP_MCP_SERVER_NAME, encodeCwdHeader } from '@uxnan/shared';
import {
  expandCustomCommand,
  scanCustomCommands,
  type CustomCommandSource,
} from './command-scan.js';
import { runGit } from '../git/git-runner.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { defaultSpawn, spawnPiped, type SpawnFn } from './spawn.js';
import {
  buildReplyResult,
  describeServerRequest,
  decisionToReply,
  type ApprovalKind,
  type PendingCodexApproval,
} from './codex-approval.js';
import { CodexAppServerRpc, RpcError } from './codex-app-server.js';
import {
  codexItemStartBlock,
  codexReasoningText,
  codexToolItemBlock,
  type CodexFileChange,
} from './codex-tools.js';
import {
  assistantResponseBoundaryBlock,
  commandBlock,
  compactionBlock,
  extractPlanSteps,
  fileChangeBlock,
  planBlock,
  unifiedDiffBlock,
  unwrapShellCommand,
  withBlockId,
  writeDiffBlock,
} from './content-blocks.js';
import { effortValues, reasoningOption, reasoningValue, withOptions } from './run-options.js';

/**
 * Model used to name a conversation: the cheapest one, never the thread's own.
 * Writing a six-word title is not work for the expensive model, and it must not
 * eat that model's quota. Verified against the account's real `model/list`.
 *
 * `gpt-5.6-luna` ("fast and affordable") beats the `mini` tier on **both**
 * halves of the bill, measured rather than assumed: $0.20/$1.20 per 1M tokens
 * against `gpt-5.4-mini`'s $0.75/$4.50, and naming the same conversation cost
 * 13.4k tokens on Luna against 18.3k on mini — roughly 5× cheaper per title.
 */
const CODEX_TITLE_MODEL = 'gpt-5.6-luna';

/**
 * Reasoning effort for that one-shot. Luna defaults to `medium`, and a title is
 * the least reasoning-hungry task there is — the tokens a thinking tier would
 * spend here are exactly the ones that could make a cheap model cost more than
 * an expensive one. `-c` takes a config override; the key is validated, so a
 * typo fails the run loudly instead of silently naming on the default tier.
 */
const CODEX_TITLE_REASONING = ['-c', 'model_reasoning_effort=low'];

const CODEX_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
  reportsCompaction: true,
  commands: true,
  // The app-server exposes `turn/steer` (see `ClientRequest` in
  // `codex app-server generate-json-schema`, codex-cli 0.146.0): a follow-up
  // with an `expectedTurnId` precondition, folded into the running turn. This
  // is the protocol's own version of the Codex TUI's Enter-to-steer.
  //
  // FOR-DEV: implemented and unit-tested against the published protocol schema,
  // but NOT yet exercised against a live Codex turn — the account's weekly
  // limit was exhausted (0 credits) when this landed. Run the steer probe once
  // credits return and record the result in bridge/docs/testing.md.
  steering: true,
};

/**
 * Headless sandbox + approval posture for the Codex app-server (v2 protocol).
 * Mirrors the bridge's other agent adapters:
 *  - `default`           → reads only; commands/writes denied by the sandbox.
 *  - `acceptEdits`       → workspace writes allowed; no prompts.
 *  - `bypassPermissions` → danger full access; no prompts.
 *  - `interactive`       → workspace writes allowed; the user is asked (this
 *                          is the recommended default for production use).
 */
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'interactive';

/** Internal: the `askForApproval` value passed to `thread/start`. */
type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';

/** Internal: the `sandbox` value passed to `thread/start`. */
type SandboxPolicy = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Mapping of the bridge's {@link CodexPermissionMode} to the app-server
 * `(approvalPolicy, sandbox)` pair sent to `thread/start`. The default
 * switches to `interactive` so the bridge actually receives approvals (the
 * whole point of the app-server refactor) — the previous `acceptEdits`
 * default silently auto-approved everything.
 */
function permissionToPolicies(mode: CodexPermissionMode): {
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxPolicy;
} {
  switch (mode) {
    case 'default':
      return { approvalPolicy: 'untrusted', sandbox: 'read-only' };
    case 'acceptEdits':
      // Back-compat: same effective behavior as the old `codex exec
      // -s workspace-write` adapter (writes allowed, no prompts).
      return { approvalPolicy: 'never', sandbox: 'workspace-write' };
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    case 'interactive':
      // Workspace writes allowed; the bridge forwards every request
      // approval to the phone so the user can decide.
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }
}

/** Hard cap on the app-server handshake before falling back to config.toml. */
const MODEL_LIST_TIMEOUT_MS = 8000;

/** How long a folder's skill list is reused before the app-server is asked again. */
const COMMANDS_TTL_MS = 60_000;

/**
 * Codex's own compaction, run natively (`thread/compact/start`, verified on
 * codex-cli 0.156.1: a turn of its own that carries a `contextCompaction`
 * item).
 */
const CODEX_COMPACT_COMMAND: AgentCommand = {
  name: 'compact',
  description: 'Summarize the conversation to free up context',
  source: 'builtin',
  headlessSupported: true,
};

/** One enabled skill as `skills/list` reports it. */
interface CodexSkill {
  name: string;
  description?: string;
  /** Its `SKILL.md`, which a `skill` input item must name. */
  path: string;
}

/** How a command turn runs natively (see `#nativeCommand`). */
type NativeCommand = { kind: 'compact' } | { kind: 'skill'; skill: CodexSkill; text: string };

/**
 * The enabled skills in a `skills/list` answer (`{ data: [{ cwd, skills }] }`),
 * or `undefined` for an answer of another shape. A skill's short description
 * (its own, or its `interface`'s) is preferred to the full one, which is
 * written for the model and runs long.
 */
export function parseCodexSkills(result: unknown): CodexSkill[] | undefined {
  if (!isRecord(result) || !Array.isArray(result['data'])) return undefined;
  const skills: CodexSkill[] = [];
  const seen = new Set<string>();
  for (const entry of result['data']) {
    if (!isRecord(entry) || !Array.isArray(entry['skills'])) continue;
    for (const skill of entry['skills']) {
      if (!isRecord(skill) || skill['enabled'] === false) continue;
      const name = str(skill['name']);
      const path = str(skill['path']);
      if (!name || !path || seen.has(name)) continue;
      seen.add(name);
      const face = isRecord(skill['interface']) ? skill['interface'] : undefined;
      const description =
        str(skill['shortDescription']) ||
        (face ? str(face['shortDescription']) : '') ||
        str(skill['description']);
      skills.push({ name, path, ...(description ? { description } : {}) });
    }
  }
  return skills;
}

/** Hard cap on the lifecycle of a single approval round-trip (matches Claude hook). */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Reasoning-effort knob for Codex models discovered without an effort list
 * (the `~/.codex/config.toml` fallback path). The app-server `model/list`
 * reports the REAL per-model efforts (see `parseCodexReasoning`); this covers
 * only the config-only fallback. Maps to `-c model_reasoning_effort=<level>`.
 */
const CODEX_FALLBACK_REASONING: AgentModelOption = reasoningOption(
  effortValues(['low', 'medium', 'high', 'xhigh']),
);

export interface CodexAdapterOptions {
  /** Resolved binary entry (found by `locateAgent`, `agents/agent-installs.ts`). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[codex.js]` when running via node). */
  prependArgs?: string[];
  /** Default model when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Sandbox + approval posture (default `interactive`; see {@link CodexPermissionMode}). */
  permissionMode?: CodexPermissionMode;
  /**
   * Callback that surfaces a Codex app-server approval to the bridge so the
   * phone can decide. Returns the user's `ApprovalDecision` (or
   * `'reject'` after the 5-min timeout). Wired by the bridge during adapter
   * registration. Optional in tests.
   */
  onApprovalRequest?: (
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ) => Promise<ApprovalDecision>;
  /**
   * Injected `app-server` spawner (tests). Should return the child's stdin
   * (writable), stdout (readable) and an `onClose` callback the adapter
   * registers with. The default spawns the configured `binaryPath` with
   * `app-server` appended, with stdin/stdout piped.
   */
  spawnAppServer?: () => SpawnedAppServer;
  /** Injected spawn for the one-shot side errands (tests). */
  spawnFn?: SpawnFn;
}

/** Streams + lifecycle surface a `spawnAppServer` implementation returns. */
export interface SpawnedAppServer {
  stdin: Writable;
  stdout: Readable;
  onClose: (cb: (code: number | null) => void) => void;
  kill: () => void;
}

interface ActiveRun {
  /** The bridge's turn id (so `cancelTurn(turnId)` can find the run). */
  bridgeTurnId: string;
  /** The Codex app-server's turn id (used by `turn/interrupt`). */
  codexTurnId: string | null;
  /** Context tokens from `thread/tokenUsage/updated` (NOT on turn/completed). */
  tokens?: number;
  /** Context window the same notification reports for the running model. */
  contextWindow?: number;
  threadId: string;
  /** Text already streamed for each native `agentMessage` item. */
  agentTextByItem: Map<string, string>;
  /** Every assistant item concatenated in production order for completion. */
  allAgentText: string;
  /** Model the turn ran on, for looking up its context window on completion. */
  model?: string;
  /** The last plan emitted this turn, so an unchanged resend is not repeated. */
  lastPlan?: string;
}

/** A normalized Codex event extracted from one app-server notification line. */
export interface CodexEvent {
  kind:
    | 'thread'
    | 'message'
    | 'thinking'
    | 'block'
    | 'file_change'
    | 'completed'
    | 'error'
    | 'other';
  threadId?: string;
  text?: string;
  /** Only set for `completed`: context-occupying token count, if reported. */
  tokens?: number;
  /** Only set for `block`: the structured content block(s) for this item. */
  blocks?: Record<string, unknown>[];
  /** Only set for `file_change`: the changed paths the adapter reads to diff. */
  changes?: CodexFileChange[];
}

/**
 * Context-occupying tokens from a `thread/tokenUsage/updated` payload.
 *
 * `total` is the THREAD's cumulative context — what a context meter shows —
 * while `last` is only the newest turn's slice. `cachedInputTokens` is a subset
 * of `inputTokens` and is never added, so `totalTokens` (Codex's own sum) is
 * taken as-is. Shape captured from a live `codex app-server`.
 */
export function codexUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const total = isRecord(usage['total']) ? usage['total'] : undefined;
  const tokens = numberOr(total?.['totalTokens']);
  return tokens > 0 ? Math.round(tokens) : undefined;
}

/**
 * The default `spawnAppServer` impl: spawns the resolved Codex binary with
 * `app-server` appended, pipes stdin/stdout, returns the streams. Used by
 * production; tests inject a `spawnAppServer` that wires a fake app-server
 * (NDJSON over a PassThrough) so the JSON-RPC client can be exercised.
 */
/**
 * Uxnan Desktop's tools for one Codex thread: a per-thread `config` override on
 * `thread/start` / `thread/resume` registering the desktop's MCP server, with
 * the thread's own folder in `x-uxnan-cwd`. Per thread because one app-server
 * serves every thread (and cwd) with a turn in flight. The token rides in that
 * JSON-RPC message on the app-server's stdin — never argv or a file. Verified
 * against codex-cli 0.156.1: the server connects for that thread only, sends
 * both headers, and neither reaches the rollout, the state DB or the logs.
 */
export function codexDesktopConfig(
  desktop: DesktopTools | undefined,
  cwd: string,
): { config?: Record<string, unknown> } {
  if (!desktop) return {};
  return {
    config: {
      [`mcp_servers.${DESKTOP_MCP_SERVER_NAME}`]: {
        url: desktop.mcpUrl,
        http_headers: {
          Authorization: `Bearer ${desktop.token}`,
          [DESKTOP_CWD_HEADER]: encodeCwdHeader(cwd),
        },
      },
    },
  };
}

function defaultSpawnAppServer(binaryPath: string, prependArgs: string[]): () => SpawnedAppServer {
  return () => {
    const child = spawnPiped(binaryPath, [...prependArgs, 'app-server']);
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      onClose: (cb: (code: number | null) => void) => {
        child.on('close', cb);
      },
      kill: () => {
        child.kill();
      },
    };
  };
}

export class CodexAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'codex';
  readonly capabilities = CODEX_CAPABILITIES;

  /**
   * One-shot spawner, used only for side errands that must NOT touch the
   * app-server thread a conversation runs on (today: naming it).
   */
  readonly #spawnOneShot: SpawnFn;
  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: CodexPermissionMode;
  readonly #onApprovalRequest: CodexAdapterOptions['onApprovalRequest'];
  readonly #spawnAppServer: () => SpawnedAppServer;
  /** threadId (bridge) → Codex app-server threadId, for `thread/resume` continuity. */
  readonly #threadByBridgeThread = new Map<string, string>();
  /**
   * Codex thread ids loaded in the CURRENT app-server process (i.e. whose
   * writer this bridge holds right now). Cleared whenever the process goes
   * away, because the next process starts with nothing loaded and every thread
   * has to be re-attached with `thread/resume`.
   */
  readonly #loadedThreads = new Set<string>();
  /** turnId (bridge) → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** model id → context-window tokens, from `~/.codex/models_cache.json`. */
  readonly #contextWindowByModel = new Map<string, number>();
  #windowsLoaded = false;
  #defaultCwd = process.cwd();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }
  /** Per-turn app-server connection. Spawned lazily, released when idle. */
  #rpc: CodexAppServerRpc | null = null;
  /** The skills the app-server listed per folder, briefly reused. */
  readonly #skillsByCwd = new Map<string, { at: number; skills: CodexSkill[] }>();
  #appServerInit: Promise<CodexAppServerRpc> | null = null;
  /** The live process handle, kept so the idle release can end it. */
  #appServerStreams: SpawnedAppServer | null = null;
  /** Pending approvals keyed by the bridge's `approvalId`; the server request id
   * is captured so the reply is shaped with the right `ReviewDecision` kind. */
  #pendingApprovals = new Map<string, { kind: ApprovalKind; serverRequestId: number | string }>();
  #approvalSeq = 0;

  /** Native Codex thread id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#threadByBridgeThread.get(threadId);
  }

  /**
   * Re-attach a thread to the Codex thread the bridge recorded for it before
   * this process existed (i.e. after a bridge restart). Without it the map is
   * empty and the next turn would open a NEW Codex thread — the phone would
   * still show the history, read off the rollout, while Codex had lost it.
   *
   * Called by the AgentManager just before a turn; the first `sendTurn` then
   * takes the ordinary `thread/resume` path. Never overwrites a live mapping.
   */
  adoptNativeSession(threadId: string, sessionId: string): void {
    if (!sessionId || this.#threadByBridgeThread.has(threadId)) return;
    this.#threadByBridgeThread.set(threadId, sessionId);
  }

  /**
   * Mirror the conversation's name onto the Codex thread, so the phone's
   * conversation is recognizable in Codex Desktop / `codex resume` instead of
   * showing up untitled (a thread the bridge starts comes back with
   * `name: null`, and Codex names its own threads client-side).
   *
   * `thread/name/set` does NOT need the thread loaded — verified against
   * codex-cli 0.147.0 from a process that never resumed it; the name lands in
   * `~/.codex/session_index.jsonl`, which is what those clients list. Called by
   * the AgentManager right after it names a thread, and best-effort: a failure
   * leaves the Codex-side name alone and never touches the conversation.
   */
  async setNativeTitle(threadId: string, title: string): Promise<void> {
    const codexThreadId = this.#threadByBridgeThread.get(threadId);
    if (!codexThreadId || !title) return;
    try {
      const rpc = await this.#ensureAppServer();
      await rpc.request('thread/name/set', { threadId: codexThreadId, name: title });
    } catch {
      /* best-effort: the conversation keeps its uxnan name either way */
    } finally {
      // Naming runs between turns, so this hands the thread straight back.
      this.#releaseAppServerIfIdle();
    }
  }

  constructor(options: CodexAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'codex';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'interactive';
    this.#onApprovalRequest = options.onApprovalRequest;
    this.#spawnAppServer =
      options.spawnAppServer ?? defaultSpawnAppServer(this.#binaryPath, this.#prependArgs);
    this.#spawnOneShot = options.spawnFn ?? defaultSpawn;
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  /**
   * Resolve the Codex permission posture for a turn: the thread's `accessMode`
   * (from the phone) wins when set, else the configured `permissionMode`.
   *  - `requestApproval` → `interactive` (the app-server forwards each approval
   *    elicitation to the phone);
   *  - `approveForMe`    → `acceptEdits` (workspace writes, no prompts);
   *  - `fullAccess`      → `bypassPermissions` (danger-full-access, no prompts).
   * Absent → the configured posture (no behaviour change).
   *
   * The resulting `(approvalPolicy, sandbox)` is sent on `thread/start` AND on
   * every `thread/resume`, and each turn re-attaches to its thread, so changing
   * the access mode mid-conversation takes effect on the very next turn.
   * Verified live against codex-cli 0.147.0: resuming with
   * `on-request`/`workspace-write` a thread created `never`/`read-only` wrote the
   * new pair into the rollout's `turn_context` for that turn.
   */
  #effectiveMode(accessMode: SendTurnOptions['accessMode']): CodexPermissionMode {
    switch (accessMode) {
      case 'approveForMe':
        return 'acceptEdits';
      case 'fullAccess':
        return 'bypassPermissions';
      case 'requestApproval':
        return 'interactive';
      default:
        return this.#permissionMode;
    }
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const run of this.#active.values()) {
      try {
        await this.#interruptTurn(run);
      } catch {
        /* best-effort */
      }
    }
    this.#active.clear();
    this.#closeAppServer();
  }

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const effort = reasoningValue(options);
    // The thread's persisted access mode (chosen on the phone) overrides the
    // configured posture. It is applied on `thread/start` AND on every
    // `thread/resume`, so a mid-conversation change takes effect on the next
    // turn (each turn re-attaches to the thread; see `#effectiveMode`).
    const { approvalPolicy, sandbox } = permissionToPolicies(
      this.#effectiveMode(options.accessMode),
    );

    // Spawn or reuse the app-server. We await the initialization so a slow
    // first turn surfaces a clear error rather than racing the `turn/start`.
    let rpc: CodexAppServerRpc;
    try {
      rpc = await this.#ensureAppServer();
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to start codex app-server: ${errorMessage(err)}` },
      });
      return;
    }

    // Resolve the Codex thread id. A known thread is re-attached with
    // `thread/resume` because the previous turn released the app-server (and
    // with it every loaded thread) so Codex Desktop / the CLI could open the
    // conversation in between.
    let codexThreadId = this.#threadByBridgeThread.get(threadId);
    if (codexThreadId && !this.#loadedThreads.has(codexThreadId)) {
      try {
        await rpc.request('thread/resume', {
          threadId: codexThreadId,
          cwd,
          approvalPolicy,
          sandbox,
          ...(typeof model === 'string' ? { model } : {}),
          ...codexDesktopConfig(options.desktopTools, cwd),
        });
        this.#loadedThreads.add(codexThreadId);
      } catch (err) {
        if (isThreadHeldElsewhere(err)) {
          // Another Codex client (the app, `codex resume`, an IDE) is holding
          // the thread. Codex allows one writer, so there is nothing to fall
          // back to — say who has it instead of failing with protocol prose.
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: {
              text:
                'This conversation is currently open in another Codex client ' +
                '(the Codex app, an IDE or `codex resume`). Close it there, then send the message again.',
            },
          });
          this.#releaseAppServerIfIdle();
          return;
        }
        // The rollout is gone (deleted/archived from another client) — the
        // conversation continues in a fresh Codex thread rather than dead-ending.
        this.#threadByBridgeThread.delete(threadId);
        this.#loadedThreads.delete(codexThreadId);
        codexThreadId = undefined;
      }
    }
    if (!codexThreadId) {
      try {
        const started = await rpc.request<{ thread: { id: string; sessionId?: string } }>(
          'thread/start',
          {
            model,
            cwd,
            approvalPolicy,
            sandbox,
            // A person typed this on their phone, so the thread is classified
            // like any other human-started one (the app-server otherwise leaves
            // `thread_source` unset, which no first-party client does).
            threadSource: 'user',
            ...(typeof effort === 'string' ? { effort } : {}),
            ...codexDesktopConfig(options.desktopTools, cwd),
          },
        );
        codexThreadId = started.thread.id;
        this.#threadByBridgeThread.set(threadId, codexThreadId);
        this.#loadedThreads.add(codexThreadId);
      } catch (err) {
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `codex thread/start failed: ${errorMessage(err)}` },
        });
        this.#releaseAppServerIfIdle();
        return;
      }
    }

    // Persist the native session id early so the on-disk history fallback
    // works after a crash mid-turn.
    this.#active.set(turnId, {
      bridgeTurnId: turnId,
      codexTurnId: null,
      threadId,
      agentTextByItem: new Map(),
      allAgentText: '',
      ...(typeof model === 'string' ? { model } : {}),
    });
    // Warm the per-model context-window cache (once) so completion can emit a
    // window → a percentage on the phone.
    void this.#loadContextWindows();
    this.emit({ type: 'turn_started', threadId, turnId });

    try {
      // A plain turn goes out at once; only a command turn looks up how it runs.
      const native = options.command ? await this.#nativeCommand(options, cwd, rpc) : undefined;
      if (native?.kind === 'compact') {
        // Its own turn on the app-server (`turn/started` → a
        // `contextCompaction` item → `turn/completed`), picked up by the
        // notification handlers like any other; its id comes on `turn/started`.
        await rpc.request('thread/compact/start', { threadId: codexThreadId });
        return;
      }
      const response = await rpc.request<{ turn: { id: string } }>('turn/start', {
        threadId: codexThreadId,
        input:
          native?.kind === 'skill'
            ? [
                { type: 'text', text: native.text },
                { type: 'skill', name: native.skill.name, path: native.skill.path },
              ]
            : [{ type: 'text', text }],
        ...(typeof model === 'string' ? { model } : {}),
        ...(typeof effort === 'string' ? { effort } : {}),
      });
      const run = this.#active.get(turnId);
      if (run) run.codexTurnId = response.turn.id;
    } catch (err) {
      this.#active.delete(turnId);
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `codex turn/start failed: ${errorMessage(err)}` },
      });
      this.#releaseAppServerIfIdle();
    }
  }

  /**
   * Name a conversation with a one-shot `codex exec`, deliberately NOT the
   * app-server thread a turn runs on — this errand must leave no trace in the
   * conversation.
   *
   * Three flags carry that guarantee, all verified against codex-cli 0.146.0:
   * `--ephemeral` writes no session file, `-s read-only` denies the sandbox any
   * write, and `-o <file>` yields the final message **alone**. That last one
   * matters: `codex exec` prints a banner, hook lines and a token count to
   * stdout, so parsing stdout would be guesswork — the file is exactly the
   * title and nothing else.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const outFile = join(tmpdir(), `uxnan-title-${randomUUID()}.txt`);
    const args = [
      'exec',
      '--ephemeral',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '-m',
      CODEX_TITLE_MODEL,
      ...CODEX_TITLE_REASONING,
      '-o',
      outFile,
      prompt,
    ];
    try {
      const ran = await runTitleOneShot(() =>
        this.#spawnOneShot(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
      );
      if (ran === undefined) return undefined;
      const raw = await readFile(outFile, 'utf8');
      return sanitizeTitle(raw);
    } catch {
      return undefined;
    } finally {
      await rm(outFile, { force: true }).catch(() => undefined);
    }
  }

  async cancelTurn(_threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (!run) return;
    await this.#interruptTurn(run);
  }

  /**
   * Hand a follow-up to the turn `activeTurnId` is already running, via the
   * app-server's own `turn/steer`. Codex takes it at the next boundary and
   * answers inside the same turn — this is the protocol's native equivalent of
   * pressing Enter (rather than Tab) on a follow-up in the Codex TUI.
   *
   * `expectedTurnId` is a precondition the app-server enforces: it rejects the
   * request when that turn is no longer the active one, which is exactly the
   * race we would otherwise have to guess at. A rejection is reported as "not
   * taken" so the bridge simply leaves the message queued.
   */
  async steerTurn(options: SendTurnOptions & { activeTurnId: string }): Promise<boolean> {
    const run = this.#active.get(options.activeTurnId);
    if (!run || run.threadId !== options.threadId) return false;
    // No app-server turn id yet means `turn/start` has not come back: there is
    // no turn to steer, and `expectedTurnId` would have nothing to match.
    if (!run.codexTurnId || !this.#rpc) return false;
    const codexThreadId = this.#threadByBridgeThread.get(run.threadId);
    if (!codexThreadId) return false;

    try {
      await this.#rpc.request('turn/steer', {
        threadId: codexThreadId,
        expectedTurnId: run.codexTurnId,
        input: [{ type: 'text', text: options.text }],
      });
      return true;
    } catch {
      // Includes the ordinary "that turn is no longer active" precondition
      // failure. Nothing is lost: the message stays queued and runs next.
      return false;
    }
  }

  async #interruptTurn(run: ActiveRun): Promise<void> {
    this.#active.delete(run.bridgeTurnId);
    if (!this.#rpc) return;
    if (!run.codexTurnId) {
      // Turn never produced an id; the app-server hasn't seen it yet. We
      // can't interrupt what doesn't exist — emit the abort now so the
      // phone doesn't keep waiting.
      this.emit({ type: 'turn_aborted', threadId: run.threadId, turnId: run.bridgeTurnId });
      return;
    }
    const codexThreadId = this.#threadByBridgeThread.get(run.threadId);
    try {
      await this.#rpc.request('turn/interrupt', {
        threadId: codexThreadId,
        turnId: run.codexTurnId,
      });
    } catch {
      /* process may have died — the close handler will surface it */
    }
    this.emit({ type: 'turn_aborted', threadId: run.threadId, turnId: run.bridgeTurnId });
    this.#releaseAppServerIfIdle();
  }

  /** Lazy app-server lifecycle: spawn → initialize → return the RPC client. */
  #ensureAppServer(): Promise<CodexAppServerRpc> {
    if (this.#appServerInit) return this.#appServerInit;
    this.#appServerInit = (async () => {
      const streams = this.#spawnAppServer();
      const rpc = new CodexAppServerRpc(
        {
          stdin: streams.stdin,
          stdout: streams.stdout,
          onClose: () => this.#handleAppServerClose(),
        },
        {
          onNotification: (method, params) => this.#onNotification(method, params),
          onServerRequest: (method, params) => this.#onServerRequest(method, params),
        },
      );
      streams.onClose((code) => {
        rpc.onProcessClose(code);
      });
      try {
        await rpc.request('initialize', {
          clientInfo: { name: 'uxnan-bridge', title: null, version: '1.0.0' },
        });
      } catch (err) {
        rpc.close();
        streams.kill();
        throw err;
      }
      this.#rpc = rpc;
      this.#appServerStreams = streams;
      return rpc;
    })().catch((err) => {
      this.#appServerInit = null;
      this.#appServerStreams = null;
      throw err;
    });
    return this.#appServerInit;
  }

  /**
   * End the app-server as soon as no turn is running, handing every thread it
   * holds back to Codex's other clients (see the *Process model* note at the
   * top of this file: the writer is released by the process ending, and by
   * nothing else). A no-op while a turn — or an approval inside one — is still
   * in flight.
   */
  #releaseAppServerIfIdle(): void {
    if (this.#active.size > 0 || this.#pendingApprovals.size > 0) return;
    this.#closeAppServer();
  }

  /** Tear down the app-server connection + process and forget its loaded threads. */
  #closeAppServer(): void {
    const streams = this.#appServerStreams;
    this.#appServerStreams = null;
    this.#loadedThreads.clear();
    if (this.#rpc) {
      this.#rpc.close();
      this.#rpc = null;
    }
    this.#appServerInit = null;
    try {
      streams?.kill();
    } catch {
      /* already gone */
    }
  }

  /** Handle an unexpected app-server exit: drop state, fail in-flight turns. */
  #handleAppServerClose(): void {
    this.#rpc = null;
    this.#appServerInit = null;
    this.#appServerStreams = null;
    this.#loadedThreads.clear();
    for (const run of this.#active.values()) {
      this.emit({
        type: 'turn_error',
        threadId: run.threadId,
        turnId: run.bridgeTurnId,
        data: { text: 'codex app-server process exited unexpectedly' },
      });
    }
    this.#active.clear();
    for (const approvalId of [...this.#pendingApprovals.keys()]) {
      // Drop local state; the bridge's 5-min timer covers the round-trip.
      this.#pendingApprovals.delete(approvalId);
    }
  }

  /**
   * Map one app-server notification to zero or more bridge events. Runs in
   * the context of the JSON-RPC client's stdout reader.
   */
  async #onNotification(method: string, params: unknown): Promise<void> {
    const p = isRecord(params) ? params : {};
    switch (method) {
      case 'thread/tokenUsage/updated': {
        // Usage does NOT ride on `turn/completed` — verified against a live
        // `codex app-server`, whose completed turn carries only
        // `{ id, items, itemsView, status, error, startedAt, completedAt,
        // durationMs }`. It arrives here instead, which is why Codex showed no
        // context at all: the adapter was reading a field that never exists.
        const usage = isRecord(p['tokenUsage']) ? p['tokenUsage'] : undefined;
        const turnId = str(p['turnId']);
        const run = [...this.#active.values()].find((r) => r.codexTurnId === turnId);
        if (!usage || !run) return;
        const tokens = codexUsageTokens(usage);
        if (tokens !== undefined) run.tokens = tokens;
        const window = numberOr(usage['modelContextWindow']);
        if (window > 0) run.contextWindow = Math.round(window);
        return;
      }
      case 'turn/started': {
        // The bridge already emitted `turn_started` when the turn was sent;
        // this only supplies the app-server's turn id where no `turn/start`
        // response did — a compaction (`thread/compact/start`) answers `{}`.
        const turn = isRecord(p['turn']) ? p['turn'] : undefined;
        const id = turn ? str(turn['id']) : undefined;
        const run = this.#activeRun();
        if (run && run.codexTurnId === null && id) run.codexTurnId = id;
        return;
      }
      case 'item/agentMessage/delta': {
        const delta = typeof p['delta'] === 'string' ? p['delta'] : '';
        if (delta) this.#emitDelta(p, delta);
        return;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const delta = typeof p['delta'] === 'string' ? p['delta'] : '';
        if (delta) this.#emitThinking(p, delta);
        return;
      }
      case 'item/commandExecution/outputDelta':
        // Streaming command output is folded into the `command_execution`
        // block we emit on `item/completed`; skip per-chunk updates to avoid
        // spamming the phone with intermediate state.
        return;
      case 'item/started': {
        // A step is shown as it starts; `item/completed` replaces it in place.
        const item = isRecord(p['item']) ? p['item'] : undefined;
        const run = this.#activeRun();
        const started = item ? codexItemStartBlock(item) : null;
        if (run && started) {
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { content: started },
          });
        }
        return;
      }
      case 'item/completed': {
        const item = isRecord(p['item']) ? p['item'] : undefined;
        if (item) await this.#onItemCompleted(item);
        return;
      }
      case 'turn/completed': {
        const turn = isRecord(p['turn']) ? p['turn'] : undefined;
        if (turn) await this.#onTurnCompleted(turn);
        return;
      }
      case 'turn/plan/updated': {
        // The turn's to-do list, sent whole on every change. Clients show the
        // latest plan of a turn, so an unchanged resend is not repeated.
        const run = this.#activeRun();
        const steps = extractPlanSteps(Array.isArray(p['plan']) ? p['plan'] : []);
        if (!run || steps.length === 0) return;
        const content = planBlock(steps, str(p['explanation']));
        const key = JSON.stringify(content);
        if (run.lastPlan === key) return;
        run.lastPlan = key;
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.bridgeTurnId,
          data: { content },
        });
        return;
      }
      case 'turn/diff/updated':
        // The unified diff the app-server has accumulated so far. We could
        // surface this as a `turn/diff` block but it duplicates the
        // `fileChange` items; the phone already gets structured diffs from
        // those. Ignore.
        return;
      case 'error': {
        // The app-server also reports a dropped stream it is about to retry
        // (`willRetry: true`, "Reconnecting... 2/5") — the turn carries on, so
        // ending it there cut working turns short (measured 2026-09-25). Only
        // an error it will not retry ends the turn (e.g. context overflow).
        if (p['willRetry'] === true) return;
        const error = isRecord(p['error']) ? p['error'] : {};
        const message =
          str(error['message']) ||
          (typeof p['message'] === 'string' ? p['message'] : '') ||
          'codex app-server error';
        const run = this.#currentRun();
        this.#emitTurnErrorForActive(message);
        // The bridge ends the turn on this event, so the adapter must too:
        // a run left "in flight" here would hold the app-server — and with it
        // the thread's single writer — until some later turn released it.
        if (run) this.#active.delete(run.turnId);
        this.#releaseAppServerIfIdle();
        return;
      }
      default:
        // Unknown notifications are tolerated (the protocol is large and
        // version-dependent); we just don't react.
        return;
    }
  }

  /** Handle an item completion: route to the right bridge event. */
  async #onItemCompleted(item: Record<string, unknown>): Promise<void> {
    const run = this.#activeRun();
    if (!run) return;
    const itype = item['type'];
    switch (itype) {
      case 'agentMessage': {
        // Codex can produce several distinct assistant messages in one turn
        // (commentary/progress followed by `final_answer`). Reconcile each
        // item's assembled text against its own deltas, then persist a durable
        // boundary. The terminal turn event must never replace the accumulated
        // prose with only the last item.
        const text = typeof item['text'] === 'string' ? (item['text'] as string) : '';
        const itemId = typeof item['id'] === 'string' ? (item['id'] as string) : '';
        const key = itemId || '__unidentified_agent_message__';
        const streamed = run.agentTextByItem.get(key) ?? '';
        const unseen = unseenCompleteText(streamed, text);
        if (unseen) this.#emitAgentDelta(run, key, unseen);
        if (text.length > 0 || streamed.length > 0) {
          const rawPhase = item['phase'];
          const phase =
            rawPhase === 'commentary' || rawPhase === 'final_answer' ? rawPhase : 'unknown';
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { content: assistantResponseBoundaryBlock(phase, itemId || undefined) },
          });
        }
        run.agentTextByItem.delete(key);
        return;
      }
      case 'reasoning': {
        // Some Codex versions emit the full reasoning body as a `text` field
        // (others only via deltas). Surface anything we haven't already
        // streamed.
        const text = codexReasoningText(item);
        if (text)
          this.emit({
            type: 'thinking',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { text },
          });
        return;
      }
      case 'commandExecution': {
        const exit = item['exitCode'];
        const isError = item['status'] === 'failed' || (typeof exit === 'number' && exit !== 0);
        const output =
          typeof item['aggregatedOutput'] === 'string' ? (item['aggregatedOutput'] as string) : '';
        const command = typeof item['command'] === 'string' ? (item['command'] as string) : '';
        if (command) {
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            // Codex runs every command through the login shell
            // (`/bin/zsh -lc '…'`); the row shows what ran.
            data: {
              content: withBlockId(
                commandBlock(unwrapShellCommand(command), output, isError),
                str(item['id']),
              ),
            },
          });
        }
        return;
      }
      case 'fileChange': {
        const changes = Array.isArray(item['changes'])
          ? (item['changes'] as Record<string, unknown>[]).map((c) => ({
              path: typeof c['path'] === 'string' ? (c['path'] as string) : '',
              // `{ type: 'add' | 'delete' | 'update' }` (a bare string on older builds).
              kind: isRecord(c['kind']) ? str(c['kind']['type']) : str(c['kind']),
              diff: typeof c['diff'] === 'string' ? (c['diff'] as string) : '',
            }))
          : [];
        for (const change of changes) {
          const name = isAbsolutePath(change.path)
            ? relative(this.#defaultCwd, change.path) || change.path
            : change.path;
          // The app-server attaches the change: a unified diff for an update,
          // the new file's content for an add. Without it, ask git, then read
          // the file.
          let content: Record<string, unknown> | undefined;
          if (change.kind === 'add' && change.diff.length > 0) {
            content = writeDiffBlock(name, change.diff);
          } else if (change.kind !== 'delete' && change.diff && change.diff.length > 0) {
            content = unifiedDiffBlock(name, change.diff);
          } else if (change.kind !== 'delete') {
            try {
              const { stdout } = await runGit(this.#defaultCwd, [
                'diff',
                'HEAD',
                '--',
                change.path,
              ]);
              if (stdout.trim().length > 0) content = unifiedDiffBlock(name, stdout);
            } catch {
              /* not a git repo / no HEAD */
            }
            if (!content) {
              try {
                content = writeDiffBlock(name, await readFile(change.path, 'utf-8'));
              } catch {
                /* unreadable */
              }
            }
          }
          content ??= fileChangeBlock(name);
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { content },
          });
        }
        return;
      }
      case 'mcpToolCall':
      case 'dynamicToolCall':
      case 'webSearch':
      case 'imageView':
      case 'collabAgentToolCall': {
        const settled = codexToolItemBlock(item);
        if (settled) {
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { content: withBlockId(settled, str(item['id'])) },
          });
        }
        return;
      }
      case 'plan':
      case 'userMessage':
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        // The plan's steps arrive as `turn/plan/updated`; the rest is text
        // the conversation already shows.
        return;
      case 'contextCompaction':
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.bridgeTurnId,
          data: { content: compactionBlock() },
        });
        return;
      default:
        return;
    }
  }

  /** Finalize a turn once the app-server's `turn/completed` arrives. */
  async #onTurnCompleted(turn: Record<string, unknown>): Promise<void> {
    const run = this.#activeRun();
    if (!run) return;
    const status = typeof turn['status'] === 'string' ? (turn['status'] as string) : 'completed';
    const error = isRecord(turn['error']) ? turn['error'] : undefined;
    this.#active.delete(run.bridgeTurnId);
    if (status === 'failed' || error) {
      const message =
        error && typeof error['message'] === 'string'
          ? (error['message'] as string)
          : 'codex turn failed';
      this.emit({
        type: 'turn_error',
        threadId: run.threadId,
        turnId: run.bridgeTurnId,
        data: { text: message },
      });
      this.#releaseAppServerIfIdle();
      return;
    }
    // Populated by `thread/tokenUsage/updated` during the turn. The model-cache
    // window stays as the fallback for a build that reports no window.
    const tokens = run.tokens;
    const contextWindow =
      run.contextWindow ??
      (run.model !== undefined ? this.#contextWindowByModel.get(run.model) : undefined);
    this.emit({
      type: 'turn_completed',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: {
        text: run.allAgentText,
        ...(tokens !== undefined
          ? { usage: { tokens, ...(contextWindow !== undefined ? { contextWindow } : {}) } }
          : {}),
      },
    });
    // The turn is over: give the thread back, so the same conversation opens in
    // Codex Desktop / `codex resume` while the phone is idle.
    this.#releaseAppServerIfIdle();
  }

  /**
   * Return the current in-flight run (mutable reference) so item-completed
   * handlers can accumulate per-run state directly on
   * the stored object. Returns `null` when no turn is active.
   */
  #activeRun(): ActiveRun | null {
    for (const run of this.#active.values()) return run;
    return null;
  }

  /** Helper: locate the current in-flight run keyed by bridge turnId. */
  #currentRun(): { turnId: string; threadId: string; cwd: string } | null {
    for (const run of this.#active.values()) {
      // There should be exactly one in-flight run for a single adapter; the
      // bridge serializes turns per thread, so this picks the first one.
      return {
        turnId: run.bridgeTurnId,
        threadId: run.threadId,
        cwd: this.#defaultCwd,
      };
    }
    return null;
  }

  #emitDelta(p: Record<string, unknown>, delta: string): void {
    const run = this.#activeRun();
    if (!run) return;
    const itemId = typeof p['itemId'] === 'string' ? (p['itemId'] as string) : '';
    this.#emitAgentDelta(run, itemId || '__unidentified_agent_message__', delta);
  }

  #emitAgentDelta(run: ActiveRun, itemKey: string, delta: string): void {
    run.agentTextByItem.set(itemKey, (run.agentTextByItem.get(itemKey) ?? '') + delta);
    run.allAgentText += delta;
    this.emit({
      type: 'delta',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: { text: delta },
    });
  }

  #emitThinking(_p: Record<string, unknown>, delta: string): void {
    const run = this.#currentRun();
    if (!run) return;
    this.emit({
      type: 'thinking',
      threadId: run.threadId,
      turnId: run.turnId,
      data: { text: delta },
    });
  }

  #emitTurnErrorForActive(message: string): void {
    const run = this.#currentRun();
    if (!run) return;
    this.emit({
      type: 'turn_error',
      threadId: run.threadId,
      turnId: run.turnId,
      data: { text: message },
    });
  }

  /**
   * Handle a server-initiated request. Approval-shaped requests (see
   * {@link describeServerRequest}) are routed to the bridge's approval
   * round-trip; the rest are auto-rejected with a clear error so the
   * app-server doesn't hang.
   */
  async #onServerRequest(method: string, params: unknown): Promise<unknown> {
    const approval = describeServerRequest(method, params, -1);
    if (!approval) {
      // Unknown / unsupported elicitation: auto-reject so the app-server
      // doesn't block waiting on a response we'd never send.
      throw new RpcError(-32000, `codex: unhandled server request '${method}' (auto-rejected)`);
    }
    return this.#routeApproval(approval);
  }

  /** Run a Codex approval through the bridge's approval round-trip. */
  async #routeApproval(
    draft: Omit<PendingCodexApproval, 'serverRequestId'> & { serverRequestId: number | string },
  ): Promise<unknown> {
    if (!this.#onApprovalRequest) {
      // No bridge callback wired (unit test, or a caller that didn't pass
      // `onApprovalRequest`): default to denying to fail safe.
      return buildReplyResult(draft.kind, decisionToReply('reject'));
    }
    const run = this.#currentRun();
    if (!run) {
      return buildReplyResult(draft.kind, decisionToReply('reject'));
    }
    const approvalId = `codex-${run.turnId}-${(this.#approvalSeq += 1)}`;
    this.#pendingApprovals.set(approvalId, {
      kind: draft.kind,
      serverRequestId: draft.serverRequestId,
    });
    try {
      const decision = await Promise.race([
        this.#onApprovalRequest(run.threadId, draft.descriptor),
        new Promise<ApprovalDecision>((resolve) =>
          setTimeout(() => resolve('reject'), APPROVAL_TIMEOUT_MS),
        ),
      ]);
      return buildReplyResult(draft.kind, decisionToReply(decision));
    } finally {
      this.#pendingApprovals.delete(approvalId);
    }
  }

  /**
   * List the models the account can use, account-aware (free vs paid changes
   * the set). The app-server has no enumerate command in a turn session, so we
   * drive a short-lived `codex app-server` process just to run the
   * `initialize` → `model/list` JSON-RPC handshake (the desktop app's source).
   * Falls back to `~/.codex/config.toml` (`model` + the
   * `[tui.model_availability_nux]` table) if the app-server is unavailable.
   *
   * The short-lived process is independent of the long-lived one used for
   * turns (so model listing always works even if a turn crashed the main
   * process).
   */
  listModels(): Promise<AgentModel[]> {
    // parseCodexModelList already attaches each model's REAL per-model
    // reasoning efforts; the config fallback gets a generic effort knob.
    return this.#withShortLivedAppServer(
      async (rpc) =>
        parseCodexModelList((await rpc.request<{ data: unknown }>('model/list', {})).data),
      [] as AgentModel[],
    ).then((models) => (models.length > 0 ? models : this.#modelsFromConfig()));
  }

  /**
   * Run [ask] against a short-lived app-server of its own — independent of the
   * long-lived one turns use, so a discovery call never holds a thread's
   * single writer and still works if a turn crashed that process. Resolves
   * [fallback] if it cannot start, answer or finish within
   * {@link MODEL_LIST_TIMEOUT_MS}.
   */
  #withShortLivedAppServer<T>(
    ask: (rpc: CodexAppServerRpc) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let streams: SpawnedAppServer | undefined;
      const finish = (value: T): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          streams?.kill();
        } catch {
          /* already gone */
        }
        resolve(value);
      };
      try {
        streams = this.#spawnAppServer();
      } catch {
        resolve(fallback);
        return;
      }
      const rpc = new CodexAppServerRpc(
        { stdin: streams.stdin, stdout: streams.stdout },
        { onNotification: () => undefined, onServerRequest: () => null },
        { requestTimeoutMs: MODEL_LIST_TIMEOUT_MS },
      );
      streams.onClose(() => rpc.onProcessClose(0));
      timer = setTimeout(() => finish(fallback), MODEL_LIST_TIMEOUT_MS);
      rpc
        .request('initialize', {
          clientInfo: { name: 'uxnan-bridge', title: null, version: '1.0.0' },
        })
        .then(() => ask(rpc))
        .then(finish, () => finish(fallback));
    });
  }

  /**
   * Codex's custom prompts live user-level under `~/.codex/prompts/*.md`
   * (Codex supports no project scope). The app-server has no RPC for them, so
   * the bridge expands them itself ({@link expandCommand}).
   */
  #commandSource(): CustomCommandSource {
    return { dirs: [join(homedir(), '.codex', 'prompts')], ext: '.md', format: 'markdown' };
  }

  /**
   * The commands Codex has in [cwd]: a native `compact`
   * (`thread/compact/start`), its skills as the app-server lists them there
   * (`skills/list` — repository, user and system skills, enabled only), and
   * the user's custom prompts. A custom prompt keeps its name over a skill of
   * the same name, here and when it runs. Verified on codex-cli 0.156.1.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const [skills, prompts] = await Promise.all([
      this.#skills(dir),
      scanCustomCommands(this.#commandSource()),
    ]);
    const taken = new Set<string>([CODEX_COMPACT_COMMAND.name, ...prompts.map((c) => c.name)]);
    return [
      CODEX_COMPACT_COMMAND,
      ...skills
        .filter((skill) => !taken.has(skill.name))
        .map(
          (skill): AgentCommand => ({
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
            source: 'skill',
            headlessSupported: true,
          }),
        ),
      ...prompts.filter((c) => c.name !== CODEX_COMPACT_COMMAND.name),
    ];
  }

  /**
   * A custom prompt expands to its text. Anything else — `compact`, a skill —
   * runs natively ({@link sendTurn} reads `options.command`), so it resolves
   * to its own `/name args` form, which is what history shows.
   */
  async expandCommand(name: string, args?: string): Promise<string> {
    const source = this.#commandSource();
    if ((await scanCustomCommands(source)).some((c) => c.name === name)) {
      return expandCustomCommand(source, name, args);
    }
    return args ? `/${name} ${args}` : `/${name}`;
  }

  /**
   * How a turn carrying a command runs natively: a compaction, a skill (with
   * the text that goes with it), or `undefined` for a plain text turn — a
   * custom prompt, already expanded into the text, among them.
   */
  async #nativeCommand(
    options: SendTurnOptions,
    cwd: string,
    rpc: CodexAppServerRpc,
  ): Promise<NativeCommand | undefined> {
    const command = options.command;
    if (!command) return undefined;
    if (command.name === CODEX_COMPACT_COMMAND.name) return { kind: 'compact' };
    const prompts = await scanCustomCommands(this.#commandSource());
    if (prompts.some((c) => c.name === command.name)) return undefined;
    const skill = (await this.#skills(cwd, rpc)).find((s) => s.name === command.name);
    if (!skill) return undefined;
    // The text the manager composed starts with the command's own form; what
    // follows it (an attachment note) travels with the skill, after the args.
    const args = command.args?.trim() ?? '';
    const display = args ? `/${command.name} ${args}` : `/${command.name}`;
    const rest = options.text.startsWith(display) ? options.text.slice(display.length) : '';
    return { kind: 'skill', skill, text: `${args}${rest}`.trim() };
  }

  /**
   * The enabled skills the app-server sees in [cwd], reused for a minute.
   * Asked on the turn's own app-server when one is given, otherwise on a
   * short-lived one; an unanswered request yields none (and is not kept).
   */
  async #skills(cwd: string, rpc?: CodexAppServerRpc): Promise<CodexSkill[]> {
    const cached = this.#skillsByCwd.get(cwd);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.skills;
    const ask = async (client: CodexAppServerRpc): Promise<CodexSkill[] | undefined> =>
      parseCodexSkills(await client.request<unknown>('skills/list', { cwds: [cwd] }));
    const skills = rpc
      ? await ask(rpc).catch(() => undefined)
      : await this.#withShortLivedAppServer<CodexSkill[] | undefined>(ask, undefined);
    if (skills === undefined) return [];
    this.#skillsByCwd.set(cwd, { at: Date.now(), skills });
    return skills;
  }

  /** Fallback model list read straight from `~/.codex/config.toml`. */
  #modelsFromConfig(): AgentModel[] {
    try {
      const path = join(homedir(), '.codex', 'config.toml');
      if (!existsSync(path)) return [];
      return withOptions(parseCodexConfigModels(readFileSync(path, 'utf-8')), [
        CODEX_FALLBACK_REASONING,
      ]);
    } catch {
      return [];
    }
  }

  /**
   * Populate the per-model context-window cache from Codex's own metadata cache
   * (`~/.codex/models_cache.json`, refreshed by the codex CLI), keyed by model
   * slug (e.g. `gpt-5.5` → 272000). Runs once; best-effort — a missing/unreadable
   * file leaves usage count-only. The app-server `model/list` does not reliably
   * carry a window, so this file is the authoritative source.
   */
  #loadContextWindows(): Promise<void> {
    if (this.#windowsLoaded) return Promise.resolve();
    this.#windowsLoaded = true;
    try {
      const path = join(homedir(), '.codex', 'models_cache.json');
      if (existsSync(path)) {
        for (const [slug, win] of parseCodexModelWindows(readFileSync(path, 'utf-8'))) {
          this.#contextWindowByModel.set(slug, win);
        }
      }
    } catch {
      /* leave the cache empty; usage stays count-only */
    }
    return Promise.resolve();
  }
}

/**
 * Parse `~/.codex/models_cache.json` into a model-slug → context-window map.
 * The file is `{ models: [{ slug, context_window, … }] }`; entries without a
 * positive `context_window` are skipped.
 */
export function parseCodexModelWindows(raw: string): Map<string, number> {
  const windows = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return windows;
  }
  const models = isRecord(parsed) && Array.isArray(parsed['models']) ? parsed['models'] : [];
  for (const entry of models) {
    if (!isRecord(entry)) continue;
    const slug = typeof entry['slug'] === 'string' ? entry['slug'] : undefined;
    const window =
      typeof entry['context_window'] === 'number' ? entry['context_window'] : undefined;
    if (slug && window !== undefined && window > 0) windows.set(slug, window);
  }
  return windows;
}

/** A positive finite number, or 0 — usage fields are optional per model. */
function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A string field, or '' — app-server params are validated at the boundary. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\\/]/.test(p) || p.startsWith('/');
}

/**
 * Map the app-server `model/list` → `result.data` array into {@link AgentModel}s,
 * skipping models hidden from the default picker.
 */
export function parseCodexModelList(data: unknown): AgentModel[] {
  if (!Array.isArray(data)) return [];
  const out: AgentModel[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    if (entry['hidden'] === true) continue;
    const id =
      typeof entry['id'] === 'string'
        ? entry['id']
        : typeof entry['model'] === 'string'
          ? entry['model']
          : undefined;
    if (!id) continue;
    const displayName =
      typeof entry['displayName'] === 'string' && entry['displayName'].length > 0
        ? entry['displayName']
        : id;
    const description =
      typeof entry['description'] === 'string' && entry['description'].length > 0
        ? entry['description']
        : undefined;
    const options = parseCodexReasoning(
      entry['supportedReasoningEfforts'],
      entry['defaultReasoningEffort'],
    );
    out.push({
      id,
      displayName,
      ...(description !== undefined ? { description } : {}),
      isDefault: entry['isDefault'] === true,
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return out;
}

/**
 * Build the per-model reasoning knob from the app-server's
 * `supportedReasoningEfforts` (`[{ reasoningEffort, description }]`) and
 * `defaultReasoningEffort`. Returns `[]` when the model reports no efforts.
 */
export function parseCodexReasoning(raw: unknown, defaultEffort: unknown): AgentModelOption[] {
  if (!Array.isArray(raw)) return [];
  const levels: string[] = [];
  for (const entry of raw) {
    const level =
      isRecord(entry) && typeof entry['reasoningEffort'] === 'string'
        ? entry['reasoningEffort']
        : undefined;
    if (level && !levels.includes(level)) levels.push(level);
  }
  if (levels.length === 0) return [];
  const def =
    typeof defaultEffort === 'string' && levels.includes(defaultEffort) ? defaultEffort : undefined;
  return [reasoningOption(effortValues(levels), def)];
}

/**
 * Fallback parse of `~/.codex/config.toml`: the top-level `model` plus the keys
 * of the `[tui.model_availability_nux]` table (models the account has seen).
 * The configured `model` is flagged `isDefault`. Minimal hand-rolled scan — no
 * TOML dependency — tolerant of comments and quoting.
 */
export function parseCodexConfigModels(toml: string): AgentModel[] {
  let section = '';
  let configuredModel: string | undefined;
  const ids = new Set<string>();
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim();
      continue;
    }
    const kv = /^("?)([^"=]+?)\1\s*=\s*(.+)$/.exec(line);
    const key = kv?.[2]?.trim();
    if (!key) continue;
    if (section === '' && key === 'model') {
      const value = (kv?.[3] ?? '').trim().replace(/^["']|["']$/g, '');
      if (value) {
        configuredModel = value;
        ids.add(value);
      }
    } else if (section === 'tui.model_availability_nux') {
      ids.add(key);
    }
  }
  return [...ids].map(
    (id) => ({ id, displayName: id, isDefault: id === configuredModel }) satisfies AgentModel,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Does this `thread/resume` failure mean another Codex client owns the thread?
 *
 * The app-server rejects the second writer with
 * `thread <id> already has an active writer` (codex-cli 0.147.0, verified by
 * running two app-servers against one thread). Matched on the phrase rather
 * than the code, which is the generic `-32600` invalid-request.
 */
function isThreadHeldElsewhere(err: unknown): boolean {
  return /active writer/i.test(errorMessage(err));
}

/**
 * Return only text missing from an item's delta stream. A divergent assembled
 * item is appended whole: duplicate prose is preferable to silently deleting
 * text the user already saw, and the normal protocol path is exact/prefix.
 */
function unseenCompleteText(streamed: string, complete: string): string {
  if (complete.length === 0 || streamed === complete || streamed.includes(complete)) return '';
  return complete.startsWith(streamed) ? complete.slice(streamed.length) : complete;
}
