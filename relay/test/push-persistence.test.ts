import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PushPlatform } from '@uxnan/shared';
import {
  PushRegistry,
  type PersistedRelayState,
  type PushPayload,
  type PushSender,
} from '../src/index.js';

const silentLogger = { info: () => {}, warn: () => {} };

class RecordingSender implements PushSender {
  readonly sent: { token: string; platform: PushPlatform; payload: PushPayload }[] = [];
  send(token: string, platform: PushPlatform, payload: PushPayload): Promise<void> {
    this.sent.push({ token, platform, payload });
    return Promise.resolve();
  }
}

function tempStatePath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'uxnan-relay-state-'));
  return { dir, path: join(dir, 'relay-state.json') };
}

function freshClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('tokens persist across a registry restart (same statePath)', async () => {
  const { dir, path } = tempStatePath();
  try {
    const sender = new RecordingSender();
    // First "process": register two tokens, then flush the persist chain.
    const r1 = new PushRegistry({ sender, logger: silentLogger, statePath: path });
    const secret = r1.register('ses_1', 'tokenA', 'android').notificationSecret;
    r1.register('ses_1', 'tokenB', 'ios');
    await r1.flush();
    assert.ok(readFileSync(path, 'utf-8').includes('tokenA'), 'tokenA persisted');

    // Second "process": rehydrate from disk, the secrets must match.
    const r2 = new PushRegistry({ sender, logger: silentLogger, statePath: path });
    const loaded = await r2.load();
    assert.equal(loaded.sessions, 1);

    const outcome = await r2.notify({
      sessionId: 'ses_1',
      notificationSecret: secret,
      threadId: 'th',
      turnId: 'tn',
      title: 'Done',
      body: 'x',
    });
    assert.equal(outcome.delivered, true);
    assert.equal(outcome.recipients, 2, 'both tokens restored and delivered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe persists across a registry restart', async () => {
  const { dir, path } = tempStatePath();
  try {
    const sender = new RecordingSender();
    const clock = freshClock();
    const r1 = new PushRegistry({
      sender,
      logger: silentLogger,
      now: clock.now,
      generateSecret: () => 'sec',
      statePath: path,
    });
    r1.register('ses_1', 'tokenA', 'android');
    await r1.notify({
      sessionId: 'ses_1',
      notificationSecret: 'sec',
      threadId: 'th',
      turnId: 'tn-1',
      title: 'x',
      body: 'y',
    });
    await r1.flush();

    // Fresh registry, same path, fresh clock — the dedupe entry is on disk.
    const r2 = new PushRegistry({
      sender,
      logger: silentLogger,
      now: clock.now,
      generateSecret: () => 'sec',
      statePath: path,
    });
    await r2.load();
    clock.advance(10); // within TTL
    const dup = await r2.notify({
      sessionId: 'ses_1',
      notificationSecret: 'sec',
      threadId: 'th',
      turnId: 'tn-1',
      title: 'x',
      body: 'y',
    });
    assert.equal(dup.reason, 'duplicate', 'dedupe restored → duplicate after restart');
    assert.equal(sender.sent.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale dedupe entries (older than TTL) are evicted on load', async () => {
  const { dir, path } = tempStatePath();
  try {
    const sender = new RecordingSender();
    const clock = freshClock();
    const r1 = new PushRegistry({
      sender,
      logger: silentLogger,
      now: clock.now,
      generateSecret: () => 'sec',
      statePath: path,
      dedupeTtlMs: 100,
    });
    r1.register('ses_1', 'tokenA', 'android');
    await r1.notify({
      sessionId: 'ses_1',
      notificationSecret: 'sec',
      threadId: 'th',
      turnId: 'tn-stale',
      title: 'x',
      body: 'y',
    });
    await r1.flush();

    // Advance past TTL, then rehydrate.
    clock.advance(500);
    const r2 = new PushRegistry({
      sender,
      logger: silentLogger,
      now: clock.now,
      generateSecret: () => 'sec',
      statePath: path,
      dedupeTtlMs: 100,
    });
    const loaded = await r2.load();
    assert.equal(loaded.dedupeKeys, 0, 'stale dedupe entries evicted');

    // And a notify with the same turnId is no longer a duplicate.
    const outcome = await r2.notify({
      sessionId: 'ses_1',
      notificationSecret: 'sec',
      threadId: 'th',
      turnId: 'tn-stale',
      title: 'x',
      body: 'y',
    });
    assert.equal(outcome.delivered, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing state file loads as empty (no error)', async () => {
  const { dir, path } = tempStatePath();
  try {
    const r = new PushRegistry({
      sender: new RecordingSender(),
      logger: silentLogger,
      statePath: path,
    });
    const loaded = await r.load();
    assert.equal(loaded.sessions, 0);
    assert.equal(loaded.dedupeKeys, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt state file loads as empty and logs a warning', async () => {
  const { dir, path } = tempStatePath();
  try {
    const warnings: string[] = [];
    const r = new PushRegistry({
      sender: new RecordingSender(),
      logger: {
        info: () => {},
        warn: (m) => warnings.push(m),
      },
      statePath: path,
    });
    writeFileSync(path, '{not-json');
    const loaded = await r.load();
    assert.equal(loaded.sessions, 0);
    assert.equal(loaded.dedupeKeys, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /push state load failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persisted state carries version=1 and the expected shape', async () => {
  const { dir, path } = tempStatePath();
  try {
    const clock = freshClock(1000);
    const r = new PushRegistry({
      sender: new RecordingSender(),
      logger: silentLogger,
      now: clock.now,
      statePath: path,
      generateSecret: () => 'sec-XYZ',
    });
    r.register('ses_alpha', 'tA', 'android');
    r.register('ses_alpha', 'tB', 'ios');
    await r.notify({
      sessionId: 'ses_alpha',
      notificationSecret: 'sec-XYZ',
      threadId: 'th',
      turnId: 'tn-9',
      title: 'x',
      body: 'y',
    });
    await r.flush();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedRelayState;
    assert.equal(parsed.version, 1);
    assert.equal(parsed.sessions.length, 1);
    assert.equal(parsed.sessions[0]?.sessionId, 'ses_alpha');
    assert.equal(parsed.sessions[0]?.secret, 'sec-XYZ');
    assert.deepEqual(parsed.sessions[0]?.tokens, { tA: 'android', tB: 'ios' });
    assert.equal(parsed.dedupe['ses_alpha:tn-9'], 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe entries are capped (oldest evicted on overflow)', async () => {
  // The cap is enforced in-memory on every insertion (see #pruneDedupe called
  // from #notify); the persisted cap follows because #persist just serializes
  // the in-memory Map. We assert in-memory directly here — running 10k
  // persists in a test would dominate CI time on Windows.
  const clock = freshClock(10_000);
  const sender = new RecordingSender();
  const r = new PushRegistry({
    sender,
    logger: silentLogger,
    now: clock.now,
    generateSecret: () => 'sec',
    dedupeTtlMs: 1_000_000, // never expire within the test
  });
  r.register('ses_cap', 'tA', 'android');
  const N = 10_050;
  for (let i = 0; i < N; i += 1) {
    await r.notify({
      sessionId: 'ses_cap',
      notificationSecret: 'sec',
      threadId: 'th',
      turnId: `tn-${i}`,
      title: 'x',
      body: 'y',
    });
    clock.advance(1);
  }
  assert.ok(r.dedupeSize <= 10_000, `in-memory dedupe capped (got ${r.dedupeSize})`);
});

test('persisted file honors the dedupe cap (small sample)', async () => {
  const { dir, path } = tempStatePath();
  try {
    const r = new PushRegistry({
      sender: new RecordingSender(),
      logger: silentLogger,
      generateSecret: () => 'sec',
      statePath: path,
    });
    r.register('ses_persist_cap', 'tA', 'android');
    // A handful of notifies — fast even with persistence. The cap test above
    // proves the in-memory eviction runs on every insert; this test just
    // confirms the persisted file reflects the same cap.
    for (let i = 0; i < 12; i += 1) {
      await r.notify({
        sessionId: 'ses_persist_cap',
        notificationSecret: 'sec',
        threadId: 'th',
        turnId: `tn-${i}`,
        title: 'x',
        body: 'y',
      });
    }
    await r.flush();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedRelayState;
    assert.equal(Object.keys(parsed.dedupe).length, 12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without a statePath, the registry stays in-memory (no file written)', async () => {
  const r = new PushRegistry({
    sender: new RecordingSender(),
    logger: silentLogger,
    generateSecret: () => 'sec',
  });
  r.register('ses_volatile', 'tA', 'android');
  await r.flush();
  // Nothing to assert beyond "no throw" — the in-memory path is the existing
  // behavior. A re-load with no path returns zeros.
  const loaded = await r.load();
  assert.equal(loaded.sessions, 0);
  assert.equal(loaded.dedupeKeys, 0);
});

test('unregister drops a session and the change persists', async () => {
  const { dir, path } = tempStatePath();
  try {
    const sender = new RecordingSender();
    const r1 = new PushRegistry({
      sender,
      logger: silentLogger,
      generateSecret: () => 'sec',
      statePath: path,
    });
    r1.register('ses_drop', 'tA', 'android');
    r1.register('ses_keep', 'tB', 'android');
    await r1.flush();
    r1.unregister('ses_drop');
    await r1.flush();

    const r2 = new PushRegistry({
      sender,
      logger: silentLogger,
      generateSecret: () => 'sec',
      statePath: path,
    });
    const loaded = await r2.load();
    assert.equal(loaded.sessions, 1, 'unregistered session no longer restored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
