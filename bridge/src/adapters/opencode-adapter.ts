/**
 * OpenCode adapter (MVP-priority real agent) — `opencode serve` HTTP/SSE protocol.
 *
 * ## Why a server (refactor of the old `opencode run --format json` adapter)
 *
 * `opencode run` is one-shot and non-interactive: it runs tools autonomously and
 * only emits tool events *after* the tool ran, so the bridge could never gate a
 * sensitive action — approvals were impossible (capability was `approvals:false`)
 * and plan/to-do arrived as a doubly-emitted `todowrite` we had to de-dupe by hand.
 *
 * `opencode serve` starts a long-lived local HTTP server whose `/event` SSE bus
 * surfaces `permission.asked` elicitations the bridge routes to the phone's
 * approval card (the same flow Codex's `app-server` uses), plus native
 * `todo.updated` (plan mode), `session.idle` (turn end) and per-step token usage.
 * See `opencode-server.ts` for the HTTP/SSE client and `codex-adapter.ts` for the
 * sibling server-based adapter this mirrors.
 *
 * ## Process model
 *
 * One `opencode serve` process **per working directory** (a turn's cwd is
 * per-project), spawned lazily on first use, bound to loopback. Sessions live
 * inside the server AND persist to OpenCode's on-disk project store, so the
 * bridge reuses each thread's `ses_…` id (`--session` continuity) across turns
 * and even across a server restart (`nativeSessionId` also feeds the on-disk
 * `turn/list` history fallback). Approvals are routed through the bridge's shared
 * `requestApproval` round-trip via the injected `onApprovalRequest` callback.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md (validating adapters).
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  ApprovalDecision,
  QuestionItem,
  QuestionOption,
  SendTurnOptions,
} from '@uxnan/shared';
import { expandCustomCommand, scanCustomCommands, type CustomCommandSource } from './command-scan.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { mergePlanSteps, opencodeToolBlock } from './opencode-tools.js';
import { extractPlanSteps, planBlock, type PlanStepBlock } from './content-blocks.js';
import { reasoningValue } from './run-options.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';
import {
  OpenCodeServer,
  type IOpenCodeServer,
  type OpenCodePermissionRule,
  type OpenCodeServerEvent,
  type PermissionReply,
} from './opencode-server.js';

// Re-exported for backwards-compatible imports (these types now live in spawn.ts).
export type { SpawnFn, SpawnedProcess } from './spawn.js';

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  // `opencode serve` surfaces `permission.asked` before a gated tool runs, so
  // the bridge can request the user's approval (unlike the old one-shot `run`).
  approvals: true,
  forking: true,
  images: true,
  // OpenCode reports per-step token counts (`step-finish.tokens` / the assistant
  // message `tokens`), surfaced as `usage.tokens` so the phone shows context use.
  reportsContextUsage: true,
  commands: true,
};

/**
 * Permission keys with a real side effect that we gate behind an approval when
 * the thread wants interactive approvals. Read-only keys (`read`/`glob`/`grep`/
 * `list`/`lsp`) and the plan tool (`todowrite`) are left to run freely so plan
 * mode and inspection don't spam the phone with approval cards.
 */
const GATED_PERMISSIONS = ['edit', 'bash', 'webfetch', 'external_directory'] as const;

/**
 * Context-occupying token count from an OpenCode `tokens` object. The real shape
 * (verified against opencode 1.x) is `{ total, input, output, reasoning, cache: {
 * read, write } }` where `total === input + output + reasoning`. Prefer the
 * reported `total`; fall back to summing the distinct buckets (cache read/write
 * are subsets of `input`, so not added), then to any top-level numeric field.
 * Returns undefined when there is nothing to report.
 */
export function openCodeUsageTokens(tokens: unknown): number | undefined {
  if (!isRecord(tokens)) return undefined;
  const num = (key: string): number =>
    typeof tokens[key] === 'number' ? (tokens[key] as number) : 0;
  if (num('total') > 0) return num('total');
  const known = num('input') + num('output') + num('reasoning');
  if (known > 0) return known;
  let sum = 0;
  for (const value of Object.values(tokens)) {
    if (typeof value === 'number') sum += value;
  }
  return sum > 0 ? sum : undefined;
}

