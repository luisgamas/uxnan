import { describe, expect, it } from "vitest";
import type { UsageSummary } from "$lib/types";
import { formatTokens, niceScale, periodDays, spendView, tokensOf } from "./usageSpend";

const spend = (over: Partial<Record<string, number>> = {}) => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  estimatedCostUsd: 0,
  unpricedTokens: 0,
  responses: 1,
  ...over,
});

const today = new Date(2026, 8, 26, 15, 0);

const summary: UsageSummary = {
  days: [
    {
      day: "2026-09-25",
      buckets: [
        { agentId: "claude-code", model: "claude-opus-5-5", ...spend({ inputTokens: 100, outputTokens: 50, costUsd: 3, estimatedCostUsd: 3 }) },
        { agentId: "codex", model: "gpt-5.6-luna", ...spend({ inputTokens: 400, unpricedTokens: 400 }) },
      ],
    },
    {
      day: "2026-09-26",
      buckets: [{ agentId: "claude-code", model: "claude-opus-5-5", ...spend({ outputTokens: 10, costUsd: 1, estimatedCostUsd: 1 }) }],
    },
    // Outside a 7-day period ending on the 26th.
    { day: "2026-09-01", buckets: [{ agentId: "grok", model: "grok-4.7", ...spend({ outputTokens: 9, costUsd: 9 }) }] },
  ],
  agents: [
    { agentId: "claude-code", sessions: 3, status: "ok" },
    { agentId: "codex", sessions: 1, status: "ok" },
  ],
};

describe("spendView", () => {
  it("lists every day of the period, spent or not, oldest first", () => {
    expect(periodDays(3, today)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
    const view = spendView(summary, 7, "cost", today);
    expect(view.days).toHaveLength(7);
    expect(view.days.at(-2)).toEqual({ day: "2026-09-25", byAgent: { "claude-code": 3, codex: 0 }, total: 3 });
    expect(view.peak).toBe(3);
  });

  it("orders agents by their fixed colour slot and gives each its share", () => {
    const byTokens = spendView(summary, 7, "tokens", today);
    expect(byTokens.agents.map((a) => a.agentId)).toEqual(["codex", "claude-code"]);
    expect(byTokens.agents[0]!.share).toBeCloseTo(400 / 560);
    expect(byTokens.agents[1]!.sessions).toBe(3);
    expect(byTokens.sessions).toBe(4);
    expect(tokensOf(byTokens.total)).toBe(560);
    // The grok day falls outside the week.
    expect(byTokens.total.costUsd).toBe(4);
    expect(byTokens.total.unpricedTokens).toBe(400);
  });

  it("ranks models by the metric", () => {
    expect(spendView(summary, 7, "cost", today).models.map((m) => m.model)).toEqual([
      "claude-opus-5-5",
      "gpt-5.6-luna",
    ]);
    expect(spendView(summary, 7, "tokens", today).models[0]!.model).toBe("gpt-5.6-luna");
  });
});

describe("scale and formats", () => {
  it("rounds the scale up to 1, 2 or 5 of a power of ten", () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 0.5, 1] });
    expect(niceScale(3.2).max).toBe(5);
    expect(niceScale(170).max).toBe(200);
    expect(niceScale(9_000_000).max).toBe(10_000_000);
  });

  it("writes tokens compactly", () => {
    expect(formatTokens(980)).toBe("980");
    expect(formatTokens(12_400)).toBe("12.4K");
    expect(formatTokens(12_427_029_384)).toBe("12.4B");
    expect(formatTokens(150_000_000)).toBe("150M");
  });
});
