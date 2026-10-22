// One bridge thread as the desktop shows it: its turns, the turn streaming now,
// its queue, and the approvals/questions already settled — kept in step with
// every other client (the phone included) by the bridge's `stream/*`
// notifications (architecture/02a §5.8.16).
//
// The model is the bridge's own (`Thread`, `Turn`, `Message` from `shared/`),
// not a desktop copy. What this adds is only view state: the optimistic bubble
// of a message this window sent and has not seen echoed back yet — kept in the
// outbox (`outbox.ts`) until the bridge has it, so it survives a restart.
//
// The history is bounded (architecture/02a §5.8.8, plans/046): a page carries
// each settled run of steps as one `work` summary and the reasoning as a
// preview, and a live step arrives as a bounded preview with its `index` in
// the stored message. What the timeline opens — a run's steps, one step whole,
// the whole reasoning — is asked for here and kept while the conversation
// lives (`stepRun`, `fullStep`); it goes with it when no chat
// shows it any more (`chat.release`).

import type {
  ApprovalDecision,
} from '$shared/models/approval';
import type {
  Message,
  MessageAttachment,
  QueuePausedReason,
  Turn,
  TurnList,
} from '$shared/models/thread';
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
  TurnUsage,
} from '$shared/jsonrpc/notifications';
import type {
  TurnStepResult,
  TurnStepsResult,
} from '$shared/jsonrpc/methods';
import {
  appendThinkingSegment,
  isStepPreview,
  isThinkingSegment,
  isWorkRunSegment,
  stepFailed,
  stepRunning,
  type StepPreview,
  type ThinkingStepPreview,
  type WorkRunSegment,
} from '$shared/models/history';
import { SvelteMap } from 'svelte/reactivity';
import type { BridgeNotification } from './client.svelte';
import { streamCoalesceWindow } from './streamingMarkdown';
import { readOutbox, writeOutbox, type OutboxEntry } from './outbox';
import { requestIdOf } from './timeline';

/** Calls a bridge method (injected so the reducer is testable without Tauri). */
export type BridgeCall = <T = unknown>(method: string, params?: unknown) => Promise<T>;

/** How many turns one page loads. */
export const TURN_PAGE = 30;

/** A message this window sent that the bridge has not announced back yet.
 *  `error` is set when it did not get there (empty: the app closed before the
 *  bridge answered); the bubble stays, with Retry, so the text is not lost. */
export type PendingSend = OutboxEntry;

