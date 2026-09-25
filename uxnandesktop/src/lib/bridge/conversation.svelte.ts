// One bridge thread as the desktop shows it: its turns, the turn streaming now,
// its queue, and the approvals/questions already settled — kept in step with
// every other client (the phone included) by the bridge's `stream/*`
// notifications (architecture/02a §5.8.16).
//
// The model is the bridge's own (`Thread`, `Turn`, `Message` from `shared/`),
// not a desktop copy. What this adds is only view state: the optimistic bubble
// of a message this window sent and has not seen echoed back yet.

import type {
  ApprovalDecision,
} from '$shared/models/approval';
import type { Message, QueuePausedReason, Turn, TurnList } from '$shared/models/thread';
import type {
  ApprovalResolvedParams,
  ContentBlockParams,
  MessageDeltaParams,
  ModelResolvedParams,
  QueueUpdatedParams,
  QuestionResolvedParams,
  ThinkingDeltaParams,
  TurnCompletedParams,
  TurnCreatedParams,
  TurnDeliveredParams,
  TurnUsage,
} from '$shared/jsonrpc/notifications';
import type { BridgeNotification } from './client.svelte';
import { streamCoalesceWindow } from './streamingMarkdown';

/** Calls a bridge method (injected so the reducer is testable without Tauri). */
export type BridgeCall = <T = unknown>(method: string, params?: unknown) => Promise<T>;

/** How many turns one page loads. */
export const TURN_PAGE = 30;

/** A message this window sent that the bridge has not announced back yet. */
export interface PendingSend {
  clientTurnId: string;
  text: string;
  /** Set when `turn/send` failed; the bubble stays so the text is not lost. */
  error?: string;
}

export interface QueueState {
  turnIds: string[];
  paused: boolean;
  reason?: QueuePausedReason;
}

/** How a settled approval ended. */
export interface ApprovalOutcome {
  decision: ApprovalDecision;
  timedOut: boolean;
}

/** How a settled question ended. */
export interface QuestionOutcome {
  answers: string[][];
  skipped: boolean;
  timedOut: boolean;
}

/** Ids of the notifications that concern one thread's timeline. */
const TIMELINE_METHODS = new Set([
  'stream/turn/created',
  'stream/turn/started',
  'stream/message/delta',
  'stream/thinking/delta',
  'stream/content/block',
  'stream/turn/completed',
  'stream/turn/error',
  'stream/turn/aborted',
  'stream/turn/cancelled',
  'stream/turn/delivered',
  'stream/queue/updated',
  'stream/model/resolved',
  'stream/approval/resolved',
  'stream/question/resolved',
]);

/** Whether a notification belongs to some thread's timeline (vs. the thread list). */
export function isTimelineMethod(method: string): boolean {
  return TIMELINE_METHODS.has(method);
}

/** The `threadId` a notification names, when it names one. */
export function threadIdOf(notification: BridgeNotification): string | undefined {
  const params = notification.params;
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { threadId?: unknown }).threadId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A text segment in a message's ordered `segments`. */
function isTextSegment(segment: unknown): segment is { type: 'text'; text: string } {
  const s = record(segment);
  return s.type === 'text' && typeof s.text === 'string';
}

export class Conversation {
  readonly threadId: string;
  readonly #call: BridgeCall;

