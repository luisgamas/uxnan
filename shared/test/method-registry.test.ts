import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METHOD_NAMES, isKnownMethod } from '../src/index.js';

test('isKnownMethod recognizes registered methods', () => {
  assert.ok(isKnownMethod('git/status'));
  assert.ok(isKnownMethod('bridge/generatePairingQr'));
});

test('isKnownMethod rejects unknown methods', () => {
  assert.ok(!isKnownMethod('does/notExist'));
  assert.ok(!isKnownMethod(''));
});

test('METHOD_NAMES has no duplicates', () => {
  assert.equal(new Set(METHOD_NAMES).size, METHOD_NAMES.length);
});
