import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutboundMessageBuffer } from '../../src/index.js';

test('drainAll returns messages in FIFO order and empties the buffer', () => {
  const buffer = new OutboundMessageBuffer();
  buffer.enqueue({ n: 1 });
  buffer.enqueue({ n: 2 });
  assert.deepEqual(buffer.drainAll(), [{ n: 1 }, { n: 2 }]);
  assert.equal(buffer.length, 0);
  assert.deepEqual(buffer.drainAll(), []);
});

test('the oldest message is evicted when the count cap is exceeded', () => {
  const buffer = new OutboundMessageBuffer(2);
  buffer.enqueue({ n: 1 });
  buffer.enqueue({ n: 2 });
  buffer.enqueue({ n: 3 });
  assert.equal(buffer.length, 2);
  assert.deepEqual(buffer.drainAll(), [{ n: 2 }, { n: 3 }]);
});

test('the byte cap evicts oldest but always keeps at least one message', () => {
  const buffer = new OutboundMessageBuffer(100, 10);
  buffer.enqueue({ a: 'x'.repeat(50) });
  buffer.enqueue({ b: 'y'.repeat(50) });
  assert.equal(buffer.length, 1);
  assert.deepEqual(buffer.drainAll(), [{ b: 'y'.repeat(50) }]);
});
