/**
 * Zero adapter (real agent) — driven over the **Agent Client Protocol (ACP)**.
 *
 * Zero (https://github.com/Gitlawb/zero) is an open-source Go coding agent. It
 * exposes an editor-backend mode, `zero acp`, that speaks JSON-RPC 2.0 over
 * newline-delimited stdio — the same framing as `codex app-server`, so we reuse
 * that transport (`NdjsonRpc`). The bridge plays the ACP *client* (the role an
 * editor like Zed plays): it drives Zero and answers Zero's permission prompts.
 *
 * ## Why ACP (vs `zero exec`)
 * `zero exec --output-format stream-json` is one-directional and has no
 * interactive permission responder. `zero acp` is two-way: Zero sends
 * `session/request_permission` and the client replies, so the bridge can gate a
 * tool through the phone's approval card (like Codex/OpenCode).
 *
 * ## Protocol (verified against zero `internal/acp` + a live handshake)
 *  - `initialize` → `{ agentCapabilities, authMethods:[] }` (no auth; keys live
 *    in Zero's own config/env).
 *  - `session/new { cwd, mcpServers:[] }` → `{ sessionId, modes }`. We advertise
 *    `fs:{readTextFile:false,writeTextFile:false}` so Zero does its own local file
 *    I/O and never asks the client for `fs/*`.
 *  - `session/set_mode { modeId }` — `ask` (gate every state-changing tool) vs
 *    `auto` (safe tools auto, ask before risky) ← the thread's access mode.
 *  - `_zero/set_model { model }` — pick the model for the session.
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
 * ACP carries no token usage, so `reportsContextUsage` is false (FOR-DEV: read it
 * from `zero usage` / the on-disk session store).
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
  ApprovalDecision,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
// The generic NDJSON JSON-RPC 2.0 transport (also used by the Codex app-server).
import { CodexAppServerRpc as NdjsonRpc, RpcError } from './codex-app-server.js';
import { planBlock, type PlanStepBlock } from './content-blocks.js';
import { zeroToolBlock, zeroPlanSteps, type ZeroToolCall } from './zero-tools.js';

const ZERO_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  // ACP `session/request_permission` gives real per-action approvals.
  approvals: true,
  forking: true,
  images: true,
  // ACP carries no per-turn token usage (FOR-DEV: read from `zero usage`).
  reportsContextUsage: false,
  // ACP advertises slash commands via `available_commands_update` (captured below).
  commands: true,
};

/** Zero's ACP session modes (from `session/new`'s `availableModes`). */
type ZeroMode = 'ask' | 'auto';

/** How a run should answer Zero's permission prompts. */
type PermissionPosture = 'interactive' | 'approveAll' | 'approveSession';

export interface ZeroAdapterOptions {
  /** Resolved `zero` executable path (see resolve-zero.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[zero.js]` when run via node). */
  prependArgs?: string[];
  /** Default model (`provider/model` or bare id) when the turn doesn't pick one. */
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
  /** Injected `zero acp` spawner (tests). */
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
  tools: Map<string, ZeroToolCall>;
  /** Tool ids already emitted as a block. */
  emitted: Set<string>;
  /** How this run answers permission prompts (from the thread's access mode). */
  posture: PermissionPosture;
  finished: boolean;
}

