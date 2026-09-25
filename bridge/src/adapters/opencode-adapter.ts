/**
 * OpenCode adapter — drives `opencode serve`, OpenCode 1 and OpenCode 2 alike.
 *
 * ## Why a server
 *
 * `opencode run` is one-shot and non-interactive: it runs tools on its own and
 * reports them only after they ran, so the bridge could never gate a sensitive
 * action. `opencode serve` is a long-lived local server whose event stream
 * surfaces permission requests the bridge routes to the phone's approval card
 * (the same flow Codex's `app-server` uses), plus questions, the plan, the
 * turn's end and per-step token usage.
 *
 * ## One adapter, two protocols
 *
 * OpenCode 2 kept the command and replaced everything on the wire. The adapter
 * does not see that: it speaks the neutral contract of `opencode-protocol.ts`
 * (sessions, turns, {@link OpenCodeEvent}s, normalized history, models), and
 * `opencode-v1.ts` / `opencode-v2.ts` each translate one protocol into it. The
 * version is read from the binary when a server is started
 * (`opencode-version.ts`). What lives here is only what a turn is: which
 * session runs which bridge turn, the reply accumulated for `turn_completed`,
 * the plan merged into one card, the usage, and the approval and question
 * round-trips.
 *
 * ## Process model
 *
 * One server **per working directory**, spawned lazily. Sessions persist in
 * OpenCode's store, so each thread reuses its `ses_…` id across turns and
 * across a server restart (`nativeSessionId` also feeds the `turn/list` history
 * fallback). Approvals go through the bridge's shared `requestApproval`
 * round-trip via the injected `onApprovalRequest` callback.
 *
 * See bridge/docs/agents.md (Drive surface) and bridge/docs/testing.md.
 */
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
  DesktopTools,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { DESKTOP_CWD_HEADER, DESKTOP_MCP_SERVER_NAME, encodeCwdHeader } from '@uxnan/shared';
import { createHash } from 'node:crypto';
import {
  expandCustomCommand,
  scanCustomCommands,
  type CustomCommandSource,
} from './command-scan.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { mergePlanSteps, opencodeToolBlock } from './opencode-tools.js';
import { compactionBlock, planBlock, type PlanStepBlock } from './content-blocks.js';
import { reasoningValue } from './run-options.js';
import { defaultSpawn, type SpawnFn } from './spawn.js';
import {
  permissionPolicyFor,
  splitOpenCodeModel,
  type IOpenCodeServer,
  type OpenCodeEvent,
  type OpenCodeHistoryMessage,
  type OpenCodeModel,
  type OpenCodeProtocolVersion,
  type PermissionReply,
} from './opencode-protocol.js';
import {
  createOpenCodeServer,
  detectOpenCodeMajor,
  openCodeRunArgs,
  protocolFor,
} from './opencode-version.js';

// Re-exported for backwards-compatible imports (these types now live in spawn.ts).
export type { SpawnFn, SpawnedProcess } from './spawn.js';

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  // The server surfaces a permission request before a gated tool runs, so the
  // bridge can request the user's approval (unlike the old one-shot `run`).
  approvals: true,
  forking: true,
  images: true,
  // Both versions report per-step token counts, surfaced as `usage.tokens`.
  reportsContextUsage: true,
  reportsCompaction: true,
  commands: true,
  // A message sent to a busy session is folded into the running work and the
  // turn still closes once — V1 by another `prompt_async` (verified on
  // 1.18.11), V2 by `delivery: "steer"` (verified on 2.0.16).
  steering: true,
};

/** Map the user's approval decision onto OpenCode's `once|always|reject` reply. */
export function decisionToPermissionReply(decision: ApprovalDecision): PermissionReply {
  if (decision === 'approveSession') return 'always';
  if (decision === 'reject') return 'reject';
  return 'once';
}

