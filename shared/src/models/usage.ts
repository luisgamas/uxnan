/**
 * AI-provider usage: plan limits (quota windows, plan, account, credit) and
 * spend (tokens and cost by day, agent and model).
 *
 * The bridge is the one reader; every client — the phone, Uxnan Desktop's
 * Providers panel — asks it (`agent/usageStats`, `usage/summary`,
 * `usage/redeemReset`). Claude Code and Codex are asked themselves: each CLI
 * answers for the account it is signed in to, so no credential is read and no
 * OS permission is needed. Copilot and Grok have no such surface: only the
 * token each CLI stored is read (`gh auth token`, `~/.grok/auth.json`) and sent
 * to the provider's own usage API. Spend comes from the transcripts every
 * agent CLI keeps on disk. Never browser cookies, never a pasted key, never a
 * refresh token. The Dart equivalents live in uxnanmobile and are kept in sync
 * manually.
 */

/** A coding CLI whose usage we read from its own stored token. */
export type UsageProvider = 'codex' | 'claude' | 'copilot' | 'grok';

/** Outcome of reading one provider's usage. */
export type UsageStatus =
  /** Fresh quota/credit data was read. */
  | 'ok'
  /** CLI is present but not signed in (no usable token). */
  | 'authRequired'
  /** CLI / its config directory is not present on this machine. */
  | 'notInstalled'
  /** Read/network/parse failure — see {@link ProviderUsage.message}. */
  | 'error';

/** How the data was obtained: asked of the CLI itself (`cli`, Claude Code and
 *  Codex), or its stored token sent to the provider's usage API (`token`). */
export type UsageSource = 'cli' | 'token';

/**
 * The kind of billing relationship, so the UI can label an account beyond its
 * plan name (e.g. distinguish a flat subscription from usage/credit billing).
 * Derived per provider from its plan / billing signals.
 */
export type AccountType =
  /** A flat paid subscription (Pro / Max / Plus / Pro+ …). */
  | 'subscription'
  /** Usage-billed: credits, on-demand, or pay-as-you-go on top of / instead of a plan. */
  | 'payAsYouGo'
  /** Free tier. */
  | 'free'
  /** A team / organization seat. */
  | 'team'
  /** An enterprise plan. */
  | 'enterprise';

/**
 * A single quota/rate window, expressed as a used-percentage with an optional
 * reset time — the atomic unit a provider reports (e.g. a 5-hour session, a
 * weekly cap, or a model-specific window).
 */
export interface UsageWindow {
  /** Stable id (e.g. `session5h`, `weekly`, `opusWeekly`) — used by the
   *  status-bar picker to remember which windows to surface. */
  id: string;
  /** Human label (English; the UI localizes known ids, else shows this). */
  label: string;
  /** Consumed fraction of this window, clamped to 0–100. */
  usedPercent: number;
  /** Window length in minutes (300 = 5h, 10080 = 7d, 1440 = 24h), when known. */
  windowMinutes?: number;
  /** When the window resets (epoch ms), when the provider reports it. */
  resetsAt?: number;
}

/** A monetary / credit balance, kept separate from the percentage windows. */
export interface CreditBalance {
  /** Amount consumed this period, in `currency`. */
  used: number;
  /** Spend/credit cap, when the provider exposes one. */
  limit?: number;
  /** ISO-4217 code (`USD`, `EUR`, …) or `credits` for non-currency units. */
  currency: string;
  /** Period label (English; e.g. `Monthly`, `Credits`). */
  period: string;
  /** When the balance resets (epoch ms), when known. */
  resetsAt?: number;
  /** Amount still available this period, in `currency`, when the provider
   *  reports a remaining balance directly (e.g. Grok on-demand / prepaid). */
  available?: number;
}

/**
 * "Reset credits" a provider grants to roll a hit rate-limit back early — Codex's
 * rate-limit reset-credit system. Distinct from `credit` (money): these are
 * redeemable reset tokens, not a balance.
 */
/** One redeemable reset — for the per-credit detail (which one, when it expires). */
export interface ResetCreditEntry {
  /** The provider's id for this reset, to redeem exactly it (`usage/redeemReset`). */
  id?: string;
  /** Short label the provider gives the reset (e.g. "Full reset"). */
  title?: string;
  /** When this reset lapses (epoch ms). */
  expiresAt?: number;
}

