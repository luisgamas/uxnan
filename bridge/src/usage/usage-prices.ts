/**
 * What a response would cost at the provider's API prices, for the CLIs whose
 * transcripts record tokens but no cost (Claude Code and Codex — on a
 * subscription, what the same work would cost pay-as-you-go). pi, Grok and
 * OpenCode record what was billed and are never priced here; Antigravity and
 * Zero have no table and stay unpriced. These two tables are the only price
 * lists Uxnan keeps: a model is never priced by guess, only by its row.
 *
 * Claude's rates are Anthropic's published prices — the model-pricing table read
 * 2026-10-31: US dollars per million tokens, with a prompt-cache read at its own
 * rate and a write priced by how long the entry lives. The cache read is **not**
 * always a fixed share of the input price, which is why {@link rate} takes the
 * multiplier instead of assuming a tenth: Anthropic charges 0.05x on Opus 5.5
 * and Sonnet 5.5, and 0.025x on Fable 5.1 and Mythos 5.1. Ids are matched by prefix, so a model
 * the table has never heard of inherits its family's rate when one covers it;
 * a family with no entry at all is left unpriced rather than guessed at the
 * nearest tier.
 */
import type { UsageRecord } from './transcript-usage.js';

/** One set of prices, US dollars per million tokens. */
interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/**
 * The prices for a request whose prompt fits in `upToPromptTokens`. The last
 * band of a model is unbounded (`Infinity`) — `estimateCost` falls back to
 * "unpriced" without one, and the band tests hold every entry to it.
 */
interface PriceBand {
  upToPromptTokens: number;
  rate: Rate;
}

/** A cache hit at Anthropic's standard rate: a tenth of the input price. */
const CACHE_READ_STANDARD = 0.1;
/** …and at the reduced rate Opus 5.5 and Sonnet 5.5 publish. */
const CACHE_READ_HALF = 0.05;
/** …and at the one Fable 5.1 and Mythos 5.1 publish. */
const CACHE_READ_QUARTER = 0.025;

/**
 * One band of prices. Cache *writes* are always 1.25x (five minutes) and 2x (an
 * hour) the input price, so only the read multiplier varies.
 */
const rate = (input: number, output: number, cacheReadMult = CACHE_READ_STANDARD): Rate => ({
  input,
  output,
  cacheRead: input * cacheReadMult,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
});

/** A model priced the same at every prompt length. */
const flat = (input: number, output: number, cacheReadMult?: number): PriceBand[] => [
  { upToPromptTokens: Infinity, rate: rate(input, output, cacheReadMult) },
];

/**
 * Claude models, most specific first (a model id is matched by prefix, so a
 * generation that prices differently needs its own entry ahead of its family's
 * — Fable 5.1 reads its cache at a quarter of the input price and Fable 5 at a
 * tenth, which one `claude-fable` prefix cannot hold for both).
 *
 * Only **Haiku 5.5** is priced by prompt length: over 100 000 tokens every rate
 * is five times the one below. Every other model is 1M-token at standard prices
 * for its whole window, so one unbounded band each. The rates themselves are
 * pinned by `test/usage/transcript-usage.test.ts`.
 */
const CLAUDE_PRICES: readonly (readonly [string, readonly PriceBand[]])[] = [
  ['claude-fable-5-1', flat(10, 50, CACHE_READ_QUARTER)],
  ['claude-mythos-5-1', flat(10, 50, CACHE_READ_QUARTER)],
  ['claude-fable-5', flat(10, 50)],
  ['claude-mythos-5', flat(10, 50)],
  ['claude-opus-5-5', flat(4, 20, CACHE_READ_HALF)],
  // FOR-DEV: fast mode costs 2x on Opus 5.5, Opus 5 and Opus 4.8 and is not
  // priced. `initialize` reports `supportsFastMode`, but `fast_mode_state` is
  // per session rather than per response, so a transcript cannot say which
  // responses ran in it — these are a deliberate under-estimate until the CLI
  // reports it per response. See FOR-DEV.md.
  ['claude-opus-5', flat(5, 25)],
  ['claude-opus-4-5', flat(5, 25)],
  ['claude-opus-4-6', flat(5, 25)],
  ['claude-opus-4-7', flat(5, 25)],
  ['claude-opus-4-8', flat(5, 25)],
  ['claude-opus-4', flat(15, 75)],
  // Sonnet 5.5 reads its cache at 0.05x ($0.10): the table and its footnote
  // agree since the 2026-10-31 read (an earlier read had the table at $0.20).
  ['claude-sonnet-5-5', flat(2, 10, CACHE_READ_HALF)],
  ['claude-sonnet-5', flat(2, 10)],
  ['claude-sonnet-4', flat(3, 15)],
  [
    'claude-haiku-5-5',
    [
      { upToPromptTokens: 100_000, rate: rate(0.1, 0.5) },
      { upToPromptTokens: Infinity, rate: rate(0.5, 2.5) },
    ],
  ],
  ['claude-haiku-4-5', flat(1, 5)],
];

