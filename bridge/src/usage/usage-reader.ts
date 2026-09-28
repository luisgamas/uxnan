/**
 * Reads each AI provider's plan limits for `agent/usageStats` (architecture
 * 02a §5.8.10): the one reader every client asks — the phone and Uxnan
 * Desktop alike.
 *
 * Claude Code and Codex are asked themselves (`cli-usage.ts`): each CLI
 * answers for the account it is signed in to, from the sign-in it keeps, so
 * the bridge reads no credential and needs no OS permission — Claude's limits
 * reach every client on macOS too. Copilot and Grok have no such surface; for
 * them only the token each CLI itself stored is read (`gh auth token`,
 * `~/.grok/auth.json`) → the provider's official usage API. Never browser
 * cookies, never a pasted key, never a refresh token. Every provider is
 * best-effort and isolated: a slow or failed one degrades to its own
 * `status` + `message` and never rejects the whole call.
 *
 * All I/O is injectable so each provider's mapping is unit-tested against
 * canned answers with no process, disk or network.
 */
import { execFile } from 'node:child_process';
import { readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  askClaudeUsage,
  askCodexUsage,
  type ClaudeUsageAnswer,
  type CodexUsageAnswer,
} from './cli-usage.js';
import type {
  AccountType,
  CreditBalance,
  ProviderUsage,
  UsageProvider,
  UsageStatus,
  UsageWindow,
} from '@uxnan/shared';

const execFileAsync = promisify(execFile);

/** Per-request timeout, matching the desktop reader's 15 s. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Injectable seams so the reader is testable without disk/network. */
export interface UsageReaderDeps {
  /** Home directory (defaults to the OS home). */
  homeDir?: string;
  /** Reads a file to a string (defaults to fs `readFile` utf8). */
  readFile?: (path: string) => Promise<string>;
  /** Outbound fetch (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Clock in epoch ms (defaults to `Date.now`). */
  now?: () => number;
  /** Reads the GitHub token via `gh auth token` (Copilot). */
  ghAuthToken?: () => Promise<string | undefined>;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Asks Claude Code for its account and limits (`cli-usage.ts`). */
  askClaude?: () => Promise<ClaudeUsageAnswer | undefined>;
  /** Asks Codex for its account and limits (`cli-usage.ts`). */
  askCodex?: () => Promise<CodexUsageAnswer | undefined>;
}

interface ResolvedDeps {
  homeDir: string;
  readFile: (path: string) => Promise<string>;
  fetchImpl: typeof fetch;
  now: () => number;
  ghAuthToken: () => Promise<string | undefined>;
  timeoutMs: number;
  askClaude: () => Promise<ClaudeUsageAnswer | undefined>;
  askCodex: () => Promise<CodexUsageAnswer | undefined>;
}

