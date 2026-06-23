/**
 * Git operations, returning the shared result types. Each method runs git in the
 * given project `cwd`. Failures surface as {@link GitCommandError}.
 *
 * Source: architecture/02a-system-architecture.md §5.8.6.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  GitBranchList,
  GitBranchResult,
  GitChangedFile,
  GitCommit,
  GitCommitResult,
  GitDiff,
  GitDiffTotals,
  GitFileStatus,
  GitLogResult,
  GitPrResult,
  GitPullResult,
  GitPushResult,
  GitRepoStatus,
  GitWorktreeResult,
} from '@uxnan/shared';
import { GitCommandError, runGh, runGit } from './git-runner.js';

export class GitService {
  async status(cwd: string): Promise<GitRepoStatus> {
    const [branch, upstream, aheadBehind, files] = await Promise.all([
      this.#currentBranch(cwd),
      this.#upstream(cwd),
      this.#aheadBehind(cwd),
      this.#changedFiles(cwd),
    ]);
    const diffTotals = files.reduce<GitDiffTotals>(
      (totals, file) => ({
        additions: totals.additions + (file.additions ?? 0),
        deletions: totals.deletions + (file.deletions ?? 0),
        changedFileCount: totals.changedFileCount + 1,
      }),
      { additions: 0, deletions: 0, changedFileCount: 0 },
    );
    return {
      branch,
      isDirty: files.length > 0,
      ...aheadBehind,
      files,
      diffTotals,
      ...(upstream ? { upstream } : {}),
    };
  }

  /**
   * Returns the working-tree diff. With `path`, returns just that file's diff —
   * for an untracked file (no diff vs HEAD) it synthesises an all-additions
   * unified diff from the file contents so the phone can render it.
   */
  async diff(cwd: string, path?: string): Promise<GitDiff> {
    const ref = (await this.#hasHead(cwd)) ? ['HEAD'] : [];
    const pathArgs = path ? ['--', path] : [];
    const { stdout: diff } = await runGit(cwd, ['diff', ...ref, ...pathArgs]);
    const { stdout: numstat } = await runGit(cwd, ['diff', '--numstat', ...ref, ...pathArgs]);
    let { additions, deletions } = this.#sumNumstat(numstat);
    let text = diff;
    if (path && diff.trim() === '' && (await this.#isUntracked(cwd, path))) {
      const synth = await this.#untrackedDiff(cwd, path);
      text = synth.diff;
      additions = synth.additions;
      deletions = 0;
    }
    return { diff: text, additions, deletions };
  }

  /**
   * Returns the commit log for [cwd], newest first. Supports cursor-based
   * pagination: pass `options.cursor` (a commit SHA) to fetch the page
   * strictly older than that commit, and `options.limit` to cap the page
   * size (the bridge default is 50). The result includes `hasMore` +
   * `nextCursor` so the phone can keep paging without offsets that go
   * stale on rebase.
   *
   * The output is parsed from a single `git log` invocation using a custom
   * format: fields are null-separated, commits are record-separated
   * (ASCII 0x1E). The phone renders the parsed list in either a flat list
   * or a GitKraken-style graph (which uses `parents` to draw the lanes).
   */
  async log(
    cwd: string,
    options: { limit?: number; cursor?: string; ref?: string } = {},
  ): Promise<GitLogResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    // Fetch one extra commit so we can tell `hasMore` without a second git
    // invocation (the extra is dropped from the result).
    const fetchLimit = limit + 1;
    const format = [
      '%H', // full SHA
      '%h', // short SHA
      '%P', // parents (space-separated)
      '%an', // author name
      '%ae', // author email
      '%at', // author date (unix seconds)
      '%cn', // committer name
      '%ce', // committer email
      '%ct', // committer date (unix seconds)
      '%B', // raw message (title + body, separated by a blank line)
    ].join('%x00');
    const args = [
      'log',
      `--format=${format}%x1e`,
      '-z',
      '--shortstat',
      '-n',
      String(fetchLimit),
      // Cursor: when set, start from the cursor's parent (`<cursor>^`) so
      // the cursor itself is excluded and we get strictly older commits.
      // The `^` notation is a shorthand for `~1` and works for both
      // regular and merge commits.
      options.cursor ? `${options.cursor}^` : (options.ref ?? 'HEAD'),
    ];
    try {
      const { stdout } = await runGit(cwd, args);
      return parseLogOutput(stdout, limit);
    } catch (err) {
      // A fresh repo (no commits yet) has no HEAD — `git log HEAD` exits
      // non-zero. That's not an error from the caller's perspective: it
      // just means there's nothing to list.
      if (err instanceof GitCommandError && /unknown revision|bad revision/i.test(err.stderr)) {
        return { commits: [], hasMore: false };
      }
      throw err;
    }
  }

  async commit(cwd: string, message: string, paths?: string[]): Promise<GitCommitResult> {
    if (paths && paths.length > 0) {
      await runGit(cwd, ['add', '--', ...paths]);
    } else {
      await runGit(cwd, ['add', '-A']);
    }
    await runGit(cwd, ['commit', '-m', message]);
    const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD']);
    return { sha: stdout.trim(), message };
  }

  /**
   * Undoes the most recent commit, keeping its changes in the working tree
   * (`git reset --soft HEAD~1`) so the user can re-stage/re-commit before
   * pushing. Non-destructive: no file content is lost.
   */
  async undoCommit(cwd: string): Promise<void> {
    await runGit(cwd, ['reset', '--soft', 'HEAD~1']);
  }

  /** Lists the current branch plus all local and remote branches. */
  async branches(cwd: string): Promise<GitBranchList> {
    const [current, localOut, remoteOut] = await Promise.all([
      this.#currentBranch(cwd),
      runGit(cwd, ['branch', '--format=%(refname:short)']),
      runGit(cwd, ['branch', '-r', '--format=%(refname:short)']),
    ]);
    const local = localOut.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
    const remote = remoteOut.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b && !b.endsWith('/HEAD') && !b.includes('->'));
    return { current, local, remote };
  }

  /** Stages the given paths (`git add`). */
  async stage(cwd: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await runGit(cwd, ['add', '--', ...paths]);
  }

  /** Unstages the given paths, keeping working-tree changes (`git restore --staged`). */
  async unstage(cwd: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await runGit(cwd, ['restore', '--staged', '--', ...paths]);
  }

  /**
   * Discards working-tree changes for the given paths. Tracked files are
   * restored from HEAD (index + worktree); untracked files are deleted. This is
   * destructive and irreversible — callers must confirm first.
   */
  async discard(cwd: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const untracked = new Set(
      (await this.#changedFiles(cwd)).filter((f) => f.status === 'untracked').map((f) => f.path),
    );
    const tracked = paths.filter((p) => !untracked.has(p));
    const toDelete = paths.filter((p) => untracked.has(p));
    if (tracked.length > 0) {
      await runGit(cwd, ['restore', '--staged', '--worktree', '--', ...tracked]);
    }
    for (const path of toDelete) {
      await rm(join(cwd, path), { force: true, recursive: true });
    }
  }

  /**
   * Opens a pull request via the GitHub CLI (`gh pr create`). Requires `gh` to
   * be installed and authenticated; failures surface as {@link GitCommandError}
   * with an actionable message. Returns the PR URL.
   */
  async createPr(
    cwd: string,
    title: string,
    body?: string,
    base?: string,
    head?: string,
  ): Promise<GitPrResult> {
    // Make sure the head branch (defaults to the current one) is on the remote
    // first — a local-only branch can't be the head of a PR otherwise. This is
    // also how "commit on a local branch then PR" publishes that branch.
    const branch = head ?? (await this.#currentBranch(cwd));
    if (base && base === branch) {
      throw new GitCommandError(
        'gh pr create failed',
        `head and base are the same branch (${branch})`,
        null,
      );
    }
    await runGit(cwd, ['push', '-u', 'origin', branch]);
    // Pre-flight: a PR needs at least one commit on the head not in the base.
    // Without this gh can appear to "succeed" with nothing to deliver.
    const baseRef = await this.#baseRef(cwd, base);
    if (baseRef) {
      const { stdout } = await runGit(cwd, ['rev-list', '--count', `${baseRef}..${branch}`]);
      if ((Number(stdout.trim()) || 0) === 0) {
        throw new GitCommandError(
          'gh pr create failed',
          `no commits to compare between ${baseRef} and ${branch} — ` +
            'commit and push something first',
          null,
        );
      }
    }
    const args = ['pr', 'create', '--title', title, '--body', body ?? '', '--head', branch];
    if (base) args.push('--base', base);
    const { stdout } = await runGh(cwd, args);
    const url = stdout.trim().split('\n').pop()?.trim() ?? '';
    const match = url.match(/\/pull\/(\d+)/);
    // Only report success when gh actually returned a PR URL.
    if (!match || !/^https?:\/\//.test(url)) {
      throw new GitCommandError(
        'gh pr create failed',
        url || 'the GitHub CLI did not return a pull-request URL',
        null,
      );
    }
    return { url, number: Number(match[1]) };
  }

  /** The base ref to diff a PR against — `origin/<base>` or the remote HEAD. */
  async #baseRef(cwd: string, base?: string): Promise<string | undefined> {
    if (base) return `origin/${base}`;
    try {
      const { stdout } = await runGit(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
      const ref = stdout.trim().replace(/^refs\/remotes\//, '');
      return ref || undefined;
    } catch {
      return undefined;
    }
  }

  async push(cwd: string, remote: string, branch: string): Promise<GitPushResult> {
    await runGit(cwd, ['push', remote, branch]);
    return { success: true, remote, branch };
  }

  async pull(cwd: string, remote?: string, branch?: string): Promise<GitPullResult> {
    const args = ['pull', ...(remote ? [remote] : []), ...(branch ? [branch] : [])];
    await runGit(cwd, args);
    return { success: true };
  }

  async checkout(cwd: string, branch: string): Promise<void> {
    await runGit(cwd, ['checkout', branch]);
  }

  /**
   * Switches to {@link target}, keeping each branch's work independent.
   *
   * - `carryChanges: true` → the working-tree changes follow you to the target
   *   (`git checkout` moves them; a conflict surfaces as an error).
   * - `carryChanges: false` → the current branch's changes are stashed under a
   *   branch-tagged label so they stay put and are NOT lost. On switching back
   *   that branch's stash is automatically restored.
   *
   * Either way, any changes previously *left* on the target branch are restored
   * after checkout.
   */
  async switchBranch(cwd: string, target: string, carryChanges: boolean): Promise<void> {
    const current = await this.#currentBranch(cwd);
    if (target === current) return;
    if (!carryChanges) {
      const { stdout } = await runGit(cwd, ['status', '--porcelain']);
      if (stdout.trim()) {
        await runGit(cwd, ['stash', 'push', '--include-untracked', '-m', autoStashLabel(current)]);
      }
    }
    await runGit(cwd, ['checkout', target]);
    await this.#restoreAutoStash(cwd, target);
  }

  /** Pops the auto-stash that belongs to {@link branch}, if one exists. */
  async #restoreAutoStash(cwd: string, branch: string): Promise<void> {
    const { stdout } = await runGit(cwd, ['stash', 'list', '--format=%gd %gs']);
    const label = autoStashLabel(branch);
    for (const line of stdout.split('\n')) {
      const ref = line.trim().split(/\s+/)[0];
      if (ref && line.includes(label)) {
        await runGit(cwd, ['stash', 'pop', ref]);
        return;
      }
    }
  }

  async createBranch(cwd: string, name: string): Promise<GitBranchResult> {
    await runGit(cwd, ['branch', name]);
    return { branch: name };
  }

  async createWorktree(cwd: string, branch: string, path: string): Promise<GitWorktreeResult> {
    const exists = await this.#branchExists(cwd, branch);
    const args = exists
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path];
    await runGit(cwd, args);
    return { path, branch };
  }

  /**
   * Revert [commit] (e.g. `HEAD`, a sha) — creates a NEW commit that undoes it,
   * preserving history (unlike `undoCommit`'s soft reset). `--no-edit` keeps the
   * default revert message; fails (and surfaces) on a conflict.
   */
  async revert(cwd: string, commit: string): Promise<void> {
    await runGit(cwd, ['revert', '--no-edit', commit]);
  }

  /**
   * Delete a local branch. With `force: false` this is `git branch -d`, which
   * **refuses** a branch not fully merged (the safe default — the error is
   * surfaced to the phone); `force: true` is `-D` (delete regardless).
   */
  async deleteBranch(cwd: string, branch: string, force: boolean): Promise<void> {
    await runGit(cwd, ['branch', force ? '-D' : '-d', branch]);
  }

  /**
   * Remove a worktree. With `force: false`, `git worktree remove` **refuses** a
   * worktree with uncommitted/untracked changes (safe default — surfaced);
   * `force: true` adds `--force`. Also prunes stale admin entries afterward.
   *
   * `git` refuses to remove the worktree you are *standing in*, so we run the
   * removal from the repo's MAIN worktree (resolved via `worktree list`),
   * letting the phone remove the very worktree backing the active thread.
   */
  async removeWorktree(cwd: string, path: string, force: boolean): Promise<void> {
    const runFrom = await this.#mainWorktree(cwd);
    const args = force ? ['worktree', 'remove', '--force', path] : ['worktree', 'remove', path];
    await runGit(runFrom, args);
    // Best-effort: drop any now-stale worktree admin files.
    await runGit(runFrom, ['worktree', 'prune']).catch(() => undefined);
  }

  /** The repo's primary worktree path (the first `worktree list` entry), or [cwd]. */
  async #mainWorktree(cwd: string): Promise<string> {
    try {
      const { stdout } = await runGit(cwd, ['worktree', 'list', '--porcelain']);
      const first = stdout.split('\n').find((line) => line.startsWith('worktree '));
      if (first) {
        const main = first.slice('worktree '.length).trim();
        if (main) return main;
      }
    } catch {
      // not a git repo / detached — fall back to the given cwd
    }
    return cwd;
  }

  async #currentBranch(cwd: string): Promise<string> {
    // `branch --show-current` works on an unborn branch (no commits yet) and
    // returns '' on a detached HEAD.
    try {
      const { stdout } = await runGit(cwd, ['branch', '--show-current']);
      const branch = stdout.trim();
      if (branch) return branch;
    } catch {
      // fall through
    }
    return 'HEAD';
  }

  async #aheadBehind(cwd: string): Promise<{ ahead: number; behind: number }> {
    try {
      const { stdout } = await runGit(cwd, [
        'rev-list',
        '--left-right',
        '--count',
        '@{upstream}...HEAD',
      ]);
      const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
      return { ahead: ahead || 0, behind: behind || 0 };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  async #changedFiles(cwd: string): Promise<GitChangedFile[]> {
    const [{ stdout }, counts] = await Promise.all([
      runGit(cwd, ['status', '--porcelain']),
      this.#perFileCounts(cwd),
    ]);
    const files: GitChangedFile[] = [];
    for (const line of stdout.split('\n')) {
      if (line.length < 4) continue;
      const xy = line.slice(0, 2);
      let path = line.slice(3);
      const arrow = path.indexOf(' -> ');
      if (arrow !== -1) path = path.slice(arrow + 4);
      const count = counts.get(path);
      files.push({
        path,
        status: mapStatus(xy),
        additions: count?.additions ?? 0,
        deletions: count?.deletions ?? 0,
      });
    }
    return files;
  }

  /** Per-file +/- counts via `git diff --numstat` (tracked changes only). */
  async #perFileCounts(
    cwd: string,
  ): Promise<Map<string, { additions: number; deletions: number }>> {
    const ref = (await this.#hasHead(cwd)) ? ['HEAD'] : [];
    const { stdout } = await runGit(cwd, ['diff', '--numstat', ...ref]);
    const counts = new Map<string, { additions: number; deletions: number }>();
    for (const line of stdout.split('\n')) {
      const [add, del, path] = line.trim().split('\t');
      if (!path) continue;
      counts.set(path, {
        additions: add === '-' ? 0 : Number(add) || 0,
        deletions: del === '-' ? 0 : Number(del) || 0,
      });
    }
    return counts;
  }

  #sumNumstat(numstat: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const line of numstat.split('\n')) {
      const [add, del] = line.trim().split('\t');
      if (add && add !== '-') additions += Number(add) || 0;
      if (del && del !== '-') deletions += Number(del) || 0;
    }
    return { additions, deletions };
  }

  async #upstream(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await runGit(cwd, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ]);
      const ref = stdout.trim();
      return ref || undefined;
    } catch {
      return undefined;
    }
  }

  async #isUntracked(cwd: string, path: string): Promise<boolean> {
    const { stdout } = await runGit(cwd, ['status', '--porcelain', '--', path]);
    return stdout.startsWith('??');
  }

  /** Builds an all-additions unified diff for an untracked file's contents. */
  async #untrackedDiff(cwd: string, path: string): Promise<{ diff: string; additions: number }> {
    let content: string;
    try {
      content = await readFile(join(cwd, path), 'utf8');
    } catch {
      return { diff: '', additions: 0 };
    }
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const header =
      `diff --git a/${path} b/${path}\n` +
      `new file mode 100644\n--- /dev/null\n+++ b/${path}\n` +
      `@@ -0,0 +1,${lines.length} @@\n`;
    const body = lines.map((l) => `+${l}`).join('\n');
    return { diff: header + body, additions: lines.length };
  }

  async #hasHead(cwd: string): Promise<boolean> {
    try {
      await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async #branchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      await runGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }
}

