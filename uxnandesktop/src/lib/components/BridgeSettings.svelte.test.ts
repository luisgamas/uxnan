/**
 * Settings → Bridge & mobile: an ordinary settings pane (the mode in the
 * settings' combobox, the state as a status dot, the command in a code block),
 * and the states that used to be silent — a running bridge too old to talk to
 * the desktop, one running without the channel of the version installed — each
 * with the one action that fixes it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import BridgeSettings from "./BridgeSettings.svelte";

vi.mock("$lib/toast", () => ({
  toast: { success: () => undefined, error: () => undefined },
  toastError: () => undefined,
  errorMessage: (e: unknown) => String(e),
}));

const INSTALLED_OLD = {
  installed: true,
  version: null,
  npm: true,
  nodeVersion: "v22.1.0",
  command: "npm install -g uxnan-bridge@latest",
};

function commands(extra: Record<string, () => unknown> = {}) {
  return {
    bridge_install_probe: () => INSTALLED_OLD,
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
    ...extra,
  };
}

beforeEach(() => {
  document.body.style.pointerEvents = "";
  app.settings.bridge = { mode: "managed" };
});

describe("BridgeSettings", () => {
  it("picks the connection mode from the settings combobox and persists it", async () => {
    bridge.applyStatus({ state: "off" });
    const { screen, backend, user } = mountWithProviders(BridgeSettings, { commands: commands() });
    await user.click(screen.getByRole("combobox"));
    // The list renders in a portal: find the option there by its text.
    await user.click(await screen.findByText("Use a running bridge"));
    await until(() => backend.called("update_settings"));
    const sent = backend.lastCallTo("update_settings")?.args.settings as { bridge?: { mode: string } };
    expect(sent.bridge?.mode).toBe("attach");
  });

  it("says a running bridge is too old and offers the update and the command", async () => {
    bridge.applyStatus({
      state: "unavailable",
      reason: "outdated",
      detail: "a bridge is running (pid 42) but predates the desktop channel",
    });
    const { screen } = mountWithProviders(BridgeSettings, { commands: commands() });
    expect(screen.getByText("The running bridge is too old to talk to Uxnan Desktop: update it.")).toBeTruthy();
    await until(() => screen.queryByRole("button", { name: "Update" }) !== null);
    expect(screen.getByText("npm install -g uxnan-bridge@latest")).toBeTruthy();
  });

  it("restarts a bridge running without the channel of the version installed", async () => {
    bridge.applyStatus({ state: "unavailable", reason: "channelOff", detail: null });
    const { screen, backend, user } = mountWithProviders(BridgeSettings, {
      commands: commands({ bridge_restart: () => null }),
    });
    await user.click(screen.getByRole("button", { name: "Restart the bridge" }));
    await until(() => backend.called("bridge_restart"));
    bridge.applyStatus({ state: "off" });
  });
});
