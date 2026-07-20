import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/index.js';

test('a single key is still throttled exactly as before (window + count cap unaffected)', () => {
  let clock = 0;
  const limiter = new RateLimiter(2, () => clock);
  assert.equal(limiter.allow('1.1.1.1'), true); // 1
  assert.equal(limiter.allow('1.1.1.1'), true); // 2
  assert.equal(limiter.allow('1.1.1.1'), false); // 3 > limit
  clock += 60_000; // next window
  assert.equal(limiter.allow('1.1.1.1'), true); // window rolled, budget resets
});

test('the tracked-key count never exceeds maxKeys under IP rotation within one window', () => {
  let clock = 0;
  const maxKeys = 50;
  const limiter = new RateLimiter(5, () => clock, 60_000, maxKeys);
  for (let i = 0; i < maxKeys + 20; i += 1) {
    limiter.allow(`10.0.0.${i}`);
    assert.ok(limiter.size <= maxKeys, `size ${limiter.size} exceeded maxKeys ${maxKeys} at i=${i}`);
  }
  assert.equal(limiter.size, maxKeys);
});

test('expired windows are swept on the next call instead of accumulating', () => {
  let clock = 0;
  const limiter = new RateLimiter(5, () => clock, 60_000, 50);
  for (let i = 0; i < 10; i += 1) limiter.allow(`10.0.1.${i}`);
  assert.equal(limiter.size, 10);

  clock += 60_000; // all 10 entries are now expired
  limiter.allow('10.0.2.1'); // triggers a sweep before inserting the new key
  assert.equal(limiter.size, 1);
});
