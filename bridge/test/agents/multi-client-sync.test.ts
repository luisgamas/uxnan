/**
 * Multi-client convergence (architecture/02a §5.8.16): every client connected
 * to the bridge — phones and the desktop — must be told about threads, turns
 * and elicitations another client created or answered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentCapabilities,
  AgentId,
  ApprovalResolvedParams,
  QuestionResolvedParams,
  SendTurnOptions,
  Thread,
  ThreadDeletedParams,
  ThreadUpdatedParams,
  TurnCreatedParams,
} from '@uxnan/shared';
import { StreamNotification, makeRequest } from '@uxnan/shared';
import {
  AgentManager,
  BaseAgentAdapter,
  DaemonState,
  InMemorySecretStore,
  ThreadStore,
  createLogger,
  startBridge,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

interface Note {
  method: string;
  params: unknown;
}

const CAPS: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: true,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/** In-process agent: opens a turn and leaves it running until told otherwise. */
class HeldAdapter extends BaseAgentAdapter {
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
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
}

async function managerHarness(approvalTimeoutMs?: number): Promise<{
  manager: AgentManager;
  store: ThreadStore;
  notes: Note[];
  baseDir: string;
}> {
  const baseDir = join(tmpdir(), `uxnan-sync-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notes: Note[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => notes.push(message as Note),
    now: () => 1,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
    ...(approvalTimeoutMs !== undefined ? { approvalTimeoutMs } : {}),
  });
  manager.register(new HeldAdapter());
  return { manager, store, notes, baseDir };
}

const of = <T>(notes: Note[], method: string): T[] =>
  notes.filter((n) => n.method === method).map((n) => n.params as T);

test('turn/created carries the user message and the sender echo id, before the turn starts', async () => {
  const { manager, store, notes, baseDir } = await managerHarness();
  try {
    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    const { turnId } = await manager.sendTurn(thread.id, 'hello from the desktop', {
      clientTurnId: 'bubble-1',
    });
    const created = of<TurnCreatedParams>(notes, StreamNotification.TurnCreated);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.threadId, thread.id);
    assert.equal(created[0]?.turn.id, turnId);
    assert.equal(created[0]?.clientTurnId, 'bubble-1');
    const user = created[0]?.turn.messages.find((m) => m.role === 'user');
    assert.equal(user?.content, 'hello from the desktop');
    // Announced before the agent starts answering it.
    const order = notes.map((n) => n.method);
    assert.ok(
      order.indexOf(StreamNotification.TurnCreated) < order.indexOf(StreamNotification.TurnStarted),
    );
  } finally {
    await rmrf(baseDir);
  }
});

test('a queued follow-up is announced as a queued turn, without an echo id when none was sent', async () => {
  const { manager, store, notes, baseDir } = await managerHarness();
  try {
    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    await manager.sendTurn(thread.id, 'first');
    const second = await manager.sendTurn(thread.id, 'second, typed on the phone');
    assert.equal(second.queued, true);
    const created = of<TurnCreatedParams>(notes, StreamNotification.TurnCreated);
    assert.equal(created.length, 2);
    assert.equal(created[1]?.turn.status, 'queued');
    assert.equal(created[1]?.clientTurnId, undefined);
  } finally {
    await rmrf(baseDir);
  }
});

test('an answered approval is announced so every other client retires its card', async () => {
  const { manager, store, notes, baseDir } = await managerHarness();
  try {
    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    await manager.sendTurn(thread.id, 'go');
    const decision = manager.requestApproval(thread.id, {
      toolName: 'Bash',
      input: { command: 'ls' },
    });
    await waitFor(() => of(notes, StreamNotification.ContentBlock).length > 0);
    const block = of<{ content: { approvalId: string } }>(
      notes,
      StreamNotification.ContentBlock,
    )[0];
    const approvalId = block?.content.approvalId ?? '';
    await manager.respondApproval(thread.id, approvalId, 'approveSession');
    assert.equal(await decision, 'approveSession');
    assert.deepEqual(of<ApprovalResolvedParams>(notes, StreamNotification.ApprovalResolved), [
      { threadId: thread.id, approvalId, decision: 'approveSession' },
    ]);
  } finally {
    await rmrf(baseDir);
  }
});

test('an approval that times out is announced as a timed-out reject', async () => {
  const { manager, store, notes, baseDir } = await managerHarness(40);
  try {
    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    await manager.sendTurn(thread.id, 'go');
    assert.equal(
      await manager.requestApproval(thread.id, { toolName: 'Bash', input: {} }),
      'reject',
    );
    const resolved = of<ApprovalResolvedParams>(notes, StreamNotification.ApprovalResolved);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.decision, 'reject');
    assert.equal(resolved[0]?.timedOut, true);
  } finally {
    await rmrf(baseDir);
  }
});

test('answered, skipped and timed-out questions are announced', async () => {
  const { manager, store, notes, baseDir } = await managerHarness(40);
  try {
    const thread = await store.startThread({ projectId: 'p', agentId: 'echo' }, 1);
    await manager.sendTurn(thread.id, 'go');
    const questions = [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }];

    const answered = manager.requestQuestion(thread.id, questions);
    await waitFor(() => of(notes, StreamNotification.ContentBlock).length === 1);
    const first = of<{ content: { questionId: string } }>(
      notes,
      StreamNotification.ContentBlock,
    )[0];
    await manager.respondQuestion(thread.id, first?.content.questionId ?? '', [['B']]);
    assert.deepEqual(await answered, [['B']]);

    const skipped = manager.requestQuestion(thread.id, questions);
    await waitFor(() => of(notes, StreamNotification.ContentBlock).length === 2);
    const second = of<{ content: { questionId: string } }>(
      notes,
      StreamNotification.ContentBlock,
    )[1];
    await manager.respondQuestion(thread.id, second?.content.questionId ?? '', [[]]);
    await skipped;

    await manager.requestQuestion(thread.id, questions); // times out

    const resolved = of<QuestionResolvedParams>(notes, StreamNotification.QuestionResolved);
    assert.deepEqual(
      resolved.map((r) => [r.skipped, r.timedOut === true]),
      [
        [false, false],
        [true, false],
        [true, true],
      ],
    );
  } finally {
    await rmrf(baseDir);
  }
});

test('thread handlers announce every change to every client, and deletion too', async () => {
  const baseDir = join(tmpdir(), `uxnan-sync-h-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const notes: Note[] = [];
  bridge.context.sessionRegistry.register('local:test', {
    send: (message) => notes.push(message as Note),
  });
  const call = async (method: string, params: unknown): Promise<unknown> => {
    const res = await bridge.router.dispatch(makeRequest(randomUUID(), method as never, params));
    assert.ok('result' in res, JSON.stringify(res));
    return res.result;
  };
  try {
    const [project] = (await call('project/list', undefined)) as { id: string }[];
    const thread = (await call('thread/start', {
      projectId: project?.id,
      agentId: 'echo',
    })) as Thread;
    await call('thread/rename', { threadId: thread.id, title: 'Named on the desktop' });
    await call('thread/setModel', { threadId: thread.id, model: 'echo-large' });
    await call('thread/setAccessMode', { threadId: thread.id, mode: 'requestApproval' });
    await call('thread/archive', { threadId: thread.id });
    await call('thread/unarchive', { threadId: thread.id });
    const fork = (await call('thread/fork', { threadId: thread.id })) as Thread;
    await call('thread/delete', { threadId: fork.id });

    const updates = of<ThreadUpdatedParams>(notes, StreamNotification.ThreadUpdated);
    assert.deepEqual(
      updates.map((u) => u.thread.id),
      [thread.id, thread.id, thread.id, thread.id, thread.id, thread.id, fork.id],
    );
    assert.equal(updates[1]?.thread.title, 'Named on the desktop');
    assert.equal(updates[1]?.thread.titleSource, 'user');
    assert.equal(updates[2]?.thread.model, 'echo-large');
    assert.equal(updates[3]?.thread.accessMode, 'requestApproval');
    assert.equal(updates[4]?.thread.status, 'archived');
    assert.equal(updates[5]?.thread.status, 'active');
    assert.deepEqual(of<ThreadDeletedParams>(notes, StreamNotification.ThreadDeleted), [
      { threadId: fork.id },
    ]);
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('turn/send passes a sane clientTurnId through and drops an oversized one', async () => {
  const baseDir = join(tmpdir(), `uxnan-sync-c-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  bridge.context.agentManager.register(new HeldAdapter());
  const notes: Note[] = [];
  bridge.context.sessionRegistry.register('local:test', {
    send: (message) => notes.push(message as Note),
  });
  try {
    const [project] = (
      (await bridge.router.dispatch(makeRequest('p', 'project/list'))) as {
        result: { id: string }[];
      }
    ).result;
    const thread = (
      (await bridge.router.dispatch(
        makeRequest('s', 'thread/start', { projectId: project?.id ?? '', agentId: 'echo' }),
      )) as { result: Thread }
    ).result;
    await bridge.router.dispatch(
      makeRequest('t1', 'turn/send', { threadId: thread.id, text: 'one', clientTurnId: 'b-1' }),
    );
    await bridge.router.dispatch(
      makeRequest('t2', 'turn/send', {
        threadId: thread.id,
        text: 'two',
        clientTurnId: 'x'.repeat(200),
      }),
    );
    const created = of<TurnCreatedParams>(notes, StreamNotification.TurnCreated);
    assert.deepEqual(
      created.map((c) => c.clientTurnId),
      ['b-1', undefined],
    );
    // One thread has a turn in flight (the second one is queued behind it):
    // `bridge/status` says so, for a client waiting for a quiet moment.
    const status = (await bridge.router.dispatch(makeRequest('st', 'bridge/status'))) as {
      result: { activeTurns?: number };
    };
    assert.equal(status.result.activeTurns, 1);
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});
