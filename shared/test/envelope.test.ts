import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  makeErrorResponse,
  makeNotification,
  makeRequest,
  makeResponse,
} from '../src/index.js';

test('makeRequest builds a well-formed request', () => {
  const req = makeRequest('id-1', 'git/status', { cwd: '/repo' });
  assert.equal(req.jsonrpc, '2.0');
  assert.equal(req.id, 'id-1');
  assert.equal(req.method, 'git/status');
  assert.deepEqual(req.params, { cwd: '/repo' });
  assert.ok(isJsonRpcRequest(req));
});

test('makeRequest omits params when undefined', () => {
  const req = makeRequest('id-2', 'auth/status');
  assert.ok(!('params' in req));
});

test('makeNotification has no id and is detected as a notification', () => {
  const note = makeNotification('stream/turn/started', { threadId: 't', turnId: 'u' });
  assert.ok(!('id' in note));
  assert.ok(isJsonRpcNotification(note));
  assert.ok(!isJsonRpcRequest(note));
});

test('makeResponse and makeErrorResponse are detected as responses', () => {
  const ok = makeResponse(1, { value: 42 });
  assert.ok(isJsonRpcResponse(ok));
  const err = makeErrorResponse(1, { code: -32000, message: 'boom' });
  assert.ok(isJsonRpcResponse(err));
  assert.equal(err.error.code, -32000);
});
