/**
 * Mid-turn delivery: a follow-up handed to the turn already running instead of
 * waiting for it, on agents whose CLI has an input channel while it works.
 *
 * Driven by an in-process adapter (no subprocess) so the hand-off, and every
 * way it can decline, are asserted deterministically. The rule under test
 * throughout: a refusal must cost the user nothing but a wait — the message
 * falls back to the queue that shipped before this path existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { StreamNotification } from '@uxnan/shared';
import type { AgentCapabilities, AgentId, SendTurnOptions } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  ThreadStore,
  createLogger,
} from '../../src/index.js';

const BASE_CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/** What the adapter should do when the manager offers it a mid-turn message. */
type SteerBehaviour = 'accept' | 'decline' | 'throw';

/**
 * Opens a turn and never ends it on its own, so the test owns the timing. Its
 * `steerTurn` is scriptable, which is the whole point: the manager's fallback
 * matters more than its happy path.
 */
class SteerableAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities: AgentCapabilities;
  /** Prompts that started a turn of their own, oldest first. */
  readonly ran: { turnId: string; text: string }[] = [];
  /** Messages handed over mid-turn, with the turn each joined. */
  readonly steered: { turnId: string; activeTurnId: string; text: string }[] = [];
  readonly cancelled: string[] = [];
  behaviour: SteerBehaviour = 'accept';

  constructor(steering: boolean) {
    super();
    this.capabilities = { ...BASE_CAPS, ...(steering ? { steering: true } : {}) };
  }

  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.ran.push({ turnId: options.turnId, text: options.text });
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    return Promise.resolve();
  }
  cancelTurn(_threadId: string, turnId: string): Promise<void> {
    this.cancelled.push(turnId);
    return Promise.resolve();
  }
  steerTurn(options: SendTurnOptions & { activeTurnId: string }): Promise<boolean> {
    if (this.behaviour === 'throw') return Promise.reject(new Error('transport died'));
    if (this.behaviour === 'decline') return Promise.resolve(false);
    this.steered.push({
      turnId: options.turnId,
      activeTurnId: options.activeTurnId,
      text: options.text,
    });
    return Promise.resolve(true);
  }
  complete(threadId: string, turnId: string, text = 'ok'): void {
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
  }
  abort(threadId: string, turnId: string): void {
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }
}

interface Harness {
  store: ThreadStore;
  manager: AgentManager;
  adapter: SteerableAdapter;
  threadId: string;
  notifications: { method: string; params?: Record<string, unknown> }[];
  methods: () => string[];
  cleanup: () => Promise<void>;
}