function claudeBands(model: string): readonly PriceBand[] | undefined {
  const id = model.toLowerCase().replace(/\[.*\]$/, '');
  return CLAUDE_PRICES.find(([prefix]) => id.startsWith(prefix))?.[1];
}

/**
 * The tokens the request sent to the model, which is what a prompt-length price
 * turns on: everything the model read, whether it was fresh, a cache hit or a
 * cache write.
 */
function promptTokens(r: UsageRecord): number {
  return r.inputTokens + r.cachedInputTokens + r.cacheWriteTokens;
}

// ── Codex (OpenAI) ───────────────────────────────────────────────────────────

/** One OpenAI price set, US dollars per million tokens. */
interface OpenAiRate {
  input: number;
  cachedInput: number;
  output: number;
}

/** A model's prices at one service tier: up to and past the long-context line. */
interface OpenAiTier {
  short: OpenAiRate;
  /** Past {@link OPENAI_LONG_CONTEXT_FROM} input tokens; absent when OpenAI
   *  publishes none (that request is then left unpriced). */
  long?: OpenAiRate;
}

/** The service tiers OpenAI prices Codex's models at. */
export type OpenAiTierName = 'standard' | 'flex' | 'fast' | 'ultrafast';

/** "Long context: >272K input tokens" — fresh, cached and written alike. */
const OPENAI_LONG_CONTEXT_FROM = 272_000;

const o = (input: number, output: number, cachedInput: number): OpenAiRate => ({
  input,
  output,
  cachedInput,
});

/**
 * OpenAI's published API prices for the models Codex runs — the pricing page
 * (developers.openai.com/api/docs/pricing) read 2026-10-31. Matched on the
 * exact model id the rollout names: OpenAI prices every model on its own row,
 * so there is no family to fall back on, and an id with no row is unpriced.
 * Reasoning tokens are part of `output_tokens` and priced as output, once.
 * Pinned by `test/usage/transcript-usage.test.ts`.
 */
