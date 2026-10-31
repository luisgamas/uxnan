/**
 * Reads each AI provider's plan limits for `agent/usageStats` (architecture
 * 02a §5.8.10): the one reader every client asks — the phone and Uxnan
 * Desktop alike.
 *
 * Every provider is asked of its own CLI (`cli-usage.ts`): Claude Code, Codex,
 * Grok, Antigravity and OpenCode over their headless surfaces, Copilot through
 * GitHub's CLI (`gh api`). Each answers for the account it is signed in to,
 * from the sign-in it keeps, so the bridge reads no credential — no token
 * file, no keychain item, no OS permission prompt — and the same limits reach
 * every client on every OS. Never browser cookies, never a pasted key, never a
 * refresh token. Every provider is best-effort and isolated: a slow or failed
 * one degrades to its own `status` + `message` and never rejects the whole
 * call, and they are all read side by side, so one slow CLI does not hold the
 * others up.
 *
 * Every CLI is injectable so each provider's mapping is unit-tested against
 * canned answers with no process.
 */
import {
  askAntigravityUsage,
  askClaudeUsage,
  askCodexUsage,
  askCopilotUsage,
  askGrokUsage,
  askOpenCodeUsage,
  type AntigravityUsageAnswer,
  type ClaudeUsageAnswer,
  type CodexUsageAnswer,
  type CopilotUsageAnswer,
  type GrokUsageAnswer,
  type OpenCodeUsageAnswer,
} from './cli-usage.js';
import type {
  AccountType,
  CreditBalance,
  ProviderUsage,
  ResetCreditEntry,
  ResetCredits,
  UsageProvider,
  UsageStatus,
  UsageWindow,
} from '@uxnan/shared';

/** Injectable seams so the reader is testable without a CLI. */
export interface UsageReaderDeps {
  /** Clock in epoch ms (defaults to `Date.now`). */
  now?: () => number;
  /** Asks Claude Code for its account and limits. */
  askClaude?: () => Promise<ClaudeUsageAnswer | undefined>;
  /** Asks Codex for its account and limits. */
  askCodex?: () => Promise<CodexUsageAnswer | undefined>;
  /** Asks `gh` for the Copilot user record. */
  askCopilot?: () => Promise<CopilotUsageAnswer | undefined>;
  /** Asks Grok for its billing. */
  askGrok?: () => Promise<GrokUsageAnswer | undefined>;
  /** Asks Antigravity for its limits and AI credits. */
  askAntigravity?: () => Promise<AntigravityUsageAnswer | undefined>;
  /** Asks OpenCode for its Console workspace's limits. */
  askOpenCode?: () => Promise<OpenCodeUsageAnswer | undefined>;
}

type ResolvedDeps = Required<UsageReaderDeps>;

/** Reads usage for exactly [providers] — inactive providers cost nothing. */
export async function readUsage(
  providers: UsageProvider[],
  deps: UsageReaderDeps = {},
): Promise<ProviderUsage[]> {
  const resolved: ResolvedDeps = {
    now: deps.now ?? (() => Date.now()),
    askClaude: deps.askClaude ?? askClaudeUsage,
    askCodex: deps.askCodex ?? askCodexUsage,
    askCopilot: deps.askCopilot ?? askCopilotUsage,
    askGrok: deps.askGrok ?? askGrokUsage,
    askAntigravity: deps.askAntigravity ?? askAntigravityUsage,
    askOpenCode: deps.askOpenCode ?? askOpenCodeUsage,
  };
  // Side by side, answered in the order asked.
  return Promise.all(
    providers.map((provider) =>
      readOne(provider, resolved).catch((error: unknown) =>
        withMessage(base(provider, 'error', resolved.now()), String(error)),
      ),
    ),
  );
}

function readOne(provider: UsageProvider, deps: ResolvedDeps): Promise<ProviderUsage> {
  switch (provider) {
    case 'codex':
      return readCodex(deps);
    case 'claude':
      return readClaude(deps);
    case 'copilot':
      return readCopilot(deps);
    case 'grok':
      return readGrok(deps);
    case 'antigravity':
      return readAntigravity(deps);
    case 'opencode':
      return readOpenCode(deps);
  }
}

