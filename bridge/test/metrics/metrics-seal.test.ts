import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MetricsSealError, openMetrics, sealMetrics } from '../../src/index.js';

const EVENTS = {
  sessions: [{ id: 's1', deviceId: 'phone', transport: 'relay', startedAt: 1, endedAt: 2 }],
  gitActions: [{ id: 'g1', method: 'git/commit', succeeded: true, at: 5 }],
};
const payload = (): Buffer => Buffer.from(JSON.stringify(EVENTS), 'utf-8');

function isSealError(code: string) {
  return (err: unknown): boolean => err instanceof MetricsSealError && err.code === code;
}

test('round-trips sealed metrics with the same key + device', () => {
  const key = randomBytes(32);
  const blob = sealMetrics(payload(), { sealKey: key, deviceId: 'pc-1', now: 100 });
  const out = openMetrics(blob, { sealKey: key, deviceId: 'pc-1' });
  assert.deepEqual(JSON.parse(out.toString('utf-8')), EVENTS);
});

test('rejects a backup sealed on a different PC (same-PC only)', () => {
  const key = randomBytes(32);
  const blob = sealMetrics(payload(), { sealKey: key, deviceId: 'pc-1', now: 100 });
  assert.throws(
    () => openMetrics(blob, { sealKey: key, deviceId: 'pc-2' }),
    isSealError('foreign-device'),
  );
});

test('rejects a file forged with a different key (unforgeable)', () => {
  const blob = sealMetrics(payload(), { sealKey: randomBytes(32), deviceId: 'pc-1', now: 1 });
  assert.throws(
    () => openMetrics(blob, { sealKey: randomBytes(32), deviceId: 'pc-1' }),
    isSealError('tampered'),
  );
});

test('detects an edited ciphertext', () => {
  const key = randomBytes(32);
  const obj = JSON.parse(sealMetrics(payload(), { sealKey: key, deviceId: 'pc-1', now: 1 }));
  const ct = Buffer.from(obj.enc.ciphertextB64, 'base64');
  ct[0] = (ct[0] ?? 0) ^ 0xff;
  obj.enc.ciphertextB64 = ct.toString('base64');
  assert.throws(
    () => openMetrics(JSON.stringify(obj), { sealKey: key, deviceId: 'pc-1' }),
    isSealError('tampered'),
  );
});

test('detects an edited header (bound as AAD)', () => {
  const key = randomBytes(32);
  const obj = JSON.parse(sealMetrics(payload(), { sealKey: key, deviceId: 'pc-1', now: 1 }));
  obj.createdAt = 999_999; // deviceId unchanged (passes the id check), fails the AAD tag
  assert.throws(
    () => openMetrics(JSON.stringify(obj), { sealKey: key, deviceId: 'pc-1' }),
    isSealError('tampered'),
  );
});

test('passphrase layer: round-trips, requires the phrase, rejects a wrong one', () => {
  const key = randomBytes(32);
  const blob = sealMetrics(payload(), {
    sealKey: key,
    deviceId: 'pc-1',
    now: 1,
    passphrase: 'hunter2',
  });
  const out = openMetrics(blob, { sealKey: key, deviceId: 'pc-1', passphrase: 'hunter2' });
  assert.deepEqual(JSON.parse(out.toString('utf-8')), EVENTS);
  assert.throws(
    () => openMetrics(blob, { sealKey: key, deviceId: 'pc-1' }),
    isSealError('passphrase-required'),
  );
  assert.throws(
    () => openMetrics(blob, { sealKey: key, deviceId: 'pc-1', passphrase: 'wrong' }),
    isSealError('bad-passphrase'),
  );
});

test('rejects a non-blob string as malformed', () => {
  assert.throws(
    () => openMetrics('not a blob', { sealKey: randomBytes(32), deviceId: 'pc-1' }),
    isSealError('malformed'),
  );
});