async function harness(steering = true): Promise<Harness> {
  const baseDir = join(tmpdir(), `uxnan-steer-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new SteerableAdapter(steering);
  manager.register(adapter);
  const thread = await store.startThread({ projectId: 'p' }, 1);
  return {
    store,
    manager,
    adapter,
    threadId: thread.id,
    notifications,
    methods: () => notifications.map((n) => n.method),
    cleanup: () => rm(baseDir, { recursive: true, force: true }),
  };
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
}

test('a follow-up reaches a steering agent inside the running turn', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');

    assert.equal(second.delivered, true);
    assert.equal(second.queued, undefined, 'it did not wait in the queue');
    assert.deepEqual(h.adapter.steered, [
      { turnId: second.turnId, activeTurnId: first.turnId, text: 'second' },
    ]);
    // It reached the agent WITHOUT starting a second turn — the invariant the
    // whole one-turn-per-thread design rests on.
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first'],
    );
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, []);

    const stored = await h.store.getTurn(second.turnId);
    assert.equal(stored.status, 'delivered');
    assert.equal(stored.deliveredIntoTurnId, first.turnId);
    assert.equal(stored.messages.find((m) => m.role === 'user')?.content, 'second');

    const delivered = h.notifications.find(
      (n) => n.method === StreamNotification.TurnDelivered,
    )?.params;
    assert.deepEqual(delivered, {
      threadId: h.threadId,
      turnId: second.turnId,
      intoTurnId: first.turnId,
    });
  } finally {
    await h.cleanup();
  }
});

test('a delivered turn never runs again when the current turn ends', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.complete(h.threadId, first.turnId);

    await waitFor(async () => (await h.store.getTurn(first.turnId)).status === 'completed');
    // Give the drain path a chance to do the wrong thing before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first'],
      'the delivered message must not be replayed as its own turn',
    );
    assert.equal((await h.store.getTurn(second.turnId)).status, 'delivered');
    assert.equal(h.manager.activeTurnId(h.threadId), undefined);
  } finally {
    await h.cleanup();
  }
});

test('an agent without steering still queues, exactly as before', async () => {
  const h = await harness(false);
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');

    assert.equal(second.queued, true);
    assert.equal(second.queuePosition, 1);
    assert.equal(second.delivered, undefined);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
    assert.equal(h.methods().includes(StreamNotification.TurnDelivered), false);

    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.equal(h.adapter.ran[1]?.text, 'second');
  } finally {
    await h.cleanup();
  }
});

test('a declined hand-off falls back to the queue and runs next', async () => {
  const h = await harness();
  try {
    h.adapter.behaviour = 'decline';
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');

    assert.equal(second.delivered, undefined);
    assert.equal(second.queued, true);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');

    h.adapter.behaviour = 'accept';
    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.equal(h.adapter.ran[1]?.text, 'second', 'nothing was lost by the refusal');
  } finally {
    await h.cleanup();
  }
});

test('a hand-off that throws is contained, and the message still queues', async () => {
  const h = await harness();
  try {
    h.adapter.behaviour = 'throw';
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');

    assert.equal(second.queued, true);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
    // The turn that was running is untouched by the failed hand-off.
    assert.equal(h.manager.activeTurnId(h.threadId), first.turnId);
  } finally {
    await h.cleanup();
  }
});

test('an earlier queued message keeps its place — no jumping the line', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    h.adapter.behaviour = 'decline';
    const second = await h.manager.sendTurn(h.threadId, 'second');
    // Steering is available again, but `second` is already waiting: delivering
    // `third` now would let it reach the agent BEFORE the message sent earlier.
    h.adapter.behaviour = 'accept';
    const third = await h.manager.sendTurn(h.threadId, 'third');

    assert.equal(third.delivered, undefined);
    assert.equal(third.queued, true);
    assert.equal(third.queuePosition, 2);
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [second.turnId, third.turnId]);
    assert.deepEqual(h.adapter.steered, []);

    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.equal(h.adapter.ran[1]?.text, 'second', 'the earlier message ran first');
  } finally {
    await h.cleanup();
  }
});

test('a paused queue is never bypassed by a hand-off', async () => {
  const h = await harness();
  try {
    // Stopping a turn while something waits is what pauses the queue — and the
    // reason it pauses (do not push more at an agent the user just stopped)
    // applies at least as strongly to a message that would arrive instantly.
    h.adapter.behaviour = 'decline';
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.behaviour = 'accept';
    h.adapter.abort(h.threadId, first.turnId);
    await waitFor(() => h.manager.queueState(h.threadId).paused);

    const third = await h.manager.sendTurn(h.threadId, 'third');
    assert.equal(third.delivered, undefined);
    assert.equal(third.queued, true);
    assert.deepEqual(h.adapter.steered, []);
  } finally {
    await h.cleanup();
  }
});

test('with no turn in flight a message just starts one', async () => {
  const h = await harness();
  try {
    const only = await h.manager.sendTurn(h.threadId, 'only');
    assert.equal(only.delivered, undefined);
    assert.equal(only.queued, undefined);
    assert.deepEqual(h.adapter.steered, []);
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['only'],
    );
  } finally {
    await h.cleanup();
  }
});

test('clearing the queue leaves an already-delivered turn alone', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const delivered = await h.manager.sendTurn(h.threadId, 'delivered');
    h.adapter.behaviour = 'decline';
    const waiting = await h.manager.sendTurn(h.threadId, 'waiting');

    await h.manager.clearQueue(h.threadId);

    assert.equal((await h.store.getTurn(waiting.turnId)).status, 'cancelled');
    const stored = await h.store.getTurn(delivered.turnId);
    assert.equal(stored.status, 'delivered', 'it already reached the agent; it is not cancellable');
    assert.equal(stored.deliveredIntoTurnId, first.turnId);
  } finally {
    await h.cleanup();
  }
});