// ── Codex ────────────────────────────────────────────────────────────────────

async function readCodex(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askCodex();
  if (!answer) {
    return withMessage(base('codex', 'notInstalled', now), 'Codex is not installed on this PC');
  }
  const signedIn = asObj(answer.account);
  const plan = str(signedIn?.planType);
  const account = makeAccount({
    email: str(signedIn?.email),
    plan: plan ? codexPlanLabel(plan) : undefined,
    accountType: plan ? classifyPlan(codexPlanLabel(plan)) : undefined,
  });
  if (!signedIn) {
    return withMessage(base('codex', 'authRequired', now), 'Codex is not signed in on this PC');
  }
  if (signedIn.type !== 'chatgpt') {
    // An API key has no plan limits: usage is billed per token.
    return finish('codex', now, [], account, []);
  }
  const limits = asObj(answer.rateLimits);
  const byId = asObj(limits?.rateLimitsByLimitId);
  const main = asObj(byId?.codex) ?? asObj(limits?.rateLimits);
  const windows: UsageWindow[] = [];
  for (const key of ['primary', 'secondary'] as const) {
    const w = asObj(main?.[key]);
    const pct = num(w?.usedPercent);
    if (!w || pct === undefined) continue;
    const minutes = num(w.windowDurationMins);
    windows.push({
      id:
        key === 'primary' ? codexWindowId(minutes, 'primary') : codexWindowId(minutes, 'secondary'),
      label: labelForMinutes(minutes),
      usedPercent: clampPct(pct),
      ...spreadWindowMinutes(minutes),
      ...spreadResets(epochMs(w.resetsAt)),
    });
  }
  // A spend control on a workspace seat: how much of the member's own cap is left.
  const individual = asObj(main?.individualLimit);
  const remaining = num(individual?.remainingPercent);
  if (remaining !== undefined) {
    windows.push({
      id: 'individual',
      label: 'Spend limit',
      usedPercent: clampPct(100 - remaining),
      ...spreadResets(epochMs(individual?.resetsAt)),
    });
  }
  const credits = asObj(main?.credits);
  const balance = num(credits?.balance);
  const balances: CreditBalance[] =
    credits?.hasCredits === true && balance !== undefined
      ? [{ used: 0, available: balance, currency: 'credits', period: 'Credits' }]
      : [];
  const usage = finish('codex', now, windows, account, balances);
  const resets = asObj(limits?.rateLimitResetCredits);
  const entries = (Array.isArray(resets?.credits) ? resets.credits : [])
    .map((c) => asObj(c))
    .filter((c): c is Record<string, unknown> => !!c && c.status === 'available')
    .map((c) => ({
      ...(str(c.id) ? { id: str(c.id) } : {}),
      ...(str(c.title) ? { title: str(c.title) } : {}),
      ...spreadExpires(epochMs(c.expiresAt)),
    }))
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  const available = num(resets?.availableCount) ?? entries.length;
  if (available > 0) {
    usage.resetCredits = {
      available,
      ...(entries[0]?.expiresAt !== undefined ? { nextExpiresAt: entries[0].expiresAt } : {}),
      entries,
    };
  }
  return usage;
}

/** How Codex's `PlanType` slugs read; anything else is prettified as it comes. */
const CODEX_PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  team: 'Team',
  business: 'Business',
  self_serve_business_prolite: 'Business',
  self_serve_business_usage_based: 'Business',
  ent26: 'Enterprise',
  enterprise: 'Enterprise',
  enterprise_cbp_automation: 'Enterprise',
  enterprise_cbp_usage_based: 'Enterprise',
  edu: 'Edu',
  edu_plus: 'Edu Plus',
  edu_pro: 'Edu Pro',
};

function codexPlanLabel(plan: string): string {
  return CODEX_PLAN_LABELS[plan.toLowerCase()] ?? prettifyPlan(plan);
}

