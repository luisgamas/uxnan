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