/** Reads usage for exactly [providers] — inactive providers cost nothing. */
export async function readUsage(
  providers: UsageProvider[],
  deps: UsageReaderDeps = {},
): Promise<ProviderUsage[]> {
  const resolved: ResolvedDeps = {
    homeDir: deps.homeDir ?? homedir(),
    readFile: deps.readFile ?? ((p) => fsReadFile(p, 'utf8')),
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? (() => Date.now()),
    ghAuthToken: deps.ghAuthToken ?? defaultGhAuthToken,
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    askClaude: deps.askClaude ?? askClaudeUsage,
    askCodex: deps.askCodex ?? askCodexUsage,
  };
  const out: ProviderUsage[] = [];
  for (const provider of providers) {
    try {
      out.push(await readOne(provider, resolved));
    } catch (error) {
      out.push(withMessage(base(provider, 'error', resolved.now()), String(error)));
    }
  }
  return out;
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
    plan: plan ? prettifyPlan(plan) : undefined,
    accountType: plan ? classifyPlan(plan) : undefined,
  });
  if (!signedIn) {
    return withMessage(base('codex', 'authRequired', now), 'Codex is not signed in on this PC');
  }
  if (signedIn.type !== 'chatgpt') {
    // An API key has no plan limits: usage is billed per token.
    return finish('codex', now, [], account, undefined);
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
  const credits = asObj(main?.credits);
  const balance = num(credits?.balance);
  const credit: CreditBalance | undefined =
    credits?.hasCredits === true && balance !== undefined
      ? { used: 0, available: balance, currency: 'credits', period: 'Credits' }
      : undefined;
  const usage = finish('codex', now, windows, account, credit);
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
    return finish('claude', now, [], account, undefined);
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
      usedPercent: clampPct(pct),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      ...spreadResets(epochMs(w.resets_at)),
    });
  });
  if (windows.length === 0) {
    claudeWindow(windows, body.five_hour, 'five_hour', 'Session (5h)', 300);
    claudeWindow(windows, body.seven_day, 'seven_day', 'Weekly', 10_080);
  }

  let credit: CreditBalance | undefined;
  const extra = asObj(body.extra_usage);
  if (extra && extra.is_enabled === true) {
    const used = num(extra.used_credits) ?? 0;
    const limit = num(extra.monthly_limit);
    const currency = str(extra.currency) ?? 'USD';
    credit = {
      used,
      currency,
      period: 'Monthly credits',
      ...(limit !== undefined ? { limit } : {}),
    };
  }
  return finish('claude', now, windows, account, credit);
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
  const token = await deps.ghAuthToken();
  if (!token) {
    return withMessage(
      base('copilot', 'authRequired', now),
      'no GitHub token from `gh auth token` — run `gh auth login`',
    );
  }
  const res = await fetchJson(
    {
      url: 'https://api.github.com/copilot_internal/user',
      headers: {
        authorization: `token ${token}`,
        'editor-version': 'uxnan/1.0',
        'editor-plugin-version': 'uxnan/1.0',
        'x-github-api-version': '2025-04-01',
        accept: 'application/json',
      },
    },
    deps,
  );
  if (!res.ok) return httpError('copilot', res, now);
  const body = asObj(res.body) ?? {};

  const plan = str(body.copilot_plan);
  const login = await githubLogin(token, deps);
  const account = makeAccount({
    email: login,
    plan: plan ? prettifyPlan(plan) : undefined,
    accountType: plan ? classifyPlan(plan) : undefined,
  });
  const reset = epochMs(body.quota_reset_date);

  const windows: UsageWindow[] = [];
  const snapshots = asObj(body.quota_snapshots);
  if (snapshots) {
    for (const [key, value] of Object.entries(snapshots)) {
      const w = asObj(value);
      if (!w || w.unlimited === true) continue;
      const remaining = num(w.percent_remaining) ?? 0;
      windows.push({
        id: key,
        label: prettifyPlan(key),
        usedPercent: clampPct(100 - remaining),
        ...spreadResets(reset),
      });
    }
  }
  return finish('copilot', now, windows, account, undefined, {
    empty: 'signed in, but no Copilot quota was returned for this account',
  });
}

async function githubLogin(token: string, deps: ResolvedDeps): Promise<string | undefined> {
  const res = await fetchJson(
    {
      url: 'https://api.github.com/user',
      headers: {
        authorization: `token ${token}`,
        accept: 'application/json',
        'x-github-api-version': '2022-11-28',
      },
    },
    deps,
  );
  return res.ok ? str(asObj(res.body)?.login) : undefined;
}

// ── Grok ─────────────────────────────────────────────────────────────────────

/** Grok's CLI API: `/billing?format=credits` and `/user?include=subscription`. */
const GROK_API = 'https://cli-chat-proxy.grok.com/v1';

/** The plan is a label: never let its request hold the whole read up. */
const GROK_USER_TIMEOUT_MS = 5_000;