export interface QueueState {
  turnIds: string[];
  paused: boolean;
  reason?: QueuePausedReason;
  /** The queued turn the running agent is taking now: no longer editable. */
  delivering?: string;
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
  'stream/queue/updated',
  'stream/model/resolved',
  'stream/approval/resolved',
  'stream/question/resolved',
  'stream/history/changed',
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

/** Something the timeline asked the bridge for, as far as it got. */
export interface Detail<T> {
  value?: T;
  loading: boolean;
  /** Why it could not be had, as the bridge said it (`chatErrorText` words
   *  it); the user may ask again. */
  error?: string;
}

/** A run of steps the timeline opened, as `turn/steps` has served it so far:
 *  `next` is where the rest starts, when its byte budget ended a page early. */
export interface StepRun {
  steps: StepPreview[];
  next?: number;
  loading: boolean;
  error?: string;
}

/** Why a call failed, as the bridge said it. A failure is kept, never
 *  retried by itself: an answer too large for the connection
 *  (`ResponseTooLarge`) would be refused the same way again. */
function failureOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Conversation {
  readonly threadId: string;
  readonly #call: BridgeCall;

  /** The loaded turns, oldest first. Raw: a turn is replaced whole (`#editTurn`),
   *  never mutated in place, so a page of turns costs no deep proxies and a
   *  streamed delta re-renders only the turn it lands in. */
  turns = $state.raw<Turn[]>([]);
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
  /** Messages the bridge has not confirmed — mirrored to the outbox. */
  pending = $state<PendingSend[]>([]);

  running = $derived(this.activeTurnId !== null);
  /** Approvals and questions of the running turn nobody has answered yet, in
   *  the order the agent raised them — the requests the chat pins above its
   *  composer until they are answered here, on the phone, or time out. */
  openRequests = $derived.by<Record<string, unknown>[]>(() => {
    const turn = this.activeTurnId ? this.turns.find((t) => t.id === this.activeTurnId) : undefined;
    const segments = assistantOf(turn)?.segments ?? [];
    const open: Record<string, unknown>[] = [];
    for (const raw of segments) {
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
  /** Offset of the oldest loaded turn in the thread; `0` = everything loaded. */
  oldestOffset = $state(0);
  /** How many notifications this window has applied (see `load`). */
  #applied = 0;
  hasOlder = $derived(this.oldestOffset > 0);

  /** Where this thread's unsent messages are kept (`outboxKey`). */
  readonly #outbox: string;

  /** Runs of steps opened in the timeline, by `runKey`. */
  readonly #runs = new SvelteMap<string, StepRun>();
  /** Steps read whole (`turn/step`), by `stepKey`. */
  readonly #full = new SvelteMap<string, Detail<Record<string, unknown>>>();

  constructor(threadId: string, call: BridgeCall, outbox: string = threadId) {
    this.threadId = threadId;
    this.#call = call;
    this.#outbox = outbox;
    this.pending = readOutbox(outbox);
  }

  /** The only writer of `pending`, so the outbox never disagrees with it. */
  #setPending(next: PendingSend[]): void {
    this.pending = next;
    writeOutbox(this.#outbox, next);
  }

  /** Load (or re-sync) the newest page and the thread's live state. */
  async load(): Promise<void> {
    this.loading = true;
    try {
      // A page is the bridge as it was when it answered. One that left before
      // something this window has since applied — the first message's turn,
      // created while a brand-new conversation's first read was on its way —
      // would put that state back as it was, and the chat showed empty until
      // the next event. Ask again until no notification landed in between
      // (the bridge reads its own writes, so the next page has them).
      let page: TurnList;
      for (let attempt = 0; ; attempt++) {
        const applied = this.#applied;
        page = await this.#call<TurnList>('turn/list', {
          threadId: this.threadId,
          limit: Math.max(TURN_PAGE, this.turns.length),
          fromEnd: true,
        });
        if (applied === this.#applied || attempt >= 2) break;
      }
      this.adoptPage(page);
      this.error = null;
      this.loaded = true;
    } catch (err) {
      this.error = failureOf(err);
    } finally {
      this.loading = false;
    }
  }

  /** Adopt a `turn/list` newest page: authoritative for the turns it covers. */
  adoptPage(page: TurnList): void {
    const turns = Array.isArray(page.turns) ? page.turns : [];
    this.total = typeof page.total === 'number' ? page.total : turns.length;
    // The bridge fits a page in its byte budget by serving fewer of the
    // oldest turns asked for: `offset` says where it really starts.
    this.oldestOffset =
      typeof page.offset === 'number' ? page.offset : Math.max(0, this.total - turns.length);
    this.turns = orderBySeq(turns);
    // What was opened in a turn this page no longer holds is not shown again.
    const kept = new Set(turns.map((t) => t.id));
    this.#forgetDetail((turnId) => !kept.has(turnId));
    this.activeTurnId = page.activeTurnId ?? null;
    this.queue = {
      turnIds: page.queuedTurnIds ?? [],
      paused: page.queuePaused === true,
      ...(page.queuePausedReason ? { reason: page.queuePausedReason } : {}),
      ...(page.queueDeliveringTurnId ? { delivering: page.queueDeliveringTurnId } : {}),
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
    const stored = this.pending.filter((p) => turns.some((t) => isSameSend(t, p)));
    if (stored.length > 0) this.#setPending(this.pending.filter((p) => !stored.includes(p)));
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
      this.turns = orderBySeq([...older, ...this.turns]);
      // Trimmed to the byte budget, the page starts later than asked: the
      // turns before it are the next page back.
      this.oldestOffset = typeof page.offset === 'number' ? Math.max(start, page.offset) : start;
    } catch (err) {
      this.error = failureOf(err);
    } finally {
      this.loadingOlder = false;
    }
  }

  /** Remember a message this window is sending, until the bridge echoes it. */
  addPending(send: PendingSend): void {
    this.#setPending([...this.pending, send]);
  }

  /** Mark a pending send as failed (the text stays visible to retry/copy). */
  failPending(clientTurnId: string, error: string): void {
    this.#setPending(this.pending.map((p) => (p.clientTurnId === clientTurnId ? { ...p, error } : p)));
  }

  /** A failed send is going out again: back to "sending". */
  retryPending(clientTurnId: string): PendingSend | undefined {
    const send = this.pending.find((p) => p.clientTurnId === clientTurnId);
    if (!send) return undefined;
    const { error: _, ...again } = send;
    this.#setPending(this.pending.map((p) => (p === send ? again : p)));
    return again;
  }

  dropPending(clientTurnId: string): void {
    if (!this.pending.some((p) => p.clientTurnId === clientTurnId)) return;
    this.#setPending(this.pending.filter((p) => p.clientTurnId !== clientTurnId));
  }

  /** The thread is gone for every device: nothing of it is left to send. */
  forgetPending(): void {
    this.#setPending([]);
  }

  /** Apply one notification that names this thread. */
  apply(notification: BridgeNotification): void {
    this.#applied += 1;
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
      case 'stream/history/changed':
        // The stored history changed outside a live turn (a turn written in
        // the agent's own app, read back by the bridge's history watcher):
        // the newest page is the truth again. A load already on its way asks
        // once more by itself, since this counted as applied.
        if (!this.loading) void this.load();
        return;
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
        if (!this.#editTurn(turnId, (turn) => ({ ...turn, status: 'streaming' }))) {
          void this.#refreshTurn(turnId);
        }
        return;
      }
      case 'stream/content/block': {
        const params = p as unknown as ContentBlockParams;
        if (!params.content || typeof params.content !== 'object') return;
        const content = params.content as Record<string, unknown>;
        const index = Number.isInteger(params.index) ? params.index : undefined;
        this.#editAssistant(params.turnId, params.messageId, (message) => ({
          ...message,
          segments: placeBlock(message.segments ?? [], content, index, (run) =>
            this.#cachedStep(params.turnId, run, index),
          ),
        }));
        if (index !== undefined && isStepPreview(content)) this.#settleCached(params.turnId, content);
        return;
      }
      case 'stream/turn/completed': {
        const params = p as unknown as TurnCompletedParams;
        if (params.usage) this.usage = params.usage;
        this.#settle(params.turnId, 'completed');
        // It ended because a message reached the agent mid-answer: its reply
        // is the answer so far, and the run goes on in that message's turn.
        const continuedIn = params.continuedIn;
        if (continuedIn) this.#editTurn(params.turnId, (turn) => ({ ...turn, continuedIn }));
        return;
      }
      case 'stream/turn/error':
        this.#settle(str(p.turnId), 'error');
        return;
      case 'stream/turn/aborted':
        this.#settle(str(p.turnId), 'aborted');
        return;
      case 'stream/turn/cancelled':
        this.#editTurn(str(p.turnId), (turn) => ({ ...turn, status: 'cancelled' }));
        return;
      case 'stream/queue/updated': {
        const params = p as unknown as QueueUpdatedParams;
        this.queue = {
          turnIds: Array.isArray(params.queuedTurnIds) ? params.queuedTurnIds : [],
          paused: params.paused === true,
          ...(params.paused && params.pausedReason ? { reason: params.pausedReason } : {}),
          ...(typeof params.deliveringTurnId === 'string'
            ? { delivering: params.deliveringTurnId }
            : {}),
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
      if (kind === 'thinking') {
        // The bridge's own rule (`appendThinkingSegment`): the reasoning grows
        // its last thought, or opens one at the end — where it happened.
        let grown: ThinkingStepPreview | undefined;
        this.#editAssistant(turnId, messageId, (message) => {
          const segments = appendThought(message.segments ?? [], delta);
          const last = segments[segments.length - 1];
          if (isWorkRunSegment(last) && last.last.type === 'thinking') grown = last.last;
          return { ...message, segments };
        });
        // The same thought, read earlier from `turn/steps` or whole: behind now.
        if (grown) this.#growCached(turnId, grown.index, delta);
        continue;
      }
      this.#editAssistant(turnId, messageId, (message) => {
        const segments = [...(message.segments ?? [])];
        const last = segments[segments.length - 1];
        if (isTextSegment(last)) segments[segments.length - 1] = { ...last, text: last.text + delta };
        else segments.push({ type: 'text', text: delta });
        const content = `${typeof message.content === 'string' ? message.content : ''}${delta}`;
        return { ...message, content, segments };
      });
    }
  }

  // --- what the timeline opens ------------------------------------------------

  /** A run's steps as far as they were read, when the timeline opened it. */
  stepRun(turnId: string, run: WorkRunSegment): StepRun | undefined {
    return this.#runs.get(runKey(turnId, run));
  }

  /**
   * Read a run's steps (`turn/steps`): its first page, or — once one is here —
   * the page that starts at `next`. Does nothing while a read is on its way,
   * when every step is here, or after a failure unless `retry` (the user asked
   * again): an answer the bridge could not give is never asked for in a loop.
   */
  async loadSteps(turnId: string, run: WorkRunSegment, retry = false): Promise<void> {
    const key = runKey(turnId, run);
    const known = this.#runs.get(key);
    if (known && (known.loading || (known.error !== undefined && !retry))) return;
    if (known && known.error === undefined && known.next === undefined) return;
    const from = known?.next ?? run.from;
    const before = known?.steps ?? [];
    this.#runs.set(key, { steps: before, ...(known?.next !== undefined ? { next: known.next } : {}), loading: true });
    try {
      const page = await this.#call<TurnStepsResult>('turn/steps', {
        threadId: this.threadId,
        turnId,
        from,
        to: run.to,
      });
      const steps = (Array.isArray(page?.steps) ? page.steps : []).filter(isStepPreview);
      const next = typeof page?.next === 'number' && page.next > from ? page.next : undefined;
      this.#runs.set(key, { steps: [...before, ...steps], ...(next !== undefined ? { next } : {}), loading: false });
    } catch (err) {
      this.#runs.set(key, {
        steps: before,
        ...(known?.next !== undefined ? { next: known.next } : {}),
        loading: false,
        error: failureOf(err),
      });
    }
  }

  /** One step whole, when the timeline asked for it. */
  fullStep(turnId: string, index: number): Detail<Record<string, unknown>> | undefined {
    return this.#full.get(stepKey(turnId, index));
  }

  /** Read one step whole (`turn/step`): the full command, output or diff its
   *  preview cut. Once; again after a failure only when the user asks. */
  async loadFullStep(turnId: string, index: number, retry = false): Promise<void> {
    const key = stepKey(turnId, index);
    const known = this.#full.get(key);
    if (known && (known.loading || known.value || (known.error !== undefined && !retry))) return;
    this.#full.set(key, { loading: true });
    try {
      const { block } = await this.#call<TurnStepResult>('turn/step', {
        threadId: this.threadId,
        turnId,
        index,
      });
      const value = block && typeof block === 'object' ? (block as Record<string, unknown>) : {};
      this.#full.set(key, { value, loading: false });
    } catch (err) {
      this.#full.set(key, { loading: false, error: failureOf(err) });
    }
  }

  /** The preview a run's cached steps hold for [index], if read. */
  #cachedStep(turnId: string, run: WorkRunSegment, index: number | undefined): StepPreview | undefined {
    if (index === undefined) return undefined;
    return this.#runs.get(runKey(turnId, run))?.steps.find((s) => s.index === index);
  }

  /** A thought read earlier (a run's step, or whole) was thought on. */
  #growCached(turnId: string, index: number, delta: string): void {
    this.#full.delete(stepKey(turnId, index));
    for (const [key, run] of this.#runs) {
      if (!key.startsWith(`${turnId}#`)) continue;
      const at = run.steps.findIndex((s) => s.index === index && s.type === 'thinking');
      if (at < 0) continue;
      const steps = [...run.steps];
      steps[at] = growThought(steps[at] as ThinkingStepPreview, delta);
      this.#runs.set(key, { ...run, steps });
    }
  }

  /** A step settled live: the copies of it read earlier are behind now. */
  #settleCached(turnId: string, step: StepPreview): void {
    this.#full.delete(stepKey(turnId, step.index));
    for (const [key, run] of this.#runs) {
      if (!key.startsWith(`${turnId}#`)) continue;
      const at = run.steps.findIndex((s) => s.index === step.index);
      if (at < 0) continue;
      const steps = [...run.steps];
      steps[at] = step;
      this.#runs.set(key, { ...run, steps });
    }
  }

  /** Drop what was opened in the turns [gone] says no longer hold it. */
  #forgetDetail(gone: (turnId: string) => boolean): void {
    for (const key of [...this.#runs.keys()]) if (gone(turnIdOfKey(key))) this.#runs.delete(key);
    for (const key of [...this.#full.keys()]) if (gone(turnIdOfKey(key))) this.#full.delete(key);
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

  /** Insert or replace a turn by id, keeping the bridge's order (`Turn.seq`,
   *  never arrival order: a turn this window missed and read later still lands
   *  in its place); returns whether it was new. The bridge's record of a turn
   *  may fold its steps differently (a run that went on live is one now), so
   *  what was opened in it is read again when asked. */
  #upsert(turn: Turn): boolean {
    const index = this.turns.findIndex((t) => t.id === turn.id);
    const isNew = index === -1;
    const next = isNew ? [...this.turns, turn] : this.turns.map((t, i) => (i === index ? turn : t));
    this.turns = orderBySeq(next);
    if (!isNew) this.#forgetDetail((turnId) => turnId === turn.id);
    return isNew;
  }

  /** Replace a turn with [edit] of it; false when no such turn is loaded. The
   *  one way a loaded turn changes (`turns` is raw). */
  #editTurn(turnId: string | undefined, edit: (turn: Turn) => Turn): boolean {
    const index = turnId ? this.turns.findIndex((t) => t.id === turnId) : -1;
    if (index < 0) return false;
    const next = [...this.turns];
    next[index] = edit(next[index]);
    this.turns = next;
    return true;
  }

  /** Replace the assistant message of a streaming turn with [edit] of it —
   *  created when the stream is the first thing this window hears about the
   *  turn (it joined mid-turn) or about its answer. */
  #editAssistant(
    turnId: string | undefined,
    messageId: string | undefined,
    edit: (message: Message) => Message,
  ): void {
    if (!turnId) return;
    if (!this.#find(turnId)) {
      // A turn this window never saw created (it connected mid-turn): hold the
      // stream in a placeholder and read the real record in the background.
      this.turns = [
        ...this.turns,
        { id: turnId, threadId: this.threadId, status: 'streaming', messages: [], createdAt: Date.now() },
      ];
      void this.#refreshTurn(turnId, true);
    }
    if (this.activeTurnId === null && this.#find(turnId)?.status !== 'completed') {
      this.activeTurnId = turnId;
    }
    this.#editTurn(turnId, (turn) => {
      const at = turn.messages.findIndex((m) => m.role === 'assistant');
      const messages = [...turn.messages];
      if (at >= 0) {
        messages[at] = edit(messages[at]);
      } else {
        messages.push(
          edit({
            id: messageId ?? `${turnId}-assistant`,
            turnId,
            role: 'assistant',
            content: '',
            segments: [],
            createdAt: Date.now(),
          }),
        );
      }
      return { ...turn, messages };
    });
  }

  /** A turn ended: stop the live state, then adopt the bridge's stored record
   *  (authoritative — the live view may have missed a frame). */
  #settle(turnId: string | undefined, status: Turn['status']): void {
    if (!turnId) return;
    this.#editTurn(turnId, (turn) => ({ ...turn, status }));
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
 * [segments] with a reasoning chunk added by the bridge's one rule
 * (`appendThinkingSegment`). A page may have folded the thought still being
 * written into a run (its `last`): the bridge grows that stored thought, so
 * the chunk grows the same row — its preview's text, or, when the preview was
 * cut, the size `turn/step` will read in full.
 */
