/**
 * Budget guard for the conversation store (plans/046, phase 1): no cost of an
 * everyday operation may grow with the length of a conversation's history.
 *
 * A real conversation reached 46 MB (21 turns, ~9 000 command steps) and every
 * streamed token rewrote all of it — ~100 ms of a blocked event loop per delta,
 * for every chat and every client of the bridge. These tests build a synthetic
 * conversation of that shape and hold the store to fixed budgets: what one
 * delta writes, what a start reads, and whether an unchanged native transcript
 * is read again — and (phase 2) what a client is sent: a page of turns within
 * its byte budget whatever the turns hold, the steps it opens within theirs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  JsonRpcErrorCode,
  STEP_PAGE_MAX_BYTES,
  STEP_THINKING_PREVIEW_CHARS,
  TURN_PAGE_MAX_BYTES,
  isWorkRunSegment,
  makeRequest,
  type JsonRpcResponse,
  type StepPage,
  type Turn,
  type TurnList,
  type WorkRunSegment,
} from '@uxnan/shared';
import {
  DaemonState,
  HandlerRouter,
  NativeHistoryWatcher,
  SessionHistoryReader,
  SessionRegistry,
  ThreadStore,
  createLogger,
  type BridgeContext,
} from '../../src/index.js';
import { registerThreadHandlers } from '../../src/handlers/thread-context-handler.js';
import { ThreadSearch } from '../../src/conversation/thread-search.js';
import { rmrf } from '../helpers/fs.js';

const TURNS = 20;
const STEPS_PER_TURN = 400;
const THREAD_ID = 'big-thread';

/** One ~2 KB work step, the shape an autonomous agent leaves hundreds of. */
function step(turn: number, index: number): Record<string, unknown> {
  return {
    type: 'command_execution',
    blockId: `t${turn}-s${index}`,
    command: `cat src/file-${index}.ts | head -n 40 # ${'x'.repeat(160)}`,
    output: 'line of output\n'.repeat(120),
    exitCode: 0,
    status: 'completed',
  };
}

/** A conversation as the bridge stored it before this layout: one file. */
function syntheticThread(): Record<string, unknown> {
  const turns = [];
  for (let t = 0; t < TURNS; t++) {
    const turnId = `turn-${t}`;
    const steps = Array.from({ length: STEPS_PER_TURN }, (_, i) => step(t, i));
    const segments: unknown[] = [];
    for (const [i, s] of steps.entries()) {
      if (i % 50 === 0) segments.push({ type: 'text', text: `Working on part ${i}. ` });
      segments.push(s);
    }
    const text = segments
      .filter((s) => (s as { type: string }).type === 'text')
      .map((s) => (s as { text: string }).text)
      .join('');
    turns.push({
      id: turnId,
      threadId: THREAD_ID,
      seq: t + 1,
      status: 'completed',
      createdAt: 1_000 + t * 10,
      completedAt: 1_005 + t * 10,
      messages: [
        {
          id: `${turnId}-u`,
          turnId,
          role: 'user',
          text: `do part ${t}`,
          createdAt: 1_000 + t * 10,
        },
        {
          id: `${turnId}-a`,
          turnId,
          role: 'assistant',
          text,
          blocks: steps,
          segments,
          createdAt: 1_000 + t * 10,
        },
      ],
    });
  }
  return {
    id: THREAD_ID,
    projectId: 'p',
    title: 'A long autonomous run',
    status: 'active',
    createdAt: 1_000,
    updatedAt: 2_000,
    agentId: 'claude-code',
    turns,
  };
}

async function seedSynthetic(): Promise<string> {
  const baseDir = join(tmpdir(), `uxnan-budget-${randomUUID()}`);
  await mkdir(join(baseDir, 'threads'), { recursive: true });
  await writeFile(
    join(baseDir, 'threads', `${THREAD_ID}.json`),
    JSON.stringify(syntheticThread()),
    'utf-8',
  );
  return baseDir;
}

/** Every file under [dir], with the identity and size it has now. */
async function snapshot(dir: string): Promise<Map<string, { ino: number; size: number }>> {
  const out = new Map<string, { ino: number; size: number }>();
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const info = await stat(full);
        out.set(full, { ino: info.ino, size: info.size });
      }
    }
  };
  await walk(dir);
  return out;
}

