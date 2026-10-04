// What every bridge conversation is doing right now — the one source the chat
// tab's chip and the sidebar's chat rows read, whether or not the conversation
// is open in this window (a chat started on the phone included).
//
// It speaks the same five states as a terminal agent's indicator
// (`AgentStatusIndicator`, architecture/02d): `working` while a turn runs,
// `waiting` while the agent waits on the user (an open approval or question),
// `blocked` when the last turn failed, `done` when a turn finished and nobody
// looked yet, `idle` otherwise. It needs no hooks: the bridge's own stream
// (turn started / completed, approval raised / resolved) is the precise
// source, the same events every client of the bridge receives.
//
// "Not looked at yet" survives a restart. What this desktop has seen is kept
// per thread as the thread's `updatedAt` at the moment it was looked at — the
// BRIDGE's clock, never this machine's, so the two always compare — beside a
// one-time `baseline` (the newest `updatedAt` there was the first time this
// ran, so an upgrade does not flag the whole history). Every fresh thread list
// converges on it instead of trusting that the stream was heard: a thread that
// moved since it was last seen, and whose last turn ended after that, is
// `done` again — `blocked` when that turn failed — however much this window
// missed while it was closed.

import { SvelteMap } from 'svelte/reactivity';
import type { Thread, Turn } from '$shared/models/thread';
import type { ThreadLiveState } from '$shared/models/sync';
import type { BridgeNotification } from './client.svelte';
import { requestIdOf } from './timeline';

export type ChatActivity = 'working' | 'waiting' | 'blocked' | 'done' | 'idle';

/** What this desktop has seen, by the bridge's clock. */
export interface SeenMarks {
  /** A thread whose `updatedAt` is at or below this counts as seen. */
  baseline: number;
  /** Per thread: its `updatedAt` when it was last looked at here. */
  threads: Record<string, number>;
}

/** Where the marks are kept between runs. */
export interface SeenStore {
  load(): SeenMarks | null;
  save(marks: SeenMarks): void;
}

const SEEN_KEY = 'uxnan.chat.seen';

/**
 * The marks in this window's storage — per viewer and best-effort, like the
 * chat's other client-only state (`outbox`): the bridge owns the
 * conversations, this holds only which of them this desktop has looked at.
 */
export const localSeenStore: SeenStore = seenStoreAt(SEEN_KEY);

/** The marks of a host's own bridge, kept apart from this machine's: the
 *  baseline is "by that bridge's clock", and a different machine's clock. */
export function hostSeenStore(target: string): SeenStore {
  return seenStoreAt(`${SEEN_KEY}.${target}`);
}

function seenStoreAt(key: string): SeenStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? parseSeenMarks(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(marks) {
      try {
        localStorage.setItem(key, JSON.stringify(marks));
      } catch {
        /* storage unavailable: the marks live in memory only */
      }
    },
  };
}

