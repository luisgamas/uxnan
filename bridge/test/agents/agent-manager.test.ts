import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentId,
  AgentModel,
  NativeSessionInfo,
  SendTurnOptions,
  TurnInputPart,
} from '@uxnan/shared';
import { StreamNotification, isStep, previewStep } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  EchoAgentAdapter,
  ThreadStore,
  createLogger,
} from '../../src/index.js';
import { modelFor } from '../../src/agents/agent-manager.js';
import { rmrf } from '../helpers/fs.js';
import { stepsOf } from '../helpers/steps.js';

/** Caps for the controllable test adapter (streaming, no approvals/images). */
const CONTROLLED_CAPS: AgentCapabilities = {
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
  error(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'turn_error', threadId, turnId, data: { text } });
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

  // Wait for the TurnCompleted *notification*, not just the stored status:
  // `#onEvent` persists `status = completed` BEFORE it emits the notification,
  // so polling the store status can resolve while the notification is still
  // pending, making the `methods.includes(TurnCompleted)` assertion flaky.
  await waitFor(async () =>
    notifications.some((n) => n.method === StreamNotification.TurnCompleted),
  );

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.content, 'hello world');

  const methods = notifications.map((n) => n.method);
  assert.ok(methods.includes(StreamNotification.TurnStarted));
  assert.ok(methods.includes(StreamNotification.MessageDelta));
  assert.ok(methods.includes(StreamNotification.TurnCompleted));
  await rmrf(baseDir);
});

baseTest('a failed turn persists an error content block into history', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-err-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new ControlledAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go');
  adapter.error(thread.id, turnId, 'API error (status 402): usage balance exhausted');
  // Wait for the TurnError *notification*, not the stored status: the status
  // is persisted BEFORE the notification is emitted (as for TurnCompleted
  // above), so polling the store can resolve while the notification is still
  // pending and the TurnError assertion below flakes.
  await waitFor(async () => notifications.some((n) => n.method === StreamNotification.TurnError));

  // The failure reason is persisted as a system/error content block so a
  // `turn/list` re-sync (after a restart) still shows why the turn failed.
  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  const blocks = stepsOf(assistant) as { type?: string; kind?: string; text?: string }[];
  const errBlock = blocks.find((b) => b.type === 'system' && b.kind === 'error');
  assert.ok(errBlock, 'the failure reason is persisted as a system/error block');
  assert.match(errBlock?.text ?? '', /usage balance exhausted/);
  // NOT broadcast as a content block (the phone renders it live from the
  // turn/error notification, so a content-block would double the banner).
  assert.ok(!notifications.some((n) => n.method === StreamNotification.ContentBlock));
  assert.ok(notifications.some((n) => n.method === StreamNotification.TurnError));

  await rmrf(baseDir);
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

  await rmrf(baseDir);
});

test('an attachment-only turn keeps its marker and reaches the agent labelled, with its file', async () => {
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
  const { turnId } = await manager.sendTurn(thread.id, '￼', {
    cwd,
    attachments: [{ type: 'image', name: 'shot.png', mimeType: 'image/png', base64Data: PNG_1x1 }],
  });

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);

  // The persisted user message is the user's own: its marker, no temp path —
  // its image is kept with it, named, for every client to show in place.
  const user = turn.messages.find((m) => m.role === 'user');
  assert.equal(user?.content, '￼');
  assert.equal(user?.attachments?.length, 1);
  assert.equal(user?.attachments?.[0]?.mimeType, 'image/png');
  assert.equal(user?.attachments?.[0]?.name, 'shot.png');
  // The echo agent echoes the prompt it received: the label where the marker
  // was, and a note naming a cwd-relative path (inside the workspace).
  const assistant = String(turn.messages.find((m) => m.role === 'assistant')?.content ?? '');
  assert.ok(assistant.startsWith('[Image 1: shot.png]'));
  assert.ok(assistant.includes(`.uxnan-attachments/${turnId}/1/shot.png`));
  assert.match(assistant, /open it with your file\/vision tools/);
  assert.ok(!assistant.includes(cwd));
  assert.ok(!assistant.includes('￼'));
  // The temp dir is cleaned up once the turn ends (best-effort, async).
  await waitFor(async () => !existsSync(join(cwd, '.uxnan-attachments', turnId)));
  await rmrf(cwd);
  await rmrf(baseDir);
});

test('a turn without a cwd writes the attachment into the ADAPTER working dir', async () => {
  // Regression: the fallback used to be the OS temp dir with an absolute
  // reference, which every sandboxed agent refuses to open (verified against
  // Claude: "the read was blocked by a permission prompt"). The file must land
  // where the CLI actually runs, so the reference stays workspace-relative.
  const baseDir = join(tmpdir(), `uxnan-am-nocwd-${randomUUID()}`);
  const adapterCwd = join(tmpdir(), `uxnan-am-adaptercwd-${randomUUID()}`);
  await mkdir(adapterCwd, { recursive: true });
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new EchoAgentAdapter();
  // The echo adapter has no cwd of its own; report one like the real adapters.
  (adapter as unknown as { defaultCwd: () => string }).defaultCwd = () => adapterCwd;
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'look at this ￼', {
    attachments: [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
  });

  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);
  const assistant = String(turn.messages.find((m) => m.role === 'assistant')?.content ?? '');
  // Referenced relatively (inside the adapter's workspace), never as an
  // absolute path under the OS temp dir.
  assert.ok(assistant.startsWith('look at this [Image 1]'));
  assert.ok(assistant.includes(`.uxnan-attachments/${turnId}/1/image-1.png`));
  assert.ok(!assistant.includes(adapterCwd));

  await waitFor(async () => !existsSync(join(adapterCwd, '.uxnan-attachments', turnId)));
  await rmrf(adapterCwd);
  await rmrf(baseDir);
});

