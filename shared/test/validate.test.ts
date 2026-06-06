import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateE2EEnvelope, validateJsonRpcRequest, validatePushPayload } from '../src/index.js';

test('validateJsonRpcRequest accepts a valid request', () => {
  const result = validateJsonRpcRequest({
    jsonrpc: '2.0',
    id: 'x',
    method: 'git/status',
    params: { cwd: '/r' },
  });
  assert.ok(result.valid);
});

test('validateJsonRpcRequest rejects a wrong protocol version', () => {
  const result = validateJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'm' });
  assert.ok(!result.valid);
  assert.ok(result.valid === false && result.errors.length > 0);
});

test('validateJsonRpcRequest rejects a missing method', () => {
  const result = validateJsonRpcRequest({ jsonrpc: '2.0', id: 1 });
  assert.ok(!result.valid);
});

test('validateE2EEnvelope accepts a valid envelope', () => {
  const result = validateE2EEnvelope({
    kind: 'encryptedEnvelope',
    sessionId: 's',
    seq: 1,
    nonce: 'ab',
    ciphertext: 'cc',
    tag: 'dd',
  });
  assert.ok(result.valid);
});

test('validateE2EEnvelope rejects a negative seq', () => {
  const result = validateE2EEnvelope({
    kind: 'encryptedEnvelope',
    sessionId: 's',
    seq: -1,
    nonce: 'ab',
    ciphertext: 'cc',
    tag: 'dd',
  });
  assert.ok(!result.valid);
});

test('validatePushPayload requires the notification secret', () => {
  const result = validatePushPayload({
    sessionId: 's',
    threadId: 't',
    turnId: 'u',
    title: 'done',
    body: 'ok',
  });
  assert.ok(!result.valid);
});