function appendThought(segments: readonly unknown[], delta: string): unknown[] {
  const out = [...segments];
  const last = out[out.length - 1];
  if (isWorkRunSegment(last) && last.last.type === 'thinking') {
    out[out.length - 1] = { ...last, last: growThought(last.last, delta) };
    return out;
  }
  if (isThinkingSegment(last)) out[out.length - 1] = { ...last };
  appendThinkingSegment(out, delta);
  return out;
}

/** A thought's preview after [delta] was thought on: its text, or — cut — its full size. */
function growThought(preview: ThinkingStepPreview, delta: string): ThinkingStepPreview {
  return typeof preview.textChars === 'number'
    ? { ...preview, textChars: preview.textChars + delta.length }
    : { ...preview, text: preview.text + delta };
}

/** Where a run's steps are kept: the turn and the stored range it covers. */
function runKey(turnId: string, run: WorkRunSegment): string {
  return `${turnId}#${run.from}-${run.to}`;
}

/** Where one whole step is kept. */
function stepKey(turnId: string, index: number): string {
  return `${turnId}#${index}`;
}

function turnIdOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf('#'));
}

/**
 * The stored index each of a page's [segments] starts at, and how many stored
 * entries it spans: a summarized run spans its range, a step preview sits at
 * its own `index`, and anything else (text, a plan, an approval…) is one entry
 * right after the one before. The known indexes re-anchor the count, so a
 * blank text run the page and the store counted differently cannot shift what
 * follows it.
 */