export interface ResetCredits {
  /** How many resets can be redeemed right now. */
  available: number;
  /** Total resets ever granted to this account, when reported. */
  totalEarned?: number;
  /** When the soonest still-available reset lapses (epoch ms), when known. */
  nextExpiresAt?: number;
  /** The individual available resets, soonest-expiring first, when the provider
   *  details them. */
  entries?: ResetCreditEntry[];
}

/** One provider's usage snapshot. */
export interface ProviderUsage {
  provider: UsageProvider;
  status: UsageStatus;
  /** How `windows`/`credit` were obtained (absent for states with no data). */
  source?: UsageSource;
  account?: { email?: string; organization?: string; plan?: string; accountType?: AccountType };
  /** Quota/rate windows (percentage-based). Empty when none apply. */
  windows: UsageWindow[];
  credit?: CreditBalance;
  /** Redeemable rate-limit resets (Codex), when the provider grants them. */
  resetCredits?: ResetCredits;
  /** When this snapshot was produced (epoch ms). */
  updatedAt: number;
  /** Error/hint message for `error` / `authRequired` / `notInstalled` states. */
  message?: string;
}

/**
 * `agent/usageStats` request: read usage for exactly these providers — only the
 * ones the user activated. The reader never polls providers not listed here, so
 * inactive providers cost nothing.
 */
export interface UsageStatsParams {
  providers: UsageProvider[];
}

export interface UsageStatsResult {
  usage: ProviderUsage[];
}

/**
 * `usage/redeemReset` request: redeem one of a provider's rate-limit resets
 * (Codex today) — [creditId] from `ResetCredits.entries`, or the
 * soonest-expiring one when absent. [idempotencyKey] names the attempt, so a
 * retry after a lost answer never redeems twice.
 */
export interface UsageRedeemResetParams {
  provider: UsageProvider;
  idempotencyKey: string;
  creditId?: string;
}

// ---------------------------------------------------------------------------
// Spend: what each agent CLI used, from the transcripts it keeps itself
// ---------------------------------------------------------------------------

/**
 * `usage/summary` request: the last [days] calendar days of this PC (today
 * included), 1–366.
 */
export interface UsageSummaryParams {
  days: number;
}

/** Tokens and cost of a set of model responses. */
export interface UsageSpend {
  /** Input not read from the cache. */
  inputTokens: number;
  /** Input read from the cache. */
  cachedInputTokens: number;
  /** Input written to the cache. */
  cacheWriteTokens: number;
  /** Output, reasoning included. */
  outputTokens: number;
  /** The reasoning part of `outputTokens`, where the CLI records it. */
  reasoningTokens: number;
  /** US dollars: what the provider billed where the CLI records it, else the
   *  estimate at API prices (`estimatedCostUsd` of it). */
  costUsd: number;
  /** The part of `costUsd` estimated at API prices (on a subscription, what
   *  the same work would cost pay-as-you-go). */
  estimatedCostUsd: number;
  /** Tokens of responses whose model has no known price — not in `costUsd`. */
  unpricedTokens: number;
  /** Model responses counted. */
  responses: number;
}

/** One agent + model's spend on one day. */
export interface UsageBucket extends UsageSpend {
  /** Wire agent id (`claude-code`, `codex`, `pi-agent`, `grok`, `opencode`). */
  agentId: string;
  /** The model id as the CLI recorded it (`provider/model` where it routes). */
  model: string;
}

/** One calendar day of this PC. */
export interface UsageDay {
  /** `YYYY-MM-DD`, the PC's local date. */
  day: string;
  buckets: UsageBucket[];
}

/** What was found for one agent. */
export interface UsageAgentSource {
  agentId: string;
  /** Sessions with spend in the period. */
  sessions: number;
  /** `ok`: read (possibly nothing in the period); `unreadable`: its store
   *  exists but could not be read (see `message`). Agents with no store on
   *  this PC are not listed. */
  status: 'ok' | 'unreadable';
  message?: string;
}

/**
 * `usage/summary` result: every model response the agent CLIs on this PC
 * recorded in the period — the bridge's turns and a person's own terminal
 * sessions alike — by day, agent and model. Only days with spend are listed.
 */
export interface UsageSummary {
  days: UsageDay[];
  agents: UsageAgentSource[];
}
