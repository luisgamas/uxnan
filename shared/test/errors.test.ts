import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonRpcErrorCode, RpcError } from '../src/index.js';

test('RpcError uses the default message for a known code', () => {
  const err = new RpcError(JsonRpcErrorCode.SessionExpired);
  assert.equal(err.message, 'Session expired');
  assert.equal(err.code, -32006);
});

test('RpcError.toErrorObject omits data when absent', () => {
  const err = new RpcError(JsonRpcErrorCode.BridgeError, 'custom');
  assert.deepEqual(err.toErrorObject(), { code: -32000, message: 'custom' });
});

test('RpcError.toErrorObject includes data when present', () => {
  const err = new RpcError(JsonRpcErrorCode.InvalidParams, 'bad', { field: 'cwd' });
  assert.deepEqual(err.toErrorObject(), {
    code: -32602,
    message: 'bad',
    data: { field: 'cwd' },
  });
});

test('RpcError.methodNotFound builds a -32601 error', () => {
  const err = RpcError.methodNotFound('foo/bar');
  assert.equal(err.code, JsonRpcErrorCode.MethodNotFound);
  assert.match(err.message, /foo\/bar/);
});
