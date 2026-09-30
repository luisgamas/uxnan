/**
 * Mid-turn delivery: every message sent while the agent works waits in the
 * queue, and an agent whose CLI has an input channel mid-turn gets the first
 * one at its next pause — while it is inside a step (a command, a tool), which
 * it reads when that step ends. Only then is the message placed in the
 * conversation, as the turn that carries the rest of the agent's run, so what
 * the agent says after taking it shows under it.
 *
 * Driven by an in-process adapter (no subprocess) so the hand-off, and every
 * way it can decline, are asserted deterministically. The rule under test
 * throughout: a refusal must cost the user nothing but a wait — the message
 * stays in the queue and runs when the turn ends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StreamNotification } from '@uxnan/shared';
import type { AgentCapabilities, AgentId, SendTurnOptions } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  ThreadStore,
  createLogger,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const BASE_CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/** What the adapter should do when the manager offers it a mid-turn message. */
type SteerBehaviour = 'accept' | 'decline' | 'throw' | 'hold' | 'decline-after-end';

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
  /** Under `hold`: settles the pending `steerTurn` (taken or not). */
  release?: (taken: boolean) => void;

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
    if (this.behaviour === 'decline-after-end') {
      // The run ends while the offer is being made, and the agent says no.
      this.complete(options.threadId, options.activeTurnId);
      return new Promise((resolve) => setTimeout(() => resolve(false), 20));
    }
    if (this.behaviour === 'hold') {
      return new Promise((resolve) => {
        this.release = (taken) => {
          if (taken) {
            this.steered.push({
              turnId: options.turnId,
              activeTurnId: options.activeTurnId,
              text: options.text,
            });
          }
          resolve(taken);
        };
      });
    }
    this.steered.push({
      turnId: options.turnId,
      activeTurnId: options.activeTurnId,
      text: options.text,
    });
    return Promise.resolve(true);
  }
  say(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'delta', threadId, turnId, data: { text } });
  }
  step(threadId: string, turnId: string, content: Record<string, unknown>): void {
    this.emit({ type: 'block', threadId, turnId, data: { content } });
  }
  /** A command starts: the agent is inside a step. */
  startStep(threadId: string, turnId: string, blockId = 's1'): void {
    this.step(threadId, turnId, {
      type: 'command_execution',
      blockId,
      command: 'ls',
      status: 'running',
    });
  }
  /** The command ends: the step is over. */
  endStep(threadId: string, turnId: string, blockId = 's1'): void {
    this.step(threadId, turnId, {
      type: 'command_execution',
      blockId,
      command: 'ls',
      status: 'completed',
    });
  }
  complete(threadId: string, turnId: string, text = 'ok'): void {
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
  }
  abort(threadId: string, turnId: string): void {
    this.emit({ type: 'turn_aborted', threadId, turnId });
  }
  /** The agent announced its session for the thread. */
  session(threadId: string, sessionId: string): void {
    this.setNativeSession(threadId, sessionId);
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

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('a follow-up waits in the queue, goes at the next step and is placed when it ends', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    h.adapter.say(h.threadId, first.turnId, 'Before. ');
    await waitFor(async () => (await h.store.getTurn(first.turnId)).messages.length === 2);
    await tick();
    const second = await h.manager.sendTurn(h.threadId, 'second');

    // Sent while the agent writes: it waits, editable, and nothing reaches the agent.
    assert.equal(second.queued, true);
    assert.equal(second.queuePosition, 1);
    assert.deepEqual(h.adapter.steered, []);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');

    // The agent runs a command: it can take the message now, and does.
    h.adapter.startStep(h.threadId, first.turnId);
    await waitFor(() => h.adapter.steered.length === 1);
    assert.deepEqual(h.adapter.steered, [
      { turnId: second.turnId, activeTurnId: first.turnId, text: 'second' },
    ]);
    // Still in the queue — being delivered, no longer cancellable — until the
    // command ends and the agent reads it.
    assert.deepEqual(h.manager.queueState(h.threadId), {
      queuedTurnIds: [second.turnId],
      paused: false,
      deliveringTurnId: second.turnId,
    });
    assert.equal(h.manager.activeTurnId(h.threadId), first.turnId);
    assert.ok(
      h.notifications.some(
        (n) =>
          n.method === StreamNotification.QueueUpdated &&
          n.params?.['deliveringTurnId'] === second.turnId,
      ),
    );
    await assert.rejects(h.manager.cancelTurn(h.threadId, second.turnId), /already taking/);

    // The command ends: the message is placed where the agent took it.
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
    assert.deepEqual(h.manager.queueState(h.threadId), { queuedTurnIds: [], paused: false });
    // It reached the agent WITHOUT starting a second run — the invariant the
    // whole one-run-per-thread design rests on.
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first'],
    );
    // The hand-off is written to disk just after the manager switches turns.
    await waitFor(async () => (await h.store.getTurn(first.turnId)).status === 'completed');
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'streaming');

    // The adapter keeps naming its run by the first turn's id: what it says
    // now answers the second message, and is shown under it.
    h.adapter.say(h.threadId, first.turnId, 'After.');
    h.adapter.complete(h.threadId, first.turnId, 'the whole run');
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'completed');

    const assistant = async (turnId: string) =>
      (await h.store.getTurn(turnId)).messages.find((m) => m.role === 'assistant');
    assert.equal((await assistant(first.turnId))?.content, 'Before. ');
    assert.equal((await assistant(second.turnId))?.content, 'After.');
    // The command the agent was in belongs to the answer it interrupted.
    assert.equal((await assistant(first.turnId))?.blocks?.length, 1);
    assert.equal((await assistant(second.turnId))?.blocks, undefined);
    assert.equal(h.manager.activeTurnId(h.threadId), undefined);

    // To a client it is a queue that drained early, in order: the first turn
    // ends, the second starts, and only then does its prose arrive.
    const order = h.notifications.map((n) =>
      [n.method, n.params?.['turnId'] === second.turnId ? 'second' : 'first'].join(':'),
    );
    const at = (entry: string) => order.indexOf(entry);
    assert.ok(at(`${StreamNotification.TurnCompleted}:first`) >= 0);
    assert.ok(
      at(`${StreamNotification.TurnCompleted}:first`) <
        at(`${StreamNotification.TurnStarted}:second`),
    );
    assert.ok(
      at(`${StreamNotification.TurnStarted}:second`) <
        at(`${StreamNotification.MessageDelta}:second`),
    );
    const firstDone = h.notifications.find(
      (n) => n.method === StreamNotification.TurnCompleted && n.params?.['turnId'] === first.turnId,
    );
    assert.equal(firstDone?.params?.['text'], 'Before. ');
    assert.equal(firstDone?.params?.['continuedIn'], second.turnId);
    assert.equal((await h.store.getTurn(first.turnId)).continuedIn, second.turnId);
    assert.equal((await h.store.getTurn(second.turnId)).continuedIn, undefined);
  } finally {
    await h.cleanup();
  }
});

