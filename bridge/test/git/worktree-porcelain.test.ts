import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { GitService, parseWorktreePorcelain, runGit } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

/**
 * `git worktree list --porcelain` is parsed rather than shelled out per field,
 * so its shapes are pinned here directly. Detached heads, locked worktrees and
 * bare repos are all tedious to stage on disk and easy to get subtly wrong —
 * the parser is pure so they can be asserted as text, and one end-to-end test
 * below proves the text is what git actually prints.
 */

test('parses the main worktree and its linked siblings', () => {
  const entries = parseWorktreePorcelain(
    [
      'worktree /home/me/repo',
      'HEAD 8f3caa1e1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f60',
      'branch refs/heads/main',
      '',
      'worktree /home/me/repo-feature',
      'HEAD 1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      'branch refs/heads/feature',
      '',
    ].join('\n'),
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { path: '/home/me/repo', isMain: true, branch: 'main' });
  // The sibling is NOT under the main worktree's path — which is the whole
  // reason a client cannot infer this and has to be told.
  assert.deepEqual(entries[1], {
    path: '/home/me/repo-feature',
    isMain: false,
    branch: 'feature',
  });
});

test('only the FIRST entry is the main worktree', () => {
  const entries = parseWorktreePorcelain(
    ['worktree /a', 'branch refs/heads/x', '', 'worktree /b', 'branch refs/heads/y', ''].join('\n'),
  );
  assert.deepEqual(
    entries.map((e) => e.isMain),
    [true, false],
  );
});

test('a detached worktree reports no branch rather than a fake one', () => {
  const entries = parseWorktreePorcelain(
    [
      'worktree /home/me/repo',
      'HEAD 8f3caa1',
      'branch refs/heads/main',
      '',
      'worktree /home/me/repo-detached',
      'HEAD 1a2b3c4',
      'detached',
      '',
    ].join('\n'),
  );
  assert.equal(entries[1]!.branch, undefined);
  assert.equal(entries[1]!.path, '/home/me/repo-detached');
});

test('a locked worktree is flagged, reason or not', () => {
  const entries = parseWorktreePorcelain(
    [
      'worktree /a',
      'branch refs/heads/x',
      'locked being rebased right now',
      '',
      'worktree /b',
      'branch refs/heads/y',
      'locked',
      '',
      'worktree /c',
      'branch refs/heads/z',
      '',
    ].join('\n'),
  );
  assert.equal(entries[0]!.isLocked, true);
  assert.equal(entries[1]!.isLocked, true);
  assert.equal(entries[2]!.isLocked, undefined);
});

test('a branch name containing a slash survives', () => {
  // Stripping "everything up to the last slash" would turn this into "1.2".
  const entries = parseWorktreePorcelain(
    ['worktree /a', 'branch refs/heads/release/1.2', ''].join('\n'),
  );
  assert.equal(entries[0]!.branch, 'release/1.2');
});

test('a bare repository is still the main entry', () => {
  const entries = parseWorktreePorcelain(
    [
      'worktree /home/me/repo.git',
      'bare',
      '',
      'worktree /home/me/work',
      'branch refs/heads/main',
      '',
    ].join('\n'),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.isMain, true);
  assert.equal(entries[0]!.branch, undefined);
});

test('trailing output without a blank line still yields its entry', () => {
  const entries = parseWorktreePorcelain('worktree /a\nbranch refs/heads/x');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.branch, 'x');
});

test('empty output is no worktrees, not a crash', () => {
  assert.deepEqual(parseWorktreePorcelain(''), []);
  assert.deepEqual(parseWorktreePorcelain('\n\n'), []);
});

test('worktrees() reads what git actually prints', async () => {
  const git = new GitService();
  const dir = join(tmpdir(), `uxnan-wt-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(dir, ['config', 'user.name', 'Uxnan Test']);
  await writeFile(join(dir, 'a.txt'), 'hello');
  await runGit(dir, ['add', '.']);
  await runGit(dir, ['commit', '-m', 'first']);

  const sibling = `${dir}-feature`;
  await runGit(dir, ['worktree', 'add', '-b', 'feature', sibling]);

  try {
    const { worktrees } = await git.worktrees(dir);
    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0]!.isMain, true);
    assert.equal(worktrees[0]!.branch, 'main');
    assert.equal(worktrees[1]!.isMain, false);
    assert.equal(worktrees[1]!.branch, 'feature');
    // Asked from the SIBLING, git still lists the main worktree first, so the
    // phone gets the same hierarchy whichever workspace it asks about.
    const fromSibling = await git.worktrees(sibling);
    assert.equal(fromSibling.worktrees[0]!.isMain, true);
    assert.equal(fromSibling.worktrees.length, 2);
  } finally {
    await rmrf(sibling);
    await rmrf(dir);
  }
});

test('outside a repository it is an empty list, not an error', async () => {
  const git = new GitService();
  const dir = join(tmpdir(), `uxnan-nowt-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    assert.deepEqual(await git.worktrees(dir), { worktrees: [] });
  } finally {
    await rmrf(dir);
  }
});
