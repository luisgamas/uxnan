/**
 * The thread message queue: follow-ups sent while a turn is in flight.
 *
 * Everything here drives an in-process controllable adapter (no subprocess), so
 * the queue's ordering and pause rules are asserted deterministically rather
 * than raced against a real CLI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonRpcErrorCode, StreamNotification } from '@uxnan/shared';
import type { AgentCapabilities, AgentId, SendTurnOptions } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  ThreadStore,
  createLogger,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/**
 * Opens a turn and never finishes it on its own — the test decides when (and
 * how) each turn ends, which is exactly what the queue's behaviour hangs on.
 * Records every prompt it was handed, in order, so "did this turn actually
 * reach the agent?" is answerable.
 */
class ControlledAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities = CAPS;
  /** Prompts handed to the adapter, oldest first. */
  readonly delivered: { turnId: string; text: string; service?: string }[] = [];
  /** Turn ids `cancelTurn` was called for (a queued turn must never appear). */
  readonly cancelled: string[] = [];

  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.delivered.push({
      turnId: options.turnId,
      text: options.text,
      ...(options.service !== undefined ? { service: options.service } : {}),
    });
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    return Promise.resolve();
  }
  cancelTurn(_threadId: string, turnId: string): Promise<void> {
    this.cancelled.push(turnId);
    return Promise.resolve();
  }
  complete(threadId: string, turnId: string, text = 'ok'): void {
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
  }
  fail(threadId: string, turnId: string, text = 'boom'): void {
    this.emit({ type: 'turn_error', threadId, turnId, data: { text } });
  }
  abort(threadId: string, turnId: string): void {
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }
}