export interface OpenCodeAdapterOptions {
  /** Executable to spawn (found by `locateAgent`, `agents/agent-installs.ts`). */
  binaryPath?: string;
  /** Default model (`provider/model`) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Spawns the short-lived runs (`--version`, `models`, titles); injected in tests. */
  spawnFn?: SpawnFn;
  /**
   * Surfaces a permission request to the bridge so the phone can decide.
   * Returns the user's {@link ApprovalDecision} (or `reject` after the bridge's
   * approval timeout). Absent → the request is rejected (fail-safe).
   */
  onApprovalRequest?: (
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ) => Promise<ApprovalDecision>;
  /**
   * Surfaces a question (the agent's `question` tool) to the bridge so the phone
   * can answer it. Returns one array of chosen option labels per question (or
   * `[]` to skip, which dismisses it so the turn unblocks). Absent → dismissed.
   */
  onQuestionRequest?: (threadId: string, questions: QuestionItem[]) => Promise<string[][]>;
  /**
   * Injected server factory (tests). Given a cwd, returns an {@link IOpenCodeServer}.
   * The default reads the installed version and starts the matching server.
   */
  serverFactory?: (cwd: string) => IOpenCodeServer;
}

/** An in-flight turn's mutable state, keyed by the OpenCode session id. */
/** The environment variable OpenCode reads its extra, merged-over config from. */
const OPENCODE_CONFIG_ENV = 'OPENCODE_CONFIG_CONTENT';

/**
 * Uxnan Desktop's tools for the `opencode serve` of one folder: the desktop's
 * MCP server merged over the user's config (`OPENCODE_CONFIG_CONTENT`), the
 * token read by OpenCode from `UXNAN_MCP_TOKEN` (`{env:…}`) and the folder in
 * `x-uxnan-cwd` — one server per folder, so the header is that folder's. The
 * same mechanism the desktop uses for the OpenCode it launches in a terminal.
 * Verified against opencode 2.0.16: the server connects once the folder loads
 * and sends both headers. Empty without desktop tools.
 */
export function openCodeDesktopEnv(
  desktop: DesktopTools | undefined,
  cwd: string,
): Record<string, string> {
  if (!desktop) return {};
  const config = {
    mcp: {
      [DESKTOP_MCP_SERVER_NAME]: {
        type: 'remote',
        url: desktop.mcpUrl,
        headers: {
          Authorization: `Bearer {env:UXNAN_MCP_TOKEN}`,
          [DESKTOP_CWD_HEADER]: encodeCwdHeader(cwd),
        },
      },
    },
  };
  return { [OPENCODE_CONFIG_ENV]: JSON.stringify(config), UXNAN_MCP_TOKEN: desktop.token };
}

/** What a folder's server was started with, to tell when it must restart. */
function toolsFingerprint(desktop: DesktopTools | undefined): string {
  if (!desktop) return '';
  return `${desktop.mcpUrl}#${createHash('sha256').update(desktop.token).digest('hex').slice(0, 16)}`;
}

interface ActiveRun {
  threadId: string;
  turnId: string;
  sessionId: string;
  cwd: string;
  model?: string;
  /** Accumulated assistant text, for `turn_completed`. */
  full: string;
  /** Plan steps, merged into one card at the turn's end. */
  planSteps: PlanStepBlock[];
  /** Latest reported context-occupying token count. */
  tokens?: number;
  /** True once completed/errored/aborted, so a late event is ignored. */
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
  readonly #serverFactory: OpenCodeAdapterOptions['serverFactory'];
  /** cwd → the server for that project directory (created, maybe not started yet). */
  readonly #serverByCwd = new Map<string, Promise<IOpenCodeServer>>();
  /** cwd → the desktop tools the next turn there wants (see `sendTurn`). */
  readonly #wantedTools = new Map<string, DesktopTools | undefined>();
  /** cwd → fingerprint of the desktop tools its server was started with. */
  readonly #toolsByCwd = new Map<string, string>();
  /** threadId → OpenCode session id, for continuity + the history fallback. */
  readonly #sessionByThread = new Map<string, string>();
  /** OpenCode session id → in-flight run, to route session-scoped events. */
  readonly #runBySession = new Map<string, ActiveRun>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  /** model id → context-window tokens. */
  readonly #contextWindowByModel = new Map<string, number>();
  /** The context-window load in flight, or settled with at least one window. */
  #windowsLoad: Promise<void> | undefined;
  #defaultCwd = process.cwd();
  /** When set (`UXNAN_OPENCODE_DEBUG=1`), log the turn/event flow to stderr. */
  readonly #debug: boolean;

