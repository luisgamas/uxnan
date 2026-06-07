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

test('messages sent to an offline device are buffered and flushed on register', () => {
  const registry = new SessionRegistry();
  const deviceId = 'device-1';

  assert.equal(registry.notify(deviceId, { method: 'a' }), false); // buffered
  assert.equal(registry.notify(deviceId, { method: 'b' }), false);
  assert.equal(registry.isActive(deviceId), false);

  const received: unknown[] = [];
  registry.register(deviceId, { send: (m) => received.push(m) });
  assert.deepEqual(received, [{ method: 'a' }, { method: 'b' }]);
  assert.equal(registry.isActive(deviceId), true);

  // Once active, notifications are delivered live.
  assert.equal(registry.notify(deviceId, { method: 'c' }), true);
  assert.deepEqual(received, [{ method: 'a' }, { method: 'b' }, { method: 'c' }]);
});