interface Harness {
  store: ThreadStore;
  manager: AgentManager;
  adapter: ControlledAdapter;
  threadId: string;
  notifications: { method: string; params?: Record<string, unknown> }[];
  methods: () => string[];
  cleanup: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const baseDir = join(tmpdir(), `uxnan-queue-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new ControlledAdapter();
  manager.register(adapter);
  const thread = await store.startThread({ projectId: 'p' }, 1);
  return {
    store,
    manager,
    adapter,
    threadId: thread.id,
    notifications,
    methods: () => notifications.map((n) => n.method),
    cleanup: () => rmrf(baseDir),
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

test('a second turn sent mid-flight is queued, not started', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');

  assert.equal(first.queued, undefined, 'the first turn starts immediately');
  assert.equal(second.queued, true);
  assert.equal(second.queuePosition, 1, 'it is next in line');
  assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
  // The in-flight turn is untouched — this is the bug the queue closes: before
  // it, the second send overwrote the active marker and ran concurrently.
  assert.equal(h.manager.activeTurnId(h.threadId), first.turnId);
  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first'],
    'the queued prompt has not reached the agent',
  );
  // The user's message is stored right away, so it survives a resync.
  const queuedTurn = await h.store.getTurn(second.turnId);
  assert.equal(queuedTurn.messages.find((m) => m.role === 'user')?.content, 'second');

  await h.cleanup();
});

test('the queue drains in order as each turn completes', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  const third = await h.manager.sendTurn(h.threadId, 'third');
  assert.equal(third.queuePosition, 2);

  h.adapter.complete(h.threadId, first.turnId);
  await waitFor(() => h.adapter.delivered.length === 2);
  assert.equal(h.manager.activeTurnId(h.threadId), second.turnId);
  assert.equal((await h.store.getTurn(second.turnId)).status, 'streaming');

  h.adapter.complete(h.threadId, second.turnId);
  await waitFor(() => h.adapter.delivered.length === 3);

  h.adapter.complete(h.threadId, third.turnId);
  await waitFor(async () => (await h.store.getTurn(third.turnId)).status === 'completed');

  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first', 'second', 'third'],
    'FIFO — one turn per message, in the order they were sent',
  );
  assert.equal(h.manager.activeTurnId(h.threadId), undefined);
  assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, []);

  await h.cleanup();
});

test('a queued turn runs with the options it was queued with, not later ones', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first', { service: 'model-a' });
  await h.manager.sendTurn(h.threadId, 'second', { service: 'model-b' });
  // The follow-up was written while `model-b` was selected; whatever the thread
  // is set to by the time it finally runs, it runs as the user meant it.
  h.adapter.complete(h.threadId, first.turnId);
  await waitFor(() => h.adapter.delivered.length === 2);

  assert.deepEqual(
    h.adapter.delivered.map((d) => d.service),
    ['model-a', 'model-b'],
  );

  await h.cleanup();
});

test('`queue: false` rejects with AgentBusy instead of queueing', async () => {
  const h = await harness();
  await h.manager.sendTurn(h.threadId, 'first');
  await assert.rejects(
    () => h.manager.sendTurn(h.threadId, 'second', { queue: false }),
    (err: { code?: number }) => err.code === JsonRpcErrorCode.AgentBusy,
  );
  assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, []);

  await h.cleanup();
});

test('the queue is capped', async () => {
  const h = await harness();
  await h.manager.sendTurn(h.threadId, 'running');
  for (let i = 0; i < 10; i += 1) {
    await h.manager.sendTurn(h.threadId, `queued ${i}`);
  }
  assert.equal(h.manager.queueState(h.threadId).queuedTurnIds.length, 10);
  await assert.rejects(
    () => h.manager.sendTurn(h.threadId, 'one too many'),
    (err: { code?: number; message?: string }) =>
      err.code === JsonRpcErrorCode.AgentBusy && /full/.test(err.message ?? ''),
  );

  await h.cleanup();
});

test('cancelling a queued turn marks it cancelled and never reaches the adapter', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  const third = await h.manager.sendTurn(h.threadId, 'third');

  await h.manager.cancelTurn(h.threadId, second.turnId);

  const cancelledTurn = await h.store.getTurn(second.turnId);
  // `cancelled`, not `aborted`: it never ran. The turn is KEPT so the user's
  // message stays in the thread with its mark instead of vanishing.
  assert.equal(cancelledTurn.status, 'cancelled');
  assert.equal(cancelledTurn.messages.find((m) => m.role === 'user')?.content, 'second');
  assert.deepEqual(h.adapter.cancelled, [], 'a queued turn is not routed to an adapter');
  assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [third.turnId]);
  assert.ok(h.methods().includes(StreamNotification.TurnCancelled));

  // The rest of the queue is unaffected and still drains.
  h.adapter.complete(h.threadId, first.turnId);
  await waitFor(() => h.adapter.delivered.length === 2);
  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first', 'third'],
  );

  await h.cleanup();
});

test('stopping the running turn holds the queue until it is resumed', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');

  h.adapter.abort(h.threadId, first.turnId);
  // Wait for the queue state this asserts, not for the turn status: the store
  // records the abort BEFORE the manager pauses the queue, so waiting on the
  // stored status can observe the gap between the two.
  await waitFor(() => h.manager.queueState(h.threadId).paused);

  const paused = h.manager.queueState(h.threadId);
  assert.equal(paused.paused, true);
  assert.equal(paused.pausedReason, 'turnAborted');
  assert.deepEqual(paused.queuedTurnIds, [second.turnId]);
  // The user stopped for a reason: the follow-up must NOT fire on its own.
  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first'],
  );

  const resumed = await h.manager.resumeQueue(h.threadId);
  await waitFor(() => h.adapter.delivered.length === 2);
  assert.equal(resumed.paused, false);
  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first', 'second'],
  );

  await h.cleanup();
});

test('a failed turn holds the queue too', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  await h.manager.sendTurn(h.threadId, 'second');

  h.adapter.fail(h.threadId, first.turnId, 'API error (status 402): balance exhausted');
  // Wait on the pause itself, not just on the stored turn: persisting the error
  // and pausing the queue are two steps of the same handler, so a run that only
  // waits for the store can read `queueState()` in between and see it unpaused.
  await waitFor(() => h.manager.queueState(h.threadId).paused);
  await waitFor(async () => (await h.store.getTurn(first.turnId)).status === 'error');

  const state = h.manager.queueState(h.threadId);
  assert.equal(state.paused, true);
  assert.equal(state.pausedReason, 'turnError');
  assert.equal(h.adapter.delivered.length, 1, 'nothing is fed to a broken agent');

  await h.cleanup();
});

test('a turn sent while the queue is paused joins the queue rather than jumping it', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  h.adapter.abort(h.threadId, first.turnId);
  await waitFor(() => h.manager.queueState(h.threadId).paused);

  // Nothing is in flight now, but messages sent earlier are still waiting:
  // starting this one immediately would run it out of order.
  const third = await h.manager.sendTurn(h.threadId, 'third');
  assert.equal(third.queued, true);
  assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [second.turnId, third.turnId]);
  assert.equal(h.adapter.delivered.length, 1);

  await h.cleanup();
});

test('clearing the queue cancels every waiting turn and lifts the pause', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  const third = await h.manager.sendTurn(h.threadId, 'third');
  h.adapter.abort(h.threadId, first.turnId);
  await waitFor(() => h.manager.queueState(h.threadId).paused);

  const state = await h.manager.clearQueue(h.threadId);
  assert.deepEqual(state.queuedTurnIds, []);
  assert.equal(state.paused, false);
  assert.equal((await h.store.getTurn(second.turnId)).status, 'cancelled');
  assert.equal((await h.store.getTurn(third.turnId)).status, 'cancelled');
  assert.equal(h.adapter.delivered.length, 1);

  await h.cleanup();
});

test('cancelling the last queued turn also lifts the pause', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  h.adapter.abort(h.threadId, first.turnId);
  await waitFor(() => h.manager.queueState(h.threadId).paused);

  await h.manager.cancelTurn(h.threadId, second.turnId);
  // Nothing left to hold — a "queue paused" banner over an empty queue would be
  // a dead end for the user.
  assert.equal(h.manager.queueState(h.threadId).paused, false);

  await h.cleanup();
});

test('every queue change broadcasts the whole state', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  await h.manager.sendTurn(h.threadId, 'second');

  const updates = h.notifications.filter((n) => n.method === StreamNotification.QueueUpdated);
  assert.equal(updates.length, 1, 'queueing broadcasts once');
  const params = updates[0]?.params as { queuedTurnIds: string[]; paused: boolean };
  assert.equal(params.queuedTurnIds.length, 1);
  assert.equal(params.paused, false);

  h.adapter.abort(h.threadId, first.turnId);
  await waitFor(() => h.manager.queueState(h.threadId).paused);
  const pausedUpdate = h.notifications
    .filter((n) => n.method === StreamNotification.QueueUpdated)
    .at(-1)?.params as { paused: boolean };
  assert.equal(pausedUpdate.paused, true);

  await h.cleanup();
});

test('queued turns left by a previous run are cancelled at startup', async () => {
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');

  // A restart: the in-memory queue is gone, so a turn left `queued` on disk
  // would wait for a queue that no longer exists.
  const closed = await h.store.cancelOrphanedQueuedTurns(2000);
  assert.equal(closed, 1);
  assert.equal((await h.store.getTurn(second.turnId)).status, 'cancelled');
  // The turn that was actually running is left alone — a different problem.
  assert.equal((await h.store.getTurn(first.turnId)).status, 'streaming');

  await h.cleanup();
});

test('a duplicate completion for the same turn does not drain the queue twice', async () => {
  // An adapter whose CLI outlives its own end-of-turn event can emit a second
  // `turn_completed` for the same turn — Claude Code does, when the model leaves
  // background work running and the CLI later wakes it. Acting on it twice would
  // start the NEXT queued turn against a CLI that is still running, which is the
  // one thing the queue exists to prevent.
  const h = await harness();
  const first = await h.manager.sendTurn(h.threadId, 'first');
  const second = await h.manager.sendTurn(h.threadId, 'second');
  const third = await h.manager.sendTurn(h.threadId, 'third');

  h.adapter.complete(h.threadId, first.turnId);
  // Wait for the delivery this asserts, not for the turn status: the store marks
  // a queued turn `streaming` BEFORE the adapter is handed its text, so waiting
  // on the stored status can observe the gap between the two.
  await waitFor(() => h.adapter.delivered.length === 2);
  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first', 'second'],
  );
  assert.equal((await h.store.getTurn(second.turnId)).status, 'streaming');

  // The same turn reports completion again.
  h.adapter.complete(h.threadId, first.turnId, 'late text');
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(
    h.adapter.delivered.map((d) => d.text),
    ['first', 'second'],
    'the third turn must not be started while the second is still running',
  );
  assert.equal((await h.store.getTurn(third.turnId)).status, 'queued');
  assert.equal(
    h.methods().filter((m) => m === StreamNotification.TurnCompleted).length,
    1,
    'the phone is told once',
  );

  await h.cleanup();
});
