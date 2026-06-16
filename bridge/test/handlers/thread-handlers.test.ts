import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { makeRequest, type Project } from '@uxnan/shared';
import {
  DaemonState,
  DAEMON_FILES,
  InMemorySecretStore,
  startBridge,
  type Bridge,
} from '../../src/index.js';

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

// A real 1x1 transparent PNG (base64, no data: prefix) — what the phone sends.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('turn/send accepts an image-only message (empty text + attachments)', async () => {
  const { bridge, baseDir } = await boot();

  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;

  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, title: 'Chat', agentId: 'echo' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  // No `text` field at all — only an inline image.
  const sendRes = await bridge.router.dispatch(
    makeRequest('2', 'turn/send', {
      threadId,
      attachments: [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
    }),
  );
  assert.ok('result' in sendRes);
  const turnId = (sendRes.result as { turnId: string }).turnId;

  await waitFor(
    async () => (await bridge.context.threadStore.getTurn(turnId)).status === 'completed',
  );
  const turn = await bridge.context.threadStore.getTurn(turnId);
  assert.equal(turn.messages.find((m) => m.role === 'user')?.content, '[1 image attachment]');
  assert.match(
    String(turn.messages.find((m) => m.role === 'assistant')?.content ?? ''),
    /Attached image/,
  );

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('turn/send rejects a message with neither text nor attachments', async () => {
  const { bridge, baseDir } = await boot();

  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;
  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, agentId: 'echo' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  const res = await bridge.router.dispatch(makeRequest('2', 'turn/send', { threadId }));
  assert.ok('error' in res && res.error.code === -32602);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('turn/send with approvalResponse drives the echo demo approval over the router', async () => {
  const { bridge, baseDir } = await boot();

  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;
  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, agentId: 'echo' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  // The demo trigger emits an approval block and pauses the turn.
  const sendRes = await bridge.router.dispatch(
    makeRequest('2', 'turn/send', { threadId, text: 'approval-demo' }),
  );
  assert.ok('result' in sendRes);
  const turnId = (sendRes.result as { turnId: string }).turnId;

  // Reply with the decision (control-only turn/send → no new turn).
  const approveRes = await bridge.router.dispatch(
    makeRequest('3', 'turn/send', {
      threadId,
      approvalResponse: { approvalId: `appr-${turnId}`, decision: 'approve' },
    }),
  );
  assert.ok('result' in approveRes);
  assert.equal((approveRes.result as { turnId: string }).turnId, turnId);

  await waitFor(
    async () => (await bridge.context.threadStore.getTurn(turnId)).status === 'completed',
  );
  const turn = await bridge.context.threadStore.getTurn(turnId);
  assert.match(String(turn.messages.find((m) => m.role === 'assistant')?.content ?? ''), /Approved/);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('turn/send rejects an approvalResponse with an unknown decision', async () => {
  const { bridge, baseDir } = await boot();
  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;
  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, agentId: 'echo' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  const res = await bridge.router.dispatch(
    makeRequest('2', 'turn/send', {
      threadId,
      approvalResponse: { approvalId: 'a', decision: 'bogus' },
    }),
  );
  assert.ok('error' in res && res.error.code === -32602);

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

test('thread rename/archive/unarchive/delete lifecycle over the router', async () => {
  const { bridge, baseDir } = await boot();

  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const projectId = (projectsRes.result as Project[])[0]!.id;

  const startRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId, title: 'Orig', agentId: 'echo' }),
  );
  assert.ok('result' in startRes);
  const threadId = (startRes.result as { id: string }).id;

  const renameRes = await bridge.router.dispatch(
    makeRequest('2', 'thread/rename', { threadId, title: 'Renamed' }),
  );
  assert.ok('result' in renameRes);
  assert.equal((renameRes.result as { title: string }).title, 'Renamed');

  const archiveRes = await bridge.router.dispatch(makeRequest('3', 'thread/archive', { threadId }));
  assert.ok('result' in archiveRes);
  assert.equal((archiveRes.result as { status: string }).status, 'archived');

  const unarchiveRes = await bridge.router.dispatch(
    makeRequest('4', 'thread/unarchive', { threadId }),
  );
  assert.ok('result' in unarchiveRes);
  assert.equal((unarchiveRes.result as { status: string }).status, 'active');

  const deleteRes = await bridge.router.dispatch(makeRequest('5', 'thread/delete', { threadId }));
  assert.ok('result' in deleteRes);
  const readRes = await bridge.router.dispatch(makeRequest('6', 'thread/read', { threadId }));
  assert.ok('error' in readRes && readRes.error.code === -32008);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});

test('thread/start uses the per-project agent/model pin when the phone omits them', async () => {
  const baseDir = join(tmpdir(), `uxnan-th-${randomUUID()}`);
  const projectDir = join(tmpdir(), `uxnan-proj-${randomUUID()}`);
  // Pin the project to the always-available `echo` agent (default is opencode),
  // so the resolution is observable without a real CLI installed.
  await new DaemonState(baseDir).writeJson(DAEMON_FILES.config, {
    workspaceRoots: [projectDir],
    projectAgents: [{ agentId: 'echo', cwd: projectDir, model: 'echo-1' }],
  });
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });

  const projectsRes = await bridge.router.dispatch(makeRequest('0', 'project/list', {}));
  assert.ok('result' in projectsRes);
  const project = (projectsRes.result as Project[])[0]!;
  // project/list surfaces the pin for the phone to pre-select.
  assert.equal(project.agentId, 'echo');
  assert.equal(project.model, 'echo-1');

  // No agentId/model in the request → the bridge applies the pin.
  const pinnedRes = await bridge.router.dispatch(
    makeRequest('1', 'thread/start', { projectId: project.id }),
  );
  assert.ok('result' in pinnedRes);
  assert.equal((pinnedRes.result as { agentId: string }).agentId, 'echo');
  assert.equal((pinnedRes.result as { model?: string }).model, 'echo-1');

  // An explicit agent overrides the pin, and the pinned model is NOT forced onto
  // a different agent.
  const overrideRes = await bridge.router.dispatch(
    makeRequest('2', 'thread/start', { projectId: project.id, agentId: 'opencode' }),
  );
  assert.ok('result' in overrideRes);
  assert.equal((overrideRes.result as { agentId: string }).agentId, 'opencode');
  assert.equal((overrideRes.result as { model?: string }).model, undefined);

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
