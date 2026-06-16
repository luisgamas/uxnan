import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { StreamNotification } from '@uxnan/shared';
import {
  AgentManager,
  DaemonState,
  EchoAgentAdapter,
  ThreadStore,
  createLogger,
} from '../../src/index.js';

// 30s default: the predicate resolves in ~50ms; the generous budget only guards
// against CPU starvation when node:test runs all files in parallel on Windows.
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 30000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

// A real 1x1 transparent PNG (base64, no data: prefix).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('sendTurn drives the echo agent: persists the reply and broadcasts stream events', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => notifications.push(message as { method: string }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'hello world');

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.content, 'hello world');

  const methods = notifications.map((n) => n.method);
  assert.ok(methods.includes(StreamNotification.TurnStarted));
  assert.ok(methods.includes(StreamNotification.MessageDelta));
  assert.ok(methods.includes(StreamNotification.TurnCompleted));
  await rm(baseDir, { recursive: true, force: true });
});

test('sendTurn delivers an image-only turn: placeholder user text + attachment path in the prompt', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-img-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, '', {
    attachments: [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
  });

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);

  // The persisted user message is a faithful placeholder — no temp path leaks.
  assert.equal(turn.messages.find((m) => m.role === 'user')?.content, '[1 image attachment]');
  // The echo agent echoes the prompt it received, proving the attachment note
  // (with the materialized temp file path) was injected into the agent prompt.
  const assistant = String(turn.messages.find((m) => m.role === 'assistant')?.content ?? '');
  assert.match(assistant, /Attached image/);
  assert.match(assistant, /\.png/);
  await rm(baseDir, { recursive: true, force: true });
});

test('sendTurn for an unregistered agent rejects with AgentNotRunning', async () => {
  const baseDir = join(tmpdir(), `uxnan-am2-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'codex',
  });
  const thread = await store.startThread({ projectId: 'p' }, 1);
  await assert.rejects(manager.sendTurn(thread.id, 'hi'));
  await rm(baseDir, { recursive: true, force: true });
});
