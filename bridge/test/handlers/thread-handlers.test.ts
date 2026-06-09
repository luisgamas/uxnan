import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { makeRequest, type Project } from '@uxnan/shared';
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

// 30s default: the predicate resolves in ~50ms in isolation; the generous budget
// only guards against CPU starvation when node:test runs all files in parallel on
// Windows (documented flake — not a correctness issue).
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

test('thread/start then turn/send routes through the echo agent end-to-end', async () => {
  const { bridge, baseDir } = await boot();

  // The phone discovers a real project, then opens a thread on the echo agent.
  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;

  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, title: 'Chat', agentId: 'echo' }),
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

test('agent/list reports the registered agents (echo + opencode + claude-code + codex)', async () => {
  const { bridge, baseDir } = await boot();
  const res = await bridge.router.dispatch(makeRequest('1', 'agent/list', {}));
  assert.ok('result' in res);
  const ids = (res.result as { agents: { agentId: string }[] }).agents.map((a) => a.agentId);
  assert.ok(ids.includes('echo'));
  assert.ok(ids.includes('opencode'));
  assert.ok(ids.includes('claude-code'));
  assert.ok(ids.includes('codex'));
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('thread/start with an unknown project id is rejected', async () => {
  const { bridge, baseDir } = await boot();
  const res = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId: 'proj_unknown' }),
  );
  assert.ok('error' in res);
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