/**
 * Bytes [op] wrote under [dir], from the filesystem itself: a file that is new
 * or was replaced (atomic writes swap the inode) counts whole; one that only
 * grew counts what it grew by. Independent of how the store names its files.
 */
async function bytesWritten(dir: string, op: () => Promise<unknown>): Promise<number> {
  const before = await snapshot(dir);
  await op();
  const after = await snapshot(dir);
  let total = 0;
  for (const [path, now] of after) {
    const was = before.get(path);
    if (!was || was.ino !== now.ino) total += now.size;
    else if (now.size !== was.size) total += Math.max(0, now.size - was.size);
  }
  return total;
}

/**
 * A DaemonState that counts the calls made to it by name, so a test can tell
 * which files the store opened without depending on how it parses them.
 */
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

/** Calls that read the body of a turn (its file or its journal). */
function turnReads(calls: Map<string, number>): number {
  let total = 0;
  for (const [name, count] of calls) if (/^readTurn/.test(name)) total += count;
  return total;
}

test('budget: one streamed delta writes a few bytes, however long the conversation', async () => {
  const baseDir = await seedSynthetic();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    // Open it the way a client does, so its turns are in memory.
    const page = await store.listTurns(THREAD_ID, undefined, 30, true);
    assert.equal(page.total, TURNS);
    const { turnId } = await store.startTurn(THREAD_ID, 'one more part', 5_000);
    await store.appendDelta(THREAD_ID, turnId, 'Start', 5_001);

    const written = await bytesWritten(baseDir, () =>
      store.appendDelta(THREAD_ID, turnId, ' of the answer', 5_002),
    );
    assert.ok(written < 4 * 1024, `one delta wrote ${written} bytes`);
    const step = await bytesWritten(baseDir, () =>
      store.appendBlock(THREAD_ID, turnId, { type: 'command_execution', command: 'ls' }, 5_003),
    );
    assert.ok(step < 4 * 1024, `one step wrote ${step} bytes`);

    // Still durable: a store that starts now (a crash right here) has it all.
    const reopened = new ThreadStore(new DaemonState(baseDir));
    const turn = await reopened.getTurn(turnId);
    assert.equal(turn.messages.find((m) => m.role === 'assistant')?.content, 'Start of the answer');
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: starting and listing conversations read no turn bodies', async () => {
  const baseDir = await seedSynthetic();
  try {
    // The first start converts the old file; what is measured is every later one.
    await new ThreadStore(new DaemonState(baseDir)).listThreads();
    const turnsDir = join(baseDir, 'threads', THREAD_ID, 'turns');
    assert.ok(existsSync(turnsDir), 'each turn lives in a file of its own');
    assert.equal((await readdir(turnsDir)).filter((name) => name.endsWith('.json')).length, TURNS);

    const { state, calls } = countingState(baseDir);
    const store = new ThreadStore(state);
    const { threads } = await store.listThreads();
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.turnCount, TURNS);
    assert.equal((await store.threadsChangedSince()).length, 1);
    await store.getThread(THREAD_ID);
    assert.equal(turnReads(calls), 0, `turn bodies read: ${JSON.stringify([...calls])}`);
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: an unchanged native transcript is not read again by turn/list', async () => {
  const baseDir = join(tmpdir(), `uxnan-budget-native-${randomUUID()}`);
  const home = join(baseDir, 'home');
  const sid = 'native-session-budget';
  const transcript = join(home, '.claude', 'projects', 'p', `${sid}.jsonl`);
  const line = (type: 'user' | 'assistant', text: string, at: string) =>
    JSON.stringify({
      type,
      message: { role: type, content: [{ type: 'text', text }] },
      timestamp: at,
    }) + '\n';
  try {
    await mkdir(join(transcript, '..'), { recursive: true });
    await writeFile(
      transcript,
      line('user', 'written elsewhere', '2026-10-01T10:00:00Z') +
        line('assistant', 'answered elsewhere', '2026-10-01T10:00:01Z'),
      'utf-8',
    );
    const store = new ThreadStore(new DaemonState(baseDir));
    const thread = await store.startThread({ projectId: 'p', agentId: 'claude-code' }, 1);
    await store.setAgentSession(thread.id, sid);

    const reader = new SessionHistoryReader({ homeDir: home });
    let reads = 0;
    const readTurns = reader.readTurns.bind(reader);
    reader.readTurns = (source, threadId) => {
      reads += 1;
      return readTurns(source, threadId);
    };
    const router = new HandlerRouter(
      fakeContext(store, reader, () => Date.parse('2026-10-01T11:00:00Z')),
    );
    registerThreadHandlers(router);
    const list = async (): Promise<TurnList> => {
      const response = await router.dispatch(
        makeRequest(randomUUID(), 'turn/list', { threadId: thread.id, fromEnd: true }),
      );
      assert.ok('result' in response, JSON.stringify(response));
      return response.result as TurnList;
    };

    assert.equal((await list()).total, 1, 'the external turn is imported');
    assert.equal((await list()).total, 1);
    assert.equal(reads, 1, 'the second read skipped the unchanged transcript');

    // Written to again elsewhere: read again, and the new turn arrives.
    await appendFile(
      transcript,
      line('user', 'and again', '2026-10-01T10:05:00Z') +
        line('assistant', 'once more', '2026-10-01T10:05:01Z'),
    );
    assert.equal((await list()).total, 2);
    assert.equal(reads, 2);
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: a turn/list page fits its byte budget, however large the turns are', async () => {
  const baseDir = await seedSynthetic();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const router = routerFor(store, baseDir);
    const stored = Buffer.byteLength(JSON.stringify(syntheticThread()));
    assert.ok(stored > 10 * 1024 * 1024, `the conversation holds ${stored} bytes`);

    const response = await router.dispatch(
      makeRequest(1, 'turn/list', { threadId: THREAD_ID, limit: 30, fromEnd: true }),
    );
    const bytes = Buffer.byteLength(JSON.stringify(response));
    assert.ok(bytes <= TURN_PAGE_MAX_BYTES, `a page of ${bytes} bytes`);
    const page = resultOf<TurnList>(response);
    assert.equal(page.turns.length, TURNS, 'summarized, every turn fits');
    assert.equal(page.offset, 0);
    assert.equal(page.nextCursor, undefined);
    // Each run of 50 commands is one `work` segment pointing at its steps.
    const reply = page.turns[0]!.messages[1]!;
    const runs = (reply.segments ?? []).filter(isWorkRunSegment);
    assert.equal(runs.length, STEPS_PER_TURN / 50);
    assert.deepEqual([runs[0]!.from, runs[0]!.to, runs[0]!.commands], [1, 50, 50]);
    assert.equal(runs[0]!.last.index, 50);
    assert.equal('blocks' in reply, false);
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: a page trimmed by its budget keeps the newest turns and says where it starts', async () => {
  const baseDir = await seedSynthetic();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const whole = await store.listTurns(THREAD_ID, undefined, 30, true);
    const oneTurn = Buffer.byteLength(JSON.stringify(whole.turns.at(-1)));
    const page = await store.listTurns(THREAD_ID, undefined, 30, true, oneTurn * 3 + 100);
    assert.equal(page.turns.length, 3);
    assert.equal(page.offset, TURNS - 3);
    assert.deepEqual(
      page.turns.map((t) => t.seq),
      [TURNS - 2, TURNS - 1, TURNS],
    );
    assert.equal(page.total, TURNS);
    // A window in the middle: trimmed at its start, never at its end.
    const middle = await store.listTurns(THREAD_ID, '5', 10, false, oneTurn * 2 + 100);
    assert.deepEqual(
      middle.turns.map((t) => t.seq),
      [14, 15],
    );
    assert.equal(middle.offset, 13);
    assert.equal(middle.nextCursor, '15');
    // Never empty: the newest turn of the window even past the budget.
    const tiny = await store.listTurns(THREAD_ID, undefined, 30, true, 1);
    assert.equal(tiny.turns.length, 1);
    assert.equal(tiny.offset, TURNS - 1);
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: turn/steps pages a long run within its budget, and turn/step gives one step whole', async () => {
  const baseDir = await seedSynthetic();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const router = routerFor(store, baseDir);
    const turnId = 'turn-3';
    const seen: number[] = [];
    let from: number | undefined = 0;
    let pages = 0;
    while (from !== undefined) {
      const response = await router.dispatch(
        makeRequest(pages, 'turn/steps', { threadId: THREAD_ID, turnId, from, to: 10_000 }),
      );
      const bytes = Buffer.byteLength(JSON.stringify(resultOf<StepPage>(response).steps));
      assert.ok(bytes <= STEP_PAGE_MAX_BYTES, `a step page of ${bytes} bytes`);
      const page = resultOf<StepPage>(response);
      assert.ok(page.steps.length > 0);
      seen.push(...page.steps.map((s) => s.index));
      from = page.next;
      pages += 1;
    }
    assert.ok(pages > 1, 'the budget split the run');
    assert.equal(seen.length, STEPS_PER_TURN, 'every step once, the prose skipped');
    assert.deepEqual(
      seen,
      [...seen].sort((a, b) => a - b),
    );

    const one = await router.dispatch(
      makeRequest('s', 'turn/step', { threadId: THREAD_ID, turnId, index: seen[0] }),
    );
    assert.deepEqual(resultOf<{ block: unknown }>(one).block, step(3, 0));

    const run = (await store.listTurns(THREAD_ID, '3', 1)).turns[0]!.messages[1]!.segments!.filter(
      isWorkRunSegment,
    )[1] as WorkRunSegment;
    const runSteps = resultOf<StepPage>(
      await router.dispatch(
        makeRequest('r', 'turn/steps', { threadId: THREAD_ID, turnId, from: run.from, to: run.to }),
      ),
    );
    assert.equal(runSteps.steps.length, 50);
    assert.deepEqual(runSteps.steps.at(-1), run.last);
  } finally {
    await rmrf(baseDir);
  }
});

