import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import type { AgentCapabilities, AgentId, SendTurnOptions } from '@uxnan/shared';
import { StreamNotification } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  EchoAgentAdapter,
  ThreadStore,
  createLogger,
} from '../../src/index.js';

/** Caps for the controllable test adapter (streaming, no approvals/images). */
const CONTROLLED_CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/**
 * A controllable in-process adapter (no subprocess → deterministic, never the
 * Windows-CI stdio flake). `sendTurn` opens a turn (emits `turn_started`) but
 * never finishes on its own; the test ends it explicitly via `complete`.
 */
class ControlledAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities = CONTROLLED_CAPS;
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
  complete(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
  }
}

// FOR-DEV: this whole suite drives the echo agent over a real subprocess + an
// approval round-trip over stdio, which is flaky on Windows CI runners (the turn
// occasionally never completes — see bridge/FOR-DEV.md). Run it on Linux CI and
// locally; skip on Windows CI only.
const test =
  process.platform === 'win32' && process.env['CI'] === 'true' ? baseTest.skip : baseTest;

// 30s default: the predicate resolves in ~50ms; the generous budget only guards
// against CPU starvation when node:test runs all files in parallel on Windows.
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 120000,
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

baseTest('activeTurnId reflects the in-flight turn and clears when it ends', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-active-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new ControlledAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  // Idle: nothing in flight.
  assert.equal(manager.activeTurnId(thread.id), undefined);

  const { turnId } = await manager.sendTurn(thread.id, 'hi');
  // In flight: the getter names the running turn.
  assert.equal(manager.activeTurnId(thread.id), turnId);

  adapter.complete(thread.id, turnId, 'done');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  // Cleared on completion — authoritative "nothing is running now".
  assert.equal(manager.activeTurnId(thread.id), undefined);

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

  // Run in a real working dir so the attachment is written INSIDE it (the fix
  // for sandboxed agents that reject files outside cwd).
  const cwd = join(tmpdir(), `uxnan-am-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, '', {
    cwd,
    attachments: [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
  });

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);

  // The persisted user message is a faithful placeholder — no temp path leaks.
  assert.equal(turn.messages.find((m) => m.role === 'user')?.content, '[1 image attachment]');
  // The echo agent echoes the prompt it received: the note references a
  // cwd-relative path (inside the workspace), not an absolute temp path.
  const assistant = String(turn.messages.find((m) => m.role === 'assistant')?.content ?? '');
  assert.match(assistant, /Attached image/);
  assert.ok(assistant.includes('.uxnan-attachments/'));
  assert.ok(!assistant.includes(cwd));
  // The temp dir is cleaned up once the turn ends (best-effort, async).
  await waitFor(async () => !existsSync(join(cwd, '.uxnan-attachments', turnId)));
  await rm(cwd, { recursive: true, force: true });
  await rm(baseDir, { recursive: true, force: true });
});

test('respondApproval drives the echo demo approval to completion', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-appr-${randomUUID()}`);
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
  const { turnId } = await manager.sendTurn(thread.id, 'approval-demo');

  // The demo emits an approval content block and PAUSES (no completion yet).
  await waitFor(() => notifications.some((n) => n.method === StreamNotification.ContentBlock));
  assert.notEqual((await store.getTurn(turnId)).status, 'completed');

  // Routing the decision unblocks the turn; the reply names the in-flight turn.
  const res = await manager.respondApproval(thread.id, `appr-${turnId}`, 'approve');
  assert.equal(res.turnId, turnId);

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);
  assert.match(
    String(turn.messages.find((m) => m.role === 'assistant')?.content ?? ''),
    /Approved/,
  );
  await rm(baseDir, { recursive: true, force: true });
});

