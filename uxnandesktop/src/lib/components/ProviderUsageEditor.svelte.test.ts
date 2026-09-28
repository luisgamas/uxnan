import { describe, expect, it, vi } from "vitest";

import { mountWithProviders } from "../../test/render";
import type { ProviderUsage, UsageProviderConfig } from "$lib/types";
import ProviderUsageEditor from "./ProviderUsageEditor.svelte";

function config(): UsageProviderConfig {
  return { provider: "claude", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } };
}

function snapshot(over: Partial<ProviderUsage>): ProviderUsage {
  return { provider: "claude", status: "ok", windows: [], updatedAt: 1_700_000_000_000, ...over };
}

describe("ProviderUsageEditor — resets", () => {
  // Codex's resets are redeemed by the bridge (asking Codex itself), behind a
  // confirmation, and the card takes the fresh usage it answers with.
  it("redeems the soonest-expiring reset through the bridge", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const { screen, user } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: { provider: "codex", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } },
        snapshot: {
          provider: "codex",
          status: "ok",
          windows: [],
          updatedAt: 1_700_000_000_000,
          resetCredits: {
            available: 2,
            entries: [
              { id: "r1", title: "Full reset", expiresAt: 1_900_000_000_000 },
              { id: "r2", title: "Full reset", expiresAt: 1_950_000_000_000 },
            ],
          },
        },
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
      commands: {
        bridge_call: (args: Record<string, unknown>) => {
          calls.push({ method: String(args.method), params: args.params as Record<string, unknown> });
          return { provider: "codex", status: "ok", windows: [], updatedAt: 1 };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: /Redeem/ }));
    const confirm = await screen.findAllByRole("button", { name: /Redeem/ });
    await user.click(confirm.at(-1)!);
    await vi.waitFor(() => expect(calls.some((c) => c.method === "usage/redeemReset")).toBe(true));
    const sent = calls.find((c) => c.method === "usage/redeemReset")!.params;
    expect(sent.provider).toBe("codex");
    expect(sent.creditId).toBe("r1");
    expect(typeof sent.idempotencyKey).toBe("string");
  });

  it("shows no OS grant flow for any state: the bridge needs none", async () => {
    for (const status of ["authRequired", "notInstalled", "error"] as const) {
      const { screen } = mountWithProviders(ProviderUsageEditor, {
        props: {
          config: config(),
          snapshot: snapshot({ status, message: "x" }),
          onchange: () => {},
          onremove: () => {},
          onrefresh: () => {},
        },
      });
      expect(screen.queryByRole("button", { name: "Grant access" })).toBeNull();
      screen.unmount();
    }
  });
});

describe("ProviderUsageEditor — account", () => {
  // Claude names an organization after its owner's email: it stays hidden
  // with the email until the person reveals the account.
  it("hides the email and an organization named after it until revealed", async () => {
    const { screen, user } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: config(),
        snapshot: snapshot({
          account: { email: "me@x.com", plan: "Max", organization: "me@x.com's Organization" },
        }),
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    const org = screen.getByText("me@x.com's Organization");
    expect(org.className).toContain("blur");
    expect(screen.getByText("me@x.com").className).toContain("blur");
    await user.click(screen.getByRole("button", { name: "Show account" }));
    expect(org.className).not.toContain("blur");
  });

  it("says the limits were asked of the CLI itself", () => {
    const { screen } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: config(),
        snapshot: snapshot({ source: "cli", windows: [{ id: "w", label: "Weekly", usedPercent: 10 }] }),
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    expect(screen.getByText("Asked of Claude Code itself")).toBeTruthy();
  });
});


describe("ProviderUsageEditor — status-bar windows", () => {
  // A Codex config saved by the old native reader names windows that no longer
  // exist; the status bar falls back to the first window, and so does the tick.
  const monthly = { id: "monthly", label: "Monthly", usedPercent: 7, windowMinutes: 43_200 };
  const weekly = { id: "weekly", label: "Weekly", usedPercent: 12, windowMinutes: 10_080 };

  function codex(windows: string[]): UsageProviderConfig {
    return { provider: "codex", refreshMinutes: null, statusBar: { show: true, windows } };
  }

  it("ticks the fallback window when the saved ids are stale", () => {
    const { screen } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: codex(["primary_window", "secondary_window"]),
        snapshot: { ...snapshot({ windows: [monthly] }), provider: "codex" },
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    expect(screen.getByRole("checkbox", { name: "Monthly" }).getAttribute("aria-checked")).toBe("true");
  });

  it("drops stale ids when a toggle writes the choice back", async () => {
    const cfg = codex(["primary_window", "secondary_window"]);
    const onchange = vi.fn();
    const { screen, user } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: cfg,
        snapshot: { ...snapshot({ windows: [monthly, weekly] }), provider: "codex" },
        onchange,
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    await user.click(screen.getByRole("checkbox", { name: "Weekly" }));
    expect(onchange).toHaveBeenCalled();
    expect(cfg.statusBar.windows).toEqual(["monthly", "weekly"]);
  });
});
