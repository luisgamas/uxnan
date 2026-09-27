import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONE_SHOT_PROMPT_OPENERS,
  isOneShotPrompt,
  JsonRpcErrorCode,
  RpcError,
} from '../src/index.js';

test('Uxnan’s own one-shots are recognized by how they open, and nothing else is', () => {
  for (const opener of ONE_SHOT_PROMPT_OPENERS) {
    assert.equal(isOneShotPrompt(`${opener} and the rest`), true, opener);
    assert.equal(isOneShotPrompt(`  \n${opener}`), true, opener);
  }
  assert.equal(isOneShotPrompt('Name this project'), false);
  assert.equal(isOneShotPrompt('please write a git commit message'), false);
  assert.equal(isOneShotPrompt(''), false);
});

test('a held session has its own error code and message', () => {
  const err = new RpcError(JsonRpcErrorCode.SessionHeld);
  assert.equal(err.code, -32010);
  assert.equal(err.message, 'Session open in a terminal');
});