  turns = $state<Turn[]>([]);
  total = $state(0);
  loading = $state(false);
  loadingOlder = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);
  /** The turn the agent is producing right now (the bridge's live state). */
  activeTurnId = $state<string | null>(null);
  queue = $state<QueueState>({ turnIds: [], paused: false });
  /** Latest context usage the agent reported. */
  usage = $state<TurnUsage | null>(null);
  /** The concrete model an alias resolved to on the latest turn. */
  resolvedModel = $state<string | null>(null);
  approvals = $state<Record<string, ApprovalOutcome>>({});
  questions = $state<Record<string, QuestionOutcome>>({});
  pending = $state<PendingSend[]>([]);

  running = $derived(this.activeTurnId !== null);
  /** Approvals and questions of the running turn nobody has answered yet, in
   *  the order the agent raised them — the requests the chat pins above its
   *  composer until they are answered here, on the phone, or time out. */
  openRequests = $derived.by<Record<string, unknown>[]>(() => {
    const turn = this.activeTurnId ? this.turns.find((t) => t.id === this.activeTurnId) : undefined;
    const blocks = assistantOf(turn)?.blocks ?? [];
    const open: Record<string, unknown>[] = [];
    for (const raw of blocks) {
      const block = record(raw);
      const req = block.request && typeof block.request === 'object' ? record(block.request) : block;
      if (block.type === 'approval' && typeof req.approvalId === 'string') {
        if (!this.approvals[req.approvalId]) open.push(block);
      } else if (block.type === 'question' && typeof req.questionId === 'string') {
        if (!this.questions[req.questionId]) open.push(block);
      }
    }
    return open;
  });
  /** How many of them there are. */
  pendingInput = $derived(this.openRequests.length);
  /** What the chat's tab chip shows — the same states a terminal agent's
   *  indicator uses: `blocked` while the agent waits on the user, `working`
   *  while it runs, `idle` otherwise. */
  displayStatus = $derived<'blocked' | 'working' | 'idle'>(
    this.pendingInput > 0 ? 'blocked' : this.running ? 'working' : 'idle',
  );
  /** Offset of the oldest loaded turn in the thread; `0` = everything loaded. */
  oldestOffset = $state(0);
  hasOlder = $derived(this.oldestOffset > 0);

  constructor(threadId: string, call: BridgeCall) {
    this.threadId = threadId;
    this.#call = call;
  }

  /** Load (or re-sync) the newest page and the thread's live state. */
  async load(): Promise<void> {
    this.loading = true;
    try {
      const page = await this.#call<TurnList>('turn/list', {
        threadId: this.threadId,
        limit: Math.max(TURN_PAGE, this.turns.length),
        fromEnd: true,
      });
      this.adoptPage(page);
      this.error = null;
      this.loaded = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  /** Adopt a `turn/list` newest page: authoritative for the turns it covers. */
  adoptPage(page: TurnList): void {
    const turns = Array.isArray(page.turns) ? page.turns : [];
    this.total = typeof page.total === 'number' ? page.total : turns.length;
    this.oldestOffset = Math.max(0, this.total - turns.length);
    this.turns = turns;
    this.activeTurnId = page.activeTurnId ?? null;
    this.queue = {
      turnIds: page.queuedTurnIds ?? [],
      paused: page.queuePaused === true,
      ...(page.queuePausedReason ? { reason: page.queuePausedReason } : {}),
    };
    // The context meter lives in memory on the bridge side too: restore it from
    // the newest assistant message that reported usage.
    for (let i = turns.length - 1; i >= 0; i--) {
      const usage = assistantOf(turns[i])?.usage;
      if (usage) {
        this.usage = usage;
        break;
      }
    }
    // A bubble already stored on the bridge is no longer pending.
    this.pending = this.pending.filter((p) => !turns.some((t) => userText(t) === p.text));
  }

  /** Load the page before the oldest one shown. */
  async loadOlder(): Promise<void> {
    if (!this.hasOlder || this.loadingOlder) return;
    this.loadingOlder = true;
    try {
      const start = Math.max(0, this.oldestOffset - TURN_PAGE);
      const page = await this.#call<TurnList>('turn/list', {
        threadId: this.threadId,
        cursor: String(start),
        limit: this.oldestOffset - start,
      });
      const known = new Set(this.turns.map((t) => t.id));
      const older = (page.turns ?? []).filter((t) => !known.has(t.id));
      this.turns = [...older, ...this.turns];
      this.oldestOffset = start;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loadingOlder = false;
    }
  }

  /** Remember a message this window is sending, until the bridge echoes it. */
  addPending(send: PendingSend): void {
    this.pending = [...this.pending, send];
  }

  /** Mark a pending send as failed (the text stays visible to retry/copy). */
  failPending(clientTurnId: string, error: string): void {
    this.pending = this.pending.map((p) => (p.clientTurnId === clientTurnId ? { ...p, error } : p));
  }

  dropPending(clientTurnId: string): void {
    this.pending = this.pending.filter((p) => p.clientTurnId !== clientTurnId);
  }

  /** Apply one notification that names this thread. */
  apply(notification: BridgeNotification): void {
    const p = record(notification.params);
    // Streamed prose and thinking wait in a buffer for a moment, so the view
    // re-renders a few times per second instead of on every delta (the
    // phone's measured policy, `streamCoalesceWindow`). Every other event
    // lands the buffer first, so the order of text and blocks is kept.
    if (notification.method === 'stream/message/delta' || notification.method === 'stream/thinking/delta') {
      const params = p as unknown as MessageDeltaParams;
      if (typeof params.delta !== 'string') return;
      this.#buffer(notification.method === 'stream/thinking/delta' ? 'thinking' : 'text', params);
      return;
    }
    this.flush();
    switch (notification.method) {
      case 'stream/turn/created': {
        const params = p as unknown as TurnCreatedParams;
        if (!params.turn || typeof params.turn.id !== 'string') return;
        if (this.#upsert(params.turn)) this.total += 1;
        if (params.clientTurnId) this.dropPending(params.clientTurnId);
        return;
      }
      case 'stream/turn/started': {
        const turnId = str(p.turnId);
        if (!turnId) return;
        this.activeTurnId = turnId;
        const turn = this.#find(turnId);
        if (turn) turn.status = 'streaming';
        else void this.#refreshTurn(turnId);
        return;
      }
      case 'stream/content/block': {
        const params = p as unknown as ContentBlockParams;
        if (!params.content || typeof params.content !== 'object') return;
        const message = this.#liveAssistant(params.turnId, params.messageId);
        if (!message) return;
        blocksOf(message).push(params.content);
        const segments = segmentsOf(message);
        // A block from a parallel activity lands BEFORE the text run that is
        // still open, so a sentence is never split by an activity card — the
        // same interleave the bridge persists.
        const last = segments[segments.length - 1];
        if (params.beforeText && isTextSegment(last)) {
          segments.splice(segments.length - 1, 0, params.content);
        } else {
          segments.push(params.content);
        }
        return;
      }
      case 'stream/turn/completed': {
        const params = p as unknown as TurnCompletedParams;
        if (params.usage) this.usage = params.usage;
        this.#settle(params.turnId, 'completed');
        return;
      }
      case 'stream/turn/error':
        this.#settle(str(p.turnId), 'error');
        return;
      case 'stream/turn/aborted':
        this.#settle(str(p.turnId), 'aborted');
        return;
      case 'stream/turn/cancelled': {
        const turn = this.#find(str(p.turnId));
        if (turn) turn.status = 'cancelled';
        return;
      }
      case 'stream/turn/delivered': {
        const params = p as unknown as TurnDeliveredParams;
        const turn = this.#find(params.turnId);
        if (turn) {
          turn.status = 'delivered';
          turn.deliveredIntoTurnId = params.intoTurnId;
        }
        return;
      }
      case 'stream/queue/updated': {
        const params = p as unknown as QueueUpdatedParams;
        this.queue = {
          turnIds: Array.isArray(params.queuedTurnIds) ? params.queuedTurnIds : [],
          paused: params.paused === true,
          ...(params.paused && params.pausedReason ? { reason: params.pausedReason } : {}),
        };
        return;
      }
      case 'stream/model/resolved': {
        const params = p as unknown as ModelResolvedParams;
        if (typeof params.model === 'string' && params.model.length > 0) {
          this.resolvedModel = params.model;
        }
        return;
      }
      case 'stream/approval/resolved': {
        const params = p as unknown as ApprovalResolvedParams;
        if (typeof params.approvalId !== 'string') return;
        this.approvals = {
          ...this.approvals,
          [params.approvalId]: { decision: params.decision, timedOut: params.timedOut === true },
        };
        return;
      }
      case 'stream/question/resolved': {
        const params = p as unknown as QuestionResolvedParams;
        if (typeof params.questionId !== 'string') return;
        this.questions = {
          ...this.questions,
          [params.questionId]: {
            answers: Array.isArray(params.answers) ? params.answers : [],
            skipped: params.skipped === true,
            timedOut: params.timedOut === true,
          },
        };
        return;
      }
    }
  }

  /** Record an answer given here right away, before the bridge's echo. */
  /** Streamed text waiting for the next render, oldest first. */
  #buffered: { kind: 'text' | 'thinking'; turnId: string; messageId: string; delta: string }[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  #buffer(kind: 'text' | 'thinking', params: MessageDeltaParams | ThinkingDeltaParams): void {
    const last = this.#buffered[this.#buffered.length - 1];
    if (last && last.kind === kind && last.turnId === params.turnId && last.messageId === params.messageId) {
      last.delta += params.delta;
    } else {
      this.#buffered.push({ kind, turnId: params.turnId, messageId: params.messageId, delta: params.delta });
    }
    if (this.#flushTimer !== null) return;
    const live = this.#find(params.turnId);
    const shown = live ? assistantOf(live)?.content : undefined;
    const length = typeof shown === 'string' ? shown.length : 0;
    this.#flushTimer = setTimeout(() => this.flush(), streamCoalesceWindow(length));
  }

  /** Lands every buffered delta now (a non-delta event, a closing view, a test). */
  flush(): void {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    if (this.#buffered.length === 0) return;
    const pending = this.#buffered;
    this.#buffered = [];
    for (const { kind, turnId, messageId, delta } of pending) {
      const message = this.#liveAssistant(turnId, messageId);
      if (!message) continue;
      if (kind === 'thinking') {
        message.thinking = `${message.thinking ?? ''}${delta}`;
        continue;
      }
      message.content = `${typeof message.content === 'string' ? message.content : ''}${delta}`;
      const segments = segmentsOf(message);
      const last = segments[segments.length - 1];
      if (isTextSegment(last)) last.text += delta;
      else segments.push({ type: 'text', text: delta });
    }
  }

  settleApprovalLocally(approvalId: string, decision: ApprovalDecision): void {
    this.approvals = { ...this.approvals, [approvalId]: { decision, timedOut: false } };
  }

  settleQuestionLocally(questionId: string, answers: string[][]): void {
    this.questions = {
      ...this.questions,
      [questionId]: {
        answers,
        skipped: answers.every((a) => a.length === 0),
        timedOut: false,
      },
    };
  }

  #find(turnId: string | undefined): Turn | undefined {
    if (!turnId) return undefined;
    return this.turns.find((t) => t.id === turnId);
  }

  /** Insert or replace a turn by id; returns whether it was new. */
  #upsert(turn: Turn): boolean {
    const index = this.turns.findIndex((t) => t.id === turn.id);
    if (index === -1) {
      this.turns = [...this.turns, turn];
      return true;
    }
    this.turns[index] = turn;
    return false;
  }

  /** The assistant message of a streaming turn, created when the stream is the
   *  first thing this window hears about it (it joined mid-turn). */
  #liveAssistant(turnId: string | undefined, messageId: string | undefined): Message | undefined {
    if (!turnId) return undefined;
    let turn = this.#find(turnId);
    if (!turn) {
      // A turn this window never saw created (it connected mid-turn): hold the
      // stream in a placeholder and read the real record in the background.
      turn = {
        id: turnId,
        threadId: this.threadId,
        status: 'streaming',
        messages: [],
        createdAt: Date.now(),
      };
      this.turns = [...this.turns, turn];
      turn = this.turns[this.turns.length - 1];
      void this.#refreshTurn(turnId, true);
    }
    if (this.activeTurnId === null && turn.status !== 'completed') this.activeTurnId = turnId;
    let message = assistantOf(turn);
    if (!message) {
      turn.messages.push({
        id: messageId ?? `${turnId}-assistant`,
        turnId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      });
      message = turn.messages[turn.messages.length - 1];
    }
    return message;
  }

  /** A turn ended: stop the live state, then adopt the bridge's stored record
   *  (authoritative — the live view may have missed a frame). */
  #settle(turnId: string | undefined, status: Turn['status']): void {
    if (!turnId) return;
    const turn = this.#find(turnId);
    if (turn) turn.status = status;
    if (this.activeTurnId === turnId) this.activeTurnId = null;
    void this.#refreshTurn(turnId);
  }

  /** Re-read one turn from the bridge. With `keepLive`, streamed text that
   *  arrived meanwhile is not thrown away if the stored copy is behind. */
  async #refreshTurn(turnId: string, keepLive = false): Promise<void> {
    try {
      const stored = await this.#call<Turn>('turn/read', { turnId });
      if (!stored || stored.id !== turnId) return;
      if (keepLive) {
        const live = assistantOf(this.#find(turnId));
        const storedText = assistantOf(stored)?.content;
        if (
          live &&
          typeof live.content === 'string' &&
          (typeof storedText !== 'string' || storedText.length < live.content.length)
        ) {
          return;
        }
      }
      this.#upsert(stored);
    } catch {
      /* a later resync converges */
    }
  }
}

/**
 * A message's `segments`, created in place when absent. Read back through the
 * message rather than using the assigned literal: `message` is a reactive
 * proxy, and `(m.segments ??= [])` evaluates to the raw array, not the proxied
 * one stored — pushing into that loses the write.
 */
function segmentsOf(message: Message): unknown[] {
  if (!Array.isArray(message.segments)) message.segments = [];
  return message.segments as unknown[];
}

/** A message's `blocks`, created in place when absent (see {@link segmentsOf}). */
function blocksOf(message: Message): unknown[] {
  if (!Array.isArray(message.blocks)) message.blocks = [];
  return message.blocks as unknown[];
}

/** The assistant message of a turn, if it has one. */
export function assistantOf(turn: Turn | undefined): Message | undefined {
  return turn?.messages.find((m) => m.role === 'assistant');
}

/** The user message text of a turn ('' when none). */
export function userText(turn: Turn | undefined): string {
  const message = turn?.messages.find((m) => m.role === 'user');
  return typeof message?.content === 'string' ? message.content : '';
}
