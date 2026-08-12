/**
 * Orchestrates agent turns: routes `turn/send` to the right adapter, persists the
 * streamed output to the {@link ThreadStore}, and pushes streaming notifications
 * to connected phones.
 *
 * Source: architecture/02a-system-architecture.md §5.2 / §5.8.
 *
 * FOR-DEV: the agent is currently chosen by a single `defaultAgent`; resolve it
 * per project/thread from the project's AgentConfig once project management lands
 * (src/agents/agent-manager.ts).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  StreamNotification,
  makeNotification,
  type AccessMode,
  type AgentCommand,
  type AgentCommandInvocation,
  type AgentDescriptor,
  type AgentId,
  type AgentModel,
  type AgentStreamEvent,
  type ApprovalDecision,
  type ApprovalRequestBlock,
  type IAgentAdapter,
  type QueuePausedReason,
  type QueueStateResult,
  type TurnAttachment,
  type ThreadRenamedParams,
  type TurnDeliveredParams,
} from '@uxnan/shared';
import { rm } from 'node:fs/promises';
import type { ThreadStore } from '../conversation/thread-store.js';
import type { Logger } from '../logger.js';
import { materializeAttachments } from './attachments.js';
import { approvalBlock, errorBlock, questionBlock } from '../adapters/content-blocks.js';
import type { QuestionItem } from '@uxnan/shared';

/** How long a tool approval waits for the user before defaulting to deny. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** Build the `approval` content block for a tool the agent wants to run. */
function approvalContent(
  approvalId: string,
  toolName: string,
  input: Record<string, unknown>,
): ApprovalRequestBlock {
  const detail = approvalDetail(input);
  const action = detail ? `Allow ${toolName}: ${detail}` : `Allow ${toolName}`;
  const t = toolName.toLowerCase();
  const risk =
    t === 'bash' || t === 'write' || t === 'edit' || t.includes('delete') ? 'high' : 'medium';
  return approvalBlock(approvalId, action, { risk, ...(detail ? { detail } : {}) });
}

/** Short human description of a tool's input (command / path) for the card. */
function approvalDetail(input: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'file_path', 'path', 'url', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
  }
  return '';
}

/** Display metadata + availability for a registered adapter, surfaced by `agent/list`. */
export interface AgentMeta {
  displayName: string;
  available: boolean;
  deprecated?: boolean;
  defaultModel?: string;
}

export interface TurnEndInfo {
  threadId: string;
  turnId: string;
  status: 'completed' | 'error';
  text?: string;
}

export interface AgentManagerOptions {
  store: ThreadStore;
  /** Broadcast a JSON-RPC notification to connected phones. */
  notify: (message: unknown) => void;
  now: () => number;
  logger: Logger;
  defaultAgent: AgentId;
  /** Optional hook fired when a turn completes or errors (e.g. push notifications). */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /**
   * Whether at least one phone currently has a live channel. The approval
   * auto-reject countdown ({@link APPROVAL_TIMEOUT_MS}) only runs while this is
   * true, so an approval requested while the phone is backgrounded/offline
   * WAITS (its card is replayed from the outbound log on reconnect) instead of
   * defaulting to reject on a prompt the user never saw — which would make the
   * agent take an unauthorized default action and the turn appear "cut".
   * Defaults to always-connected when omitted (preserves the prior timeout
   * behavior, e.g. in tests).
   */
  isPhoneConnected?: () => boolean;
  /**
   * Override the approval auto-reject window in ms (defaults to
   * {@link APPROVAL_TIMEOUT_MS}). Injected so tests can exercise the timeout
   * without waiting minutes.
   */
  approvalTimeoutMs?: number;
}

export interface SendTurnOptions {
  agentId?: AgentId;
  service?: string;
  effort?: string;
  /** Chosen per-model run-option values keyed by `AgentModelOption.key`. */
  options?: Record<string, string | boolean>;
  /** Inline image attachments delivered to the agent for this turn. */
  attachments?: TurnAttachment[];
  cwd?: string;
  /** The thread's persisted access (approval) mode, applied to this turn. */
  accessMode?: AccessMode;
  /**
   * Invoke an advertised agent command instead of free-form text. Resolved here
   * to the final prompt (expanded custom template, or the CLI's native
   * `/name args` form) before the adapter runs; the command form is what's
   * persisted to history. See {@link AgentCommandInvocation}.
   */
  command?: AgentCommandInvocation;
  /**
   * What to do when a turn is already in flight: `true` queue it explicitly,
   * `false` reject with `AgentBusy`, absent queue it anyway. See
   * `TurnSendParams.queue` — queueing is the default because the bridge can only
   * drive one turn per thread.
   */
  queue?: boolean;
}

/** Outcome of {@link AgentManager.sendTurn} — mirrors `TurnSendResult`. */
export interface SendTurnResult {
  turnId: string;
  /** True when the turn was queued behind an in-flight one instead of starting. */
  queued?: boolean;
  /** 1-based place in the queue when `queued` (1 = runs next). */
  queuePosition?: number;
  /**
   * True when the agent took the message **into the turn already running** and
   * it will never run as a turn of its own (status `delivered`). Mutually
   * exclusive with {@link queued}.
   */
  delivered?: boolean;
}

/**
 * A turn waiting for the thread's in-flight turn to end. The user message is
 * already persisted (status `queued`); what lives here is the run context the
 * adapter will need, FROZEN at queue time — the model, effort, access mode and
 * attachments the user had in front of them when they wrote it, not whatever is
 * selected minutes later when it finally runs.
 */
interface QueuedTurn {
  turnId: string;
  assistantMessageId: string;
  /** The prompt text as sent (empty for a command-only / image-only turn). */
  userText: string;
  options: SendTurnOptions;
}

/**
 * How many turns one thread may hold in its queue. A cap keeps a runaway sender
 * from burning through the model's context with messages the agent will read as
 * one long, contradictory instruction list.
 */
const QUEUE_LIMIT = 10;

/**
 * How long streamed prose may wait to be sent as one notification, and how much
 * may accumulate before it is sent regardless.
 *
 * 25 ms sits where the measured burstiness pays off without being felt: on a
 * real recording of 911 deltas it cut 911 notifications to 244 (3.7x), against
 * 2.4x at 10 ms and 5.0x at 40 ms. The window is the worst case a character can
 * wait — well under the ~100 ms at which a person notices a pause, and under
 * the phone's own render coalescing window.
 */
const DELTA_BATCH_WINDOW_MS = 25;
const DELTA_BATCH_MAX_CHARS = 512;

