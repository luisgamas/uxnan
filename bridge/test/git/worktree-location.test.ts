/**
 * The worktree layout, and the fact that it is the SAME layout the desktop
 * resolves in `uxnandesktop/src-tauri/src/worktreeloc.rs`.
 *
 * The cases below deliberately mirror that module's tests one for one — the two
 * apps place worktrees for the same repositories, so a divergence here is a
 * repository whose checkouts end up split across two folder schemes. Change one
 * side and this file changes with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GitService, runGit } from '../../src/index.js';
import {
  MARKER_FILE,
  defaultRoot,
  managedPath,
  markerMatches,
  normalize,
  nthCandidate,
  prepareWorktreePath,
  repoHash,
  repoKey,
  resolveWorktreePath,
  sanitizeBranch,
  siblingPath,
} from '../../src/git/worktree-location.js';

const git = new GitService();

async function newRepo(): Promise<string> {
  const dir = normalize(join(tmpdir(), `uxnan-wtloc-${randomUUID()}`));
  await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(dir, ['config', 'user.name', 'Uxnan Test']);
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), 'base\n');
  await runGit(dir, ['add', '-A']);
  await runGit(dir, ['commit', '-m', 'initial']);
  return dir;
}

async function newDir(): Promise<string> {
  const dir = normalize(join(tmpdir(), `uxnan-root-${randomUUID()}`));
  await mkdir(dir, { recursive: true });
  return dir;
}

test('normalizes to forward slashes without a trailing separator', () => {
  assert.equal(normalize('C:\\Users\\u\\repo\\'), 'C:/Users/u/repo');
  assert.equal(normalize('/home/u/repo//'), '/home/u/repo');
});

test('flattens branch separators', () => {
  assert.equal(sanitizeBranch('feature/login'), 'feature-login');
  assert.equal(sanitizeBranch('feature\\login'), 'feature-login');
});

test('drops characters Windows rejects', () => {
  assert.equal(sanitizeBranch('fix:the?bug*now'), 'fixthebugnow');
  assert.equal(sanitizeBranch('a\u0007b'), 'ab');
});

test('trims what Windows would strip silently', () => {
  // A trailing dot or space is dropped by the filesystem, so the folder we asked
  // for and the folder that appears would not be the same name.
  assert.equal(sanitizeBranch('release. '), 'release');
  assert.equal(sanitizeBranch('-wip-'), 'wip');
});

test('escapes Windows reserved device names', () => {
  assert.equal(sanitizeBranch('con'), '_con');
  assert.equal(sanitizeBranch('COM1'), '_COM1');
  assert.equal(sanitizeBranch('nul.txt'), '_nul.txt');
  // Only the exact device names — a longer word is fine.
  assert.equal(sanitizeBranch('console'), 'console');
});

test('caps length on a word boundary', () => {
  const long = 'feat/add-a-reconnection-backoff-to-the-zero-adapter-and-then-some-more';
  const out = sanitizeBranch(long);
  assert.ok([...out].length <= 60, out);
  assert.ok(!out.endsWith('-'), out);
  assert.ok(out.startsWith('feat-add-a-reconnection-backoff'), out);
});

test('never produces an empty folder name', () => {
  assert.equal(sanitizeBranch('...'), 'branch');
  assert.equal(sanitizeBranch('???'), 'branch');
});

test('the repo digest is stable, case-insensitive, and matches the desktop', () => {
  const a = repoHash('C:/Users/u/repo');
  assert.equal(a.length, 8);
  assert.equal(a, repoHash('c:\\users\\u\\repo\\'));
  assert.notEqual(a, repoHash('C:/Users/u/other'));
  // Pinned to the exact value `worktreeloc.rs` asserts: this names a folder on
  // disk, and the two apps must agree on it forever.
  assert.equal(repoHash('/home/u/myrepo'), '532b9c1b');
});

test('the group key is the main worktree folder name', () => {
  assert.equal(repoKey('/home/u/myrepo'), 'myrepo');
  assert.equal(repoKey('C:\\Users\\u\\my repo\\'), 'my repo');
});

test('the managed layout groups by repo, then branch', () => {
  const root = defaultRoot('/home/u');
  assert.equal(root, '/home/u/uxnan/worktrees');
  assert.equal(managedPath(root, 'myrepo', 'feature/login'), '/home/u/uxnan/worktrees/myrepo/feature-login');
});

test('the default root normalizes a Windows home', () => {
  assert.equal(defaultRoot('C:\\Users\\Agent'), 'C:/Users/Agent/uxnan/worktrees');
});

test('the sibling layout keeps the desktop’s previous spelling', () => {
  assert.equal(siblingPath('/home/u/myrepo', 'feature/login'), '/home/u/myrepo--feature-login');
});

test('candidates suffix from two', () => {
  assert.equal(nthCandidate('/a/b', 1), '/a/b');
  assert.equal(nthCandidate('/a/b', 2), '/a/b-2');
});

test('marker comparison ignores spelling differences', () => {
  assert.ok(markerMatches('C:/Users/u/repo\n', 'c:\\Users\\u\\repo'));
  assert.ok(!markerMatches('C:/Users/u/repo', 'C:/Users/u/other'));
});

test('a managed worktree is grouped by repo and accepted by git', async () => {
  const root = await newDir();
  const repo = await newRepo();
  const name = repoKey(repo);

  const resolved = await resolveWorktreePath(repo, 'feature/login', {
    location: 'custom',
    root,
  });
  assert.equal(resolved.path, `${root}/${name}/feature-login`);
  assert.equal(resolved.managed, true);

  await prepareWorktreePath(resolved);
  await runGit(repo, ['worktree', 'add', '-b', 'feature/login', resolved.path, 'main']);

  // git lists it back at exactly the path we asked for — the spelling clients
  // key their per-worktree state off.
  const { worktrees } = await git.worktrees(repo);
  assert.ok(
    worktrees.some((w) => normalize(w.path) === resolved.path),
    `not listed: ${JSON.stringify(worktrees)}`,
  );
  // And the group is claimed, so a same-named project lands elsewhere.
  const marker = await readFile(join(root, name, MARKER_FILE), 'utf8');
  assert.ok(markerMatches(marker, repo));
});

test('createWorktree without a path places it under the managed root', async () => {
  const root = await newDir();
  const repo = await newRepo();

  const result = await git.createWorktree(repo, 'wip', undefined, {
    location: 'custom',
    root,
  });
  assert.equal(result.path, `${root}/${repoKey(repo)}/wip`);
  assert.equal(result.branch, 'wip');

  // A client that names a path still gets exactly that path, unchanged.
  const explicit = join(await newDir(), 'elsewhere');
  const named = await git.createWorktree(repo, 'named', explicit, { location: 'custom', root });
  assert.equal(named.path, explicit);
});

test('asking from inside a worktree still groups under the main one', async () => {
  const root = await newDir();
  const repo = await newRepo();
  const name = repoKey(repo);

  const first = await git.createWorktree(repo, 'one', undefined, { location: 'custom', root });
  // Now ask from INSIDE that worktree. Measured naively, the second one would
  // nest under the first (`…/one/two`) and the tree would grow a level deeper
  // with every worktree.
  const second = await git.createWorktree(first.path, 'two', undefined, {
    location: 'custom',
    root,
  });
  assert.equal(second.path, `${root}/${name}/two`);
});

test('a taken destination gets the next free suffix', async () => {
  const root = await newDir();
  const repo = await newRepo();
  const name = repoKey(repo);

  // Two branches that sanitize to the same folder name (`a/b` and `a-b`).
  await mkdir(join(root, name, 'a-b'), { recursive: true });
  const resolved = await resolveWorktreePath(repo, 'a/b', { location: 'custom', root });
  assert.equal(resolved.path, `${root}/${name}/a-b-2`);
});

test('a second project of the same name gets its own group', async () => {
  const root = await newDir();
  const repo = await newRepo();
  const name = repoKey(repo);

  // Another repository already owns this group name.
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, MARKER_FILE), '/somewhere/else/api');

  const resolved = await resolveWorktreePath(repo, 'wip', { location: 'custom', root });
  assert.equal(resolved.path, `${root}/${name}-${repoHash(repo)}/wip`);
});

test('the sibling layout creates nothing of its own', async () => {
  const repo = await newRepo();
  const resolved = await resolveWorktreePath(repo, 'feature/login', { location: 'sibling' });
  assert.equal(resolved.path, `${repo}--feature-login`);
  assert.equal(resolved.managed, false);
  // `prepare` must be a no-op there: that folder is the user's own, not ours.
  await prepareWorktreePath(resolved);
  await assert.rejects(() => readFile(join(repo, '..', MARKER_FILE), 'utf8'));
});
