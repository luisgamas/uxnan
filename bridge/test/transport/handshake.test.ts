import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmrf } from '../helpers/fs.js';
import { JsonRpcErrorCode, SECURE_PROTOCOL_VERSION } from '@uxnan/shared';
import {
  InMemorySecretStore,
  PAIRING_WINDOW_MS,
  PairingCodeService,
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
    transport: 'direct',
    expectedSessionId: sessionId,
  });

  const phone = await FakePhone.connect(phoneIo, { sessionId });

  const status = await phone.request('bridge/status');
  assert.ok('result' in status);

  const stubbed = await phone.request('auth/login', { provider: 'anthropic' });
  assert.ok('error' in stubbed && stubbed.error.code === JsonRpcErrorCode.BridgeError);

  // The handshake (qr_bootstrap) should have persisted the phone as trusted.
  const trusted = await bridge.trustStore.list();
  assert.equal(trusted.length, 1);

  phone.close();
  await bridge.stop();
  await rmrf(baseDir);
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
    transport: 'direct',
    expectedSessionId: 'expected-session',
  });

  await assert.rejects(FakePhone.connect(phoneIo, { sessionId: 'wrong-session' }));

  await bridge.stop();
  await rmrf(baseDir);
});

test('a qr_bootstrap is rejected while the pairing window is not armed, with no trust mutation', async () => {
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
    transport: 'direct',
    expectedSessionId: sessionId,
    isPairingArmed: () => false,
  });

  await assert.rejects(FakePhone.connect(phoneIo, { sessionId }));
  assert.equal((await bridge.trustStore.list()).length, 0);

  await bridge.stop();
  await rmrf(baseDir);
});

test('a qr_bootstrap succeeds while the pairing window is armed', async () => {
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
    transport: 'direct',
    expectedSessionId: sessionId,
    isPairingArmed: () => true,
  });

  const phone = await FakePhone.connect(phoneIo, { sessionId });
  assert.equal((await bridge.trustStore.list()).length, 1);

  phone.close();
  await bridge.stop();
  await rmrf(baseDir);
});

test('the armed pairing window expires after PAIRING_WINDOW_MS; a late qr_bootstrap is rejected', async () => {
  const { bridge, baseDir } = await boot();
  let clock = NOW;
  const pairingWindow = new PairingCodeService({
    buildPayload: () => {
      throw new Error('not used in this test');
    },
    now: () => clock,
  });
  pairingWindow.arm();
  clock += PAIRING_WINDOW_MS + 1; // past the window's TTL

  const sessionId = randomUUID();
  const [phoneIo, bridgeIo] = createInMemoryIoPair();

  void handleSecureConnection({
    io: bridgeIo,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    transport: 'direct',
    expectedSessionId: sessionId,
    isPairingArmed: () => pairingWindow.isArmed(),
  });

  await assert.rejects(FakePhone.connect(phoneIo, { sessionId }));
  assert.equal((await bridge.trustStore.list()).length, 0);

  await bridge.stop();
  await rmrf(baseDir);
});

test('trusted_reconnect succeeds with no arming and no pairing proof', async () => {
  const { bridge, baseDir } = await boot();
  const sessionId = randomUUID();

  // First, bootstrap-pair with the window armed so the device becomes trusted.
  const [phoneIo1, bridgeIo1] = createInMemoryIoPair();
  void handleSecureConnection({
    io: bridgeIo1,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    transport: 'direct',
    expectedSessionId: sessionId,
    isPairingArmed: () => true,
  });
  const phone1 = await FakePhone.connect(phoneIo1, { sessionId });
  phone1.close();

  // Then reconnect as the SAME identity via trusted_reconnect, window NOT armed.
  const [phoneIo2, bridgeIo2] = createInMemoryIoPair();
  void handleSecureConnection({
    io: bridgeIo2,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    transport: 'direct',
    expectedSessionId: sessionId,
    isPairingArmed: () => false,
  });
  const phone2 = await FakePhone.connect(phoneIo2, {
    sessionId,
    mode: 'trusted_reconnect',
    identity: phone1.identity,
  });
  const status = await phone2.request('bridge/status');
  assert.ok('result' in status);

  phone2.close();
  await bridge.stop();
  await rmrf(baseDir);
});

test('the handshake rejects a phone speaking a different secure protocol version', async () => {
  const { bridge, baseDir } = await boot();
  const [phoneIo, bridgeIo] = createInMemoryIoPair();
  const sessionId = randomUUID();

  void handleSecureConnection({
    io: bridgeIo,
    ctx: bridge.context,
    router: bridge.router,
    deviceState: bridge.context.deviceState,
    trustStore: bridge.trustStore,
    displayName: 'Test PC',
    transport: 'direct',
    expectedSessionId: sessionId,
    // Armed, so the ONLY thing that can turn this phone away is the version.
    isPairingArmed: () => true,
  });

  // A phone from before the AAD binding landed. It MUST be turned away here, at
  // the handshake — the last point both sides can still read each other. If it
  // got through, every encrypted frame would fail its GCM tag and the session
  // would look connected while silently dropping all traffic.
  await assert.rejects(
    FakePhone.connect(phoneIo, {
      sessionId,
      protocolVersion: SECURE_PROTOCOL_VERSION - 1,
    }),
  );
  // …and nothing was trusted along the way.
  assert.equal((await bridge.trustStore.list()).length, 0);

  await bridge.stop();
  await rmrf(baseDir);
});