/** A Codex window's stable id from its length: the 5-hour and weekly ones by name. */
function codexWindowId(minutes: number | undefined, fallback: string): string {
  if (minutes === 300) return 'session5h';
  if (minutes === 10_080) return 'weekly';
  if (minutes !== undefined && minutes >= 40_000) return 'monthly';
  return fallback;
}

function spreadExpires(expiresAt: number | undefined): { expiresAt?: number } {
  return expiresAt === undefined ? {} : { expiresAt };
}

// ── Claude ───────────────────────────────────────────────────────────────────

async function readClaude(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askClaude();
  if (!answer) {
    return withMessage(
      base('claude', 'notInstalled', now),
      'Claude Code is not installed on this PC',
    );
  }
  const identity = answer.account;
  const plan = str(identity?.subscriptionType) ?? str(answer.usage?.subscription_type);
  const account = makeAccount({
    email: str(identity?.email),
    organization: str(identity?.organization),
    plan: plan ? prettifyPlan(plan) : undefined,
    accountType: plan ? classifyPlan(plan) : undefined,
  });
  const usage = answer.usage;
  if (!usage) {
    return withMessage(
      base('claude', 'authRequired', now),
      'Claude Code is not signed in on this PC',
    );
  }
  if (usage.rate_limits_available === false) {
    // An API key, Bedrock or Vertex: no plan limits apply.
    return finish('claude', now, [], account, []);
  }
  const body = asObj(usage.rate_limits) ?? {};

  const windows: UsageWindow[] = [];
  const limits = Array.isArray(body.limits) ? body.limits : [];
  limits.forEach((item, i) => {
    const w = asObj(item);
    if (!w) return;
    const pct = num(w.percent);
    if (pct === undefined) return;
    const kind = str(w.kind);
    const group = str(w.group);
    const model = str(asObj(asObj(w.scope)?.model)?.display_name);
    const windowMinutes = group === 'session' ? 300 : group === 'weekly' ? 10_080 : undefined;
    windows.push({
      id:
        kind === 'weekly_scoped' && model ? `weekly_${model.toLowerCase()}` : (kind ?? `limit${i}`),
      label: claudeLimitLabel(kind, group, model),
      ...(model ? { model } : {}),
      usedPercent: clampPct(pct),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      ...spreadResets(epochMs(w.resets_at)),
    });
  });
  if (windows.length === 0) {
    claudeWindow(windows, body.five_hour, 'five_hour', 'Session (5h)', 300);
    claudeWindow(windows, body.seven_day, 'seven_day', 'Weekly', 10_080);
  }

  const credit = claudeCredit(body);
  const usageOut = finish('claude', now, windows, account, credit ? [credit] : []);
  const resets = claudeResets(body.cedar_ember);
  if (resets) usageOut.resetCredits = resets;
  return usageOut;
}

/**
 * Claude Code's limit resets: `rate_limits.cedar_ember` of its `get_usage`
 * answer (`{eligible, grants[{id, label, resets_total, resets_left, ends_at,
 * paused, type}]}`, the shape the CLI itself parses). A grant counts while it
 * has resets left and is not paused. They are used inside Claude Code with
 * `/limit-reset` — its only way to spend one, an interactive command — so the
 * bridge reports them and how to use them, and redeems none itself.
 */
function claudeResets(value: unknown): ResetCredits | undefined {
  const status = asObj(value);
  if (!status || status.eligible === false) return undefined;
  const grants = (Array.isArray(status.grants) ? status.grants : [])
    .map((g) => asObj(g))
    .filter(
      (g): g is Record<string, unknown> =>
        !!g && (num(g.resets_left) ?? 0) > 0 && g.paused !== true,
    );
  const available = grants.reduce((sum, g) => sum + (num(g.resets_left) ?? 0), 0);
  if (available === 0) return undefined;
  const entries: ResetCreditEntry[] = grants
    .map((g) => ({
      ...(str(g.id) ? { id: str(g.id) } : {}),
      ...(str(g.label) || str(g.type) ? { title: str(g.label) ?? prettifyPlan(str(g.type)!) } : {}),
      ...spreadExpires(epochMs(g.ends_at)),
    }))
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  const total = grants.reduce((sum, g) => sum + (num(g.resets_total) ?? 0), 0);
  return {
    available,
    ...(total > 0 ? { totalEarned: total } : {}),
    ...(entries[0]?.expiresAt !== undefined ? { nextExpiresAt: entries[0].expiresAt } : {}),
    entries,
    redeemCommand: '/limit-reset',
  };
}