const CODEX_PRICES: Readonly<Record<string, Partial<Record<OpenAiTierName, OpenAiTier>>>> = {
  'gpt-6-astra': {
    standard: { short: o(10, 50, 1), long: o(20, 75, 2) },
    flex: { short: o(5, 25, 0.5), long: o(10, 37.5, 1) },
    fast: { short: o(20, 100, 2), long: o(40, 150, 4) },
    ultrafast: { short: o(60, 300, 6), long: o(120, 450, 12) },
  },
  'gpt-6.1-sol': {
    standard: { short: o(2, 10, 0.1), long: o(4, 15, 0.2) },
    flex: { short: o(1, 5, 0.05), long: o(2, 7.5, 0.1) },
    fast: { short: o(4, 20, 0.2), long: o(8, 30, 0.4) },
    ultrafast: { short: o(12, 60, 0.6), long: o(24, 90, 1.2) },
  },
  'gpt-6.1-terra': {
    standard: { short: o(1, 5, 0.05), long: o(2, 7.5, 0.1) },
    flex: { short: o(0.5, 2.5, 0.025), long: o(1, 3.75, 0.05) },
    fast: { short: o(2, 10, 0.1), long: o(4, 15, 0.2) },
  },
  'gpt-6-sol': {
    standard: { short: o(2, 10, 0.2), long: o(4, 15, 0.4) },
    flex: { short: o(1, 5, 0.1), long: o(2, 7.5, 0.2) },
    fast: { short: o(4, 20, 0.4), long: o(8, 30, 0.8) },
  },
  'gpt-6-luna': {
    standard: { short: o(0.1, 0.5, 0.01), long: o(0.2, 0.75, 0.02) },
    flex: { short: o(0.05, 0.25, 0.005), long: o(0.1, 0.375, 0.01) },
    fast: { short: o(0.2, 1, 0.02), long: o(0.4, 1.5, 0.04) },
  },
  // OpenAI notes GPT-5.6 Sol's price is promotional, "at least through
  // November 21, 2026": re-read the page after that date.
  'gpt-5.6-sol': {
    standard: { short: o(4, 20, 0.4), long: o(8, 30, 0.8) },
    flex: { short: o(2, 10, 0.2), long: o(4, 15, 0.4) },
    fast: { short: o(8, 40, 0.8), long: o(16, 60, 1.6) },
  },
  'gpt-5.6-terra': {
    standard: { short: o(2, 12, 0.2), long: o(4, 18, 0.4) },
    flex: { short: o(1, 6, 0.1), long: o(2, 9, 0.2) },
    fast: { short: o(4, 24, 0.4), long: o(8, 36, 0.8) },
  },
  'gpt-5.6-luna': {
    standard: { short: o(0.2, 1.2, 0.02), long: o(0.4, 1.8, 0.04) },
    flex: { short: o(0.1, 0.6, 0.01), long: o(0.2, 0.9, 0.02) },
    fast: { short: o(0.4, 2.4, 0.04), long: o(0.8, 3.6, 0.08) },
  },
  'gpt-5.3-codex': {
    standard: { short: o(1.75, 14, 0.175) },
    fast: { short: o(3.5, 28, 0.35) },
  },
};

/**
 * The tier a rollout's `service_tier` names: `fast` (formerly `priority`),
 * `flex`, `ultrafast`; anything else — absent, `default`, `auto` — is standard.
 */
export function openAiTier(serviceTier: string | undefined): OpenAiTierName {
  switch (serviceTier?.toLowerCase()) {
    case 'fast':
    case 'priority':
      return 'fast';
    case 'flex':
      return 'flex';
    case 'ultrafast':
      return 'ultrafast';
    default:
      return 'standard';
  }
}

/**
 * A Codex response at OpenAI's API price, or undefined when it cannot be
 * priced honestly: an id or tier with no published row, a long prompt where no
 * long-context price is published, or a cache write — Codex reports written
 * tokens without saying for how long they were kept, and OpenAI prices a
 * 30-minute and a 12-hour write differently.
 */
function codexCost(r: UsageRecord): number | undefined {
  const tier = CODEX_PRICES[r.model]?.[openAiTier(r.serviceTier)];
  if (!tier || r.cacheWriteTokens > 0) return undefined;
  const price = promptTokens(r) > OPENAI_LONG_CONTEXT_FROM ? tier.long : tier.short;
  if (!price) return undefined;
  return (
    (r.inputTokens * price.input +
      r.cachedInputTokens * price.cachedInput +
      r.outputTokens * price.output) /
    1_000_000
  );
}

/** The API cost of [r] in US dollars, or undefined when its model has no known price. */
export function estimateCost(r: UsageRecord): number | undefined {
  if (r.agentId === 'codex') return codexCost(r);
  if (r.agentId !== 'claude-code') return undefined;
  const bands = claudeBands(r.model);
  if (!bands) return undefined;
  const tokens = promptTokens(r);
  const band = bands.find((b) => tokens <= b.upToPromptTokens);
  // Unreachable while every entry ends in an unbounded band (the tests hold it
  // to that) — and the honest answer if one ever stops doing so.
  if (!band) return undefined;
  const price = band.rate;
  const long = Math.min(r.cacheWriteLongTokens ?? 0, r.cacheWriteTokens);
  const short = r.cacheWriteTokens - long;
  return (
    (r.inputTokens * price.input +
      r.cachedInputTokens * price.cacheRead +
      short * price.cacheWrite5m +
      long * price.cacheWrite1h +
      r.outputTokens * price.output) /
    1_000_000
  );
}