test('an adapter that takes inline images gets each right after its label, and the file too', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-inline-${randomUUID()}`);
  const cwd = join(tmpdir(), `uxnan-am-inline-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new EchoAgentAdapter();
  (adapter as unknown as { takesInlineImages: () => boolean }).takesInlineImages = () => true;
  const seen: { input?: TurnInputPart[]; fileThere: boolean }[] = [];
  const send = adapter.sendTurn.bind(adapter);
  adapter.sendTurn = (options) => {
    const image = options.input?.find((p) => p.type === 'image');
    seen.push({
      ...(options.input !== undefined ? { input: options.input } : {}),
      fileThere: image?.type === 'image' && image.path !== undefined && existsSync(image.path),
    });
    return send(options);
  };
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'in ￼ a cat, in ￼ a table', {
    cwd,
    attachments: [
      { type: 'image', name: 'a.png', mimeType: 'image/png', base64Data: PNG_1x1 },
      { type: 'file', name: 'b.csv', mimeType: 'text/csv', base64Data: 'YSxi' },
    ],
  });
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  const [{ input, fileThere } = { fileThere: false }] = seen;
  assert.deepEqual(
    input?.map((p) => (p.type === 'text' ? p.text.split('\n')[0] : `<${p.label}>`)),
    ['in [Image 1: a.png]', '<[Image 1: a.png]>', ' a cat, in [File 1: b.csv] a table'],
  );
  // The image is still written for file work; the note says it came inline.
  assert.equal(fileThere, true);
  const assistant = String(
    (await store.getTurn(turnId)).messages.find((m) => m.role === 'assistant')?.content ?? '',
  );
  assert.match(assistant, /Image 1: a\.png: sent with this message as an image/);
  assert.match(assistant, /File 1: b\.csv: .*\(open it with your file tools\)/);

  await rmrf(cwd);
  await rmrf(baseDir);
});

test('a command invocation carries its attachment labels in its arguments', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-cmd-att-${randomUUID()}`);
  const cwd = join(tmpdir(), `uxnan-am-cmd-att-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
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
    cwd,
    command: { name: 'review', args: 'this screen ￼ please' },
    attachments: [{ type: 'image', name: 's.png', mimeType: 'image/png', base64Data: PNG_1x1 }],
  });
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  const turn = await store.getTurn(turnId);
  // History shows the command as written, its marker in place…
  assert.equal(
    turn.messages.find((m) => m.role === 'user')?.content,
    '/review this screen ￼ please',
  );
  // …and the agent gets it labelled.
  const assistant = String(turn.messages.find((m) => m.role === 'assistant')?.content ?? '');
  assert.ok(assistant.startsWith('/review this screen [Image 1: s.png] please'));

  await rmrf(cwd);
  await rmrf(baseDir);
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
  await rmrf(baseDir);
});

test('requestApproval emits an approval block and resolves on respondApproval (hook flow)', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-hook-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: {
    content: { type?: string; approvalId?: string; action?: string; blockId?: string };
  }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(
          m.params as {
            content: { type?: string; approvalId?: string; action?: string; blockId?: string };
          },
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
  // Its own id is its step id: a second copy of it (a client reloading the
  // turn while the live block is on its way) replaces the first in place.
  assert.equal(writeBlock.content.blockId, approvalId);

  // Approving resolves the hook to 'allow'; rejecting would resolve 'deny'.
  await manager.respondApproval(thread.id, approvalId, 'approve');
  assert.equal(await decisionPromise, 'approve');

  await rmrf(baseDir);
});

test('an approval with its own action shows that text and no detail', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-hook-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: {
    content: { type?: string; approvalId?: string; action?: string; blockId?: string };
  }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(
          m.params as {
            content: { type?: string; approvalId?: string; action?: string; blockId?: string };
          },
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
  // A plan leaving plan mode: "Allow ExitPlanMode: <plan path>" would not say
  // what is being decided.
  const decisionPromise = manager.requestApproval(thread.id, {
    toolName: 'ExitPlanMode',
    input: { plan: '1. Do it', file_path: '/tmp/plan.md' },
    action: 'Start implementing this plan',
  });
  await waitFor(() => blocks.some((b) => b.content.action === 'Start implementing this plan'));
  const planBlock = blocks.find((b) => b.content.action === 'Start implementing this plan')!;
  assert.equal(planBlock.content.type, 'approval');
  assert.equal((planBlock.content as { detail?: string }).detail, undefined);

  await manager.respondApproval(thread.id, planBlock.content.approvalId!, 'reject');
  assert.equal(await decisionPromise, 'reject');

  await rmrf(baseDir);
});

