import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { JsonRpcErrorCode, makeRequest, validatePairingPayload } from '@uxnan/shared';
import { InMemorySecretStore, startBridge, type Bridge } from '../src/index.js';

const NOW = 1_700_000_000_000;

async function bootBridge(): Promise<{ bridge: Bridge; baseDir: string }> {
  const baseDir = join(tmpdir(), `uxnan-bridge-test-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
    now: () => NOW,
  });
  return { bridge, baseDir };
}

test('startBridge wires bridge/status through the router', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('1', 'bridge/status'));
  assert.ok('result' in res);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('startBridge generates a valid pairing payload via the router', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('2', 'bridge/generatePairingQr'));
  assert.ok('result' in res);
  const validation = validatePairingPayload(res.result, NOW);
  assert.ok(validation.valid);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('stubbed domain methods return a bridge error, not a crash', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('3', 'git/status', { cwd: '/r' }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.BridgeError);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('bridge/disconnectPhone validates its params', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('4', 'bridge/disconnectPhone', {}));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidParams);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
