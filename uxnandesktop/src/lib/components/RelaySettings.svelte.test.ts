/**
 * Settings → Bridge & mobile → Remote access: a client of the bridge's relay.
 * Not set up, it explains the three ways a phone connects and offers the
 * setup; set up, it shows what the bridge reports and asks it for every
 * change. The Cloudflare token only ever travels as a call parameter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { dialogFocusSettled, mountWithProviders, until } from "../../test/render";
import { failsWith } from "../../test/tauri";
import { bridge } from "$lib/bridge/client.svelte";
import { relay } from "$lib/bridge/relay.svelte";
import type { RelayStatus } from "$shared/models/relay";
import RelaySettings from "./RelaySettings.svelte";

vi.mock("$lib/toast", () => ({
  toast: { success: () => undefined, error: () => undefined },
  toastError: () => undefined,
  errorMessage: (e: unknown) => String(e),
}));

const HOST_KEY = "ab".repeat(32);
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-token-0123456789abcdef";
const ENDPOINT = { url: "wss://uxnan-relay.me.workers.dev", routingId: "f".repeat(32), enabled: true };

function relayStatus(extra: Partial<RelayStatus> = {}): RelayStatus {
  return {
    endpoint: null,
    state: "off",
    bundledVersion: "0.2.0",
    tokenRemembered: false,
    connectedPhones: 0,
    hostKey: HOST_KEY,
    ...extra,
  };
}

const CONNECTED: RelayStatus = relayStatus({
  endpoint: ENDPOINT,
  provider: "cloudflare",
  state: "connected",
  deployedVersion: "0.2.0",
  connectedPhones: 2,
});

/** A bridge whose `relay/*` methods answer from `answers` (a function per method). */
function bridgeCall(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  return {
    bridge_call: (args: Record<string, unknown>) => {
      const answer = answers[String(args.method)];
      if (!answer) throw new Error(`unexpected bridge call ${String(args.method)}`);
      return answer((args.params ?? {}) as Record<string, unknown>);
    },
  };
}

beforeEach(() => {
  document.body.style.pointerEvents = "";
  bridge.applyStatus({ state: "connected", bridgeVersion: "0.0.43", instanceId: "i", managed: true });
  relay.supported = true;
  relay.status = relayStatus();
});