function storedSpans(segments: readonly unknown[]): { start: number; end: number }[] {
  let next = 0;
  return segments.map((segment) => {
    let start = next;
    let end = next;
    if (isWorkRunSegment(segment)) {
      start = segment.from;
      end = segment.to;
    } else if (isStepPreview(segment)) {
      start = end = segment.index;
    }
    next = end + 1;
    return { start, end };
  });
}

/**
 * [segments] with a live block placed where the bridge stored it:
 *
 *  - the block that settles one already shown (same `blockId`, or the same
 *    approval or question) replaces it in place;
 *  - a step at an index a summarized run covers updates that run — its
 *    running and failed counts, its last step — since the steps themselves
 *    are not here ([known] is the run's copy of the step, when it was read);
 *  - anything else goes in at its `index`: after what comes before it, which
 *    is the end of the answer, or before the text run still being written
 *    when a parallel activity produced it (the interleave the bridge stores).
 *
 * Without an index (nothing the bridge sends) it goes at the end.
 */
export function placeBlock(
  segments: readonly unknown[],
  block: Record<string, unknown>,
  index: number | undefined,
  known: (run: WorkRunSegment) => StepPreview | undefined = () => undefined,
): unknown[] {
  const out = [...segments];
  const blockId = blockIdOf(block);
  if (blockId !== undefined) {
    const same = out.findIndex((s) => !isWorkRunSegment(s) && blockIdOf(s) === blockId);
    if (same >= 0) {
      out[same] = block;
      return out;
    }
  }
  if (index === undefined) {
    out.push(block);
    return out;
  }
  const spans = storedSpans(out);
  for (let i = 0; i < out.length; i++) {
    const { start, end } = spans[i];
    const segment = out[i];
    if (isWorkRunSegment(segment) && index >= start && index <= end) {
      if (isStepPreview(block)) out[i] = settleInRun(segment, block, known(segment));
      return out;
    }
    if (isStepPreview(segment) && segment.index === index) {
      out[i] = block;
      return out;
    }
    if (start >= index) {
      out.splice(i, 0, block);
      return out;
    }
  }
  out.push(block);
  return out;
}

