/**
 * Grok adapter (real agent) — driven over the **Agent Client Protocol (ACP)**.
 *
 * Grok is xAI's coding CLI (`grok`). Its `grok agent stdio` subcommand speaks
 * JSON-RPC 2.0 over newline-delimited stdio — the same ACP framing as `zero acp`
 * and `codex app-server`, so we reuse that transport (`NdjsonRpc`) and play the
 * ACP *client* (the role an editor like Zed plays): we drive Grok and answer
 * Grok's permission prompts.
 *
 * ## Why `grok agent stdio` (vs `grok -p` headless)
 * `grok -p --output-format streaming-json` is one-directional with no interactive
 * permission responder. `grok agent stdio` is two-way: Grok sends
 * `session/request_permission` and the client replies, so the bridge can gate a
 * tool through the phone's approval card (like Codex/OpenCode/Zero).
 *
 * ## Protocol (verified against a live `grok 0.2.93` handshake)
 *  - `initialize` → `{ agentCapabilities, authMethods, _meta:{ modelState } }`.
 *    `_meta.modelState.availableModels` carries the full per-model info
 *    (`totalContextTokens`, `reasoningEfforts`), so model discovery needs no
 *    extra call or a session.
 *  - `session/new { cwd, mcpServers:[] }` → `{ sessionId, models }`. We advertise
 *    `fs:{readTextFile:false,writeTextFile:false}` so Grok does its own local file
 *    I/O and never asks the client for `fs/*`.
 *  - `session/set_model { sessionId, modelId }` — standard ACP model select
 *    (returns `{_meta:{model:{Ok}}}` + a `model_changed` update).
 *  - `session/set_config_option { sessionId, configId, value }` — Grok offers
 *    reasoning effort as a session config option (`reasoning_effort`, category
 *    `thought_level`: `xhigh`/`high`/`medium`/`low`), so the chosen effort goes
 *    there (`session/set_mode` accepts anything and changes nothing).
 *  - `session/prompt { prompt:[{type:'text',text}] }` — a REQUEST that resolves
 *    with `{ stopReason }` when the turn ends (our `turn_completed` signal).
 *  - `session/update` notifications: `agent_message_chunk`→delta,
 *    `agent_thought_chunk`→thinking, `tool_call`/`tool_call_update`→block,
 *    `plan`→plan block.
 *  - `session/request_permission { toolCall, options:[{optionId,name,kind}] }` —
 *    routed to the bridge's approval round-trip; we reply the chosen `optionId`
 *    (matched by `kind`: allow_once/allow_always/reject_once).
 *  - `session/cancel` (notification) ← cancelTurn.
 *
 * ## Verification note
 * The handshake, model discovery, the per-turn stream (`tool_call` / `plan`,
 * mapped in `acp-tools.ts`), token usage and the command list were exercised
 * live, and so were the effort (`session/set_config_option`) and the
 * `session/request_permission` round-trip — see bridge/docs/agents.md.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOptionValue,
  ApprovalDecision,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { acpDesktopMcpServers, acpSupportsHttpMcp, type AcpMcpServerHttp } from './acp-mcp.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { defaultSpawn, spawnPiped, type SpawnFn } from './spawn.js';
// The generic NDJSON JSON-RPC 2.0 transport (also used by the Codex app-server).
import { CodexAppServerRpc as NdjsonRpc, RpcError } from './codex-app-server.js';
import { planBlock, warningBlock, withBlockId, type PlanStepBlock } from './content-blocks.js';
import { reasoningOption, reasoningValue } from './run-options.js';
import {
  acpPlanSteps,
  acpToolBlock,
  acpToolKind,
  acpToolStartBlock,
  type AcpToolCall,
} from './acp-tools.js';

const GROK_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  // ACP `session/request_permission` gives real per-action approvals.
  approvals: true,
  // `agentCapabilities.loadSession` + `session/load` → resume across turns.
  forking: true,
  // Grok's ACP `promptCapabilities.image` is false, so no *inline* image block
  // can ride on `session/prompt` — but that is not how the bridge delivers an
  // attachment: it writes the file into the workspace and references its path,
  // and Grok opens it with its own file tools. Verified against `grok --print`
  // with a four-quadrant probe image, which it described correctly.
  images: true,
  // `session/prompt` itself returns only `{ stopReason }`, but the stream's
  // `turn_completed` update carries a full `usage` block — captured from a real
  // run: `{ inputTokens, outputTokens, totalTokens, cachedReadTokens,
  // reasoningTokens }`.
  reportsContextUsage: true,
  // ACP advertises slash commands via `available_commands_update` (captured below).
  commands: true,
};

/** How a run should answer Grok's permission prompts. */
type PermissionPosture = 'interactive' | 'approveAll' | 'approveSession';

