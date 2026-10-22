/**
 * The conversation store's on-disk layout (plans/046, phase 1): a turn in
 * flight is journaled and folded into its file when it ends, a journal a crash
 * left is replayed on the next start, older layouts are converted once, and a
 * turn's messages are kept in memory within a byte budget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Turn } from '@uxnan/shared';
import { DaemonState, ThreadStore } from '../../src/index.js';
import { turnFileStem } from '../../src/daemon-state.js';
import { rmrf } from '../helpers/fs.js';

function tempDir(): string {
  return join(tmpdir(), `uxnan-layout-${randomUUID()}`);
}

const turnFile = (baseDir: string, threadId: string, turnId: string) =>
  join(baseDir, 'threads', threadId, 'turns', `${turnFileStem(turnId)}.json`);
const journalFile = (baseDir: string, threadId: string, turnId: string) =>
  join(baseDir, 'threads', threadId, 'turns', `${turnFileStem(turnId)}.journal`);

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

/** A DaemonState that counts the calls made to it, by method name. */
function countingState(baseDir: string): { state: DaemonState; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const target = new DaemonState(baseDir);
  const state = new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.set(String(property), (calls.get(String(property)) ?? 0) + 1);
        return (value as (...a: unknown[]) => unknown).apply(object, args);
      };
    },
  });
  return { state, calls };
}

test('a turn in flight is journaled, and its end folds the journal into its file', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const { turnId } = await store.startTurn(thread.id, 'ask', 2);
    await store.appendDelta(thread.id, turnId, 'Let me look.', 3);
    await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'ls' }, 4);
    await store.appendThinking(thread.id, turnId, 'hmm', 5);

    const journal = await readFile(journalFile(baseDir, thread.id, turnId), 'utf-8');
    assert.equal(journal.trim().split('\n').length, 3, 'one line per event');
    const before = (await readJson(turnFile(baseDir, thread.id, turnId)))['messages'] as {
      text: string;
    }[];
    assert.equal(before[1]?.text, '', 'the turn file is not rewritten while it streams');

    await store.completeTurn(thread.id, turnId, undefined, 6);
    assert.equal(existsSync(journalFile(baseDir, thread.id, turnId)), false);
    const after = await readJson(turnFile(baseDir, thread.id, turnId));
    assert.equal(after['events'], 3);
    const reply = (after['messages'] as { text: string; thinking?: string }[])[1];
    assert.equal(reply?.text, 'Let me look.');
    assert.equal(reply?.thinking, 'hmm');
    const index = await readJson(join(baseDir, 'threads', thread.id, 'thread.json'));
    assert.equal((index['turns'] as { status: string }[])[0]?.status, 'completed');
    assert.equal(index['updatedAt'], 6);
  } finally {
    await rmrf(baseDir);
  }
});

test('every way a turn ends folds its journal', async () => {
  const endings: Record<
    string,
    (store: ThreadStore, threadId: string, turnId: string) => Promise<unknown>
  > = {
    completed: (s, th, t) => s.completeTurn(th, t, undefined, 10),
    error: (s, th, t) => s.failTurn(th, t, 10),
    aborted: (s, th, t) => s.abortTurn(th, t, 10),
    cancelled: (s, th, t) => s.cancelQueuedTurn(th, t, 10),
    'handed off': async (s, th, t) => {
      const next = await s.queueTurn(th, 'next', 9);
      await s.handOffTurn(th, t, next.turnId, 10);
    },
  };
  for (const [name, end] of Object.entries(endings)) {
    const baseDir = tempDir();
    try {
      const store = new ThreadStore(new DaemonState(baseDir));
      const thread = await store.startThread({ projectId: 'p' }, 1);
      const { turnId } =
        name === 'cancelled'
          ? await store.queueTurn(thread.id, 'ask', 2)
          : await store.startTurn(thread.id, 'ask', 2);
      await store.appendDelta(thread.id, turnId, 'partial', 3);
      assert.equal(existsSync(journalFile(baseDir, thread.id, turnId)), true, name);
      await end(store, thread.id, turnId);
      assert.equal(existsSync(journalFile(baseDir, thread.id, turnId)), false, name);
      const reloaded = new ThreadStore(new DaemonState(baseDir));
      const turn = await reloaded.getTurn(turnId);
      assert.equal(turn.messages[1]?.content, 'partial', name);
    } finally {
      await rmrf(baseDir);
    }
  }
});