test('with no step before the end, a queued message runs as the next turn', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.say(h.threadId, first.turnId, 'Just writing.');
    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);

    assert.deepEqual(h.adapter.steered, []);
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first', 'second'],
    );
    assert.equal((await h.store.getTurn(first.turnId)).continuedIn, undefined);
    assert.equal(h.manager.activeTurnId(h.threadId), second.turnId);
  } finally {
    await h.cleanup();
  }
});

test('a message queued while the agent is already in a step goes at once', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    h.adapter.startStep(h.threadId, first.turnId);
    await tick();
    const second = await h.manager.sendTurn(h.threadId, 'second');
    await waitFor(() => h.adapter.steered.length === 1);
    assert.equal(h.manager.queueState(h.threadId).deliveringTurnId, second.turnId);
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
  } finally {
    await h.cleanup();
  }
});

test('a steered message never runs again when the run ends', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
    h.adapter.complete(h.threadId, first.turnId);

    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'completed');
    // Give the drain path a chance to do the wrong thing before asserting it didn't.
    await tick(50);

    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first'],
      'the steered message must not be replayed as a run of its own',
    );
    assert.equal(h.manager.activeTurnId(h.threadId), undefined);
  } finally {
    await h.cleanup();
  }
});

test('stopping the steered turn stops the run the agent knows', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
    await h.manager.cancelTurn(h.threadId, second.turnId);
    assert.deepEqual(h.adapter.cancelled, [first.turnId]);
    h.adapter.abort(h.threadId, first.turnId);
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'aborted');
    assert.equal((await h.store.getTurn(first.turnId)).status, 'completed');
  } finally {
    await h.cleanup();
  }
});