export interface GrokAdapterOptions {
  /** Resolved `grok` executable path (found by `locateAgent`, `agents/agent-installs.ts`). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[grok.js]` when run via node). */
  prependArgs?: string[];
  /** Default model id when the turn doesn't pick one. */
  defaultModel?: string;
  /**
   * Route an ACP `session/request_permission` to the bridge so the phone can
   * decide; returns the user's {@link ApprovalDecision}. Absent in tests →
   * interactive requests fail safe to reject.
   */
  onApprovalRequest?: (
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ) => Promise<ApprovalDecision>;
  /** Injected `grok agent stdio` spawner (tests). */
  spawnAcp?: () => SpawnedAcp;
  /** Where Grok's own non-asking permission mode comes from (tests; default reads the user's files). */
  permissionSource?: (cwd: string) => GrokPermissionSource | undefined;
}

/** Streams + lifecycle a `spawnAcp` implementation returns. */
export interface SpawnedAcp {
  stdin: Writable;
  stdout: Readable;
  onClose: (cb: (code: number | null) => void) => void;
  kill: () => void;
}

interface ActiveRun {
  bridgeTurnId: string;
  threadId: string;
  sessionId: string;
  /** Accumulated assistant text, for `turn_completed`. */
  full: string;
  /** Tool calls in flight, keyed by ACP `toolCallId` (emit a block at terminal). */
  tools: Map<string, AcpToolCall>;
  /** Tool ids already emitted as a block. */
  emitted: Set<string>;
  /** How this run answers permission prompts (from the thread's access mode). */
  posture: PermissionPosture;
  /** Context-occupying tokens from the stream's `turn_completed`, if it said. */
  tokens?: number;
  finished: boolean;
}

/**
 * Context-occupying tokens from Grok's `turn_completed` usage block.
 *
 * `totalTokens` is what Grok itself reports as the turn's size; falling back to
 * `inputTokens + outputTokens` covers a build that omits it.
 * `cachedReadTokens` is a SUBSET of `inputTokens` (as in Codex's
 * `cached_input_tokens`), so adding it would double-count.
 */
export function grokUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const total = num(usage['totalTokens']);
  if (total > 0) return Math.round(total);
  const sum = num(usage['inputTokens']) + num(usage['outputTokens']);
  return sum > 0 ? Math.round(sum) : undefined;
}

/** One model as reported by Grok's ACP `modelState.availableModels`. */
interface GrokAcpModel {
  modelId?: unknown;
  name?: unknown;
  description?: unknown;
  _meta?: {
    totalContextTokens?: unknown;
    supportsReasoningEffort?: unknown;
    reasoningEfforts?: unknown;
  };
}

/** Grok's `modelState` (present on both `initialize._meta` and `session/new`). */
interface GrokModelState {
  currentModelId?: unknown;
  availableModels?: GrokAcpModel[];
}

function defaultSpawnAcp(binaryPath: string, prependArgs: string[], cwd: string): () => SpawnedAcp {
  return () => {
    const child = spawnPiped(binaryPath, [...prependArgs, 'agent', 'stdio'], { cwd });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      onClose: (cb) => child.on('close', cb),
      kill: () => child.kill(),
    };
  };
}

/** Permission modes under which Grok runs tools without asking first. */
const GROK_NON_ASKING_MODES = new Set([
  'auto',
  'acceptEdits',
  'bypassPermissions',
  'always-approve',
  'yolo',
]);

/** Where Grok's own permission mode comes from, when it is one that does not ask. */
export interface GrokPermissionSource {
  mode: string;
  /** The file that sets it, as the user would find it (`~/.claude/settings.json`). */
  file: string;
}

/**
 * The permission mode Grok applies in [cwd] when it would not ask before a
 * tool, and the file that sets it — or `undefined` when it asks.
 *
 * Grok decides by itself whether to ask: its `[ui] permission_mode` in
 * `~/.grok/config.toml`, and the `defaultMode` of the Claude settings it also
 * reads (the folder's `.claude/settings.local.json` and `settings.json` up to
 * the repository root, then the user's). With `auto` there, its classifier
 * ran `rm -rf` while the thread was set to request approval — measured
 * 2026-09-25 — and nothing on ACP turns that off for one session
 * (`_meta.yoloMode` / `autoMode` only turn modes on). So the bridge cannot
 * enforce the thread's choice; it says so instead (see sendTurn).
 */