test('a crash mid-turn: the next start replays the journal, ignoring a cut last line', async () => {
  const baseDir = tempDir();
  try {
    const crashed = new ThreadStore(new DaemonState(baseDir));
    const thread = await crashed.startThread({ projectId: 'p' }, 1);
    const { turnId } = await crashed.startTurn(thread.id, 'ask', 2);
    await crashed.appendDelta(thread.id, turnId, 'Hello', 3);
    await crashed.appendBlock(
      thread.id,
      turnId,
      { type: 'command_execution', command: 'ls', status: 'running', blockId: 'c1' },
      4,
    );
    await crashed.appendDelta(thread.id, turnId, ' world', 5);
    // The process dies halfway through writing the next line.
    await appendFile(journalFile(baseDir, thread.id, turnId), '{"n":4,"op":"delta","te');

    const restarted = new ThreadStore(new DaemonState(baseDir));
    const turn = await restarted.getTurn(turnId);
    assert.equal(turn.status, 'streaming', 'a turn a restart cut short stays as it was');
    const reply = turn.messages.find((m) => m.role === 'assistant');
    assert.equal(reply?.content, 'Hello world');
    assert.deepEqual(
      (reply?.segments ?? []).map((s) => (s as { type: string }).type),
      ['text', 'command_execution', 'text'],
    );
    assert.equal((await restarted.getThread(thread.id)).updatedAt, 5);
    assert.equal(
      existsSync(journalFile(baseDir, thread.id, turnId)),
      false,
      'the journal is folded into the turn on that start',
    );
  } finally {
    await rmrf(baseDir);
  }
});

test('a replay never applies an event its turn file already folded in', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const { turnId } = await store.startTurn(thread.id, 'ask', 2);
    await store.appendDelta(thread.id, turnId, 'a', 3);
    await store.appendDelta(thread.id, turnId, 'b', 4);
    // A crash after the file folding the first event was written, before its
    // journal was removed: both hold event 1.
    const path = turnFile(baseDir, thread.id, turnId);
    const file = await readJson(path);
    const messages = file['messages'] as { role: string; text: string }[];
    messages[1]!.text = 'a';
    (messages[1] as Record<string, unknown>)['segments'] = [{ type: 'text', text: 'a' }];
    await writeFile(path, JSON.stringify({ events: 1, messages }), 'utf-8');

    const restarted = new ThreadStore(new DaemonState(baseDir));
    assert.equal((await restarted.getTurn(turnId)).messages[1]?.content, 'ab');
  } finally {
    await rmrf(baseDir);
  }
});

test('steps are stored once, and the wire still carries them as blocks', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const { turnId } = await store.startTurn(thread.id, 'ask', 2);
    const step = { type: 'command_execution', command: 'ls', output: 'a.txt' };
    await store.appendDelta(thread.id, turnId, 'Listing.', 3);
    await store.appendBlock(thread.id, turnId, step, 4);
    await store.completeTurn(thread.id, turnId, undefined, 5);

    const stored = (await readJson(turnFile(baseDir, thread.id, turnId)))['messages'] as Record<
      string,
      unknown
    >[];
    assert.equal('blocks' in stored[1]!, false, 'no second copy of the steps on disk');
    const reread = new ThreadStore(new DaemonState(baseDir));
    const reply = (await reread.getTurn(turnId)).messages[1];
    assert.deepEqual(reply?.blocks, [step]);
    assert.deepEqual(reply?.segments, [{ type: 'text', text: 'Listing.' }, step]);
  } finally {
    await rmrf(baseDir);
  }
});

