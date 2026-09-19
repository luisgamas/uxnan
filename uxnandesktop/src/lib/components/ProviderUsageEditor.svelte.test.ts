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

describe("ProviderUsageEditor — OS credential store access", () => {
  // The poller never opens an OS dialog; the only interactive read is the one
  // the user asks for with this button, and a successful grant re-reads usage.
  it("offers Grant access on accessRequired and refreshes once granted", async () => {
    const onrefresh = vi.fn();
    const { screen, user, backend } = mountWithProviders(ProviderUsageEditor, {
      props: {
        config: config(),
        snapshot: snapshot({
          status: "accessRequired",
          message: "Claude Code keeps its sign-in in the macOS Keychain",
        }),
        onchange: () => {},
        onremove: () => {},
        onrefresh,
      },
      commands: { usage_grant_access: () => undefined },
    });

    const button = await screen.findByRole("button", { name: "Grant access" });
    await user.click(button);

    expect(backend.lastCallTo("usage_grant_access")?.args).toEqual({ provider: "claude" });
    expect(onrefresh).toHaveBeenCalledTimes(1);
  });

  it("shows no grant button for the other non-live states", async () => {
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