describe("RelaySettings", () => {
  it("stays visible but disabled without a bridge", () => {
    bridge.applyStatus({ state: "off" });
    const { screen } = mountWithProviders(RelaySettings);
    expect(screen.getByText("Remote access")).toBeTruthy();
    expect(
      screen.getByText("Remote access is set up through the bridge. Turn it on above to see or change it."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up your relay" })).toBeNull();
  });

  it("says when the running bridge is too old for a relay", () => {
    relay.supported = false;
    relay.status = null;
    const { screen } = mountWithProviders(RelaySettings);
    expect(screen.getByText("The bridge running now is too old for remote access. Update it above.")).toBeTruthy();
  });

  it("explains the three ways a phone connects and shows the key a hand-deployed relay needs", async () => {
    const { screen, user } = mountWithProviders(RelaySettings);
    expect(screen.getByText("Same network")).toBeTruthy();
    expect(screen.getByText("Tailscale")).toBeTruthy();
    expect(screen.getByText("Your own relay")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up your relay" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use a relay you deployed" }));
    expect(await screen.findByText(HOST_KEY)).toBeTruthy();
    expect(screen.getByText(/UXNAN_HOST_KEYS/)).toBeTruthy();
  });

  it("uses a hand-deployed relay by its address", async () => {
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({ "relay/use": () => ({ ...CONNECTED, provider: "custom" }) }),
    });
    await user.click(screen.getByRole("button", { name: "Use a relay you deployed" }));
    await user.type(await screen.findByLabelText("Relay address"), "wss://relay.example.com");
    await user.click(screen.getByRole("button", { name: "Use this relay" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toMatchObject({
      method: "relay/use",
      params: { url: "wss://relay.example.com" },
    });
    expect(await screen.findByText("Deployed by you")).toBeTruthy();
  });

  it("deploys with the account, the token and the keychain choice, then forgets the token", async () => {
    let fail = true;
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({
        "relay/setup": () => {
          if (fail) return failsWith("BRIDGE_ERROR", "Cloudflare refused the token. (-32602)")({});
          return CONNECTED;
        },
      }),
    });
    await user.click(screen.getByRole("button", { name: "Set up your relay" }));
    await dialogFocusSettled(screen);
    expect(screen.getByText(/Edit Cloudflare Workers/)).toBeTruthy();
    const deploy = screen.getByRole("button", { name: "Deploy" }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);

    await user.type(screen.getByLabelText("Account ID"), ACCOUNT);
    const token = screen.getByLabelText("API token") as HTMLInputElement;
    expect(token.type).toBe("password");
    await user.type(token, TOKEN);
    const remember = screen.getByRole("checkbox", { name: /Remember the token/ });
    expect(remember.getAttribute("aria-checked")).toBe("false");
    await user.click(remember);
    await user.click(deploy);

    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "relay/setup",
      params: { provider: "cloudflare", accountId: ACCOUNT, apiToken: TOKEN, remember: true },
    });
    // The bridge's own words, without the transport's code, and no token kept.
    expect(await screen.findByText("Cloudflare refused the token.")).toBeTruthy();
    expect((screen.getByLabelText("API token") as HTMLInputElement).value).toBe("");

    fail = false;
    await user.type(screen.getByLabelText("API token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Deploy" }));
    await until(() => screen.queryByRole("dialog") === null, { label: "the dialog to close" });
    expect(await screen.findByText(ENDPOINT.url)).toBeTruthy();
  });

  it("shows the relay as the bridge reports it", () => {
    relay.status = CONNECTED;
    const { screen } = mountWithProviders(RelaySettings);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("2 phones connected through it")).toBeTruthy();
    expect(screen.getByText(ENDPOINT.url)).toBeTruthy();
    expect(screen.getByText("In your Cloudflare account")).toBeTruthy();
    expect(screen.getByText("0.2.0 · up to date")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update relay" })).toBeNull();
    expect((screen.getByRole("switch", { name: "Use the relay" }) as HTMLElement).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("shows the bridge's reason when the relay cannot connect", () => {
    relay.status = { ...CONNECTED, state: "error", lastError: "The relay refused this computer's key." };
    const { screen } = mountWithProviders(RelaySettings);
    expect(screen.getByText("Can't connect")).toBeTruthy();
    expect(screen.getByText("The relay refused this computer's key.")).toBeTruthy();
  });

  it("turns the relay off through the bridge", async () => {
    relay.status = CONNECTED;
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({
        "relay/set": (params) => ({ ...CONNECTED, state: "off", endpoint: { ...ENDPOINT, enabled: params.enabled } }),
      }),
    });
    await user.click(screen.getByRole("switch", { name: "Use the relay" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({ method: "relay/set", params: { enabled: false } });
    expect(await screen.findByText("Off")).toBeTruthy();
  });

  it("offers an update only for an older relay it deployed, and asks for a token it does not have", async () => {
    relay.status = { ...CONNECTED, deployedVersion: "0.1.0" };
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({ "relay/update": () => CONNECTED }),
    });
    expect(screen.getByText("0.1.0 · 0.2.0 available")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update relay" }));
    await dialogFocusSettled(screen);
    expect(backend.called("bridge_call")).toBe(false);
    await user.type(screen.getByLabelText("API token"), TOKEN);
    const dialog = screen.getByRole("dialog");
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Update relay")!;
    await user.click(confirm);
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "relay/update",
      params: { apiToken: TOKEN, remember: false },
    });
    await until(() => screen.queryByRole("button", { name: "Update relay" }) === null, {
      label: "the update to disappear",
    });
  });

  it("updates straight away with a remembered token, and never offers it for a hand-deployed relay", async () => {
    relay.status = { ...CONNECTED, deployedVersion: "0.1.0", tokenRemembered: true };
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({ "relay/update": () => ({ ...CONNECTED, tokenRemembered: true }) }),
    });
    await user.click(screen.getByRole("button", { name: "Update relay" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({ method: "relay/update", params: {} });
    expect(screen.queryByRole("dialog")).toBeNull();

    relay.status = { ...CONNECTED, provider: "custom", deployedVersion: "0.1.0" };
    await until(() => screen.queryByText(/update the relay where you deployed it/) !== null);
    expect(screen.queryByRole("button", { name: "Update relay" })).toBeNull();
  });

  it("removes the relay, deleting it from Cloudflare with the token it asks for", async () => {
    relay.status = CONNECTED;
    const { screen, backend, user } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({ "relay/remove": () => relayStatus() }),
    });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await dialogFocusSettled(screen);
    await user.click(screen.getByRole("checkbox", { name: "Also delete it from Cloudflare" }));
    const dialog = screen.getByRole("dialog");
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Remove")!;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText("API token"), TOKEN);
    await user.click(confirm);
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "relay/remove",
      params: { deleteWorker: true, apiToken: TOKEN },
    });
    expect(await screen.findByRole("button", { name: "Set up your relay" })).toBeTruthy();
  });

  it("follows the bridge's notifications", async () => {
    const { screen } = mountWithProviders(RelaySettings, {
      commands: bridgeCall({ "relay/status": () => relayStatus() }),
    });
    relay.start();
    bridge.dispatch({ method: "stream/relay/updated", params: { status: { ...CONNECTED, state: "connecting" } } });
    expect(await screen.findByText("Connecting…")).toBeTruthy();
    bridge.dispatch({ method: "stream/relay/updated", params: { status: CONNECTED } });
    expect(await screen.findByText("2 phones connected through it")).toBeTruthy();
  });
});
