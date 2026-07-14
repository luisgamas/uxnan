/**
 * Reads AI-provider usage/quota by porting the desktop's native Rust reader
 * (`uxnandesktop/src-tauri/src/usage.rs`) to TypeScript, so a paired phone gets
 * the same data over `agent/usageStats` (architecture 02a §5.8.10, 02e §4.2).
 *
 * Posture (identical to the desktop): only each CLI's OWN already-stored OAuth
 * token is read from its `~/.<cli>/…` file (or, for Copilot, `gh auth token`) →
 * the provider's official usage API. Never browser cookies, never a pasted key.
 * Every provider is best-effort and isolated: a slow/failed provider degrades to
 * its own `status` + `message` and never rejects the whole call.
 *
 * All I/O is injectable (`homeDir` / `readFile` / `fetchImpl` / `ghAuthToken` /
 * `now`) so each provider's mapping is unit-tested against canned JSON with no
 * disk or network.
 */
import { execFile } from 'node:child_process';
import { readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
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
}

interface ResolvedDeps {
  homeDir: string;
  readFile: (path: string) => Promise<string>;
  fetchImpl: typeof fetch;
  now: () => number;
  ghAuthToken: () => Promise<string | undefined>;
  timeoutMs: number;
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
    case 'gemini':
      return readGemini(deps);
    case 'grok':
      return readGrok(deps);
  }
}

// ── Codex ────────────────────────────────────────────────────────────────────

async function readCodex(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const auth = await readJson(join(deps.homeDir, '.codex', 'auth.json'), deps);
  if (!auth) {
    return withMessage(
      base('codex', 'notInstalled', now),
      'Codex is not set up on this PC (~/.codex/auth.json missing)',
    );
  }
  const tokens = asObj(auth.tokens);
  const token = str(tokens?.access_token);
  if (!token) {
    return withMessage(
      base('codex', 'authRequired', now),
      'Codex is not signed in with a ChatGPT account',
    );
  }
  const accountId = str(tokens?.account_id);
  const baseUrl = await codexBaseUrl(deps);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;

  const res = await fetchJson({ url: `${baseUrl}/wham/usage`, headers }, deps);
  if (!res.ok) return httpError('codex', res, now);
  const body = asObj(res.body) ?? {};

  const plan = str(body.plan_type);
  const account = makeAccount({ email: str(body.email), plan: plan ? prettifyPlan(plan) : undefined });

  const windows: UsageWindow[] = [];
  const rate = asObj(body.rate_limit) ?? asObj(body.rate_limits);
  if (rate) {
    for (const key of ['primary_window', 'secondary_window']) {
      const w = asObj(rate[key]);
      if (w) {
        const win = windowFromValue(key, key, w);
        win.label = labelForMinutes(win.windowMinutes);
        windows.push(win);
      }
    }
  }
  const codeReview = asObj(body.code_review_rate_limit);
  if (codeReview) windows.push(windowFromValue('code_review', 'Code review', codeReview));
  const additional = Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : [];
  additional.forEach((item, i) => {
    const w = asObj(item);
    if (w) windows.push(windowFromValue(`extra${i}`, str(w.name) ?? 'Extra', w));
  });

  const credit = withCreditOf(body.credits, 'Credits');
  return finish('codex', now, windows, account, credit);
}

async function codexBaseUrl(deps: ResolvedDeps): Promise<string> {
  const fallback = 'https://chatgpt.com/backend-api';
  try {
    const raw = await deps.readFile(join(deps.homeDir, '.codex', 'config.toml'));
    for (const line of raw.split('\n')) {
      const captured = line.match(/^\s*chatgpt_base_url\s*=\s*"?([^"\r\n]+)"?/)?.[1];
      if (captured !== undefined) {
        const url = captured.trim().replace(/\/+$/, '');
        if (url.startsWith('https://')) return url;
      }
    }
  } catch {
    // No config.toml (or unreadable) → default base URL.
  }
  return fallback;
}

// ── Claude ───────────────────────────────────────────────────────────────────