test('an imported reply whose steps have no order keeps them, on disk and on the wire', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p', agentId: 'codex' }, 1);
    const step = { type: 'command_execution', command: 'pwd' };
    const native: Turn = {
      id: 's#t0',
      threadId: thread.id,
      status: 'completed',
      createdAt: 100,
      completedAt: 101,
      messages: [
        { id: 's#m0', turnId: 's#t0', role: 'user', content: 'where?', createdAt: 100 },
        {
          id: 's#m1',
          turnId: 's#t0',
          role: 'assistant',
          content: 'Here.',
          blocks: [step],
          createdAt: 101,
        },
      ],
    };
    await store.reconcileNativeHistory(thread.id, [native], 200);
    const reread = new ThreadStore(new DaemonState(baseDir));
    const reply = (await reread.getTurn('s#t0')).messages[1];
    assert.deepEqual(reply?.blocks, [step]);
    assert.equal(reply?.segments, undefined);
    assert.equal(existsSync(turnFile(baseDir, thread.id, 's#t0')), true, 'a safe file name');
  } finally {
    await rmrf(baseDir);
  }
});

/** A conversation as the previous layout stored it: `threads/<id>.json`. */
function v1Thread(id: string, title: string): Record<string, unknown> {
  const step = { type: 'command_execution', command: 'ls' };
  return {
    id,
    projectId: 'p',
    title,
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    turns: [
      {
        id: `${id}-t1`,
        threadId: id,
        status: 'completed',
        createdAt: 1,
        completedAt: 2,
        messages: [
          { id: 'u', turnId: `${id}-t1`, role: 'user', text: 'go', createdAt: 1 },
          {
            id: 'a',
            turnId: `${id}-t1`,
            role: 'assistant',
            text: 'Done.',
            blocks: [step],
            segments: [step, { type: 'text', text: 'Done.' }],
            createdAt: 2,
          },
        ],
      },
    ],
  };
}

test('a conversation of the previous layout is converted once and moved aside', async () => {
  const baseDir = tempDir();
  try {
    await mkdir(join(baseDir, 'threads'), { recursive: true });
    await writeFile(join(baseDir, 'threads', 'th.json'), JSON.stringify(v1Thread('th', 'Old')));

    const store = new ThreadStore(new DaemonState(baseDir));
    const turns = await store.listTurns('th');
    assert.equal(turns.turns[0]?.seq, 1, 'numbered on the way');
    assert.deepEqual(turns.turns[0]?.messages[1]?.blocks, [
      { type: 'command_execution', command: 'ls' },
    ]);
    assert.equal(existsSync(join(baseDir, 'threads', 'th.json')), false);
    assert.equal(existsSync(join(baseDir, 'threads.v1', 'th.json')), true, 'kept, out of the way');
    const stored = (await readJson(turnFile(baseDir, 'th', 'th-t1')))['messages'] as Record<
      string,
      unknown
    >[];
    assert.equal('blocks' in stored[1]!, false);
    const index = await readJson(join(baseDir, 'threads', 'th', 'thread.json'));
    const days = (index['turns'] as { messageDays: { messages: number }[] }[])[0]?.messageDays;
    assert.deepEqual(
      days?.map((d) => d.messages),
      [2],
      'metrics read it without the turn',
    );
  } finally {
    await rmrf(baseDir);
  }
});

test('an interrupted conversion is redone from the original; a finished one is only moved', async () => {
  const baseDir = tempDir();
  try {
    await mkdir(join(baseDir, 'threads', 'half', 'turns'), { recursive: true });
    await writeFile(
      join(baseDir, 'threads', 'half.json'),
      JSON.stringify(v1Thread('half', 'Half')),
    );
    // Died after a turn file, before the index that marks it done.
    await writeFile(turnFile(baseDir, 'half', 'half-t1'), '{"events":0,"messages":[]}');

    const done = new ThreadStore(new DaemonState(baseDir));
    await done.startThread({ projectId: 'p', title: 'Placeholder' }, 1);
    const finished = (await done.listThreads()).threads.find((t) => t.title === 'Placeholder')!;
    // Died after the index, before the original was moved: the new copy wins.
    await writeFile(
      join(baseDir, 'threads', `${finished.id}.json`),
      JSON.stringify(v1Thread(finished.id, 'Stale original')),
    );

    const store = new ThreadStore(new DaemonState(baseDir));
    const threads = (await store.listThreads()).threads;
    assert.equal(threads.find((t) => t.id === 'half')?.turnCount, 1);
    assert.equal((await store.getTurn('half-t1')).messages[1]?.content, 'Done.');
    assert.equal(threads.find((t) => t.id === finished.id)?.title, 'Placeholder');
    assert.deepEqual(
      (await readdir(join(baseDir, 'threads'))).filter((name) => name.endsWith('.json')),
      [],
    );
  } finally {
    await rmrf(baseDir);
  }
});