test('budget: turn/read serves one turn summarized, as a page does', async () => {
  const baseDir = await seedSynthetic();
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const router = routerFor(store, baseDir);
    const response = await router.dispatch(makeRequest(1, 'turn/read', { turnId: 'turn-7' }));
    const turn = resultOf<Turn>(response);
    const page = (await store.listTurns(THREAD_ID, '7', 1)).turns[0];
    assert.deepEqual(turn, page);
    const stored = Buffer.byteLength(JSON.stringify(await store.getTurn('turn-7')));
    const served = Buffer.byteLength(JSON.stringify(turn));
    assert.ok(served * 20 < stored, `served ${served} of ${stored} bytes`);
  } finally {
    await rmrf(baseDir);
  }
});

test('the detail methods refuse what is not there', async () => {
  const baseDir = await seedSynthetic();
  try {
    const router = routerFor(new ThreadStore(new DaemonState(baseDir)), baseDir);
    const call = (method: string, params: Record<string, unknown>) =>
      router.dispatch(makeRequest(method, method, params));
    const code = (r: JsonRpcResponse) => ('error' in r ? r.error.code : undefined);
    const turn = { threadId: THREAD_ID, turnId: 'turn-0' };
    assert.equal(
      code(await call('turn/step', { ...turn, index: 0 })),
      JsonRpcErrorCode.ResourceNotFound,
      'a text run is no step',
    );
    assert.equal(
      code(await call('turn/step', { ...turn, index: 99_999 })),
      JsonRpcErrorCode.ResourceNotFound,
    );
    assert.equal(
      code(await call('turn/steps', { ...turn, from: 99_999, to: 100_000 })),
      JsonRpcErrorCode.ResourceNotFound,
    );
    assert.equal(
      code(await call('turn/steps', { ...turn, from: 5, to: 4 })),
      JsonRpcErrorCode.InvalidParams,
    );
    assert.equal(
      code(await call('turn/step', { ...turn, index: -1 })),
      JsonRpcErrorCode.InvalidParams,
    );
    assert.equal(
      code(await call('turn/step', { ...turn, index: 1.5 })),
      JsonRpcErrorCode.InvalidParams,
    );
    assert.equal(
      code(await call('turn/step', { threadId: THREAD_ID, turnId: 'nope', index: 1 })),
      JsonRpcErrorCode.ResourceNotFound,
    );
    assert.equal(
      code(await call('turn/step', { threadId: 'nope', turnId: 'turn-0', index: 1 })),
      JsonRpcErrorCode.ResourceNotFound,
    );
    // A thought's whole text is `turn/step`: the method of its own is gone.
    assert.equal(code(await call('turn/thinking', turn)), JsonRpcErrorCode.MethodNotFound);
  } finally {
    await rmrf(baseDir);
  }
});