test('a withdrawn approval or question resolves at once and every client retires its card', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-withdraw-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notes: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) =>
      notes.push(message as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());
  const thread = await store.startThread({ projectId: 'p' }, 1);
  await manager.sendTurn(thread.id, 'approval-demo'); // keeps a turn in-flight
  await waitFor(() => notes.some((n) => n.method === StreamNotification.ContentBlock));

  const approval = new AbortController();
  const decision = manager.requestApproval(
    thread.id,
    { toolName: 'Bash', input: { command: 'ls' } },
    approval.signal,
  );
  const question = new AbortController();
  const answers = manager.requestQuestion(
    thread.id,
    [{ question: 'Which?', options: [{ label: 'A' }] }],
    question.signal,
  );
  await waitFor(
    () => notes.filter((n) => n.method === StreamNotification.ContentBlock).length >= 3,
  );
  approval.abort();
  question.abort();
  assert.equal(await decision, 'reject');
  assert.deepEqual(await answers, []);
  // Announced once the settled cards are on disk.
  await waitFor(() => notes.some((n) => n.method === StreamNotification.ApprovalResolved));
  await waitFor(() => notes.some((n) => n.method === StreamNotification.QuestionResolved));

  // Already withdrawn: nothing is asked at all.
  assert.equal(
    await manager.requestApproval(thread.id, { toolName: 'Bash', input: {} }, approval.signal),
    'reject',
  );
  await rmrf(baseDir);
});

test('requestQuestion emits a question block and resolves on respondQuestion', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-q-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const blocks: { content: { type?: string; questionId?: string; blockId?: string } }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => {
      const m = message as { method: string; params?: unknown };
      if (m.method === StreamNotification.ContentBlock) {
        blocks.push(
          m.params as { content: { type?: string; questionId?: string; blockId?: string } },
        );
      }
    },
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter());

  const thread = await store.startThread({ projectId: 'p' }, 1);
  await manager.sendTurn(thread.id, 'approval-demo'); // keeps a turn in-flight
  await waitFor(() => blocks.length > 0);

  const answersPromise = manager.requestQuestion(thread.id, [
    {
      question: 'Which language?',
      header: 'Language',
      options: [{ label: 'Python' }, { label: 'JS' }],
    },
  ]);
  await waitFor(() => blocks.some((b) => b.content.type === 'question'));
  const qBlock = blocks.find((b) => b.content.type === 'question')!;
  const questionId = qBlock.content.questionId!;
  assert.ok(questionId.length > 0);
  assert.equal(qBlock.content.blockId, questionId, 'a question is one request, by its id');

  await manager.respondQuestion(thread.id, questionId, [['Python']]);
  assert.deepEqual(await answersPromise, [['Python']]);

  await rmrf(baseDir);
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

  await rmrf(baseDir);
});