/**
 * Claude's usage credits (extra usage past the plan's limits), once they are
 * enabled. Amounts come in minor units: `spend` carries them as
 * `{amount_minor, currency, exponent}`, the older `extra_usage` as
 * `used_credits`/`monthly_limit` with `decimal_places` — 4000 at 2 decimal
 * places is $40.00, never $4,000.
 */
function claudeCredit(body: Record<string, unknown>): CreditBalance | undefined {
  const spend = asObj(body.spend);
  if (spend) {
    if (spend.enabled !== true) return undefined;
    const used = claudeMoney(spend.used);
    const limit = claudeMoney(spend.limit);
    const currency = used?.currency ?? limit?.currency ?? 'USD';
    return {
      used: used?.amount ?? 0,
      currency,
      period: 'Monthly credits',
      ...(limit ? { limit: limit.amount } : {}),
    };
  }
  const extra = asObj(body.extra_usage);
  if (!extra || extra.is_enabled !== true) return undefined;
  const scale = 10 ** (num(extra.decimal_places) ?? 2);
  const limit = num(extra.monthly_limit);
  return {
    used: (num(extra.used_credits) ?? 0) / scale,
    currency: str(extra.currency) ?? 'USD',
    period: 'Monthly credits',
    ...(limit !== undefined ? { limit: limit / scale } : {}),
  };
}

function claudeMoney(value: unknown): { amount: number; currency?: string } | undefined {
  const money = asObj(value);
  const minor = num(money?.amount_minor);
  if (!money || minor === undefined) return undefined;
  const currency = str(money.currency);
  return { amount: minor / 10 ** (num(money.exponent) ?? 2), ...(currency ? { currency } : {}) };
}

function claudeLimitLabel(
  kind: string | undefined,
  group: string | undefined,
  model: string | undefined,
): string {
  if (model) return `${model} (${group ?? kind ?? 'limit'})`;
  if (group === 'session') return 'Session (5h)';
  if (kind === 'weekly_all') return 'Weekly';
  if (kind === 'weekly_scoped') return 'Weekly (scoped)';
  return kind ? prettifyPlan(kind) : 'Usage';
}

function claudeWindow(
  windows: UsageWindow[],
  value: unknown,
  id: string,
  label: string,
  windowMinutes: number,
): void {
  const w = asObj(value);
  if (!w) return;
  let pct = num(w.utilization) ?? num(w.used);
  if (pct === undefined) return;
  if (pct <= 1) pct *= 100;
  windows.push({
    id,
    label,
    usedPercent: clampPct(pct),
    windowMinutes,
    ...spreadResets(epochMs(w.resets_at ?? w.resetsAt)),
  });
}

// ── Copilot ──────────────────────────────────────────────────────────────────

