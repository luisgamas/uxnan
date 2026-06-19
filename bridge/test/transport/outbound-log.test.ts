import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutboundLog } from '../../src/index.js';

const buf = (s: string): Buffer => Buffer.from(s, 'utf-8');

test('record assigns 1-based monotonic seq and advances nextSeq', () => {
  const log = new OutboundLog();
  assert.equal(log.nextSeq, 1);
  assert.equal(log.record(buf('a')), 1);
  assert.equal(log.record(buf('b')), 2);
  assert.equal(log.nextSeq, 3);
  assert.equal(log.length, 2);
});

test('entriesAfter returns only entries with seq strictly greater than N, oldest first', () => {
  const log = new OutboundLog();
  log.record(buf('one')); // 1
  log.record(buf('two')); // 2
  log.record(buf('three')); // 3
  const after1 = log.entriesAfter(1);
  assert.deepEqual(
    after1.map((e) => [e.seq, e.plaintext.toString()]),
    [
      [2, 'two'],
      [3, 'three'],
    ],
  );
  assert.deepEqual(log.entriesAfter(3), []);
  assert.equal(log.entriesAfter(0).length, 3);
});

test('the count cap evicts the oldest entries but seq keeps climbing', () => {
  const log = new OutboundLog(2);
  log.record(buf('1')); // seq 1 (evicted)
  log.record(buf('2')); // seq 2
  log.record(buf('3')); // seq 3
  assert.equal(log.length, 2);
  assert.equal(log.nextSeq, 4);
  // seq 1 was evicted, so it can no longer be replayed; 2 and 3 remain.
  assert.deepEqual(
    log.entriesAfter(0).map((e) => e.seq),
    [2, 3],
  );
});

test('the byte cap evicts oldest but always keeps at least one entry', () => {
  const log = new OutboundLog(100, 10);
  log.record(buf('x'.repeat(50)));
  log.record(buf('y'.repeat(50)));
  assert.equal(log.length, 1);
  assert.equal(log.entriesAfter(0)[0]?.plaintext.toString(), 'y'.repeat(50));
});
