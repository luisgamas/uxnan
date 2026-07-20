import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRelayBackoff } from '../../src/bridge.js';

const OPTS = { minHealthyMs: 3000, baseMs: 2000, maxMs: 30_000 };

test('nextRelayBackoff resets to the base delay after a healthy session', () => {
  assert.equal(nextRelayBackoff(5000, 16_000, OPTS), OPTS.baseMs);
});

test('nextRelayBackoff resets exactly at the healthy threshold (inclusive)', () => {
  assert.equal(nextRelayBackoff(OPTS.minHealthyMs, 16_000, OPTS), OPTS.baseMs);
});

test('nextRelayBackoff doubles the current backoff after a short session, capped at max', () => {
  assert.equal(nextRelayBackoff(0, OPTS.baseMs, OPTS), 4000);
  assert.equal(nextRelayBackoff(0, 4000, OPTS), 8000);
  assert.equal(nextRelayBackoff(500, 20_000, OPTS), OPTS.maxMs);
});

test('nextRelayBackoff escalates repeated short sessions to the cap and stays there', () => {
  let backoff = OPTS.baseMs;
  for (let i = 0; i < 10; i++) {
    backoff = nextRelayBackoff(0, backoff, OPTS);
  }
  assert.equal(backoff, OPTS.maxMs);
  // One more short session at the cap must not overflow past it.
  assert.equal(nextRelayBackoff(0, backoff, OPTS), OPTS.maxMs);
});

test('nextRelayBackoff resets to base after a healthy session even once escalated', () => {
  const escalated = nextRelayBackoff(0, nextRelayBackoff(0, OPTS.baseMs, OPTS), OPTS);
  assert.ok(escalated > OPTS.baseMs);
  assert.equal(nextRelayBackoff(10_000, escalated, OPTS), OPTS.baseMs);
});