async function readCopilot(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askCopilot();
  if (!answer) {
    return withMessage(
      base('copilot', 'notInstalled', now),
      'GitHub CLI (`gh`) is not installed on this PC',
    );
  }
  if (answer.signedOut) {
    return withMessage(
      base('copilot', 'authRequired', now),
      'GitHub CLI is not signed in on this PC — run `gh auth login`',
    );
  }
  if (!answer.user) {
    return withMessage(base('copilot', 'error', now), answer.failure ?? 'no answer');
  }
  const body = answer.user;
  const plan = copilotPlan(str(body.copilot_plan), str(body.access_type_sku));
  const account = makeAccount({
    email: str(body.login),
    plan,
    accountType: plan ? classifyPlan(plan) : undefined,
  });
  const reset = epochMs(body.quota_reset_date_utc) ?? epochMs(body.quota_reset_date);

  const windows: UsageWindow[] = [];
  const snapshots = asObj(body.quota_snapshots);
  if (snapshots) {
    for (const [key, value] of Object.entries(snapshots)) {
      const w = asObj(value);
      if (!w || w.unlimited === true) continue;
      // A quota the plan does not include (`has_quota: false`, an entitlement
      // of 0 — premium requests on Copilot Free) is not "100% used": skip it.
      if (w.has_quota === false || num(w.entitlement) === 0) continue;
      const remaining = num(w.percent_remaining);
      if (remaining === undefined) continue;
      windows.push({
        id: key,
        label: COPILOT_QUOTA_LABELS[key] ?? prettifyPlan(key),
        usedPercent: clampPct(100 - remaining),
        windowMinutes: 43_200,
        ...spreadResets(reset),
      });
    }
  }
  return finish('copilot', now, windows, account, [], {
    empty: 'signed in, but no Copilot quota was returned for this account',
  });
}

/** How Copilot names its quotas; anything else is prettified as it comes. */
const COPILOT_QUOTA_LABELS: Record<string, string> = {
  chat: 'Chat',
  completions: 'Completions',
  premium_interactions: 'Premium requests',
};

/**
 * The Copilot plan. `copilot_plan` names the billing kind (`individual`,
 * `business`, `enterprise`) and is `individual` on Copilot Free too; only the
 * SKU tells Free apart (`free_limited_copilot`). Paid individual tiers are not
 * told apart by name, so none is claimed for them.
 */
function copilotPlan(plan: string | undefined, sku: string | undefined): string | undefined {
  if (sku && /free/i.test(sku)) return 'Copilot Free';
  return plan ? `Copilot ${prettifyPlan(plan)}` : undefined;
}

// ── Grok ─────────────────────────────────────────────────────────────────────

async function readGrok(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askGrok();
  if (!answer) {
    return withMessage(base('grok', 'notInstalled', now), 'Grok is not installed on this PC');
  }
  if (answer.error !== undefined) {
    return /auth|login|sign/i.test(answer.error)
      ? withMessage(
          base('grok', 'authRequired', now),
          'Grok is not signed in on this PC — run `grok login`',
        )
      : withMessage(base('grok', 'error', now), answer.error);
  }
  const body = answer.billing ?? {};
  const config = asObj(body.config) ?? body;

  const tier = str(body.subscription_tier ?? body.subscriptionTier);
  const plan = tier ? (GROK_TIER_LABELS[tier.toLowerCase()] ?? prettifyPlan(tier)) : undefined;
  const balances = grokBalances(config);
  // No plan but money on the account: it is billed by use.
  const accountType = plan ? classifyPlan(plan) : balances.length > 0 ? 'payAsYouGo' : undefined;
  const account = makeAccount({ plan, accountType });

  const windows: UsageWindow[] = [];
  const period = asObj(config.currentPeriod);
  const periodType = grokPeriodType(str(period?.type));
  // The billing answer is protobuf JSON, which leaves zero-valued numbers out:
  // a current period with no `creditUsagePercent` is a period with 0% used.
  const pct =
    num(config.creditUsagePercent ?? config.credit_usage_percent) ??
    (periodType && periodType !== 'UNSPECIFIED' ? 0 : undefined);
  if (pct !== undefined) {
    const resetsAt = epochMs(period?.end) ?? epochMs(config.billingPeriodEnd);
    windows.push({
      id: grokPeriodId(periodType),
      label: grokPeriodLabel(periodType),
      usedPercent: clampPct(pct),
      ...spreadWindowMinutes(grokPeriodMinutes(periodType)),
      ...spreadResets(resetsAt),
    });
  }
  return finish('grok', now, windows, account, balances, {
    empty: 'signed in, but Grok reported no quota window for this account',
  });
}

