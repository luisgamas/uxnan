import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend } from '../../test/tauri';
import { projects } from '$lib/state/projects.svelte';
import type { WorktreeEntry } from '$lib/types';

const REPO_ID = 'repo-1';
const MAIN: WorktreeEntry = {
  path: 'C:/projects/sample',
  branch: 'main',
  head: 'abc123',
  isMain: true,
};

beforeEach(() => {
  projects.activeWorktreePath = null;
  projects.error = null;
  projects.worktreesByRepo = { [REPO_ID]: [MAIN] };
});

describe('projects.createGitHubWorktree', () => {
  it.each([
    ['pr', 'github_pr_checkout', 'review-42'],
    ['issue', 'github_issue_develop', 'issue-42'],
  ] as const)(
    'creates a %s worktree through the shared adoption path',
    async (kind, command, branch) => {
      const created: WorktreeEntry = {
        path: `C:/projects/sample-worktrees/${branch}`,
        branch,
        head: 'def456',
        isMain: false,
      };
      const backend = installFakeBackend({
        [command]: () => created,
        worktree_list: () => [MAIN, created],
        worktree_status: () => ({ dirty: 0, ahead: 0, behind: 0 }),
      });

      const path = await projects.createGitHubWorktree(REPO_ID, kind, 42, branch, null);

      expect(path).toBe(created.path);
      expect(projects.activeWorktreePath).toBe(created.path);
      expect(projects.worktreesOf(REPO_ID)).toEqual([MAIN, created]);
      expect(backend.lastCallTo(command)?.args).toEqual({
        repoId: REPO_ID,
        number: '42',
        branch,
      });
    },
  );

  it('returns a readable failure without changing the active worktree', async () => {
    installFakeBackend({
      github_pr_checkout: () => {
        throw new Error('Pull request is unavailable');
      },
    });

    const path = await projects.createGitHubWorktree(REPO_ID, 'pr', 7, 'review-7', null);

    expect(path).toBeNull();
    expect(projects.activeWorktreePath).toBeNull();
    expect(projects.error).toBe('Pull request is unavailable');
  });

  it('does not delay adoption while the status badge hydrates', async () => {
    const created: WorktreeEntry = {
      path: 'C:/projects/sample-worktrees/review-8',
      branch: 'review-8',
      head: 'def456',
      isMain: false,
    };
    let statusRequested = false;
    installFakeBackend({
      github_pr_checkout: () => created,
      worktree_list: () => [MAIN, created],
      worktree_status: () => {
        statusRequested = true;
        return new Promise(() => {});
      },
    });

    const path = await projects.createGitHubWorktree(REPO_ID, 'pr', 8, 'review-8', null);

    expect(path).toBe(created.path);
    expect(projects.activeWorktreePath).toBe(created.path);
    expect(statusRequested).toBe(true);
  });
});