/** A step preview read field by field, as the shared rules read a step. */
function fieldsOf(step: StepPreview): Record<string, unknown> {
  return step as unknown as Record<string, unknown>;
}

/**
 * A summarized run after one of its steps changed live. Only a step that was
 * live can change (a `LiveBlock` settling), so when its earlier copy is not
 * here — it is neither the run's `last` nor among steps read — it was the
 * running one.
 */
function settleInRun(run: WorkRunSegment, step: StepPreview, read: StepPreview | undefined): WorkRunSegment {
  const before = run.last.index === step.index ? run.last : read;
  const wasRunning = before ? stepRunning(fieldsOf(before)) : true;
  const wasFailed = before ? stepFailed(fieldsOf(before)) : false;
  const count = (now: boolean, was: boolean) => (now ? 1 : 0) - (was ? 1 : 0);
  const files =
    step.type === 'diff' && step.filename && !run.files.some((f) => f.filename === step.filename)
      ? [...run.files, { filename: step.filename, additions: step.additions, deletions: step.deletions }]
      : run.files;
  return {
    ...run,
    running: Math.max(0, run.running + count(stepRunning(fieldsOf(step)), wasRunning)),
    failed: Math.max(0, run.failed + count(stepFailed(fieldsOf(step)), wasFailed)),
    files,
    last: run.last.index === step.index ? step : run.last,
  };
}