test('a thought is a step: turn/steps previews it in its run, turn/step gives it whole', async () => {
  const baseDir = join(tmpdir(), `uxnan-budget-${randomUUID()}`);
  try {
    const store = new ThreadStore(new DaemonState(baseDir));
    const router = routerFor(store, baseDir);
    const thread = await store.startThread({ projectId: 'p' }, 1);
    const { turnId } = await store.startTurn(thread.id, 'go', 2);
    const long = 'why '.repeat(STEP_THINKING_PREVIEW_CHARS);
    await store.appendThinking(thread.id, turnId, long, 3);
    await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'ls' }, 4);
    await store.appendThinking(thread.id, turnId, 'ok', 5);
    await store.appendBlock(thread.id, turnId, { type: 'command_execution', command: 'pwd' }, 6);
    await store.appendDelta(thread.id, turnId, 'Done.', 7);
    await store.completeTurn(thread.id, turnId, undefined, 8);
    const ids = { threadId: thread.id, turnId };

    const [run] = (await store.listTurns(thread.id)).turns[0]!.messages[1]!.segments!.filter(
      isWorkRunSegment,
    ) as WorkRunSegment[];
    assert.deepEqual([run!.from, run!.to, run!.commands, run!.thoughts], [0, 3, 2, 2]);
    const page = resultOf<StepPage>(
      await router.dispatch(makeRequest(1, 'turn/steps', { ...ids, from: run!.from, to: run!.to })),
    );
    assert.deepEqual(
      page.steps.map((s) => s.type),
      ['thinking', 'command_execution', 'thinking', 'command_execution'],
    );
    assert.deepEqual(page.steps[0], {
      type: 'thinking',
      index: 0,
      text: long.slice(0, STEP_THINKING_PREVIEW_CHARS),
      textChars: long.length,
    });
    const whole = await router.dispatch(makeRequest(2, 'turn/step', { ...ids, index: 0 }));
    assert.deepEqual(resultOf<{ block: unknown }>(whole).block, { type: 'thinking', text: long });
  } finally {
    await rmrf(baseDir);
  }
});

