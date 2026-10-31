import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlan, readUsage, type UsageReaderDeps } from '../../src/usage/usage-reader.js';

function deps(over: Partial<UsageReaderDeps> = {}): UsageReaderDeps {
  return {
    now: () => 1_700_000_000_000,
    askClaude: async () => undefined,
    askCodex: async () => undefined,
    askCopilot: async () => undefined,
    askGrok: async () => undefined,
    askAntigravity: async () => undefined,
    askOpenCode: async () => undefined,
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
  assert.deepEqual(u?.account, { email: 'a@b.com', plan: 'Pro', accountType: 'subscription' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [
      ['session5h', 'Session (5h)', 40, 300, 1_700_000_600_000],
      ['weekly', 'Weekly', 12, 10_080, 1_700_300_000_000],
    ],
  );
  assert.equal(u?.credits?.[0]?.available, 250);
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
  assert.deepEqual(u?.account, {
    email: 'me@x.io',
    organization: 'Acme',
    plan: 'Claude Max',
    accountType: 'subscription',
  });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes]),
    [
      ['session', 'Session (5h)', 57, 300],
      ['weekly_all', 'Weekly', 16, 10_080],
      ['weekly_fable', 'Fable (weekly)', 0, 10_080],
    ],
  );
  // The scoped window names its model, so each client writes its own label.
  assert.deepEqual(
    u?.windows.map((w) => w.model),
    [undefined, undefined, 'Fable'],
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

/** `_x.ai/billing` over `grok agent stdio`, shaped like Grok 1.0.70's real answer. */
function grokBilling(
  over: Record<string, unknown> = {},
  tier: string | null = 'Free',
): Record<string, unknown> {
  return {
    config: {
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_WEEKLY',
        start: '2026-10-29T00:00:00+00:00',
        end: '2026-11-05T00:00:00+00:00',
      },
      onDemandCap: { val: 0 },
      onDemandUsed: { val: 0 },
      prepaidBalance: { val: 0 },
      isUnifiedBillingUser: true,
      billingPeriodStart: '2026-10-29T00:00:00+00:00',
      billingPeriodEnd: '2026-11-05T00:00:00+00:00',
      ...over,
    },
    ...(tier === null ? {} : { subscription_tier: tier }),
  };
}