/** The assistant message of a turn, if it has one. */
export function assistantOf(turn: Turn | undefined): Message | undefined {
  return turn?.messages.find((m) => m.role === 'assistant');
}

/** The user message text of a turn ('' when none). */
/** Whether [turn] is the stored copy of a message this window sent: the same
 *  words (or command) and as many images. */
function isSameSend(turn: Turn, send: PendingSend): boolean {
  const images = send.request.attachments?.length ?? 0;
  return userText(turn) === send.text && userAttachments(turn).length === images;
}

/** The images and files the user attached to [turn]'s message. */
export function userAttachments(turn: Turn | undefined): MessageAttachment[] {
  const attachments = turn?.messages.find((m) => m.role === 'user')?.attachments;
  return Array.isArray(attachments) ? attachments : [];
}

export function userText(turn: Turn | undefined): string {
  const message = turn?.messages.find((m) => m.role === 'user');
  return typeof message?.content === 'string' ? message.content : '';
}

/**
 * Turns in the bridge's order: by `seq` where known; a turn without one yet (a
 * placeholder for a stream this window joined mid-way) keeps its place after
 * the numbered ones. Stable, so equal or missing positions keep their order.
 */
export function orderBySeq(turns: Turn[]): Turn[] {
  const numbered = turns.filter((t) => typeof t.seq === 'number');
  if (numbered.length === 0) return turns;
  const unnumbered = turns.filter((t) => typeof t.seq !== 'number');
  return [...[...numbered].sort((a, b) => (a.seq as number) - (b.seq as number)), ...unnumbered];
}

/** The `blockId` a block carries (`LiveBlock`), or undefined. */
function blockIdOf(block: unknown): string | undefined {
  if (!block || typeof block !== "object") return undefined;
  const id = (block as Record<string, unknown>).blockId;
  if (typeof id === "string" && id) return id;
  // An approval or a question is one request whatever copy of it arrives: one
  // the bridge stored before it carried a `blockId` must not show twice either
  // (a second copy is a second card, and a duplicate key empties the dock).
  return requestIdOf(block) || undefined;
}
