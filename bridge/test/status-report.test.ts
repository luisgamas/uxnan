import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_CONTROL_FILE } from '@uxnan/shared';
import { InMemorySecretStore, startBridge } from '../src/index.js';
import { DaemonState, DAEMON_FILES } from '../src/daemon-state.js';
import { LockFile } from '../src/lock-file.js';
import { bridgeStatusReport } from '../src/status-report.js';
import { startLocalControlServer } from '../src/transport/local-control-server.js';
import { SessionRegistry } from '../src/transport/session-registry.js';
import { buildDiscovery, writeDiscoveryFile } from '../src/local-control-discovery.js';
import { rmrf } from './helpers/fs.js';

const INSTALLED = '9.9.9-installed';

function scratchDir(): string {
  return join(tmpdir(), `uxnan-bridge-status-${randomUUID()}`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

test('status with no bridge running says so and creates nothing', async () => {
  const baseDir = scratchDir();
  try {
    const report = await bridgeStatusReport(new DaemonState(baseDir), {
      installedVersion: INSTALLED,
    });
    assert.equal(report.running, false);
    assert.equal(report.version, INSTALLED);
    assert.equal(typeof report.platform, 'string');
    // No bridge was stood up: not even its state directory exists.
    assert.equal(await exists(baseDir), false);
  } finally {
    await rmrf(baseDir);
  }
});

test("status asks the running bridge over its local channel for the daemon's own status", async () => {
  const baseDir = scratchDir();
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    await bridge.startLocalControl();
    const report = await bridgeStatusReport(new DaemonState(baseDir), {
      installedVersion: INSTALLED,
    });
    assert.equal(report.running, true);
    assert.ok('uptimeMs' in report, 'the report is the bridge/status result');
    // The running daemon's answer, not one made up by the command.
    assert.equal(report.version, bridge.status().version);
    assert.equal(report.features?.localControl, true);
    assert.equal(report.host?.launchedBy, bridge.context.host.launchedBy);
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('status reports a failed call from the running bridge instead of guessing', async () => {
  const baseDir = scratchDir();
  const state = new DaemonState(baseDir);
  const token = 'status-report-token-0123456789';
  const handle = await startLocalControlServer({
    port: 0,
    token,
    bridgeVersion: INSTALLED,
    instanceId: 'status-report',
    registry: new SessionRegistry(),
    dispatch: async (raw) => {
      const req = raw as { id: number };
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: 'status unavailable' },
      };
    },
  });
  try {
    await writeDiscoveryFile(
      state.pathFor(LOCAL_CONTROL_FILE),
      buildDiscovery({
        port: handle.port,
        token,
        pid: process.pid,
        bridgeVersion: INSTALLED,
        instanceId: 'status-report',
      }),
    );
    await assert.rejects(
      bridgeStatusReport(state, { installedVersion: INSTALLED }),
      /status unavailable/,
    );
  } finally {
    await handle.close();
    await rmrf(baseDir);
  }
});

test('status of a bridge running without its local channel names its pid', async () => {
  const baseDir = scratchDir();
  const state = new DaemonState(baseDir);
  await state.ensureDir();
  const lock = new LockFile(state.pathFor(DAEMON_FILES.lock));
  assert.equal(await lock.acquire(), true);
  try {
    const report = await bridgeStatusReport(state, { installedVersion: INSTALLED });
    assert.equal(report.running, true);
    assert.ok('pid' in report);
    assert.equal(report.pid, process.pid);
    assert.match(report.detail, /no local control channel/);

    // A lock left by a process that is gone is not a running bridge.
    const gone = await bridgeStatusReport(state, {
      installedVersion: INSTALLED,
      isAlive: () => false,
    });
    assert.equal(gone.running, false);
  } finally {
    await lock.release();
    await rmrf(baseDir);
  }
});
