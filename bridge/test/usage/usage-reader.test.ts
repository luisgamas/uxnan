import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUsage, type UsageReaderDeps } from '../../src/usage/usage-reader.js';

/** A minimal fetch Response the reader can consume (status / ok / json). */
function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/** A readFile that returns canned JSON by path suffix, else throws ENOENT. */
function fileMap(files: Record<string, unknown>): (path: string) => Promise<string> {
  return async (path) => {
    const norm = path.replace(/\\/g, '/');
    for (const [suffix, content] of Object.entries(files)) {
      if (norm.endsWith(suffix)) {
        return typeof content === 'string' ? content : JSON.stringify(content);
      }
    }
    throw new Error(`ENOENT: ${path}`);
  };
}

function deps(over: Partial<UsageReaderDeps> = {}): UsageReaderDeps {
  return {
    homeDir: '/home/dev',
    now: () => 1_700_000_000_000,
    readFile: async () => {
      throw new Error('ENOENT');
    },
    fetchImpl: async () => {
      throw new Error('no network in test');
    },
    ghAuthToken: async () => undefined,
    askClaude: async () => undefined,
    askCodex: async () => undefined,
    ...over,
  };
}

test('codex: its own answer — windows by length, plan, the resets it can redeem', async () => {
  const [u] = await readUsage(
    ['codex'],
    deps({
      askCodex: async () => ({
        account: { type: 'chatgpt', email: 'a@b.com', planType: 'pro' },
        rateLimits: {
          rateLimitsByLimitId: {
            codex: {
              primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_700_000_600 },
              secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: 1_700_300_000 },
              credits: { hasCredits: true, unlimited: false, balance: 250 },
            },
          },
          rateLimitResetCredits: {
            availableCount: 2,
            credits: [
              { id: 'r2', status: 'available', title: 'Full reset', expiresAt: 1_700_900_000 },
              { id: 'r1', status: 'available', title: 'Full reset', expiresAt: 1_700_500_000 },
              { id: 'r0', status: 'used', title: 'Full reset', expiresAt: 1_700_100_000 },
            ],
          },
        },
      }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.deepEqual(u?.account, { email: 'a@b.com', plan: 'Pro' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [
      ['session5h', 'Session (5h)', 40, 300, 1_700_000_600_000],
      ['weekly', 'Weekly', 12, 10_080, 1_700_300_000_000],
    ],
  );
  assert.equal(u?.credit?.available, 250);
  // Soonest-expiring first; a used one is not offered.
  assert.deepEqual(u?.resetCredits, {
    available: 2,
    nextExpiresAt: 1_700_500_000_000,
    entries: [
      { id: 'r1', title: 'Full reset', expiresAt: 1_700_500_000_000 },
      { id: 'r2', title: 'Full reset', expiresAt: 1_700_900_000_000 },
    ],
  });
});

test('codex: a single 30-day window is named `monthly`, whichever slot it arrives in', async () => {
  // What a real account on a monthly plan answers: one window, no second one.
  const [u] = await readUsage(
    ['codex'],
    deps({
      askCodex: async () => ({
        account: { type: 'chatgpt', email: 'a@b.com', planType: 'plus' },
        rateLimits: {
          rateLimitsByLimitId: {
            codex: {
              primary: { usedPercent: 7, windowDurationMins: 43_200, resetsAt: 1_702_000_000 },
              secondary: null,
            },
          },
        },
      }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [['monthly', 'Monthly', 7, 43_200, 1_702_000_000_000]],
  );
});

test('codex: not installed, not signed in, or on an API key (no plan limits)', async () => {
  const [missing] = await readUsage(['codex'], deps({ askCodex: async () => undefined }));
  assert.equal(missing?.status, 'notInstalled');
  const [signedOut] = await readUsage(['codex'], deps({ askCodex: async () => ({}) }));
  assert.equal(signedOut?.status, 'authRequired');
  const [apiKey] = await readUsage(
    ['codex'],
    deps({ askCodex: async () => ({ account: { type: 'apiKey' } }) }),
  );
  assert.equal(apiKey?.status, 'ok');
  assert.deepEqual(apiKey?.windows, []);
});

test('claude: its own answer — account from initialize, limits from get_usage', async () => {
  const [u] = await readUsage(
    ['claude'],
    deps({
      askClaude: async () => ({
        account: { email: 'me@x.io', organization: 'Acme', subscriptionType: 'Claude Max' },
        usage: {
          subscription_type: 'max',
          rate_limits_available: true,
          rate_limits: {
            limits: [
              { kind: 'session', group: 'session', percent: 57, resets_at: '2026-09-27T06:00:00Z' },
              {
                kind: 'weekly_all',
                group: 'weekly',
                percent: 16,
                resets_at: '2026-09-29T12:00:00Z',
              },
              {
                kind: 'weekly_scoped',
                group: 'weekly',
                percent: 0,
                resets_at: '2026-09-29T12:00:00Z',
                scope: { model: { display_name: 'Fable' } },
              },
            ],
            extra_usage: { is_enabled: false },
          },
        },
      }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.deepEqual(u?.account, { email: 'me@x.io', organization: 'Acme', plan: 'Claude Max' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes]),
    [
      ['session', 'Session (5h)', 57, 300],
      ['weekly_all', 'Weekly', 16, 10_080],
      ['weekly_fable', 'Fable (weekly)', 0, 10_080],
    ],
  );
  assert.equal(u?.windows[0]?.resetsAt, Date.parse('2026-09-27T06:00:00Z'));
});

test('claude: not installed, not signed in, or with no plan limits (API key)', async () => {
  const [missing] = await readUsage(['claude'], deps({ askClaude: async () => undefined }));
  assert.equal(missing?.status, 'notInstalled');
  const [signedOut] = await readUsage(['claude'], deps({ askClaude: async () => ({}) }));
  assert.equal(signedOut?.status, 'authRequired');
  const [apiKey] = await readUsage(
    ['claude'],
    deps({ askClaude: async () => ({ usage: { rate_limits_available: false } }) }),
  );
  assert.equal(apiKey?.status, 'ok');
  assert.deepEqual(apiKey?.windows, []);
});

test('grok picks the first keyed credential and maps a credit window', async () => {
  let sentAuth: string | undefined;
  const [u] = await readUsage(
    ['grok'],
    deps({
      readFile: fileMap({ '/.grok/auth.json': { 'issuer-x': { key: 'gk', email: 'g@x.ai' } } }),
      fetchImpl: async (_url, init) => {
        sentAuth = (init?.headers as Record<string, string>).authorization;
        return res(200, {
          config: {
            subscriptionTier: 'grok_heavy',
            creditUsagePercent: 73,
            currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', end: 1_700_100_000 },
          },
        });
      },
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.equal(sentAuth, 'Bearer gk');
  assert.equal(u?.account?.email, 'g@x.ai');
  assert.equal(u?.account?.plan, 'Grok Heavy');
  assert.equal(u?.windows[0]?.usedPercent, 73);
  assert.equal(u?.windows[0]?.label, 'Monthly');
  assert.equal(u?.windows[0]?.windowMinutes, 43_200);
});

test('one failing provider does not abort the others', async () => {
  const usage = await readUsage(
    ['codex', 'claude'],
    deps({
      askCodex: async () => {
        throw new Error('the CLI did not answer in time');
      },
      askClaude: async () => ({ usage: { rate_limits: { limits: [] } } }),
    }),
  );
  assert.equal(usage.length, 2);
  assert.equal(usage[0]?.provider, 'codex');
  assert.equal(usage[0]?.status, 'error');
  assert.equal(usage[1]?.provider, 'claude');
  assert.equal(usage[1]?.status, 'ok');
});
