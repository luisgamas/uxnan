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
  const res = await bridge.router.dispatch(makeRequest('3', 'auth/login', { provider: 'x' }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.BridgeError);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('auth/status returns a sanitized per-agent snapshot (no tokens)', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('9', 'auth/status', { agentId: 'echo' }));
  assert.ok('result' in res);
  const status = res.result as Record<string, unknown>;
  assert.equal(status['agentId'], 'echo');
  assert.equal(status['transportMode'], 'local');
  assert.equal(typeof status['requiresLogin'], 'boolean');
  assert.equal(status['loginInProgress'], false);
  // Sanitized: never any token/secret/key field.
  const keys = Object.keys(status);
  assert.ok(!keys.some((k) => /token|secret|key|password/i.test(k)));

  // An unknown agent is rejected with invalid params.
  const bad = await bridge.router.dispatch(makeRequest('10', 'auth/status', { agentId: 'nope' }));
  assert.ok('error' in bad && bad.error.code === JsonRpcErrorCode.InvalidParams);

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

test('bridge/status reports the real relay-connection state (false when idle)', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('5', 'bridge/status'));
  assert.ok('result' in res);
  assert.equal((res.result as { relayConnected: boolean }).relayConnected, false);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('bridge/removeTrustedDevice revokes trust and is idempotent', async () => {
  const { bridge, baseDir } = await bootBridge();
  await bridge.context.trustStore.upsert({
    deviceId: 'phone-1',
    displayName: 'Pixel',
    publicKey: 'ab12',
    pairedAt: NOW,
  });
  assert.equal((await bridge.context.trustStore.list()).length, 1);

  const removed = await bridge.router.dispatch(
    makeRequest('6', 'bridge/removeTrustedDevice', { deviceId: 'phone-1' }),
  );
  assert.ok('result' in removed);
  assert.equal((await bridge.context.trustStore.list()).length, 0);

  // Removing an already-absent device is not an error (phone calls best-effort).
  const again = await bridge.router.dispatch(
    makeRequest('7', 'bridge/removeTrustedDevice', { deviceId: 'phone-1' }),
  );
  assert.ok('result' in again);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('bridge/removeTrustedDevice validates its params', async () => {
  const { bridge, baseDir } = await bootBridge();
  const res = await bridge.router.dispatch(makeRequest('8', 'bridge/removeTrustedDevice', {}));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidParams);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