export function grokPermissionSource(
  cwd: string,
  home: string = homedir(),
  readFile: (path: string) => string | undefined = readTextFile,
): GrokPermissionSource | undefined {
  const claudeFiles: string[] = [];
  let dir = cwd;
  for (;;) {
    claudeFiles.push(
      join(dir, '.claude', 'settings.local.json'),
      join(dir, '.claude', 'settings.json'),
    );
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir || dir === home) break;
    dir = dirname(dir);
  }
  claudeFiles.push(
    join(home, '.claude', 'settings.local.json'),
    join(home, '.claude', 'settings.json'),
  );
  for (const file of claudeFiles) {
    const raw = readFile(file);
    if (raw === undefined) continue;
    let mode = '';
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const permissions = isRecord(parsed['permissions']) ? parsed['permissions'] : {};
        mode = str(permissions['defaultMode']) || str(parsed['defaultMode']);
      }
    } catch {
      continue;
    }
    if (!mode) continue;
    return GROK_NON_ASKING_MODES.has(mode) ? { mode, file: tildePath(file, home) } : undefined;
  }
  const config = readFile(join(home, '.grok', 'config.toml'));
  const mode = config ? /^\s*permission_mode\s*=\s*"([^"]+)"/m.exec(config)?.[1] : undefined;
  return mode && GROK_NON_ASKING_MODES.has(mode)
    ? { mode, file: tildePath(join(home, '.grok', 'config.toml'), home) }
    : undefined;
}

/** The notice a turn carries when Grok will not ask although the thread should. */
export function grokPermissionNotice(source: GrokPermissionSource): string {
  return (
    `Grok decides by itself when to ask, and its permission mode here is "${source.mode}" ` +
    `(from ${source.file}), so it may run commands and edit files without asking, even ` +
    `though this chat is set to ask first. Set that mode to "default" to be asked.`
  );
}

