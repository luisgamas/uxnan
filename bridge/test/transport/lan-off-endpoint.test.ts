import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmrf } from '../helpers/fs.js';
import { DaemonState, DAEMON_FILES, InMemorySecretStore, startBridge } from '../../src/index.js';

/** Whether a TCP connection to `host:port` is accepted. */
function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// A bridge whose LAN is off — the default Uxnan writes for a bridge it installs
// on a server — still needs its HTTP endpoint for the agents' approval hook.
// It must exist on this machine's loopback, and nowhere a network can reach.
test('with the LAN off the endpoint listens on loopback only and is published nowhere', async () => {
  const baseDir = join(tmpdir(), `uxnan-lan-off-${randomUUID()}`);
  await new DaemonState(baseDir).writeJson(DAEMON_FILES.config, {
    lanEnabled: false,
    mdnsEnabled: false,
  });
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    const { port } = await bridge.startLan();
    assert.ok(port > 0);

    // The approval hook answers on loopback (refusing a wrong token, which is
    // proof the route is there).
    const response = await fetch(`http://127.0.0.1:${port}/agent-hook/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-uxnan-hook-token': 'wrong' },
      body: JSON.stringify({ threadId: 't', toolName: 'Bash', input: {} }),
    });
    assert.equal(response.status, 403);

    // Not on any other address of this machine.
    const outside = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
    if (outside) assert.equal(await accepts(outside, port), false);

    // And a pairing QR names no host to dial.
    const qr = bridge.generatePairingQr();
    assert.ok(!qr.hosts || qr.hosts.length === 0, JSON.stringify(qr.hosts));
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});