test('turn bodies stay within the cache budget, but never one being streamed into', async () => {
  const baseDir = tempDir();
  try {
    const seed = new ThreadStore(new DaemonState(baseDir));
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      const thread = await seed.startThread({ projectId: 'p', title: name }, 1);
      const { turnId } = await seed.startTurn(thread.id, 'ask', 2);
      await seed.appendDelta(thread.id, turnId, `answer ${name}`, 3);
      await seed.completeTurn(thread.id, turnId, undefined, 4);
      ids.push(thread.id);
    }
    const [a, b, c] = ids as [string, string, string];

    const { state, calls } = countingState(baseDir);
    const store = new ThreadStore(state, undefined, undefined, { bodyCacheBytes: 1 });
    const reads = () => calls.get('readTurnFile') ?? 0;
    // A turn in flight in c: it stays loaded however small the budget.
    const live = await store.startTurn(c, 'more', 5);
    await store.appendDelta(c, live.turnId, 'streaming', 6);
    await store.listTurns(c);
    const afterC = reads();

    await store.listTurns(a);
    await store.listTurns(b);
    const beforeA = reads();
    await store.listTurns(a);
    assert.equal(reads(), beforeA + 1, 'a was dropped for b and read again');

    await store.appendDelta(c, live.turnId, ' on', 7);
    await store.listTurns(c);
    assert.equal(reads(), beforeA + 1, 'c was never dropped');
    assert.ok(afterC > 0);
    assert.equal((await store.getTurn(live.turnId)).messages[1]?.content, 'streaming on');
  } finally {
    await rmrf(baseDir);
  }
});

test('nativeHistoryCurrent: only the same transcript over the same thread is current', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p', agentId: 'claude-code' }, 1);
    assert.equal(await store.nativeHistoryCurrent(thread.id, undefined), false);
    assert.equal(await store.nativeHistoryCurrent(thread.id, 'sig-1'), false);

    await store.reconcileNativeHistory(thread.id, [], 2, 'sig-1');
    assert.equal(await store.nativeHistoryCurrent(thread.id, 'sig-1'), true);
    assert.equal(await store.nativeHistoryCurrent(thread.id, 'sig-2'), false, 'the file changed');
    assert.equal(await store.nativeHistoryCurrent(thread.id, undefined), false);

    // Survives a restart: it is part of the thread's index.
    const reloaded = new ThreadStore(new DaemonState(baseDir));
    assert.equal(await reloaded.nativeHistoryCurrent(thread.id, 'sig-1'), true);

    // The thread changed under it: a merge could now come out differently.
    const { turnId } = await reloaded.startTurn(thread.id, 'ask', 3);
    assert.equal(await reloaded.nativeHistoryCurrent(thread.id, 'sig-1'), false);
    await reloaded.reconcileNativeHistory(thread.id, [], 4, 'sig-1');
    await reloaded.completeTurn(thread.id, turnId, 'done', 5);
    assert.equal(await reloaded.nativeHistoryCurrent(thread.id, 'sig-1'), false);
  } finally {
    await rmrf(baseDir);
  }
});

test('a change that leaves a thread as it was rewrites nothing', async () => {
  const baseDir = tempDir();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p' }, 1);
    await store.setAccessMode(thread.id, 'fullAccess');
    const index = join(baseDir, 'threads', thread.id, 'thread.json');
    const before = (await stat(index)).ino;
    await store.setAccessMode(thread.id, 'fullAccess');
    await store.setAgentSession(thread.id, 'native');
    const between = (await stat(index)).ino;
    assert.notEqual(between, before, 'a real change is written');
    await store.setAgentSession(thread.id, 'native');
    await store.getThread(thread.id);
    assert.equal((await stat(index)).ino, between, 'the same value again is not');
  } finally {
    await rmrf(baseDir);
  }
});