async function readGrok(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const auth = await readJson(join(deps.homeDir, '.grok', 'auth.json'), deps);
  if (!auth) {
    return withMessage(
      base('grok', 'notInstalled', now),
      'Grok is not set up on this PC (~/.grok/auth.json missing)',
    );
  }
  // auth is keyed by issuer/client; pick the first entry with a string `.key`.
  let token: string | undefined;
  let email: string | undefined;
  for (const value of Object.values(auth)) {
    const entry = asObj(value);
    const key = str(entry?.key);
    if (key) {
      token = key;
      email = str(entry?.email);
      break;
    }
  }
  if (!token) {
    return withMessage(
      base('grok', 'authRequired', now),
      'Grok has no usable signed-in credential — run `grok login`',
    );
  }
  const account = makeAccount({ email });
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

  // The billing answer carries the quota window and the money; the plan is not
  // in it — the Grok CLI takes its tier from the signed-in user, so the bridge
  // asks that too (same host, same credential, a short timeout: a failure only
  // costs the plan label).
  const [res, user] = await Promise.all([
    fetchJson({ url: `${GROK_API}/billing?format=credits`, headers }, deps),
    fetchJson(
      {
        url: `${GROK_API}/user?include=subscription`,
        headers,
        timeoutMs: Math.min(GROK_USER_TIMEOUT_MS, deps.timeoutMs),
      },
      deps,
    ),
  ]);
  if (!res.ok) {
    if (res.unauthorized) {
      return withAccount(
        withMessage(
          base('grok', 'authRequired', now),
          'Grok credential expired — run the Grok CLI to refresh it',
        ),
        account,
      );
    }
    return httpError('grok', res, now, account);
  }
  const body = asObj(res.body) ?? {};
  const config = asObj(body.config) ?? body;

  const plan = user.ok ? grokPlan(asObj(user.body)) : undefined;
  const credit = grokCredit(config);
  // No plan but money on the account: it is billed by use.
  const accountType = plan ? classifyPlan(plan) : credit ? 'payAsYouGo' : undefined;
  const withPlan = makeAccount({ email, plan, accountType });

  const windows: UsageWindow[] = [];
  const pct = num(config.creditUsagePercent ?? config.credit_usage_percent);
  if (pct !== undefined) {
    const period = asObj(config.currentPeriod);
    const periodType = grokPeriodType(str(period?.type));
    const resetsAt = epochMs(period?.end) ?? epochMs(config.billingPeriodEnd);
    windows.push({
      id: 'credits',
      label: grokPeriodLabel(periodType),
      usedPercent: clampPct(pct),
      ...spreadWindowMinutes(grokPeriodMinutes(periodType)),
      ...spreadResets(resetsAt),
    });
  }
  return finish('grok', now, windows, withPlan, credit, {
    empty: 'signed in, but the Grok billing API returned no quota window',
  });
}

/**
 * The plan from `GET /user?include=subscription`: its `subscriptionTier`, or
 * `Free` when the tier is `null` on a personal account — what the Grok CLI
 * itself calls such an account. A team or organization member with no tier of
 * their own is billed by that team, so no plan is claimed for them.
 */
function grokPlan(user: Record<string, unknown> | undefined): string | undefined {
  if (!user) return undefined;
  const tier = str(user.subscriptionTier ?? user.subscription_tier);
  if (tier) return GROK_TIER_LABELS[tier.toLowerCase()] ?? prettifyPlan(tier);
  const personal = user.subscriptionTier === null && !user.teamId && !user.organizationId;
  return personal ? 'Free' : undefined;
}

/** How xAI writes its own tiers; anything else is prettified as it comes. */
const GROK_TIER_LABELS: Record<string, string> = {
  supergrok: 'SuperGrok',
  supergrok_lite: 'SuperGrok Lite',
  supergrok_plus: 'SuperGrok Plus',
  supergrok_heavy: 'SuperGrok Heavy',
  x_premium: 'X Premium',
  x_premium_plus: 'X Premium+',
};

/**
 * The money Grok reports, as a `CreditBalance` in USD. Its billing answer
 * wraps each amount as `{val}`: `onDemandUsed` of an `onDemandCap` (pay as you
 * go, for the billing period) and a `prepaidBalance`. The zero rule is the one
 * every provider follows — a balance is shown once the account has one
 * (Claude's extra usage once it is enabled, Codex's credits once it has them):
 * on-demand when a cap is set or anything was spent, else a prepaid balance
 * above zero, else nothing. A free account answers all three as 0 and shows no
 * credit. When both exist, on-demand is shown: it is what the account is
 * spending now, and the contract carries one balance.
 */
