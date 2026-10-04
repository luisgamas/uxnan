/**
 * A host chat tab whose host has no bridge connected says whose bridge it is
 * and looks again on Retry — there is nothing to install or restart from here.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { BridgeClientStore } from "$lib/bridge/client.svelte";
import { hosts } from "$lib/state/hosts.svelte";
import ChatHostGate from "./ChatHostGate.svelte";

describe("ChatHostGate", () => {
  it("names the host, and Retry asks that host to look again", async () => {
    hosts.hosts = [
      {
        id: "h1",
        label: "build-box",
        hostname: "10.0.0.5",
        port: 22,
        user: "dev",
        identityFiles: [],
        identitiesOnly: false,
        forwardAgent: false,
        needsPrompt: false,
      },
    ];
    const bridge = new BridgeClientStore("ssh:h1");
    bridge.applyStatus({ state: "unavailable", reason: "notRunning", detail: "none" });
    const { screen, user, backend } = mountWithProviders(ChatHostGate, {
      props: { bridge },
      commands: { bridge_host_retry: () => null },
    });

    expect(await screen.findByText("This chat runs on build-box's own bridge")).toBeInTheDocument();
    // Nothing local is offered for a machine that is not this one.
    expect(screen.queryByText(/Install/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await until(() => backend.called("bridge_host_retry"), { label: "the retry" });
    expect(backend.lastCallTo("bridge_host_retry")?.args).toEqual({ hostId: "h1" });
  });
});
