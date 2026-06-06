/**
 * Git operations, returning the shared result types. Each method runs git in the
 * given project `cwd`. Failures surface as {@link GitCommandError}.
 *
 * Source: architecture/02a-system-architecture.md §5.8.6.
 */
import type {
  GitBranchResult,
  GitChangedFile,
  GitCommitResult,
  GitDiff,
  GitFileStatus,
  GitPullResult,
  GitPushResult,
  GitRepoStatus,
  GitWorktreeResult,
} from '@uxnan/shared';
import { runGit } from './git-runner.js';

export class GitService {
  async status(cwd: string): Promise<GitRepoStatus> {
    const [branch, aheadBehind, files] = await Promise.all([
      this.#currentBranch(cwd),
      this.#aheadBehind(cwd),
      this.#changedFiles(cwd),
    ]);
    return { branch, isDirty: files.length > 0, ...aheadBehind, files };
  }

  async diff(cwd: string): Promise<GitDiff> {
    const ref = (await this.#hasHead(cwd)) ? ['HEAD'] : [];
    const { stdout: diff } = await runGit(cwd, ['diff', ...ref]);
    const { stdout: numstat } = await runGit(cwd, ['diff', '--numstat', ...ref]);
    let additions = 0;
    let deletions = 0;
    for (const line of numstat.split('\n')) {
      const [add, del] = line.trim().split('\t');
      if (add && add !== '-') additions += Number(add) || 0;
      if (del && del !== '-') deletions += Number(del) || 0;
    }
    return { diff, additions, deletions };
  }

  async commit(cwd: string, message: string): Promise<GitCommitResult> {
    await runGit(cwd, ['add', '-A']);
    await runGit(cwd, ['commit', '-m', message]);
    const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD']);
    return { sha: stdout.trim(), message };
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
    const { stdout } = await runGit(cwd, ['status', '--porcelain']);
    const files: GitChangedFile[] = [];
    for (const line of stdout.split('\n')) {
      if (line.length < 4) continue;
      const xy = line.slice(0, 2);
      let path = line.slice(3);
      const arrow = path.indexOf(' -> ');
      if (arrow !== -1) path = path.slice(arrow + 4);
      files.push({ path, status: mapStatus(xy) });
    }
    return files;
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