/** How xAI writes its own tiers; anything else is prettified as it comes. */
const GROK_TIER_LABELS: Record<string, string> = {
  free: 'Free',
  supergrok: 'SuperGrok',
  supergrok_lite: 'SuperGrok Lite',
  supergrok_plus: 'SuperGrok Plus',
  supergrok_heavy: 'SuperGrok Heavy',
  x_premium: 'X Premium',
  x_premium_plus: 'X Premium+',
};

/**
 * The money Grok reports, as `CreditBalance`s in USD. Its billing answer wraps
 * each amount as `{val}`: `onDemandUsed` of an `onDemandCap` (pay as you go,
 * for the billing period) and a `prepaidBalance`. The zero rule is the one
 * every provider follows — a balance is listed once the account has one
 * (Claude's usage credits once enabled, Codex's credits once it has them): the
 * on-demand spend when a cap is set or anything was spent, and the prepaid
 * balance when it is above zero — on-demand first, as what the account is
 * spending now. A free account answers all three as 0 and lists neither.
 */
function grokBalances(config: Record<string, unknown>): CreditBalance[] {
  const out: CreditBalance[] = [];
  const used = grokMoney(config.onDemandUsed ?? config.on_demand_used) ?? 0;
  const cap = grokMoney(config.onDemandCap ?? config.on_demand_cap) ?? 0;
  if (used > 0 || cap > 0) {
    out.push({
      used,
      currency: 'USD',
      period: 'On-demand',
      ...(cap > 0 ? { limit: cap, available: Math.max(0, cap - used) } : {}),
      ...spreadResets(epochMs(config.billingPeriodEnd)),
    });
  }
  const prepaid = grokMoney(config.prepaidBalance ?? config.prepaid_balance) ?? 0;
  if (prepaid > 0) out.push({ used: 0, available: prepaid, currency: 'USD', period: 'Prepaid' });
  return out;
}

/** An amount as Grok sends it: `{val}` (also a bare number, `{value}`, `{amount}`). */
function grokMoney(value: unknown): number | undefined {
  const wrapped = asObj(value);
  return wrapped ? num(wrapped.val ?? wrapped.value ?? wrapped.amount) : num(value);
}

/** `USAGE_PERIOD_TYPE_WEEKLY` and `WEEKLY` name the same period. */
function grokPeriodType(period: string | undefined): string | undefined {
  return period?.replace(/^USAGE_PERIOD_TYPE_/, '');
}

/** The window's id from its period (`daily`, `weekly`, `monthly`); `credits`
 *  for a period Grok does not name. */
function grokPeriodId(period: string | undefined): string {
  switch (period) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY':
      return 'weekly';
    case 'MONTHLY':
      return 'monthly';
    default:
      return 'credits';
  }
}

function grokPeriodLabel(period: string | undefined): string {
  switch (period) {
    case 'DAILY':
      return 'Daily';
    case 'WEEKLY':
      return 'Weekly';
    case 'MONTHLY':
      return 'Monthly';
    default:
      return 'Usage';
  }
}

function grokPeriodMinutes(period: string | undefined): number | undefined {
  switch (period) {
    case 'DAILY':
      return 1440;
    case 'WEEKLY':
      return 10_080;
    case 'MONTHLY':
      return 43_200;
    default:
      return undefined;
  }
}

// ── Antigravity ──────────────────────────────────────────────────────────────