/** One turn's prose waiting to be sent, and the timer that will send it. */
interface PendingText {
  threadId: string;
  messageId: string;
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentManager {
  readonly #adapters = new Map<AgentId, IAgentAdapter>();
  readonly #meta = new Map<AgentId, AgentMeta>();
  readonly #started = new Set<AgentId>();
  readonly #assistantByTurn = new Map<string, string>();
  /** threadId → agent driving it, so we can read its native session id on completion. */
  readonly #agentByThread = new Map<string, AgentId>();
  /** threadId → in-flight turn id, so an approval reply can name the turn it answers. */
  readonly #activeTurnByThread = new Map<string, string>();
  /**
   * threadId → turns waiting for the in-flight one, in run order. LIVE state:
   * it is not rebuilt after a bridge restart, which is why `queued` turns left
   * on disk are cancelled at startup (see `ThreadStore.cancelOrphanedQueuedTurns`)
   * rather than stranded.
   */
  readonly #queueByThread = new Map<string, QueuedTurn[]>();
  /**
   * threadId → why draining is held. Set when a turn is stopped by the user or
   * fails WHILE something is queued: firing the follow-ups at an agent the user
   * just stopped (or that just broke) is the one outcome nobody wants, so the
   * queue waits for an explicit `resumeQueue`/`clearQueue`.
   */
  readonly #queuePausedByThread = new Map<string, QueuePausedReason>();
  /** turnId → temp attachment dir to remove once the turn ends (best-effort). */
  readonly #attachmentDirByTurn = new Map<string, string>();
  /** approvalId → resolver for a pending approval (covers the Claude `PreToolUse`
   * hook round-trip AND the Codex app-server approval elicitations; the pending
   * map is shared so a single `respondApproval` call resolves both). The
   * resolver takes the user's `ApprovalDecision`; the caller (the hook server
   * or the Codex adapter) translates that into the wire shape its protocol
   * expects (`'allow' | 'deny'` for the Claude hook, `ReviewDecision` for
   * Codex). */
  readonly #pendingHookApprovals = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  #approvalSeq = 0;
  /** questionId → resolver for a pending question (the agent's `question` tool);
   * resolves with the chosen answers per question, or `[]` on timeout/skip. Same
   * shape as the approval pending map so `respondQuestion` mirrors `respondApproval`. */
  readonly #pendingQuestions = new Map<
    string,
    {
      resolve: (answers: string[][]) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  #questionSeq = 0;
  readonly #options: AgentManagerOptions;
  /** Whether a phone is connected to see/answer approvals (see options). */
  readonly #isPhoneConnected: () => boolean;
  /** Approval auto-reject window in ms (see options). */
  readonly #approvalTimeoutMs: number;

  constructor(options: AgentManagerOptions) {
    this.#options = options;
    this.#isPhoneConnected = options.isPhoneConnected ?? (() => true);
    this.#approvalTimeoutMs = options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
  }

  register(adapter: IAgentAdapter, meta?: Partial<AgentMeta>): void {
    this.#adapters.set(adapter.agentId, adapter);
    this.#meta.set(adapter.agentId, {
      displayName: meta?.displayName ?? adapter.agentId,
      available: meta?.deprecated === true ? false : (meta?.available ?? true),
      ...(meta?.deprecated === true ? { deprecated: true } : {}),
      ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
    });
    adapter.onEvent((event) => {
      void this.#onEvent(event);
    });
  }

  hasAdapter(agentId: AgentId): boolean {
    return this.#adapters.has(agentId);
  }

  /** Whether the agent's binary resolved (its CLI is installed/usable). */
  isAvailable(agentId: AgentId): boolean {
    return this.#meta.get(agentId)?.available ?? false;
  }

  /** Whether this adapter is retained only for legacy inspection. */
  isDeprecated(agentId: AgentId): boolean {
    return this.#meta.get(agentId)?.deprecated === true;
  }

