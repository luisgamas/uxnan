import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonRpcErrorCode, RpcError, makeRequest } from '@uxnan/shared';
import { HandlerRouter, SessionRegistry, createLogger } from '../src/index.js';
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
    threadStore: {} as BridgeContext['threadStore'],
    agentManager: {} as BridgeContext['agentManager'],
    projects: {} as BridgeContext['projects'],
    browse: {} as BridgeContext['browse'],
    pushService: {} as BridgeContext['pushService'],
    logger: createLogger('test', 'error'),
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
