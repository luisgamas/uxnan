import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HistoryChangedParams, Turn } from '@uxnan/shared';
import {
  DaemonState,
  HISTORY_INTEREST_MS,
  HISTORY_UNSIGNED_INTERVAL_MS,
  HISTORY_WATCH_INTERVAL_MS,
  NativeHistoryWatcher,
  ThreadStore,
  type HistorySource,
  type WatcherTimers,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

interface Armed {
  callback: () => unknown;
  ms: number;
}

/** Timers a test fires by hand; `fire` resolves when the tick it ran ended. */
class ManualTimers implements WatcherTimers {
  readonly pending: Armed[] = [];

  setTimeout(callback: () => unknown, ms: number): unknown {
    const handle = { callback, ms };
    this.pending.push(handle);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    const index = this.pending.indexOf(handle as Armed);
    if (index >= 0) this.pending.splice(index, 1);
  }

  /** Run the one armed timer and wait for its tick. */
  async fire(): Promise<void> {
    assert.equal(this.pending.length, 1, 'exactly one tick armed');
    const handle = this.pending.shift()!;
    assert.equal(handle.ms, HISTORY_WATCH_INTERVAL_MS);
    await handle.callback();
  }
}

/**
 * The reader's two calls, as the real `SessionHistoryReader` answers them: a
 * signature string (file, size, mtime) or `undefined` for a history that is
 * not one file, and the transcript's turns or `null` when none were found.
 */
class FakeReader {
  signatures = new Map<string, string | undefined>();
  turns = new Map<string, Turn[] | null>();
  signatureCalls = 0;
  readCalls = 0;
  failFor: string | undefined;
  gate: Promise<void> | undefined;

  async sourceSignature(source: HistorySource): Promise<string | undefined> {
    this.signatureCalls += 1;
    if (source.agentSessionId === this.failFor) throw new Error('disk on fire');
    return this.signatures.get(source.agentSessionId ?? '');
  }

  async readTurns(source: HistorySource, threadId: string): Promise<Turn[] | null> {
    this.readCalls += 1;
    if (this.gate) await this.gate;
    const turns = this.turns.get(source.agentSessionId ?? '');
    return turns ? turns.map((turn) => ({ ...turn, threadId })) : null;
  }
}

/** A completed exchange as a transcript reader returns it. */
function nativeTurn(sessionId: string, index: number, prompt: string, reply: string): Turn {
  const at = 1_000 + index * 10;
  const id = `${sessionId}#t${index}`;
  return {
    id,
    threadId: '',
    status: 'completed',
    createdAt: at,
    completedAt: at + 2,
    messages: [
      { id: `${id}#u`, turnId: id, role: 'user', content: prompt, createdAt: at },
      { id: `${id}#a`, turnId: id, role: 'assistant', content: reply, createdAt: at + 2 },
    ],
  };
}

interface Harness {
  store: ThreadStore;
  reader: FakeReader;
  timers: ManualTimers;
  watcher: NativeHistoryWatcher;
  announced: HistoryChangedParams[];
  clock: { now: number };
  active: Map<string, string>;
  connected: Set<string>;
  baseDir: string;
}

function harness(): Harness {
  const baseDir = join(tmpdir(), `uxnan-watch-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const reader = new FakeReader();
  const timers = new ManualTimers();
  const announced: HistoryChangedParams[] = [];
  const clock = { now: 100_000 };
  const active = new Map<string, string>();
  const connected = new Set<string>(['phone', 'desktop']);
  const watcher = new NativeHistoryWatcher({
    threadStore: store,
    sessionHistory: reader,
    activeTurnId: (threadId) => active.get(threadId),
    isConnected: (readerId) => connected.has(readerId),
    announce: (params) => announced.push(params),
    now: () => clock.now,
    timers,
  });
  watcher.start();
  return { store, reader, timers, watcher, announced, clock, active, connected, baseDir };
}

/** A conversation continuing agent session [sessionId]. */
async function threadFor(h: Harness, sessionId: string, agentId = 'claude-code'): Promise<string> {
  const thread = await h.store.startThread({ projectId: 'p', agentId, cwd: '/w' }, 10);
  await h.store.setAgentSession(thread.id, sessionId);
  return thread.id;
}

async function done(h: Harness): Promise<void> {
  await h.watcher.stop();
  await rmrf(h.baseDir);
}

test('nothing watched: no timer is armed', async () => {
  const h = harness();
  assert.equal(h.timers.pending.length, 0);
  const threadId = await threadFor(h, 's1');
  h.watcher.watch(threadId, 'phone');
  assert.equal(h.timers.pending.length, 1);
  await done(h);
});

test('an unchanged transcript is only signed, never read again', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', []);
  h.watcher.watch(threadId, 'phone');

  await h.timers.fire();
  assert.equal(h.reader.readCalls, 1, 'first sight reads it once');
  await h.timers.fire();
  await h.timers.fire();
  assert.equal(h.reader.readCalls, 1);
  assert.equal(h.reader.signatureCalls, 3);
  assert.deepEqual(h.announced, []);
  await done(h);
});

test('a transcript that changed is merged and announced with the thread revision', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', []);
  h.watcher.watch(threadId, 'phone');
  await h.timers.fire();
  assert.deepEqual(h.announced, []);

  // A turn written in the agent's own terminal.
  h.reader.signatures.set('s1', '["a",20,2]');
  h.reader.turns.set('s1', [nativeTurn('s1', 0, 'from the terminal', 'answered there')]);
  await h.timers.fire();

  const thread = await h.store.getThread(threadId);
  assert.deepEqual(h.announced, [{ threadId, rev: thread.rev }]);
  const page = await h.store.listTurns(threadId, undefined, 20, true);
  assert.equal(page.turns[0]?.messages[0]?.content, 'from the terminal');

  // Merged once: the same transcript announces nothing more.
  await h.timers.fire();
  assert.equal(h.announced.length, 1);
  await done(h);
});

test('a thread the bridge is driving is not read', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', [nativeTurn('s1', 0, 'q', 'a')]);
  h.active.set(threadId, 'live-turn');
  h.watcher.watch(threadId, 'phone');

  await h.timers.fire();
  assert.equal(h.reader.signatureCalls, 0);
  assert.equal(h.reader.readCalls, 0);

  h.active.delete(threadId);
  await h.timers.fire();
  assert.equal(h.announced.length, 1);
  await done(h);
});

test('a turn that starts while the transcript is read stops the merge', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', [nativeTurn('s1', 0, 'q', 'a')]);
  let release!: () => void;
  h.reader.gate = new Promise((resolve) => (release = resolve));
  const merge = h.watcher.reconcile(threadId);
  await new Promise((resolve) => setImmediate(resolve));
  h.active.set(threadId, 'live-turn');
  release();
  assert.equal(await merge, false);
  assert.deepEqual(h.announced, []);
  assert.equal((await h.store.listTurns(threadId, undefined, 20, true)).turns.length, 0);
  await done(h);
});

test('interest ends 15 minutes after the last read, and with the reader', async () => {
  const h = harness();
  const quiet = await threadFor(h, 's1');
  const left = await threadFor(h, 's2');
  const shared = await threadFor(h, 's3');
  h.watcher.watch(quiet, 'phone');
  h.watcher.watch(left, 'desktop');
  h.watcher.watch(shared, 'phone');
  h.watcher.watch(shared, 'desktop');

  // The desktop disconnects: only what it alone read stops being watched.
  h.connected.delete('desktop');
  await h.timers.fire();
  assert.deepEqual(h.watcher.watched().sort(), [quiet, shared].sort());

  // Read again just before the window closes keeps it; the other expires.
  h.clock.now += HISTORY_INTEREST_MS - 1_000;
  h.watcher.watch(shared, 'phone');
  h.clock.now += 1_000;
  await h.timers.fire();
  assert.deepEqual(h.watcher.watched(), [shared]);

  h.clock.now += HISTORY_INTEREST_MS;
  await h.timers.fire();
  assert.deepEqual(h.watcher.watched(), []);
  // Nothing watched: the loop goes quiet.
  assert.equal(h.timers.pending.length, 0);
  await done(h);
});

test('a history that is not one file is read at most every 10 seconds', async () => {
  const h = harness();
  const threadId = await threadFor(h, 'oc1', 'opencode');
  h.reader.signatures.set('oc1', undefined);
  h.reader.turns.set('oc1', [nativeTurn('oc1', 0, 'q', 'a')]);
  h.watcher.watch(threadId, 'phone');

  await h.timers.fire();
  assert.equal(h.reader.readCalls, 1);
  assert.equal(h.announced.length, 1);

  for (let elapsed = 0; elapsed < HISTORY_UNSIGNED_INTERVAL_MS - HISTORY_WATCH_INTERVAL_MS; ) {
    elapsed += HISTORY_WATCH_INTERVAL_MS;
    h.clock.now += HISTORY_WATCH_INTERVAL_MS;
    await h.timers.fire();
  }
  assert.equal(h.reader.readCalls, 1);

  h.clock.now += HISTORY_WATCH_INTERVAL_MS;
  await h.timers.fire();
  assert.equal(h.reader.readCalls, 2);
  // Read again, nothing new: merged in place, nothing announced.
  assert.equal(h.announced.length, 1);

  // A client's own read is never held back by the cadence.
  await h.watcher.reconcile(threadId);
  assert.equal(h.reader.readCalls, 3);
  await done(h);
});

test('a thread with no agent session yet costs no read', async () => {
  const h = harness();
  const thread = await h.store.startThread({ projectId: 'p', agentId: 'opencode' }, 10);
  h.watcher.watch(thread.id, 'phone');
  await h.timers.fire();
  assert.equal(h.reader.signatureCalls, 0);
  assert.equal(h.reader.readCalls, 0);
  await done(h);
});

test('ticks never overlap: the next is armed when the last one ends', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', []);
  let release!: () => void;
  h.reader.gate = new Promise((resolve) => (release = resolve));
  h.watcher.watch(threadId, 'phone');

  const handle = h.timers.pending.shift()!;
  const tick = handle.callback() as Promise<void>;
  await new Promise((resolve) => setImmediate(resolve));
  // A slow tick: a new read does not arm a second one beside it.
  const other = await threadFor(h, 's2');
  h.watcher.watch(other, 'phone');
  assert.equal(h.timers.pending.length, 0);
  // A client's read of the same thread joins the merge already running.
  const joined = h.watcher.reconcile(threadId);

  release();
  await tick;
  await joined;
  assert.equal(h.reader.readCalls, 1);
  assert.equal(h.timers.pending.length, 1);
  await done(h);
});

test("one thread's failure never stops the loop; a deleted thread is no longer watched", async () => {
  const h = harness();
  const failing = await threadFor(h, 'broken');
  const healthy = await threadFor(h, 's1');
  h.reader.failFor = 'broken';
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', [nativeTurn('s1', 0, 'q', 'a')]);
  h.watcher.watch(failing, 'phone');
  h.watcher.watch('no-such-thread', 'phone');
  h.watcher.watch(healthy, 'phone');

  await h.timers.fire();
  assert.equal(h.announced.length, 1);
  assert.equal(h.announced[0]?.threadId, healthy);
  // A failure is tried again next tick; a thread that is gone is let go.
  assert.deepEqual(h.watcher.watched().sort(), [failing, healthy].sort());
  assert.equal(h.timers.pending.length, 1);
  await done(h);
});

test('stop clears the armed tick, waits for a running one, and arms nothing after', async () => {
  const h = harness();
  const threadId = await threadFor(h, 's1');
  h.reader.signatures.set('s1', '["a",10,1]');
  h.reader.turns.set('s1', []);
  h.watcher.watch(threadId, 'phone');
  await h.watcher.stop();
  assert.equal(h.timers.pending.length, 0);
  h.watcher.watch(threadId, 'phone');
  assert.equal(h.timers.pending.length, 0);

  h.watcher.start();
  let release!: () => void;
  h.reader.gate = new Promise((resolve) => (release = resolve));
  const handle = h.timers.pending.shift()!;
  const tick = handle.callback() as Promise<void>;
  await new Promise((resolve) => setImmediate(resolve));
  let stopped = false;
  const stopping = h.watcher.stop().then(() => (stopped = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, 'stop waits for the tick');
  release();
  await stopping;
  await tick;
  assert.equal(h.timers.pending.length, 0);
  await rmrf(h.baseDir);
});
