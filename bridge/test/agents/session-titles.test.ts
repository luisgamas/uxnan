/**
 * Naming the agents' own sessions that have no title: lazily, from their own
 * history, with the same errand as a conversation's — and bounded, so a folder
 * with fifty untitled sessions never starts fifty agent runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentId, GenerateTitleOptions, Turn } from '@uxnan/shared';
import { SessionTitles, type SessionTitleRef } from '../../src/agents/session-titles.js';
import type { Logger } from '../../src/logger.js';

const QUIET = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

function turn(user: string, assistant?: string): Turn {
  return {
    id: 't',
    threadId: 'x',
    status: 'completed',
    createdAt: 1,
    messages: [
      { id: 'u', role: 'user', content: user, createdAt: 1 },
      ...(assistant ? [{ id: 'a', role: 'assistant', content: assistant, createdAt: 2 }] : []),
    ],
  } as unknown as Turn;
}

function ref(n: number, agentId: AgentId = 'opencode'): SessionTitleRef {
  return { agentId, sessionId: `s-${n}`, cwd: '/repo' };
}

/** A harness whose naming runs wait until the test lets them go. */
function harness(options: { histories?: Record<string, Turn[] | null>; budget?: number } = {}) {
  const files = new Map<string, unknown>();
  const generated: { agentId: AgentId; options: GenerateTitleOptions }[] = [];
  const waiting: (() => void)[] = [];
  let live = 0;
  let peak = 0;
  let answer: string | undefined = 'A Short Name';
  let clock = 1_000_000;
  const titles = new SessionTitles({
    state: {
      readJson: <T>(file: string) => Promise.resolve((files.get(file) as T | undefined) ?? null),
      writeJson: (file, data) => {
        files.set(file, structuredClone(data));
        return Promise.resolve();
      },
    },
    readTurns: (source) =>
      Promise.resolve(
        options.histories !== undefined
          ? (options.histories[source.agentSessionId ?? ''] ?? null)
          : [turn(`first ask of ${source.agentSessionId}`, 'first answer')],
      ),
    generate: async (agentId, opts) => {
      generated.push({ agentId, options: opts });
      live += 1;
      peak = Math.max(peak, live);
      await new Promise<void>((resolve) => waiting.push(resolve));
      live -= 1;
      return answer;
    },
    now: () => clock,
    logger: QUIET,
    ...(options.budget !== undefined ? { budgetPerHour: options.budget } : {}),
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  /** Let every run waiting now finish, and what that starts. */
  const release = async (): Promise<void> => {
    await settle();
    while (waiting.length > 0) {
      waiting.shift()!();
      await settle();
    }
  };
  return {
    titles,
    files,
    generated,
    release,
    settle,
    peak: () => peak,
    answer: (value: string | undefined) => (answer = value),
    advance: (ms: number) => (clock += ms),
  };
}

test('names a session from its first exchange and keeps the name', async () => {
  const h = harness();
  h.titles.request([ref(1)]);
  assert.equal(h.titles.isPending('opencode', 's-1'), true);
  assert.equal(h.titles.titleOf('opencode', 's-1'), undefined);
  await h.release();
  assert.equal(h.titles.titleOf('opencode', 's-1'), 'A Short Name');
  assert.equal(h.titles.isPending('opencode', 's-1'), false);
  assert.equal(h.generated.length, 1);
  assert.deepEqual(h.generated[0]!.options, {
    userText: 'first ask of s-1',
    assistantText: 'first answer',
    cwd: '/repo',
  });
  // Asked once: a second listing names nothing again.
  h.titles.request([ref(1)]);
  await h.release();
  assert.equal(h.generated.length, 1);
});

test('a session is named on the model it ran on, when its record says', async () => {
  const h = harness();
  h.titles.request([{ ...ref(1), model: 'opencode/big-pickle' }, ref(2)]);
  await h.release();
  assert.equal(h.generated[0]!.options.model, 'opencode/big-pickle');
  assert.equal(h.generated[1]!.options.model, undefined);
});

test('the names are on disk, and a restarted bridge has them', async () => {
  const h = harness();
  h.titles.request([ref(1)]);
  await h.release();
  const again = new SessionTitles({
    state: {
      readJson: <T>(file: string) => Promise.resolve((h.files.get(file) as T | undefined) ?? null),
      writeJson: () => Promise.resolve(),
    },
    readTurns: () => Promise.resolve(null),
    generate: () => Promise.resolve(undefined),
    now: () => 0,
    logger: QUIET,
  });
  await again.init();
  assert.equal(again.titleOf('opencode', 's-1'), 'A Short Name');
});

test('fifty untitled sessions never start fifty runs: two at a time, a short queue', async () => {
  const h = harness();
  h.titles.request(Array.from({ length: 50 }, (_, i) => ref(i)));
  await h.settle();
  // Two running, the rest of the queue (12 in all) waits; the other 38 are not pending.
  assert.equal(h.generated.length, 2);
  const pending = Array.from({ length: 50 }, (_, i) => h.titles.isPending('opencode', `s-${i}`));
  assert.equal(pending.filter(Boolean).length, 12);
  // The newest are the ones handed in first.
  assert.equal(pending[0], true);
  assert.equal(pending[49], false);
  await h.release();
  assert.equal(h.generated.length, 12);
  assert.equal(h.peak(), 2);
  // The next listing offers the rest.
  h.titles.request(Array.from({ length: 50 }, (_, i) => ref(i)));
  await h.release();
  assert.equal(h.generated.length, 24);
  assert.equal(h.peak(), 2);
});

test('an hour holds a bounded number of runs', async () => {
  const h = harness({ budget: 3 });
  h.titles.request(Array.from({ length: 6 }, (_, i) => ref(i)));
  await h.release();
  assert.equal(h.generated.length, 3);
  // Nothing is left pending that will never run.
  assert.equal(h.titles.isPending('opencode', 's-5'), false);
  h.titles.request([ref(5)]);
  await h.release();
  assert.equal(h.generated.length, 3, 'still the same hour');
  h.advance(61 * 60 * 1000);
  h.titles.request([ref(5)]);
  await h.release();
  assert.equal(h.generated.length, 4);
});

test('a session with nothing to read is left alone for a while, with no run', async () => {
  const h = harness({ histories: { 's-1': null, 's-2': [turn('   ')] } });
  h.titles.request([ref(1), ref(2)]);
  await h.release();
  assert.equal(h.generated.length, 0);
  assert.equal(h.titles.isPending('opencode', 's-1'), false);
  h.titles.request([ref(1)]);
  await h.release();
  assert.equal(h.generated.length, 0);
});

test('a failed run is tried twice, then left untitled', async () => {
  const h = harness();
  h.answer(undefined);
  for (let i = 0; i < 4; i++) {
    h.titles.request([ref(1)]);
    await h.release();
  }
  assert.equal(h.generated.length, 2);
  assert.equal(h.titles.titleOf('opencode', 's-1'), undefined);
  assert.equal(h.titles.isPending('opencode', 's-1'), false);
});

test('what a naming run left in a CLI’s store is an errand: no run, and not a session', async () => {
  const h = harness({
    histories: {
      's-1': [
        turn(
          'Name this conversation in 3 to 6 words, as a short title.\nReply with ONLY the title',
        ),
      ],
    },
  });
  h.titles.request([ref(1)]);
  await h.release();
  assert.equal(h.generated.length, 0);
  assert.equal(h.titles.isErrand('opencode', 's-1'), true);
  assert.equal(h.titles.isPending('opencode', 's-1'), false);
});
