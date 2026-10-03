/**
 * The Bridge window: its state and update, the devices on it, and "Connect a
 * phone" — turn the bridge on when it is off, show its QR at once, notice the
 * phone arrive — keeping the dialog's own layout, so the action band spans it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../test/render";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import { app } from "$lib/state/app.svelte";
import { bridgeInstall } from "$lib/bridge/install.svelte";
import BridgeDialog from "./BridgeDialog.svelte";

const QR = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const qr = () => ({ svg: QR, expiresAt: Date.now() + 120_000 });
const on = () =>
  bridge.applyStatus({ state: "connected", bridgeVersion: "1", instanceId: "i", managed: true });

afterEach(() => {
  bridge.applyStatus({ state: "off" });
  chat.devices = [];
  chat.clients = [];
  bridgeInstall.status = null;
});

describe("BridgeDialog", () => {
  it("draws the running bridge's QR at once", async () => {
    on();
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByRole("img") !== null);
    expect(screen.getByRole("img").querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/Waiting for your phone/)).toBeTruthy();
  });

  it("offers the bridge's manual code under the QR, and copies it", async () => {
    on();
    const { screen, user, backend } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: {
        bridge_pairing_qr: () => ({ ...qr(), code: "ABCD-EFGH" }),
        "plugin:clipboard-manager|write_text": () => null,
      },
    });
    await until(() => screen.queryByText("ABCD-EFGH") !== null);
    expect(screen.getByText("Or type this code in the app:")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    await until(() => backend.called("plugin:clipboard-manager|write_text"));
  });

  it("shows the QR alone when the bridge has no code to give", async () => {
    on();
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByRole("img") !== null);
    expect(screen.queryByText("Or type this code in the app:")).toBeNull();
  });

  it("says why when there is no QR to show", async () => {
    on();
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: {
        bridge_pairing_qr: () => {
          throw { message: "no bridge running" };
        },
      },
    });
    await until(() => screen.queryByText("no bridge running") !== null);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("turns the bridge on as a service when it is off", async () => {
    app.settings.bridge = { mode: "off" };
    const { screen, user, backend } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: {
        bridge_pairing_qr: qr,
        update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
      },
    });
    await user.click(screen.getByRole("button", { name: "Turn on the bridge" }));
    await until(() => backend.called("update_settings"));
    const sent = backend.lastCallTo("update_settings")?.args.settings as {
      bridge?: { mode: string };
    };
    expect(sent.bridge?.mode).toBe("managed");
  });

  it("notices a newly paired phone and names it", async () => {
    on();
    chat.devices = [{ deviceId: "old", displayName: "Old phone", publicKey: "k", pairedAt: 1 }];
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByRole("img") !== null);
    chat.devices = [
      ...chat.devices,
      {
        deviceId: "new",
        displayName: "A55 de Luis",
        publicKey: "k",
        pairedAt: 2,
        model: "samsung SM-A556E",
        platform: "android",
        osVersion: "16",
      },
    ];
    await until(() => screen.queryByText("Phone connected") !== null);
    // Named in the success card, and listed with the other devices.
    expect(screen.getAllByText("A55 de Luis").length).toBe(2);
    expect(screen.getAllByText("samsung SM-A556E · Android 16").length).toBe(2);
    expect(screen.getByRole("button", { name: "Pair another" })).toBeTruthy();
  });

  it("lists the devices on the bridge and whether each is connected", async () => {
    on();
    chat.devices = [
      { deviceId: "a", displayName: "A55 de Luis", publicKey: "k", pairedAt: 1 },
      { deviceId: "b", displayName: "Old phone", publicKey: "k", pairedAt: 2 },
    ];
    chat.clients = [
      { id: "a", kind: "phone", name: "A55 de Luis", since: 1 },
      { id: "local:desktop-x", kind: "desktop", name: "MacBook", since: 1 },
    ];
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByText("Devices") !== null);
    const row = (name: string) => screen.getByText(name).closest("li")!;
    expect(row("A55 de Luis").textContent).toContain("Connected");
    expect(row("Old phone").textContent).toContain("Not connected");
    expect(row("MacBook").textContent).toContain("Connected");
    // An older bridge sends no route: the row says nothing about one.
    expect(row("A55 de Luis").querySelector("[data-route]")).toBeNull();
  });

  it("says how each connected phone reaches the bridge", async () => {
    on();
    chat.devices = [
      { deviceId: "a", displayName: "A55 de Luis", publicKey: "k", pairedAt: 1 },
      { deviceId: "b", displayName: "Work iPhone", publicKey: "k", pairedAt: 2 },
    ];
    chat.clients = [
      { id: "a", kind: "phone", name: "A55 de Luis", since: 1, route: "tailscale" },
      { id: "b", kind: "phone", name: "Work iPhone", since: 1, route: "relay" },
    ];
    const { screen } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByText("Devices") !== null);
    const row = (name: string) => screen.getByText(name).closest("li")!;
    expect(row("A55 de Luis").querySelector("[data-route]")?.textContent?.trim()).toBe("Tailscale");
    expect(row("Work iPhone").querySelector("[data-route]")?.textContent?.trim()).toBe("Relay");
  });

  it("offers a newer bridge and asks the bridge to update itself", async () => {
    on();
    bridgeInstall.status = {
      version: "0.0.32",
      relayConnected: false,
      lanEnabled: true,
      activeSessions: 0,
      platform: "darwin",
      uptimeMs: 1,
      update: {
        version: "0.0.32",
        latestVersion: "0.0.33",
        available: true,
        canApply: true,
        phase: "idle",
      },
    };
    const calls: string[] = [];
    const { screen, user } = mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: {
        bridge_pairing_qr: qr,
        bridge_call: (args) => {
          calls.push(String(args.method));
          return { version: "0.0.32", available: true, canApply: true, phase: "updating", targetVersion: "0.0.33" };
        },
      },
    });
    expect(screen.getByText("Bridge 0.0.33 is available")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update" }));
    await until(() => calls.includes("bridge/update"));
  });

  it("keeps the dialog's own layout, so the action band spans it", async () => {
    on();
    mountWithProviders(BridgeDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => document.querySelector('[data-slot="dialog-footer"]') !== null);
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    const footer = document.querySelector('[data-slot="dialog-footer"]')!;
    // The band's full bleed (`-mx-5`) is sized by the content grid; a flex
    // column or a `w-full` on the band leaves it a column's width, short of
    // the dialog's right edge.
    expect(content.className).toContain("grid");
    expect(content.className).not.toMatch(/\bflex-col\b/);
    expect(footer.className).not.toMatch(/\bw-full\b/);
  });
});
