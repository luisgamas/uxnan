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
 * ## Process model
 *
 * One long-lived `codex app-server` process per adapter instance. It's
 * spawned lazily on the first turn (or eagerly by `start()`), the bridge
 * speaks JSON-RPC over its stdio, and the process is killed on `stop()`.
 * Threads live inside the app-server, so multi-turn conversations are cheap
 * (`turn/start` reuses the same `threadId`). The bridge persists each
 * thread's `nativeSessionId` so a restart can `thread/resume` and the
 * conversation history is preserved.
 *
 * Captured app-server JSON-RPC events (one JSON object per line):
 *   { "method":"turn/started", "params":{...} }
 *   { "method":"item/agentMessage/delta", "params":{ delta } }
 *   { "method":"item/reasoning/summaryTextDelta", "params":{ delta } }
 *   { "method":"item/commandExecution/outputDelta", "params":{ delta } }
 *   { "method":"item/completed", "params":{ item:{ type:'commandExecution'|'fileChange'|'agentMessage'|'reasoning'|... } } }
 *   { "method":"turn/completed", "params":{ turn:{ status, error?, tokenUsage? } } }
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
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  ApprovalDecision,
  SendTurnOptions,
} from '@uxnan/shared';
import { expandCustomCommand, scanCustomCommands, type CustomCommandSource } from './command-scan.js';
import { runGit } from '../git/git-runner.js';
import { BaseAgentAdapter } from './base-adapter.js';
import {
  buildReplyResult,
  describeServerRequest,
  decisionToReply,
  type ApprovalKind,
  type PendingCodexApproval,
} from './codex-approval.js';
import { CodexAppServerRpc, RpcError } from './codex-app-server.js';
import { codexReasoningText, type CodexFileChange } from './codex-tools.js';
import {
  commandBlock,
  fileChangeBlock,
  toolBlock,
  unifiedDiffBlock,
  writeDiffBlock,
} from './content-blocks.js';
import { effortValues, reasoningOption, reasoningValue, withOptions } from './run-options.js';

const CODEX_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
  commands: true,
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
  /** Resolved binary entry (see resolve-codex.ts). */
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
  threadId: string;
  /** Accumulated final-text of the last `agentMessage` item-completed, for `turn/completed`. */
  lastAgentText: string;
  /** Model the turn ran on, for looking up its context window on completion. */
  model?: string;
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
 * Sum the context-occupying tokens from a Codex `turn.completed.usage` object
 * (`{ input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }`
 * — `cached_input_tokens` is a subset of `input_tokens`, so it isn't added).
 */
export function codexUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const count = (key: string): number =>
    typeof usage[key] === 'number' ? (usage[key] as number) : 0;
  const total = count('input_tokens') + count('output_tokens') + count('reasoning_output_tokens');
  return total > 0 ? total : undefined;
}

/**
 * The default `spawnAppServer` impl: spawns the resolved Codex binary with
 * `app-server` appended, pipes stdin/stdout, returns the streams. Used by
 * production; tests inject a `spawnAppServer` that wires a fake app-server
 * (NDJSON over a PassThrough) so the JSON-RPC client can be exercised.
 */
