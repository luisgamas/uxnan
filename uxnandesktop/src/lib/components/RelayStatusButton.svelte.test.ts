/**
 * The status bar's relay indicator: hidden until a relay is set up, its icon
 * says the state at a glance, and its popover gives the detail — the bridge's
 * own words when it failed, the address, the phones on the relay (by name,
 * from presence), the version, and the way into Settings → Remote access,
 * where every change (an update included) is made.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import { relay } from "$lib/bridge/relay.svelte";
import type { RelayStatus } from "$shared/models/relay";
import RelayStatusButton from "./RelayStatusButton.svelte";

const ENDPOINT = { url: "wss://uxnan-relay.me.workers.dev", routingId: "f".repeat(32), enabled: true };

function relayStatus(extra: Partial<RelayStatus> = {}): RelayStatus {
  return {
    endpoint: ENDPOINT,
    provider: "cloudflare",
    state: "connected",
    bundledVersion: "0.2.0",
    deployedVersion: "0.2.0",
    tokenRemembered: false,
    connectedPhones: 0,
    hostKey: "ab".repeat(32),
    ...extra,
  };
}

/** The popover renders into a portal that role queries do not reach in jsdom —
 *  the same access the other status-popover tests use. */
function popover(): HTMLElement | null {
  return document.querySelector('[data-slot="popover-content"]');
}
function popoverText(): string {
  return popover()?.textContent ?? "";
}
function popoverButton(match: RegExp): HTMLElement | null {
  return (
    (Array.from(popover()?.querySelectorAll("button") ?? []).find((b) =>
      match.test(b.textContent ?? ""),
    ) as HTMLElement | undefined) ?? null
  );
}

async function openPopover(screen: ReturnType<typeof mountWithProviders>["screen"], user: ReturnType<typeof mountWithProviders>["user"]) {
  await user.click(screen.getByRole("button", { name: /^Relay · / }));
  await until(() => popover() !== null, { label: "the relay popover" });
}

beforeEach(() => {
  if (!globalThis.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      readonly pointerType = "mouse";
      readonly isPrimary = true;
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
  document.body.style.pointerEvents = "";
  bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.44", instanceId: "i", managed: true });
  relay.supported = true;
  relay.status = relayStatus();
  chat.devices = [];
  chat.clients = [];
  app.settingsOpen = false;
});

describe("RelayStatusButton", () => {
  it("stays out of the status bar until a relay is set up", () => {
    relay.status = relayStatus({ endpoint: null, provider: undefined, state: "off" });
    const { screen } = mountWithProviders(RelayStatusButton);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays out of the status bar without a bridge, or with one too old for a relay", () => {
    bridge.applyStatus({ state: "off" });
    const first = mountWithProviders(RelayStatusButton);
    expect(first.screen.queryByRole("button")).toBeNull();
    first.screen.unmount();

    bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.20", instanceId: "i", managed: true });
    relay.supported = false;
    const second = mountWithProviders(RelayStatusButton);
    expect(second.screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["connected", "Relay · Connected"],
    ["connecting", "Relay · Connecting…"],
    ["error", "Relay · Can't connect"],
    ["off", "Relay · Off"],
  ] as const)("names the %s state on the trigger", (state, label) => {
    relay.status = relayStatus({ state, endpoint: { ...ENDPOINT, enabled: state !== "off" } });
    const { screen } = mountWithProviders(RelayStatusButton);
    const trigger = screen.getByRole("button", { name: label });
    expect(trigger.getAttribute("data-relay-state")).toBe(state);
  });

  it("counts the phones on the relay on the trigger and names them in the popover", async () => {
    relay.status = relayStatus({ connectedPhones: 1 });
    chat.devices = [
      { deviceId: "p1", displayName: "Pixel 9", publicKey: "k", pairedAt: 1 },
      { deviceId: "p2", displayName: "Work iPhone", publicKey: "k", pairedAt: 1 },
    ];
    chat.clients = [
      { id: "p1", kind: "phone", name: "Pixel 9", since: 1, route: "lan" },
      { id: "p2", kind: "phone", name: "iPhone", since: 1, route: "relay" },
      { id: "local:x", kind: "desktop", name: "MacBook", since: 1 },
    ];
    const { screen, user } = mountWithProviders(RelayStatusButton);
    expect(screen.getByRole("button", { name: "Relay · Connected · 1 phone connected through it" })).toBeTruthy();

    await openPopover(screen, user);
    const text = popoverText();
    expect(text).toContain("Your relay");
    expect(text).toContain("wss://uxnan-relay.me.workers.dev");
    expect(text).toContain("Phones through it");
    // The relay phone by the name every client uses; the LAN one is not on it.
    expect(text).toContain("Work iPhone");
    expect(text).not.toContain("Pixel 9");
    expect(text).toContain("0.2.0");
    expect(text).not.toContain("Update relay");
  });

  it("says no phone is on it when none is", async () => {
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    expect(popoverText()).toContain("No phone is using it right now");
  });

  it("shows the bridge's own words when the relay cannot connect", async () => {
    relay.status = relayStatus({
      state: "error",
      lastError: "The relay refused this computer's key. Add it to UXNAN_HOST_KEYS.",
    });
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    const alert = popover()?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The relay refused this computer's key.");
    expect(popoverText()).not.toContain("Phones through it");
  });

  it("explains what turning it off means", async () => {
    relay.status = relayStatus({ state: "off", endpoint: { ...ENDPOINT, enabled: false } });
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    expect(popoverText()).toContain("only on the same network or over Tailscale");
  });

  it("offers a newer relay and takes the update to Settings → Remote access", async () => {
    relay.status = relayStatus({ deployedVersion: "0.1.0", bundledVersion: "0.2.0" });
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    expect(popoverText()).toContain("0.1.0");
    expect(popoverText()).toContain("Relay 0.2.0 is available");

    await user.click(popoverButton(/Update relay/)!);
    expect(app.settingsOpen).toBe(true);
    expect(app.settingsSection).toBe("bridge");
  });

  it("does not offer to update a relay deployed by hand", async () => {
    relay.status = relayStatus({ provider: "custom", deployedVersion: "0.1.0", bundledVersion: "0.2.0" });
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    expect(popoverText()).not.toContain("Update relay");
    expect(popoverText()).toContain("update the relay where you deployed it");
  });

  it("opens Settings at Remote access", async () => {
    const { screen, user } = mountWithProviders(RelayStatusButton);
    await openPopover(screen, user);
    await user.click(popoverButton(/Remote access settings/)!);
    expect(app.settingsOpen).toBe(true);
    expect(app.settingsSection).toBe("bridge");
  });
});
