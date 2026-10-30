import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JsonRpcErrorCode,
  LOCAL_CONTROL_MAX_FRAME_BYTES,
  RpcError,
  makeRequest,
} from '@uxnan/shared';
import { HandlerRouter, SessionRegistry, createLogger } from '../src/index.js';
import { MAX_RESPONSE_BYTES } from '../src/handler-router.js';
import type { BridgeContext } from '../src/index.js';

function fakeContext(): BridgeContext {
  return {
    version: '0.0.0-test',
    startedAt: 0,
    config: {} as BridgeContext['config'],
    state: {} as BridgeContext['state'],
    deviceState: {} as BridgeContext['deviceState'],
    sessions: {} as BridgeContext['sessions'],
    sessionRegistry: new SessionRegistry(),
    trustStore: {} as BridgeContext['trustStore'],
    threadStore: {} as BridgeContext['threadStore'],
    threadSearch: {} as BridgeContext['threadSearch'],
    metrics: {} as BridgeContext['metrics'],
    usage: {} as BridgeContext['usage'],
    sessionHistory: {} as BridgeContext['sessionHistory'],
    historyWatcher: {} as BridgeContext['historyWatcher'],
    agentManager: {} as BridgeContext['agentManager'],
    viewStore: {} as BridgeContext['viewStore'],
    sessionHolds: {} as BridgeContext['sessionHolds'],
    agentInstalls: {} as BridgeContext['agentInstalls'],
    projects: {} as BridgeContext['projects'],
    ledger: {} as BridgeContext['ledger'],
    settings: {} as BridgeContext['settings'],
    presence: {} as BridgeContext['presence'],
    host: { launchedBy: 'cli', machineName: 'test' },
    browse: {} as BridgeContext['browse'],
    pushService: {} as BridgeContext['pushService'],
    logger: createLogger('test', 'error'),
    relayConnected: () => false,
    relay: () => {
      throw new Error('no relay in this test');
    },
    localControlActive: () => false,
    updater: {} as BridgeContext['updater'],
    pairingPayload: () => {
      throw new Error('not used');
    },
    pairingCode: () => {
      throw new Error('not used');
    },
    now: () => 1000,
  };
}

function newRouter(): HandlerRouter {
  return new HandlerRouter(fakeContext());
}

test('dispatch routes to a registered handler', async () => {
  const router = newRouter();
  router.register('git/status', () => ({
    branch: 'main',
    isDirty: false,
    ahead: 0,
    behind: 0,
    files: [],
  }));
  const res = await router.dispatch(makeRequest('1', 'git/status', { cwd: '/r' }));
  assert.ok('result' in res);
  assert.equal('error' in res, false);
});

test('dispatch returns -32601 for an unknown method', async () => {
  const router = newRouter();
  const res = await router.dispatch(makeRequest('1', 'totally/unknown'));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.MethodNotFound);
});

test('dispatch returns -32601 for a known-but-unregistered method', async () => {
  const router = newRouter();
  const res = await router.dispatch(makeRequest('1', 'git/status'));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.MethodNotFound);
});

test('dispatch maps a thrown RpcError to its code', async () => {
  const router = newRouter();
  router.register('git/status', () => {
    throw RpcError.invalidParams('cwd required');
  });
  const res = await router.dispatch(makeRequest('1', 'git/status'));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidParams);
});

test('dispatch maps a generic error to -32603', async () => {
  const router = newRouter();
  router.register('git/status', () => {
    throw new Error('boom');
  });
  const res = await router.dispatch(makeRequest('1', 'git/status'));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InternalError);
});

test('dispatchRaw rejects a malformed envelope with -32600', async () => {
  const router = newRouter();
  const res = await router.dispatchRaw({ jsonrpc: '1.0', id: 5 });
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidRequest);
  assert.equal(res.id, 5);
});

test('an answer too large for a frame is a -32011 error, and the connection keeps its frame', async () => {
  const router = newRouter();
  // A string whose JSON is just past what one frame of the smallest channel holds.
  router.register('turn/list', () => 'x'.repeat(MAX_RESPONSE_BYTES));
  const res = await router.dispatch(makeRequest(7, 'turn/list', {}));
  assert.ok('error' in res);
  assert.equal(res.id, 7);
  assert.equal(res.error.code, JsonRpcErrorCode.ResponseTooLarge);
  const data = res.error.data as { bytes: number; limit: number };
  assert.equal(data.limit, MAX_RESPONSE_BYTES);
  assert.ok(data.bytes > MAX_RESPONSE_BYTES);
  assert.ok(MAX_RESPONSE_BYTES < LOCAL_CONTROL_MAX_FRAME_BYTES, 'room for the frame around it');
});

test('the largest legitimate answer still passes: a 20 MiB file as base64', async () => {
  const router = newRouter();
  const base64Data = Buffer.alloc(20 * 1024 * 1024, 7).toString('base64');
  router.register('workspace/readFile', () => ({ mimeType: 'application/pdf', base64Data }));
  const res = await router.dispatch(makeRequest(8, 'workspace/readFile', {}));
  assert.ok('result' in res);
  assert.equal((res.result as { base64Data: string }).base64Data.length, base64Data.length);
});
