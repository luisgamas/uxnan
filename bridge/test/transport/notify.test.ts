import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  InMemorySecretStore,
  SessionRegistry,
  createInMemoryIoPair,
  handleSecureConnection,
  startBridge,
  type Bridge,
} from '../../src/index.js';
import { FakePhone } from '../helpers/fake-phone.js';

test('bridge.notify delivers a notification to a connected phone', async () => {
  const baseDir = join(tmpdir(), `uxnan-notify-${randomUUID()}`);
  const bridge: Bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
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

  const delivered = bridge.notify(phone.deviceId, 'stream/turn/started', {
    threadId: 't1',
    turnId: 'u1',
  });
  assert.equal(delivered, true);

  const note = await phone.receive();
  assert.equal(note['method'], 'stream/turn/started');
  assert.deepEqual(note['params'], { threadId: 't1', turnId: 'u1' });
  assert.equal('id' in note, false); // notifications carry no id

  phone.close();
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('messages sent to an offline device are recorded in its log for catch-up', () => {
  const registry = new SessionRegistry();
  const deviceId = 'device-1';

  assert.equal(registry.notify(deviceId, { method: 'a' }), false); // recorded (offline)
  assert.equal(registry.notify(deviceId, { method: 'b' }), false);
  assert.equal(registry.isActive(deviceId), false);

  // The log retains them with monotonic seq for replay on reconnect.
  const log = registry.logFor(deviceId);
  assert.deepEqual(
    log.entriesAfter(0).map((e) => [e.seq, JSON.parse(e.plaintext.toString())]),
    [
      [1, { method: 'a' }],
      [2, { method: 'b' }],
    ],
  );

  // register no longer auto-flushes — the session handler replays via the log
  // (seq > resumeState.lastAppliedBridgeOutboundSeq), re-encrypted under the new
  // session key. So a bare register sends nothing by itself.
  const received: unknown[] = [];
  registry.register(deviceId, { send: (m) => received.push(m) });
  assert.deepEqual(received, []);
  assert.equal(registry.isActive(deviceId), true);

  // Once active, notifications are delivered live (recording is the channel's
  // job in the real sink; this fake sink only captures delivery).
  assert.equal(registry.notify(deviceId, { method: 'c' }), true);
  assert.deepEqual(received, [{ method: 'c' }]);
});

test('forget drops the device log so nothing is replayed after untrust', () => {
  const registry = new SessionRegistry();
  const deviceId = 'device-1';
  registry.notify(deviceId, { method: 'a' });
  assert.equal(registry.logFor(deviceId).length, 1);
  registry.forget(deviceId);
  // A fresh log: the prior entries are gone.
  assert.equal(registry.logFor(deviceId).length, 0);
});
