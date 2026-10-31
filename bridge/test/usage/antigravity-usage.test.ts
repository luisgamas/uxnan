/**
 * Antigravity's spend, read from the per-conversation SQLite stores `agy`
 * writes. The rows are built in the wire format agy 1.4.12 writes them in (the
 * field numbers documented in `antigravity-usage.ts`), and the scanner test
 * opens a real SQLite file with agy's own table layout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  antigravityRecords,
  protoFields,
  readAntigravityDb,
} from '../../src/usage/antigravity-usage.js';
import { UsageScanner, type UsageLocations } from '../../src/usage/usage-scan.js';
import { DaemonState } from '../../src/daemon-state.js';
import { rmrf } from '../helpers/fs.js';

/** Protobuf wire encoding, enough to write what agy writes. */
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}
type Field = [number, number | string | Uint8Array];
function msg(...fields: Field[]): Uint8Array {
  const bytes: number[] = [];
  for (const [n, value] of fields) {
    if (typeof value === 'number') {
      bytes.push(...varint(n * 8), ...varint(value));
    } else {
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      bytes.push(...varint(n * 8 + 2), ...varint(data.length), ...data);
    }
  }
  return Uint8Array.from(bytes);
}

/** A model call's usage block: the numbers agy 1.4.12 streamed and stored. */
function usage(id: string, input = 10_069, output = 33, thinking = 32, cacheRead = 0): Uint8Array {
  return msg([1, 1319], [2, input], [3, output], [5, cacheRead], [9, thinking], [11, id]);
}
/** A `gen_metadata` row: the generation, its usage, and its one attempt. */
function generation(call: Uint8Array, ...attempts: Uint8Array[]): Uint8Array {
  const gen = msg(
    [3, 1319],
    [4, call],
    [19, 'gemini-3.8-flash'],
    [21, 'Gemini 3.8 Flash (Medium)'],
    ...attempts.map((a): Field => [17, msg([2, a])]),
  );
  return msg([1, gen]);
}
/** A `steps` row for an `agent_response`: its usage and when it finished. */
function step(call: Uint8Array, finishedSeconds: number): Uint8Array {
  return msg([1, msg([1, finishedSeconds - 5])], [8, msg([1, finishedSeconds])], [9, call]);
}

test('protoFields reads varints and nested messages, and refuses a truncated one', () => {
  const fields = protoFields(msg([1, 300], [2, 'hi']));
  assert.equal(fields.get(1)?.[0], 300);
  assert.equal(new TextDecoder().decode(fields.get(2)?.[0] as Uint8Array), 'hi');
  assert.throws(() => protoFields(Uint8Array.from([0x12, 0x05, 0x61])));
});

test('one record per model call, timed by its step, its attempt counted once', () => {
  const call = usage('OYjlatSlJefV');
  const records = antigravityRecords(
    { generations: [generation(call, call)], steps: [step(call, 1_793_430_000)], trajectory: [] },
    1,
  );
  assert.deepEqual(records, [
    {
      agentId: 'antigravity-cli',
      model: 'gemini-3.8-flash',
      at: 1_793_430_000_000,
      inputTokens: 10_069,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 33,
      reasoningTokens: 32,
    },
  ]);
});

test('a failed attempt the call retried spent tokens too; a malformed row is dropped', () => {
  const call = usage('final', 5_000, 100, 0, 8_000);
  const failed = usage('failed', 4_000, 10, 0, 0);
  const records = antigravityRecords(
    {
      generations: [generation(call, failed, call), Uint8Array.from([0x0a, 0x09, 0x01])],
      steps: [],
      trajectory: [msg([2, msg([1, 1_700_000_000])])],
    },
    1,
  );
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => [r.inputTokens, r.cachedInputTokens, r.outputTokens, r.at]),
    [
      [5_000, 8_000, 100, 1_700_000_000_000],
      [4_000, 0, 10, 1_700_000_000_000],
    ],
  );
});

test('the scanner reads a conversation database agy wrote, and again only when it changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-usage-agy-'));
  const dir = join(root, 'antigravity');
  await mkdir(dir, { recursive: true });
  const db = join(dir, '859a0c6d-538c-4422-8846-e2801368f37f.db');
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(db);
  // agy 1.4.12's own layout for these three tables.
  sql.exec(
    'CREATE TABLE `gen_metadata` (`idx` integer,`data` blob,`size` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`));' +
      'CREATE TABLE `steps` (`idx` integer,`step_type` integer NOT NULL DEFAULT 0,`status` integer NOT NULL DEFAULT 0,`metadata` blob,PRIMARY KEY (`idx`));' +
      'CREATE TABLE `trajectory_metadata_blob` (`data` blob);',
  );
  const now = Date.parse('2026-10-31T06:00:00Z');
  const call = usage('OYjlatSlJefV');
  sql.prepare('INSERT INTO gen_metadata (idx, data) VALUES (0, ?)').run(generation(call, call));
  sql.prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (0, 14, NULL)').run();
  sql
    .prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (1, 15, ?)')
    .run(step(call, Math.floor(now / 1000) - 60));
  sql.close();
  const locations: UsageLocations = {
    claude: join(root, 'claude'),
    codex: [join(root, 'codex')],
    pi: join(root, 'pi'),
    grok: join(root, 'grok'),
    zero: join(root, 'zero'),
    openCodeDb: join(root, 'none.db'),
    antigravity: dir,
  };
  try {
    const rows = await readAntigravityDb(db);
    assert.equal(rows.generations.length, 1);
    assert.equal(rows.steps.length, 1, 'a step with no metadata is left out');

    let reads = 0;
    const state = new DaemonState(join(root, 'state'));
    const scanner = (at: number) =>
      new UsageScanner({
        state,
        locations,
        now: () => at,
        readAntigravity: (path) => {
          reads++;
          return readAntigravityDb(path);
        },
      });
    const summary = await scanner(now).summary(7);
    const bucket = summary.days[0]!.buckets[0]!;
    assert.equal(bucket.agentId, 'antigravity-cli');
    assert.equal(bucket.model, 'gemini-3.8-flash');
    assert.equal(bucket.inputTokens, 10_069);
    assert.equal(bucket.outputTokens, 33);
    assert.equal(bucket.reasoningTokens, 32);
    assert.equal(bucket.unpricedTokens, 10_102, 'billed by quota: tokens, never a guessed price');
    assert.deepEqual(summary.agents, [{ agentId: 'antigravity-cli', sessions: 1, status: 'ok' }]);

    // Unchanged on disk: answered from the cache, not read again.
    await scanner(now + 60_000).summary(7);
    assert.equal(reads, 1);
  } finally {
    await rmrf(root);
  }
});