  constructor(options: OpenCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'opencode';
    this.#defaultModel = options.defaultModel;
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#onApprovalRequest = options.onApprovalRequest;
    this.#onQuestionRequest = options.onQuestionRequest;
    this.#serverFactory = options.serverFactory;
    const flag = process.env['UXNAN_OPENCODE_DEBUG'];
    this.#debug = flag === '1' || flag === 'true';
  }

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  /** Native OpenCode session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  /**
   * A persisted session's messages, normalized, through the server's own history
   * API. It also sees turns written by OpenCode's desktop app or another CLI,
   * since every client shares OpenCode's session store.
   */
  async readSessionMessages(sessionId: string, cwd?: string): Promise<OpenCodeHistoryMessage[]> {
    const server = await this.#serverFor(cwd ?? this.#defaultCwd);
    return server.messages(sessionId);
  }

  #log(message: string): void {
    if (this.#debug) process.stderr.write(`[opencode] ${message}\n`);
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    // Warm the per-model context-window cache so the first turn can already emit
    // `usage.contextWindow` (a percentage on the phone).
    void this.loadContextWindows();
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const run of this.#active.values()) run.finished = true;
    this.#active.clear();
    this.#runBySession.clear();
    const servers = [...this.#serverByCwd.values()];
    this.#serverByCwd.clear();
    for (const pending of servers) {
      try {
        await (await pending).close();
      } catch {
        /* best-effort */
      }
    }
  }

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const modelRef = model !== undefined ? splitOpenCodeModel(model) : undefined;
    const variant = reasoningValue(options);
    void this.loadContextWindows();

    // A folder's server carries the desktop's tools it was started with; when
    // they changed (attached, detached, a new token) and nothing runs there,
    // restart it — sessions are OpenCode's own, so the thread keeps its history.
    await this.#refreshServerTools(cwd, options.desktopTools);

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
          permission: permissionPolicyFor(options.accessMode),
          ...(modelRef ? { model: modelRef } : {}),
          ...(variant ? { variant } : {}),
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

    // A prior run on this session that never saw its end (it lost its events to
    // a race) is retired, so a stale entry can't linger; this turn supersedes it.
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
      planSteps: [],
      finished: false,
    };
    this.#active.set(turnId, run);
    this.#runBySession.set(sessionId, run);
    this.emit({ type: 'turn_started', threadId, turnId });
    this.#log(
      `turn ${turnId} session=${sessionId} v${server.protocol} model=${model ?? '(default)'} ` +
        `accessMode=${options.accessMode ?? '(default)'} hasApprovalCb=${!!this.#onApprovalRequest}`,
    );

    try {
      await server.prompt(sessionId, {
        text,
        ...(modelRef ? { model: modelRef } : {}),
        ...(variant ? { variant } : {}),
      });
      this.#log(`turn ${turnId} prompt accepted`);
    } catch (err) {
      this.#active.delete(turnId);
      this.#runBySession.delete(sessionId);
      run.finished = true;
      // Drop the stored session so the next turn recreates it (a restarted
      // server may no longer know this id).
      this.#sessionByThread.delete(threadId);
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `opencode prompt failed: ${errorMessage(err)}` },
      });
    }
  }

  /**
   * Name a conversation with a one-shot `opencode run`, deliberately not the
   * session a turn uses: a throwaway run, so the conversation's own history is
   * untouched. No model flag: OpenCode routes through many providers, so there
   * is no cheap-tier id to hard-code; it runs on OpenCode's default.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const protocol = await this.#protocol(cwd);
    const raw = await runTitleOneShot(() =>
      this.#spawn(this.#binaryPath, openCodeRunArgs(protocol, prompt), cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
  }

  /**
   * Hand a follow-up to the turn `activeTurnId` is already running. The server
   * folds it into the same run and the turn still ends once, so no new
   * {@link ActiveRun} is created: events route by session, and a second run
   * would retire the first as stale and split the reply in two.
   *
   * Returns false for every ordinary "too late": the turn is unknown, already
   * finished, or its server is gone.
   */
  async steerTurn(options: SendTurnOptions & { activeTurnId: string }): Promise<boolean> {
    const run = this.#active.get(options.activeTurnId);
    if (!run || run.finished) return false;
    if (run.threadId !== options.threadId) return false;
    const server = await this.#existingServer(run.cwd);
    if (!server) return false;
    // The running turn's model stays in force — this is a message inside it.
    try {
      await server.steer(run.sessionId, options.text);
    } catch (err) {
      this.#log(`turn ${run.turnId} mid-turn message refused: ${errorMessage(err)}`);
      return false;
    }
    // The turn may have ended while the request was in flight. Report it
    // delivered anyway: the server ACCEPTED it, and answering "not taken" would
    // make the bridge send the same text a second time.
    if (run.finished) this.#log(`turn ${run.turnId} ended as a mid-turn message was accepted`);
    return true;
  }

  async cancelTurn(threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (!run) return;
    run.finished = true;
    this.#active.delete(turnId);
    this.#runBySession.delete(run.sessionId);
    const server = await this.#existingServer(run.cwd);
    if (server) {
      try {
        await server.interrupt(run.sessionId);
      } catch {
        /* process may have died — the close handler surfaces it */
      }
    }
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }

  /** The protocol the installed OpenCode speaks (read from the binary). */
  async #protocol(cwd: string): Promise<OpenCodeProtocolVersion> {
    return protocolFor(await detectOpenCodeMajor(this.#spawn, this.#binaryPath, cwd));
  }

  /** Closes a folder's idle server when the desktop's tools it holds are not
   *  the ones wanted now, so the next start carries the right ones. */
  async #refreshServerTools(cwd: string, desktop: DesktopTools | undefined): Promise<void> {
    const wanted = toolsFingerprint(desktop);
    this.#wantedTools.set(cwd, desktop);
    if (!this.#serverByCwd.has(cwd)) return;
    if ((this.#toolsByCwd.get(cwd) ?? '') === wanted) return;
    const busy = [...this.#active.values()].some((run) => run.cwd === cwd && !run.finished);
    if (busy) return;
    const server = await this.#existingServer(cwd);
    this.#serverByCwd.delete(cwd);
    this.#toolsByCwd.delete(cwd);
    await server?.close().catch(() => undefined);
  }

  /** The server for a cwd, created (and subscribed to) on first use, not started. */
  #serverFor(cwd: string): Promise<IOpenCodeServer> {
    let pending = this.#serverByCwd.get(cwd);
    if (!pending) {
      const desktop = this.#wantedTools.get(cwd);
      this.#toolsByCwd.set(cwd, toolsFingerprint(desktop));
      pending = (async () => {
        const env = openCodeDesktopEnv(desktop, cwd);
        const server = this.#serverFactory
          ? this.#serverFactory(cwd)
          : createOpenCodeServer(await this.#protocol(cwd), {
              binaryPath: this.#binaryPath,
              cwd,
              spawnFn: this.#spawn,
              ...(Object.keys(env).length > 0 ? { env } : {}),
            });
        server.onEvent((event) => this.#onServerEvent(event, server));
        server.onClose(() => this.#handleServerClose(cwd, pending!));
        this.#log(`server for ${cwd} speaks OpenCode v${server.protocol}`);
        return server;
      })();
      this.#serverByCwd.set(cwd, pending);
      pending.catch(() => {
        if (this.#serverByCwd.get(cwd) === pending) this.#serverByCwd.delete(cwd);
      });
    }
    return pending;
  }

  /** The server for a cwd, started. A failed start forgets it, so the next try respawns. */
  async #ensureServer(cwd: string): Promise<IOpenCodeServer> {
    const pending = this.#serverFor(cwd);
    const server = await pending;
    try {
      await server.start();
    } catch (err) {
      if (this.#serverByCwd.get(cwd) === pending) this.#serverByCwd.delete(cwd);
      throw err;
    }
    return server;
  }

  /** The server already serving a cwd, if any. */
  async #existingServer(cwd: string): Promise<IOpenCodeServer | undefined> {
    const pending = this.#serverByCwd.get(cwd);
    if (!pending) return undefined;
    try {
      return await pending;
    } catch {
      return undefined;
    }
  }

  /** A server process died: fail its in-flight turns; keep sessions (persisted). */
  #handleServerClose(cwd: string, pending: Promise<IOpenCodeServer>): void {
    if (this.#serverByCwd.get(cwd) === pending) this.#serverByCwd.delete(cwd);
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

  /** Route one neutral event to the run on its session and emit bridge events. */
  #onServerEvent(event: OpenCodeEvent, server: IOpenCodeServer): void {
    if (this.#debug && event.kind !== 'text' && event.kind !== 'reasoning') {
      this.#log(`event ${event.kind} session=${event.sessionId ?? '-'}`);
    }
    switch (event.kind) {
      case 'permission':
        return this.#onPermission(event, server);
      case 'question':
        return this.#onQuestion(event, server);
      case 'error': {
        const run = event.sessionId
          ? this.#runBySession.get(event.sessionId)
          : this.#anyActiveRun();
        if (run && !run.finished) this.#finish(run, { type: 'turn_error', text: event.message });
        return;
      }
      default:
        break;
    }
    const run = this.#runBySession.get(event.sessionId);
    if (!run || run.finished) return;
    switch (event.kind) {
      case 'text':
        run.full += event.delta;
        this.emit({
          type: 'delta',
          threadId: run.threadId,
          turnId: run.turnId,
          data: { text: event.delta },
        });
        return;
      case 'reasoning':
        this.emit({
          type: 'thinking',
          threadId: run.threadId,
          turnId: run.turnId,
          data: { text: event.delta },
        });
        return;
      case 'tool':
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.turnId,
          data: {
            content: opencodeToolBlock(
              event.name,
              event.id,
              event.input,
              event.output,
              event.error,
            ),
          },
        });
        return;
      case 'usage':
        run.tokens = event.tokens;
        return;
      case 'plan':
        run.planSteps = mergePlanSteps(run.planSteps, event.steps);
        return;
      case 'compacted':
        this.emit({
          type: 'block',
          threadId: run.threadId,
          turnId: run.turnId,
          data: { content: compactionBlock() },
        });
        return;
      case 'idle':
        return this.#complete(run);
      case 'interrupted':
        // Stopped from somewhere else (another client); a cancel from the phone
        // already finished the run before asking the server to stop.
        this.#finish(run, { type: 'turn_aborted' });
        return;
    }
  }

  /** The turn ended: flush the plan and complete with its reply and usage. */
  #complete(run: ActiveRun): void {
    this.#log(
      `turn ${run.turnId} completing (textLen=${run.full.length} tokens=${run.tokens ?? '-'} ` +
        `plan=${run.planSteps.length})`,
    );
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
    this.#finish(run, { type: 'turn_completed', text: run.full, usage });
  }

  /** End a run once, dropping it from the active maps. */
  #finish(
    run: ActiveRun,
    end:
      | {
          type: 'turn_completed';
          text: string;
          usage: { tokens: number; contextWindow?: number } | undefined;
        }
      | { type: 'turn_error'; text: string }
      | { type: 'turn_aborted' },
  ): void {
    run.finished = true;
    this.#active.delete(run.turnId);
    this.#runBySession.delete(run.sessionId);
    const base = { threadId: run.threadId, turnId: run.turnId };
    if (end.type === 'turn_completed') {
      this.emit({
        type: 'turn_completed',
        ...base,
        data: { text: end.text, ...(end.usage !== undefined ? { usage: end.usage } : {}) },
      });
    } else if (end.type === 'turn_error') {
      this.emit({ type: 'turn_error', ...base, data: { text: end.text } });
    } else {
      this.emit({ type: 'turn_aborted', ...base });
    }
  }

  /**
   * Route a permission request through the bridge's approval round-trip. With no
   * run or no callback it is rejected at once, so the agent never waits forever.
   */
  #onPermission(
    event: Extract<OpenCodeEvent, { kind: 'permission' }>,
    server: IOpenCodeServer,
  ): void {
    const run = this.#runBySession.get(event.sessionId);
    this.#log(
      `permission ${event.requestId} kind=${event.toolName} run=${!!run} cb=${!!this.#onApprovalRequest}`,
    );
    const reply = (value: PermissionReply): Promise<void> =>
      server.replyPermission(event.sessionId, event.requestId, value).catch(() => undefined);
    if (!run || !this.#onApprovalRequest) {
      void reply('reject');
      return;
    }
    const ask = this.#onApprovalRequest;
    void (async () => {
      let value: PermissionReply = 'reject';
      try {
        value = decisionToPermissionReply(
          await ask(run.threadId, { toolName: event.toolName, input: event.input }),
        );
      } catch {
        value = 'reject';
      }
      this.#log(`permission ${event.requestId} → reply=${value}`);
      await reply(value);
    })();
  }

  /**
   * Route a question through the bridge's question round-trip. With no run, no
   * callback, nothing to choose from, or no answer, it is dismissed so the turn
   * goes on instead of hanging on a question nobody can see.
   */
  #onQuestion(event: Extract<OpenCodeEvent, { kind: 'question' }>, server: IOpenCodeServer): void {
    const run = this.#runBySession.get(event.sessionId);
    this.#log(
      `question ${event.requestId} run=${!!run} cb=${!!this.#onQuestionRequest} ` +
        `questions=${event.questions.length}`,
    );
    const answer = (answers: string[][]): Promise<void> =>
      server.answerQuestion(event.sessionId, event.requestId, answers).catch(() => undefined);
    const usable = event.questions.some((q) => q.options.length > 0);
    if (!run || !this.#onQuestionRequest || !usable) {
      void answer([]);
      return;
    }
    const ask = this.#onQuestionRequest;
    void (async () => {
      let answers: string[][] = [];
      try {
        answers = await ask(run.threadId, event.questions);
      } catch {
        answers = [];
      }
      this.#log(`question ${event.requestId} → ${JSON.stringify(answers)}`);
      await answer(answers);
    })();
  }

  /** First in-flight run (for an error the server did not attribute). */
  #anyActiveRun(): ActiveRun | undefined {
    for (const run of this.#runBySession.values()) if (!run.finished) return run;
    return undefined;
  }

  /** The models OpenCode offers, remembering each one's context window. */
  async #models(): Promise<OpenCodeModel[]> {
    const server = await this.#serverFor(this.#defaultCwd);
    const models = await server.models();
    for (const m of models) {
      if (m.contextWindow !== undefined) this.#contextWindowByModel.set(m.id, m.contextWindow);
    }
    return models;
  }

  /**
   * Populate the per-model context-window cache. Best-effort: until it succeeds
   * usage stays count-only. It is retried on a later turn when a load brings no
   * window at all — OpenCode 1's first `opencode models` on a fresh install
   * prints nothing while it downloads its catalog, and settling on that empty
   * answer would leave the phone without a context percentage for the session.
   * One load at a time, so turns never pile up catalog reads.
   */
  loadContextWindows(): Promise<void> {
    if (this.#windowsLoad) return this.#windowsLoad;
    const load: Promise<void> = this.#models()
      .then((models) => models.some((m) => m.contextWindow !== undefined))
      .catch(() => false)
      .then((found) => {
        if (!found && this.#windowsLoad === load) this.#windowsLoad = undefined;
      });
    this.#windowsLoad = load;
    return load;
  }

  async listModels(): Promise<AgentModel[]> {
    const def = this.#defaultModel;
    try {
      const models = await this.#models();
      return models.map(
        (m) => ({ id: m.id, displayName: m.id, isDefault: def === m.id }) satisfies AgentModel,
      );
    } catch {
      return [];
    }
  }

  /**
   * OpenCode's custom commands are markdown files under `.opencode/command`
   * (project) and `~/.config/opencode/command` (user), singular or plural. The
   * server API doesn't run them, so the bridge scans and expands them itself.
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
