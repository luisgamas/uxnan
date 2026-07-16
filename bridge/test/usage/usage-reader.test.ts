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
    ...over,
  };
}

test('codex maps rate windows, credit and plan', async () => {
  const [u] = await readUsage(
    ['codex'],
    deps({
      readFile: fileMap({
        '/.codex/auth.json': { tokens: { access_token: 'tok', account_id: 'acc' } },
      }),
      fetchImpl: async (url, init) => {
        assert.match(String(url), /wham\/usage/);
        assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tok');
        assert.equal((init?.headers as Record<string, string>)['ChatGPT-Account-Id'], 'acc');
        return res(200, {
          plan_type: 'chatgpt_pro',
          email: 'a@b.com',
          rate_limit: {
            primary_window: {
              used_percent: 0.4,
              limit_window_seconds: 18_000,
              reset_at: 1_700_000_600,
            },
          },
          credits: { balance: 12.5, currency: 'USD' },
        });
      },
    }),
  );
  assert.equal(u?.provider, 'codex');
  assert.equal(u?.status, 'ok');
  assert.equal(u?.source, 'token');
  assert.equal(u?.account?.plan, 'Chatgpt Pro');
  assert.equal(u?.account?.email, 'a@b.com');
  assert.equal(u?.windows.length, 1);
  assert.equal(u?.windows[0]?.usedPercent, 40);
  assert.equal(u?.windows[0]?.windowMinutes, 300);
  assert.equal(u?.windows[0]?.label, 'Session (5h)');
  assert.equal(u?.credit?.used, 12.5);
  assert.equal(u?.updatedAt, 1_700_000_000_000);
});

test('codex is notInstalled when auth.json is missing', async () => {
  const [u] = await readUsage(['codex'], deps());
  assert.equal(u?.status, 'notInstalled');
  assert.match(u?.message ?? '', /not set up/);
});

test('codex requires auth when the token is absent', async () => {
  const [u] = await readUsage(
    ['codex'],
    deps({ readFile: fileMap({ '/.codex/auth.json': { tokens: {} } }) }),
  );
  assert.equal(u?.status, 'authRequired');
});

test('a 401 from the usage API maps to authRequired (keeping the account)', async () => {
  const [u] = await readUsage(
    ['claude'],
    deps({
      readFile: fileMap({
        '/.claude/.credentials.json': {
          claudeAiOauth: { accessToken: 'tok', subscriptionType: 'max' },
        },
      }),
      fetchImpl: async () => res(401, {}),
    }),
  );
  assert.equal(u?.status, 'authRequired');
  assert.equal(u?.account?.plan, 'Max');
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
      readFile: fileMap({
        '/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'tok' } },
      }),
      fetchImpl: async () => res(200, { limits: [] }),
    }),
  );
  assert.equal(usage.length, 2);
  assert.equal(usage[0]?.provider, 'codex');
  assert.equal(usage[0]?.status, 'notInstalled');
  assert.equal(usage[1]?.provider, 'claude');
  assert.equal(usage[1]?.status, 'ok');
});
