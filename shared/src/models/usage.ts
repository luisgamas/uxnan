/**
 * AI-provider usage statistics: quota/rate windows, plan/account, credit
 * balance and local token tallies read from a coding CLI's on-disk state — its
 * stored OAuth token (→ the provider's official usage API) and/or its local
 * session logs.
 *
 * Surfaced in the desktop's Settings → Providers section and, over the bridge,
 * on the phone. The access path is per-runtime by design (02a §5.8.10): the
 * desktop reads these files natively in Rust; the bridge reads them in TS so a
 * paired phone — which cannot see the PC's disk directly — gets the same data
 * over `agent/usageStats`. The Dart equivalents live in uxnanmobile and are kept
 * in sync manually (see 02e-bridge-integration.md §4.2).
 *
 * Posture: only the CLI's own stored token is read — never browser cookies or
 * user-pasted API keys.
 */

/** A coding CLI whose usage we read from its own stored token. */
export type UsageProvider = 'codex' | 'claude' | 'copilot' | 'gemini' | 'grok';

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

/** How the data was obtained, for the UI's provenance label. Every wired
 *  provider reads its quota from the CLI's own signed-in token. */
export type UsageSource = 'token';

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
}

/** One provider's usage snapshot. */
export interface ProviderUsage {
  provider: UsageProvider;
  status: UsageStatus;
  /** How `windows`/`credit` were obtained (absent for states with no data). */
  source?: UsageSource;
  account?: { email?: string; organization?: string; plan?: string };
  /** Quota/rate windows (percentage-based). Empty when none apply. */
  windows: UsageWindow[];
  credit?: CreditBalance;
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
