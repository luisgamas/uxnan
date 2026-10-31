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

  // Claude Code spends its resets only through its own interactive command:
  // listed, with how to use them, and never a button that would call the bridge.
  it("lists Claude Code's resets and says to use them with /limit-reset", async () => {
    const calls: string[] = [];
    const { screen } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: { provider: "claude", refreshMinutes: null, statusBar: { show: true, windows: ["*"] } },
        snapshot: {
          provider: "claude",
          status: "ok",
          windows: [],
          updatedAt: 1,
          resetCredits: {
            available: 1,
            entries: [{ id: "g-1", title: "Full reset", expiresAt: Date.now() + 3 * 86_400_000 }],
            redeemCommand: "/limit-reset",
          },
        },
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
      commands: {
        bridge_call: (args: Record<string, unknown>) => {
          calls.push(String(args.method));
          return {};
        },
      },
    });
    expect(await screen.findByText("Full reset")).toBeTruthy();
    expect(screen.getByText("Use one in Claude Code with /limit-reset.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Redeem/ })).toBeNull();
    expect(calls).not.toContain("usage/redeemReset");
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

  it("names the CLI each provider is asked through, and shows the plan", () => {
    const { screen } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: { provider: "copilot", refreshMinutes: null, statusBar: { show: false, windows: [] } },
        snapshot: {
          ...snapshot({ source: "cli", windows: [] }),
          provider: "copilot",
          account: { plan: "Copilot Free" },
        },
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    expect(screen.getByText("Asked of GitHub CLI (gh) itself")).toBeTruthy();
    expect(screen.getAllByText("Copilot Free").length).toBeGreaterThan(0);
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

  it("says the plan once — no account-type badge repeating it", () => {
    const { screen } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: { provider: "grok", refreshMinutes: null, statusBar: { show: false, windows: [] } },
        snapshot: {
          ...snapshot({ source: "cli", windows: [] }),
          provider: "grok",
          account: { plan: "Free", accountType: "free" },
        },
        onchange: () => {},
        onremove: () => {},
        onrefresh: () => {},
      },
    });
    expect(screen.getAllByText("Free")).toHaveLength(1);
  });
});
