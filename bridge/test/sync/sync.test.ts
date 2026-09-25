import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonState, ThreadStore } from '../../src/index.js';
import { MAX_TOMBSTONES, SyncLedger } from '../../src/sync/sync-ledger.js';
import type { ThreadChange } from '../../src/conversation/thread-store.js';

// Replica sync (architecture/02a §5.8.17): one persisted revision counter, the
// store as the single source of change announcements, and turns ordered by a
// position the bridge hands out once.

async function withState(run: (state: DaemonState) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-sync-'));
  try {
    await run(new DaemonState(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the revision counter survives a restart and never goes backwards', async () => {
  await withState(async (state) => {
    const first = await SyncLedger.load(state);
    first.next();
    first.next();
    await first.flush();
    const again = await SyncLedger.load(state);
    assert.equal(again.storeId, first.storeId);
    assert.equal(again.rev, 2);
    again.observe(10);
    assert.equal(again.next(), 11, 'a revision already on an entity is never reused');
    again.observe(3);
    assert.equal(again.rev, 11);
  });
});

test('deletions are remembered up to a bound; older asks must reset', () => {
  const ledger = SyncLedger.memory();
  for (let i = 0; i < MAX_TOMBSTONES + 5; i++) ledger.tombstone('thread', `t${i}`);
  assert.ok(ledger.horizon > 0);
  assert.equal(ledger.deletedSince('thread', ledger.horizon).length, MAX_TOMBSTONES);
  ledger.revive('thread', `t${MAX_TOMBSTONES + 4}`);
  assert.equal(ledger.deletedSince('thread', ledger.horizon).length, MAX_TOMBSTONES - 1);
  assert.equal(ledger.stamp('settings'), ledger.rev);
  assert.equal(ledger.mark('settings'), ledger.rev);
});

test('the store announces each summary change once, with its revision, after it is saved', async () => {
  await withState(async (state) => {
    const ledger = await SyncLedger.load(state);
    const store = new ThreadStore(state, undefined, ledger);
    const changes: ThreadChange[] = [];
    store.onChange((c) => changes.push(c));

    const thread = await store.startThread(
      { projectId: 'p', cwd: '/w', origin: { kind: 'desktop', name: 'Mac' } },
      1,
    );
    const started = changes.at(-1);
    assert.equal(started?.type, 'updated');
    assert.equal(started?.type === 'updated' && started.thread.rev, ledger.rev);
    assert.deepEqual(thread.origin, { kind: 'desktop', name: 'Mac' });

    // Streamed tokens are not summary changes.
    const { turnId } = await store.startTurn(thread.id, 'hello there', 2);
    const count = changes.length;
    await store.appendDelta(thread.id, turnId, 'hi', 3);
    await store.appendThinking(thread.id, turnId, 'hmm', 3);
    assert.equal(changes.length, count);
    await store.completeTurn(thread.id, turnId, 'hi', 4);
    assert.equal(changes.length, count + 1);

    // Nothing changed → nothing announced.
    await store.setAccessMode(thread.id, 'fullAccess', 5);
    const afterMode = changes.length;
    await store.setAccessMode(thread.id, 'fullAccess', 6);
    assert.equal(changes.length, afterMode);

    const before = ledger.rev;
    await store.deleteThread(thread.id);
    const deleted = changes.at(-1);
    assert.deepEqual(deleted, { type: 'deleted', threadId: thread.id, rev: before + 1 });
    assert.deepEqual(ledger.deletedSince('thread', before), [thread.id]);
    assert.deepEqual(await store.threadsChangedSince(before), []);
  });
});

test('turns carry a position that orders the conversation and is never reused', async () => {
  await withState(async (state) => {
    const store = new ThreadStore(state);
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const a = await store.startTurn(thread.id, 'one', 2);
    const b = await store.queueTurn(thread.id, 'two', 3);
    await store.cancelQueuedTurn(thread.id, b.turnId, 4);
    const c = await store.startTurn(thread.id, 'three', 5);
    const { turns } = await store.listTurns(thread.id);
    assert.deepEqual(
      turns.map((t) => [t.id, t.seq]),
      [
        [a.turnId, 1],
        [b.turnId, 2],
        [c.turnId, 3],
      ],
    );
    // A reload of the same files gives the same numbers.
    const reloaded = new ThreadStore(state);
    const again = await reloaded.listTurns(thread.id);
    assert.deepEqual(
      again.turns.map((t) => t.seq),
      [1, 2, 3],
    );
  });
});

test('the bridge names a conversation from its first message; weaker names never win', async () => {
  await withState(async (state) => {
    const store = new ThreadStore(state);
    const thread = await store.startThread({ projectId: 'p' }, 1);
    assert.equal(thread.title, 'New thread');
    await store.startTurn(thread.id, '  Fix   the login bug ', 2);
    let now = await store.getThread(thread.id);
    assert.equal(now.title, 'Fix the login bug');
    assert.equal(now.titleSource, 'prompt');

    // A second message does not rename it.
    await store.startTurn(thread.id, 'and the logout one', 3);
    assert.equal((await store.getThread(thread.id)).title, 'Fix the login bug');

    // The agent's title replaces the provisional one…
    assert.equal(await store.claimTitleGeneration(thread.id), true);
    await store.applyGeneratedTitle(thread.id, 'Login bug fix', 4);
    // …and a late provisional rename from a client that had not heard of it
    // cannot throw it away.
    await store.renameThread(thread.id, 'Fix the login bug', 5, 'prompt');
    now = await store.getThread(thread.id);
    assert.equal(now.title, 'Login bug fix');
    assert.equal(now.titleSource, 'agent');
    assert.equal(await store.claimTitleGeneration(thread.id), false, 'final names are not redone');

    // A name given at creation is the user's.
    const named = await store.startThread({ projectId: 'p', title: 'Mine' }, 6);
    assert.equal(named.titleSource, 'user');
    await store.startTurn(named.id, 'something else', 7);
    assert.equal((await store.getThread(named.id)).title, 'Mine');
  });
});

test('title generation is retried on a later turn, but not forever', async () => {
  await withState(async (state) => {
    const store = new ThreadStore(state);
    const thread = await store.startThread({ projectId: 'p' }, 1);
    await store.startTurn(thread.id, 'hello', 2);
    assert.equal(await store.claimTitleGeneration(thread.id), true);
    assert.equal(await store.claimTitleGeneration(thread.id), true);
    assert.equal(await store.claimTitleGeneration(thread.id), false);
  });
});

test('opening a conversation changes nothing about it — not even an archived one', async () => {
  await withState(async (state) => {
    const store = new ThreadStore(state);
    const changes: ThreadChange[] = [];
    store.onChange((c) => changes.push(c));
    const thread = await store.startThread({ projectId: 'p' }, 1);
    await store.archiveThread(thread.id, 2);
    const count = changes.length;
    await store.resumeThread(thread.id);
    const now = await store.getThread(thread.id);
    assert.equal(now.status, 'archived');
    assert.equal(now.updatedAt, 2);
    assert.equal(changes.length, count);
    await assert.rejects(store.resumeThread('nope'));
  });
});

test('threads are relinked to the project their folder belongs to', async () => {
  await withState(async (state) => {
    const store = new ThreadStore(state);
    const a = await store.startThread({ projectId: 'old', cwd: '/repo/wt' }, 1);
    const b = await store.startThread({ projectId: 'proj_x', cwd: '/other' }, 1);
    const moved = await store.relinkProjects(async (cwd) =>
      cwd === '/repo/wt' ? 'proj_repo' : 'proj_x',
    );
    assert.equal(moved, 1);
    assert.equal((await store.getThread(a.id)).projectId, 'proj_repo');
    assert.equal((await store.getThread(b.id)).projectId, 'proj_x');
    assert.deepEqual((await store.threadFolders()).sort(), ['/other', '/repo/wt']);
  });
});