/** `path` from the home folder as `~/…`, with `/` on every platform. */
function tildePath(path: string, home: string): string {
  const rel = relative(home, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? `~/${rel.split(sep).join('/')}` : path;
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/** The id Grok gives its reasoning-effort config option (2026-09). */
const GROK_EFFORT_OPTION = 'reasoning_effort';

/** The id of the `thought_level` option among a session's `configOptions`, if any. */
export function effortOptionId(configOptions: unknown): string | undefined {
  if (!Array.isArray(configOptions)) return undefined;
  const option = configOptions.find((o) => isRecord(o) && o['category'] === 'thought_level');
  return isRecord(option) && str(option['id']) ? str(option['id']) : undefined;
}

/** How long a folder's command list is reused. */
const COMMANDS_TTL_MS = 60_000;
/** How long a listing waits for a fresh session to announce its commands (≈2.5 s measured). */
const COMMANDS_WAIT_MS = 8_000;
const COMMANDS_POLL_MS = 100;

/**
 * Commands Grok announces that the bridge does not offer: the access mode is
 * the thread's own (`always-approve` would override it behind its back), and
 * the status line and memory browser are screens of Grok's terminal UI.
 */
const GROK_BRIDGE_OWNED_COMMANDS = new Set(['always-approve', 'statusline', 'memory']);

/**
 * Grok's `availableCommands` (`[{ name, description, input: { hint } | null }]`)
 * as commands. A command that is one of the skills Grok reads (a `SKILL.md`
 * in `~/.agents/skills`, `~/.grok/skills` or the same folders of [cwd]) is
 * labelled a skill; the rest are Grok's own. Both run natively as `/name args`.
 */
export function parseGrokCommands(
  raw: unknown[],
  cwd?: string,
  isSkill: (name: string) => boolean = (name) => grokSkillExists(name, cwd),
): AgentCommand[] {
  const commands: AgentCommand[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item['name']);
    if (!name || GROK_BRIDGE_OWNED_COMMANDS.has(name)) continue;
    const description = str(item['description']);
    const hint = isRecord(item['input']) ? str(item['input']['hint']) : '';
    commands.push({
      name,
      source: isSkill(name) ? 'skill' : 'acp',
      headlessSupported: true,
      ...(description ? { description } : {}),
      ...(hint ? { argumentHint: hint } : {}),
    });
  }
  return commands;
}

function grokSkillExists(name: string, cwd?: string): boolean {
  if (!/^[\w.-]+$/.test(name)) return false;
  const roots = [homedir(), ...(cwd ? [cwd] : [])];
  return roots.some((root) =>
    ['.agents', '.grok'].some((dir) => existsSync(join(root, dir, 'skills', name, 'SKILL.md'))),
  );
}

export class GrokAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'grok';
  readonly capabilities = GROK_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #onApprovalRequest: GrokAdapterOptions['onApprovalRequest'];
  readonly #spawnAcp: () => SpawnedAcp;
  /** One-shot spawner for side errands that must not touch the ACP session. */
  readonly #spawnOneShot: SpawnFn = defaultSpawn;
  /** threadId → ACP sessionId, for continuity + history fallback. */
  readonly #sessionByThread = new Map<string, string>();
  /** sessionId → in-flight run, to route session-scoped updates/permissions. */
  readonly #runBySession = new Map<string, ActiveRun>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** sessionId → last model we set. */
  readonly #modelBySession = new Map<string, string>();
  /** sessionId → last reasoning effort we set. */
  readonly #effortBySession = new Map<string, string>();
  readonly #permissionSource: (cwd: string) => GrokPermissionSource | undefined;
  /** Sessions already told that Grok's own mode will not ask (see sendTurn). */
  readonly #warnedSessions = new Set<string>();
  /** sessionId → the id of its `thought_level` config option (see #applyEffort). */
  readonly #effortOptionBySession = new Map<string, string>();
  /** Each folder's commands, from its sessions' `available_commands_update` (see listCommands). */
  readonly #commandsByCwd = new Map<string, { at: number; commands: AgentCommand[] }>();
  /** sessionId → the folder it runs in, so a command update is filed under it. */
  readonly #cwdBySession = new Map<string, string>();
  /** sessionId → the commands its latest update announced (it can beat `session/new`'s answer). */
  readonly #commandsBySession = new Map<string, AgentCommand[]>();
  /** Model list, captured from the `initialize` handshake (cached for the process). */
  #modelsCache: AgentModel[] | null = null;
  #rpc: NdjsonRpc | null = null;
  /** The ACP process advertised HTTP MCP servers (`initialize`) — Uxnan Desktop's tools are offered only then. */
  #mcpHttp = false;
  #init: Promise<NdjsonRpc> | null = null;
  #defaultCwd = process.cwd();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  /** Native Grok session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: GrokAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'grok';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#onApprovalRequest = options.onApprovalRequest;
    this.#spawnAcp =
      options.spawnAcp ?? defaultSpawnAcp(this.#binaryPath, this.#prependArgs, this.#defaultCwd);
    this.#permissionSource = options.permissionSource ?? ((cwd) => grokPermissionSource(cwd));
  }

  /**
   * List the models this Grok install reports, for `agent/models`. Grok returns
   * them (with context window + reasoning-effort knobs) in the `initialize`
   * handshake's `_meta.modelState`, so we just start the ACP process and read
   * them — no extra CLI call and no session needed. Cached for the process.
   */
  async listModels(): Promise<AgentModel[]> {
    if (this.#modelsCache) return this.#modelsCache;
    try {
      await this.#ensureAcp();
    } catch {
      return [];
    }
    return this.#modelsCache ?? [];
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const run of this.#active.values()) run.finished = true;
    this.#active.clear();
    this.#runBySession.clear();
    if (this.#rpc) {
      this.#rpc.close();
      this.#rpc = null;
      this.#init = null;
    }
  }

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;

    let rpc: NdjsonRpc;
    try {
      rpc = await this.#ensureAcp();
    } catch (err) {
      return this.#failTurn(threadId, turnId, `failed to start grok agent: ${errorMessage(err)}`);
    }

    // Resolve the ACP session for this thread (new, or load a persisted one).
    let sessionId: string;
    try {
      sessionId = await this.#ensureSession(
        rpc,
        threadId,
        cwd,
        acpDesktopMcpServers(options.desktopTools, cwd, this.#mcpHttp),
      );
    } catch (err) {
      return this.#failTurn(threadId, turnId, `grok session failed: ${errorMessage(err)}`);
    }

    if (model) await this.#applyModel(rpc, sessionId, model);
    const effort = reasoningValue(options);
    if (effort) await this.#applyEffort(rpc, sessionId, effort);

    const run: ActiveRun = {
      bridgeTurnId: turnId,
      threadId,
      sessionId,
      full: '',
      tools: new Map(),
      emitted: new Set(),
      posture: postureFor(options.accessMode),
      finished: false,
    };
    this.#active.set(turnId, run);
    this.#runBySession.set(sessionId, run);
    this.emit({ type: 'turn_started', threadId, turnId });
    // The thread asks first, but Grok's own mode will not: say so, once per
    // session (the bridge cannot turn Grok's mode off, see grokPermissionSource).
    if (run.posture === 'interactive' && !this.#warnedSessions.has(sessionId)) {
      const source = this.#permissionSource(cwd);
      if (source) {
        this.#warnedSessions.add(sessionId);
        this.emit({
          type: 'block',
          threadId,
          turnId,
          data: { content: warningBlock(grokPermissionNotice(source)) },
        });
      }
    }

    // `session/prompt` is a REQUEST that only resolves when the whole turn ends,
    // so we DON'T await it here (that would block sendTurn until completion) —
    // we fire it and finalize the turn on its resolution. Updates + permission
    // prompts arrive via notifications/server-requests meanwhile.
    rpc
      // timeout 0: a turn may run arbitrarily long, so never auto-reject it.
      .request<{ stopReason?: string }>(
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text }] },
        0,
      )
      .then((result) => this.#completeTurn(run, result?.stopReason ?? 'end_turn'))
      .catch((err) => {
        // A rejected prompt (or a dead process) ends the turn as an error, unless
        // it was already finished by a cancel.
        if (!run.finished) this.#finishError(run, `grok prompt failed: ${errorMessage(err)}`);
      });
  }

  /**
   * Name a conversation with a one-shot run. `grok -p` is its documented single-turn form: it prints the reply to stdout
   * and exits, so nothing touches the ACP session this thread runs on.
   *
   * No model flag: Grok exposes its models through the ACP `initialize`
   * handshake rather than a fixed cheap-tier id, so this runs on its own
   * default. Verified live against grok 0.2.118.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const raw = await runTitleOneShot(() =>
      this.#spawnOneShot(this.#binaryPath, [...this.#prependArgs, ...['-p', prompt]], cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
  }

  async cancelTurn(threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (!run) return;
    run.finished = true;
    this.#active.delete(turnId);
    this.#runBySession.delete(run.sessionId);
    if (this.#rpc) this.#rpc.notify('session/cancel', { sessionId: run.sessionId });
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }

  /** Lazy ACP lifecycle: spawn `grok agent stdio` → initialize → return the RPC. */
  #ensureAcp(): Promise<NdjsonRpc> {
    if (this.#init) return this.#init;
    this.#init = (async () => {
      const streams = this.#spawnAcp();
      const rpc = new NdjsonRpc(
        { stdin: streams.stdin, stdout: streams.stdout, onClose: () => this.#handleAcpClose() },
        {
          onNotification: (method, params) => this.#onNotification(method, params),
          onServerRequest: (method, params) => this.#onServerRequest(method, params),
        },
      );
      streams.onClose((code) => rpc.onProcessClose(code));
      try {
        const init = await rpc.request<{ _meta?: { modelState?: GrokModelState } }>('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: 'uxnan-bridge', version: '1.0.0' },
        });
        this.#mcpHttp = acpSupportsHttpMcp(init);
        // Grok reports its models in the handshake — cache them for `agent/models`.
        const models = mapGrokModels(init?._meta?.modelState, this.#defaultModel);
        if (models.length > 0) this.#modelsCache = models;
      } catch (err) {
        rpc.close();
        streams.kill();
        throw err;
      }
      this.#rpc = rpc;
      return rpc;
    })().catch((err) => {
      this.#init = null;
      throw err;
    });
    return this.#init;
  }

  /** Get (or create/load) the ACP session id for a thread. */
  async #ensureSession(
    rpc: NdjsonRpc,
    threadId: string,
    cwd: string,
    mcpServers: AcpMcpServerHttp[] = [],
  ): Promise<string> {
    const known = this.#sessionByThread.get(threadId);
    if (known) {
      // The same process still holds it (common case); a restarted process needs
      // session/load to re-attach. Try load; fall through to new on failure.
      try {
        await rpc.request('session/load', { sessionId: known, cwd, mcpServers });
        this.#cwdBySession.set(known, cwd);
        return known;
      } catch {
        this.#sessionByThread.delete(threadId);
        this.#modelBySession.delete(known);
        this.#effortBySession.delete(known);
      }
    }
    const res = await rpc.request<{ sessionId: string; configOptions?: unknown }>('session/new', {
      cwd,
      mcpServers,
    });
    this.#sessionByThread.set(threadId, res.sessionId);
    this.#cwdBySession.set(res.sessionId, cwd);
    const effortOption = effortOptionId(res.configOptions);
    if (effortOption) this.#effortOptionBySession.set(res.sessionId, effortOption);
    return res.sessionId;
  }

  /** Point the session at a model (best-effort; an unknown model keeps Grok's). */
  async #applyModel(rpc: NdjsonRpc, sessionId: string, model: string): Promise<void> {
    if (this.#modelBySession.get(sessionId) === model) return;
    try {
      await rpc.request('session/set_model', { sessionId, modelId: model });
      this.#modelBySession.set(sessionId, model);
    } catch {
      /* model unknown to Grok → keep its active model */
    }
  }

  /**
   * Set the session's reasoning effort (best-effort). Grok offers it as a
   * session config option of category `thought_level` (`reasoning_effort`:
   * `xhigh`/`high`/`medium`/`low`), set with `session/set_config_option` —
   * verified live: the answer carries the option's new value, a
   * `config_option_update` follows, and an unknown value is refused.
   * (`session/set_mode` answers `{}` to anything, `bogus` included, and changes
   * nothing — the adapter used it until 2026-09-25.)
   */
  async #applyEffort(rpc: NdjsonRpc, sessionId: string, effort: string): Promise<void> {
    if (this.#effortBySession.get(sessionId) === effort) return;
    const configId = this.#effortOptionBySession.get(sessionId) ?? GROK_EFFORT_OPTION;
    try {
      await rpc.request('session/set_config_option', { sessionId, configId, value: effort });
      this.#effortBySession.set(sessionId, effort);
    } catch {
      /* effort unknown to Grok → keep its active effort */
    }
  }

  #handleAcpClose(): void {
    this.#rpc = null;
    this.#init = null;
    for (const run of this.#active.values()) {
      if (run.finished) continue;
      run.finished = true;
      this.emit({
        type: 'turn_error',
        threadId: run.threadId,
        turnId: run.bridgeTurnId,
        data: { text: 'grok agent process exited unexpectedly' },
      });
    }
    this.#active.clear();
    this.#runBySession.clear();
  }

  /** Route a `session/update` notification to the run + bridge events. */
  #onNotification(method: string, params: unknown): void {
    // Grok splits its stream across THREE methods, and only the first is ACP's
    // own. Captured off the live wire while the adapter drove a real turn:
    // `session/update` carries the ACP-standard updates, while `turn_completed`
    // — and with it the turn's token usage — arrives on
    // `_x.ai/session_notification`. Accepting only the standard method dropped
    // every usage report on the floor, which is why Grok's context meter and
    // its share of the profile metrics stayed empty.
    if (
      method !== 'session/update' &&
      method !== '_x.ai/session/update' &&
      method !== '_x.ai/session_notification'
    ) {
      return;
    }
    const p = isRecord(params) ? params : {};
    const update = isRecord(p['update']) ? p['update'] : {};
    // Slash-command availability is session-scoped and can arrive before any
    // turn — capture it regardless of an active run (see listCommands).
    if (str(update['sessionUpdate']) === 'available_commands_update') {
      this.#captureCommands(
        str(p['sessionId']),
        update['availableCommands'] ?? update['available_commands'],
      );
      return;
    }
    const run = this.#runBySession.get(str(p['sessionId']));
    if (!run || run.finished) return;
    switch (str(update['sessionUpdate'])) {
      case 'agent_message_chunk': {
        const text = contentText(update['content']);
        if (text) {
          run.full += text;
          this.emit({
            type: 'delta',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { text },
          });
        }
        return;
      }
      case 'turn_completed': {
        const tokens = grokUsageTokens(update['usage']);
        if (tokens !== undefined) run.tokens = tokens;
        return;
      }
      case 'agent_thought_chunk': {
        const text = contentText(update['content']);
        if (text)
          this.emit({
            type: 'thinking',
            threadId: run.threadId,
            turnId: run.bridgeTurnId,
            data: { text },
          });
        return;
      }
      case 'tool_call':
      case 'tool_call_update':
        this.#onToolUpdate(run, update);
        return;
      case 'plan': {
        const steps = acpPlanSteps(update['entries']);
        if (steps.length > 0) this.#emitPlan(run, steps);
        return;
      }
      default:
        // current_mode_update / model_changed: ignore.
        return;
    }
  }

  /** Record an ACP `available_commands_update` payload for `agent/commands`. */
  #captureCommands(sessionId: string, raw: unknown): void {
    if (!Array.isArray(raw)) return;
    const cwd = this.#cwdBySession.get(sessionId);
    const commands = parseGrokCommands(raw, cwd);
    this.#commandsBySession.set(sessionId, commands);
    if (cwd !== undefined) this.#commandsByCwd.set(cwd, { at: Date.now(), commands });
  }

  /**
   * The commands Grok announces for a folder (`available_commands_update`,
   * {@link parseGrokCommands}): its built-ins and the skills it finds there,
   * invoked natively as `/name args` through `session/prompt`. Grok announces
   * them only for a session, so a folder no thread has opened yet gets a
   * short session of its own — `session/new`, no prompt, no tokens: the list
   * arrives about 2.5 s later — which is then closed. Reused per folder for a
   * minute; a thread's own session refreshes it.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const cached = this.#commandsByCwd.get(dir);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
    let rpc: NdjsonRpc;
    try {
      rpc = await this.#ensureAcp();
    } catch {
      return cached?.commands ?? [];
    }
    let sessionId = '';
    try {
      const res = await rpc.request<{ sessionId: string }>('session/new', {
        cwd: dir,
        mcpServers: [],
      });
      sessionId = res.sessionId;
      this.#cwdBySession.set(sessionId, dir);
      const deadline = Date.now() + COMMANDS_WAIT_MS;
      while (!this.#commandsBySession.has(sessionId) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, COMMANDS_POLL_MS));
      }
      const commands = this.#commandsBySession.get(sessionId);
      if (commands) this.#commandsByCwd.set(dir, { at: Date.now(), commands });
      return commands ?? cached?.commands ?? [];
    } catch {
      return cached?.commands ?? [];
    } finally {
      if (sessionId) {
        this.#cwdBySession.delete(sessionId);
        this.#commandsBySession.delete(sessionId);
        rpc.request('session/close', { sessionId }).catch(() => undefined);
      }
    }
  }

  /** Merge a tool_call / tool_call_update; emit a block once it terminates. */
  #onToolUpdate(run: ActiveRun, update: Record<string, unknown>): void {
    const id = str(update['toolCallId']);
    if (!id) return;
    const known = run.tools.get(id);
    const prev = known ?? { toolCallId: id, title: '', kind: '', status: '' };
    const merged: AcpToolCall = {
      toolCallId: id,
      title: str(update['title']) || prev.title,
      kind: acpToolKind(update) || prev.kind,
      status: str(update['status']) || prev.status,
      rawInput: isRecord(update['rawInput']) ? update['rawInput'] : prev.rawInput,
      content: Array.isArray(update['content']) ? (update['content'] as unknown[]) : prev.content,
    };
    run.tools.set(id, merged);
    const finished = merged.status === 'completed' || merged.status === 'failed';
    // Shown as it starts (its first announcement); its end replaces it in place.
    if (!known && !finished) {
      const started = acpToolStartBlock(merged);
      if (started) {
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.bridgeTurnId,
          data: { content: started },
        });
      }
    }
    if (finished && !run.emitted.has(id)) {
      run.emitted.add(id);
      const settled = acpToolBlock(merged);
      const content = settled ? withBlockId(settled, id) : null;
      if (content) {
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.bridgeTurnId,
          data: { content },
        });
      }
    }
  }

  #emitPlan(run: ActiveRun, steps: PlanStepBlock[]): void {
    this.emit({
      type: 'block',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: { content: planBlock(steps) },
    });
  }

  /** Handle a server-initiated request: permission prompts + (ignored) fs/*. */
  async #onServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'session/request_permission') {
      return this.#onRequestPermission(isRecord(params) ? params : {});
    }
    // fs/read_text_file / fs/write_text_file are never sent (we advertised
    // fs:false), so anything else is unexpected — fail safe.
    throw new RpcError(-32601, `grok: unhandled server request '${method}'`);
  }

  /** Route an ACP permission prompt to the bridge's approval round-trip. */
  async #onRequestPermission(p: Record<string, unknown>): Promise<unknown> {
    const run = this.#runBySession.get(str(p['sessionId']));
    const options = Array.isArray(p['options']) ? (p['options'] as Record<string, unknown>[]) : [];
    const toolCall = isRecord(p['toolCall']) ? p['toolCall'] : {};
    // A request for no turn of ours is refused: nothing the user set allows it.
    if (!run) return cancelledOutcome();
    // Non-interactive postures auto-answer without troubling the phone.
    if (run.posture === 'approveAll') {
      return selectOption(options, 'approve') ?? cancelledOutcome();
    }
    if (run.posture === 'approveSession') {
      return (
        selectOption(options, 'approveSession') ??
        selectOption(options, 'approve') ??
        cancelledOutcome()
      );
    }
    // Interactive, with no one to ask: refuse.
    if (!this.#onApprovalRequest) return selectOption(options, 'reject') ?? cancelledOutcome();
    // Interactive: ask the phone.
    let decision: ApprovalDecision = 'reject';
    try {
      decision = await this.#onApprovalRequest(run.threadId, {
        toolName: str(toolCall['title']) || str(toolCall['kind']) || 'tool',
        input: isRecord(toolCall['rawInput']) ? toolCall['rawInput'] : {},
      });
    } catch {
      decision = 'reject';
    }
    return selectOption(options, decision) ?? cancelledOutcome();
  }

  #completeTurn(run: ActiveRun, stopReason: string): void {
    if (run.finished) return;
    run.finished = true;
    this.#active.delete(run.bridgeTurnId);
    this.#runBySession.delete(run.sessionId);
    if (stopReason === 'refusal') {
      this.emit({
        type: 'turn_error',
        threadId: run.threadId,
        turnId: run.bridgeTurnId,
        data: { text: run.full || 'grok refused the request' },
      });
      return;
    }
    if (stopReason === 'cancelled') {
      this.emit({ type: 'turn_aborted', threadId: run.threadId, turnId: run.bridgeTurnId });
      return;
    }
    const contextWindow = this.#currentContextWindow();
    this.emit({
      type: 'turn_completed',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: {
        text: run.full,
        ...(run.tokens !== undefined
          ? {
              usage: {
                tokens: run.tokens,
                ...(contextWindow !== undefined ? { contextWindow } : {}),
              },
            }
          : {}),
      },
    });
  }

  /** The context window of the model this session runs on, when known.
   *
   * Grok reports it per model on the ACP handshake, so it is already in the
   * model cache; without it the phone can show a token count but no share of
   * the window. */
  #currentContextWindow(): number | undefined {
    const models = this.#modelsCache ?? [];
    const current = models.find((m) => m.isDefault) ?? models[0];
    return current?.contextWindow;
  }

  #finishError(run: ActiveRun, text: string): void {
    run.finished = true;
    this.#active.delete(run.bridgeTurnId);
    this.#runBySession.delete(run.sessionId);
    this.emit({
      type: 'turn_error',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: { text },
    });
  }

  #failTurn(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'turn_error', threadId, turnId, data: { text } });
  }
}

