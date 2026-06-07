import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { JsonRpcErrorCode } from '@uxnan/shared';
import {
  InMemorySecretStore,
  createInMemoryIoPair,
  handleSecureConnection,
  startBridge,
  type Bridge,
} from '../../src/index.js';
import { FakePhone } from '../helpers/fake-phone.js';

const NOW = 1_700_000_000_000;

async function boot(): Promise<{ bridge: Bridge; baseDir: string }> {
  const baseDir = join(tmpdir(), `uxnan-hs-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
    now: () => NOW,
  });
  return { bridge, baseDir };
}

test('a phone completes the handshake and exchanges encrypted JSON-RPC', async () => {
  const { bridge, baseDir } = await boot();
  const sessionId = randomUUID();
  const [phoneIo, bridgeIo] = createInMemoryIoPair();

  void handleSecureConnection({
    io: bridgeIo,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    expectedSessionId: sessionId,
  });

  const phone = await FakePhone.connect(phoneIo, { sessionId });

  const status = await phone.request('bridge/status');
  assert.ok('result' in status);

  const stubbed = await phone.request('auth/status', {});
  assert.ok('error' in stubbed && stubbed.error.code === JsonRpcErrorCode.BridgeError);

  // The handshake (qr_bootstrap) should have persisted the phone as trusted.
  const trusted = await bridge.trustStore.list();
  assert.equal(trusted.length, 1);

  phone.close();
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('the handshake rejects a sessionId that does not match the pairing session', async () => {
  const { bridge, baseDir } = await boot();
  const [phoneIo, bridgeIo] = createInMemoryIoPair();

  void handleSecureConnection({
    io: bridgeIo,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    expectedSessionId: 'expected-session',
  });

  await assert.rejects(FakePhone.connect(phoneIo, { sessionId: 'wrong-session' }));

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
