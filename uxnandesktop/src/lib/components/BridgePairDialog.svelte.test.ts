/**
 * "Connect a phone": turn the bridge on when it is off, show its QR at once,
 * notice the phone arrive — and keep the dialog's own layout, so the action
 * band spans it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../test/render";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import { app } from "$lib/state/app.svelte";
import BridgePairDialog from "./BridgePairDialog.svelte";

const QR = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const qr = () => ({ svg: QR, expiresAt: Date.now() + 120_000 });
const on = () =>
  bridge.applyStatus({ state: "connected", bridgeVersion: "1", instanceId: "i", managed: true });

afterEach(() => {
  bridge.applyStatus({ state: "off" });
  chat.devices = [];
  chat.clients = [];
});

describe("BridgePairDialog", () => {
  it("draws the running bridge's QR at once", async () => {
    on();
    const { screen } = mountWithProviders(BridgePairDialog, {
      props: { open: true },
      commands: { bridge_pairing_qr: qr },
    });
    await until(() => screen.queryByRole("img") !== null);
    expect(screen.getByRole("img").querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/Waiting for your phone/)).toBeTruthy();
  });

  it("says why when there is no QR to show", async () => {
    on();
    const { screen } = mountWithProviders(BridgePairDialog, {
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
    const { screen, user, backend } = mountWithProviders(BridgePairDialog, {
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
    const { screen } = mountWithProviders(BridgePairDialog, {
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
    expect(screen.getByText("A55 de Luis")).toBeTruthy();
    expect(screen.getByText("samsung SM-A556E · Android 16")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pair another" })).toBeTruthy();
  });

  it("keeps the dialog's own layout, so the action band spans it", async () => {
    on();
    mountWithProviders(BridgePairDialog, {
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
