/**
 * Git models exchanged over JSON-RPC (git/* methods).
 *
 * Source: architecture/02a-system-architecture.md §5.8.6 and
 * architecture/02b-contracts-and-requirements.md.
 */

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitChangedFile {
  path: string;
  status: GitFileStatus;
  /** Lines added (working tree vs HEAD). Untracked files report 0. */
  additions?: number;
  /** Lines removed (working tree vs HEAD). Untracked files report 0. */
  deletions?: number;
}

export interface GitDiffTotals {
  additions: number;
  deletions: number;
  changedFileCount: number;
}

export interface GitRepoStatus {
  branch: string;
  upstream?: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  files: GitChangedFile[];
  /** Aggregate working-tree counters. */
  diffTotals?: GitDiffTotals;
}

export interface GitDiff {
  /** Unified diff text. */
  diff: string;
  additions: number;
  deletions: number;
}

export interface GitCommitResult {
  sha: string;
  message: string;
}

export interface GitPushResult {
  success: boolean;
  remote: string;
  branch: string;
}

export interface GitPullResult {
  success: boolean;
}

export interface GitBranchResult {
  branch: string;
}

export interface GitWorktreeResult {
  path: string;
  branch: string;
}

export interface GitBranchList {
  /** The currently checked-out branch (`HEAD` when detached). */
  current: string;
  /** Local branch names. */
  local: string[];
  /** Remote-tracking branch names (e.g. `origin/main`). */
  remote: string[];
}

export interface GitPrResult {
  /** URL of the created (or pre-existing) pull request. */
  url: string;
  /** PR number when the host CLI reports it. */
  number?: number;
}
