import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { GitCommandError, GitService, runGit } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const git = new GitService();

async function newRepo(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-git-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(dir, ['config', 'user.name', 'Uxnan Test']);
  await runGit(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

test('status reports the branch, untracked files and dirtiness', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'hello');
  const status = await git.status(dir);
  assert.equal(status.branch, 'main');
  assert.equal(status.isDirty, true);
  assert.deepEqual(status.files, [{ path: 'a.txt', status: 'untracked' }]);
  await rmrf(dir);
});

test('commit stages everything and returns a sha; diff reflects later edits', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\n');
  const commit = await git.commit(dir, 'initial');
  assert.match(commit.sha, /^[0-9a-f]{40}$/);

  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  const diff = await git.diff(dir);
  assert.ok(diff.diff.includes('+two'));
  assert.equal(diff.additions, 1);

  const clean = await git.status(dir);
  assert.equal(clean.files[0]?.status, 'modified');
  await rmrf(dir);
});

test('createBranch, checkout and createWorktree work', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'x');
  await git.commit(dir, 'init');

  await git.createBranch(dir, 'feature');
  await git.checkout(dir, 'feature');
  assert.equal((await git.status(dir)).branch, 'feature');

  const wtPath = join(tmpdir(), `uxnan-wt-${randomUUID()}`);
  const wt = await git.createWorktree(dir, 'wt-branch', wtPath);
  assert.equal(wt.branch, 'wt-branch');
  assert.equal((await git.status(wtPath)).branch, 'wt-branch');

  await rmrf(dir);
  await rmrf(wtPath);
});

test('push and pull against a bare remote succeed', async () => {
  const remote = join(tmpdir(), `uxnan-remote-${randomUUID()}.git`);
  await mkdir(remote, { recursive: true });
  await runGit(remote, ['init', '--bare', '-b', 'main']);

  const work = join(tmpdir(), `uxnan-clone-${randomUUID()}`);
  await runGit(tmpdir(), ['clone', remote, work]);
  await runGit(work, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(work, ['config', 'user.name', 'Uxnan Test']);
  await writeFile(join(work, 'a.txt'), 'data');

  const commit = await git.commit(work, 'first');
  assert.ok(commit.sha);
  assert.deepEqual(await git.push(work, 'origin', 'main'), {
    success: true,
    remote: 'origin',
    branch: 'main',
  });
  assert.deepEqual(await git.pull(work), { success: true });

  await rmrf(remote);
  await rmrf(work);
});

test('a git failure surfaces as GitCommandError', async () => {
  const dir = join(tmpdir(), `uxnan-nogit-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await assert.rejects(git.status(dir), GitCommandError);
  await rmrf(dir);
});
