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

test('segments preserve the interleaved text↔block order for re-sync', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  // The agent narrates, runs a command, then narrates again.
  await store.appendDelta(thread.id, turnId, 'Let me check.', 3);
  await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'ls' }, 4);
  await store.appendDelta(thread.id, turnId, 'Done — all good.', 5);
  // turn/completed carries the same concatenated text it streamed.
  await store.completeTurn(thread.id, turnId, 'Let me check.Done — all good.', 6);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  // `content` stays the full merged text; `blocks` the structured blocks…
  assert.equal(assistant?.content, 'Let me check.Done — all good.');
  assert.deepEqual(assistant?.blocks, [{ type: 'command_execution', command: 'ls' }]);
  // …and `segments` carries the real production order (text, block, text) so the
  // phone can render the work log inline instead of stacking it above the prose.
  assert.deepEqual(assistant?.segments, [
    { type: 'text', text: 'Let me check.' },
    { type: 'command_execution', command: 'ls' },
    { type: 'text', text: 'Done — all good.' },
  ]);
  await rm(baseDir, { recursive: true, force: true });
});

test('a plain-text turn ships no segments (lean wire shape)', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);
  await store.appendDelta(thread.id, turnId, 'Just words.', 3);
  await store.completeTurn(thread.id, turnId, undefined, 4);

  const assistant = (await store.getTurn(turnId)).messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.content, 'Just words.');
  // No structured block landed → no `segments` (rendering from `content` alone
  // is already correct), keeping the wire shape unchanged for text-only turns.
  assert.equal(assistant?.segments, undefined);
  await rm(baseDir, { recursive: true, force: true });
});

test('completeTurn with no streamed deltas appends the final text after blocks', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  // A tool ran but the agent streamed no text before the closing reply.
  await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'pwd' }, 3);
  await store.completeTurn(thread.id, turnId, 'Here is the answer.', 4);

  const assistant = (await store.getTurn(turnId)).messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.segments, [
    { type: 'command_execution', command: 'pwd' },
    { type: 'text', text: 'Here is the answer.' },
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
  // The total is reported on every page so a client can page from the end.
  assert.equal(page1.total, 3);
  const page2 = await store.listTurns(thread.id, page1.nextCursor, 2);
  assert.equal(page2.turns.length, 1);
  assert.equal(page2.nextCursor, undefined);
  assert.equal(page2.total, 3);
  await rm(baseDir, { recursive: true, force: true });
});

test('listTurns fromEnd returns the newest page', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  for (let i = 0; i < 5; i += 1) {
    await store.startTurn(thread.id, `q${i}`, 10 + i);
  }
  // fromEnd ignores the cursor and returns the last `limit` turns (newest).
  const last = await store.listTurns(thread.id, undefined, 2, true);
  assert.equal(last.turns.length, 2);
  assert.equal(last.total, 5);
  // Newest page → no forward nextCursor (already at the end).
  assert.equal(last.nextCursor, undefined);
  // It's the last 2 turns (q3, q4), not the first.
  assert.deepEqual(
    last.turns.map((t) => t.messages[0]?.content),
    ['q3', 'q4'],
  );
  // The page just before it (older) is reachable via an explicit cursor.
  const older = await store.listTurns(thread.id, '1', 2);
  assert.deepEqual(
    older.turns.map((t) => t.messages[0]?.content),
    ['q1', 'q2'],
  );
  await rm(baseDir, { recursive: true, force: true });
});

