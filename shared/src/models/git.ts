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
}

export interface GitRepoStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  files: GitChangedFile[];
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