/**
 * Map Grok's ACP `modelState` (`{ currentModelId, availableModels }`, present on
 * both the `initialize` handshake and `session/new`) onto {@link AgentModel}[]:
 * carries each model's context window (`totalContextTokens`), a reasoning-effort
 * knob when the model supports it (`reasoningEfforts`), and flags the current
 * default. `preferred` (a config-pinned default) overrides Grok's own default.
 */
export function mapGrokModels(state: GrokModelState | undefined, preferred?: string): AgentModel[] {
  const available = Array.isArray(state?.availableModels) ? state!.availableModels! : [];
  const current = str(state?.currentModelId);
  const out: AgentModel[] = [];
  for (const raw of available) {
    const id = str(raw?.modelId);
    if (!id) continue;
    const displayName = str(raw?.name) || id;
    const description = str(raw?.description);
    const ctx = num(raw?._meta?.totalContextTokens);
    const isDefault = preferred ? id === preferred : id === current;
    const options = raw?._meta?.supportsReasoningEffort
      ? effortOption(raw._meta.reasoningEfforts)
      : undefined;
    out.push({
      id,
      displayName,
      ...(description ? { description } : {}),
      ...(ctx > 0 ? { contextWindow: ctx } : {}),
      ...(isDefault ? { isDefault: true } : {}),
      ...(options ? { options: [options] } : {}),
    });
  }
  return out;
}