async function readClaude(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const creds = await readJson(join(deps.homeDir, '.claude', '.credentials.json'), deps);
  if (!creds) {
    return withMessage(
      base('claude', 'notInstalled', now),
      'Claude Code is not signed in (~/.claude/.credentials.json missing)',
    );
  }
  const oauth = asObj(creds.claudeAiOauth);
  const token = str(oauth?.accessToken);
  if (!token) {
    return withMessage(
      base('claude', 'authRequired', now),
      'Claude Code has no OAuth access token',
    );
  }
  const plan = str(oauth?.subscriptionType);
  const account = makeAccount({ plan: plan ? prettifyPlan(plan) : undefined });

  const res = await fetchJson(
    {
      url: 'https://api.anthropic.com/api/oauth/usage',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        accept: 'application/json',
      },
    },
    deps,
  );
  if (!res.ok) return httpError('claude', res, now, account);
  const body = asObj(res.body) ?? {};

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
      id: kind ?? `limit${i}`,
      label: claudeLimitLabel(kind, group, model),
      usedPercent: clampPct(pct),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      ...spreadResets(epochMs(w.resets_at)),
    });
  });
  if (windows.length === 0) {
    claudeWindow(windows, body.five_hour, 'five_hour', 'Session (5h)', 300);
    claudeWindow(windows, body.seven_day, 'seven_day', 'Weekly', 10_080);
    claudeWindow(windows, body.seven_day_opus, 'seven_day_opus', 'Opus (weekly)', 10_080);
    claudeWindow(windows, body.seven_day_sonnet, 'seven_day_sonnet', 'Sonnet (weekly)', 10_080);
  }

  let credit: CreditBalance | undefined;
  const extra = asObj(body.extra_usage);
  if (extra && extra.is_enabled === true) {
    const used = num(extra.used_credits) ?? 0;
    const limit = num(extra.monthly_limit);
    const currency = str(extra.currency) ?? 'USD';
    credit = { used, currency, period: 'Monthly credits', ...(limit !== undefined ? { limit } : {}) };
  }
  return finish('claude', now, windows, account, credit);
}

function claudeLimitLabel(kind: string | undefined, group: string | undefined, model: string | undefined): string {
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
  const account = makeAccount({ email: login, plan: plan ? prettifyPlan(plan) : undefined });
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

// ── Gemini ───────────────────────────────────────────────────────────────────

async function readGemini(deps: ResolvedDeps): Promise<ProviderUsage> {
  const now = deps.now();
  const creds = await readJson(join(deps.homeDir, '.gemini', 'oauth_creds.json'), deps);
  if (!creds) {
    return withMessage(
      base('gemini', 'notInstalled', now),
      'Gemini CLI is not signed in (~/.gemini/oauth_creds.json missing)',
    );
  }
  const token = str(creds.access_token);
  if (!token) {
    return withMessage(base('gemini', 'authRequired', now), 'Gemini CLI has no access token');
  }
  const account = makeAccount({ email: jwtEmail(creds.id_token) });

  const res = await fetchJson(
    {
      url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    },
    deps,
  );
  if (!res.ok) {
    if (res.unauthorized) {
      return withAccount(
        withMessage(
          base('gemini', 'authRequired', now),
          'Gemini access token expired — re-run the Gemini CLI to refresh it',
        ),
        account,
      );
    }
    return httpError('gemini', res, now, account);
  }
  const body = asObj(res.body) ?? {};

  const windows: UsageWindow[] = [];
  const buckets = Array.isArray(body.buckets) ? body.buckets : [];
  buckets.forEach((item, i) => {
    const w = asObj(item);
    if (!w) return;
    const remaining = num(w.remaining_fraction ?? w.remainingFraction) ?? 0;
    windows.push({
      id: `bucket${i}`,
      label: str(w.model_id ?? w.modelId) ?? 'Quota',
      usedPercent: clampPct((1 - remaining) * 100),
      windowMinutes: 1440,
      ...spreadResets(epochMs(w.reset_time ?? w.resetTime)),
    });
  });
  return finish('gemini', now, windows, account, undefined, {
    empty: 'signed in, but the quota API returned no buckets',
  });
}

// ── Grok ─────────────────────────────────────────────────────────────────────

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

  const res = await fetchJson(
    {
      url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    },
    deps,
  );
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

  const plan = str(config.subscriptionTier ?? config.subscription_tier);
  const withPlan = makeAccount({ email, plan: plan ? prettifyPlan(plan) : undefined });

  const windows: UsageWindow[] = [];
  const pct = num(config.creditUsagePercent ?? config.credit_usage_percent);
  if (pct !== undefined) {
    const period = asObj(config.currentPeriod);
    const periodType = str(period?.type);
    const resetsAt = epochMs(period?.end) ?? epochMs(config.billingPeriodEnd);
    windows.push({
      id: 'credits',
      label: grokPeriodLabel(periodType),
      usedPercent: clampPct(pct),
      ...spreadWindowMinutes(grokPeriodMinutes(periodType)),
      ...spreadResets(resetsAt),
    });
  }
  return finish('grok', now, windows, withPlan, undefined, {
    empty: 'signed in, but the Grok billing API returned no quota window',
  });
}

