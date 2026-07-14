import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/index.js';
import { HandlerRouter, type RequestSession } from '../../src/handler-router.js';
import { registerUsageHandlers, validateProviders } from '../../src/handlers/usage-handler.js';
import type { BridgeContext } from '../../src/bridge-context.js';

function ctx(): BridgeContext {
  return { logger: createLogger('test', 'error'), now: () => 1 } as unknown as BridgeContext;
}

const session: RequestSession = { sessionId: 'ses', deviceId: 'dev' };

test('validateProviders rejects an unknown provider', () => {
  assert.throws(() => validateProviders({ providers: ['codex', 'nope'] }));
});

test('validateProviders dedupes and keeps known providers in order', () => {
  assert.deepEqual(validateProviders({ providers: ['codex', 'codex', 'grok'] }), ['codex', 'grok']);
});

test('validateProviders requires a providers array', () => {
  assert.throws(() => validateProviders({}));
});

test('agent/usageStats is registered and returns a usage array', async () => {
  const router = new HandlerRouter(ctx());
  registerUsageHandlers(router);
  const resp = await router.dispatch(
    { jsonrpc: '2.0', id: 1, method: 'agent/usageStats', params: { providers: [] } },
    session,
  );
  const result = (resp as { result: { usage: unknown[] } }).result;
  assert.deepEqual(result.usage, []);
});

test('agent/usageStats rejects an unknown provider with invalidParams', async () => {
  const router = new HandlerRouter(ctx());
  registerUsageHandlers(router);
  const resp = await router.dispatch(
    { jsonrpc: '2.0', id: 2, method: 'agent/usageStats', params: { providers: ['bogus'] } },
    session,
  );
  const error = (resp as { error?: { code: number } }).error;
  assert.equal(error?.code, -32602);
});