async function readAntigravity(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askAntigravity();
  if (!answer) {
    return withMessage(
      base('antigravity', 'notInstalled', now),
      'Antigravity is not installed on this PC',
    );
  }
  if (!answer.usage) {
    const failure = answer.failure ?? { kind: 'error', message: 'no answer' };
    switch (failure.kind) {
      case 'signedOut':
        return withMessage(
          base('antigravity', 'authRequired', now),
          'Antigravity is not signed in on this PC — run `agy` to sign in',
        );
      case 'tooOld':
        return withMessage(
          base('antigravity', 'error', now),
          `Antigravity ${failure.version} cannot report its limits headless — update it (\`agy update\`)`,
        );
      case 'ranTurn':
        return withMessage(
          base('antigravity', 'error', now),
          'Antigravity answered the usage request with a model turn, so it is not asked again until the bridge restarts',
        );
      case 'error':
        return withMessage(base('antigravity', 'error', now), failure.message);
    }
  }
  const windows: UsageWindow[] = [];
  const groups = Array.isArray(answer.usage.groups) ? answer.usage.groups : [];
  for (const rawGroup of groups) {
    const group = asObj(rawGroup);
    const buckets = (Array.isArray(group?.buckets) ? group.buckets : [])
      .map((b) => asObj(b))
      .filter((b): b is Record<string, unknown> => !!b && b.disabled !== true);
    const groupName = str(group?.name);
    for (const bucket of buckets) {
      const remaining = num(bucket.remaining_fraction);
      if (remaining === undefined) continue;
      const bucketName = str(bucket.name);
      const minutes = antigravityWindowMinutes(str(bucket.window));
      windows.push({
        id: str(bucket.id) ?? `${groupName ?? 'bucket'}_${windows.length}`,
        label:
          buckets.length > 1 && bucketName
            ? `${groupName ?? 'Usage'} · ${bucketName}`
            : (groupName ?? bucketName ?? 'Usage'),
        usedPercent: clampPct((1 - Math.max(0, Math.min(1, remaining))) * 100),
        ...spreadWindowMinutes(minutes),
        ...spreadResets(epochMs(bucket.reset_time)),
      });
    }
  }
  // AI credits, once the account holds any (the zero rule every provider follows).
  const remainingCredits = num(answer.credits?.remaining_credits);
  const balances: CreditBalance[] =
    remainingCredits !== undefined && remainingCredits > 0
      ? [{ used: 0, available: remainingCredits, currency: 'credits', period: 'AI credits' }]
      : [];
  return finish('antigravity', now, windows, undefined, balances, {
    empty: 'signed in, but Antigravity reported no quota for this account',
  });
}

function antigravityWindowMinutes(window: string | undefined): number | undefined {
  switch (window) {
    case '5h':
      return 300;
    case 'daily':
      return 1440;
    case 'weekly':
      return 10_080;
    default:
      return undefined;
  }
}

// ── OpenCode ─────────────────────────────────────────────────────────────────

async function readOpenCode(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const answer = await deps.askOpenCode();
  if (!answer) {
    return withMessage(
      base('opencode', 'notInstalled', now),
      'OpenCode is not installed on this PC',
    );
  }
  if (answer.failure !== undefined) {
    return withMessage(base('opencode', 'error', now), answer.failure);
  }
  const data = answer.data;
  if (!data) {
    return withMessage(
      base('opencode', 'authRequired', now),
      'OpenCode is not signed in to an OpenCode Console workspace on this PC',
    );
  }
  const workspace = asObj(data.workspace);
  const go = asObj(data.go);
  const windows: UsageWindow[] = [];
  if (go) {
    for (const [key, id, label, minutes] of [
      ['rolling', 'session5h', 'Session (5h)', 300],
      ['weekly', 'weekly', 'Weekly', 10_080],
      ['monthly', 'monthly', 'Monthly', 43_200],
    ] as const) {
      const meter = asObj(go[key]);
      const pct = num(meter?.percent);
      if (!meter || pct === undefined) continue;
      windows.push({
        id,
        label,
        usedPercent: clampPct(pct),
        windowMinutes: minutes,
        ...spreadResets(epochMs(meter.resetsAt)),
      });
    }
  }
  const plan = go ? 'OpenCode Go' : undefined;
  const account = makeAccount({
    organization: str(workspace?.name),
    plan,
    accountType: plan ? 'subscription' : undefined,
  });
  return finish('opencode', now, windows, account, openCodeBudgets(data.budgets), {
    empty: 'signed in; this OpenCode Console workspace has no OpenCode Go plan or budget',
  });
}

/**
 * The workspace's Console budgets, each a `CreditBalance` in USD: the one that
 * covers everything the workspace spends (`scope: combined`, `coverage: all`)
 * first, then the rest in the order OpenCode lists them. A budget for some
 * models names them in `scope`.
 */
