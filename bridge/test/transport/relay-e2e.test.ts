import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { RelayServer } from 'uxnan-relay';
import {
  DEFAULT_DAEMON_CONFIG,
  DaemonState,
  InMemorySecretStore,
  startBridge,
  wsToMessageIO,
} from '../../src/index.js';
import { FakePhone } from '../helpers/fake-phone.js';

test('phone ↔ relay ↔ bridge: full handshake and encrypted RPC end-to-end', async () => {
  const relay = new RelayServer();
  const { port, close: closeRelay } = await relay.start(0, '127.0.0.1');
  const relayUrl = `ws://127.0.0.1:${port}`;

  const baseDir = join(tmpdir(), `uxnan-relay-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  await state.writeConfig({ ...DEFAULT_DAEMON_CONFIG, relayUrl, lanEnabled: false });

  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const sessionId = randomUUID();
  await bridge.connectRelay(sessionId);

  const ws = new WebSocket(relayUrl, {
    headers: { 'x-role': 'iphone', 'x-session-id': sessionId },
  });
  await once(ws, 'open');

  const phone = await FakePhone.connect(wsToMessageIO(ws), { sessionId });
  const status = await phone.request('bridge/status');
  assert.ok('result' in status);
  assert.equal(relay.sessionCount, 1);

  phone.close();
  await bridge.stop();
  await closeRelay();
  await rm(baseDir, { recursive: true, force: true });
});
