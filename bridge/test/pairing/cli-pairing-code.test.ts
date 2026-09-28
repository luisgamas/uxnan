import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySecretStore, startBridge } from '../../src/index.js';
import { DaemonState, DAEMON_FILES } from '../../src/daemon-state.js';
import { pairingCodeForCli } from '../../src/pairing/cli-pairing-code.js';
import { rmrf } from '../helpers/fs.js';

function scratchDir(): string {
  return join(tmpdir(), `uxnan-bridge-code-${randomUUID()}`);
}

test("`code` asks the running bridge over its local channel for the daemon's own code", async () => {
  const baseDir = scratchDir();
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    await bridge.startLocalControl();
    const answer = await pairingCodeForCli(new DaemonState(baseDir));
    assert.equal(answer.source, 'running');
    // The code the running bridge's `/pair/resolve` accepts.
    assert.equal(answer.code, bridge.currentPairingCode());
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('`code` with no bridge running issues the shared code and stands no bridge up', async () => {
  const baseDir = scratchDir();
  try {
    const answer = await pairingCodeForCli(new DaemonState(baseDir));
    assert.equal(answer.source, 'stored');
    assert.match(answer.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // Only the shared code store was written: no identity, trust store,
    // discovery file or logs of a throwaway bridge.
    assert.deepEqual(await readdir(baseDir), [DAEMON_FILES.pairingCode]);

    // The bridge that starts next accepts that same code.
    const bridge = await startBridge({
      baseDir,
      secretStore: new InMemorySecretStore(),
      logLevel: 'error',
    });
    try {
      assert.equal(bridge.currentPairingCode(), answer.code);
    } finally {
      await bridge.stop();
    }
  } finally {
    await rmrf(baseDir);
  }
});
