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
import { chat } from "$lib/bridge/chat.svelte";
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

function commands(extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
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

  it("lists every paired phone and renames one in place", async () => {
    bridge.applyStatus({ state: "connected", bridgeVersion: "1", instanceId: "i", managed: false });
    chat.settings = { home: "/Users/me", name: "Studio", relay: null };
    chat.devices = [
      {
        deviceId: "p1",
        displayName: "Pixel 9",
        publicKey: "k",
        pairedAt: 1,
        model: "Google Pixel 9",
        platform: "android",
        osVersion: "16",
        appVersion: "0.0.23",
      },
      { deviceId: "p2", displayName: "Old phone", publicKey: "k", pairedAt: 1 },
    ];
    chat.clients = [{ id: "p1", kind: "phone", name: "Pixel 9", since: 1 }];
    const { screen, backend, user } = mountWithProviders(BridgeSettings, {
      commands: commands({
        bridge_call: (args: Record<string, unknown>) =>
          args.method === "device/rename"
            ? { deviceId: "p1", displayName: "Work phone", publicKey: "k", pairedAt: 1 }
            : {},
      }),
    });
    expect(screen.getByText("Pixel 9")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Google Pixel 9 · Android 16 · Uxnan 0.0.23")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect((screen.getByLabelText("Computer name") as HTMLInputElement).value).toBe("Studio");

    await user.click(screen.getAllByRole("button", { name: "Rename" })[0]!);
    const field = screen.getByRole("textbox", { name: "Rename" }) as HTMLInputElement;
    await user.clear(field);
    await user.type(field, "Work phone{Enter}");
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toMatchObject({
      method: "device/rename",
      params: { deviceId: "p1", name: "Work phone" },
    });
    await until(() => screen.queryByText("Work phone") !== null);
    bridge.applyStatus({ state: "off" });
  });

  it("says how each connected phone reaches the bridge", () => {
    bridge.applyStatus({ state: "connected", bridgeVersion: "1", instanceId: "i", managed: false });
    chat.settings = { home: "/Users/me", name: "Studio", relay: null };
    chat.devices = [
      { deviceId: "p1", displayName: "Pixel 9", publicKey: "k", pairedAt: 1 },
      { deviceId: "p2", displayName: "Work iPhone", publicKey: "k", pairedAt: 1 },
      { deviceId: "p3", displayName: "Tablet", publicKey: "k", pairedAt: 1 },
      { deviceId: "p4", displayName: "Old phone", publicKey: "k", pairedAt: 1 },
    ];
    chat.clients = [
      { id: "p1", kind: "phone", name: "Pixel 9", since: 1, route: "lan" },
      { id: "p2", kind: "phone", name: "Work iPhone", since: 1, route: "relay" },
      // A bridge that predates `route` says nothing — and neither does the row.
      { id: "p3", kind: "phone", name: "Tablet", since: 1 },
    ];
    const { container } = mountWithProviders(BridgeSettings, { commands: commands() }).screen;
    const routes = Array.from(container.querySelectorAll("[data-route]")).map((el) => [
      el.getAttribute("data-route"),
      el.textContent?.trim(),
      el.getAttribute("title"),
    ]);
    expect(routes).toEqual([
      ["lan", "LAN", "Connected on the same network"],
      ["relay", "Relay", "Connected through your relay"],
    ]);
    bridge.applyStatus({ state: "off" });
  });
});
