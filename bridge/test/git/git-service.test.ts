import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(status.files, [
    { path: 'a.txt', status: 'untracked', additions: 0, deletions: 0 },
  ]);
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

test('status carries per-file +/- counts and diffTotals', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  await git.commit(dir, 'init');
  await writeFile(join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\n');
  const status = await git.status(dir);
  const file = status.files.find((f) => f.path === 'a.txt');
  assert.equal(file?.status, 'modified');
  assert.equal(file?.additions, 2); // TWO + four
  assert.equal(file?.deletions, 1); // two
  assert.deepEqual(status.diffTotals, {
    additions: 2,
    deletions: 1,
    changedFileCount: 1,
  });
  await rmrf(dir);
});

test('diff(path) returns a single file, synthesising untracked content', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'tracked.txt'), 'x\n');
  await git.commit(dir, 'init');
  await writeFile(join(dir, 'tracked.txt'), 'x\ny\n');
  await writeFile(join(dir, 'fresh.txt'), 'alpha\nbeta\n');

  const tracked = await git.diff(dir, 'tracked.txt');
  assert.ok(tracked.diff.includes('+y'));
  assert.equal(tracked.additions, 1);

  const untracked = await git.diff(dir, 'fresh.txt');
  assert.ok(untracked.diff.includes('+alpha'));
  assert.ok(untracked.diff.includes('+beta'));
  assert.equal(untracked.additions, 2);
  await rmrf(dir);
});

test('commit(paths) stages only the listed files', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await writeFile(join(dir, 'b.txt'), 'b\n');
  await git.commit(dir, 'only a', ['a.txt']);
  const status = await git.status(dir);
  assert.deepEqual(
    status.files.map((f) => f.path),
    ['b.txt'],
  );
  await rmrf(dir);
});

test('stage then unstage round-trips a file', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await git.commit(dir, 'init');
  await writeFile(join(dir, 'a.txt'), 'a\nb\n');
  await git.stage(dir, ['a.txt']);
  const { stdout: staged } = await runGit(dir, ['diff', '--cached', '--name-only']);
  assert.equal(staged.trim(), 'a.txt');
  await git.unstage(dir, ['a.txt']);
  const { stdout: after } = await runGit(dir, ['diff', '--cached', '--name-only']);
  assert.equal(after.trim(), '');
  await rmrf(dir);
});

test('discard restores tracked edits and deletes untracked files', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\n');
  await git.commit(dir, 'init');
  await writeFile(join(dir, 'a.txt'), 'one\nmutated\n');
  await writeFile(join(dir, 'b.txt'), 'new\n');

  await git.discard(dir, ['a.txt', 'b.txt']);
  const status = await git.status(dir);
  assert.equal(status.isDirty, false);
  assert.deepEqual(status.files, []);
  await rmrf(dir);
});

test('undoCommit soft-resets the last commit, keeping the changes', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\n');
  await git.commit(dir, 'first');
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  const committed = await git.commit(dir, 'second');
  assert.ok(committed.sha);

  await git.undoCommit(dir);
  // HEAD is back at the first commit...
  const { stdout: subject } = await runGit(dir, ['log', '-1', '--format=%s']);
  assert.equal(subject.trim(), 'first');
  // ...but the second commit's changes are still present (staged).
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'one\ntwo\n');
  await rmrf(dir);
});

test('branches lists current, local and remote branches', async () => {
  const remote = join(tmpdir(), `uxnan-remote-${randomUUID()}.git`);
  await mkdir(remote, { recursive: true });
  await runGit(remote, ['init', '--bare', '-b', 'main']);

  const work = join(tmpdir(), `uxnan-clone-${randomUUID()}`);
  await runGit(tmpdir(), ['clone', remote, work]);
  await runGit(work, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(work, ['config', 'user.name', 'Uxnan Test']);
  await writeFile(join(work, 'a.txt'), 'x');
  await git.commit(work, 'init');
  await git.push(work, 'origin', 'main');
  await git.createBranch(work, 'feature');

  const list = await git.branches(work);
  assert.equal(list.current, 'main');
  assert.ok(list.local.includes('main'));
  assert.ok(list.local.includes('feature'));
  assert.ok(list.remote.includes('origin/main'));

  await rmrf(remote);
  await rmrf(work);
});

test('switchBranch leaves changes on the current branch and restores them', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'base\n');
  await git.commit(dir, 'init');
  await git.createBranch(dir, 'feature');

  // Dirty the working tree on main, then switch to feature leaving changes.
  await writeFile(join(dir, 'a.txt'), 'base\nwip-on-main\n');
  await git.switchBranch(dir, 'feature', false);
  // feature is clean — main's change stayed behind (stashed).
  assert.equal((await git.status(dir)).branch, 'feature');
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'base\n');

  // Switching back restores main's left-behind change.
  await git.switchBranch(dir, 'main', false);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'base\nwip-on-main\n');
  await rmrf(dir);
});