/** Label used to tag a branch's auto-stash so it can be restored on return. */
function autoStashLabel(branch: string): string {
  return `uxnan-auto:${branch}`;
}

/**
 * Parses a `git log` payload produced by the format in {@link GitService.log}.
 *
 * The output is NUL-terminated records (`-z`) where each record's
 * `--format=...%x1e` injects a 0x1E record separator, then `--shortstat`
 * appends a line of stats after the separator, then the next commit starts.
 * The resulting shape is:
 *
 *     <commit1 fields>\n<msg>\n\x1e\x00\n<shortstat1>\n<commit2 fields>\n<msg>\n\x1e\x00\n<shortstat2>\n...
 *
 * We split on `\x1e`. The first record is just commit1's fields; every
 * subsequent record starts with a `\x00\n<shortstat>\n` prefix that
 * belongs to the *previous* commit, followed by the current commit's
 * fields. We pair them by deferring the shortstat attachment by one record.
 */
function parseLogOutput(stdout: string, limit: number): GitLogResult {
  // Trim the trailing 0x1E so the last record isn't empty, then split.
  const records = stdout.replace(/\x1e+$/, '').split('\x1e');
  // Each entry holds the parsed commit (without stats) and the shortstat
  // that belongs to it. We populate the shortstat retroactively when the
  // next record provides it.
  const parsed: { commit: Omit<GitCommit, 'stats'>; shortstat: string }[] = [];
  for (const rawRecord of records) {
    if (!rawRecord.trim()) continue;
    // Peel off a leading `\x00\n<shortstat>\n` (present on every record
    // except the first). The shortstat belongs to the PREVIOUS commit.
    let shortstat = '';
    let record = rawRecord;
    const shortstatMatch = rawRecord.match(/^\x00\n(.*?)\n([\s\S]*)$/);
    if (shortstatMatch) {
      shortstat = shortstatMatch[1] ?? '';
      record = shortstatMatch[2] ?? '';
    }
    const parts = record.split('\x00');
    const [
      sha,
      shortSha,
      parentsRaw,
      authorName,
      authorEmail,
      authorTs,
      committerName,
      committerEmail,
      committerTs,
      messageRaw,
    ] = parts;
    if (!sha) continue;
    // Attach the shortstat from THIS record to the PREVIOUS commit (it
    // appeared after that commit in the git output).
    if (parsed.length > 0 && shortstat) {
      parsed[parsed.length - 1]!.shortstat = shortstat;
    }
    const parents = parentsRaw ? parentsRaw.trim().split(/\s+/).filter(Boolean) : [];
    const message = messageRaw ?? '';
    // Message: first line is the title, the rest (after a blank line) is
    // the body. git's %B includes a trailing newline.
    const messageLines = message.replace(/\n$/, '').split('\n');
    const messageTitle = messageLines[0] ?? '';
    let messageBody = '';
    for (let i = 1; i < messageLines.length; i++) {
      if (messageLines[i] === '' && i + 1 < messageLines.length) {
        messageBody = messageLines
          .slice(i + 1)
          .join('\n')
          .trim();
        break;
      }
    }
    const commit: Omit<GitCommit, 'stats'> = {
      sha: sha.trim(),
      shortSha: shortSha?.trim() ?? sha.trim().slice(0, 7),
      parents,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorTimestamp: Number(authorTs) || 0,
      committerName: committerName ?? authorName ?? '',
      committerEmail: committerEmail ?? authorEmail ?? '',
      committerTimestamp: Number(committerTs) || Number(authorTs) || 0,
      messageTitle,
      messageBody,
    };
    parsed.push({ commit, shortstat: '' });
  }
  // Materialise the shortstat on each commit.
  const commits: GitCommit[] = parsed.map(({ commit, shortstat }) => {
    const statMatch = shortstat.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );
    if (statMatch) {
      const filesChanged = Number(statMatch[1]) || 0;
      const additions = Number(statMatch[2]) || 0;
      const deletions = Number(statMatch[3]) || 0;
      return {
        ...commit,
        stats: { changedFileCount: filesChanged, additions, deletions },
      };
    }
    return commit;
  });
  const hasMore = commits.length > limit;
  const trimmed = hasMore ? commits.slice(0, limit) : commits;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.sha : undefined;
  return {
    commits: trimmed,
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function mapStatus(xy: string): GitFileStatus {
  if (xy === '??') return 'untracked';
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflicted';
  const code = xy.trim()[0];
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'M':
    default:
      return 'modified';
  }
}
