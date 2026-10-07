/**
 * What a response would cost at the provider's API prices, for the CLIs whose
 * transcripts record tokens but no cost (Claude Code on a subscription, and
 * Codex). pi, Grok and OpenCode record what was billed and are never priced
 * here.
 *
 * Claude's rates are Anthropic's published prices — the model-pricing table read
 * 2026-10-07: US dollars per million tokens, with a prompt-cache read at its own
 * rate and a write priced by how long the entry lives. The cache read is **not**
 * always a fixed share of the input price, which is why {@link rate} takes the
 * multiplier instead of assuming a tenth: Anthropic charges 0.05x on Opus 5.5
 * and 0.025x on Fable 5.1 and Mythos 5.1. Ids are matched by prefix, so a model
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
/** …and at the reduced rate Opus 5.5 publishes. */
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
  // Sonnet 5.5's published cache read is $0.20 (0.1x). The pricing page's own
  // prose says 0.05x / $0.10 for it while both of its tables say $0.20 — the
  // tables are what Anthropic bills from, so the standard multiplier it is.
  ['claude-sonnet-5-5', flat(2, 10)],
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

/** The API cost of [r] in US dollars, or undefined when its model has no known price. */
export function estimateCost(r: UsageRecord): number | undefined {
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
