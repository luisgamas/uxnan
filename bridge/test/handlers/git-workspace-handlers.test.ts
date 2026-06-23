import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { JsonRpcErrorCode, makeRequest } from '@uxnan/shared';
import { InMemorySecretStore, runGit, startBridge, type Bridge } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

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
  await rmrf(baseDir);
  await rmrf(repo);
});

test('git failures map to -32003 GitOperationFailed', async () => {
  const { bridge, baseDir } = await boot();
  const notRepo = join(tmpdir(), `uxnan-norepo-${randomUUID()}`);
  await mkdir(notRepo, { recursive: true });

  const res = await bridge.router.dispatch(makeRequest('2', 'git/status', { cwd: notRepo }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.GitOperationFailed);

  await bridge.stop();
  await rmrf(baseDir);
  await rmrf(notRepo);
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
  await rmrf(baseDir);
  await rmrf(root);
});

test('invalid params map to -32602 InvalidParams', async () => {
  const { bridge, baseDir } = await boot();
  const res = await bridge.router.dispatch(makeRequest('4', 'git/commit', { cwd: '/x' }));
  assert.ok('error' in res && res.error.code === JsonRpcErrorCode.InvalidParams);
  await bridge.stop();
  await rmrf(baseDir);
});

test('git/revert is routed and undoes the last commit', async () => {
  const { bridge, baseDir } = await boot();
  const repo = join(tmpdir(), `uxnan-revert-${randomUUID()}`);
  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.email', 't@u.dev']);
  await runGit(repo, ['config', 'user.name', 'T']);
  await writeFile(join(repo, 'a.txt'), 'one\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'one']);
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'two']);

  const res = await bridge.router.dispatch(
    makeRequest('5', 'git/revert', { cwd: repo, commit: 'HEAD' }),
  );
  assert.ok('result' in res);
  const { stdout } = await runGit(repo, ['rev-list', '--count', 'HEAD']);
  assert.equal(stdout.trim(), '3');

  await bridge.stop();
  await rmrf(baseDir);
  await rmrf(repo);
});

test('workspace/exists reports a present repo and a vanished dir', async () => {
  const { bridge, baseDir } = await boot();
  const repo = join(tmpdir(), `uxnan-exists-${randomUUID()}`);
  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);

  const present = await bridge.router.dispatch(makeRequest('6', 'workspace/exists', { cwd: repo }));
  assert.ok('result' in present);
  assert.deepEqual(present.result, { exists: true, isGitRepo: true });

  const gone = await bridge.router.dispatch(
    makeRequest('7', 'workspace/exists', { cwd: join(tmpdir(), `uxnan-gone-${randomUUID()}`) }),
  );
  assert.ok('result' in gone);
  assert.deepEqual(gone.result, { exists: false });

  await bridge.stop();
  await rmrf(baseDir);
  await rmrf(repo);
});