test('the message is placed only once every step the agent is in has ended', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    h.adapter.startStep(h.threadId, first.turnId, 'a');
    h.adapter.startStep(h.threadId, first.turnId, 'b');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    await waitFor(() => h.adapter.steered.length === 1);
    h.adapter.endStep(h.threadId, first.turnId, 'a');
    await tick(50);
    assert.equal(h.manager.activeTurnId(h.threadId), first.turnId, 'b is still running');
    h.adapter.step(h.threadId, first.turnId, {
      type: 'command_execution',
      blockId: 'b',
      command: 'ls',
      status: 'failed',
      output: 'boom',
    });
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'completed');

    const segments = async (turnId: string) =>
      (await h.store.getTurn(turnId)).messages.find((m) => m.role === 'assistant')?.segments ?? [];
    assert.equal((await segments(first.turnId)).length, 2, 'both steps stay where they ran');
    assert.deepEqual(await segments(second.turnId), [], 'no second row under the new message');
  } finally {
    await h.cleanup();
  }
});

test('an agent without steering still queues until the turn ends', async () => {
  const h = await harness(false);
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    await tick();

    assert.equal(second.queued, true);
    assert.equal(second.queuePosition, 1);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
    assert.equal(h.manager.queueState(h.threadId).deliveringTurnId, undefined);

    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.equal(h.adapter.ran[1]?.text, 'second');
  } finally {
    await h.cleanup();
  }
});

test('a declined hand-off keeps the message queued and it runs next', async () => {
  const h = await harness();
  try {
    h.adapter.behaviour = 'decline';
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    await tick();

    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
    assert.deepEqual(h.manager.queueState(h.threadId), {
      queuedTurnIds: [second.turnId],
      paused: false,
    });

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
    h.adapter.startStep(h.threadId, first.turnId);
    await tick();

    assert.equal((await h.store.getTurn(second.turnId)).status, 'queued');
    // The turn that was running is untouched by the failed hand-off.
    assert.equal(h.manager.activeTurnId(h.threadId), first.turnId);
  } finally {
    await h.cleanup();
  }
});

test('queued messages go one at a time, in order, one per step', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    const third = await h.manager.sendTurn(h.threadId, 'third');
    assert.equal(third.queuePosition, 2);

    h.adapter.startStep(h.threadId, first.turnId, 'a');
    await waitFor(() => h.adapter.steered.length === 1);
    assert.equal(h.adapter.steered[0]?.text, 'second', 'the earlier message goes first');
    h.adapter.endStep(h.threadId, first.turnId, 'a');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [third.turnId]);

    // The run goes on (named by its first turn); its next step takes the next one.
    h.adapter.startStep(h.threadId, first.turnId, 'b');
    await waitFor(() => h.adapter.steered.length === 2);
    h.adapter.endStep(h.threadId, first.turnId, 'b');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === third.turnId);
    assert.deepEqual(
      h.adapter.steered.map((s) => [s.text, s.activeTurnId]),
      [
        ['second', first.turnId],
        ['third', first.turnId],
      ],
    );
    await waitFor(async () => (await h.store.getTurn(second.turnId)).continuedIn === third.turnId);
  } finally {
    await h.cleanup();
  }
});

test('a paused queue is never bypassed by a hand-off', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.abort(h.threadId, first.turnId);
    await waitFor(() => h.manager.queueState(h.threadId).paused);

    const third = await h.manager.sendTurn(h.threadId, 'third');
    assert.equal(third.queued, true);
    assert.deepEqual(h.adapter.steered, []);
  } finally {
    await h.cleanup();
  }
});

test('while the agent waits on an approval a follow-up stays queued', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    h.adapter.step(h.threadId, first.turnId, {
      type: 'approval',
      approvalId: 'appr-1',
      action: 'run ls',
    });
    await tick();
    // Handing it in would end the turn that holds the card, and no client
    // would still offer to answer it.
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    await tick();
    assert.equal(second.queued, true);
    assert.deepEqual(h.adapter.steered, []);
    assert.equal(h.manager.activeTurnId(h.threadId), first.turnId);

    h.adapter.complete(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.equal(h.adapter.ran[1]?.text, 'second');
  } finally {
    await h.cleanup();
  }
});

test('with no turn in flight a message just starts one', async () => {
  const h = await harness();
  try {
    const only = await h.manager.sendTurn(h.threadId, 'only');
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

test('clearing the queue leaves an already-placed message alone', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const steered = await h.manager.sendTurn(h.threadId, 'steered');
    const waiting = await h.manager.sendTurn(h.threadId, 'waiting');
    h.adapter.startStep(h.threadId, first.turnId);
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === steered.turnId);

    await h.manager.clearQueue(h.threadId);

    assert.equal((await h.store.getTurn(waiting.turnId)).status, 'cancelled');
    const stored = await h.store.getTurn(steered.turnId);
    assert.equal(stored.status, 'streaming', 'it already reached the agent; it is not cancellable');
  } finally {
    await h.cleanup();
  }
});

