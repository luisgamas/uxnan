// Ports on the machines uxnan is connected to, and which of them are reachable
// from here.
//
// Two ways a port gets into this list, and the difference is deliberate:
//
// * **Announced** — a terminal on the host printed its URL (`ports:announced`).
//   Free, instant, and it works on any host and any shell, because it is the dev
//   server talking rather than the machine being interrogated.
// * **Found** — the user pressed refresh and the host was asked what it is
//   listening on. One command on that machine, which costs a shell start there
//   (`02g` §5.3), so it never runs on a timer.
//
// Nothing is forwarded until the user asks. A tunnel opens a socket on *this*
// machine, and the app does not do that on its own.

import { listen } from "@tauri-apps/api/event";

import { sshForwardClose, sshForwardOpen, sshForwards, sshPortsListening } from "$lib/api";
import { errorMessage } from "$lib/toast";
import type { AnnouncedPort, ForwardInfo, ListeningPort } from "$lib/types";

/** How a port came to be known. */
export type PortSource = "announced" | "found";

/** One row of the ports list. */
export interface PortRow {
  hostId: string;
  port: number;
  source: PortSource;
  /** The path the server named, when it announced one (`/`, `/admin`). */
  path: string;
  /** Whether the host has it on loopback only — known from a scan, not from an
   *  announcement, which is why it is optional rather than a guessed `false`. */
  loopback?: boolean;
  /** Where to knock on that machine when its loopback is not where the service
   *  is (a VPN or LAN address). Known only from a scan. */
  address?: string;
  /** The live tunnel for this port, when there is one. */
  forward?: ForwardInfo;
}

/** Key for a (host, port) pair — the identity of a row on either route in. */
function key(hostId: string, port: number): string {
  return `${hostId}:${port}`;
}

class PortsStore {
  /** Ports a terminal announced, keyed by host and port. */
  private announced = $state<Record<string, { hostId: string; port: number; path: string }>>({});
  /** Ports a host reported on the last scan, per host. */
  private found = $state<Record<string, ListeningPort[]>>({});
  /** Live tunnels, as the backend last reported them. */
  private tunnels = $state<ForwardInfo[]>([]);

  /** A scan or a tunnel operation is in flight. */
  loading = $state(false);
  /** The last failure, for the popover to show in place of a silent no-op. */
  error = $state<string | null>(null);

  /** Every known port on `hostId`, ports ascending.
   *
   *  Announced and found are merged rather than listed twice: they are two ways
   *  of learning the same fact, and a person looking for "the port my dev server
   *  is on" does not care which one found it. */
  rowsFor(hostId: string): PortRow[] {
    const rows = new Map<number, PortRow>();
    for (const found of this.found[hostId] ?? []) {
      rows.set(found.port, {
        hostId,
        port: found.port,
        source: "found",
        path: "/",
        loopback: found.loopback,
        address: found.address || undefined,
      });
    }
    for (const a of Object.values(this.announced)) {
      if (a.hostId !== hostId) continue;
      const existing = rows.get(a.port);
      // An announcement carries the path, which a scan cannot know — so it wins
      // on that field even when the scan found the port first.
      rows.set(a.port, {
        hostId,
        port: a.port,
        source: "announced",
        path: a.path,
        loopback: existing?.loopback,
        address: existing?.address,
      });
    }
    for (const tunnel of this.tunnels) {
      if (tunnel.hostId !== hostId) continue;
      const existing = rows.get(tunnel.remotePort);
      // A forwarded port is on the list even if nothing announced or found it:
      // the user opened it, so it is theirs to see and to close.
      rows.set(tunnel.remotePort, {
        hostId,
        port: tunnel.remotePort,
        source: existing?.source ?? "found",
        path: existing?.path ?? "/",
        loopback: existing?.loopback,
        address: existing?.address,
        forward: tunnel,
      });
    }
    return [...rows.values()].sort((a, b) => a.port - b.port);
  }

  /** Hosts that have something to show, so the status bar can stay out of the
   *  way when there is nothing. */
  hostsWithPorts(connected: string[]): string[] {
    return connected.filter((hostId) => this.rowsFor(hostId).length > 0);
  }

  /** The live tunnels, whatever host they land on. */
  get forwards(): ForwardInfo[] {
    return this.tunnels;
  }

  private listening = false;

  /** Start hearing what the hosts' terminals announce.
   *
   *  Called once at boot rather than when the popover opens: a dev server prints
   *  its address exactly once, and a listener that only exists while a popover
   *  is open would miss every announcement that matters. */
  async start(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    try {
      await listen<AnnouncedPort>("ports:announced", (e) => this.note(e.payload));
      await this.refreshForwards();
    } catch {
      // No Tauri event bus (the plain browser preview) — the scan button still
      // works, and nothing here pretends otherwise.
      this.listening = false;
    }
  }

  /** A port a terminal just announced. Re-announcing the same one (a dev server
   *  restarting) updates its path rather than adding a second row. */
  note(announced: AnnouncedPort): void {
    this.announced[key(announced.hostId, announced.port)] = {
      hostId: announced.hostId,
      port: announced.port,
      path: announced.path,
    };
  }

  /** Re-read the live tunnels from the backend. Cheap: it is in-process state,
   *  not a question for the host. */
  async refreshForwards(): Promise<void> {
    try {
      this.tunnels = await sshForwards();
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Ask a host what it is listening on. This is the one that costs a command
   *  on that machine, so it is only ever called from the refresh action. */
  async scan(hostId: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.found[hostId] = await sshPortsListening(hostId);
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
  }

  /** Open a tunnel to `port` on `hostId`, and answer where it landed here.
   *
   *  The scanned address travels with the request, because the host's own
   *  loopback is not always where the service is: one pinned to a VPN or LAN
   *  interface answers nothing on `127.0.0.1` there, and without this the
   *  tunnel would be aimed at silence. */
  async forward(hostId: string, port: number, address?: string): Promise<ForwardInfo | null> {
    this.loading = true;
    this.error = null;
    try {
      const info = await sshForwardOpen(hostId, port, address ? [address] : []);
      this.tunnels = [...this.tunnels.filter((f) => f.id !== info.id), info];
      return info;
    } catch (e) {
      this.error = errorMessage(e);
      return null;
    } finally {
      this.loading = false;
    }
  }

  /** Close a tunnel. */
  async close(id: string): Promise<void> {
    this.error = null;
    try {
      await sshForwardClose(id);
      this.tunnels = this.tunnels.filter((f) => f.id !== id);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Forget what a host told us, on disconnect: its tunnels are gone with the
   *  connection, and a list of ports on a machine we can no longer reach is a
   *  list of things that do not work. */
  forget(hostId: string): void {
    delete this.found[hostId];
    for (const k of Object.keys(this.announced)) {
      if (this.announced[k].hostId === hostId) delete this.announced[k];
    }
    this.tunnels = this.tunnels.filter((f) => f.hostId !== hostId);
  }

  /** The address a forwarded port has on this machine, ready to open. */
  localUrl(row: PortRow): string | null {
    if (!row.forward) return null;
    const path = row.path.startsWith("/") ? row.path : `/${row.path}`;
    return `http://127.0.0.1:${row.forward.localPort}${path}`;
  }
}

export const ports = new PortsStore();