/** A manager on a scratch store driving the in-process {@link ControlledAdapter}. */
async function requestHarness(): Promise<{
  baseDir: string;
  store: ThreadStore;
  manager: AgentManager;
  adapter: ControlledAdapter;
  notes: { method: string; params: Record<string, unknown> }[];
  asked: { requestId: string; kind: string; text: string }[];
  threadId: string;
  turnId: string;
}> {
  const baseDir = join(tmpdir(), `uxnan-am-req-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notes: { method: string; params: Record<string, unknown> }[] = [];
  const asked: { requestId: string; kind: string; text: string }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => notes.push(message as (typeof notes)[number]),
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
    onInputRequested: (info) => asked.push(info),
  });
  const adapter = new ControlledAdapter();
  manager.register(adapter);
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go');
  await waitFor(() => manager.activeTurnId(thread.id) === turnId);
  return { baseDir, store, manager, adapter, notes, asked, threadId: thread.id, turnId };
}

/** The stored request card with [id] on [turnId] (`turn/list` serves this). */
async function storedRequest(
  store: ThreadStore,
  turnId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const turn = await store.getTurn(turnId);
  const segments = turn.messages.find((m) => m.role === 'assistant')?.segments ?? [];
  return (segments as Record<string, unknown>[]).find(
    (b) => b['approvalId'] === id || b['questionId'] === id,
  );
}

baseTest('a pending approval and question wait with no clock until a person answers', async (t) => {
  const h = await requestHarness();
  let decision: string | undefined;
  let answers: string[][] | undefined;
  void h.manager
    .requestApproval(h.threadId, { toolName: 'Bash', input: { command: 'ls' } })
    .then((d) => (decision = d));
  void h.manager
    .requestQuestion(h.threadId, [{ question: 'Which?', options: [{ label: 'A' }] }])
    .then((a) => (answers = a));
  await waitFor(() => h.asked.length === 2);
  const [approval, question] = h.asked;
  assert.equal(approval?.kind, 'approval');
  assert.equal(approval?.text, 'Allow Bash: ls');
  assert.equal(question?.kind, 'question');
  assert.equal(question?.text, 'Which?');

  // A day passes: nothing resolves on its own, both stay open for every client.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  t.mock.timers.reset();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(decision, undefined);
  assert.equal(answers, undefined);
  assert.deepEqual(
    h.manager.liveStates()[0]?.awaitingInput?.sort(),
    [approval!.requestId, question!.requestId].sort(),
  );
  assert.equal(
    (await storedRequest(h.store, h.turnId, approval!.requestId))?.['outcome'],
    undefined,
  );

  // A person answers: the adapter gets it, the stored cards carry the outcome.
  await h.manager.respondApproval(h.threadId, approval!.requestId, 'approve');
  await h.manager.respondQuestion(h.threadId, question!.requestId, [['A']]);
  assert.equal(decision, 'approve');
  assert.deepEqual(answers, [['A']]);
  assert.deepEqual((await storedRequest(h.store, h.turnId, approval!.requestId))?.['outcome'], {
    decision: 'approve',
  });
  assert.deepEqual((await storedRequest(h.store, h.turnId, question!.requestId))?.['outcome'], {
    answers: [['A']],
  });
  const resolved = h.notes.filter(
    (n) =>
      n.method === StreamNotification.ApprovalResolved ||
      n.method === StreamNotification.QuestionResolved,
  );
  assert.equal(resolved.length, 2);
  assert.ok(resolved.every((n) => n.params['withdrawn'] === undefined));
  assert.equal(h.manager.liveStates()[0]?.awaitingInput, undefined);

  h.adapter.complete(h.threadId, h.turnId, 'ok');
  await rmrf(h.baseDir);
});

baseTest('a run that ends withdraws the requests it was waiting on', async () => {
  const h = await requestHarness();
  const decision = h.manager.requestApproval(h.threadId, {
    toolName: 'Bash',
    input: { command: 'ls' },
  });
  const answers = h.manager.requestQuestion(h.threadId, [
    { question: 'Which?', options: [{ label: 'A' }] },
  ]);
  await waitFor(() => h.asked.length === 2);

  // The CLI died: the turn errors, and nothing waits on its requests any more.
  h.adapter.error(h.threadId, h.turnId, 'agent exited');
  assert.equal(await decision, 'reject');
  assert.deepEqual(await answers, []);
  await waitFor(() => h.notes.some((n) => n.method === StreamNotification.QuestionResolved));
  const approvalNote = h.notes.find((n) => n.method === StreamNotification.ApprovalResolved);
  const questionNote = h.notes.find((n) => n.method === StreamNotification.QuestionResolved);
  assert.equal(approvalNote?.params['withdrawn'], true);
  assert.equal(questionNote?.params['withdrawn'], true);
  assert.equal(questionNote?.params['skipped'], true);
  const [approval, question] = h.asked;
  assert.deepEqual((await storedRequest(h.store, h.turnId, approval!.requestId))?.['outcome'], {
    decision: 'reject',
    withdrawn: true,
  });
  assert.deepEqual((await storedRequest(h.store, h.turnId, question!.requestId))?.['outcome'], {
    answers: [],
    withdrawn: true,
  });
  await rmrf(h.baseDir);
});

baseTest('an agent that withdraws its request settles the card as withdrawn', async () => {
  const h = await requestHarness();
  const controller = new AbortController();
  const decision = h.manager.requestApproval(
    h.threadId,
    { toolName: 'Bash', input: { command: 'ls' } },
    controller.signal,
  );
  await waitFor(() => h.asked.length === 1);
  controller.abort();
  assert.equal(await decision, 'reject');
  await waitFor(() => h.notes.some((n) => n.method === StreamNotification.ApprovalResolved));
  const note = h.notes.find((n) => n.method === StreamNotification.ApprovalResolved);
  assert.equal(note?.params['withdrawn'], true);
  // A late answer from a client finds nothing pending and changes nothing.
  await assert.rejects(h.manager.respondApproval(h.threadId, h.asked[0]!.requestId, 'approve'));
  h.adapter.complete(h.threadId, h.turnId, 'ok');
  await rmrf(h.baseDir);
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
  await rmrf(baseDir);
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
  await rmrf(baseDir);
});

test('deprecated agents are unavailable, undiscoverable for models, and cannot run turns', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-deprecated-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new EchoAgentAdapter(), {
    displayName: 'Legacy agent',
    available: true,
    deprecated: true,
  });

  assert.deepEqual(manager.listAgents()[0], {
    agentId: 'echo',
    displayName: 'Legacy agent',
    available: false,
    capabilities: manager.listAgents()[0]?.capabilities,
    deprecated: true,
  });
  assert.deepEqual(await manager.getModels('echo'), []);
  assert.deepEqual(await manager.getCommands('echo', baseDir), []);
  const thread = await store.startThread({ projectId: 'p' }, 1);
  await assert.rejects(manager.sendTurn(thread.id, 'hi'), /deprecated and cannot run new turns/);
  await rmrf(baseDir);
});

/**
 * Records every cancelTurn it receives, so a test can assert the manager routed
 * a cancel to the RIGHT adapter. `agentId` is a constructor param so one class
 * can stand in for both the default and a non-default agent.
 */
class SpyAdapter extends BaseAgentAdapter {
  readonly capabilities = CONTROLLED_CAPS;
  readonly canceled: { threadId: string; turnId: string }[] = [];
  constructor(readonly agentId: AgentId) {
    super();
  }
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
  cancelTurn(threadId: string, turnId: string): Promise<void> {
    this.canceled.push({ threadId, turnId });
    return Promise.resolve();
  }
}

test('cancelTurn routes to the THREAD’s agent, not the default (global stop-turn bug)', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-cancel-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const def = new SpyAdapter('echo');
  const other = new SpyAdapter('zero');
  manager.register(def);
  manager.register(other);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  // Turn runs on the NON-default agent — mirrors turn/send passing runtime.agentId.
  const { turnId } = await manager.sendTurn(thread.id, 'hi', { agentId: 'zero' });

  // turn/cancel does NOT pass agentId; the manager must resolve the thread's own.
  await manager.cancelTurn(thread.id, turnId);

  assert.deepEqual(other.canceled, [{ threadId: thread.id, turnId }]);
  assert.deepEqual(def.canceled, []);
  await rmrf(baseDir);
});

/**
 * Records the text/command a turn is driven with, and advertises one command.
 * `withExpand` toggles whether it expands commands itself (custom prompt-template
 * agents) or leaves the manager to compose the native `/name args` form.
 */
class CustomCommandAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities: AgentCapabilities = { ...CONTROLLED_CAPS, commands: true };
  lastText: string | undefined;
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.lastText = options.text;
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    this.emit({
      type: 'turn_completed',
      threadId: options.threadId,
      turnId: options.turnId,
      data: { text: 'ok' },
    });
    return Promise.resolve();
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
  listCommands(): Promise<AgentCommand[]> {
    return Promise.resolve([{ name: 'refactor', source: 'custom', headlessSupported: true }]);
  }
  expandCommand(name: string, args?: string): Promise<string> {
    return Promise.resolve(`EXPANDED ${name} :: ${args ?? ''}`);
  }
}

/** A native-command agent (Claude/ACP): advertises commands but has no expander. */
class NativeCommandAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities: AgentCapabilities = { ...CONTROLLED_CAPS, commands: true };
  lastText: string | undefined;
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.lastText = options.text;
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    this.emit({
      type: 'turn_completed',
      threadId: options.threadId,
      turnId: options.turnId,
      data: { text: 'ok' },
    });
    return Promise.resolve();
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
  listCommands(): Promise<AgentCommand[]> {
    return Promise.resolve([{ name: 'compact', source: 'builtin', headlessSupported: true }]);
  }
}

test('getCommands returns the adapter’s advertised commands (empty for one without listCommands)', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-cmds-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  manager.register(new CustomCommandAdapter());
  const commands = await manager.getCommands('echo');
  assert.deepEqual(commands, [{ name: 'refactor', source: 'custom', headlessSupported: true }]);
  // The Echo agent has no listCommands → empty, never throws.
  const none = await manager.getCommands('codex');
  assert.deepEqual(none, []);
  await rmrf(baseDir);
});

test('command invocation with an expander: the agent runs the EXPANDED text; history shows /name', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-cmdx-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new CustomCommandAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, '', {
    command: { name: 'refactor', args: 'auth.ts' },
  });
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  // The adapter received the expanded prompt, not `/refactor`.
  assert.equal(adapter.lastText, 'EXPANDED refactor :: auth.ts');
  // History persists the command form, not the (potentially huge) expansion.
  const turn = await store.getTurn(turnId);
  assert.equal(turn.messages.find((m) => m.role === 'user')?.content, '/refactor auth.ts');
  await rmrf(baseDir);
});

test('command invocation without an expander: the agent runs the native /name args form', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-cmdn-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new NativeCommandAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, '', {
    command: { name: 'compact' },
  });
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  // No expander → the CLI's native slash form is sent (Claude/ACP interpret it).
  assert.equal(adapter.lastText, '/compact');
  await rmrf(baseDir);
});

/** ControlledAdapter that can also stream deltas and (flagged) blocks. */
class StreamingAdapter extends ControlledAdapter {
  delta(threadId: string, turnId: string, text: string): void {
    this.emit({ type: 'delta', threadId, turnId, data: { text } });
  }
  block(threadId: string, turnId: string, content: unknown, beforeText?: boolean): void {
    this.emit({
      type: 'block',
      threadId,
      turnId,
      data: { content, ...(beforeText ? { beforeText } : {}) },
    });
  }
}

baseTest('a beforeText block is stored before the open run and flagged on the wire', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-btx-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new StreamingAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go');
  adapter.delta(thread.id, turnId, 'y si re');
  // a parallel-activity block lands while the text run is open…
  adapter.block(thread.id, turnId, { type: 'tool', name: 'Read' }, true);
  adapter.delta(thread.id, turnId, 'porta');
  // …and a sequential one after (no flag)
  adapter.block(thread.id, turnId, { type: 'tool', name: 'Bash' });
  adapter.complete(thread.id, turnId, 'y si reporta');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  // Stored order: the open run stayed whole, the flagged block sits before it.
  const assistant = (await store.getTurn(turnId)).messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.segments, [
    { type: 'tool', name: 'Read' },
    { type: 'text', text: 'y si reporta' },
    { type: 'tool', name: 'Bash' },
  ]);
  // Wire: the flag rides only on the flagged block's notification, so the
  // phone's live buffer applies the identical placement.
  const blockNotes = notifications.filter((n) => n.method === StreamNotification.ContentBlock);
  assert.equal(blockNotes.length, 2);
  assert.equal(blockNotes[0]?.params?.['beforeText'], true);
  assert.equal('beforeText' in (blockNotes[1]?.params ?? {}), false);

  await rmrf(baseDir);
});

baseTest('a live step is told as its preview, at the index it is stored at', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-live-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new StreamingAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go');
  const long = `cat <<'EOF' > file.ts\n${'x'.repeat(5_000)}\nEOF`;
  const output = `${'o'.repeat(9_000)}tail`;
  // Every placement the store knows, emitted without waiting — as adapters do.
  adapter.delta(thread.id, turnId, 'Writing.');
  adapter.block(thread.id, turnId, {
    type: 'command_execution',
    blockId: 'c1',
    command: long,
    status: 'running',
  });
  adapter.block(thread.id, turnId, { type: 'plan', steps: [] });
  adapter.delta(thread.id, turnId, 'Then ');
  adapter.block(
    thread.id,
    turnId,
    { type: 'tool', blockId: 'r1', toolName: 'Read', input: {} },
    true,
  );
  adapter.delta(thread.id, turnId, 'more.');
  adapter.block(thread.id, turnId, {
    type: 'command_execution',
    blockId: 'c1',
    command: long,
    status: 'completed',
    output,
  });
  adapter.block(thread.id, turnId, {
    type: 'diff',
    blockId: 'd1',
    filename: 'file.ts',
    diff: '+x',
    additions: 1,
    deletions: 0,
  });
  adapter.complete(thread.id, turnId, 'Writing.Then more.');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  const segments = (await store.getTurn(turnId)).messages.find(
    (m) => m.role === 'assistant',
  )!.segments!;
  const told = notifications.filter((n) => n.method === StreamNotification.ContentBlock);
  assert.equal(told.length, 5);
  assert.deepEqual(
    told.map((n) => n.params?.['index']),
    [1, 2, 3, 1, 5],
  );
  for (const note of told) {
    const index = note.params?.['index'] as number;
    const stored = segments[index] as Record<string, unknown>;
    const content = note.params?.['content'] as Record<string, unknown>;
    // The index is where the store keeps it (a settled step: where it started).
    assert.equal(content['type'], stored['type'], `index ${index}`);
    if (stored['blockId'] !== undefined) assert.equal(content['blockId'], stored['blockId']);
  }
  // A step rides as its preview, bounded like a page; anything else as it is.
  const settled = told[3]!.params!['content'] as Record<string, unknown>;
  assert.deepEqual(
    settled,
    previewStep(
      segments[told[3]!.params!['index'] as number] as Parameters<typeof previewStep>[0],
      told[3]!.params!['index'] as number,
    ),
  );
  assert.equal(settled['commandChars'], long.length);
  assert.equal(settled['outputChars'], output.length);
  assert.ok(JSON.stringify(settled).length < 2_000);
  assert.deepEqual(told[1]!.params!['content'], { type: 'plan', steps: [] });
  assert.equal('diff' in (told[4]!.params!['content'] as object), false);

  await rmrf(baseDir);
});

baseTest('a terminal event that throws ends the turn instead of hanging it', async () => {
  // Defense in depth for the Windows atomic-write failure fixed in
  // `DaemonState.writeJson`: `#onEvent` catches everything and only logged, so a
  // throw on a TERMINAL event left the turn `streaming` forever — the phone sat
  // on "responding…" and the suite burned its full 120s `waitFor` budget.
  const baseDir = join(tmpdir(), `uxnan-am-terminal-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new StreamingAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go');

  // Break ONLY the completion path, exactly as a refused rename would. An own
  // property shadows the prototype method while `this` stays the real store, so
  // its private fields and every other method keep working.
  const original = store.completeTurn.bind(store);
  Object.defineProperty(store, 'completeTurn', {
    configurable: true,
    value: () => Promise.reject(new Error('simulated persistence failure')),
  });

  adapter.complete(thread.id, turnId, 'partial');

  // It must reach a TERMINAL state — the whole point is that it does not hang.
  await waitFor(async () => (await store.getTurn(turnId)).status === 'error');
  const errorNote = notifications.find((n) => n.method === StreamNotification.TurnError);
  assert.ok(errorNote, 'the phone must be told the turn ended');
  assert.match(JSON.stringify(errorNote?.params ?? {}), /could not be finalized/);

  Object.defineProperty(store, 'completeTurn', { configurable: true, value: original });
  await rmrf(baseDir);
});

// The mirror of `#persistAgentSession`: after a restart the adapter's in-memory
// map is empty, so the manager offers the id the store kept. Without it the
// next turn opens a NEW agent session under a conversation whose history the
// phone still shows — the agent would have lost the context the user can see.
baseTest('a turn hands the persisted native session id back to its adapter', async () => {
  class AdoptingAdapter extends ControlledAdapter {
    readonly adopted: [string, string][] = [];
    override adoptNativeSession(threadId: string, sessionId: string): void {
      this.adopted.push([threadId, sessionId]);
      super.adoptNativeSession(threadId, sessionId);
    }
  }

  const baseDir = join(tmpdir(), `uxnan-am-adopt-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new AdoptingAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
  await store.setAgentSession(thread.id, 'native-session-1');
  const { turnId } = await manager.sendTurn(thread.id, 'go');
  await waitFor(() => adapter.adopted.length > 0);
  assert.deepEqual(adapter.adopted[0], [thread.id, 'native-session-1']);

  // Offered once: a second turn finds the adapter already holding the thread.
  adapter.complete(thread.id, turnId, 'done');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  await manager.sendTurn(thread.id, 'again');
  assert.equal(adapter.adopted.length, 1);
  await rmrf(baseDir);
});

// A thread switched to another agent must not inherit the previous agent's
// session id — that would resume someone else's conversation.
baseTest('the persisted session id is not offered to a different agent', async () => {
  class AdoptingAdapter extends ControlledAdapter {
    readonly adopted: [string, string][] = [];
    override adoptNativeSession(threadId: string, sessionId: string): void {
      this.adopted.push([threadId, sessionId]);
      super.adoptNativeSession(threadId, sessionId);
    }
  }

  const baseDir = join(tmpdir(), `uxnan-am-adopt-other-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new AdoptingAdapter();
  manager.register(adapter);

  // The stored session belongs to `codex`; the turn runs on `echo`.
  const thread = await store.startThread({ projectId: 'p', agentId: 'codex' }, 1);
  await store.setAgentSession(thread.id, 'codex-session-1');
  await manager.sendTurn(thread.id, 'go');
  assert.deepEqual(adapter.adopted, []);
  await rmrf(baseDir);
});

baseTest(
  'closeThreadSession cancels active turns and invokes closeSession on adapters',
  async () => {
    class ClosingAdapter extends ControlledAdapter {
      readonly closed: string[] = [];
      closeSession(threadId: string): Promise<void> {
        this.closed.push(threadId);
        return Promise.resolve();
      }
    }

    const baseDir = join(tmpdir(), `uxnan-am-close-session-${randomUUID()}`);
    const store = new ThreadStore(new DaemonState(baseDir));
    const manager = new AgentManager({
      store,
      notify: () => {},
      now: () => 1000,
      logger: createLogger('test', 'error'),
      defaultAgent: 'echo',
    });
    const adapter = new ClosingAdapter();
    manager.register(adapter);

    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    const { turnId } = await manager.sendTurn(thread.id, 'running turn');
    assert.equal(manager.activeTurnId(thread.id), turnId);

    await manager.closeThreadSession(thread.id);
    assert.equal(manager.activeTurnId(thread.id), undefined);
    assert.deepEqual(adapter.closed, [thread.id]);
    await rmrf(baseDir);
  },
);

baseTest('block paths are shown from the folder the turn ran in', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-paths-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string; params?: Record<string, unknown> }[] = [];
  const manager = new AgentManager({
    store,
    notify: (m) => notifications.push(m as { method: string; params?: Record<string, unknown> }),
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new StreamingAdapter();
  manager.register(adapter);

  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'go', { cwd: '/work/app' });
  adapter.block(thread.id, turnId, { type: 'diff', filename: '/work/app/src/a.ts', diff: '' });
  adapter.block(thread.id, turnId, {
    type: 'tool',
    toolName: 'Read',
    target: '/work/app/README.md',
  });
  adapter.block(thread.id, turnId, { type: 'diff', filename: '/etc/hosts', diff: '' });
  adapter.complete(thread.id, turnId, 'done');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');

  const assistant = (await store.getTurn(turnId)).messages.find((m) => m.role === 'assistant');
  const shown = stepsOf(assistant);
  assert.deepEqual(
    shown.map((b) => b['filename'] ?? b['target']),
    ['src/a.ts', 'README.md', '/etc/hosts'],
  );
  // The phone and the desktop are told the same thing the store keeps — each
  // step as its preview, at the index it stands at.
  const notes = notifications.filter((n) => n.method === StreamNotification.ContentBlock);
  assert.deepEqual(
    notes.map((n) => n.params?.['content']),
    (assistant?.segments ?? []).flatMap((s, i) => (isStep(s) ? [previewStep(s, i)] : [])),
  );
  assert.deepEqual(
    notes.map((n) => n.params?.['index']),
    [0, 1, 2],
  );

  await rmrf(baseDir);
});

baseTest('a turn runs with the sending desktop’s tools, else the longest-attached', async () => {
  const baseDir = join(tmpdir(), `uxnan-am-tools-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => undefined,
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
    mcpServers: [{ name: 'uxnan', url: 'http://127.0.0.1:51233/mcp', token: 'bridge' }],
  });
  const seen: string[] = [];
  class RecordingAdapter extends ControlledAdapter {
    override sendTurn(options: SendTurnOptions): Promise<void> {
      seen.push(options.mcpServers?.map((s) => s.token).join(',') ?? '');
      this.complete(options.threadId, options.turnId, 'ok');
      return Promise.resolve();
    }
  }
  manager.register(new RecordingAdapter());
  const url = 'http://127.0.0.1:51234/mcp';
  manager.setDesktopMcpServer(
    { name: 'uxnan-browser', url, token: 'installed' },
    'desktop-aaaaaaaaaaaa',
  );
  manager.setDesktopMcpServer({ name: 'uxnan-browser', url, token: 'dev' }, 'desktop-bbbbbbbbbbbb');

  const turn = async (desktopClient?: string): Promise<void> => {
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const before = seen.length;
    await manager.sendTurn(thread.id, 'hi', desktopClient ? { desktopClient } : {});
    await waitFor(() => seen.length > before);
  };
  await turn('desktop-bbbbbbbbbbbb'); // a chat in the development build
  await turn(); // a phone's turn
  manager.clearDesktopMcpServer('desktop-aaaaaaaaaaaa');
  await turn(); // the installed app went away
  manager.clearDesktopMcpServer('desktop-bbbbbbbbbbbb');
  await turn();
  assert.deepEqual(seen, ['bridge,dev', 'bridge,installed', 'bridge,dev', 'bridge']);
  await rmrf(baseDir);
});

baseTest('stopAll stops every adapter, including one that never ran a turn', async () => {
  // Listing models or commands, or naming a thread, starts a CLI too; left
  // alive, it keeps a stopping bridge from exiting.
  const baseDir = join(tmpdir(), `uxnan-am-stop-${randomUUID()}`);
  const manager = new AgentManager({
    store: new ThreadStore(new DaemonState(baseDir)),
    notify: () => undefined,
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  let stopped = 0;
  class Idle extends ControlledAdapter {
    override stop(): Promise<void> {
      stopped += 1;
      return Promise.resolve();
    }
  }
  manager.register(new Idle());
  await manager.stopAll();
  assert.equal(stopped, 1);
  await rmrf(baseDir);
});

test('a turn runs at the default a model advertises when nobody picked one', async () => {
  class ModelledAdapter extends ControlledAdapter {
    readonly sent: SendTurnOptions[] = [];
    override sendTurn(options: SendTurnOptions): Promise<void> {
      this.sent.push(options);
      return super.sendTurn(options);
    }
    listModels(): Promise<AgentModel[]> {
      const reasoning = {
        key: 'reasoning',
        kind: 'enum' as const,
        label: 'Reasoning effort',
        values: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ],
        default: 'high',
      };
      return Promise.resolve([
        { id: 'deep', displayName: 'Deep', isDefault: true, options: [reasoning] },
        { id: 'plain', displayName: 'Plain', options: [{ ...reasoning, default: undefined }] },
      ]);
    }
  }
  const baseDir = join(tmpdir(), `uxnan-am-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new ModelledAdapter();
  manager.register(adapter);
  try {
    const run = async (options: Parameters<AgentManager['sendTurn']>[2]) => {
      const thread = await store.startThread({ projectId: 'p' }, 1);
      const { turnId } = await manager.sendTurn(thread.id, 'go', options);
      adapter.complete(thread.id, turnId, 'done');
      return adapter.sent.at(-1)?.options;
    };
    // The thread's default model, untouched: its advertised default is sent.
    assert.deepEqual(await run({}), { reasoning: 'high' });
    // A pick wins, and so does the legacy flat `effort`.
    assert.deepEqual(await run({ options: { reasoning: 'low' } }), { reasoning: 'low' });
    assert.equal(await run({ effort: 'low' }), undefined);
    // A model that names no default runs at the agent's own.
    assert.equal(await run({ service: 'plain' }), undefined);
  } finally {
    await rmrf(baseDir);
  }
});

// The session list asks every available agent at once, each bounded: a CLI
// that fails lists nothing, one that cannot list is named, the dev agent and
// unavailable ones are left out.
baseTest(
  'listing sessions asks each available agent, and one failing never holds the rest',
  async () => {
    class Lister extends ControlledAdapter {
      constructor(
        override readonly agentId: AgentId,
        readonly answer: () => Promise<NativeSessionInfo[]>,
      ) {
        super();
      }
      listNativeSessions(): Promise<NativeSessionInfo[]> {
        return this.answer();
      }
    }
    class NoList extends ControlledAdapter {
      override readonly agentId: AgentId = 'antigravity-cli';
    }
    const manager = new AgentManager({
      store: new ThreadStore(new DaemonState(join(tmpdir(), `uxnan-am-list-${randomUUID()}`))),
      notify: () => {},
      now: () => 1000,
      logger: createLogger('test', 'error'),
      defaultAgent: 'echo',
    });
    const one: NativeSessionInfo = { sessionId: 's', cwd: '/p', updatedAt: 1, interactive: true };
    manager.register(new Lister('claude-code', () => Promise.resolve([one])));
    manager.register(new Lister('codex', () => Promise.reject(new Error('app-server down'))));
    manager.register(new Lister('pi-agent', () => Promise.resolve([one])), { available: false });
    manager.register(new NoList());
    manager.register(new Lister('echo', () => Promise.resolve([one])));

    const { lists, unlisted } = await manager.listAgentSessions('/p');
    assert.deepEqual(
      lists.map((l) => [l.agentId, l.sessions.length]),
      [
        ['claude-code', 1],
        ['codex', 0],
      ],
    );
    assert.deepEqual(unlisted, ['antigravity-cli']);
    const only = await manager.listAgentSessions('/p', 'codex');
    assert.deepEqual(
      only.lists.map((l) => l.agentId),
      ['codex'],
    );
    assert.deepEqual(only.unlisted, []);
  },
);

// A terminal taking a conversation's session: the bridge lets go of the
// process it keeps for it, but never under a running turn.
baseTest('releasing a conversation’s process waits for no turn and cancels none', async () => {
  class Resident extends ControlledAdapter {
    readonly closed: string[] = [];
    closeSession(threadId: string): Promise<void> {
      this.closed.push(threadId);
      return Promise.resolve();
    }
  }
  const baseDir = join(tmpdir(), `uxnan-am-release-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const manager = new AgentManager({
    store,
    notify: () => {},
    now: () => 1000,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const adapter = new Resident();
  manager.register(adapter);
  const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'working');
  await manager.releaseThreadProcess(thread.id);
  assert.deepEqual(adapter.closed, []);
  adapter.complete(thread.id, turnId, 'done');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  await manager.releaseThreadProcess(thread.id);
  assert.deepEqual(adapter.closed, [thread.id]);
  await rmrf(baseDir);
});

test('modelFor finds a model by id, else the alias that runs it', () => {
  const models = [
    { id: 'opus', displayName: 'Opus 5.5', version: 'claude-opus-5-5' },
    { id: 'claude-opus-4-8', displayName: 'Opus 4.8', isLegacy: true },
  ];
  assert.equal(modelFor(models, 'claude-opus-4-8')?.displayName, 'Opus 4.8');
  // A thread pinned to the concrete model an alias runs gets that alias's knobs.
  assert.equal(modelFor(models, 'claude-opus-5-5')?.id, 'opus');
  assert.equal(modelFor(models, 'claude-sonnet-5'), undefined);
});
