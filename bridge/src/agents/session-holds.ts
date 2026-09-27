/**
 * Which agent sessions a desktop terminal has open right now (architecture/02a
 * §5.8.19).
 *
 * A CLI's session has one writer. When Uxnan Desktop runs an agent in one of
 * its terminals, that terminal is the writer, so the bridge must not run a
 * turn in the same session until the terminal lets it go. The desktop tells
 * the bridge (`agentSession/hold` / `release`); the bridge keeps it here,
 * refuses turns on a held session, and asks the desktop to let one go when
 * someone else wants it (`agentSession/requestHandoff`).
 *
 * Live only, never on disk: a hold belongs to the desktop connection that took
 * it and ends when that connection closes — the terminals, and the agents in
 * them, close with the app, and a desktop that reconnects tells the bridge
 * again what it holds. Nothing here ever stops a process.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  AgentSessionHandoffOutcome,
  AgentSessionHold,
  AgentSessionKey,
} from '@uxnan/shared';
import { sessionKey } from '../conversation/thread-store.js';

/** How long a hand-off waits for the holding desktop to answer. */
export const HANDOFF_ANSWER_TIMEOUT_MS = 20_000;

interface StoredHold {
  agentId: AgentId;
  sessionId: string;
  cwd?: string;
  busy: boolean;
  /** The local client that took it. */
  clientId: string;
  /** When it was taken, on this PC's clock (sent as an age). */
  since: number;
  /** The conversation that continues the session, when one does. */
  threadId?: string;
}

interface PendingHandoff {
  clientId: string;
  key: string;
  resolve: (outcome: AgentSessionHandoffOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionHoldsOptions {
  now: () => number;
  /** The PC's name, as a hold's holder is shown. */
  holderName: () => string;
  /** A hold changed (taken, busy/idle, or let go when `hold` is undefined). */
  onChange: (key: AgentSessionKey, hold: AgentSessionHold | undefined) => void;
  /** Ask the holding desktop to let a session go. False when it cannot be reached. */
  askHolder: (
    clientId: string,
    request: { requestId: string; from: string } & AgentSessionKey,
  ) => boolean;
  /** How long to wait for its answer (tests shorten it). */
  answerTimeoutMs?: number;
}

export class SessionHolds {
  readonly #holds = new Map<string, StoredHold>();
  readonly #pending = new Map<string, PendingHandoff>();
  readonly #options: SessionHoldsOptions;

  constructor(options: SessionHoldsOptions) {
    this.#options = options;
  }

  /**
   * Take (or update) a hold for a desktop client. The latest call wins.
   * `threadId` is the conversation that continues the session, when one does.
   */
  hold(
    clientId: string,
    params: AgentSessionKey & { cwd?: string; busy?: boolean; threadId?: string },
  ): AgentSessionHold {
    const key = sessionKey(params.agentId, params.sessionId);
    const current = this.#holds.get(key);
    const next: StoredHold = {
      agentId: params.agentId,
      sessionId: params.sessionId,
      ...(params.cwd !== undefined
        ? { cwd: params.cwd }
        : current?.cwd !== undefined
          ? { cwd: current.cwd }
          : {}),
      busy: params.busy ?? false,
      clientId,
      since: current?.since ?? this.#options.now(),
      ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
    };
    this.#holds.set(key, next);
    const hold = this.#view(next);
    const unchanged =
      current !== undefined &&
      current.clientId === clientId &&
      current.busy === next.busy &&
      current.cwd === next.cwd &&
      current.threadId === next.threadId;
    if (!unchanged) this.#options.onChange(params, hold);
    return hold;
  }

  /** A conversation now continues a held session: every client learns which. */
  attachThread(params: AgentSessionKey, threadId: string): void {
    const stored = this.#holds.get(sessionKey(params.agentId, params.sessionId));
    if (!stored || stored.threadId === threadId) return;
    stored.threadId = threadId;
    this.#options.onChange(params, this.#view(stored));
  }

  /** Let a session go. Only the client that holds it may. */
  release(clientId: string, params: AgentSessionKey): void {
    const key = sessionKey(params.agentId, params.sessionId);
    const current = this.#holds.get(key);
    if (!current || current.clientId !== clientId) return;
    this.#holds.delete(key);
    this.#options.onChange(params, undefined);
  }

  /** A desktop disconnected: everything it held is free, and nothing waits on it. */
  releaseAll(clientId: string): void {
    for (const [key, hold] of [...this.#holds]) {
      if (hold.clientId !== clientId) continue;
      this.#holds.delete(key);
      this.#options.onChange({ agentId: hold.agentId, sessionId: hold.sessionId }, undefined);
    }
    for (const [requestId, pending] of [...this.#pending]) {
      if (pending.clientId === clientId) this.#settle(requestId, 'unreachable');
    }
  }

  /** The hold on a session, when a terminal has it open. */
  find(agentId: string, sessionId: string): AgentSessionHold | undefined {
    const stored = this.#holds.get(sessionKey(agentId, sessionId));
    return stored ? this.#view(stored) : undefined;
  }

  list(): AgentSessionHold[] {
    return [...this.#holds.values()].map((h) => this.#view(h));
  }

  /**
   * Ask the terminal holding a session to let it go. Resolves with how that
   * ended; `released` only once the desktop has closed the agent and released
   * the hold, so the caller can run a turn in the session right away.
   */
  requestHandoff(params: AgentSessionKey, from: string): Promise<AgentSessionHandoffOutcome> {
    const key = sessionKey(params.agentId, params.sessionId);
    const hold = this.#holds.get(key);
    if (!hold) return Promise.resolve('notHeld');
    if (hold.busy) return Promise.resolve('busy');
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.#settle(requestId, 'unreachable'),
        this.#options.answerTimeoutMs ?? HANDOFF_ANSWER_TIMEOUT_MS,
      );
      this.#pending.set(requestId, { clientId: hold.clientId, key, resolve, timer });
      const asked = this.#options.askHolder(hold.clientId, { requestId, from, ...params });
      if (!asked) this.#settle(requestId, 'unreachable');
    });
  }

  /** The holding desktop's answer to a hand-off request. */
  answer(clientId: string, requestId: string, outcome: 'released' | 'busy' | 'declined'): void {
    const pending = this.#pending.get(requestId);
    if (!pending || pending.clientId !== clientId) return;
    if (outcome === 'released') {
      // The desktop releases before it answers; make sure the hold is gone
      // either way, so a turn sent right after never meets a stale one.
      const hold = this.#holds.get(pending.key);
      if (hold && hold.clientId === clientId) {
        this.#holds.delete(pending.key);
        this.#options.onChange({ agentId: hold.agentId, sessionId: hold.sessionId }, undefined);
      }
    }
    this.#settle(requestId, outcome);
  }

  #settle(requestId: string, outcome: AgentSessionHandoffOutcome): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    this.#pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }

  #view(hold: StoredHold): AgentSessionHold {
    const { threadId } = hold;
    return {
      agentId: hold.agentId,
      sessionId: hold.sessionId,
      ...(hold.cwd !== undefined ? { cwd: hold.cwd } : {}),
      holder: { kind: 'terminal', name: this.#options.holderName() },
      heldAgoMs: Math.max(0, this.#options.now() - hold.since),
      busy: hold.busy,
      ...(threadId !== undefined ? { threadId } : {}),
    };
  }
}
