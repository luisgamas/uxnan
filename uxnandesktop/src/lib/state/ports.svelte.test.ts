import { beforeEach, describe, expect, it } from "vitest";

import { installFakeBackend, type FakeBackend } from "../../test/tauri";
import { ports } from "./ports.svelte";

const FORWARD = {
  id: "h1:5173",
  hostId: "h1",
  remotePort: 5173,
  localPort: 5173,
  generation: 3,
  connections: 0,
  failures: 0,
  reachable: true,
  refusal: null,
  address: "127.0.0.1",
};

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    ssh_ports_listening: () => [
      { port: 22, loopback: false, address: "" },
      { port: 5173, loopback: true, address: "" },
    ],
    ssh_forward_open: () => FORWARD,
    ssh_forward_close: () => true,
    ssh_forwards: () => [],
  });
  ports.forget("h1");
  ports.error = null;
});

describe("ports store", () => {
  it("lists what a terminal announced without touching the host", async () => {
    // The free route in: the dev server printed its address, so nothing had to
    // be run on that machine to learn about it.
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/admin" });
    const rows = ports.rowsFor("h1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ port: 5173, source: "announced", path: "/admin" });
    expect(backend.lastCallTo("ssh_ports_listening")).toBeUndefined();
  });

  it("merges a scan with what was announced, keeping the announced path", async () => {
    // Two ways of learning the same fact. A person looking for "the port my dev
    // server is on" does not care which one found it — but only the
    // announcement knows the path, so that must survive the merge.
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/admin" });
    await ports.scan("h1");

    const rows = ports.rowsFor("h1");
    expect(rows.map((r) => r.port)).toEqual([22, 5173]);
    expect(rows[1]).toMatchObject({ port: 5173, source: "announced", path: "/admin" });
    expect(rows[0]).toMatchObject({ port: 22, source: "found", loopback: false });
  });

  it("forwards a port and remembers where it landed", async () => {
    await ports.forward("h1", 5173);
    expect(backend.lastCallTo("ssh_forward_open")?.args).toEqual({
      hostId: "h1",
      remotePort: 5173,
      addresses: [],
    });
    const row = ports.rowsFor("h1").find((r) => r.port === 5173);
    expect(row?.forward?.localPort).toBe(5173);
    expect(ports.localUrl(row!)).toBe("http://127.0.0.1:5173/");
  });

  it("opens the announced path on the local port, not the remote one", async () => {
    // The two numbers differ whenever something here already held that port,
    // and the address a person is given has to be the one that works.
    backend.setCommands({ ssh_forward_open: () => ({ ...FORWARD, localPort: 49871 }) });
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/admin" });
    await ports.forward("h1", 5173);

    const row = ports.rowsFor("h1").find((r) => r.port === 5173)!;
    expect(ports.localUrl(row)).toBe("http://127.0.0.1:49871/admin");
  });

  it("shows a forwarded port even when nothing announced or found it", async () => {
    // The user opened it, so it is theirs to see — and to close.
    await ports.forward("h1", 8080);
    expect(ports.rowsFor("h1").map((r) => r.port)).toContain(5173);
  });

  it("sends the scanned address, for a service that is not on the host's loopback", async () => {
    // The case a real host hit: the service was pinned to one interface, so the
    // host's own 127.0.0.1 answered nothing and the tunnel reached silence.
    backend.setCommands({
      ssh_ports_listening: () => [{ port: 8080, loopback: false, address: "100.101.102.103" }],
    });
    await ports.scan("h1");
    await ports.forward("h1", 8080, ports.rowsFor("h1")[0].address);
    expect(backend.lastCallTo("ssh_forward_open")?.args).toEqual({
      hostId: "h1",
      remotePort: 8080,
      addresses: ["100.101.102.103"],
    });
  });

  it("keeps a failure instead of silently doing nothing", async () => {
    backend.setCommands({
      ssh_forward_open: () => {
        throw { code: "NOT_CONNECTED", message: "h1 is not connected" };
      },
    });
    expect(await ports.forward("h1", 5173)).toBeNull();
    expect(ports.error).toBe("h1 is not connected");
  });

  it("forgets a host's ports when it goes away", async () => {
    // A list of ports on a machine that can no longer be reached is a list of
    // things that do not work.
    ports.note({ hostId: "h1", terminalId: "t1", port: 5173, path: "/" });
    await ports.forward("h1", 5173);
    ports.forget("h1");
    expect(ports.rowsFor("h1")).toEqual([]);
    expect(ports.forwards).toEqual([]);
  });
});