function grokPeriodLabel(period: string | undefined): string {
  switch (period) {
    case 'USAGE_PERIOD_TYPE_DAILY':
      return 'Daily';
    case 'USAGE_PERIOD_TYPE_WEEKLY':
      return 'Weekly';
    case 'USAGE_PERIOD_TYPE_MONTHLY':
      return 'Monthly';
    default:
      return 'Usage';
  }
}

function grokPeriodMinutes(period: string | undefined): number | undefined {
  switch (period) {
    case 'USAGE_PERIOD_TYPE_DAILY':
      return 1440;
    case 'USAGE_PERIOD_TYPE_WEEKLY':
      return 10_080;
    case 'USAGE_PERIOD_TYPE_MONTHLY':
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
  req: { url: string; method?: string; headers: Record<string, string>; body?: string },
  deps: ResolvedDeps,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
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

async function readJson(path: string, deps: ResolvedDeps): Promise<Record<string, unknown> | undefined> {
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
    source: 'token',
    windows,
    updatedAt: now,
    ...(account ? { account } : {}),
    ...(credit ? { credit } : {}),
  };
  if (windows.length === 0 && !credit) {
    usage.message = hints.empty ?? 'signed in, but the usage API returned no quota windows';
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
}): ProviderUsage['account'] {
  const account: { email?: string; organization?: string; plan?: string } = {};
  if (fields.email) account.email = fields.email;
  if (fields.organization) account.organization = fields.organization;
  if (fields.plan) account.plan = fields.plan;
  return account.email || account.organization || account.plan ? account : undefined;
}

function withCreditOf(value: unknown, period: string): CreditBalance | undefined {
  const v = asObj(value);
  return v ? creditFromValue(v, period) : undefined;
}

function creditFromValue(v: Record<string, unknown>, period: string): CreditBalance | undefined {
  const used = num(v.used ?? v.balance ?? v.used_credits);
  if (used === undefined) return undefined;
  const limit = num(v.limit ?? v.total);
  const currency = str(v.currency) ?? 'USD';
  const resetsAt = epochMs(v.resets_at ?? v.resetAt);
  return { used, currency, period, ...(limit !== undefined ? { limit } : {}), ...spreadResets(resetsAt) };
}

function windowFromValue(
  id: string,
  label: string,
  w: Record<string, unknown>,
  minDefault?: number,
): UsageWindow {
  let pct = num(w.used_percent ?? w.usedPercent) ?? 0;
  if (pct <= 1) pct *= 100;
  const limitSeconds = num(w.limit_window_seconds ?? w.limitWindowSeconds);
  const windowMinutes = limitSeconds !== undefined ? Math.round(limitSeconds / 60) : minDefault;
  return {
    id,
    label,
    usedPercent: clampPct(pct),
    ...spreadWindowMinutes(windowMinutes),
    ...spreadResets(epochMs(w.reset_at ?? w.resetAt ?? w.resets_at)),
  };
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

function jwtEmail(jwt: unknown): string | undefined {
  if (typeof jwt !== 'string') return undefined;
  const segment = jwt.split('.')[1];
  if (!segment) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return str(asObj(payload)?.email);
  } catch {
    return undefined;
  }
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
