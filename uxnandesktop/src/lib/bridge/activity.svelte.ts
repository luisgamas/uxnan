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

import { SvelteMap } from 'svelte/reactivity';
import type { Thread } from '$shared/models/thread';
import type { BridgeNotification } from './client.svelte';
import { requestIdOf } from './timeline';

export type ChatActivity = 'working' | 'waiting' | 'blocked' | 'done' | 'idle';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class ThreadActivity {
  readonly #state = new SvelteMap<string, ChatActivity>();
  /** Threads with a turn running. */
  readonly #running = new Set<string>();
  /** Open approvals/questions per thread. */
  readonly #requests = new Map<string, Set<string>>();

  /** The thread's state (`idle` when nothing is known). */
  of(threadId: string | undefined): ChatActivity {
    return (threadId && this.#state.get(threadId)) || 'idle';
  }

  /** The user looked at the thread: a finished or failed turn is no longer news. */
  seen(threadId: string): void {
    const state = this.#state.get(threadId);
    if (state === 'done' || state === 'blocked') this.#state.delete(threadId);
  }

  /** Adopt the live state a fresh `thread/list` carries (`activeTurnId`): a
   *  thread running now is working; one this window thought was running is
   *  not any more. */
  adoptList(threads: readonly Thread[]): void {
    const listed = new Set<string>();
    for (const thread of threads) {
      listed.add(thread.id);
      if (thread.activeTurnId) {
        this.#running.add(thread.id);
        this.#refresh(thread.id);
      } else if (this.#running.has(thread.id)) {
        this.#running.delete(thread.id);
        this.#requests.delete(thread.id);
        this.#state.delete(thread.id);
      }
    }
    for (const id of [...this.#state.keys()]) {
      if (!listed.has(id)) this.#forget(id);
    }
  }

  /** Follow one bridge notification. */
  apply(notification: BridgeNotification): void {
    const p = record(notification.params);
    const threadId = typeof p.threadId === 'string' ? p.threadId : '';
    if (!threadId) return;
    switch (notification.method) {
      case 'stream/turn/started':
        this.#running.add(threadId);
        this.#refresh(threadId);
        return;
      case 'stream/content/block': {
        const id = requestIdOf(p.content);
        if (!id) return;
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

  #finish(threadId: string, outcome: ChatActivity): void {
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
    this.#running.delete(threadId);
    this.#requests.delete(threadId);
    this.#state.delete(threadId);
  }
}
