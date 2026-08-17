import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { ports } from "$lib/state/ports.svelte";
import { sessions } from "$lib/state/sessions.svelte";
import PortsStatusButton from "./PortsStatusButton.svelte";

const FORWARD = {
  id: "h1:5173",
  hostId: "h1",
  remotePort: 5173,
  localPort: 49871,
  generation: 3,
  connections: 0,
  failures: 0,
  reachable: true,
  refusal: null,
  address: "127.0.0.1",
};

const COMMANDS = {
  ssh_forwards: () => [],
  ssh_forward_open: () => FORWARD,
  ssh_forward_close: () => true,
  ssh_ports_listening: () => [{ port: 3000, loopback: true, address: "" }],
  open_url: () => null,
};

/** The popover renders into a portal that role queries do not reach in jsdom —
 *  the same access the other status-popover tests use. */
function popoverText(): string {
  return document.querySelector('[data-slot="popover-content"]')?.textContent ?? "";
}
function popoverButton(match: RegExp): HTMLElement | null {
  return (
    (Array.from(document.querySelectorAll('[data-slot="popover-content"] button')).find(
      (button) =>
        match.test(button.textContent ?? "") ||
        match.test(button.getAttribute("aria-label") ?? ""),
    ) as HTMLElement | undefined) ?? null
  );
}

beforeEach(() => {
  if (!globalThis.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      readonly pointerType = "mouse";
      readonly isPrimary = true;
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
  ports.forget("h1");
  ports.error = null;
  sessions.replace([{ hostId: "h1", generation: 3, label: "workbox" }]);
});

describe("PortsStatusButton", () => {
  it("stays out of the way when no host is connected", () => {
    // Nothing to forward, so the status bar says nothing.
    sessions.replace([]);
    const { screen } = mountWithProviders(PortsStatusButton, { commands: COMMANDS });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens a port a terminal announced, and previews it on the local address", async () => {
    // The whole journey of phase 4: a dev server on the host announced itself,
    // the user opens it, and the browser is pointed at the tunnel — on the local
    // port, which is not the remote one here because that number was taken.
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/admin" });
    const { screen, backend, user } = mountWithProviders(PortsStatusButton, {
      commands: COMMANDS,
    });

    await user.click(screen.getByRole("button", { name: /ports on your hosts/i }));
    await until(() => popoverText().includes("5173"), { label: "the announced port" });

    await user.click(popoverButton(/^\s*Open\s*$/i)!);
    await until(() => backend.called("open_url"), { label: "the preview" });

    expect(backend.lastCallTo("ssh_forward_open")?.args).toEqual({
      hostId: "h1",
      remotePort: 5173,
      addresses: [],
    });
    expect(backend.lastCallTo("open_url")?.args).toEqual({
      url: "http://127.0.0.1:49871/admin",
    });
    // And the row then shows where it landed here, because the two numbers
    // differ and only the local one works.
    await until(() => popoverText().includes("127.0.0.1:49871"), {
      label: "the local address",
    });
  });

  it("says why the host would not carry it, instead of sending the browser at it", async () => {
    // Reported from a real host: the tunnel opened, the preview showed a generic
    // "cannot reach this site", and nothing anywhere said why. A refused port
    // must explain itself where the click happened — and must not open a browser
    // tab that can only repeat the failure.
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/" });
    const { screen, backend, user } = mountWithProviders(PortsStatusButton, {
      commands: {
        ...COMMANDS,
        ssh_forward_open: () => ({
          ...FORWARD,
          reachable: false,
          refusal: { kind: "nothingListening", detail: "closed at once" },
        }),
      },
    });

    await user.click(screen.getByRole("button", { name: /ports on your hosts/i }));
    await until(() => popoverText().includes("5173"), { label: "the port" });
    await user.click(popoverButton(/^\s*Open\s*$/i)!);

    await until(() => popoverText().includes("Nothing answered"), {
      label: "the reason",
    });
    expect(backend.called("open_url")).toBe(false);
  });

  it("asks the host what it is listening on only when told to", async () => {
    // A command costs a shell start on that machine, so opening the popover must
    // not run one — the refresh button is what does.
    const { screen, backend, user } = mountWithProviders(PortsStatusButton, {
      commands: COMMANDS,
    });

    await user.click(screen.getByRole("button", { name: /ports on your hosts/i }));
    await until(() => popoverText().length > 0, { label: "the popover" });
    expect(backend.called("ssh_ports_listening")).toBe(false);

    await user.click(popoverButton(/listening on/i)!);
    await until(() => backend.called("ssh_ports_listening"), { label: "the scan" });
    await until(() => popoverText().includes("3000"), { label: "the found port" });
  });
});