/**
 * Split a `provider/model` id (e.g. `opencode/deepseek-v4-flash-free`) into the
 * `{ providerID, modelID }` the server prompt body expects. The provider is the
 * segment before the first `/`; the model id keeps any remaining slashes (some
 * gateway model ids contain them). Returns undefined for a bare id (no `/`), so
 * the server falls back to its default model.
 */
export function splitOpenCodeModel(
  id: string,
): { providerID: string; modelID: string } | undefined {
  const slash = id.indexOf('/');
  if (slash <= 0 || slash >= id.length - 1) return undefined;
  return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
}

/** Map the user's approval decision onto OpenCode's `once|always|reject` reply. */
export function decisionToPermissionReply(decision: ApprovalDecision): PermissionReply {
  if (decision === 'approveSession') return 'always';
  if (decision === 'reject') return 'reject';
  return 'once';
}

export interface OpenCodeAdapterOptions {
  /** Executable to spawn (resolved exe path; see resolve-opencode.ts). */
  binaryPath?: string;
  /** Default model (`provider/model`) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Injected spawn function for the short-lived `opencode models` calls (tests). */
  spawnFn?: SpawnFn;
  /**
   * Callback that surfaces an OpenCode `permission.asked` to the bridge so the
   * phone can decide. Returns the user's {@link ApprovalDecision} (or `reject`
   * after the bridge's approval timeout). Wired by the bridge during adapter
   * registration; absent in unit tests (a missing callback fail-safes to reject).
   */
  onApprovalRequest?: (
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ) => Promise<ApprovalDecision>;
  /**
   * Callback that surfaces an OpenCode `question.asked` (the agent's `question`
   * tool) to the bridge so the phone can answer it. Returns the chosen answers —
   * one array of option labels per question (or `[]` to skip, which the adapter
   * turns into a reject so the turn unblocks). Absent → the adapter rejects the
   * question outright (no hang).
   */
  onQuestionRequest?: (threadId: string, questions: QuestionItem[]) => Promise<string[][]>;
  /**
   * Injected server factory (tests). Given a cwd, returns an {@link IOpenCodeServer}.
   * The default spawns a real `opencode serve` for that cwd.
   */
  serverFactory?: (cwd: string) => IOpenCodeServer;
}