test('setAccessMode persists the mode, is idempotent, and surfaces it', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  // Unset by default.
  assert.equal((await store.getThread(thread.id)).accessMode, undefined);

  const updated = await store.setAccessMode(thread.id, 'requestApproval', 2);
  assert.equal(updated.accessMode, 'requestApproval');
  assert.equal(updated.updatedAt, 2);
  // Surfaced on a fresh read (thread/read path).
  assert.equal((await store.getThread(thread.id)).accessMode, 'requestApproval');

  // Idempotent: setting the same mode does not bump updatedAt.
  const before = (await store.getThread(thread.id)).updatedAt;
  await store.setAccessMode(thread.id, 'requestApproval', 999);
  assert.equal((await store.getThread(thread.id)).updatedAt, before);

  // Changing it bumps updatedAt again.
  const changed = await store.setAccessMode(thread.id, 'fullAccess', 3);
  assert.equal(changed.accessMode, 'fullAccess');
  assert.equal(changed.updatedAt, 3);
  // The runtime the AgentManager reads per turn carries the mode (enforcement).
  assert.equal((await store.getThreadRuntime(thread.id)).accessMode, 'fullAccess');
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

test('delete preserves mutable history if its final metrics projection fails', async () => {
  const baseDir = join(tmpdir(), `uxnan-ts-${randomUUID()}`);
  let rejectWrites = false;
  const store = new ThreadStore(new DaemonState(baseDir), {
    mergeConversationHistory: async () => {
      if (rejectWrites) throw new Error('ledger unavailable');
      return 0;
    },
  });
  const thread = await store.startThread({ projectId: 'p' }, 1);
  rejectWrites = true;

  await assert.rejects(store.deleteThread(thread.id), /ledger unavailable/);
  assert.equal((await store.getThread(thread.id)).id, thread.id);
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
  // It is also surfaced on the wire Thread (thread/read) so the phone can show
  // "resume from the CLI".
  assert.equal((await store.getThread(thread.id)).agentSessionId, 'sess-abc');

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

test('appendBlock beforeText slots the block before the open text run', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  // main text mid-run when a parallel (subagent) block lands
  await store.appendDelta(thread.id, turnId, 'y si re', 3);
  await store.appendBlock(thread.id, turnId, { type: 'tool', name: 'Read' }, 4, true);
  await store.appendDelta(thread.id, turnId, 'porta tokens', 5);
  // a sequential block (text run closed) keeps plain arrival order
  await store.appendBlock(thread.id, turnId, { type: 'tool', name: 'Bash' }, 6);
  await store.completeTurn(thread.id, turnId, undefined, 7);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  // the run was never severed: block first, then one whole text run, then the
  // sequential block after it
  assert.deepEqual(assistant?.segments, [
    { type: 'tool', name: 'Read' },
    { type: 'text', text: 'y si reporta tokens' },
    { type: 'tool', name: 'Bash' },
  ]);
  assert.equal(assistant?.content, 'y si reporta tokens');
  // `blocks` keeps plain arrival order regardless
  assert.deepEqual(assistant?.blocks, [
    { type: 'tool', name: 'Read' },
    { type: 'tool', name: 'Bash' },
  ]);
  await rm(baseDir, { recursive: true, force: true });
});

test('appendBlock beforeText with no open text run appends normally', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendBlock(thread.id, turnId, { type: 'tool', name: 'Read' }, 3, true);
  await store.appendDelta(thread.id, turnId, 'after', 4);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.segments, [
    { type: 'tool', name: 'Read' },
    { type: 'text', text: 'after' },
  ]);
  await rm(baseDir, { recursive: true, force: true });
});

test('completeTurn extends the trailing run when the final text has an unstreamed tail', async () => {
  const { store, baseDir } = newStore();
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await store.startTurn(thread.id, 'ask', 2);

  await store.appendDelta(thread.id, turnId, 'first ', 3);
  await store.appendBlock(thread.id, turnId, { type: 'tool', name: 'Bash' }, 4);
  await store.appendDelta(thread.id, turnId, 'second', 5);
  // the completion text carries a tail the deltas never streamed: the
  // interleave must survive, with the tail folded onto the trailing run
  await store.completeTurn(thread.id, turnId, 'first second and tail', 6);

  const turn = await store.getTurn(turnId);
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(assistant?.segments, [
    { type: 'text', text: 'first ' },
    { type: 'tool', name: 'Bash' },
    { type: 'text', text: 'second and tail' },
  ]);
  assert.equal(assistant?.content, 'first second and tail');
  await rm(baseDir, { recursive: true, force: true });
});
