import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { DaemonState, MetricsStore } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

function newStore(): { store: MetricsStore; baseDir: string } {
  const baseDir = join(tmpdir(), `uxnan-metrics-store-${randomUUID()}`);
  return { store: new MetricsStore(new DaemonState(baseDir)), baseDir };
}

test('records and reads session + git-action events', async () => {
  const { store, baseDir } = newStore();
  try {
    const s = await store.startSession('phone-1', 'relay', 1000);
    await store.endSession(s, 4000);
    await store.recordGitAction('git/commit', 'thread-1', true, 2000);
    await store.recordGitAction('git/push', undefined, false, 3000);

    const events = await store.readEvents();
    assert.equal(events.sessions.length, 1);
    const [session] = events.sessions;
    assert.ok(session);
    assert.equal(session.transport, 'relay');
    assert.equal(session.startedAt, 1000);
    assert.equal(session.endedAt, 4000);
    assert.equal(events.gitActions.length, 2);
    const [commit, push] = events.gitActions;
    assert.ok(commit && push);
    assert.equal(commit.method, 'git/commit');
    assert.equal(commit.threadId, 'thread-1');
    assert.equal(push.succeeded, false);
    assert.equal(push.threadId, undefined);
  } finally {
    await rmrf(baseDir);
  }
});

test('closeDanglingSessions closes open rows at their start time', async () => {
  const { store, baseDir } = newStore();
  try {
    const open = await store.startSession('phone-1', 'direct', 1000);
    const closed = await store.startSession('phone-2', 'relay', 2000);
    await store.endSession(closed, 5000);

    await store.closeDanglingSessions();

    const events = await store.readEvents();
    const openRow = events.sessions.find((s) => s.id === open);
    const closedRow = events.sessions.find((s) => s.id === closed);
    // A crashed/dangling session is closed at its own start time (0 duration) so
    // it never inflates the connected-time metric.
    assert.equal(openRow?.endedAt, 1000);
    // A cleanly-closed session keeps its real teardown time.
    assert.equal(closedRow?.endedAt, 5000);
  } finally {
    await rmrf(baseDir);
  }
});

test('mergeEvents is idempotent — a union by id', async () => {
  const { store, baseDir } = newStore();
  try {
    const s = await store.startSession('phone', 'relay', 1000);
    await store.endSession(s, 2000);
    await store.recordGitAction('git/commit', 't', true, 1500);

    const existing = await store.readEvents();
    // Re-merging the exact same events adds nothing.
    assert.equal(await store.mergeEvents(existing), 0);

    const dupSession = existing.sessions[0];
    assert.ok(dupSession);
    // Merging one genuinely new session + git action of each adds two rows.
    const added = await store.mergeEvents({
      conversations: [],
      turns: [],
      sessions: [
        { id: 'imported-s', deviceId: 'phone', transport: 'direct', startedAt: 10, endedAt: 20 },
        // duplicate of an existing id — must be ignored
        dupSession,
      ],
      gitActions: [{ id: 'imported-g', method: 'git/push', succeeded: true, at: 30 }],
    });
    assert.equal(added, 2);

    const after = await store.readEvents();
    assert.equal(after.sessions.length, 2);
    assert.equal(after.gitActions.length, 2);
  } finally {
    await rmrf(baseDir);
  }
});

test('conversation and turn rows advance only to newer projections', async () => {
  const { store, baseDir } = newStore();
  try {
    const conversation = {
      id: 'thread-1',
      agentId: 'codex',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const turn = {
      id: 'thread-1:turn-1',
      threadId: 'thread-1',
      agentId: 'codex',
      messageDays: [{ day: 0, messages: 2 }],
      tokens: 0,
      tokenDay: 0,
      updatedAt: 1000,
    };

    assert.equal(await store.mergeConversationHistory([conversation], [turn]), 2);
    assert.equal(await store.mergeConversationHistory([conversation], [turn]), 0);
    assert.equal(
      await store.mergeConversationHistory([], [{ ...turn, tokens: 21 }]),
      1,
      'a later local projection can advance within the same clock millisecond',
    );
    assert.equal(
      await store.mergeConversationHistory([], [{ ...turn, tokens: 42, updatedAt: 2000 }]),
      1,
    );
    assert.equal(
      await store.mergeConversationHistory([], [{ ...turn, tokens: 1, updatedAt: 1500 }]),
      0,
    );

    const events = await store.readEvents();
    assert.equal(events.turns[0]?.tokens, 42);
  } finally {
    await rmrf(baseDir);
  }
});

test('recovers from a corrupt primary ledger using a rotating backup', async () => {
  const baseDir = join(tmpdir(), `uxnan-metrics-store-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  const store = new MetricsStore(state);
  try {
    await store.recordGitAction('git/commit', 'thread-1', true, 1000);
    await store.recordGitAction('git/push', 'thread-1', true, 2000);
    await writeFile(state.pathFor('metrics.json'), '{not-json', 'utf8');

    const recovered = await new MetricsStore(state).readEvents();
    assert.equal(recovered.gitActions.length, 1);
    assert.equal(recovered.gitActions[0]?.method, 'git/commit');
  } finally {
    await rmrf(baseDir);
  }
});