function resultOf<T>(response: JsonRpcResponse): T {
  assert.ok('result' in response, JSON.stringify(response).slice(0, 500));
  return response.result as T;
}

/** The thread handlers over [store]; the agent's home holds no transcript. */
function routerFor(store: ThreadStore, baseDir: string): HandlerRouter {
  const reader = new SessionHistoryReader({ homeDir: join(baseDir, 'home') });
  const router = new HandlerRouter(fakeContext(store, reader, () => 10_000));
  registerThreadHandlers(router);
  return router;
}

function fakeContext(
  threadStore: ThreadStore,
  sessionHistory: SessionHistoryReader,
  now: () => number,
): BridgeContext {
  const sessionRegistry = new SessionRegistry();
  return {
    version: '0.0.0-test',
    startedAt: 0,
    config: {} as BridgeContext['config'],
    state: {} as BridgeContext['state'],
    deviceState: {} as BridgeContext['deviceState'],
    sessions: {} as BridgeContext['sessions'],
    sessionRegistry,
    trustStore: {} as BridgeContext['trustStore'],
    threadStore,
    threadSearch: new ThreadSearch(threadStore),
    metrics: {} as BridgeContext['metrics'],
    usage: {} as BridgeContext['usage'],
    sessionHistory,
    historyWatcher: new NativeHistoryWatcher({
      threadStore,
      sessionHistory,
      activeTurnId: () => undefined,
      isConnected: (readerId) => sessionRegistry.isActive(readerId),
      announce: () => undefined,
      now,
    }),
    agentManager: {
      activeTurnId: () => undefined,
      queueState: () => ({ queuedTurnIds: [], paused: false }),
    } as unknown as BridgeContext['agentManager'],
    viewStore: {} as BridgeContext['viewStore'],
    sessionHolds: {} as BridgeContext['sessionHolds'],
    sessionTitles: {} as BridgeContext['sessionTitles'],
    agentInstalls: {} as BridgeContext['agentInstalls'],
    projects: {} as BridgeContext['projects'],
    ledger: {} as BridgeContext['ledger'],
    settings: {} as BridgeContext['settings'],
    presence: {} as BridgeContext['presence'],
    host: { launchedBy: 'cli', machineName: 'test' },
    browse: {} as BridgeContext['browse'],
    pushService: {} as BridgeContext['pushService'],
    logger: createLogger('test', 'error'),
    relayConnected: () => false,
    relay: () => {
      throw new Error('no relay in this test');
    },
    localControlActive: () => false,
    updater: {} as BridgeContext['updater'],
    pairingPayload: () => {
      throw new Error('not used');
    },
    pairingCode: () => {
      throw new Error('not used');
    },
    now,
  };
}
