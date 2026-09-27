import { afterEach, describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import { bridge } from "$lib/bridge/client.svelte";
import { usage } from "$lib/state/usage.svelte";
import { periodDays } from "$lib/usageSpend";
import type { UsageBucket, UsageSummary } from "$lib/types";
import ProviderSpend from "./ProviderSpend.svelte";

function bucket(agentId: string, model: string, over: Partial<UsageBucket>): UsageBucket {
  return {
    agentId,
    model,
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
  };
}

// The shape the bridge answers `usage/summary` with: a priced Claude day and
// a Codex day with no known price.
function summary(): UsageSummary {
  const days = periodDays(30);
  return {
    days: [
      {
        day: days.at(-1)!,
        buckets: [
          bucket("claude-code", "claude-opus-5-5", { inputTokens: 1000, outputTokens: 500, costUsd: 12.5, estimatedCostUsd: 12.5 }),
          bucket("codex", "gpt-6", { inputTokens: 4000, outputTokens: 1000, unpricedTokens: 5000 }),
        ],
      },
    ],
    agents: [
      { agentId: "claude-code", sessions: 3, status: "ok" },
      { agentId: "codex", sessions: 2, status: "ok" },
    ],
  } as UsageSummary;
}

function connect(): void {
  bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.33", instanceId: "i", managed: true });
}

afterEach(() => {
  bridge.applyStatus({ state: "off" });
  usage.spend = null;
  usage.spendError = null;
});

describe("ProviderSpend", () => {
  it("asks for the bridge when it is not running", async () => {
    const { screen } = mountWithProviders(ProviderSpend, { props: {} });
    expect(await screen.findByText(/Spending is read by the bridge/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open bridge" })).toBeTruthy();
  });

  it("shows the period's cost, each agent and an unpriced agent as such", async () => {
    connect();
    usage.spend = summary();
    const { screen } = mountWithProviders(ProviderSpend, { props: {} });
    expect(await screen.findByText("$12.50", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("5 sessions")).toBeTruthy();
    // Codex spent tokens at no known price: never shown as $0.
    const codex = screen.getByRole("button", { name: /Codex/ });
    expect(codex.textContent).toContain("No price");
    expect(codex.textContent).toContain("5K");
    expect(screen.getByRole("img", { name: /Spend per day/ })).toBeTruthy();
  });

  it("focuses one agent from the legend, and back", async () => {
    connect();
    usage.spend = summary();
    const { screen, user } = mountWithProviders(ProviderSpend, { props: {} });
    const codex = await screen.findByRole("button", { name: /Codex/ });
    await user.click(codex);
    expect(codex.getAttribute("aria-pressed")).toBe("true");
    // The headline follows the focused agent, in tokens since it has no price.
    expect(await screen.findByText(/Codex · Tokens — no known price/)).toBeTruthy();
    expect(screen.queryByText("claude-opus-5-5")).toBeNull();
    await user.click(codex);
    expect(codex.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByText("claude-opus-5-5")).toBeTruthy();
  });

  it("switches to tokens", async () => {
    connect();
    usage.spend = summary();
    const { screen, user } = mountWithProviders(ProviderSpend, { props: {} });
    await user.click(await screen.findByRole("radio", { name: "Tokens" }));
    expect(await screen.findByText("Tokens read and written")).toBeTruthy();
    expect(screen.getByText("6.5K", { selector: "div" })).toBeTruthy();
  });
});