function grokCredit(config: Record<string, unknown>): CreditBalance | undefined {
  const used = grokMoney(config.onDemandUsed ?? config.on_demand_used) ?? 0;
  const cap = grokMoney(config.onDemandCap ?? config.on_demand_cap) ?? 0;
  if (used > 0 || cap > 0) {
    const resetsAt = epochMs(config.billingPeriodEnd);
    return {
      used,
      currency: 'USD',
      period: 'On-demand',
      ...(cap > 0 ? { limit: cap, available: Math.max(0, cap - used) } : {}),
      ...spreadResets(resetsAt),
    };
  }
  const prepaid = grokMoney(config.prepaidBalance ?? config.prepaid_balance) ?? 0;
  if (prepaid > 0) {
    return { used: 0, available: prepaid, currency: 'USD', period: 'Prepaid' };
  }
  return undefined;
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

// ── Shared plumbing ──────────────────────────────────────────────────────────

type HttpResult =
  | { ok: true; body: unknown }
  | { ok: false; unauthorized: boolean; message: string };

async function fetchJson(
  req: {
    url: string;
    method?: string;
    headers: Record<string, string>;
    body?: string;
    /** This request's own timeout, when shorter than the reader's. */
    timeoutMs?: number;
  },
  deps: ResolvedDeps,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? deps.timeoutMs);
  try {
    const res = await deps.fetchImpl(req.url, {
      method: req.method ?? 'GET',
      headers: { 'user-agent': 'uxnan-bridge', ...req.headers },
      body: req.body,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, unauthorized: true, message: 'unauthorized' };
    }
    if (!res.ok) return { ok: false, unauthorized: false, message: `HTTP ${res.status}` };
    try {
      return { ok: true, body: await res.json() };
    } catch (error) {
      return { ok: false, unauthorized: false, message: `invalid JSON: ${String(error)}` };
    }
  } catch (error) {
    return { ok: false, unauthorized: false, message: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP failure to a `ProviderUsage` (401/403 → authRequired). */
function httpError(
  provider: UsageProvider,
  res: { unauthorized: boolean; message: string },
  now: number,
  account?: ProviderUsage['account'],
): ProviderUsage {
  const usage = res.unauthorized
    ? withMessage(
        base(provider, 'authRequired', now),
        'the stored token was rejected — sign in again with the CLI',
      )
    : withMessage(base(provider, 'error', now), res.message);
  return account ? withAccount(usage, account) : usage;
}

async function defaultGhAuthToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      windowsHide: true,
      timeout: 10_000,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function readJson(
  path: string,
  deps: ResolvedDeps,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await deps.readFile(path));
    return asObj(parsed);
  } catch {
    return undefined;
  }
}

/** Assembles the final `ok` usage, adding the "no windows" hint when empty. */
function finish(
  provider: UsageProvider,
  now: number,
  windows: UsageWindow[],
  account: ProviderUsage['account'],
  credit: CreditBalance | undefined,
  hints: { empty?: string } = {},
): ProviderUsage {
  const usage: ProviderUsage = {
    provider,
    status: 'ok',
    source: provider === 'claude' || provider === 'codex' ? 'cli' : 'token',
    windows,
    updatedAt: now,
    ...(account ? { account } : {}),
    ...(credit ? { credit } : {}),
  };
  if (windows.length === 0 && !credit) {
    usage.message =
      hints.empty ??
      (provider === 'claude' || provider === 'codex'
        ? 'signed in; no plan limits apply to this account'
        : 'signed in, but the usage API returned no quota windows');
  }
  return usage;
}

function base(provider: UsageProvider, status: UsageStatus, now: number): ProviderUsage {
  return { provider, status, windows: [], updatedAt: now };
}

function withMessage(usage: ProviderUsage, message: string): ProviderUsage {
  return { ...usage, message };
}

function withAccount(usage: ProviderUsage, account: ProviderUsage['account']): ProviderUsage {
  return account ? { ...usage, account } : usage;
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