test('send now while the agent works says it goes at the next pause', async () => {
  const h = await harness();
  try {
    await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    await assert.rejects(h.manager.sendQueuedNow(h.threadId, second.turnId), /next pause/);
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [second.turnId]);
    assert.deepEqual(h.adapter.steered, []);
  } finally {
    await h.cleanup();
  }
});

test('send now: an agent without mid-turn input says the message waits', async () => {
  const h = await harness(false);
  try {
    await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    await assert.rejects(
      h.manager.sendQueuedNow(h.threadId, second.turnId),
      /takes no message while it works/,
    );
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, [second.turnId]);
  } finally {
    await h.cleanup();
  }
});

test('send now: with nothing running, it starts at once, through a pause', async () => {
  const h = await harness(false);
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    const second = await h.manager.sendTurn(h.threadId, 'second');
    const third = await h.manager.sendTurn(h.threadId, 'third');
    // Stopping the running turn pauses the queue.
    h.adapter.abort(h.threadId, first.turnId);
    await waitFor(() => h.manager.queueState(h.threadId).paused);

    const state = await h.manager.sendQueuedNow(h.threadId, third.turnId);
    assert.equal(state.paused, false);
    assert.deepEqual(state.queuedTurnIds, [second.turnId]);
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first', 'third'],
    );
    assert.equal(h.manager.activeTurnId(h.threadId), third.turnId);
  } finally {
    await h.cleanup();
  }
});

// --- races around the end of the running turn --------------------------------

test('a run that ends while a message is being delivered answers it once', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === first.turnId);
    h.adapter.behaviour = 'hold';
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    await waitFor(() => h.adapter.release !== undefined);
    // The agent's run ends while the delivery is still out...
    h.adapter.complete(h.threadId, first.turnId, 'the whole run');
    await tick();
    // ...and it took the message: the end belongs to the turn it joined.
    h.adapter.release!(true);
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'completed');

    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first'],
      'never sent to the agent a second time',
    );
    assert.equal((await h.store.getTurn(first.turnId)).status, 'completed');
    assert.deepEqual(h.manager.queueState(h.threadId).queuedTurnIds, []);
  } finally {
    await h.cleanup();
  }
});

test('a delivery the agent turns down as its run ends still runs next', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === first.turnId);
    h.adapter.behaviour = 'decline-after-end';
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    await waitFor(() => h.adapter.ran.length === 2);
    assert.deepEqual(
      h.adapter.ran.map((r) => r.text),
      ['first', 'second'],
    );
    await waitFor(async () => (await h.store.getTurn(second.turnId)).status === 'streaming');
  } finally {
    await h.cleanup();
  }
});

test('stopping a turn that already handed its run on leaves the new turn running', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === first.turnId);
    const second = await h.manager.sendTurn(h.threadId, 'second');
    h.adapter.startStep(h.threadId, first.turnId);
    h.adapter.endStep(h.threadId, first.turnId);
    await waitFor(() => h.manager.activeTurnId(h.threadId) === second.turnId);

    await h.manager.cancelTurn(h.threadId, first.turnId);
    assert.deepEqual(h.adapter.cancelled, [], 'the stale cancel reached nothing');
    assert.equal(h.manager.activeTurnId(h.threadId), second.turnId);
  } finally {
    await h.cleanup();
  }
});

test('archiving a thread settles what was waiting in its queue as cancelled', async () => {
  const h = await harness(false);
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === first.turnId);
    const second = await h.manager.sendTurn(h.threadId, 'second');
    assert.equal(second.queued, true);

    await h.manager.closeThreadSession(h.threadId);
    assert.equal((await h.store.getTurn(second.turnId)).status, 'cancelled');
    assert.ok(
      h.notifications.some(
        (n) =>
          n.method === StreamNotification.TurnCancelled && n.params?.['turnId'] === second.turnId,
      ),
    );
  } finally {
    await h.cleanup();
  }
});

test('a stopped turn keeps the session it opened', async () => {
  const h = await harness();
  try {
    const first = await h.manager.sendTurn(h.threadId, 'first');
    await waitFor(() => h.manager.activeTurnId(h.threadId) === first.turnId);
    h.adapter.session(h.threadId, 'sess-1');
    h.adapter.abort(h.threadId, first.turnId);
    await waitFor(async () => (await h.store.getTurn(first.turnId)).status === 'aborted');
    await waitFor(
      async () => (await h.store.getHistorySource(h.threadId)).agentSessionId === 'sess-1',
    );
  } finally {
    await h.cleanup();
  }
});