/**
 * Build the reasoning-effort knob from Grok's `reasoningEfforts`
 * (`[{ id, value, label, default }]`). Returns undefined when none parse, so a
 * model with no effort levels advertises no knob.
 */
function effortOption(raw: unknown): ReturnType<typeof reasoningOption> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const values: AgentModelOptionValue[] = [];
  let defaultValue: string | undefined;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const value = str(entry['value']) || str(entry['id']);
    if (!value) continue;
    const label = str(entry['label']) || value;
    values.push({ value, label });
    if (entry['default'] === true) defaultValue = value;
  }
  if (values.length === 0) return undefined;
  return reasoningOption(values, defaultValue);
}

/** Map the thread's access mode to how this run answers permission prompts. */
function postureFor(accessMode: SendTurnOptions['accessMode']): PermissionPosture {
  switch (accessMode) {
    case 'approveForMe':
      return 'approveAll';
    case 'fullAccess':
      return 'approveSession';
    case 'requestApproval':
      return 'interactive';
    default:
      return 'interactive';
  }
}

/**
 * Pick the ACP permission option matching a decision, by option `kind`:
 * approve→allow_once, approveSession→allow_always, reject→reject_once. Returns
 * the `{ outcome: { outcome:'selected', optionId } }` reply, or undefined when no
 * matching option was offered.
 */
