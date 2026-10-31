import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/index.js';
import { HandlerRouter, type RequestSession } from '../../src/handler-router.js';
import {
  CoalescedUsageReads,
  registerUsageHandlers,
  validateProviders,
} from '../../src/handlers/usage-handler.js';
import type { ProviderUsage, UsageProvider } from '@uxnan/shared';
import type { BridgeContext } from '../../src/bridge-context.js';

function ctx(): BridgeContext {
  return { logger: createLogger('test', 'error'), now: () => 1 } as unknown as BridgeContext;
}

const session: RequestSession = { sessionId: 'ses', deviceId: 'dev' };

test('validateProviders skips a provider this bridge does not know, refuses a non-string', () => {
  // A newer client may ask for a provider added after this bridge.
  assert.deepEqual(validateProviders({ providers: ['codex', 'nope'] }), ['codex']);
  assert.throws(() => validateProviders({ providers: ['codex', 7] }));
});

test('validateProviders dedupes and keeps known providers in order', () => {
  assert.deepEqual(
    validateProviders({ providers: ['codex', 'codex', 'grok', 'antigravity', 'opencode'] }),
    ['codex', 'grok', 'antigravity', 'opencode'],
  );
});

test('CoalescedUsageReads: a provider being read is answered from that read', async () => {
  const batches: UsageProvider[][] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const reads = new CoalescedUsageReads(async (providers) => {
    batches.push(providers);
    await gate;
    return providers.map(
      (provider): ProviderUsage => ({
        provider,
        status: 'ok',
        windows: [],
        updatedAt: batches.length,
      }),
    );
  });
  const first = reads.read(['grok', 'codex']);
  const second = reads.read(['codex', 'claude']);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(batches, [['grok', 'codex'], ['claude']]);
  assert.deepEqual(
    a.map((u) => u.provider),
    ['grok', 'codex'],
  );
  assert.deepEqual(
    b.map((u) => u.provider),
    ['codex', 'claude'],
  );
  // Once answered, the next ask reads again.
  await reads.read(['codex']);
  assert.deepEqual(batches.at(-1), ['codex']);
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

test('agent/usageStats answers nothing for a provider it does not know', async () => {
  const router = new HandlerRouter(ctx());
  registerUsageHandlers(router);
  const resp = await router.dispatch(
    { jsonrpc: '2.0', id: 2, method: 'agent/usageStats', params: { providers: ['bogus'] } },
    session,
  );
  assert.deepEqual((resp as { result: { usage: unknown[] } }).result.usage, []);
});

test('usage/redeemReset says how Claude Code resets are used, and redeems none', async () => {
  const router = new HandlerRouter(ctx());
  registerUsageHandlers(router);
  const resp = await router.dispatch(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'usage/redeemReset',
      params: { provider: 'claude', idempotencyKey: 'k-1' },
    },
    session,
  );
  const error = (resp as { error?: { code: number; message: string } }).error;
  assert.equal(error?.code, -32602);
  assert.match(error?.message ?? '', /\/limit-reset/);
});