function defaultSpawnAcp(binaryPath: string, prependArgs: string[], cwd: string): () => SpawnedAcp {
  return () => {
    const child = spawn(binaryPath, [...prependArgs, 'acp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    if (!child.stdout || !child.stdin) throw new Error('zero acp: failed to acquire stdio');
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      onClose: (cb) => child.on('close', cb),
      kill: () => child.kill(),
    };
  };
}

export class ZeroAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'zero';
  readonly capabilities = ZERO_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #onApprovalRequest: ZeroAdapterOptions['onApprovalRequest'];
  readonly #spawnAcp: () => SpawnedAcp;
  /** threadId → ACP sessionId, for continuity + history fallback. */
  readonly #sessionByThread = new Map<string, string>();
  /** sessionId → in-flight run, to route session-scoped updates/permissions. */
  readonly #runBySession = new Map<string, ActiveRun>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** sessionId → last mode we set (avoid redundant set_mode). */
  /** Slash commands from the latest ACP `available_commands_update` (see listCommands). */
  #commands: AgentCommand[] = [];
  readonly #modeBySession = new Map<string, ZeroMode>();
  /** sessionId → last model we set. */
  readonly #modelBySession = new Map<string, string>();
  /** Discovered model list, cached for the process lifetime (probing is costly). */
  #modelsCache: AgentModel[] | null = null;
  #rpc: NdjsonRpc | null = null;
  #init: Promise<NdjsonRpc> | null = null;
  #defaultCwd = process.cwd();

  /** Native Zero session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: ZeroAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'zero';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#onApprovalRequest = options.onApprovalRequest;
    this.#spawnAcp =
      options.spawnAcp ?? defaultSpawnAcp(this.#binaryPath, this.#prependArgs, this.#defaultCwd);
  }

  /**
   * List the models THIS install can actually use, for `agent/models`. Zero's
   * built-in `zero models list` is only a small hard-coded registry; the real,
   * per-user set comes from the user's configured providers — so we enumerate
   * them (`zero providers list --json`) and probe each one's live model endpoint
   * (`zero providers models <name> --json`, e.g. an OpenAI-compatible
   * `/v1/models`), falling back to a provider's single configured `model` when its
   * endpoint doesn't list (a custom gateway). This adapts to whatever each
   * self-hosted install has set up. Cached (probing is several network calls).
   */
  async listModels(): Promise<AgentModel[]> {
    if (this.#modelsCache) return this.#modelsCache;
    const res = await this.#json<{ providers?: ZeroProvider[] }>(['providers', 'list', '--json']);
    const providers = res?.providers ?? [];
    if (providers.length === 0) {
      this.#modelsCache = await this.#registryFallback();
      return this.#modelsCache;
    }
    // Probe each usable provider's live model list in parallel.
    const probes: Record<string, string[]> = {};
    await Promise.all(
      providers.map(async (p) => {
        if (!p.apiKeySet || (p.status !== undefined && p.status !== 'ok')) return;
        const probe = await this.#json<{ models?: { id?: string }[] }>([
          'providers',
          'models',
          p.name,
          '--json',
        ]);
        const ids = (probe?.models ?? [])
          .map((m) => (typeof m.id === 'string' ? m.id : ''))
          .filter((id) => id.length > 0);
        if (ids.length > 0) probes[p.name] = ids;
      }),
    );
    const models = mergeZeroProviderModels(providers, probes, this.#defaultModel);
    this.#modelsCache = models.length > 0 ? models : await this.#registryFallback();
    return this.#modelsCache;
  }

  /** Fallback model list from Zero's built-in registry (`zero models list`). */
  #registryFallback(): Promise<AgentModel[]> {
    const def = this.#defaultModel;
    return new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawn(this.#binaryPath, [...this.#prependArgs, 'models', 'list'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        resolve([]);
        return;
      }
      child.stdout.on('data', (c: Buffer) => (out += c.toString('utf-8')));
      child.on('error', () => resolve([]));
      child.on('close', () =>
        resolve(parseZeroModels(out).map((m) => ({ ...m, isDefault: def === m.id }))),
      );
    });
  }

  /** Spawn `zero <args>` and parse its stdout as JSON (null on any failure). */
  #json<T>(args: string[]): Promise<T | null> {
    return new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawn(this.#binaryPath, [...this.#prependArgs, ...args], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        resolve(null);
        return;
      }
      child.stdout.on('data', (c: Buffer) => (out += c.toString('utf-8')));
      child.on('error', () => resolve(null));
      child.on('close', () => {
        const trimmed = out.trim();
        if (!trimmed) return resolve(null);
        try {
          resolve(JSON.parse(trimmed) as T);
        } catch {
          resolve(null);
        }
      });
    });
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
      return this.#failTurn(threadId, turnId, `failed to start zero acp: ${errorMessage(err)}`);
    }

    // Resolve the ACP session for this thread (new, or load a persisted one).
    let sessionId: string;
    try {
      sessionId = await this.#ensureSession(rpc, threadId, cwd);
    } catch (err) {
      return this.#failTurn(threadId, turnId, `zero session failed: ${errorMessage(err)}`);
    }

    const posture = postureFor(options.accessMode);
    await this.#applyMode(rpc, sessionId, posture);
    if (model) await this.#applyModel(rpc, sessionId, model);

    const run: ActiveRun = {
      bridgeTurnId: turnId,
      threadId,
      sessionId,
      full: '',
      tools: new Map(),
      emitted: new Set(),
      posture,
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
        if (!run.finished) this.#finishError(run, `zero prompt failed: ${errorMessage(err)}`);
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

  /** Lazy ACP lifecycle: spawn `zero acp` → initialize → return the RPC client. */
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
        await rpc.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: 'uxnan-bridge', version: '1.0.0' },
        });
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
      // The same acp process still holds it (common case); a restarted process
      // needs session/load to re-attach. Try load; fall through to new on failure.
      try {
        await rpc.request('session/load', { sessionId: known, cwd, mcpServers: [] });
        return known;
      } catch {
        this.#sessionByThread.delete(threadId);
        this.#modeBySession.delete(known);
        this.#modelBySession.delete(known);
      }
    }
    const res = await rpc.request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] });
    this.#sessionByThread.set(threadId, res.sessionId);
    return res.sessionId;
  }

  /** Set the session's permission mode from the run's posture (once per change). */
  async #applyMode(rpc: NdjsonRpc, sessionId: string, posture: PermissionPosture): Promise<void> {
    const mode: ZeroMode = posture === 'interactive' ? 'ask' : 'auto';
    if (this.#modeBySession.get(sessionId) === mode) return;
    try {
      await rpc.request('session/set_mode', { sessionId, modeId: mode });
      this.#modeBySession.set(sessionId, mode);
    } catch {
      /* best-effort; a failed mode set falls back to Zero's current mode */
    }
  }

  /** Point the session at a model (best-effort; an unknown model keeps Zero's). */
  async #applyModel(rpc: NdjsonRpc, sessionId: string, model: string): Promise<void> {
    if (this.#modelBySession.get(sessionId) === model) return;
    try {
      await rpc.request('_zero/set_model', { sessionId, model });
      this.#modelBySession.set(sessionId, model);
    } catch {
      /* model unknown to Zero → keep its active model */
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
        data: { text: 'zero acp process exited unexpectedly' },
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
        const steps = zeroPlanSteps(update['entries']);
        if (steps.length > 0) this.#emitPlan(run, steps);
        return;
      }
      default:
        // current_mode_update / user_message_chunk: ignore.
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
   * Slash commands Zero advertised over ACP (`available_commands_update`),
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
    const merged: ZeroToolCall = {
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
        data: { content: zeroToolBlock(merged) },
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
    throw new RpcError(-32601, `zero: unhandled server request '${method}'`);
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
        data: { text: run.full || 'zero refused the request' },
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

/** A configured Zero provider (from `zero providers list --json`). */
export interface ZeroProvider {
  name: string;
  active?: boolean;
  apiKeySet?: boolean;
  status?: string;
  /** The provider's single configured model (fallback when it can't be probed). */
  model?: string;
}

/**
 * Merge configured providers + their live-probed model ids into a deduped
 * {@link AgentModel}[]. `probes[name]` is a provider's live model-id list (absent
 * → fall back to that provider's configured `model`, e.g. a gateway that doesn't
 * expose `/v1/models`). Each model's `description` names the provider(s) serving
 * it; the configured default (or the active provider's model) is flagged default.
 */
export function mergeZeroProviderModels(
  providers: ZeroProvider[],
  probes: Record<string, string[]>,
  defaultModel?: string,
): AgentModel[] {
  const byId = new Map<string, Set<string>>();
  const add = (id: string, provider: string): void => {
    if (!id) return;
    const set = byId.get(id) ?? new Set<string>();
    set.add(provider);
    byId.set(id, set);
  };
  for (const p of providers) {
    const live = probes[p.name];
    if (live && live.length > 0) for (const id of live) add(id, p.name);
    else if (p.model) add(p.model, p.name);
  }
  const active = providers.find((p) => p.active)?.model;
  const preferred = defaultModel ?? active;
  const out: AgentModel[] = [];
  for (const [id, set] of byId) {
    const description = [...set].join(', ');
    out.push({
      id,
      displayName: id,
      ...(description ? { description } : {}),
      ...(id === preferred ? { isDefault: true } : {}),
    });
  }
  return out;
}

/**
 * Parse `zero models list` output into {@link AgentModel}s. Each line is
 * `  <id> [<provider>] ctx=<N> out=<N> - <Display Name>` (the `Models` header and
 * blank lines are skipped). `ctx` becomes the model's context window.
 */
export function parseZeroModels(stdout: string): AgentModel[] {
  const out: AgentModel[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const match = raw.match(/^\s*(\S+)\s+\[[^\]]+\]\s+ctx=(\d+)\s+out=\d+\s+-\s+(.+?)\s*$/);
    if (!match) continue;
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const ctx = Number(match[2]);
    const displayName = (match[3] ?? '').trim() || id;
    out.push({ id, displayName, ...(ctx > 0 ? { contextWindow: ctx } : {}) });
  }
  return out;
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

/**
 * Best human-facing text for a failed ACP request. For an {@link RpcError} the
 * generic JSON-RPC `message` is often unhelpful ("Internal error"); the real
 * reason (an API/quota/auth error) is usually in the error's `data.message`, so we
 * surface that when present. This is what the phone shows on the errored turn.
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
