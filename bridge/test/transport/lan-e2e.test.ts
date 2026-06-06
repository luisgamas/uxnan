import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { InMemorySecretStore, startBridge, wsToMessageIO } from '../../src/index.js';
import { FakePhone } from '../helpers/fake-phone.js';

test('a phone connects over the real LAN WebSocket and runs encrypted RPC', async () => {
  const baseDir = join(tmpdir(), `uxnan-lan-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const { port } = await bridge.startLan();

  const sessionId = randomUUID();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { 'x-role': 'iphone', 'x-session-id': sessionId },
  });
  await once(ws, 'open');

  const phone = await FakePhone.connect(wsToMessageIO(ws), { sessionId });
  const status = await phone.request('bridge/status');
  assert.ok('result' in status);

  phone.close();
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
