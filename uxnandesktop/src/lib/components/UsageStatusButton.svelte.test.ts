import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { usage } from "$lib/state/usage.svelte";
import { DEFAULT_SETTINGS } from "$lib/types";
import UsageStatusButton from "./UsageStatusButton.svelte";

/** The popover renders into a portal that role queries do not reach in jsdom —
 *  the same access the other status-popover tests use. */
function popoverText(): string {
  return document.querySelector('[data-slot="popover-content"]')?.textContent ?? "";
}

beforeEach(() => {
  if (!globalThis.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      readonly pointerType = "mouse";
      readonly isPrimary = true;
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
  usage.stop();
  usage.loading = false;
  // A Codex config saved by the old native reader, whose window ids the bridge
  // no longer reports: a real account now answers with one monthly window.
  app.settings = {
    ...DEFAULT_SETTINGS,
    usageProviders: [
      {
        provider: "codex",
        refreshMinutes: null,
        statusBar: { show: true, windows: ["primary_window", "secondary_window"] },
      },
    ],
  };
  usage.byProvider = {
    codex: {
      provider: "codex",
      status: "ok",
      windows: [{ id: "monthly", label: "Monthly", usedPercent: 95, windowMinutes: 43_200 }],
      updatedAt: Date.now(),
    },
  };
});

describe("UsageStatusButton", () => {
  it("shows the provider's first window when its saved picks are stale", async () => {
    const { screen, user } = mountWithProviders(UsageStatusButton);
    await user.click(screen.getByRole("button", { name: "AI provider usage" }));
    await until(() => popoverText().includes("Monthly"), { label: "the fallback window" });
    expect(popoverText()).not.toContain("No data");
  });

  // A free Grok account is read fine but has no quota window to meter.
  it("says an account has no quota rather than no data", async () => {
    app.settings = {
      ...DEFAULT_SETTINGS,
      usageProviders: [{ provider: "grok", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } }],
    };
    usage.byProvider = {
      grok: { provider: "grok", status: "ok", windows: [], updatedAt: Date.now() },
    };
    const { screen, user } = mountWithProviders(UsageStatusButton);
    await user.click(screen.getByRole("button", { name: "AI provider usage" }));
    await until(() => popoverText().includes("Grok"), { label: "the Grok row" });
    expect(popoverText()).toContain("No quota to meter for this account");
    expect(popoverText()).not.toContain("No data");
  });

  it("counts the fallback window toward the icon's tint", () => {
    const { screen } = mountWithProviders(UsageStatusButton);
    const trigger = screen.getByRole("button", { name: "AI provider usage" });
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("text-destructive");
  });

  it("shows each provider's plan, money and resets, and why one has no data", async () => {
    app.settings = {
      ...DEFAULT_SETTINGS,
      usageProviders: [
        { provider: "antigravity", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } },
        { provider: "codex", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } },
        { provider: "grok", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } },
      ],
    };
    usage.byProvider = {
      antigravity: {
        provider: "antigravity",
        status: "ok",
        windows: [{ id: "gemini-weekly", label: "Gemini Models", usedPercent: 9 }],
        credits: [
          { used: 0, available: 120, currency: "credits", period: "AI credits" },
          { used: 12.5, limit: 50, currency: "USD", period: "Budget", scope: "Model One" },
        ],
        updatedAt: Date.now(),
      },
      codex: {
        provider: "codex",
        status: "ok",
        account: { plan: "Pro" },
        windows: [{ id: "weekly", label: "Weekly", usedPercent: 12 }],
        resetCredits: { available: 2 },
        updatedAt: Date.now(),
      },
      grok: {
        provider: "grok",
        status: "authRequired",
        windows: [],
        message: "Grok is not signed in on this PC",
        updatedAt: Date.now(),
      },
    };
    const { screen, user } = mountWithProviders(UsageStatusButton);
    await user.click(screen.getByRole("button", { name: "AI provider usage" }));
    await until(() => popoverText().includes("Antigravity"), { label: "the Antigravity block" });
    const text = popoverText();
    // Every balance, worded in the UI language; known window ids localized.
    expect(text).toContain("120 credits available");
    expect(text).toContain("$12.50 / $50.00");
    expect(text).toContain("Budget · Model One");
    expect(text).toContain("Gemini models");
    expect(text).toContain("Pro");
    expect(text).toContain("2 available");
    expect(text).toContain("Grok is not signed in on this PC");
  });

  it("uses a reset only after its confirmation, never on its own", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    app.settings = {
      ...DEFAULT_SETTINGS,
      usageProviders: [{ provider: "codex", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } }],
    };
    usage.byProvider = {
      codex: {
        provider: "codex",
        status: "ok",
        windows: [{ id: "weekly", label: "Weekly", usedPercent: 100 }],
        resetCredits: { available: 1, entries: [{ id: "r1", expiresAt: Date.now() + 86_400_000 }] },
        updatedAt: Date.now(),
      },
    };
    const { screen, user } = mountWithProviders(UsageStatusButton, {
      commands: {
        bridge_call: (args: Record<string, unknown>) => {
          calls.push({ method: String(args.method), params: args.params as Record<string, unknown> });
          return { provider: "codex", status: "ok", windows: [], updatedAt: 1 };
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "AI provider usage" }));
    await until(() => popoverText().includes("1 available"), { label: "the resets row" });
    const use = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].find(
      (b) => b.textContent?.includes("Use…"),
    );
    expect(use).toBeTruthy();
    await user.click(use!);
    // Asked, not done.
    const confirm = await screen.findByRole("button", { name: "Redeem" });
    expect(calls.some((c) => c.method === "usage/redeemReset")).toBe(false);
    await user.click(confirm);
    await vi.waitFor(() => expect(calls.some((c) => c.method === "usage/redeemReset")).toBe(true));
    expect(calls.find((c) => c.method === "usage/redeemReset")!.params.creditId).toBe("r1");
  });
});
