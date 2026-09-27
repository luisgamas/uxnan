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

/** Claude model families, most specific first (a model id is matched by prefix). */
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
  ['claude-sonnet-5', tier(2, 10)],
  ['claude-sonnet-4-6', tier(2, 10)],
  ['claude-sonnet-4', tier(3, 15)],
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
