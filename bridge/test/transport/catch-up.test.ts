import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  InMemorySecretStore,
  createInMemoryIoPair,
  handleSecureConnection,
  startBridge,
  type Bridge,
} from '../../src/index.js';
import { FakePhone, newPhoneIdentity } from '../helpers/fake-phone.js';

const tick = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('a reconnecting phone is caught up on outbound it missed (seq > resumeState)', async () => {
  const baseDir = join(tmpdir(), `uxnan-catchup-${randomUUID()}`);
  const bridge: Bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const sessionId = randomUUID();
  const identity = newPhoneIdentity();

  const serve = (bridgeIo: Parameters<typeof handleSecureConnection>[0]['io']): void => {
    void handleSecureConnection({
      io: bridgeIo,
      ctx: bridge.context,
      router: bridge.router,
      deviceState: bridge.context.deviceState,
      trustStore: bridge.trustStore,
      displayName: 'Test PC',
      expectedSessionId: sessionId,
    });
  };

  try {
    // --- First connection: pair (qr_bootstrap), receive two live notifications.
    const [phoneIo1, bridgeIo1] = createInMemoryIoPair();
    serve(bridgeIo1);
    const phone1 = await FakePhone.connect(phoneIo1, { sessionId, mode: 'qr_bootstrap', identity });

    assert.equal(bridge.notify(phone1.deviceId, 'stream/turn/started', { n: 1 }), true);
    assert.equal(bridge.notify(phone1.deviceId, 'stream/turn/completed', { n: 2 }), true);
    const m1 = await phone1.receive();
    const m2 = await phone1.receive();
    assert.deepEqual(m1['params'], { n: 1 });
    assert.deepEqual(m2['params'], { n: 2 });
    assert.equal(phone1.lastAppliedSeq, 2); // applied seq 1 and 2

    // --- Drop the connection; let the bridge run its disconnect cleanup.
    phone1.close();
    await tick();

    // --- While offline, the bridge produces two more notifications (seq 3, 4),
    // recorded in the device's outbound log.
    assert.equal(bridge.notify(phone1.deviceId, 'stream/content/block', { n: 3 }), false);
    assert.equal(bridge.notify(phone1.deviceId, 'stream/turn/completed', { n: 4 }), false);

    // --- Reconnect (trusted_reconnect) advertising the last seq applied (2). The
    // bridge must replay ONLY seq 3 and 4, re-encrypted under the new key.
    const [phoneIo2, bridgeIo2] = createInMemoryIoPair();
    serve(bridgeIo2);
    const phone2 = await FakePhone.connect(phoneIo2, {
      sessionId,
      mode: 'trusted_reconnect',
      identity,
      resumeState: { lastAppliedBridgeOutboundSeq: phone1.lastAppliedSeq },
    });

    const c1 = await phone2.receive();
    const c2 = await phone2.receive();
    assert.deepEqual(c1['params'], { n: 3 });
    assert.deepEqual(c2['params'], { n: 4 });
    assert.equal(c1['method'], 'stream/content/block');
    assert.equal(phone2.lastAppliedSeq, 4); // seq continued across the reconnect

    phone2.close();
  } finally {
    await bridge.stop();
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('a first-time phone (no resumeState) is not sent any backlog', async () => {
  const baseDir = join(tmpdir(), `uxnan-catchup-fresh-${randomUUID()}`);
  const bridge: Bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const sessionId = randomUUID();
  try {
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

    // First real outbound after connect must be seq 1 (no phantom replay).
    bridge.notify(phone.deviceId, 'stream/turn/started', { hello: true });
    const note = await phone.receive();
    assert.deepEqual(note['params'], { hello: true });
    assert.equal(phone.lastAppliedSeq, 1);

    phone.close();
  } finally {
    await bridge.stop();
    await rm(baseDir, { recursive: true, force: true });
  }
});
