// What the agents on this PC spent, shaped for Settings → Providers: a series
// per day (every day of the period, spent or not), each agent's share, and the
// models behind it. Pure: the bridge's `usage/summary` in, view data out.

import type { UsageBucket, UsageSpend, UsageSummary } from "$lib/types";

/** What the chart and the totals measure. */
export type SpendMetric = "cost" | "tokens";

/**
 * The agents in the fixed order their colours are assigned in: a colour
 * belongs to the agent, never to its rank, and the stack follows this order so
 * neighbouring colours are always the pairs the palette was checked for.
 */
export const SPEND_AGENTS = [
  "codex",
  "claude-code",
  "opencode",
  "grok",
  "pi-agent",
  "antigravity-cli",
  "zero",
] as const;

/** Tokens of a spend record: everything read or written. */
export function tokensOf(s: UsageSpend): number {
  return s.inputTokens + s.cachedInputTokens + s.cacheWriteTokens + s.outputTokens;
}

function valueOf(s: UsageSpend, metric: SpendMetric): number {
  return metric === "cost" ? s.costUsd : tokensOf(s);
}

function empty(): UsageSpend {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    estimatedCostUsd: 0,
    unpricedTokens: 0,
    responses: 0,
  };
}

function add(into: UsageSpend, from: UsageSpend): void {
  into.inputTokens += from.inputTokens;
  into.cachedInputTokens += from.cachedInputTokens;
  into.cacheWriteTokens += from.cacheWriteTokens;
  into.outputTokens += from.outputTokens;
  into.reasoningTokens += from.reasoningTokens;
  into.costUsd += from.costUsd;
  into.estimatedCostUsd += from.estimatedCostUsd;
  into.unpricedTokens += from.unpricedTokens;
  into.responses += from.responses;
}

/** `YYYY-MM-DD` of [date] in local time. */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The [days] calendar days ending today, oldest first. */
export function periodDays(days: number, today: Date = new Date()): string[] {
  const out: string[] = [];
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    out.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export interface SpendDay {
  day: string;
  /** Value per agent, for the chosen metric. */
  byAgent: Record<string, number>;
  total: number;
}

export interface SpendAgent {
  agentId: string;
  spend: UsageSpend;
  /** Share of the period's total, 0–1, for the chosen metric. */
  share: number;
  sessions: number;
}

export interface SpendModel {
  agentId: string;
  model: string;
  spend: UsageSpend;
}

export interface SpendView {
  days: SpendDay[];
  /** Agents with spend, in {@link SPEND_AGENTS} order. */
  agents: SpendAgent[];
  models: SpendModel[];
  total: UsageSpend;
  sessions: number;
  /** The largest day total, for the chart's scale. */
  peak: number;
}

/** The period's spend as the Providers panel draws it. */
export function spendView(
  summary: UsageSummary,
  days: number,
  metric: SpendMetric,
  today: Date = new Date(),
): SpendView {
  const keys = periodDays(days, today);
  const inPeriod = new Set(keys);
  const byDay = new Map<string, UsageBucket[]>(
    summary.days.filter((d) => inPeriod.has(d.day)).map((d) => [d.day, d.buckets]),
  );
  const perAgent = new Map<string, UsageSpend>();
  const perModel = new Map<string, SpendModel>();
  const total = empty();
  const series: SpendDay[] = keys.map((day) => {
    const byAgent: Record<string, number> = {};
    let dayTotal = 0;
    for (const bucket of byDay.get(day) ?? []) {
      const value = valueOf(bucket, metric);
      byAgent[bucket.agentId] = (byAgent[bucket.agentId] ?? 0) + value;
      dayTotal += value;
      add(total, bucket);
      const agent = perAgent.get(bucket.agentId) ?? empty();
      perAgent.set(bucket.agentId, agent);
      add(agent, bucket);
      const key = `${bucket.agentId}\t${bucket.model}`;
      const model = perModel.get(key) ?? { agentId: bucket.agentId, model: bucket.model, spend: empty() };
      perModel.set(key, model);
      add(model.spend, bucket);
    }
    return { day, byAgent, total: dayTotal };
  });
  const grand = valueOf(total, metric);
  const sessionsOf = new Map(summary.agents.map((a) => [a.agentId, a.sessions]));
  const order = (id: string) => {
    const at = (SPEND_AGENTS as readonly string[]).indexOf(id);
    return at === -1 ? SPEND_AGENTS.length : at;
  };
  const agents: SpendAgent[] = [...perAgent.entries()]
    .map(([agentId, spend]) => ({
      agentId,
      spend,
      share: grand > 0 ? valueOf(spend, metric) / grand : 0,
      sessions: sessionsOf.get(agentId) ?? 0,
    }))
    .sort((a, b) => order(a.agentId) - order(b.agentId) || a.agentId.localeCompare(b.agentId));
  const models = [...perModel.values()].sort(
    (a, b) =>
      valueOf(b.spend, metric) - valueOf(a.spend, metric) ||
      tokensOf(b.spend) - tokensOf(a.spend),
  );
  return {
    days: series,
    agents,
    models,
    total,
    sessions: agents.reduce((sum, a) => sum + a.sessions, 0),
    peak: Math.max(0, ...series.map((d) => d.total)),
  };
}

/** A 1/2/5 scale ceiling at or above [peak], and its three gridlines. */
export function niceScale(peak: number): { max: number; ticks: number[] } {
  if (peak <= 0) return { max: 1, ticks: [0, 0.5, 1] };
  const exponent = Math.floor(Math.log10(peak));
  const base = 10 ** exponent;
  const step = [1, 2, 5, 10].map((m) => m * base).find((m) => m >= peak) ?? 10 * base;
  return { max: step, ticks: [0, step / 2, step] };
}

/** Tokens in a compact form: `980`, `12.4K`, `3.1M`, `12.4B`. */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${unit}`;
    }
  }
  return String(Math.round(n));
}

