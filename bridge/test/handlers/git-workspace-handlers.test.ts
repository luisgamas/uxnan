import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
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

test('workspace/resolveFileLink routes to a cross-worktree-safe viewer target', async () => {
  const { bridge, baseDir } = await boot();
  const parentDir = join(tmpdir(), `uxnan-links-${randomUUID()}`);
  await mkdir(parentDir, { recursive: true });
  // Canonicalized: the handler returns a `realpath`, and a temp dir is a
  // symlink on macOS and an 8.3 short path on Windows CI.
  const parent = await realpath(parentDir);
  const conversation = join(parent, 'x');
  const worktree = join(parent, 'y');
  await mkdir(conversation, { recursive: true });
  await mkdir(join(worktree, 'docs'), { recursive: true });
  await runGit(worktree, ['init', '-b', 'main']);
  await writeFile(join(worktree, 'docs', 'summary.md'), '# Summary');

  const res = await bridge.router.dispatch(
    makeRequest('8', 'workspace/resolveFileLink', {
      cwd: conversation,
      href: '../y/docs/summary.md',
    }),
  );
  assert.ok('result' in res);
  assert.deepEqual(res.result, { cwd: worktree, path: 'docs/summary.md' });

  await bridge.stop();
  await rmrf(baseDir);
  await rmrf(parent);
});

test('git/createWorktree places and registers a worktree with no path given', async () => {
  const { bridge, baseDir } = await boot();
  const repoDir = join(tmpdir(), `uxnan-gwwt-${randomUUID()}`);
  await mkdir(repoDir, { recursive: true });
  // Canonicalized: a temp dir is a symlink on macOS and an 8.3 short path on
  // Windows, and git reports the real one back.
  const repo = await realpath(repoDir);
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(repo, ['config', 'user.name', 'Uxnan Test']);
  await runGit(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'README.md'), 'base\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'initial']);

  // Put the managed root inside the test's own base dir so nothing lands in the
  // real `~/uxnan`.
  const root = join(baseDir, 'trees');
  bridge.context.config.worktrees = { location: 'custom', root };

  const res = await bridge.router.dispatch(
    makeRequest('9', 'git/createWorktree', { cwd: repo, branch: 'feature/login' }),
  );
  assert.ok('result' in res, JSON.stringify(res));
  const created = res.result as { path: string; branch: string };
  assert.ok(
    created.path.split('\\').join('/').endsWith('/feature-login'),
    `unexpected path: ${created.path}`,
  );
  assert.equal(created.branch, 'feature/login');

  // The bridge records the ones it placed itself, so a later cleanup can tell
  // them from checkouts that were already on disk.
  const registry =
    await bridge.context.state.readJson<Array<{ path: string; branch: string }>>(
      'managed-worktrees.json',
    );
  assert.ok(
    registry?.some((entry) => entry.path === created.path),
    JSON.stringify(registry),
  );

  await bridge.stop();
  await rmrf(baseDir);
  await rmrf(repo);
});