function defaultSpawnAppServer(binaryPath: string, prependArgs: string[]): () => SpawnedAppServer {
  return () => {
    const child = spawn(binaryPath, [...prependArgs, 'app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    if (!child.stdout || !child.stdin) {
      throw new Error('codex app-server: failed to acquire stdio streams');
    }
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

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: CodexPermissionMode;
  readonly #onApprovalRequest: CodexAdapterOptions['onApprovalRequest'];
  readonly #spawnAppServer: () => SpawnedAppServer;
  /** threadId (bridge) → Codex app-server threadId, for `thread/resume` continuity. */
  readonly #threadByBridgeThread = new Map<string, string>();
  /** turnId (bridge) → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** model id → context-window tokens, from `~/.codex/models_cache.json`. */
  readonly #contextWindowByModel = new Map<string, number>();
  #windowsLoaded = false;
  #defaultCwd = process.cwd();
  /** Long-lived app-server connection. Spawned lazily on first use. */
  #rpc: CodexAppServerRpc | null = null;
  #appServerInit: Promise<CodexAppServerRpc> | null = null;
  /** Pending approvals keyed by the bridge's `approvalId`; the server request id
   * is captured so the reply is shaped with the right `ReviewDecision` kind. */
  #pendingApprovals = new Map<string, { kind: ApprovalKind; serverRequestId: number | string }>();
  #approvalSeq = 0;

  /** Native Codex thread id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#threadByBridgeThread.get(threadId);
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
   * FOR-DEV: the resulting `(approvalPolicy, sandbox)` is sent on `thread/start`,
   * which runs only on a thread's FIRST turn — so the posture governs the thread
   * from creation but a mid-thread access-mode change does NOT re-issue
   * `thread/start` and only takes effect on threads started after the change.
   * A true per-turn re-apply needs confirming whether the app-server `turn/start`
   * accepts an approval/sandbox override (see bridge/FOR-DEV.md).
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
    if (this.#rpc) {
      this.#rpc.close();
      this.#rpc = null;
      this.#appServerInit = null;
    }
  }

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const effort = reasoningValue(options);
    // The thread's persisted access mode (chosen on the phone) overrides the
    // configured posture. NOTE: the policy is applied at `thread/start` below,
    // so it governs a thread from its FIRST turn; see `#effectiveMode`.
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

    // Resolve the Codex thread id: re-use a previously persisted one (after a
    // bridge restart) or start a fresh one.
    let codexThreadId = this.#threadByBridgeThread.get(threadId);
    if (!codexThreadId) {
      try {
        const started = await rpc.request<{ thread: { id: string; sessionId?: string } }>(
          'thread/start',
          {
            model,
            cwd,
            approvalPolicy,
            sandbox,
            ...(typeof effort === 'string' ? { effort } : {}),
          },
        );
        codexThreadId = started.thread.id;
        this.#threadByBridgeThread.set(threadId, codexThreadId);
      } catch (err) {
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `codex thread/start failed: ${errorMessage(err)}` },
        });
        return;
      }
    }

    // Persist the native session id early so the on-disk history fallback
    // works after a crash mid-turn.
    this.#active.set(turnId, {
      bridgeTurnId: turnId,
      codexTurnId: null,
      threadId,
      lastAgentText: '',
      ...(typeof model === 'string' ? { model } : {}),
    });
    // Warm the per-model context-window cache (once) so completion can emit a
    // window → a percentage on the phone.
    void this.#loadContextWindows();
    this.emit({ type: 'turn_started', threadId, turnId });

    try {
      const response = await rpc.request<{ turn: { id: string } }>('turn/start', {
        threadId: codexThreadId,
        input: [{ type: 'text', text }],
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
    }
  }

  async cancelTurn(_threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (!run) return;
    await this.#interruptTurn(run);
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
      return rpc;
    })().catch((err) => {
      this.#appServerInit = null;
      throw err;
    });
    return this.#appServerInit;
  }

  /** Handle an unexpected app-server exit: drop state, fail in-flight turns. */
  #handleAppServerClose(): void {
    this.#rpc = null;
    this.#appServerInit = null;
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
      case 'turn/started':
        // The bridge already emits `turn_started` immediately when we
        // receive the `turn/start` response; the app-server's notification
        // is a duplicate we ignore.
        return;
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
      case 'item/started':
        // Item begin — we don't need it (the relevant state arrives on
        // `item/completed`); ignore for now.
        return;
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
      case 'turn/diff/updated':
        // The unified diff the app-server has accumulated so far. We could
        // surface this as a `turn/diff` block but it duplicates the
        // `fileChange` items; the phone already gets structured diffs from
        // those. Ignore.
        return;
      case 'error': {
        // An error notification is rare but the app-server uses it for
        // catastrophic failures (e.g. context overflow). Surface to the
        // current in-flight turn.
        const message = typeof p['message'] === 'string' ? p['message'] : 'codex app-server error';
        this.#emitTurnErrorForActive(message);
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
        // Final assembled text arrives here; deltas already streamed, so we
        // record it for `turn/completed` to fall back to.
        const text = typeof item['text'] === 'string' ? (item['text'] as string) : '';
        run.lastAgentText = text;
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
            data: { content: commandBlock(command, output, isError) },
          });
        }
        return;
      }
      case 'fileChange': {
        const changes = Array.isArray(item['changes'])
          ? (item['changes'] as Record<string, unknown>[]).map((c) => ({
              path: typeof c['path'] === 'string' ? (c['path'] as string) : '',
              kind: typeof c['kind'] === 'string' ? (c['kind'] as string) : '',
              diff: typeof c['diff'] === 'string' ? (c['diff'] as string) : '',
            }))
          : [];
        for (const change of changes) {
          const name = isAbsolutePath(change.path)
            ? relative(this.#defaultCwd, change.path) || change.path
            : change.path;
          // The app-server already attaches the unified diff (unlike the
          // `exec --json` path which only carried the path); use it directly
          // when present, else fall back to reading the file.
          let content: Record<string, unknown> | undefined;
          if (change.kind !== 'delete' && change.diff && change.diff.length > 0) {
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
          content ??= fileChangeBlock(change.path);
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { content },
          });
        }
        return;
      }
      case 'mcpToolCall': {
        const name = typeof item['tool'] === 'string' ? (item['tool'] as string) : 'tool';
        const output = typeof item['result'] === 'string' ? (item['result'] as string) : '';
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.bridgeTurnId,
          data: {
            content: toolBlock(
              name,
              typeof item['id'] === 'string' ? (item['id'] as string) : '',
              {},
              output,
              item['status'] === 'failed',
            ),
          },
        });
        return;
      }
      case 'webSearch':
      case 'contextCompaction':
      case 'plan':
      case 'userMessage':
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        // Known item types we currently render as plain text on the phone;
        // no structured block is needed. The full history-fallback path
        // (session-history.ts) will still surface them via the on-disk
        // rollout reader.
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
      return;
    }
    const usage = isRecord(turn['tokenUsage']) ? turn['tokenUsage'] : undefined;
    const tokens = codexUsageTokens(usage);
    const contextWindow =
      run.model !== undefined ? this.#contextWindowByModel.get(run.model) : undefined;
    this.emit({
      type: 'turn_completed',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: {
        text: run.lastAgentText,
        ...(tokens !== undefined
          ? { usage: { tokens, ...(contextWindow !== undefined ? { contextWindow } : {}) } }
          : {}),
      },
    });
  }

  /**
   * Return the current in-flight run (mutable reference) so item-completed
   * handlers can accumulate per-run state (`lastAgentText`, etc.) directly on
   * the stored object. Returns `null` when no turn is active.
   */
  #activeRun(): ActiveRun | null {
    for (const run of this.#active.values()) return run;
    return null;
  }

  /** Helper: locate the current in-flight run keyed by bridge turnId. */
  #currentRun(): { turnId: string; threadId: string; cwd: string; lastAgentText: string } | null {
    for (const run of this.#active.values()) {
      // There should be exactly one in-flight run for a single adapter; the
      // bridge serializes turns per thread, so this picks the first one.
      return {
        turnId: run.bridgeTurnId,
        threadId: run.threadId,
        cwd: this.#defaultCwd,
        lastAgentText: run.lastAgentText,
      };
    }
    return null;
  }

  #emitDelta(_p: Record<string, unknown>, delta: string): void {
    const run = this.#currentRun();
    if (!run) return;
    this.emit({ type: 'delta', threadId: run.threadId, turnId: run.turnId, data: { text: delta } });
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
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (models: AgentModel[]): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          streams.kill();
        } catch {
          /* already gone */
        }
        // parseCodexModelList already attaches each model's REAL per-model
        // reasoning efforts; the config fallback gets a generic effort knob.
        resolve(models.length > 0 ? models : this.#modelsFromConfig());
      };

      let streams: SpawnedAppServer;
      try {
        streams = this.#spawnAppServer();
      } catch {
        resolve(this.#modelsFromConfig());
        return;
      }

      const rpc = new CodexAppServerRpc(
        { stdin: streams.stdin, stdout: streams.stdout },
        { onNotification: () => undefined, onServerRequest: () => null },
        { requestTimeoutMs: MODEL_LIST_TIMEOUT_MS },
      );
      streams.onClose(() => rpc.onProcessClose(0));

      timer = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);
      rpc
        .request('initialize', {
          clientInfo: { name: 'uxnan-bridge', title: null, version: '1.0.0' },
        })
        .then(() =>
          rpc.request<{ data: unknown }>('model/list', {}).then((res) => {
            finish(parseCodexModelList(res.data));
          }),
        )
        .catch(() => finish([]));
    });
  }

  /**
   * Codex's custom prompts live user-level under `~/.codex/prompts/*.md`
   * (project scope is not supported by Codex). The app-server exposes no
   * slash-command or compaction RPC headless, so only these prompt templates are
   * advertised — expanded by {@link expandCommand} rather than run natively.
   */
  #commandSource(): CustomCommandSource {
    return { dirs: [join(homedir(), '.codex', 'prompts')], ext: '.md', format: 'markdown' };
  }

  listCommands(): Promise<AgentCommand[]> {
    return scanCustomCommands(this.#commandSource());
  }

  expandCommand(name: string, args?: string): Promise<string> {
    return expandCustomCommand(this.#commandSource(), name, args);
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
