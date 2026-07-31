/**
 * What happens when a port the app wants is already taken.
 *
 * The app binds two loopback servers at startup — the agent hook server and the
 * browser-control MCP endpoint — and both ask the OS for **port 0**, meaning
 * "give me a free one". That choice is the whole defence against a busy port,
 * and it is invisible: nothing fails today, so nothing would notice if a fixed
 * port were introduced later and the app started refusing to launch on a machine
 * where something else already held it.
 *
 * So this tests the property rather than the code path: asking for port 0
 * survives a crowded machine, and a *fixed* port does not. The second half is
 * what gives the first half meaning — without it, this would pass on any
 * implementation at all.
 */

import net from "node:net";
import { describe, expect, it } from "vitest";

/** Bind a loopback server and resolve its port. */
function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe("binding a loopback port", () => {
  it("asking for port 0 always succeeds, however busy the machine", async () => {
    // Hold a spread of ports, then ask for another — the way the hook server
    // does. This is the behaviour the app depends on.
    const held = await Promise.all([listen(0), listen(0), listen(0), listen(0), listen(0)]);
    try {
      const { server, port } = await listen(0);
      expect(port).toBeGreaterThan(0);
      expect(held.map((h) => h.port)).not.toContain(port);
      await close(server);
    } finally {
      await Promise.all(held.map((h) => close(h.server)));
    }
  });

  it("asking for a port someone else holds fails outright", async () => {
    // The failure the app avoids by never naming a port. If this ever stops
    // throwing, the assumption above has changed and the test above is empty.
    const { server, port } = await listen(0);
    try {
      await expect(listen(port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await close(server);
    }
  });

  it("a freed port can be taken again", async () => {
    // Restart-after-crash: the app must be able to come back on the same
    // machine without waiting out a lingering socket.
    const first = await listen(0);
    const port = first.port;
    await close(first.server);

    const second = await listen(port);
    expect(second.port).toBe(port);
    await close(second.server);
  });
});
