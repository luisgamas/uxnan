import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { RpcError } from '@uxnan/shared';
import { DaemonState, ThreadStore } from '../../src/index.js';

function newStore(): { store: ThreadStore; baseDir: string } {
  const baseDir = join(tmpdir(), `uxnan-ts-${randomUUID()}`);
  return { store: new ThreadStore(new DaemonState(baseDir)), baseDir };
}

test('start/list/read threads', async () => {
  const { store, baseDir } = newStore();
  const created = await store.startThread({ projectId: 'proj-1', title: 'Hello' }, 1000);
  assert.equal(created.projectId, 'proj-1');
  assert.equal(created.turnCount, 0);

  const list = await store.listThreads('proj-1');
  assert.equal(list.threads.length, 1);
  assert.equal((await store.listThreads('other')).threads.length, 0);

  const read = await store.getThread(created.id);
  assert.equal(read.id, created.id);
  await rm(baseDir, { recursive: true, force: true });
});

test('turn lifecycle: start, delta, complete', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendDelta(thread.id, turnId, 'ans', 3);
  await store.appendDelta(thread.id, turnId, 'wer', 4);
  await store.completeTurn(thread.id, turnId, undefined, 5);

  const turn = await store.getTurn(turnId);
  assert.equal(turn.status, 'completed');
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.content, 'answer');
  const user = turn.messages.find((m) => m.role === 'user');
  assert.equal(user?.content, 'ask');
  await rm(baseDir, { recursive: true, force: true });
});

test('appendThinking accumulates reasoning and surfaces it on the message', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendThinking(thread.id, turnId, 'Let me ', 3);
  await store.appendThinking(thread.id, turnId, 'think.', 4);
  await store.appendDelta(thread.id, turnId, 'Answer', 5);
  await store.completeTurn(thread.id, turnId, undefined, 6);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.content, 'Answer');
  assert.equal(assistant?.thinking, 'Let me think.');
  await rm(baseDir, { recursive: true, force: true });
});

test('setUsage records token usage on the assistant message (context meter)', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendDelta(thread.id, turnId, 'answer', 3);
  await store.setUsage(thread.id, turnId, { tokens: 1234, contextWindow: 1_000_000 }, 4);
  await store.completeTurn(thread.id, turnId, undefined, 5);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.usage, { tokens: 1234, contextWindow: 1_000_000 });
  await rm(baseDir, { recursive: true, force: true });
});

test('appendBlock accumulates structured blocks and surfaces them on the message', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'ls' }, 3);
  await store.appendBlock(thread.id, turnId, { type: 'diff', filename: 'a.dart' }, 4);
  await store.completeTurn(thread.id, turnId, undefined, 5);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.blocks, [
    { type: 'command_execution', command: 'ls' },
    { type: 'diff', filename: 'a.dart' },
  ]);
  await rm(baseDir, { recursive: true, force: true });
});

test('listTurns paginates with a cursor', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  for (let i = 0; i < 3; i += 1) {
    await store.startTurn(thread.id, `q${i}`, 10 + i);
  }
  const page1 = await store.listTurns(thread.id, undefined, 2);
  assert.equal(page1.turns.length, 2);
  assert.equal(page1.nextCursor, '2');
  const page2 = await store.listTurns(thread.id, page1.nextCursor, 2);
  assert.equal(page2.turns.length, 1);
  assert.equal(page2.nextCursor, undefined);
  await rm(baseDir, { recursive: true, force: true });
});

test('rename/archive/unarchive update the thread; delete removes it', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p', title: 'Orig' }, 1);

  const renamed = await store.renameThread(thread.id, 'Renamed', 2);
  assert.equal(renamed.title, 'Renamed');
  assert.equal(renamed.updatedAt, 2);

  const archived = await store.archiveThread(thread.id, 3);
  assert.equal(archived.status, 'archived');
  const restored = await store.unarchiveThread(thread.id, 4);
  assert.equal(restored.status, 'active');

  await store.deleteThread(thread.id);
  assert.equal((await store.listThreads('p')).threads.length, 0);
  await rm(baseDir, { recursive: true, force: true });
});

test('rename/archive/unarchive/delete reject unknown ids', async () => {
  const { store, baseDir } = newStore();
  await assert.rejects(store.renameThread('nope', 'x', 1), RpcError);
  await assert.rejects(store.archiveThread('nope', 1), RpcError);
  await assert.rejects(store.unarchiveThread('nope', 1), RpcError);
  await assert.rejects(store.deleteThread('nope'), RpcError);
  await rm(baseDir, { recursive: true, force: true });
});

test('agent session id: persisted, idempotent, surfaced via getHistorySource', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread(
    { projectId: 'p', agentId: 'claude-code', cwd: 'C:/x' },
    1,
  );

  // Unset initially.
  let src = await store.getHistorySource(thread.id);
  assert.equal(src.agentId, 'claude-code');
  assert.equal(src.cwd, 'C:/x');
  assert.equal(src.agentSessionId, undefined);

  await store.setAgentSession(thread.id, 'sess-abc', 2);
  src = await store.getHistorySource(thread.id);
  assert.equal(src.agentSessionId, 'sess-abc');

  // Idempotent: setting the same id is a no-op (does not bump updatedAt).
  const before = (await store.getThread(thread.id)).updatedAt;
  await store.setAgentSession(thread.id, 'sess-abc', 999);
  assert.equal((await store.getThread(thread.id)).updatedAt, before);

  // Unknown thread is a silent no-op (no throw).
  await store.setAgentSession('nope', 'x', 3);
  await rm(baseDir, { recursive: true, force: true });
});

test('fork copies a thread; unknown ids reject', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p', title: 'Orig' }, 1);
  await store.startTurn(thread.id, 'q', 2);
  const fork = await store.forkThread(thread.id, 3);
  assert.notEqual(fork.id, thread.id);
  assert.equal(fork.turnCount, 1);

  await assert.rejects(store.getThread('nope'), RpcError);
  await assert.rejects(store.getTurn('nope'), RpcError);
  await rm(baseDir, { recursive: true, force: true });
});
