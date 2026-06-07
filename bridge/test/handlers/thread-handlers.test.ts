import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { makeRequest } from '@uxnan/shared';
import { InMemorySecretStore, startBridge, type Bridge } from '../../src/index.js';

async function boot(): Promise<{ bridge: Bridge; baseDir: string }> {
  const baseDir = join(tmpdir(), `uxnan-th-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  return { bridge, baseDir };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

test('thread/start then turn/send routes through the echo agent end-to-end', async () => {
  const { bridge, baseDir } = await boot();

  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId: 'p1', title: 'Chat' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  const sendRes = await bridge.router.dispatch(
    makeRequest('2', 'turn/send', { threadId, text: 'ping pong' }),
  );
  assert.ok('result' in sendRes);
  const turnId = (sendRes.result as { turnId: string }).turnId;

  await waitFor(
    async () => (await bridge.context.threadStore.getTurn(turnId)).status === 'completed',
  );
  const turn = await bridge.context.threadStore.getTurn(turnId);
  assert.equal(turn.messages.find((m) => m.role === 'assistant')?.content, 'ping pong');

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('thread/read of an unknown id returns -32008', async () => {
  const { bridge, baseDir } = await boot();
  const res = await bridge.router.dispatch(makeRequest('3', 'thread/read', { threadId: 'nope' }));
  assert.ok('error' in res && res.error.code === -32008);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
