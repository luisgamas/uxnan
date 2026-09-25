/**
 * The phone row under Search: an invitation until a phone is paired, then the
 * phone by name and whether it is connected; a click opens "Connect a phone".
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders } from "../../test/render";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import { connectPhone } from "$lib/bridge/connectPhone.svelte";
import SidebarPhoneRow from "./SidebarPhoneRow.svelte";

afterEach(() => {
  chat.devices = [];
  chat.clients = [];
  connectPhone.open = false;
  bridge.applyStatus({ state: "off" });
});

describe("SidebarPhoneRow", () => {
  it("invites to connect a phone until one is paired", async () => {
    const { screen, user } = mountWithProviders(SidebarPhoneRow);
    await user.click(screen.getByRole("button", { name: /Connect a phone/ }));
    expect(connectPhone.open).toBe(true);
  });

  it("names the paired phone, the connected one first, and counts the rest", () => {
    bridge.applyStatus({ state: "connected", bridgeVersion: "1", instanceId: "i", managed: true });
    chat.devices = [
      { deviceId: "a", displayName: "Old phone", publicKey: "k", pairedAt: 1 },
      { deviceId: "b", displayName: "A55 de Luis", publicKey: "k", pairedAt: 2 },
    ];
    chat.clients = [{ id: "b", kind: "phone", name: "A55 de Luis", since: 1 }];
    const { screen } = mountWithProviders(SidebarPhoneRow);
    const row = screen.getByRole("button", { name: /A55 de Luis \+1/ });
    expect(row.getAttribute("title")).toBe("A55 de Luis is connected");
  });
});
