/**
 * The Bridge row under Search: the bridge's state as a badge whose own colour
 * is the signal, the number of phones connected right now; a click opens the
 * Bridge window.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders } from "../../test/render";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import { bridgeInstall } from "$lib/bridge/install.svelte";
import { bridgePanel } from "$lib/bridge/bridgePanel.svelte";
import type { BridgeStatus } from "$shared/models/session";
import SidebarBridgeRow from "./SidebarBridgeRow.svelte";

const on = () =>
  bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.32", instanceId: "i", managed: true });

const withUpdate = (available: boolean): BridgeStatus => ({
  version: "0.0.32",
  relayConnected: false,
  lanEnabled: true,
  activeSessions: 0,
  platform: "darwin",
  uptimeMs: 1,
  update: {
    version: "0.0.32",
    latestVersion: available ? "0.0.33" : "0.0.32",
    available,
    canApply: true,
    phase: "idle",
  },
});

afterEach(() => {
  chat.clients = [];
  bridgeInstall.status = null;
  bridgePanel.open = false;
  bridge.applyStatus({ state: "off" });
});

describe("SidebarBridgeRow", () => {
  const badge = () => document.querySelector('[data-slot="badge"]')!;

  it("says the bridge is stopped, in red, and opens the Bridge window", async () => {
    const { screen, user } = mountWithProviders(SidebarBridgeRow);
    const row = screen.getByRole("button", { name: /Bridge/ });
    expect(badge().textContent?.trim()).toBe("Stopped");
    expect(badge().className).toContain("bg-red-500/15");
    await user.click(row);
    expect(bridgePanel.open).toBe(true);
  });

  it("counts the phones connected now beside an online badge", () => {
    on();
    bridgeInstall.status = withUpdate(false);
    chat.clients = [
      { id: "a", kind: "phone", name: "A55", since: 1 },
      { id: "b", kind: "phone", name: "Pixel", since: 1 },
      { id: "local:desktop-x", kind: "desktop", name: "Mac", since: 1 },
    ];
    const { screen } = mountWithProviders(SidebarBridgeRow);
    const row = screen.getByRole("button", { name: /Bridge/ });
    expect(row.textContent).toContain("Online");
    expect(badge().className).toContain("bg-emerald-500/15");
    expect(screen.getByLabelText("2 phone(s) connected").textContent?.trim()).toBe("2");
  });

  it("turns the badge blue when a newer bridge is out", () => {
    on();
    bridgeInstall.status = withUpdate(true);
    const { screen } = mountWithProviders(SidebarBridgeRow);
    const row = screen.getByRole("button", { name: /Bridge/ });
    expect(badge().textContent?.trim()).toBe("New version");
    expect(badge().className).toContain("bg-sky-500/15");
    expect(row.getAttribute("title")).toBe("Update the bridge to 0.0.33");
  });

  it("turns it amber when the bridge needs a look", () => {
    bridge.applyStatus({ state: "unavailable", reason: "outdated", detail: null });
    mountWithProviders(SidebarBridgeRow);
    expect(badge().textContent?.trim()).toBe("Attention");
    expect(badge().className).toContain("bg-amber-500/15");
  });

  it("turns it red when an update failed, and says why", () => {
    on();
    bridgeInstall.status = {
      ...withUpdate(true),
      update: { ...withUpdate(true).update!, phase: "failed", failure: { reason: "permission", message: "EACCES" } },
    };
    const { screen } = mountWithProviders(SidebarBridgeRow);
    expect(badge().textContent?.trim()).toBe("Failed");
    expect(badge().className).toContain("bg-red-500/15");
    expect(screen.getByRole("button", { name: /Bridge/ }).getAttribute("title")).toBe("EACCES");
  });
});