test('switchBranch can carry changes to the target branch', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'base\n');
  await git.commit(dir, 'init');
  await git.createBranch(dir, 'feature');
  await writeFile(join(dir, 'a.txt'), 'base\ncarried\n');

  await git.switchBranch(dir, 'feature', true);
  assert.equal((await git.status(dir)).branch, 'feature');
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'base\ncarried\n');
  await rmrf(dir);
});

test('createPr rejects when head and base are the same branch', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'x');
  await git.commit(dir, 'init');
  await assert.rejects(git.createPr(dir, 'title', 'body', 'main', 'main'), GitCommandError);
  await rmrf(dir);
});

test('a git failure surfaces as GitCommandError', async () => {
  const dir = join(tmpdir(), `uxnan-nogit-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await assert.rejects(git.status(dir), GitCommandError);
  await rmrf(dir);
});

test('revert creates a new commit that undoes the target', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\n');
  await git.commit(dir, 'one');
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  await git.commit(dir, 'two');

  await git.revert(dir, 'HEAD');
  // The file is back to its pre-"two" content, history preserved (3 commits).
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf-8'), 'one\n');
  const { stdout } = await runGit(dir, ['rev-list', '--count', 'HEAD']);
  assert.equal(stdout.trim(), '3');
  await rmrf(dir);
});

test('deleteBranch refuses an unmerged branch unless forced', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'x');
  await git.commit(dir, 'init');
  await git.createBranch(dir, 'feature');
  await git.checkout(dir, 'feature');
  await writeFile(join(dir, 'b.txt'), 'y');
  await git.commit(dir, 'feature work');
  await git.checkout(dir, 'main');

  // Safe delete refuses (the branch has unmerged commits).
  await assert.rejects(git.deleteBranch(dir, 'feature', false), GitCommandError);
  // Forced delete succeeds.
  await git.deleteBranch(dir, 'feature', true);
  const branches = await git.branches(dir);
  assert.equal(branches.local.includes('feature'), false);
  await rmrf(dir);
});

test('removeWorktree removes a clean worktree and refuses a dirty one unless forced', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'x');
  await git.commit(dir, 'init');

  const wt1 = join(tmpdir(), `uxnan-wt-${randomUUID()}`);
  await git.createWorktree(dir, 'wt-clean', wt1);
  await git.removeWorktree(dir, wt1, false); // clean → succeeds

  const wt2 = join(tmpdir(), `uxnan-wt-${randomUUID()}`);
  await git.createWorktree(dir, 'wt-dirty', wt2);
  await writeFile(join(wt2, 'untracked.txt'), 'dirty');
  // Standing INSIDE the worktree (cwd === the one being removed) still works:
  // the service resolves the main worktree to run the removal from.
  await assert.rejects(git.removeWorktree(wt2, wt2, false), GitCommandError);
  await git.removeWorktree(wt2, wt2, true); // forced → succeeds
  await rmrf(dir);
  await rmrf(wt1);
  await rmrf(wt2);
});

test('log returns commits newest-first with author, parents and stats', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one');
  await git.commit(dir, 'first commit\n\nthe body of the first one');

  await writeFile(join(dir, 'a.txt'), 'one\ntwo');
  await git.commit(dir, 'second commit');

  await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree');
  const third = await git.commit(dir, 'third commit');

  const log = await git.log(dir, { limit: 10 });
  assert.equal(log.commits.length, 3);
  assert.equal(log.hasMore, false);
  assert.equal(log.commits[0]?.sha, third.sha);
  assert.equal(log.commits[0]?.messageTitle, 'third commit');
  assert.equal(log.commits[0]?.messageBody, '');
  assert.equal(log.commits[1]?.messageTitle, 'second commit');
  assert.equal(log.commits[2]?.messageTitle, 'first commit');
  assert.equal(log.commits[2]?.messageBody, 'the body of the first one');
  // The newest commit's only parent is the second-newest; the oldest has no
  // parents (it was the initial commit on the branch).
  assert.equal(log.commits[0]?.parents.length, 1);
  assert.equal(log.commits[2]?.parents.length, 0);
  // The oldest commit's sha appears as the parent of the second-oldest.
  assert.equal(log.commits[1]?.parents[0], log.commits[2]?.sha);
  // shortstat: third commit's diff against the previous one (the exact
  // numbers depend on the platform's line-ending handling — the important
  // invariants are that stats is set and `changedFileCount === 1`).
  const thirdStats = log.commits[0]?.stats;
  assert.ok(thirdStats !== undefined, 'third commit should carry stats');
  assert.equal(thirdStats!.changedFileCount, 1);
  assert.ok((thirdStats!.additions ?? 0) > 0);
  await rmrf(dir);
});

test('log paginates by cursor and reports hasMore + nextCursor', async () => {
  const dir = await newRepo();
  for (let i = 0; i < 5; i++) {
    await writeFile(join(dir, `f${i}.txt`), `v${i}`);
    await git.commit(dir, `commit ${i}`);
  }

  // First page: limit 2 → newest 2 of 5, hasMore true.
  const page1 = await git.log(dir, { limit: 2 });
  assert.equal(page1.commits.length, 2);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);
  assert.match(page1.commits[0]?.messageTitle ?? '', /commit 4/);
  assert.match(page1.commits[1]?.messageTitle ?? '', /commit 3/);

  // Second page: pass the cursor → strictly older commits.
  const page2 = await git.log(dir, {
    limit: 2,
    cursor: page1.nextCursor,
  });
  assert.equal(page2.commits.length, 2);
  assert.equal(page2.hasMore, true);
  assert.match(page2.commits[0]?.messageTitle ?? '', /commit 2/);
  assert.match(page2.commits[1]?.messageTitle ?? '', /commit 1/);

  // Third page: last commit, no more pages.
  const page3 = await git.log(dir, {
    limit: 2,
    cursor: page2.nextCursor,
  });
  assert.equal(page3.commits.length, 1);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.nextCursor, undefined);
  assert.match(page3.commits[0]?.messageTitle ?? '', /commit 0/);
  await rmrf(dir);
});

test('log pages a merge DAG without dropping any commit', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'a');
  await git.commit(dir, 'A (root)');
  await git.createBranch(dir, 'feature');
  await git.checkout(dir, 'feature');
  await writeFile(join(dir, 'b.txt'), 'b');
  await git.commit(dir, 'B (feature)');
  await git.checkout(dir, 'main');
  await writeFile(join(dir, 'c.txt'), 'c');
  await git.commit(dir, 'C (main)');
  // Merge feature into main, forcing a real merge commit (two parents).
  await runGit(dir, ['merge', '--no-ff', '-m', 'M (merge feature)', 'feature']);

  // Page through the whole history two at a time and collect every SHA.
  const seen = new Set<string>();
  const titles: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const page = await git.log(dir, { limit: 2, ...(cursor ? { cursor } : {}) });
    for (const c of page.commits) {
      seen.add(c.sha);
      titles.push(c.messageTitle);
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  // All four commits (A, B, C, merge) must appear exactly once — the old
  // `<cursor>^` paging dropped the merge's second-parent (B) across the page
  // boundary.
  assert.equal(seen.size, 4);
  assert.equal(titles.length, 4);
  assert.ok(titles.some((t) => t.startsWith('M (merge')));
  assert.ok(titles.some((t) => t.startsWith('B (feature)')));
  await rmrf(dir);
});

test('log returns an empty list on a fresh repo with no commits', async () => {
  const dir = await newRepo();
  const log = await git.log(dir);
  assert.deepEqual(log.commits, []);
  assert.equal(log.hasMore, false);
  await rmrf(dir);
});

test('log decorates the tip commit with HEAD, its branch and tags', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one');
  await git.commit(dir, 'first');
  await runGit(dir, ['tag', 'v1.0.0']);

  const log = await git.log(dir, { limit: 5 });
  const tip = log.commits[0];
  assert.ok(tip?.refs, 'the tip commit should carry refs');
  const byType = (t: string) => tip!.refs!.filter((r) => r.type === t).map((r) => r.name);
  assert.deepEqual(byType('head'), ['HEAD']);
  assert.deepEqual(byType('branch'), ['main']);
  assert.deepEqual(byType('tag'), ['v1.0.0']);
  await rmrf(dir);
});

test('commitShow returns metadata, per-file stats and the full diff', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'a.txt'), 'one\n');
  await git.commit(dir, 'init');
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  await writeFile(join(dir, 'b.txt'), 'fresh\n');
  const second = await git.commit(dir, 'add b, edit a\n\nbody text');

  const details = await git.commitShow(dir, second.sha);
  assert.equal(details.commit.sha, second.sha);
  assert.equal(details.commit.messageTitle, 'add b, edit a');
  assert.equal(details.commit.messageBody, 'body text');
  assert.equal(details.diffTruncated ?? false, false);
  assert.ok(details.diff.includes('+two'));
  assert.ok(details.diff.includes('+fresh'));

  const a = details.files.find((f) => f.path === 'a.txt');
  const b = details.files.find((f) => f.path === 'b.txt');
  assert.equal(a?.status, 'modified');
  assert.equal(a?.additions, 1);
  assert.equal(b?.status, 'added');
  assert.equal(b?.additions, 1);
  await rmrf(dir);
});

test('commitShow reports a rename with its old path', async () => {
  const dir = await newRepo();
  await writeFile(join(dir, 'old.txt'), 'alpha\nbeta\ngamma\n');
  await git.commit(dir, 'init');
  await runGit(dir, ['mv', 'old.txt', 'new.txt']);
  const renamed = await git.commit(dir, 'rename old to new');

  const details = await git.commitShow(dir, renamed.sha);
  const file = details.files.find((f) => f.path === 'new.txt');
  assert.equal(file?.status, 'renamed');
  assert.equal(file?.oldPath, 'old.txt');
  await rmrf(dir);
});