function selectOption(
  options: Record<string, unknown>[],
  decision: ApprovalDecision,
): { outcome: { outcome: string; optionId: string } } | undefined {
  const wanted =
    decision === 'approveSession'
      ? ['allow_always', 'allow_once']
      : decision === 'reject'
        ? ['reject_once', 'reject_always']
        : ['allow_once', 'allow_always'];
  for (const kind of wanted) {
    const match = options.find((o) => str(o['kind']) === kind && str(o['optionId']));
    if (match) return { outcome: { outcome: 'selected', optionId: str(match['optionId']) } };
  }
  return undefined;
}

function cancelledOutcome(): { outcome: { outcome: string } } {
  return { outcome: { outcome: 'cancelled' } };
}

/** Extract the text of an ACP `ContentBlock` (only `text` blocks carry text). */
function contentText(content: unknown): string {
  if (!isRecord(content)) return '';
  return str(content['type']) === 'text' ? str(content['text']) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Best human-facing text for a failed ACP request. For an {@link RpcError} the
 * generic JSON-RPC `message` is often unhelpful ("Internal error"); Grok carries
 * the real reason (e.g. a 402 `API error … Grok Build usage balance exhausted`) in
 * the error's `data.message`, so we surface that when present. This is what the
 * phone shows on the errored turn, so the user learns *why* the turn failed.
 */
function errorMessage(err: unknown): string {
  if (err instanceof RpcError) {
    const data = err.data;
    if (isRecord(data) && typeof data['message'] === 'string' && data['message'].length > 0) {
      return data['message'];
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