test('grok: a free account — the weekly window at 0% (protobuf leaves zeros out), plan Free', async () => {
  const [u] = await readUsage(
    ['grok'],
    deps({ askGrok: async () => ({ billing: grokBilling() }) }),
  );
  assert.equal(u?.status, 'ok');
  assert.equal(u?.source, 'cli');
  assert.deepEqual(u?.account, { plan: 'Free', accountType: 'free' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [['weekly', 'Weekly', 0, 10_080, Date.parse('2026-11-05T00:00:00+00:00')]],
  );
  assert.equal(u?.credits, undefined);
  assert.equal(u?.message, undefined);
});

test('grok: a paid account — the credit window, on-demand spend of its cap, the tier', async () => {
  const [u] = await readUsage(
    ['grok'],
    deps({
      askGrok: async () => ({
        billing: grokBilling(
          {
            creditUsagePercent: 73,
            currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', end: 1_700_100_000 },
            onDemandCap: { val: 20 },
            onDemandUsed: { val: 4.5 },
            prepaidBalance: { val: 10 },
          },
          'supergrok_heavy',
        ),
      }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.equal(u?.account?.plan, 'SuperGrok Heavy');
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [['monthly', 'Monthly', 73, 43_200, 1_700_100_000_000]],
  );
  // Both balances, on-demand (what it is spending now) first.
  assert.deepEqual(u?.credits, [
    {
      used: 4.5,
      limit: 20,
      available: 15.5,
      currency: 'USD',
      period: 'On-demand',
      resetsAt: Date.parse('2026-11-05T00:00:00+00:00'),
    },
    { used: 0, available: 10, currency: 'USD', period: 'Prepaid' },
  ]);
});

test('grok: a prepaid balance with no tier is billed by use', async () => {
  const [u] = await readUsage(
    ['grok'],
    deps({
      askGrok: async () => ({ billing: grokBilling({ prepaidBalance: { val: 25 } }, null) }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.deepEqual(u?.account, { accountType: 'payAsYouGo' });
  assert.deepEqual(u?.credits, [{ used: 0, available: 25, currency: 'USD', period: 'Prepaid' }]);
});

test('grok: not installed, signed out, or any other refusal', async () => {
  const [missing] = await readUsage(['grok'], deps());
  assert.equal(missing?.status, 'notInstalled');
  const [signedOut] = await readUsage(
    ['grok'],
    deps({
      askGrok: async () => ({
        error: 'Billing data requires auth with grok.com. Run `grok login` to authenticate.',
      }),
    }),
  );
  assert.equal(signedOut?.status, 'authRequired');
  const [refused] = await readUsage(
    ['grok'],
    deps({ askGrok: async () => ({ error: 'Billing service error: 503' }) }),
  );
  assert.equal(refused?.status, 'error');
  assert.equal(refused?.message, 'Billing service error: 503');
});

/** `gh api /copilot_internal/user` for a Copilot Free account, as GitHub answers it. */
function copilotFree(): Record<string, unknown> {
  const snapshot = (id: string, entitlement: number, remaining: number) => ({
    overage_count: 0,
    overage_permitted: false,
    percent_remaining: entitlement === 0 ? 0 : (remaining / entitlement) * 100,
    quota_id: id,
    quota_remaining: remaining,
    unlimited: false,
    has_quota: entitlement > 0,
    remaining,
    entitlement,
  });
  return {
    login: 'octo',
    copilot_plan: 'individual',
    access_type_sku: 'free_limited_copilot',
    quota_reset_date: '2026-11-01',
    quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
    quota_snapshots: {
      chat: snapshot('chat', 200, 150),
      completions: snapshot('completions', 2000, 2000),
      premium_interactions: snapshot('premium_interactions', 0, 0),
    },
  };
}

test('copilot: a free account — its quotas, the one it does not include skipped', async () => {
  const [u] = await readUsage(
    ['copilot'],
    deps({ askCopilot: async () => ({ user: copilotFree() }) }),
  );
  assert.equal(u?.status, 'ok');
  assert.equal(u?.source, 'cli');
  assert.deepEqual(u?.account, { email: 'octo', plan: 'Copilot Free', accountType: 'free' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.resetsAt]),
    [
      ['chat', 'Chat', 25, Date.parse('2026-11-01T00:00:00.000Z')],
      ['completions', 'Completions', 0, Date.parse('2026-11-01T00:00:00.000Z')],
    ],
  );
});

test('copilot: gh missing, signed out, or no Copilot on the account', async () => {
  const [missing] = await readUsage(['copilot'], deps());
  assert.equal(missing?.status, 'notInstalled');
  const [signedOut] = await readUsage(
    ['copilot'],
    deps({ askCopilot: async () => ({ signedOut: true }) }),
  );
  assert.equal(signedOut?.status, 'authRequired');
  const [none] = await readUsage(
    ['copilot'],
    deps({ askCopilot: async () => ({ failure: 'this GitHub account has no Copilot access' }) }),
  );
  assert.equal(none?.status, 'error');
});

/** `agy -p /usage --output-format json`'s `command.data`, as agy 1.4.12 answers. */
const AGY_USAGE = {
  description: 'Within each group, models share a weekly limit.',
  groups: [
    {
      name: 'Gemini Models',
      buckets: [
        {
          id: 'gemini-weekly',
          name: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining_fraction: 0.91,
          reset_time: '2026-11-06T05:10:52Z',
        },
      ],
    },
    {
      name: 'Claude and GPT models',
      buckets: [
        {
          id: '3p-weekly',
          name: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining_fraction: 1,
          reset_time: '2026-11-06T18:28:02Z',
        },
        { id: '3p-off', name: 'Unmetered', window: '5h', remaining_fraction: 1, disabled: true },
      ],
    },
  ],
};

test('antigravity: one window per bucket (used = 1 − remaining), credits once it has any', async () => {
  const [u] = await readUsage(
    ['antigravity'],
    deps({
      askAntigravity: async () => ({ usage: AGY_USAGE, credits: { remaining_credits: 120 } }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.equal(u?.source, 'cli');
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, Math.round(w.usedPercent), w.windowMinutes, w.resetsAt]),
    [
      ['gemini-weekly', 'Gemini Models', 9, 10_080, Date.parse('2026-11-06T05:10:52Z')],
      ['3p-weekly', 'Claude and GPT models', 0, 10_080, Date.parse('2026-11-06T18:28:02Z')],
    ],
  );
  assert.deepEqual(u?.credits?.[0], {
    used: 0,
    available: 120,
    currency: 'credits',
    period: 'AI credits',
  });
  const [none] = await readUsage(
    ['antigravity'],
    deps({ askAntigravity: async () => ({ usage: AGY_USAGE, credits: { remaining_credits: 0 } }) }),
  );
  assert.equal(none?.credits, undefined);
});

test('antigravity: not installed, signed out, too old, or it ran a turn', async () => {
  const [missing] = await readUsage(['antigravity'], deps());
  assert.equal(missing?.status, 'notInstalled');
  const ask = (
    failure: NonNullable<
      Awaited<ReturnType<NonNullable<UsageReaderDeps['askAntigravity']>>>
    >['failure'],
  ) => readUsage(['antigravity'], deps({ askAntigravity: async () => ({ failure }) }));
  assert.equal((await ask({ kind: 'signedOut' }))[0]?.status, 'authRequired');
  const [old] = await ask({ kind: 'tooOld', version: '1.1.9' });
  assert.equal(old?.status, 'error');
  assert.match(old?.message ?? '', /1\.1\.9/);
  const [turn] = await ask({ kind: 'ranTurn' });
  assert.equal(turn?.status, 'error');
  assert.match(turn?.message ?? '', /not asked again/);
});

test('opencode: Go meters, the combined Console budget, the workspace', async () => {
  const [u] = await readUsage(
    ['opencode'],
    deps({
      askOpenCode: async () => ({
        data: {
          workspace: { id: 'wrk_1', name: 'Default', usageURL: 'https://opencode.ai/console/x' },
          go: {
            rolling: { percent: 30, limited: false, resetsAt: 1_700_010_000_000 },
            weekly: { percent: 12, limited: false, resetsAt: 1_700_300_000_000 },
            monthly: { percent: 5, limited: false, resetsAt: 1_702_000_000_000 },
          },
          budgets: [
            {
              id: 'b-model',
              limit: 5,
              spent: 1,
              scope: 'each',
              per: 'model',
              coverage: 'models',
              models: [
                { providerID: 'opencode', modelID: 'm-1', name: 'Model One' },
                { providerID: 'opencode', modelID: 'm-2', name: 'Model Two' },
              ],
              vendors: [],
              picked: true,
              shared: false,
              resetsAt: 1,
            },
            {
              id: 'b-all',
              limit: 50,
              spent: 12.5,
              scope: 'combined',
              per: 'set',
              coverage: 'all',
              models: [],
              vendors: [],
              picked: true,
              shared: true,
              resetsAt: 1_702_000_000_000,
            },
          ],
        },
      }),
    }),
  );
  assert.equal(u?.status, 'ok');
  assert.deepEqual(u?.account, {
    organization: 'Default',
    plan: 'OpenCode Go',
    accountType: 'subscription',
  });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.usedPercent, w.windowMinutes, w.resetsAt]),
    [
      ['session5h', 30, 300, 1_700_010_000_000],
      ['weekly', 12, 10_080, 1_700_300_000_000],
      ['monthly', 5, 43_200, 1_702_000_000_000],
    ],
  );
  // The whole-workspace budget first, then the per-model one naming its models.
  assert.deepEqual(u?.credits, [
    {
      used: 12.5,
      limit: 50,
      available: 37.5,
      currency: 'USD',
      period: 'Budget',
      resetsAt: 1_702_000_000_000,
    },
    {
      used: 1,
      limit: 5,
      available: 4,
      currency: 'USD',
      period: 'Budget',
      scope: 'Model One, Model Two',
      resetsAt: 1_000,
    },
  ]);
});

test('opencode: signed out (no workspace), a workspace with nothing to meter, a failure', async () => {
  const [missing] = await readUsage(['opencode'], deps());
  assert.equal(missing?.status, 'notInstalled');
  const [signedOut] = await readUsage(
    ['opencode'],
    deps({ askOpenCode: async () => ({ data: null }) }),
  );
  assert.equal(signedOut?.status, 'authRequired');
  const [empty] = await readUsage(
    ['opencode'],
    deps({
      askOpenCode: async () => ({
        data: { workspace: { id: 'w', name: 'Default', usageURL: 'u' }, budgets: [] },
      }),
    }),
  );
  assert.equal(empty?.status, 'ok');
  assert.deepEqual(empty?.windows, []);
  assert.match(empty?.message ?? '', /no OpenCode Go plan or budget/);
  const [failed] = await readUsage(
    ['opencode'],
    deps({ askOpenCode: async () => ({ failure: 'OpenCode did not answer in time' }) }),
  );
  assert.equal(failed?.status, 'error');
});

test('claude: usage credits come in minor units — 4000 at 2 places is $40, never $4,000', async () => {
  const limits = { limits: [] };
  const [spend] = await readUsage(
    ['claude'],
    deps({
      askClaude: async () => ({
        usage: {
          rate_limits: {
            ...limits,
            spend: {
              enabled: true,
              used: { amount_minor: 1250, currency: 'USD', exponent: 2 },
              limit: { amount_minor: 4000, currency: 'USD', exponent: 2 },
            },
          },
        },
      }),
    }),
  );
  assert.deepEqual(spend?.credits?.[0], {
    used: 12.5,
    limit: 40,
    currency: 'USD',
    period: 'Monthly credits',
  });
  const [legacy] = await readUsage(
    ['claude'],
    deps({
      askClaude: async () => ({
        usage: {
          rate_limits: {
            ...limits,
            extra_usage: {
              is_enabled: true,
              monthly_limit: 4000,
              used_credits: 500,
              currency: 'USD',
              decimal_places: 2,
            },
          },
        },
      }),
    }),
  );
  assert.deepEqual(legacy?.credits?.[0], {
    used: 5,
    limit: 40,
    currency: 'USD',
    period: 'Monthly credits',
  });
  const [off] = await readUsage(
    ['claude'],
    deps({
      askClaude: async () => ({
        usage: {
          rate_limits: {
            ...limits,
            spend: { enabled: false },
            extra_usage: { is_enabled: true, monthly_limit: 4000 },
          },
        },
      }),
    }),
  );
  assert.equal(off?.credits, undefined);
});

test('codex: a seat spend limit is a window; plan slugs read as Codex names them', async () => {
  const [u] = await readUsage(
    ['codex'],
    deps({
      askCodex: async () => ({
        account: { type: 'chatgpt', email: 'a@b.com', planType: 'ent26' },
        rateLimits: {
          rateLimits: {
            primary: { usedPercent: 3, windowDurationMins: 300 },
            individualLimit: {
              limit: '100',
              used: '40',
              remainingPercent: 60,
              resetsAt: 1_702_000_000,
            },
          },
        },
      }),
    }),
  );
  assert.deepEqual(u?.account, { email: 'a@b.com', plan: 'Enterprise', accountType: 'enterprise' });
  assert.deepEqual(
    u?.windows.map((w) => [w.id, w.label, w.usedPercent, w.resetsAt]),
    [
      ['session5h', 'Session (5h)', 3, undefined],
      ['individual', 'Spend limit', 40, 1_702_000_000_000],
    ],
  );
});

test('every provider is read side by side, answered in the order asked', async () => {
  let running = 0;
  let most = 0;
  const slow =
    <T>(value: T) =>
    async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return value;
    };
  const usage = await readUsage(
    ['opencode', 'grok', 'copilot'],
    deps({
      askOpenCode: slow({ data: null }),
      askGrok: slow({ billing: grokBilling() }),
      askCopilot: slow({ user: copilotFree() }),
    }),
  );
  assert.deepEqual(
    usage.map((u) => u.provider),
    ['opencode', 'grok', 'copilot'],
  );
  assert.equal(most, 3);
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

// The account type the desktop shows as a badge, from each provider's plan slug.
test('classifyPlan reads the account type from a plan slug', () => {
  assert.equal(classifyPlan('chatgpt_pro'), 'subscription');
  assert.equal(classifyPlan('max'), 'subscription');
  assert.equal(classifyPlan('free'), 'free');
  assert.equal(classifyPlan('Free'), 'free');
  assert.equal(classifyPlan('business'), 'team');
  assert.equal(classifyPlan('team'), 'team');
  assert.equal(classifyPlan('Enterprise'), 'enterprise');
  assert.equal(classifyPlan('SuperGrok Heavy'), 'subscription');
});

test('claude: its limit resets — listed from get_usage, used only through /limit-reset', async () => {
  const [u] = await readUsage(
    ['claude'],
    deps({
      askClaude: async () => ({
        usage: {
          rate_limits: {
            limits: [],
            // The status block's shape as Claude Code 2.1.312 parses it.
            cedar_ember: {
              eligible: true,
              grants: [
                {
                  id: 'g-late',
                  label: 'Full reset',
                  resets_total: 2,
                  resets_left: 1,
                  ends_at: '2026-11-20T00:00:00Z',
                  paused: false,
                  usable_now: true,
                },
                {
                  id: 'g-soon',
                  label: '',
                  type: 'session',
                  resets_total: 1,
                  resets_left: 1,
                  ends_at: '2026-11-05T00:00:00Z',
                  paused: false,
                  usable_now: false,
                },
                { id: 'g-paused', label: 'Paused', resets_total: 1, resets_left: 1, paused: true },
                { id: 'g-spent', label: 'Spent', resets_total: 1, resets_left: 0 },
              ],
              next_grant_id: 'g-late',
            },
          },
        },
      }),
    }),
  );
  assert.deepEqual(u?.resetCredits, {
    available: 2,
    totalEarned: 3,
    nextExpiresAt: Date.parse('2026-11-05T00:00:00Z'),
    entries: [
      { id: 'g-soon', title: 'Session', expiresAt: Date.parse('2026-11-05T00:00:00Z') },
      { id: 'g-late', title: 'Full reset', expiresAt: Date.parse('2026-11-20T00:00:00Z') },
    ],
    redeemCommand: '/limit-reset',
  });
  // None held, or the account not eligible: nothing to list.
  for (const cedar of [null, { eligible: false, grants: [] }, { eligible: true, grants: [] }]) {
    const [none] = await readUsage(
      ['claude'],
      deps({
        askClaude: async () => ({ usage: { rate_limits: { limits: [], cedar_ember: cedar } } }),
      }),
    );
    assert.equal(none?.resetCredits, undefined);
  }
});
