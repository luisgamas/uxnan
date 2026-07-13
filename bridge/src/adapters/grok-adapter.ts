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
 *  - `session/set_mode { sessionId, modeId }` — Grok exposes reasoning effort as
 *    its ACP "modes" (`high`/`medium`/`low`, `category:'mode'` in its session
 *    config), so we route the chosen reasoning effort here.
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
 * The ACP envelope + handshake + model discovery were exercised live. The per-turn
 * streaming shapes (`tool_call`/`plan`/`session/request_permission`) follow the ACP
 * spec but could NOT be exercised end-to-end because the test account's Grok Build
 * balance was exhausted (HTTP 402). Whether Grok reports per-turn token usage and
 * whether `session/set_mode` actually applies the reasoning effort are likewise
 * unverified — see bridge/FOR-DEV.md.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md.
 */
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOptionValue,
  ApprovalDecision,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
// The generic NDJSON JSON-RPC 2.0 transport (also used by the Codex app-server).
import { CodexAppServerRpc as NdjsonRpc, RpcError } from './codex-app-server.js';
import { planBlock, type PlanStepBlock } from './content-blocks.js';
import { reasoningOption, reasoningValue } from './run-options.js';
import { grokToolBlock, grokPlanSteps, type GrokToolCall } from './grok-tools.js';

const GROK_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  // ACP `session/request_permission` gives real per-action approvals.
  approvals: true,
  // `agentCapabilities.loadSession` + `session/load` → resume across turns.
  forking: true,
  // Grok's ACP `promptCapabilities.image` is false — no image inputs.
  images: false,
  // ACP `session/prompt` returns only `{ stopReason }`; no per-turn token usage
  // was observed (FOR-DEV: verify once a Grok turn can run — balance-blocked).
  reportsContextUsage: false,
  // ACP advertises slash commands via `available_commands_update` (captured below).
  commands: true,
};

/** How a run should answer Grok's permission prompts. */
type PermissionPosture = 'interactive' | 'approveAll' | 'approveSession';

export interface GrokAdapterOptions {
  /** Resolved `grok` executable path (see resolve-grok.ts). */
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
  tools: Map<string, GrokToolCall>;
  /** Tool ids already emitted as a block. */
  emitted: Set<string>;
  /** How this run answers permission prompts (from the thread's access mode). */
  posture: PermissionPosture;
  finished: boolean;
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
    const child = spawn(binaryPath, [...prependArgs, 'agent', 'stdio'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    if (!child.stdout || !child.stdin) throw new Error('grok agent stdio: failed to acquire stdio');
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      onClose: (cb) => child.on('close', cb),
      kill: () => child.kill(),
    };
  };
}

export class GrokAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'grok';
  readonly capabilities = GROK_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #onApprovalRequest: GrokAdapterOptions['onApprovalRequest'];
  readonly #spawnAcp: () => SpawnedAcp;
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
  /** Slash commands from the latest ACP `available_commands_update` (see listCommands). */
  #commands: AgentCommand[] = [];
  /** Model list, captured from the `initialize` handshake (cached for the process). */
  #modelsCache: AgentModel[] | null = null;
  #rpc: NdjsonRpc | null = null;
  #init: Promise<NdjsonRpc> | null = null;
  #defaultCwd = process.cwd();

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
      sessionId = await this.#ensureSession(rpc, threadId, cwd);
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
  async #ensureSession(rpc: NdjsonRpc, threadId: string, cwd: string): Promise<string> {
    const known = this.#sessionByThread.get(threadId);
    if (known) {
      // The same process still holds it (common case); a restarted process needs
      // session/load to re-attach. Try load; fall through to new on failure.
      try {
        await rpc.request('session/load', { sessionId: known, cwd, mcpServers: [] });
        return known;
      } catch {
        this.#sessionByThread.delete(threadId);
        this.#modelBySession.delete(known);
        this.#effortBySession.delete(known);
      }
    }
    const res = await rpc.request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] });
    this.#sessionByThread.set(threadId, res.sessionId);
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
   * Set the session's reasoning effort (best-effort). Grok surfaces effort as its
   * ACP "modes" (`high`/`medium`/`low`), so we route it through `session/set_mode`.
   * FOR-DEV: confirm the effort actually takes effect on a real turn (balance-blocked).
   */
  async #applyEffort(rpc: NdjsonRpc, sessionId: string, effort: string): Promise<void> {
    if (this.#effortBySession.get(sessionId) === effort) return;
    try {
      await rpc.request('session/set_mode', { sessionId, modeId: effort });
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
    if (method !== 'session/update') return;
    const p = isRecord(params) ? params : {};
    const update = isRecord(p['update']) ? p['update'] : {};
    // Slash-command availability is session-scoped and can arrive before any
    // turn — capture it regardless of an active run (see listCommands).
    if (str(update['sessionUpdate']) === 'available_commands_update') {
      this.#captureCommands(update['availableCommands'] ?? update['available_commands']);
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
        const steps = grokPlanSteps(update['entries']);
        if (steps.length > 0) this.#emitPlan(run, steps);
        return;
      }
      default:
        // current_mode_update / model_changed: ignore.
        return;
    }
  }

  /** Record an ACP `available_commands_update` payload for `agent/commands`. */
  #captureCommands(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    const commands: AgentCommand[] = [];
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const name = str(item['name']);
      if (!name) continue;
      const description = str(item['description']);
      commands.push({
        name,
        source: 'acp',
        headlessSupported: true,
        ...(description ? { description } : {}),
      });
    }
    this.#commands = commands;
  }

  /**
   * Slash commands Grok advertised over ACP (`available_commands_update`),
   * invoked natively through `session/prompt`. Empty until a session is
   * established and the agent has advertised its commands.
   */
  listCommands(): Promise<AgentCommand[]> {
    return Promise.resolve(this.#commands.map((c) => ({ ...c })));
  }

  /** Merge a tool_call / tool_call_update; emit a block once it terminates. */
  #onToolUpdate(run: ActiveRun, update: Record<string, unknown>): void {
    const id = str(update['toolCallId']);
    if (!id) return;
    const prev = run.tools.get(id) ?? { toolCallId: id, title: '', kind: '', status: '' };
    const merged: GrokToolCall = {
      toolCallId: id,
      title: str(update['title']) || prev.title,
      kind: str(update['kind']) || prev.kind,
      status: str(update['status']) || prev.status,
      rawInput: isRecord(update['rawInput']) ? update['rawInput'] : prev.rawInput,
      content: Array.isArray(update['content']) ? (update['content'] as unknown[]) : prev.content,
    };
    run.tools.set(id, merged);
    if ((merged.status === 'completed' || merged.status === 'failed') && !run.emitted.has(id)) {
      run.emitted.add(id);
      this.emit({
        type: 'block',
        threadId: run.threadId,
        turnId: run.bridgeTurnId,
        data: { content: grokToolBlock(merged) },
      });
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
    // Non-interactive postures auto-answer without troubling the phone.
    if (!run || !this.#onApprovalRequest || run.posture === 'approveAll') {
      return selectOption(options, 'approve') ?? cancelledOutcome();
    }
    if (run.posture === 'approveSession') {
      return (
        selectOption(options, 'approveSession') ??
        selectOption(options, 'approve') ??
        cancelledOutcome()
      );
    }
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
    this.emit({
      type: 'turn_completed',
      threadId: run.threadId,
      turnId: run.bridgeTurnId,
      data: { text: run.full },
    });
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
