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

/** Kind of ref pointing at a commit (decoration parsed from `git log %D`). */
export type GitRefType = 'head' | 'branch' | 'remoteBranch' | 'tag';

/**
 * A ref (branch / remote branch / tag / HEAD) that points at a commit.
 * Parsed from `git log`'s `%D` decoration so the phone can render branch
 * and tag chips and colour HEAD distinctly in the graph.
 */
export interface GitRef {
  /** Display name (e.g. `main`, `origin/main`, `v1.2.0`, `HEAD`). */
  name: string;
  /** What the ref is. */
  type: GitRefType;
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
  /**
   * Refs that point at this commit (branches, remote branches, tags, HEAD),
   * parsed from `git log`'s `%D` decoration. Absent/empty for commits with no
   * decoration.
   */
  refs?: GitRef[];
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

/**
 * A single file touched by a commit (`git show --name-status --numstat`).
 * Rename/copy entries carry the previous path in `oldPath`.
 */
export interface GitCommitFile {
  /** Repository-relative path after the change (the new path on a rename). */
  path: string;
  /** Previous path, set only for renames/copies. */
  oldPath?: string;
  /** Per-file change kind. */
  status: GitFileStatus;
  /** Lines added in this commit (0 for binary/unknown). */
  additions: number;
  /** Lines removed in this commit (0 for binary/unknown). */
  deletions: number;
  /** True when git reported the file as binary (no line counts). */
  binary?: boolean;
}

/**
 * Full detail of one commit: its metadata (incl. refs), the list of files it
 * touched with per-file +/- counts, and the complete unified diff. Powers the
 * mobile commit-detail view (`git/commitShow`).
 */
export interface GitCommitDetails {
  /** The commit's metadata (same shape as a `git/log` entry). */
  commit: GitCommit;
  /** Files touched by the commit, with per-file stats. */
  files: GitCommitFile[];
  /** The commit's full unified diff (may be truncated — see `diffTruncated`). */
  diff: string;
  /** True when `diff` was capped because the patch exceeded the size budget. */
  diffTruncated?: boolean;
}

/** Parameters for `git/commitShow`. */
export interface GitCommitShowParams {
  cwd: string;
  /** The commit to inspect (full or abbreviated SHA, or any rev). */
  sha: string;
}
