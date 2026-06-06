import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { JsonRpcErrorCode, makeRequest } from '@uxnan/shared';
import { InMemorySecretStore, runGit, startBridge, type Bridge } from '../../src/index.js';

async function boot(): Promise<{ bridge: Bridge; baseDir: string }> {
  const baseDir = join(tmpdir(), `uxnan-gw-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  return { bridge, baseDir };
}

test('git/status routes to the real handler and returns a result for a repo', async () => {
  const { bridge, baseDir } = await boot();
  const repo = join(tmpdir(), `uxnan-gwrepo-${randomUUID()}`);
  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'f.txt'), 'x');

  const res = await bridge.router.dispatch(makeRequest('1', 'git/status', { cwd: repo }));
  assert.ok('result' in res);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

test('git failures map to -32003 GitOperationFailed', async () => {
  const { bridge, baseDir } = await boot();
  const notRepo = join(tmpdir(), `uxnan-norepo-${randomUUID()}`);
  await mkdir(notRepo, { recursive: true });

  const res = await bridge.router.dispatch(makeRequest('2', 'git/status', { cwd: notRepo }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.GitOperationFailed);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
  await rm(notRepo, { recursive: true, force: true });
});

test('workspace path traversal maps to -32004 WorkspaceAccessDenied', async () => {
  const { bridge, baseDir } = await boot();
  const root = join(tmpdir(), `uxnan-wsroot-${randomUUID()}`);
  await mkdir(root, { recursive: true });

  const res = await bridge.router.dispatch(
    makeRequest('3', 'workspace/readFile', { cwd: root, path: '../../etc/hosts' }),
  );
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.WorkspaceAccessDenied);

  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test('invalid params map to -32602 InvalidParams', async () => {
  const { bridge, baseDir } = await boot();
  const res = await bridge.router.dispatch(makeRequest('4', 'git/commit', { cwd: '/x' }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidParams);
  await bridge.stop();
  await rm(baseDir, { recursive: true, force: true });
});