  /** Registered agents the phone can pick, with capabilities + availability. */
  listAgents(): AgentDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => {
      const meta = this.#meta.get(adapter.agentId);
      return {
        agentId: adapter.agentId,
        displayName: meta?.displayName ?? adapter.agentId,
        available: meta?.deprecated === true ? false : (meta?.available ?? true),
        capabilities: adapter.capabilities,
        ...(meta?.deprecated === true ? { deprecated: true } : {}),
        ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
      };
    });
  }

  /** The bridge's configured default agent. */
  get defaultAgent(): AgentId {
    return this.#options.defaultAgent;
  }

  /** Models the given agent's CLI reports (empty if it can't enumerate them). */
  async getModels(agentId: AgentId): Promise<AgentModel[]> {
    if (this.#meta.get(agentId)?.deprecated === true) return [];
    const adapter = this.#adapters.get(agentId);
    if (!adapter?.listModels) return [];
    try {
      return await adapter.listModels();
    } catch {
      return [];
    }
  }

  /**
   * Special ("slash") commands the given agent exposes — control commands it can
   * run headless plus custom prompt-template commands scanned from `cwd`/user
   * config (empty when the agent advertises none). Never throws: discovery is
   * best-effort so a failing scan degrades to no commands, not a broken palette.
   */
  async getCommands(agentId: AgentId, cwd?: string): Promise<AgentCommand[]> {
    if (this.#meta.get(agentId)?.deprecated === true) return [];
    const adapter = this.#adapters.get(agentId);
    if (!adapter?.listCommands) return [];
    try {
      return await adapter.listCommands(cwd);
    } catch {
      return [];
    }
  }

  /**
   * Resolve an {@link AgentCommandInvocation} to the prompt text the agent runs:
   * a custom prompt-template command is expanded by the adapter; a native
   * control command becomes the CLI's `/name args` form (Claude Code / ACP
   * agents interpret it directly). Falls back to the native form when expansion
   * is unavailable or fails, so a command never hard-fails a turn.
   */
  async #resolveCommandText(
    adapter: IAgentAdapter,
    command: AgentCommandInvocation,
    cwd?: string,
  ): Promise<string> {
    const args = command.args?.trim();
    if (adapter.expandCommand) {
      try {
        return await adapter.expandCommand(command.name, args || undefined, cwd);
      } catch (err) {
        this.#options.logger.warn(
          `command expansion failed for '${command.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return args && args.length > 0 ? `/${command.name} ${args}` : `/${command.name}`;
  }

  /** The `/name args` form of a command, shown in history instead of its expansion. */
  #commandDisplay(command: AgentCommandInvocation): string {
    const args = command.args?.trim();
    return args && args.length > 0 ? `/${command.name} ${args}` : `/${command.name}`;
  }

  /**
   * Start a turn: persist the user message, drive the adapter, return the turn
   * id — **or queue it** when the thread already has a turn in flight (or a
   * non-empty queue). Queueing is what the agent CLIs do when you type a
   * follow-up while they work, and here it is also the only safe answer: the
   * bridge drives one turn per thread, and half the agents run one-shot per turn
   * (`claude -p --resume`, pi, antigravity), so starting a second turn
   * concurrently would put two CLI processes on the same session.
   */
  async sendTurn(
    threadId: string,
    userText: string,
    options: SendTurnOptions = {},
  ): Promise<SendTurnResult> {
    const agentId = options.agentId ?? this.#options.defaultAgent;
    if (this.#meta.get(agentId)?.deprecated === true) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `agent '${agentId}' is deprecated and cannot run new turns`,
      );
    }
    const adapter = this.#adapters.get(agentId);
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no adapter registered for agent '${agentId}'`,
      );
    }

    const attachments = options.attachments ?? [];
    // A command invocation carries no free-form text: show the command (`/name
    // args`), not its expansion, in history — the expanded prompt can be large.
    const commandDisplay = options.command ? this.#commandDisplay(options.command) : undefined;
    // Persist a faithful user message (no temp paths): the command form, the
    // original text, or a short placeholder for an image-only turn so history
    // isn't a blank bubble.
    const persistBase = commandDisplay ?? userText;
    const persistText =
      persistBase.length > 0
        ? persistBase
        : attachments.length > 0
          ? `[${attachments.length} image attachment${attachments.length > 1 ? 's' : ''}]`
          : persistBase;

    // A queue that is merely PAUSED still queues: draining is held, so starting
    // this turn now would run it ahead of messages the user sent earlier.
    const queue = this.#queue(threadId);
    if (this.#activeTurnByThread.has(threadId) || queue.length > 0) {
      return this.#enqueueTurn(threadId, agentId, adapter, persistText, userText, options);
    }

    const started = await this.#options.store.startTurn(threadId, persistText, this.#options.now());
    await this.#runTurn(threadId, agentId, adapter, {
      turnId: started.turnId,
      assistantMessageId: started.assistantMessageId,
      userText,
      options,
    });
    return { turnId: started.turnId };
  }

  /** Persists a turn as `queued` and parks it behind the in-flight one. */
  async #enqueueTurn(
    threadId: string,
    agentId: AgentId,
    adapter: IAgentAdapter,
    persistText: string,
    userText: string,
    options: SendTurnOptions,
  ): Promise<SendTurnResult> {
    if (options.queue === false) {
      throw new RpcError(
        JsonRpcErrorCode.AgentBusy,
        'a turn is already in flight on this thread; retry without `queue: false` to queue it',
      );
    }
    const queue = this.#queue(threadId);
    if (queue.length >= QUEUE_LIMIT) {
      throw new RpcError(
        JsonRpcErrorCode.AgentBusy,
        `the thread's message queue is full (${QUEUE_LIMIT})`,
      );
    }
    const queued = await this.#options.store.queueTurn(threadId, persistText, this.#options.now());
    // The agent is recorded now so a `turn/cancel` for this queued turn — and any
    // later cancel on the thread — reaches the right adapter even if it is the
    // first thing this thread ever ran.
    this.#agentByThread.set(threadId, agentId);
    const entry: QueuedTurn = {
      turnId: queued.turnId,
      assistantMessageId: queued.assistantMessageId,
      userText,
      options: { ...options, agentId },
    };

    // Agents whose CLI has an input channel mid-turn take the message NOW,
    // inside the running turn, instead of parking it here.
    if (await this.#tryDeliverMidTurn(threadId, adapter, entry)) {
      return { turnId: queued.turnId, delivered: true };
    }

    queue.push(entry);
    this.#notifyQueue(threadId);
    return { turnId: queued.turnId, queued: true, queuePosition: queue.length };
  }

  /**
   * Hand a just-queued turn straight to the running one, the way a CLI picks up
   * what you type while it works. Returns whether the agent took it.
   *
   * Deliberately conservative — it only tries when the message would otherwise
   * be *next*, so the thread's order is never rearranged:
   *  - the adapter must advertise `steering` and implement `steerTurn`;
   *  - a turn must actually be in flight;
   *  - the queue must be EMPTY (something already waiting means an earlier
   *    message goes first) and NOT paused (the user stopped the agent, or it
   *    broke — pushing more at it is exactly what pausing exists to prevent).
   *
   * Any refusal or failure leaves the turn queued, which is the behaviour that
   * shipped before this path existed: the message is never lost, it just waits.
   */
  async #tryDeliverMidTurn(
    threadId: string,
    adapter: IAgentAdapter,
    entry: QueuedTurn,
  ): Promise<boolean> {
    if (adapter.capabilities.steering !== true || !adapter.steerTurn) return false;
    if (this.#queuePausedByThread.has(threadId)) return false;
    if ((this.#queueByThread.get(threadId)?.length ?? 0) > 0) return false;
    const activeTurnId = this.#activeTurnByThread.get(threadId);
    if (!activeTurnId) return false;

    // The turn's own text still needs the command/attachment resolution a
    // normal turn gets, so a steered `/command` or image behaves identically.
    let text: string;
    try {
      text = await this.#resolveTurnText(adapter, entry, activeTurnId);
    } catch (err) {
      this.#options.logger.warn(`could not prepare a mid-turn message: ${String(err)}`);
      return false;
    }

    let taken = false;
    try {
      taken = await adapter.steerTurn({
        ...entry.options,
        threadId,
        turnId: entry.turnId,
        activeTurnId,
        text,
      });
    } catch (err) {
      // A broken transport is not the user's problem: fall back to queueing.
      this.#options.logger.warn(`mid-turn delivery failed, queueing instead: ${String(err)}`);
      return false;
    }
    if (!taken) return false;

    // Re-check: `steerTurn` is async, so the turn may have ended while it ran.
    // The agent still received the text — a CLI that took the message and then
    // finished has already answered it — so the turn is `delivered` either way;
    // what we must not do is claim it joined a turn that is no longer current.
    await this.#options.store.deliverQueuedTurn(
      threadId,
      entry.turnId,
      activeTurnId,
      this.#options.now(),
    );
    this.#options.notify(
      makeNotification(StreamNotification.TurnDelivered, {
        threadId,
        turnId: entry.turnId,
        intoTurnId: activeTurnId,
      } satisfies TurnDeliveredParams),
    );
    return true;
  }

  /**
   * Hands an already-persisted turn to its adapter and marks it in-flight.
   * Shared by a turn that starts immediately and one promoted off the queue, so
   * both go through the identical command/attachment/adapter path.
   */
  async #runTurn(
    threadId: string,
    agentId: AgentId,
    adapter: IAgentAdapter,
    turn: QueuedTurn,
  ): Promise<void> {
    const { turnId, assistantMessageId, options } = turn;
    const attachments = options.attachments ?? [];
    this.#assistantByTurn.set(turnId, assistantMessageId);
    this.#agentByThread.set(threadId, agentId);
    this.#activeTurnByThread.set(threadId, turnId);

    if (!this.#started.has(agentId)) {
      await adapter.start({ agentId, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
      this.#started.add(agentId);
    }

    const agentText = await this.#resolveTurnText(adapter, turn, turnId);

    await adapter.sendTurn({
      threadId,
      turnId,
      text: agentText,
      ...(options.service !== undefined ? { service: options.service } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(options.options !== undefined ? { options: options.options } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.accessMode !== undefined ? { accessMode: options.accessMode } : {}),
      ...(options.command !== undefined ? { command: options.command } : {}),
    });
  }

  /**
   * The text the agent actually receives for a turn: a command invocation
   * resolved to its real prompt, plus a reference to any image attachment
   * materialized into the CLI's workspace.
   *
   * Shared by a turn that runs on its own and one steered into a running turn,
   * so a `/command` or an image behaves identically either way.
   *
   * `attachmentOwnerTurnId` is the turn whose completion cleans the temp dir
   * up. For a steered message that is the RUNNING turn, not the delivered one:
   * a delivered turn never reaches the completion path that sweeps the dir, so
   * keying it there would leak the files.
   */
  async #resolveTurnText(
    adapter: IAgentAdapter,
    turn: QueuedTurn,
    attachmentOwnerTurnId: string,
  ): Promise<string> {
    const { turnId, userText, options } = turn;
    const attachments = options.attachments ?? [];

    // Resolve a command invocation to the prompt the agent actually runs (an
    // expanded custom template, or the CLI's native `/name args` form). A plain
    // turn keeps its text verbatim.
    let agentText = options.command
      ? await this.#resolveCommandText(adapter, options.command, options.cwd)
      : userText;

    // Materialize image attachments to files and reference them in the prompt
    // so any file/vision-capable agent CLI can open them. The files MUST land
    // in the directory the CLI actually runs in — every supported agent
    // refuses to read outside its workspace (verified: Claude answers "the
    // read was blocked by a permission prompt" for a path in the OS temp dir)
    // — so a turn without its own `cwd` falls back to the adapter's, never to
    // a directory the agent cannot reach. Best-effort: a failure to write
    // degrades to a text-only turn, never aborts it.
    // An adapter whose protocol carries images natively (Zero's ACP image
    // block) consumes `attachments` itself in sendTurn — writing files and
    // pointing at them would only invite it to read a binary as text.
    if (attachments.length > 0 && !adapter.handlesAttachments?.()) {
      try {
        const attachmentCwd = options.cwd ?? adapter.defaultCwd?.();
        const materialized = await materializeAttachments(attachments, turnId, {
          ...(attachmentCwd !== undefined ? { cwd: attachmentCwd } : {}),
        });
        if (materialized.note) {
          agentText =
            agentText.length > 0 ? `${agentText}\n\n${materialized.note}` : materialized.note;
        }
        if (materialized.dir)
          this.#attachmentDirByTurn.set(attachmentOwnerTurnId, materialized.dir);
      } catch (err) {
        this.#options.logger.warn(`attachment materialization failed: ${String(err)}`);
      }
    }
    return agentText;
  }

  /**
   * Give the thread a real name once its first turn has an answer.
   *
   * No agent CLI does this for us — every one of them leaves titling to its
   * client (a thread uxnan creates comes back from Codex with `name: null`), so
   * uxnan names its own conversations, exactly as their desktop clients do.
   *
   * Only ever runs **once per thread**, and only while the title is still the
   * provisional one taken from the opening message: `applyGeneratedTitle`
   * refuses to overwrite a name the user chose, so a rename made while the turn
   * was running always wins.
   *
   * Entirely best-effort. A failure here must never touch the conversation, so
   * everything is swallowed and the thread simply keeps its provisional name.
   */
  async #nameThread(threadId: string, turnId: string, assistantText: string): Promise<void> {
    try {
      const thread = await this.#options.store.getThread(threadId);
      if (thread.titleSource !== undefined && thread.titleSource !== 'prompt') return;
      // Second and later turns: the name was already decided (or declined).
      if (thread.turnCount > 1) return;

      const agentId = this.#agentByThread.get(threadId) ?? this.#options.defaultAgent;
      const adapter = this.#adapters.get(agentId);
      if (!adapter?.generateTitle) return;

      const userText = await this.#userText(turnId);
      if (!userText) return;

      const title = await adapter.generateTitle({
        userText,
        ...(assistantText ? { assistantText } : {}),
        ...(thread.cwd !== undefined ? { cwd: thread.cwd } : {}),
      });
      if (!title) return;

      const updated = await this.#options.store.applyGeneratedTitle(
        threadId,
        title,
        this.#options.now(),
      );
      // `undefined` means the store declined — the user renamed it meanwhile,
      // or the name was already this. Either way there is nothing to announce.
      if (!updated) return;
      this.#options.notify(
        makeNotification(StreamNotification.ThreadRenamed, {
          threadId,
          title: updated.title,
          titleSource: 'agent',
        } satisfies ThreadRenamedParams),
      );
    } catch (err) {
      this.#options.logger.warn(`could not name thread ${threadId}: ${String(err)}`);
    }
  }

  /** The user's message on [turnId], for summarizing. */
  async #userText(turnId: string): Promise<string | undefined> {
    try {
      const turn = await this.#options.store.getTurn(turnId);
      const message = turn.messages.find((m) => m.role === 'user');
      const content = message?.content;
      return typeof content === 'string' && content.trim().length > 0 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Ask the user (via the phone) whether an agent tool may run. Emits an
   * `approval` content block on the thread's in-flight turn and resolves once
   * {@link respondApproval} arrives (or after {@link APPROVAL_TIMEOUT_MS} →
   * `reject`).
   *
   * The return type is the full {@link ApprovalDecision}: callers translate it
   * into the wire shape their protocol expects — the Claude `PreToolUse` hook
   * uses `allow`/`deny`, the Codex app-server uses the `ReviewDecision` oneOf
   * (`approved` / `approved_for_session` / `denied` / `abort` / `timed_out`).
   * A common pending map + common resolver keeps the phone's reply path
   * (`turn/send { approvalResponse }`) uniform for both backends.
   */
  async requestApproval(
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ): Promise<ApprovalDecision> {
    const turnId = this.#activeTurnByThread.get(threadId);
    if (!turnId) return 'reject'; // no in-flight turn to attach the approval to
    const approvalId = `appr-${turnId}-${(this.#approvalSeq += 1)}`;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const content = approvalContent(approvalId, info.toolName, info.input);
    try {
      await this.#options.store.appendBlock(threadId, turnId, content, this.#options.now());
    } catch {
      /* best-effort persistence */
    }
    this.#options.notify(
      makeNotification(StreamNotification.ContentBlock, { threadId, turnId, messageId, content }),
    );
    return new Promise<ApprovalDecision>((resolve) => {
      this.#pendingHookApprovals.set(approvalId, { resolve, timer: undefined });
      // Only start the auto-reject countdown while a phone is connected to see
      // and answer the card. While offline the approval WAITS (the card replays
      // from the outbound log on reconnect), so the agent never takes an
      // unauthorized default the user never saw. The countdown (re)starts when a
      // phone (re)connects — see onPhoneConnected.
      if (this.#isPhoneConnected()) this.#armApprovalTimeout(approvalId);
    });
  }

  /**
   * (Re)arms the auto-reject countdown for a pending approval. Idempotent —
   * clears any existing timer first, so a phone reconnect grants a fresh window.
   */
  #armApprovalTimeout(approvalId: string): void {
    const pending = this.#pendingHookApprovals.get(approvalId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.#pendingHookApprovals.delete(approvalId);
      pending.resolve('reject');
    }, this.#approvalTimeoutMs);
  }

  /**
   * A phone (re)connected: grant a fresh auto-reject window to every approval
   * that was waiting while the user was away (its card is replayed on
   * reconnect), so the user actually gets time to answer it.
   */
  onPhoneConnected(): void {
    for (const approvalId of this.#pendingHookApprovals.keys()) {
      this.#armApprovalTimeout(approvalId);
    }
    for (const questionId of this.#pendingQuestions.keys()) {
      this.#armQuestionTimeout(questionId);
    }
  }

  /**
   * The last phone disconnected: stop every approval/question auto-resolve
   * countdown so a pending elicitation waits for the user to return instead of
   * defaulting on a card they never saw. No-op while any phone is still connected.
   */
  onPhoneDisconnected(): void {
    if (this.#isPhoneConnected()) return;
    for (const pending of this.#pendingHookApprovals.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
    }
    for (const pending of this.#pendingQuestions.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
    }
  }

  /**
   * Route a user's approval decision. Resolves a pending approval (shared by
   * the Claude `PreToolUse` hook round-trip AND the Codex app-server
   * elicitations) with the user's {@link ApprovalDecision}; the caller that
   * started the request translates that into its protocol's wire shape.
   * Otherwise, when no hook/app-server approval is pending, forwards to the
   * agent adapter's `respondApproval` (e.g. the Echo demo) — no new turn is
   * created. Returns the in-flight turn id (or `''`) so the `turn/send` reply
   * still carries a `turnId`.
   */
  async respondApproval(
    threadId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<{ turnId: string }> {
    // Capture the in-flight turn id UP FRONT: resolving the approval can drive
    // the turn straight to completion (the Echo demo does), which clears
    // `#activeTurnByThread` before we return — so read it while it is still set
    // and report that regardless of when the completion event lands.
    const turnId = this.#activeTurnByThread.get(threadId) ?? '';
    const pending = this.#pendingHookApprovals.get(approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingHookApprovals.delete(approvalId);
      pending.resolve(decision);
      return { turnId };
    }
    const agentId = this.#agentByThread.get(threadId);
    const adapter = agentId ? this.#adapters.get(agentId) : undefined;
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no active agent for thread '${threadId}'`,
      );
    }
    if (!adapter.respondApproval) {
      throw new RpcError(
        JsonRpcErrorCode.InvalidParams,
        `agent '${agentId}' does not support approvals`,
      );
    }
    await adapter.respondApproval(threadId, approvalId, decision);
    return { turnId };
  }

  /**
   * Ask the user (via the phone) to answer the agent's multiple-choice
   * {@link QuestionItem}s. Emits a `question` content block on the thread's
   * in-flight turn and resolves once {@link respondQuestion} arrives with the
   * chosen answers (or after {@link APPROVAL_TIMEOUT_MS} → `[]`, i.e. no answer,
   * so the adapter can skip/reject and unblock the turn). Mirrors
   * {@link requestApproval}; the caller (the OpenCode adapter) translates the
   * returned answers into its CLI's reply shape.
   */
  async requestQuestion(threadId: string, questions: QuestionItem[]): Promise<string[][]> {
    const turnId = this.#activeTurnByThread.get(threadId);
    if (!turnId) return []; // no in-flight turn to attach the question to
    const questionId = `qst-${turnId}-${(this.#questionSeq += 1)}`;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const content = questionBlock(questionId, questions);
    try {
      await this.#options.store.appendBlock(threadId, turnId, content, this.#options.now());
    } catch {
      /* best-effort persistence */
    }
    this.#options.notify(
      makeNotification(StreamNotification.ContentBlock, { threadId, turnId, messageId, content }),
    );
    return new Promise<string[][]>((resolve) => {
      this.#pendingQuestions.set(questionId, { resolve, timer: undefined });
      // Same offline posture as approvals: only run the auto-skip countdown while
      // a phone is connected to see and answer the card (see onPhoneConnected).
      if (this.#isPhoneConnected()) this.#armQuestionTimeout(questionId);
    });
  }

  /** (Re)arms the auto-skip countdown for a pending question. Idempotent. */
  #armQuestionTimeout(questionId: string): void {
    const pending = this.#pendingQuestions.get(questionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.#pendingQuestions.delete(questionId);
      pending.resolve([]);
    }, this.#approvalTimeoutMs);
  }

  /**
   * Route a user's answer to a pending question (resolves the `requestQuestion`
   * promise). No new turn is created. Returns the in-flight turn id (or `''`) so
   * the `turn/send` reply still carries a `turnId`.
   */
  respondQuestion(
    threadId: string,
    questionId: string,
    answers: string[][],
  ): Promise<{ turnId: string }> {
    const pending = this.#pendingQuestions.get(questionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingQuestions.delete(questionId);
      pending.resolve(answers);
    }
    return Promise.resolve({ turnId: this.#activeTurnByThread.get(threadId) ?? '' });
  }

  /**
   * The turn currently in-flight for [threadId] (an agent is actively producing
   * it in THIS bridge process), or `undefined` when the thread is idle. Reflects
   * LIVE state: set on `sendTurn`, cleared on turn completion/error/abort, and
   * never persisted — so after a bridge restart it is `undefined` even though a
   * turn's stored `status` may still read `streaming`. Authoritative for "is a
   * turn running now?"; the phone re-attaches its streaming view to it on
   * resync (surfaced via `turn/list` → `activeTurnId`).
   */
  activeTurnId(threadId: string): string | undefined {
    return this.#activeTurnByThread.get(threadId);
  }

  async cancelTurn(threadId: string, turnId: string, agentId?: AgentId): Promise<void> {
    // A QUEUED turn never reached an adapter, so cancelling it is purely local:
    // drop it from the queue and mark it `cancelled` (kept in the thread, so the
    // user's message stays visible with its mark). Checked first — routing it to
    // an adapter would be a no-op that leaves the turn queued forever.
    if (await this.#cancelQueuedTurn(threadId, turnId)) return;
    // Whatever this turn had produced is already persisted; send it before the
    // cancel so the phone's live view is not left missing its last words.
    this.#flushText(turnId);
    // Resolve the thread's OWN agent (as respondApproval/respondQuestion do), not
    // the default: a cancel for a thread running on a non-default agent must reach
    // that agent's adapter, otherwise the wrong adapter no-ops and the turn keeps
    // running. Explicit agentId wins; then the per-thread agent; then the default.
    const resolved = agentId ?? this.#agentByThread.get(threadId) ?? this.#options.defaultAgent;
    const adapter = this.#adapters.get(resolved);
    if (adapter) {
      await adapter.cancelTurn(threadId, turnId);
    }
  }

  /**
   * Removes [turnId] from [threadId]'s queue if it is there. Returns whether it
   * was (so {@link cancelTurn} knows not to bother an adapter with it).
   */
  async #cancelQueuedTurn(threadId: string, turnId: string): Promise<boolean> {
    const queue = this.#queueByThread.get(threadId);
    const index = queue?.findIndex((entry) => entry.turnId === turnId) ?? -1;
    if (!queue || index < 0) return false;
    queue.splice(index, 1);
    await this.#options.store.cancelQueuedTurn(threadId, turnId, this.#options.now());
    this.#options.notify(makeNotification(StreamNotification.TurnCancelled, { threadId, turnId }));
    // Dropping the last queued turn also lifts a pause: there is nothing left to
    // hold, and leaving the flag set would show a "queue paused" banner over an
    // empty queue.
    if (queue.length === 0) this.#queuePausedByThread.delete(threadId);
    this.#notifyQueue(threadId);
    return true;
  }

  /** The thread's live queue state, as `turn/list` and `queue/*` report it. */
  queueState(threadId: string): QueueStateResult {
    const paused = this.#queuePausedByThread.get(threadId);
    return {
      queuedTurnIds: (this.#queueByThread.get(threadId) ?? []).map((entry) => entry.turnId),
      paused: paused !== undefined,
      ...(paused !== undefined ? { pausedReason: paused } : {}),
    };
  }

  /** Lifts a pause and drains the queue (no-op when it was not paused). */
  async resumeQueue(threadId: string): Promise<QueueStateResult> {
    this.#queuePausedByThread.delete(threadId);
    this.#notifyQueue(threadId);
    await this.#drainQueue(threadId);
    return this.queueState(threadId);
  }

  /** Drops every queued turn (each → `cancelled`) and clears the paused state. */
  async clearQueue(threadId: string): Promise<QueueStateResult> {
    const queue = this.#queueByThread.get(threadId) ?? [];
    const dropped = queue.splice(0, queue.length);
    this.#queuePausedByThread.delete(threadId);
    const now = this.#options.now();
    for (const entry of dropped) {
      try {
        await this.#options.store.cancelQueuedTurn(threadId, entry.turnId, now);
        this.#options.notify(
          makeNotification(StreamNotification.TurnCancelled, {
            threadId,
            turnId: entry.turnId,
          }),
        );
      } catch (err) {
        this.#options.logger.warn(`could not mark a queued turn cancelled: ${String(err)}`);
      }
    }
    this.#notifyQueue(threadId);
    return this.queueState(threadId);
  }

  /** The thread's queue, created on first use. */
  #queue(threadId: string): QueuedTurn[] {
    const existing = this.#queueByThread.get(threadId);
    if (existing) return existing;
    const created: QueuedTurn[] = [];
    this.#queueByThread.set(threadId, created);
    return created;
  }

  /** Broadcasts the thread's whole queue state (idempotent for the client). */
  #notifyQueue(threadId: string): void {
    const state = this.queueState(threadId);
    this.#options.notify(
      makeNotification(StreamNotification.QueueUpdated, {
        threadId,
        queuedTurnIds: state.queuedTurnIds,
        paused: state.paused,
        ...(state.pausedReason !== undefined ? { pausedReason: state.pausedReason } : {}),
      }),
    );
  }

  /**
   * Holds the queue after a turn was stopped or failed. Only meaningful while
   * something is queued — pausing an empty queue would surface a "paused" banner
   * with nothing behind it.
   */
  #pauseQueue(threadId: string, reason: QueuePausedReason): void {
    if ((this.#queueByThread.get(threadId)?.length ?? 0) === 0) return;
    this.#queuePausedByThread.set(threadId, reason);
    this.#notifyQueue(threadId);
  }

  /**
   * Starts the next queued turn, if the thread is idle and not paused. Failures
   * are contained: the turn that could not start is failed and the queue pauses,
   * rather than the whole queue silently stalling with no visible reason.
   */
  async #drainQueue(threadId: string): Promise<void> {
    if (this.#queuePausedByThread.has(threadId)) return;
    if (this.#activeTurnByThread.has(threadId)) return;
    const queue = this.#queueByThread.get(threadId);
    const next = queue?.shift();
    if (!next) return;

    const agentId = next.options.agentId ?? this.#options.defaultAgent;
    const adapter = this.#adapters.get(agentId);
    const now = this.#options.now();
    try {
      if (!adapter) {
        throw new RpcError(
          JsonRpcErrorCode.AgentNotRunning,
          `no adapter registered for agent '${agentId}'`,
        );
      }
      await this.#options.store.beginQueuedTurn(threadId, next.turnId, now);
      this.#notifyQueue(threadId);
      await this.#runTurn(threadId, agentId, adapter, next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#options.logger.warn(`queued turn ${next.turnId} could not start: ${message}`);
      this.#activeTurnByThread.delete(threadId);
      this.#assistantByTurn.delete(next.turnId);
      try {
        await this.#options.store.failTurn(threadId, next.turnId, now);
      } catch {
        /* best-effort: the notification below is what the phone acts on */
      }
      this.#options.notify(
        makeNotification(StreamNotification.TurnError, {
          threadId,
          turnId: next.turnId,
          error: { code: JsonRpcErrorCode.BridgeError, message },
        }),
      );
      this.#pauseQueue(threadId, 'turnError');
    }
  }

  async stopAll(): Promise<void> {
    for (const turnId of [...this.#pendingText.keys()]) this.#flushText(turnId);
    for (const [agentId, adapter] of this.#adapters) {
      if (this.#started.has(agentId)) {
        await adapter.stop().catch(() => undefined);
      }
    }
    this.#started.clear();
  }

  /**
   * Text deltas waiting to be sent as one notification, per turn.
   *
   * Agents emit prose in bursts, not at a steady rate: measured on a real
   * OpenCode turn, 60% of deltas arrived within 5 ms of the previous one (911
   * deltas, gaps p10 1.4 ms / p50 3.0 ms / p90 27.7 ms). Sending each one
   * separately paid a JSON serialization, an AES-GCM seal and a WebSocket frame
   * per handful of characters — and the phone paid the mirror of that to open
   * them. Coalescing over a 25 ms window cut it to a third of the
   * notifications on that same recording, for a delay nobody can perceive.
   */
  readonly #pendingText = new Map<string, PendingText>();

  /**
   * Sends whatever text is buffered for [turnId] right now.
   *
   * Called before EVERY non-delta event (see `#onEvent`) because order is the
   * whole contract here: a block carries `beforeText` so the phone can place it
   * against the open text run, and a turn's completion must not overtake the
   * prose that preceded it. Flushing from one place at the top of the handler is
   * what makes it impossible for a new event type to forget.
   */
  #flushText(turnId: string): void {
    const pending = this.#pendingText.get(turnId);
    if (pending === undefined) return;
    this.#pendingText.delete(turnId);
    clearTimeout(pending.timer);
    this.#options.notify(
      makeNotification(StreamNotification.MessageDelta, {
        threadId: pending.threadId,
        turnId,
        messageId: pending.messageId,
        delta: pending.text,
      }),
    );
  }

  /** Buffers one streamed delta, sending the batch when it is full or due. */
  #bufferText(threadId: string, turnId: string, messageId: string, delta: string): void {
    if (delta.length === 0) return;
    const pending = this.#pendingText.get(turnId);
    if (pending === undefined) {
      const timer = setTimeout(() => this.#flushText(turnId), DELTA_BATCH_WINDOW_MS);
      // Never let a pending batch hold the process open on shutdown.
      timer.unref?.();
      this.#pendingText.set(turnId, { threadId, messageId, text: delta, timer });
    } else {
      pending.text += delta;
    }
    if ((this.#pendingText.get(turnId)?.text.length ?? 0) >= DELTA_BATCH_MAX_CHARS) {
      this.#flushText(turnId);
    }
  }

  async #onEvent(event: AgentStreamEvent): Promise<void> {
    const { threadId, turnId } = event;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const now = this.#options.now();
    // Anything that is not more prose closes the open batch first, so the
    // stream the phone sees is in the order the agent produced it.
    if (event.type !== 'delta') this.#flushText(turnId);
    try {
      switch (event.type) {
        case 'turn_started':
          this.#options.notify(
            makeNotification(StreamNotification.TurnStarted, { threadId, turnId }),
          );
          break;
        case 'model_resolved': {
          const model = readText(event.data);
          if (model) {
            this.#options.notify(
              makeNotification(StreamNotification.ModelResolved, { threadId, turnId, model }),
            );
          }
          break;
        }
        case 'delta': {
          const delta = readText(event.data);
          // Buffered BEFORE the store write, and both are synchronous up to
          // here: adapters emit events without awaiting the handler
          // (`void this.#onEvent`), so only the synchronous prefix of each
          // handler is guaranteed to run in arrival order. Buffering there is
          // what keeps a terminal event that lands mid-write from flushing an
          // empty buffer and overtaking the prose that preceded it. The store
          // still receives this delta before `completeTurn` — that call is
          // enqueued on the same mutex, from a handler that started later.
          this.#bufferText(threadId, turnId, messageId, delta);
          // Persisted per delta, exactly as before: the batching is about how
          // OFTEN the phone is told, never about when this becomes durable.
          await this.#options.store.appendDelta(threadId, turnId, delta, now);
          break;
        }
        case 'thinking': {
          const delta = readText(event.data);
          await this.#options.store.appendThinking(threadId, turnId, delta, now);
          this.#options.notify(
            makeNotification(StreamNotification.ThinkingDelta, {
              threadId,
              turnId,
              messageId,
              delta,
            }),
          );
          break;
        }
        case 'block': {
          const content = readContent(event.data);
          if (content !== undefined) {
            // A block flagged `beforeText` came from a parallel/background
            // activity while the main text was still streaming: the store slots
            // it before the open text run (never severing it), and the flag
            // rides on the notification so the phone's live buffer applies the
            // identical placement — live view and re-sync render the same order.
            const beforeText = readBeforeText(event.data);
            // Notified from the handler's SYNCHRONOUS prefix, before the store
            // write is awaited — which is the only part of a handler guaranteed
            // to run in arrival order, since adapters emit without awaiting
            // (`void this.#onEvent`). Announcing after the await let a delta
            // that arrived during it overtake the block: the phone was told
            // "Son 24." before the command whose output that sentence
            // describes, and the work log read out of order. CI caught it as
            // `[delta, delta, block]`.
            //
            // Persistence still follows immediately, and is what a re-sync
            // reads. Telling the phone before the disk agrees is the same
            // trade the streamed prose above already makes: when it becomes
            // durable is a separate question from when the phone is told.
            this.#options.notify(
              makeNotification(StreamNotification.ContentBlock, {
                threadId,
                turnId,
                messageId,
                content,
                ...(beforeText ? { beforeText } : {}),
              }),
            );
            await this.#options.store.appendBlock(threadId, turnId, content, now, beforeText);
          }
          break;
        }
        case 'turn_completed': {
          const provided = readOptionalText(event.data);
          // A turn ends once. An adapter whose CLI outlives its own end-of-turn
          // event can emit a second completion for the same turn (Claude Code
          // does, when the model leaves background work running and the CLI
          // wakes it again later); acting on it would notify the phone twice and
          // — worse — drain the message queue a second time, starting a queued
          // follow-up against a CLI that is still running.
          const alreadyEnded = await this.#hasEnded(threadId, turnId);
          if (alreadyEnded) break;
          // Clear the in-flight marker BEFORE persisting the terminal status.
          // `store.completeTurn` flips the turn's status to `completed` INSIDE
          // its mutation — observable via `getTurn` before the promise even
          // resolves — and `turn/list` derives `activeTurnId` from this map.
          // Clearing it first guarantees no observer (a racing `turn/list`, the
          // phone's "responding…" indicator) ever sees a turn reported as
          // `completed` yet still active; the two flip together.
          this.#activeTurnByThread.delete(threadId);
          await this.#options.store.completeTurn(threadId, turnId, provided, now);
          const text = await this.#assistantText(turnId, provided);
          const usage = readUsage(event.data);
          if (usage) await this.#options.store.setUsage(threadId, turnId, usage, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnCompleted, {
              threadId,
              turnId,
              messageId,
              text,
              ...(usage !== undefined ? { usage } : {}),
            }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'completed', text });
          // Now there is an answer to summarize, so the thread can stop living
          // with the opening message as its name. Deliberately NOT awaited: it
          // spawns a CLI, and the queue must drain the instant the turn ends.
          void this.#nameThread(threadId, turnId, text);
          // The turn ended cleanly — this is the moment a queued follow-up runs.
          await this.#drainQueue(threadId);
          break;
        }
        case 'turn_error': {
          const message = readOptionalText(event.data) ?? 'agent error';
          // Clear the in-flight marker before persisting the terminal status
          // (same race as turn_completed — the status is observable via
          // `getTurn` before `failTurn` resolves).
          this.#activeTurnByThread.delete(threadId);
          // Persist the reason as an error content block in the turn's history so
          // a `turn/list` re-sync (e.g. after a bridge restart) still shows *why*
          // the turn failed. NOT broadcast as a `stream/content/block` — the phone
          // renders the failure live from the `turn/error` notification below, so
          // notifying here too would double the banner. Best-effort.
          try {
            await this.#options.store.appendBlock(threadId, turnId, errorBlock(message), now);
          } catch {
            /* best-effort persistence */
          }
          await this.#options.store.failTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnError, {
              threadId,
              turnId,
              error: { code: JsonRpcErrorCode.BridgeError, message },
            }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'error', text: message });
          // The agent broke (auth, balance, a dead CLI). Hold the queue instead
          // of feeding follow-ups to something that just failed.
          this.#pauseQueue(threadId, 'turnError');
          break;
        }
        case 'turn_aborted':
          // Clear the in-flight marker before persisting the terminal status
          // (same race as turn_completed).
          this.#activeTurnByThread.delete(threadId);
          await this.#options.store.abortTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnAborted, { threadId, turnId }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          // The user stopped this turn. They stopped it for a reason, so the
          // follow-ups they queued earlier wait for an explicit resume.
          this.#pauseQueue(threadId, 'turnAborted');
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#options.logger.warn(`agent event handling failed: ${message}`);
      // A non-terminal event failing is survivable — the turn keeps streaming
      // and the next event can still finish it. A TERMINAL one failing is not:
      // nothing else will ever move this turn out of `streaming`, so the phone
      // would sit on "responding…" until the app is killed. Persistence is
      // already retried where it is flaky (`DaemonState.writeJson`); this is the
      // last resort when it fails anyway — surface it instead of hanging.
      if (
        event.type === 'turn_completed' ||
        event.type === 'turn_error' ||
        event.type === 'turn_aborted'
      ) {
        this.#activeTurnByThread.delete(threadId);
        this.#assistantByTurn.delete(turnId);
        try {
          await this.#options.store.failTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnError, {
              threadId,
              turnId,
              error: {
                code: JsonRpcErrorCode.BridgeError,
                message: `the turn ended but could not be finalized: ${message}`,
              },
            }),
          );
        } catch (failErr) {
          this.#options.logger.error(
            `could not fail a turn whose terminal event threw: ${
              failErr instanceof Error ? failErr.message : String(failErr)
            }`,
          );
        }
        // However this turn ended, it ended badly — hold the queue rather than
        // starting the next turn on top of a thread we could not finalize.
        this.#pauseQueue(threadId, 'turnError');
      }
    }
  }

  /**
   * Remove a turn's temp attachment directory once the turn ends. Best-effort:
   * the agent has already read the files by completion, and a failure to delete
   * (e.g. the dir vanished) is non-fatal.
   */
  async #cleanupAttachments(turnId: string): Promise<void> {
    const dir = this.#attachmentDirByTurn.get(turnId);
    if (!dir) return;
    this.#attachmentDirByTurn.delete(turnId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Persist the agent's native session id for a thread so the on-disk history
   * fallback can locate its session log after a restart. Best-effort + idempotent.
   */
  async #persistAgentSession(threadId: string, now: number): Promise<void> {
    const agentId = this.#agentByThread.get(threadId);
    if (!agentId) return;
    // `nativeSessionId` is an optional adapter capability (not in the shared
    // interface), so read it through a structural type rather than a hard dep.
    const adapter = this.#adapters.get(agentId) as
      | { nativeSessionId?(threadId: string): string | undefined }
      | undefined;
    const sessionId = adapter?.nativeSessionId?.(threadId);
    if (!sessionId) return;
    try {
      await this.#options.store.setAgentSession(threadId, sessionId, now);
    } catch (err) {
      this.#options.logger.warn(
        `persist agent session failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Whether the store already considers this turn ended, used to ignore a
   * duplicate terminal event from an adapter whose CLI outlived its own
   * end-of-turn signal.
   *
   * Reads the store rather than the in-flight map: the map is also cleared by a
   * cancel and by a restart sweep, and "did this turn already end" is a question
   * only the persisted status can answer. A turn the store cannot find is
   * treated as not ended, so an unknown id still follows the normal path and
   * fails there with its own error.
   */
  async #hasEnded(threadId: string, turnId: string): Promise<boolean> {
    try {
      const turn = await this.#options.store.getTurn(turnId);
      return (
        turn.threadId === threadId &&
        (turn.status === 'completed' ||
          turn.status === 'error' ||
          turn.status === 'aborted' ||
          turn.status === 'cancelled')
      );
    } catch {
      return false;
    }
  }

  async #assistantText(turnId: string, provided: string | undefined): Promise<string> {
    if (provided !== undefined) return provided;
    try {
      const turn = await this.#options.store.getTurn(turnId);
      const assistant = turn.messages.find((m) => m.role === 'assistant');
      return typeof assistant?.content === 'string' ? assistant.content : '';
    } catch {
      return '';
    }
  }
}

function readText(data: unknown): string {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** Extract a structured `content` block (MessageContent JSON) from a block event. */
function readContent(data: unknown): unknown {
  if (data && typeof data === 'object' && 'content' in data) {
    return (data as { content: unknown }).content;
  }
  return undefined;
}

/**
 * Extract a block event's `beforeText` marker: `true` when the adapter emitted
 * the block while the assistant's main text was still streaming (a parallel/
 * background activity), so it must be ordered before the open text run.
 */
function readBeforeText(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    'beforeText' in data &&
    (data as { beforeText: unknown }).beforeText === true
  );
}

function readOptionalText(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

/** Extract `{ tokens, contextWindow? }` from a turn_completed event's data. */
function readUsage(data: unknown): { tokens: number; contextWindow?: number } | undefined {
  if (!data || typeof data !== 'object' || !('usage' in data)) return undefined;
  const usage = (data as { usage: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const tokens = (usage as { tokens?: unknown }).tokens;
  if (typeof tokens !== 'number') return undefined;
  const window = (usage as { contextWindow?: unknown }).contextWindow;
  return {
    tokens,
    ...(typeof window === 'number' ? { contextWindow: window } : {}),
  };
}