function openCodeBudgets(raw: unknown): CreditBalance[] {
  const budgets = (Array.isArray(raw) ? raw : [])
    .map((b) => asObj(b))
    .filter((b): b is Record<string, unknown> => !!b && num(b.limit) !== undefined);
  const whole = (b: Record<string, unknown>) => b.scope === 'combined' && b.coverage === 'all';
  return [...budgets.filter(whole), ...budgets.filter((b) => !whole(b))].map((budget) => {
    const limit = num(budget.limit) ?? 0;
    const used = num(budget.spent) ?? 0;
    const models = (Array.isArray(budget.models) ? budget.models : [])
      .map((m) => str(asObj(m)?.name))
      .filter((name): name is string => !!name);
    const scope = budget.coverage === 'models' && models.length > 0 ? models.join(', ') : undefined;
    return {
      used,
      limit,
      available: Math.max(0, limit - used),
      currency: 'USD',
      period: 'Budget',
      ...(scope ? { scope } : {}),
      ...spreadResets(epochMs(budget.resetsAt)),
    };
  });
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

/** Assembles the final `ok` usage, adding the "no windows" hint when empty. */
function finish(
  provider: UsageProvider,
  now: number,
  windows: UsageWindow[],
  account: ProviderUsage['account'],
  credits: CreditBalance[],
  hints: { empty?: string } = {},
): ProviderUsage {
  const usage: ProviderUsage = {
    provider,
    status: 'ok',
    source: 'cli',
    windows,
    updatedAt: now,
    ...(account ? { account } : {}),
    ...(credits.length > 0 ? { credits } : {}),
  };
  if (windows.length === 0 && credits.length === 0) {
    usage.message = hints.empty ?? 'signed in; no plan limits apply to this account';
  }
  return usage;
}

function base(provider: UsageProvider, status: UsageStatus, now: number): ProviderUsage {
  return { provider, status, windows: [], updatedAt: now };
}

function withMessage(usage: ProviderUsage, message: string): ProviderUsage {
  return { ...usage, message };
}

function makeAccount(fields: {
  email?: string;
  organization?: string;
  plan?: string;
  accountType?: AccountType;
}): ProviderUsage['account'] {
  const account: NonNullable<ProviderUsage['account']> = {};
  if (fields.email) account.email = fields.email;
  if (fields.organization) account.organization = fields.organization;
  if (fields.plan) account.plan = fields.plan;
  if (fields.accountType) account.accountType = fields.accountType;
  return account.email || account.organization || account.plan || account.accountType
    ? account
    : undefined;
}

/**
 * What kind of account a provider's plan slug names, by keyword: enterprise,
 * team (or business), free, and otherwise a paid subscription — the common
 * case for a CLI signed in with a personal plan. The same rule the desktop's
 * reader used before usage moved to the bridge.
 */
export function classifyPlan(slug: string): AccountType {
  const s = slug.toLowerCase();
  if (s.includes('enterprise')) return 'enterprise';
  if (s.includes('team') || s.includes('business')) return 'team';
  if (s.includes('free')) return 'free';
  return 'subscription';
}

function labelForMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return 'Usage';
  if (minutes <= 60) return `${minutes}m window`;
  if (minutes === 300) return 'Session (5h)';
  if (minutes === 1440) return 'Daily';
  if (minutes === 10_080) return 'Weekly';
  if (minutes === 43_200) return 'Monthly';
  return `${Math.round(minutes / 60)}h window`;
}

function prettifyPlan(value: string): string {
  return value
    .split(/[_\- ]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function epochMs(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
    return undefined;
  }
  if (typeof value === 'number' && value > 0) return value > 1e12 ? value : value * 1000;
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asObj(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function spreadResets(resetsAt: number | undefined): { resetsAt?: number } {
  return resetsAt !== undefined ? { resetsAt } : {};
}

function spreadWindowMinutes(windowMinutes: number | undefined): { windowMinutes?: number } {
  return windowMinutes !== undefined ? { windowMinutes } : {};
}
