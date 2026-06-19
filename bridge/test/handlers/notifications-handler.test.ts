import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/index.js';
import { HandlerRouter, type RequestSession } from '../../src/handler-router.js';
import { registerNotificationHandlers } from '../../src/handlers/notifications-handler.js';
import { registerBridgeControlHandlers } from '../../src/handlers/bridge-control-handler.js';
import type { BridgeContext } from '../../src/bridge-context.js';

interface PushCall {
  op: 'register' | 'update' | 'unregister' | 'unregisterDevice';
  arg: unknown;
}

/** Minimal push-service stub capturing what the handlers ask it to do. */
function pushStub(calls: PushCall[], activeSessionId?: string) {
  return {
    activeSessionId,
    register(params: unknown) {
      calls.push({ op: 'register', arg: params });
      return Promise.resolve({ registered: true });
    },
    updatePreferences(sessionId: string, prefs: unknown) {
      calls.push({ op: 'update', arg: { sessionId, prefs } });
    },
    unregister(sessionId: string) {
      calls.push({ op: 'unregister', arg: sessionId });
    },
    unregisterDevice(deviceId: string) {
      calls.push({ op: 'unregisterDevice', arg: deviceId });
      return 1;
    },
  };
}

function ctxWith(push: unknown, extra: Partial<BridgeContext> = {}): BridgeContext {
  return {
    logger: createLogger('test', 'error'),
    pushService: push as BridgeContext['pushService'],
    ...extra,
  } as BridgeContext;
}

function reqRouter(ctx: BridgeContext): HandlerRouter {
  const router = new HandlerRouter(ctx);
  registerNotificationHandlers(router);
  return router;
}

const REGISTER = (params: unknown) => ({
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'notifications/register',
  params,
});

test('register targets the REQUEST session (concurrent phones)', async () => {
  const calls: PushCall[] = [];
  const router = reqRouter(ctxWith(pushStub(calls, 'active-other')));
  const session: RequestSession = { sessionId: 'ses_phoneA', deviceId: 'dev_A' };
  await router.dispatch(REGISTER({ pushToken: 'tokA', platform: 'android' }), session);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.arg, {
    sessionId: 'ses_phoneA',
    deviceId: 'dev_A',
    pushToken: 'tokA',
    platform: 'android',
  });
});

test('register falls back to the active session when no per-request identity', async () => {
  const calls: PushCall[] = [];
  const router = reqRouter(ctxWith(pushStub(calls, 'active-1')));
  await router.dispatch(REGISTER({ pushToken: 'tok', platform: 'ios' })); // no session

  assert.equal(calls.length, 1);
  const arg = calls[0]!.arg as Record<string, unknown>;
  assert.equal(arg['sessionId'], 'active-1');
  assert.equal(arg['deviceId'], undefined);
});

test('register with no session and no active session is a no-op (not registered)', async () => {
  const calls: PushCall[] = [];
  const router = reqRouter(ctxWith(pushStub(calls, undefined)));
  const res = await router.dispatch(REGISTER({ pushToken: 'tok', platform: 'ios' }));

  assert.equal(calls.length, 0);
  assert.deepEqual((res as { result: unknown }).result, { registered: false });
});

test('unregister targets the request session', async () => {
  const calls: PushCall[] = [];
  const router = reqRouter(ctxWith(pushStub(calls)));
  await router.dispatch(
    { jsonrpc: '2.0', id: 2, method: 'notifications/unregister', params: {} },
    { sessionId: 'ses_X', deviceId: 'dev_X' },
  );
  assert.deepEqual(calls, [{ op: 'unregister', arg: 'ses_X' }]);
});

test('removeTrustedDevice prunes the device push registration', async () => {
  const calls: PushCall[] = [];
  const removed: string[] = [];
  const ctx = ctxWith(pushStub(calls), {
    trustStore: { remove: (id: string) => Promise.resolve(removed.push(id)) } as never,
    sessions: { remove: () => true } as never,
    sessionRegistry: { forget: () => undefined } as never,
  });
  const router = new HandlerRouter(ctx);
  registerBridgeControlHandlers(router);

  await router.dispatch({
    jsonrpc: '2.0',
    id: 3,
    method: 'bridge/removeTrustedDevice',
    params: { deviceId: 'dev_gone' },
  });

  assert.deepEqual(removed, ['dev_gone'], 'trust revoked');
  assert.deepEqual(calls, [{ op: 'unregisterDevice', arg: 'dev_gone' }], 'push pruned');
});
