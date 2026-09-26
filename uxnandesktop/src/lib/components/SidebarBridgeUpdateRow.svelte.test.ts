/**
 * The bridge-update row under the phone: absent while the bridge is current,
 * a one-click update when a newer one is published, busy while it updates.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWithProviders } from "../../test/render";
import { installFakeBackend } from "../../test/tauri";
import { bridge } from "$lib/bridge/client.svelte";
import { bridgeInstall } from "$lib/bridge/install.svelte";
import type { BridgeStatus } from "$shared/models/session";
import SidebarBridgeUpdateRow from "./SidebarBridgeUpdateRow.svelte";

const STATUS: BridgeStatus = {
  version: "0.0.29",
  relayConnected: false,
  lanEnabled: true,
  activeSessions: 0,
  platform: "darwin",
  uptimeMs: 1,
  update: { version: "0.0.29", latestVersion: "0.0.30", available: true, canApply: true, phase: "idle" },
};

afterEach(() => {
  bridgeInstall.status = null;
  bridgeInstall.pendingVersion = null;
  bridge.applyStatus({ state: "off" });
});

describe("SidebarBridgeUpdateRow", () => {
  it("stays out of the sidebar while the bridge is current", () => {
    bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.30", instanceId: "i", managed: true });
    bridgeInstall.status = { ...STATUS, update: { ...STATUS.update!, available: false } };
    const { screen } = mountWithProviders(SidebarBridgeUpdateRow);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks the bridge to update itself in one click", async () => {
    bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.29", instanceId: "i", managed: true });
    bridgeInstall.status = STATUS;
    const { screen, user } = mountWithProviders(SidebarBridgeUpdateRow);
    const calls: string[] = [];
    installFakeBackend({
      bridge_call: (args) => {
        calls.push(String(args.method));
        return { ...STATUS.update, phase: "updating", targetVersion: "0.0.30" };
      },
    });
    await user.click(screen.getByRole("button", { name: /Update the bridge to 0\.0\.30/ }));
    await vi.waitFor(() => expect(calls).toEqual(["bridge/update"]));
    expect(await screen.findByRole("button", { name: /Updating the bridge/ })).toBeTruthy();
  });
});