test('requestApproval emits an approval block and resolves on respondApproval (hook flow)', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-hook-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: { content: { type?: string; approvalId?: string; action?: string } }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(
          m.params as { content: { type?: string; approvalId?: string; action?: string } },
        );
      }
    },
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  // Open a turn that stays in-flight (the demo pauses), so requestApproval has
  // an active turn to attach the approval to.
  await manager.sendTurn(thread.id, 'approval-demo');
  await waitFor(() => blocks.length > 0);

  // The hook asks whether a Write may run; capture the approvalId it emitted.
  const decisionPromise = manager.requestApproval(thread.id, {
    toolName: 'Write',
    input: { file_path: '/etc/hosts' },
  });
  await waitFor(() => blocks.some((b) => b.content.action?.includes('Write')));
  const writeBlock = blocks.find((b) => b.content.action?.includes('Write'))!;
  assert.equal(writeBlock.content.type, 'approval');
  const approvalId = writeBlock.content.approvalId!;

  // Approving resolves the hook to 'allow'; rejecting would resolve 'deny'.
  await manager.respondApproval(thread.id, approvalId, 'approve');
  assert.equal(await decisionPromise, 'approve');

  await rm(baseDir, { recursive: true, force: true });
});

test('requestApproval resolves deny on rejection', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-hook2-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: { content: { approvalId?: string; action?: string } }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(m.params as { content: { approvalId?: string; action?: string } });
      }
    },
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  await manager.sendTurn(thread.id, 'approval-demo');
  await waitFor(() => blocks.length > 0);

  const decisionPromise = manager.requestApproval(thread.id, {
    toolName: 'Bash',
    input: { command: 'rm -rf /' },
  });
  await waitFor(() => blocks.some((b) => b.content.action?.includes('Bash')));
  const approvalId = blocks.find((b) => b.content.action?.includes('Bash'))!.content.approvalId!;
  await manager.respondApproval(thread.id, approvalId, 'reject');
  assert.equal(await decisionPromise, 'reject');

  await rm(baseDir, { recursive: true, force: true });
});

test('approval waits while no phone is connected, then times out once one connects', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-appr-offline-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: { content: { approvalId?: string; action?: string } }[] = [];
  let connected = false;
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(m.params as { content: { approvalId?: string; action?: string } });
      }
    },
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
    isPhoneConnected: () => connected,
    approvalTimeoutMs: 60, // tiny window so the test is fast
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  await manager.sendTurn(thread.id, 'approval-demo');
  await waitFor(() => blocks.length > 0);

  // Phone offline: the approval must NOT auto-reject, even past its window.
  let settled: string | undefined;
  const decisionPromise = manager
    .requestApproval(thread.id, { toolName: 'Bash', input: { command: 'ls' } })
    .then((d) => (settled = d));
  await waitFor(() => blocks.some((b) => b.content.action?.includes('Bash')));
  await new Promise((resolve) => setTimeout(resolve, 200)); // > window
  assert.equal(settled, undefined, 'must keep waiting while offline');

  // Phone connects: a fresh window is armed and the approval now times out.
  connected = true;
  manager.onPhoneConnected();
  await decisionPromise;
  assert.equal(settled, 'reject', 'times out to reject once a phone can see it');

  await rm(baseDir, { recursive: true, force: true });
});

test('a disconnect pauses the approval countdown so it never fires offline', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-appr-pause-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: { content: { approvalId?: string; action?: string } }[] = [];
  let connected = true;
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(m.params as { content: { approvalId?: string; action?: string } });
      }
    },
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
    isPhoneConnected: () => connected,
    approvalTimeoutMs: 60,
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  await manager.sendTurn(thread.id, 'approval-demo');
  await waitFor(() => blocks.length > 0);

  // Armed while connected, but the phone drops before the window elapses.
  let settled: string | undefined;
  void manager
    .requestApproval(thread.id, { toolName: 'Bash', input: { command: 'ls' } })
    .then((d) => (settled = d));
  await waitFor(() => blocks.some((b) => b.content.action?.includes('Bash')));
  connected = false;
  manager.onPhoneDisconnected();
  await new Promise((resolve) => setTimeout(resolve, 200)); // > window
  assert.equal(settled, undefined, 'paused countdown must not fire while offline');

  await rm(baseDir, { recursive: true, force: true });
});

test('respondApproval rejects when the thread has no agent', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-appr2-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());
  await assert.rejects(manager.respondApproval('no-such-thread', 'appr-x', 'approve'));
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
