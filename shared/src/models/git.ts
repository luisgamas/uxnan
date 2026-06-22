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

/**
 * A single commit in the repository log. The bridge parses `git log` into
 * this shape; the phone renders it in either the flat list view or the
 * graph (GitKraken-style) view. `parents` is what powers the graph —
 * each parent is a "lane" the commit sits on.
 */
export interface GitCommit {
  /** Full 40-char SHA. */
  sha: string;
  /** Abbreviated SHA (7 chars, git's default). */
  shortSha: string;
  /** Parent commit SHAs in order (zero, one or two — merge commits have two). */
  parents: string[];
  /** Commit author display name. */
  authorName: string;
  /** Commit author email. */
  authorEmail: string;
  /** Author date, unix epoch seconds. */
  authorTimestamp: number;
  /** Committer display name (often equal to author). */
  committerName: string;
  /** Committer email. */
  committerEmail: string;
  /** Committer date, unix epoch seconds. */
  committerTimestamp: number;
  /** First line of the commit message (the "title"). */
  messageTitle: string;
  /** Rest of the commit message after the title (may be empty). */
  messageBody: string;
  /** Aggregate +/-/file-count stats for the commit (git log --shortstat). */
  stats?: GitDiffTotals;
}

/**
 * A page of commits for a repository. Cursor-based pagination: when
 * `hasMore` is true the next page starts at `nextCursor` (a commit SHA)
 * — pass it as `GitLogParams.cursor` to fetch the previous page.
 */
export interface GitLogResult {
  commits: GitCommit[];
  hasMore: boolean;
  /** SHA to pass as `cursor` on the next call. Undefined when `hasMore` is false. */
  nextCursor?: string;
}

/** Parameters for `git/log`. */
export interface GitLogParams {
  cwd: string;
  /** Max commits to return. Defaults to 50 on the bridge. */
  limit?: number;
  /**
   * Cursor for pagination. When set, returns commits strictly older than
   * this SHA (exclusive). Omit for the first (newest) page.
   */
  cursor?: string;
  /**
   * Optional ref (branch / tag / remote) to start from. Defaults to
   ` HEAD. Use `origin/main` etc. for an explicit starting point.
   */
  ref?: string;
}
