import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEqual } from '../../src/transport/constant-time.js';

test('constantTimeEqual compares equal strings', () => {
  assert.equal(constantTimeEqual('secret', 'secret'), true);
});

test('constantTimeEqual rejects different same-length strings', () => {
  assert.equal(constantTimeEqual('secret', 'secreT'), false);
});

test('constantTimeEqual rejects different-length strings', () => {
  assert.equal(constantTimeEqual('secret', 'secret-longer'), false);
});

test('constantTimeEqual accepts two empty strings', () => {
  assert.equal(constantTimeEqual('', ''), true);
});
