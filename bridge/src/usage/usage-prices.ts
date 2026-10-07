/**
 * What a response would cost at the provider's API prices, for the CLIs whose
 * transcripts record tokens but no cost (Claude Code on a subscription, and
 * Codex). pi, Grok and OpenCode record what was billed and are never priced
 * here.
 *
 * Claude's rates are Claude Code's own pricing tiers (the table the CLI ships,
 * read from 2.1.283): US dollars per million tokens, with the cache written for
 * five minutes or an hour at different rates. A model outside the table is not
 * priced — an unknown price is shown as such, never guessed.
 */
import type { UsageRecord } from './transcript-usage.js';

interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

const tier = (input: number, output: number): Rate => ({
  input,
  output,
  cacheRead: input / 10,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
});

/**
 * Claude model families, most specific first (a model id is matched by prefix).
 *
 * One flat rate per model: the ≤100K-prompt tier Anthropic publishes for each.
 * Haiku 5.5 also charges more above a 100K prompt ($0.50/$2.50 rather than
 * $0.10/$0.50), which this shape cannot express — long-context turns are
 * under-estimated rather than over-estimated. An unknown model is left unpriced
 * (see {@link estimateCost}), never guessed at the nearest tier.
 */
const CLAUDE_RATES: readonly (readonly [string, Rate])[] = [
  ['claude-fable', tier(10, 50)],
  ['claude-mythos', tier(10, 50)],
  ['claude-opus-5-5', tier(10, 50)],
  ['claude-opus-5', tier(5, 25)],
  ['claude-opus-4-5', tier(5, 25)],
  ['claude-opus-4-6', tier(5, 25)],
  ['claude-opus-4-7', tier(5, 25)],
  ['claude-opus-4-8', tier(5, 25)],
  ['claude-opus-4', tier(15, 75)],
  // Explicit, not inherited from the `claude-sonnet-5` prefix below: same rate
  // today, but a new generation gets its own row rather than silently costing
  // whatever the one before it does.
  ['claude-sonnet-5-5', tier(2, 10)],
  ['claude-sonnet-5', tier(2, 10)],
  ['claude-sonnet-4-6', tier(2, 10)],
  ['claude-sonnet-4', tier(3, 15)],
  ['claude-haiku-5-5', tier(0.1, 0.5)],
  ['claude-haiku-4-5', tier(1, 5)],
];

function claudeRate(model: string): Rate | undefined {
  const id = model.toLowerCase().replace(/\[.*\]$/, '');
  return CLAUDE_RATES.find(([prefix]) => id.startsWith(prefix))?.[1];
}

/** The API cost of [r] in US dollars, or undefined when its model has no known price. */
export function estimateCost(r: UsageRecord): number | undefined {
  if (r.agentId !== 'claude-code') return undefined;
  const rate = claudeRate(r.model);
  if (!rate) return undefined;
  const long = Math.min(r.cacheWriteLongTokens ?? 0, r.cacheWriteTokens);
  const short = r.cacheWriteTokens - long;
  return (
    (r.inputTokens * rate.input +
      r.cachedInputTokens * rate.cacheRead +
      short * rate.cacheWrite5m +
      long * rate.cacheWrite1h +
      r.outputTokens * rate.output) /
    1_000_000
  );
}