/** An in-flight turn's mutable per-run state, keyed by the OpenCode session id. */
interface ActiveRun {
  threadId: string;
  turnId: string;
  sessionId: string;
  cwd: string;
  model?: string;
  /** Accumulated assistant text (from streamed deltas), for `turn_completed`. */
  full: string;
  /** Per-part text accumulator (reconciles delta vs whole-part updates). */
  partTexts: Map<string, string>;
  /** Per-part reasoning accumulator. */
  reasoningTexts: Map<string, string>;
  /**
   * messageID → role, learned from `message.updated`. Parts inherit their
   * message's role, so this filters out the *user* message's echoed text part
   * (which streams before the assistant's) — only assistant text/reasoning is
   * surfaced.
   */
  roleByMessage: Map<string, string>;
  /**
   * partID → part type, learned from `message.part.updated`. Deltas carry only
   * `field: "text"` (the `.text` field) for BOTH text and reasoning parts, so the
   * part's type is the only reliable way to route a delta to text vs thinking.
   * OpenCode announces each part (`part.updated`) before streaming its deltas.
   */
  partTypes: Map<string, string>;
  /** Tool part ids already emitted as a block (emit once at terminal status). */
  emittedTools: Set<string>;
  /** Accumulated plan steps from `todo.updated`, merged into one card at idle. */
  planSteps: PlanStepBlock[];
  /** Latest reported context-occupying token count. */
  tokens?: number;
  /** True once completed/errored/aborted, so a late `session.idle` is ignored. */
  finished: boolean;
}

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'opencode';
  readonly capabilities = OPENCODE_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #defaultModel: string | undefined;
  readonly #spawn: SpawnFn;
  readonly #onApprovalRequest: OpenCodeAdapterOptions['onApprovalRequest'];
  readonly #onQuestionRequest: OpenCodeAdapterOptions['onQuestionRequest'];
  readonly #serverFactory: (cwd: string) => IOpenCodeServer;
  /** cwd → the `opencode serve` process serving that project directory. */
  readonly #serverByCwd = new Map<string, IOpenCodeServer>();
  /** threadId → OpenCode session id, for `--session` continuity + history fallback. */
  readonly #sessionByThread = new Map<string, string>();
  /** OpenCode session id → in-flight run, to route session-scoped SSE events. */
  readonly #runBySession = new Map<string, ActiveRun>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** model id → context-window tokens, from `opencode models --verbose`. */
  readonly #contextWindowByModel = new Map<string, number>();
  #windowsLoaded = false;
  #defaultCwd = process.cwd();
  /** When set (`UXNAN_OPENCODE_DEBUG=1`), log the turn/event flow to stderr. */
  readonly #debug: boolean;

  /** Native OpenCode session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: OpenCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'opencode';
    this.#defaultModel = options.defaultModel;
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#onApprovalRequest = options.onApprovalRequest;
    this.#onQuestionRequest = options.onQuestionRequest;
    this.#serverFactory =
      options.serverFactory ?? ((cwd) => new OpenCodeServer(this.#binaryPath, cwd));
    const flag = process.env['UXNAN_OPENCODE_DEBUG'];
    this.#debug = flag === '1' || flag === 'true';
  }

  /** Emit a diagnostic line to stderr when `UXNAN_OPENCODE_DEBUG` is set. */
  #log(message: string): void {
    if (this.#debug) process.stderr.write(`[opencode] ${message}\n`);
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    // Warm the per-model context-window cache so the first turn can already emit
    // usage.contextWindow (→ a percentage on the phone). The serve process is
    // spawned lazily on the first turn (like Codex's app-server).
    void this.loadContextWindows();
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const run of this.#active.values()) run.finished = true;
    this.#active.clear();
    this.#runBySession.clear();
    for (const server of this.#serverByCwd.values()) {
      try {
        await server.close();
      } catch {
        /* best-effort */
      }
    }
    this.#serverByCwd.clear();
  }

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const variant = reasoningValue(options);
    // Warm the context-window cache (once) so this/next turn can emit a window.
    void this.loadContextWindows();

    let server: IOpenCodeServer;
    try {
      server = await this.#ensureServer(cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to start opencode serve: ${errorMessage(err)}` },
      });
      return;
    }

    let sessionId = this.#sessionByThread.get(threadId);
    if (!sessionId) {
      try {
        sessionId = await server.createSession({
          title: threadId,
          permission: this.#rulesetFor(options.accessMode),
        });
        this.#sessionByThread.set(threadId, sessionId);
      } catch (err) {
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `opencode session create failed: ${errorMessage(err)}` },
        });
        return;
      }
    }

    // Defensive: if a prior run for this session never reached `session.idle`
    // (e.g. it lost its events to a startup race), retire it so a stale entry
    // can't linger in `#active`; the new turn supersedes it on this session.
    const stale = this.#runBySession.get(sessionId);
    if (stale && !stale.finished) {
      stale.finished = true;
      this.#active.delete(stale.turnId);
    }

    const run: ActiveRun = {
      threadId,
      turnId,
      sessionId,
      cwd,
      ...(typeof model === 'string' ? { model } : {}),
      full: '',
      partTexts: new Map(),
      reasoningTexts: new Map(),
      roleByMessage: new Map(),
      partTypes: new Map(),
      emittedTools: new Set(),
      planSteps: [],
      finished: false,
    };
    this.#active.set(turnId, run);
    this.#runBySession.set(sessionId, run);
    this.emit({ type: 'turn_started', threadId, turnId });
    this.#log(
      `turn ${turnId} session=${sessionId} model=${model ?? '(default)'} ` +
        `accessMode=${options.accessMode ?? '(default)'} hasApprovalCb=${!!this.#onApprovalRequest}`,
    );

    try {
      await server.promptAsync(sessionId, {
        ...(model ? { model: splitOpenCodeModel(model) } : {}),
        ...(variant ? { variant } : {}),
        text,
      });
      this.#log(`turn ${turnId} prompt accepted`);
    } catch (err) {
      this.#active.delete(turnId);
      this.#runBySession.delete(sessionId);
      run.finished = true;
      // Drop the stored session so the next turn recreates it (it may be stale
      // if a restarted server no longer knows this id).
      this.#sessionByThread.delete(threadId);
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `opencode prompt failed: ${errorMessage(err)}` },
      });
    }
  }

  async cancelTurn(threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (!run) return;
    run.finished = true;
    this.#active.delete(turnId);
    this.#runBySession.delete(run.sessionId);
    const server = this.#serverByCwd.get(run.cwd);
    if (server) {
      try {
        await server.abort(run.sessionId);
      } catch {
        /* process may have died — the close handler surfaces it */
      }
    }
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }

  /** Build the permission ruleset for a session from the thread's access mode. */
  #rulesetFor(accessMode: SendTurnOptions['accessMode']): OpenCodePermissionRule[] {
    // `approveForMe`/`fullAccess` allow gated tools without prompting; everything
    // else (incl. the default and explicit `requestApproval`) asks — surfacing an
    // approval card is the whole point of the serve refactor.
    const action: OpenCodePermissionRule['action'] =
      accessMode === 'approveForMe' || accessMode === 'fullAccess' ? 'allow' : 'ask';
    return GATED_PERMISSIONS.map((permission) => ({ permission, pattern: '**', action }));
  }

  /** Get (or lazily spawn) the `opencode serve` process for a cwd. */
  async #ensureServer(cwd: string): Promise<IOpenCodeServer> {
    let server = this.#serverByCwd.get(cwd);
    if (!server) {
      server = this.#serverFactory(cwd);
      this.#serverByCwd.set(cwd, server);
      server.onEvent((event) => this.#onServerEvent(event));
      server.onClose(() => this.#handleServerClose(cwd, server!));
      try {
        await server.start();
      } catch (err) {
        this.#serverByCwd.delete(cwd);
        throw err;
      }
      return server;
    }
    // start() is idempotent (cached start promise); ensures we're connected.
    await server.start();
    return server;
  }

  /** A serve process died: fail its in-flight turns; keep sessions (persisted). */
  #handleServerClose(cwd: string, server: IOpenCodeServer): void {
    if (this.#serverByCwd.get(cwd) === server) this.#serverByCwd.delete(cwd);
    for (const run of [...this.#runBySession.values()]) {
      if (run.cwd !== cwd || run.finished) continue;
      run.finished = true;
      this.#active.delete(run.turnId);
      this.#runBySession.delete(run.sessionId);
      this.emit({
        type: 'turn_error',
        threadId: run.threadId,
        turnId: run.turnId,
        data: { text: 'opencode serve process exited unexpectedly' },
      });
    }
  }

  /** Route one `/event` SSE event to the right in-flight run and bridge events. */
  #onServerEvent(event: OpenCodeServerEvent): void {
    const p = event.properties;
    // Debug: log the meaningful events (skip the high-frequency stream chatter so
    // the log stays readable), so a hung turn's cause is visible on stderr.
    if (
      this.#debug &&
      event.type !== 'message.part.delta' &&
      event.type !== 'message.part.updated' &&
      event.type !== 'session.status' &&
      event.type !== 'plugin.added' &&
      event.type !== 'server.heartbeat'
    ) {
      this.#log(`event ${event.type}`);
    }
    switch (event.type) {
      case 'message.part.delta':
        return this.#onPartDelta(p);
      case 'message.part.updated':
        return this.#onPartUpdated(p);
      case 'todo.updated':
        return this.#onTodoUpdated(p);
      case 'permission.asked':
        return this.#onPermissionAsked(p, false);
      case 'permission.v2.asked':
        return this.#onPermissionAsked(p, true);
      case 'question.asked':
      case 'question.v2.asked':
        return this.#onQuestionAsked(p);
      case 'message.updated':
        return this.#onMessageUpdated(p);
      case 'session.error':
        return this.#onSessionError(p);
      case 'session.idle':
        return this.#onSessionIdle(p);
      default:
        // Unknown / uninteresting events (heartbeats, plugin.added, …): ignore.
        return;
    }
  }

  /**
   * Incremental text delta (`{ messageID, partID, field, delta }`). OpenCode
   * streams BOTH assistant text and reasoning as `field: "text"` deltas, so we
   * route by the part's *type* (learned from `message.part.updated`), and we skip
   * the user message's echoed text part by its message role.
   */
  #onPartDelta(p: Record<string, unknown>): void {
    const run = this.#runBySession.get(str(p['sessionID']));
    if (!run || run.finished) return;
    if (str(p['field']) !== 'text') return;
    if (run.roleByMessage.get(str(p['messageID'])) !== 'assistant') return;
    const partId = str(p['partID']);
    const delta = str(p['delta']);
    if (!delta) return;
    if (run.partTypes.get(partId) === 'reasoning') {
      run.reasoningTexts.set(partId, (run.reasoningTexts.get(partId) ?? '') + delta);
      this.emit({
        type: 'thinking',
        threadId: run.threadId,
        turnId: run.turnId,
        data: { text: delta },
      });
    } else {
      run.partTexts.set(partId, (run.partTexts.get(partId) ?? '') + delta);
      this.#emitText(run, delta);
    }
  }

  /** A whole message part changed (`{ part }`) — text/reasoning/tool/step-finish. */
  #onPartUpdated(p: Record<string, unknown>): void {
    const part = isRecord(p['part']) ? p['part'] : undefined;
    if (!part) return;
    const run = this.#runBySession.get(str(part['sessionID']));
    if (!run || run.finished) return;
    const id = str(part['id']);
    const type = str(part['type']);
    run.partTypes.set(id, type);
    // Text/reasoning parts inherit their message's role; skip the user's echoed
    // text part (only the assistant's output is surfaced).
    const isAssistant = run.roleByMessage.get(str(part['messageID'])) === 'assistant';
    switch (type) {
      case 'text': {
        if (!isAssistant) return;
        // Reconcile against whatever the delta stream already delivered: emit
        // only the unseen suffix (nothing if deltas covered it).
        const suffix = reconcileSuffix(run.partTexts, id, str(part['text']));
        if (suffix) this.#emitText(run, suffix);
        return;
      }
      case 'reasoning': {
        if (!isAssistant) return;
        const suffix = reconcileSuffix(run.reasoningTexts, id, str(part['text']));
        if (suffix)
          this.emit({
            type: 'thinking',
            threadId: run.threadId,
            turnId: run.turnId,
            data: { text: suffix },
          });
        return;
      }
      case 'tool': {
        const tool = str(part['tool']).toLowerCase();
        // The to-do tool surfaces via the native `todo.updated` event; skip its
        // tool part so we don't double-render the plan.
        if (tool === 'todowrite' || tool === 'todoread' || tool === 'todo') return;
        const state = isRecord(part['state']) ? part['state'] : {};
        const status = str(state['status']);
        if ((status === 'completed' || status === 'error') && !run.emittedTools.has(id)) {
          run.emittedTools.add(id);
          this.emit({
            type: 'block',
            threadId: run.threadId,
            turnId: run.turnId,
            data: {
              content: opencodeToolBlock(
                str(part['tool']),
                id,
                isRecord(state['input']) ? state['input'] : {},
                str(state['output']),
                status === 'error',
              ),
            },
          });
        }
        return;
      }
      case 'step-finish': {
        const tokens = openCodeUsageTokens(part['tokens']);
        if (tokens !== undefined) run.tokens = tokens;
        return;
      }
      default:
        return;
    }
  }

  /** Native plan/to-do update (`{ sessionID, todos }`) — accumulate, emit at idle. */
  #onTodoUpdated(p: Record<string, unknown>): void {
    const run = this.#runBySession.get(str(p['sessionID']));
    if (!run || run.finished) return;
    const steps = extractPlanSteps({ todos: p['todos'] });
    if (steps.length > 0) run.planSteps = mergePlanSteps(run.planSteps, steps);
  }

  /**
   * A message's metadata changed (`{ info }`). We record every message's role
   * (so parts can be filtered to the assistant), and for the assistant message
   * capture its token usage and surface any error.
   */
  #onMessageUpdated(p: Record<string, unknown>): void {
    const info = isRecord(p['info']) ? p['info'] : undefined;
    if (!info) return;
    const run = this.#runBySession.get(str(info['sessionID']));
    if (!run) return;
    const id = str(info['id']);
    const role = str(info['role']);
    if (id && role) run.roleByMessage.set(id, role);
    if (role !== 'assistant' || run.finished) return;
    const tokens = openCodeUsageTokens(info['tokens']);
    if (tokens !== undefined) run.tokens = tokens;
    if (isRecord(info['error'])) this.#finishError(run, readErrorMessage(info['error']));
  }

  /** A session-level error (`{ sessionID?, error }`). */
  #onSessionError(p: Record<string, unknown>): void {
    const sessionId = str(p['sessionID']);
    const run = sessionId ? this.#runBySession.get(sessionId) : this.#anyActiveRun();
    if (!run || run.finished) return;
    this.#finishError(run, readErrorMessage(p['error']));
  }

  /** The session went idle: the turn is done — flush the plan + complete. */
  #onSessionIdle(p: Record<string, unknown>): void {
    const run = this.#runBySession.get(str(p['sessionID']));
    if (!run || run.finished) return;
    this.#log(
      `turn ${run.turnId} completing (textLen=${run.full.length} tokens=${run.tokens ?? '-'} ` +
        `plan=${run.planSteps.length})`,
    );
    run.finished = true;
    this.#active.delete(run.turnId);
    this.#runBySession.delete(run.sessionId);
    if (run.planSteps.length > 0) {
      this.emit({
        type: 'block',
        threadId: run.threadId,
        turnId: run.turnId,
        data: { content: planBlock(run.planSteps) },
      });
    }
    const contextWindow =
      run.model !== undefined ? this.#contextWindowByModel.get(run.model) : undefined;
    const usage =
      run.tokens !== undefined
        ? { tokens: run.tokens, ...(contextWindow !== undefined ? { contextWindow } : {}) }
        : undefined;
    this.emit({
      type: 'turn_completed',
      threadId: run.threadId,
      turnId: run.turnId,
      data: { text: run.full, ...(usage !== undefined ? { usage } : {}) },
    });
  }

  /**
   * Route a `permission.asked` (v1) or `permission.v2.asked` (v2) through the
   * bridge's approval round-trip. v1 carries `{ permission, patterns, metadata }`;
   * v2 carries `{ action, resources }` — both reply with `once|always|reject` to
   * the same `/permission/{id}/reply` endpoint.
   */
  #onPermissionAsked(p: Record<string, unknown>, isV2: boolean): void {
    const permissionId = str(p['id']);
    const run = this.#runBySession.get(str(p['sessionID']));
    const server = run ? this.#serverByCwd.get(run.cwd) : undefined;
    const kind = isV2 ? str(p['action']) : str(p['permission']);
    this.#log(
      `permission${isV2 ? '.v2' : ''}.asked id=${permissionId} kind=${kind || '?'} ` +
        `run=${!!run} cb=${!!this.#onApprovalRequest}`,
    );
    if (!permissionId || !server) return;
    // No run or no approval callback → fail safe by rejecting so the agent
    // doesn't block forever waiting on a reply.
    if (!run || !this.#onApprovalRequest) {
      void server.replyPermission(permissionId, 'reject').catch(() => undefined);
      return;
    }
    let toolName: string;
    let input: Record<string, unknown>;
    if (isV2) {
      toolName = str(p['action']) || 'tool';
      const resources = Array.isArray(p['resources'])
        ? (p['resources'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      input = {
        permission: toolName,
        ...(resources.length ? { pattern: resources.join(', ') } : {}),
      };
    } else {
      toolName = str(p['permission']) || 'tool';
      const patterns = Array.isArray(p['patterns'])
        ? (p['patterns'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const metadata = isRecord(p['metadata']) ? p['metadata'] : {};
      input = approvalInput(toolName, patterns, metadata);
    }
    void (async () => {
      let reply: PermissionReply = 'reject';
      try {
        const decision = await this.#onApprovalRequest!(run.threadId, { toolName, input });
        reply = decisionToPermissionReply(decision);
      } catch {
        reply = 'reject';
      }
      this.#log(`permission ${permissionId} → reply=${reply}`);
      try {
        await server.replyPermission(permissionId, reply);
      } catch {
        /* server may have died — the close handler surfaces it */
      }
    })();
  }

  /**
   * Handle a `question.asked` / `question.v2.asked` elicitation (the agent's
   * `question` tool asks the user to choose among options). Routed through the
   * bridge's `onQuestionRequest` round-trip → the phone's question card → the
   * chosen answers are replied to `/question/{id}/reply`. With no callback (or an
   * empty answer / error) the question is rejected so the turn UNBLOCKS instead of
   * hanging forever waiting on an answer we can't surface.
   */
  #onQuestionAsked(p: Record<string, unknown>): void {
    const requestId = str(p['id']);
    const run = this.#runBySession.get(str(p['sessionID']));
    const server = run ? this.#serverByCwd.get(run.cwd) : undefined;
    const questions = parseQuestionItems(p['questions']);
    this.#log(
      `question.asked id=${requestId} run=${!!run} cb=${!!this.#onQuestionRequest} ` +
        `questions=${questions.length}`,
    );
    if (!requestId || !server) return;
    if (!run || !this.#onQuestionRequest || questions.length === 0) {
      void server.rejectQuestion(requestId).catch(() => undefined);
      return;
    }
    void (async () => {
      let answers: string[][] = [];
      try {
        answers = await this.#onQuestionRequest!(run.threadId, questions);
      } catch {
        answers = [];
      }
      const hasAnswer = answers.some((a) => a.length > 0);
      this.#log(
        `question ${requestId} → ${hasAnswer ? `reply ${JSON.stringify(answers)}` : 'reject'}`,
      );
      try {
        if (hasAnswer) await server.replyQuestion(requestId, answers);
        else await server.rejectQuestion(requestId);
      } catch {
        /* server may have died — the close handler surfaces it */
      }
    })();
  }

  /** Emit an assistant text delta and accumulate it for `turn_completed`. */
  #emitText(run: ActiveRun, delta: string): void {
    run.full += delta;
    this.emit({ type: 'delta', threadId: run.threadId, turnId: run.turnId, data: { text: delta } });
  }

  /** Fail a run once with a `turn_error`, dropping it from the active maps. */
  #finishError(run: ActiveRun, text: string): void {
    run.finished = true;
    this.#active.delete(run.turnId);
    this.#runBySession.delete(run.sessionId);
    this.emit({ type: 'turn_error', threadId: run.threadId, turnId: run.turnId, data: { text } });
  }

  /** First in-flight run (for a session-less `session.error`). */
  #anyActiveRun(): ActiveRun | undefined {
    for (const run of this.#runBySession.values()) if (!run.finished) return run;
    return undefined;
  }

  /**
   * Populate the per-model context-window cache from `opencode models --verbose`
   * (once). Best-effort: a spawn/parse failure leaves the cache empty and usage
   * stays count-only. Independent of the serve process (a short-lived spawn).
   */
  loadContextWindows(): Promise<void> {
    if (this.#windowsLoaded) return Promise.resolve();
    this.#windowsLoaded = true;
    return new Promise((resolve) => {
      let child: SpawnedProcess;
      try {
        child = this.#spawn(this.#binaryPath, ['models', '--verbose'], this.#defaultCwd);
      } catch {
        resolve();
        return;
      }
      let out = '';
      const collect = (chunk: unknown): void => {
        out += String(chunk);
      };
      child.stdout.on('data', collect);
      child.stderr?.on('data', collect);
      child.on('error', () => resolve());
      child.on('close', () => {
        for (const [id, win] of parseOpenCodeModelWindows(out)) {
          this.#contextWindowByModel.set(id, win);
        }
        resolve();
      });
    });
  }

  /** Run `opencode models` and return the `provider/model` ids it reports. */
  listModels(): Promise<AgentModel[]> {
    const def = this.#defaultModel;
    return new Promise((resolve) => {
      let stdout = '';
      let child;
      try {
        child = spawn(this.#binaryPath, ['models'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        resolve([]);
        return;
      }
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.on('error', () => resolve([]));
      child.on('close', () =>
        resolve(
          parseModelList(stdout).map(
            (id) => ({ id, displayName: id, isDefault: def === id }) satisfies AgentModel,
          ),
        ),
      );
    });
  }

  /**
   * OpenCode's custom commands are markdown files under `.opencode/command`
   * (project) and `~/.config/opencode/command` (user). Both singular/plural
   * directory spellings are scanned for robustness. The server API doesn't run
   * them, so the bridge scans + expands them itself.
   */
  #commandSource(cwd?: string): CustomCommandSource {
    const dir = cwd ?? this.#defaultCwd;
    return {
      dirs: [
        join(dir, '.opencode', 'command'),
        join(dir, '.opencode', 'commands'),
        join(homedir(), '.config', 'opencode', 'command'),
        join(homedir(), '.config', 'opencode', 'commands'),
      ],
      ext: '.md',
      format: 'markdown',
    };
  }

  listCommands(cwd?: string): Promise<AgentCommand[]> {
    return scanCustomCommands(this.#commandSource(cwd));
  }

  expandCommand(name: string, args?: string, cwd?: string): Promise<string> {
    return expandCustomCommand(this.#commandSource(cwd), name, args);
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g;

/** Parse `opencode models` output into a unique list of `provider/model` ids. */
export function parseModelList(stdout: string): string[] {
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI_PATTERN, '').trim();
    // Model ids look like `provider/model`; skip headers/blank lines.
    if (line.includes('/') && !line.includes(' ')) seen.add(line);
  }
  return [...seen];
}

/**
 * Parse `opencode models --verbose` into a `provider/model` → context-window map.
 *
 * The verbose output is a sequence of `provider/model` header lines, each
 * followed by that model's pretty-printed JSON (`{ … "limit": { "context": N … } }`).
 * We track the current header and capture the first `"context": <number>` that
 * follows it (only `limit.context` is a numeric `context`; capabilities use a
 * `"type": "context"` string). Models without a window are simply absent.
 */
export function parseOpenCodeModelWindows(verboseStdout: string): Map<string, number> {
  const windows = new Map<string, number>();
  let currentId: string | undefined;
  for (const raw of verboseStdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI_PATTERN, '').trim();
    // Header line before each model's JSON block: bare `provider/model`.
    if (line.includes('/') && !/[\s{}":]/.test(line)) {
      currentId = line;
      continue;
    }
    const match = line.match(/^"context":\s*(\d+)/);
    if (match && currentId && !windows.has(currentId)) {
      const value = Number(match[1]);
      if (value > 0) windows.set(currentId, value);
    }
  }
  return windows;
}

/**
 * Build the approval-card `input` from a `permission.asked` payload, mapping
 * OpenCode's field names onto the keys the bridge's approval card reads
 * (`command`/`file_path`/`url`/`pattern`). `metadata.diff` is carried through so
 * the card can show the change.
 */
function approvalInput(
  permission: string,
  patterns: string[],
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const patternStr = patterns.join(', ');
  const command = str(metadata['command']);
  const filepath = str(metadata['filepath']);
  const url = str(metadata['url']);
  const diff = str(metadata['diff']);
  return {
    permission,
    ...(command ? { command } : {}),
    ...(filepath ? { file_path: filepath } : {}),
    ...(url ? { url } : {}),
    ...(patternStr ? { pattern: patternStr } : {}),
    ...(diff ? { diff } : {}),
  };
}

/**
 * Map an OpenCode `question.asked` `questions` array onto the shared
 * {@link QuestionItem}[] the phone renders. OpenCode's shape (`{ question,
 * header, options:[{label,description}], multiple }`) already matches; we just
 * validate/normalize and drop questions with no usable options.
 */
function parseQuestionItems(raw: unknown): QuestionItem[] {
  if (!Array.isArray(raw)) return [];
  const items: QuestionItem[] = [];
  for (const q of raw) {
    if (!isRecord(q)) continue;
    const question = str(q['question']);
    if (!question) continue;
    const options: QuestionOption[] = [];
    for (const o of Array.isArray(q['options']) ? q['options'] : []) {
      if (!isRecord(o)) continue;
      const label = str(o['label']);
      if (!label) continue;
      const description = str(o['description']);
      options.push({ label, ...(description ? { description } : {}) });
    }
    if (options.length === 0) continue;
    const header = str(q['header']);
    items.push({
      question,
      ...(header ? { header } : {}),
      options,
      ...(q['multiple'] === true ? { multiple: true } : {}),
    });
  }
  return items;
}

/**
 * Compute the newly-appended suffix of `full` relative to `map[id]`, and store
 * `full`. Returns the suffix (empty when nothing is new); when `full` diverges
 * from the tracked prefix it returns the whole `full` (a reset).
 */
function reconcileSuffix(map: Map<string, string>, id: string, full: string): string {
  const previous = map.get(id) ?? '';
  const suffix = full.startsWith(previous) ? full.slice(previous.length) : full;
  map.set(id, full);
  return suffix;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const data = error['data'];
    if (isRecord(data) && typeof data['message'] === 'string') return data['message'];
    if (typeof error['message'] === 'string') return error['message'];
    if (typeof error['name'] === 'string') return error['name'];
  }
  return 'opencode error';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