/** Stored marks, validated (`null` when they are not marks at all). */
export function parseSeenMarks(value: unknown): SeenMarks | null {
  const v = record(value);
  if (typeof v.baseline !== 'number' || !Number.isFinite(v.baseline)) return null;
  const threads: Record<string, number> = {};
  for (const [id, at] of Object.entries(record(v.threads))) {
    if (typeof at === 'number' && Number.isFinite(at)) threads[id] = at;
  }
  return { baseline: v.baseline, threads };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export interface ThreadActivityOptions {
  /** Where what was seen is kept (default: this window's storage). */
  store?: SeenStore;
  /** The thread's newest turn, from the bridge (`turn/list`'s last page).
   *  Without it, a thread that moved since it was seen is simply `done`. */
  lastTurn?: (threadId: string) => Promise<Turn | undefined>;
}

export class ThreadActivity {
  readonly #state = new SvelteMap<string, ChatActivity>();
  /** Threads with a turn running. */
  readonly #running = new Set<string>();
  /** Open approvals/questions per thread. */
  readonly #requests = new Map<string, Set<string>>();
  readonly #store: SeenStore;
  readonly #lastTurn: ThreadActivityOptions['lastTurn'];
  /** Loaded on first use; `null` until a thread list sets the baseline. */
  #marks: SeenMarks | null | undefined;
  /** Threads whose last turn is being asked for, with the `updatedAt` they
   *  were listed at. Anything live about the thread meanwhile wins. */
  readonly #checking = new Map<string, number>();

  constructor(options: ThreadActivityOptions = {}) {
    this.#store = options.store ?? localSeenStore;
    this.#lastTurn = options.lastTurn;
  }

  /** The thread's state (`idle` when nothing is known). */
  of(threadId: string | undefined): ChatActivity {
    return (threadId && this.#state.get(threadId)) || 'idle';
  }

  /**
   * The user looked at the thread as it stands at `updatedAt` (the bridge's
   * value): a finished or failed turn is no longer news — now, and after a
   * restart.
   */
  seen(threadId: string, updatedAt: number): void {
    this.#checking.delete(threadId);
    const state = this.#state.get(threadId);
    if (state === 'done' || state === 'blocked') this.#state.delete(threadId);
    this.#mark(threadId, updatedAt);
  }

  /** Adopt a fresh `thread/list`: the live state it carries (`activeTurnId`)
   *  — a thread running now is working, one this window thought was running
   *  is not any more — and, for the rest, whether a turn ended there that
   *  this desktop has not seen. */
  adoptList(threads: readonly Thread[]): void {
    const marks = this.#loadMarks();
    const listed = new Set<string>();
    for (const thread of threads) {
      listed.add(thread.id);
      if (thread.activeTurnId) {
        this.#checking.delete(thread.id);
        this.#running.add(thread.id);
        this.#refresh(thread.id);
        continue;
      }
      if (this.#running.has(thread.id)) {
        this.#running.delete(thread.id);
        this.#requests.delete(thread.id);
        this.#state.delete(thread.id);
      }
      if (marks) this.#restore(thread, marks);
    }
    for (const id of [...this.#state.keys()]) {
      if (!listed.has(id)) this.#forget(id);
    }
    this.#settleMarks(threads, listed);
  }

  /**
   * Adopt the bridge's whole live set (`SyncChanges.live`): running where a
   * turn is in flight, waiting where its agent holds a request open, and
   * neither for a thread that was and no longer is — even one that did not
   * change since the last revision, which a thread list alone cannot tell.
   */
  adoptLive(live: readonly ThreadLiveState[]): void {
    const now = new Map(live.map((l) => [l.threadId, l]));
    for (const id of [...this.#running]) {
      if (now.get(id)?.activeTurnId) continue;
      this.#running.delete(id);
      this.#requests.delete(id);
      this.#state.delete(id);
    }
    for (const id of [...this.#requests.keys()]) {
      if (!now.get(id)?.awaitingInput?.length) {
        this.#requests.delete(id);
        this.#refresh(id);
      }
    }
    for (const [id, state] of now) {
      this.#checking.delete(id);
      if (state.activeTurnId) this.#running.add(id);
      if (state.awaitingInput?.length) this.#requests.set(id, new Set(state.awaitingInput));
      this.#refresh(id);
    }
  }

  /** Follow one bridge notification. */
  apply(notification: BridgeNotification): void {
    const p = record(notification.params);
    const threadId = typeof p.threadId === 'string' ? p.threadId : '';
    if (!threadId) return;
    switch (notification.method) {
      case 'stream/turn/started':
        this.#checking.delete(threadId);
        this.#running.add(threadId);
        this.#refresh(threadId);
        return;
      case 'stream/content/block': {
        const id = requestIdOf(p.content);
        if (!id) return;
        this.#checking.delete(threadId);
        let open = this.#requests.get(threadId);
        if (!open) this.#requests.set(threadId, (open = new Set()));
        open.add(id);
        this.#refresh(threadId);
        return;
      }
      case 'stream/approval/resolved':
      case 'stream/question/resolved': {
        const id = typeof p.approvalId === 'string' ? p.approvalId : p.questionId;
        if (typeof id === 'string') this.#requests.get(threadId)?.delete(id);
        this.#refresh(threadId);
        return;
      }
      case 'stream/turn/completed':
        this.#finish(threadId, 'done');
        return;
      case 'stream/turn/error':
        this.#finish(threadId, 'blocked');
        return;
      case 'stream/turn/aborted':
        this.#finish(threadId, 'idle');
        return;
      case 'stream/thread/deleted':
        this.#forget(threadId);
        return;
    }
  }

  /** A listed thread with nothing running: `done` (or `blocked`) again when it
   *  moved since this desktop last saw it and its last turn ended after that. */
  #restore(thread: Thread, marks: SeenMarks): void {
    const id = thread.id;
    if (this.#state.has(id) || this.#checking.has(id)) return;
    if (thread.status === 'archived' || !(thread.turnCount > 0)) return;
    const seenAt = Math.max(marks.baseline, marks.threads[id] ?? 0);
    if (!(thread.updatedAt > seenAt)) return;
    if (!this.#lastTurn) {
      this.#state.set(id, 'done');
      return;
    }
    const listedAt = thread.updatedAt;
    this.#checking.set(id, listedAt);
    this.#lastTurn(id).then(
      (turn) => this.#restored(id, listedAt, seenAt, turn),
      () => {
        // The bridge could not say; the thread did move, so it is news.
        if (this.#checking.get(id) !== listedAt) return;
        this.#checking.delete(id);
        this.#state.set(id, 'done');
      },
    );
  }

  #restored(id: string, listedAt: number, seenAt: number, turn: Turn | undefined): void {
    // Something live (a turn started, the user looked, the thread went away)
    // happened while the bridge answered: it is newer than this answer.
    if (this.#checking.get(id) !== listedAt) return;
    this.#checking.delete(id);
    const outcome: ChatActivity =
      turn?.status === 'completed' ? 'done' : turn?.status === 'error' ? 'blocked' : 'idle';
    const endedAt = turn ? (turn.completedAt ?? turn.createdAt) : 0;
    if (outcome !== 'idle' && endedAt > seenAt) {
      this.#state.set(id, outcome);
      return;
    }
    // Only a rename, a model change, a stopped turn… since it was seen:
    // nothing to look at, and nothing to ask again until the thread moves.
    this.#mark(id, listedAt);
  }

  #loadMarks(): SeenMarks | null {
    if (this.#marks === undefined) this.#marks = this.#store.load();
    return this.#marks;
  }

  #mark(threadId: string, updatedAt: number): void {
    const marks = this.#loadMarks();
    // Before the first thread list there is no baseline yet, and that list
    // counts everything there is as seen anyway.
    if (!marks || !Number.isFinite(updatedAt)) return;
    if (updatedAt <= Math.max(marks.baseline, marks.threads[threadId] ?? 0)) return;
    marks.threads[threadId] = updatedAt;
    this.#store.save(marks);
  }

  /** The first list sets the baseline; every list drops the marks of threads
   *  that no longer exist, and of those the baseline already covers. */
  #settleMarks(threads: readonly Thread[], listed: ReadonlySet<string>): void {
    let marks = this.#loadMarks();
    let changed = false;
    if (!marks) {
      const newest = threads.reduce((max, t) => Math.max(max, t.updatedAt || 0), 0);
      marks = this.#marks = { baseline: newest, threads: {} };
      changed = true;
    }
    for (const [id, at] of Object.entries(marks.threads)) {
      if (!listed.has(id) || at <= marks.baseline) {
        delete marks.threads[id];
        changed = true;
      }
    }
    if (changed) this.#store.save(marks);
  }

  #finish(threadId: string, outcome: ChatActivity): void {
    this.#checking.delete(threadId);
    this.#running.delete(threadId);
    this.#requests.delete(threadId);
    if (outcome === 'idle') this.#state.delete(threadId);
    else this.#state.set(threadId, outcome);
  }

  #refresh(threadId: string): void {
    const waiting = (this.#requests.get(threadId)?.size ?? 0) > 0;
    const next: ChatActivity = waiting ? 'waiting' : this.#running.has(threadId) ? 'working' : 'idle';
    if (next === 'idle') this.#state.delete(threadId);
    else if (this.#state.get(threadId) !== next) this.#state.set(threadId, next);
  }

  #forget(threadId: string): void {
    this.#checking.delete(threadId);
    this.#running.delete(threadId);
    this.#requests.delete(threadId);
    this.#state.delete(threadId);
  }
}
