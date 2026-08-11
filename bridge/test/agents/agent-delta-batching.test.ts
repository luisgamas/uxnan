/**
 * Streamed prose is coalesced before it leaves the bridge.
 *
 * Agents emit text in bursts, not at a steady rate: on a real OpenCode turn 60%
 * of deltas arrived within 5 ms of the previous one (911 deltas, gaps p50
 * 3.0 ms). Sending each separately cost a JSON serialization, an AES-GCM seal
 * and a WebSocket frame per handful of characters, and the phone paid the
 * mirror of that to open them. Batching over a 25 ms window cut that recording
 * to a third of the notifications.
 *
 * What these tests pin is ORDER, because that is what a batch can break: the
 * phone places a content block against the open text run (`beforeText`) and
 * finalizes a turn on its completion, so buffered prose must always be sent
 * before either of those. Adapters emit events WITHOUT awaiting the handler, so
 * only each handler's synchronous prefix runs in arrival order — a delta
 * buffered after its store write was overtaken by the turn's completion, which
 * is exactly the regression the third test below holds down.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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

const CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/** Emits exactly what a test tells it to, when the test says so. */
class ScriptedAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities = CAPS;

  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
  delta(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'delta', threadId, turnId, data: { text } });
  }
  block(threadId: string, turnId: string, content: unknown): void {
    this.emit({ type: 'block', threadId, turnId, data: { content } });
  }
  complete(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
  }
}

interface Harness {
  store: ThreadStore;
  manager: AgentManager;
  adapter: ScriptedAdapter;
  threadId: string;
  notifications: { method: string; params?: Record<string, unknown> }[];
  deltas: () => string[];
  methods: () => string[];
  cleanup: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const baseDir = join(tmpdir(), `uxnan-batch-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new ScriptedAdapter();
  manager.register(adapter);
  const thread = await store.startThread({ projectId: 'p' }, 1);
  return {
    store,
    manager,
    adapter,
    threadId: thread.id,
    notifications,
    deltas: () =>
      notifications
        .filter((n) => n.method === StreamNotification.MessageDelta)
        .map((n) => String(n.params?.['delta'] ?? '')),
    methods: () => notifications.map((n) => n.method),
    cleanup: () => rmrf(baseDir),
  };
}

test('deltas arriving together leave as one notification', async () => {
  const h = await harness();
  const { turnId } = await h.manager.sendTurn(h.threadId, 'ask');

  for (const piece of ['Hola', ', ', '¿qué', ' tal', '?']) {
    h.adapter.delta(h.threadId, turnId, piece);
  }
  await delay(80);

  assert.deepEqual(h.deltas(), ['Hola, ¿qué tal?'], 'five deltas, one frame');
  await h.cleanup();
});

test('a batch over the size cap leaves without waiting for the window', async () => {
  const h = await harness();
  const { turnId } = await h.manager.sendTurn(h.threadId, 'ask');

  // 600 characters — past the 512 cap, so it must not wait out the 25 ms window.
  for (let i = 0; i < 6; i += 1) h.adapter.delta(h.threadId, turnId, 'x'.repeat(100));
  await delay(10);

  assert.equal(h.deltas().length, 1, 'sent on the cap, not on the timer');
  assert.equal(h.deltas()[0]?.length, 600);
  await h.cleanup();
});

test('buffered prose is sent before the turn completes, never after', async () => {
  // Adapters emit without awaiting the handler, so a delta still inside its
  // store write must not be overtaken by the completion that follows it — the
  // phone finalizes the turn on that event and would drop the tail, or worse,
  // treat a late delta as a turn starting again.
  const h = await harness();
  const { turnId } = await h.manager.sendTurn(h.threadId, 'ask');

  h.adapter.delta(h.threadId, turnId, 'the answer');
  h.adapter.complete(h.threadId, turnId, 'the answer');
  await delay(80);

  const methods = h.methods();
  const delta = methods.indexOf(StreamNotification.MessageDelta);
  const completed = methods.indexOf(StreamNotification.TurnCompleted);
  assert.notEqual(delta, -1, 'the prose must be sent at all');
  assert.ok(delta < completed, 'and before the completion, not after it');
  assert.deepEqual(h.deltas(), ['the answer']);
  await h.cleanup();
});

test('buffered prose is sent before a content block, keeping the work log in order', async () => {
  const h = await harness();
  const { turnId } = await h.manager.sendTurn(h.threadId, 'ask');

  h.adapter.delta(h.threadId, turnId, 'Voy a mirar.');
  h.adapter.block(h.threadId, turnId, { type: 'command_execution', command: 'ls' });
  h.adapter.delta(h.threadId, turnId, 'Son 24.');
  await delay(80);

  const ordered = new Set<string>([
    StreamNotification.MessageDelta,
    StreamNotification.ContentBlock,
  ]);
  assert.deepEqual(
    h.methods().filter((m) => ordered.has(m)),
    [
      StreamNotification.MessageDelta,
      StreamNotification.ContentBlock,
      StreamNotification.MessageDelta,
    ],
    'text, then the block, then the text that followed it',
  );
  assert.deepEqual(h.deltas(), ['Voy a mirar.', 'Son 24.']);
  await h.cleanup();
});

test('every delta is still persisted individually', async () => {
  // Batching decides how often the phone is told; it must not change when the
  // conversation becomes durable.
  const h = await harness();
  const { turnId } = await h.manager.sendTurn(h.threadId, 'ask');

  for (const piece of ['uno ', 'dos ', 'tres']) h.adapter.delta(h.threadId, turnId, piece);
  await delay(80);

  const turn = await h.store.getTurn(turnId);
  assert.equal(turn.messages.find((m) => m.role === 'assistant')?.content, 'uno dos tres');
  await h.cleanup();
});
