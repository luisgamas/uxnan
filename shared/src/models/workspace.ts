/**
 * Workspace models exchanged over JSON-RPC (workspace/* methods).
 *
 * Source: architecture/02a-system-architecture.md §5.8.7.
 */

export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

export interface ImageContent {
  path: string;
  base64Data: string;
  mimeType: string;
}

/**
 * An image (or other media) attached to a user turn (`turn/send { attachments }`).
 * Tolerant by design — the phone sends inline base64 with the original
 * `mimeType`; `path`/`width`/`height` are best-effort metadata. At least one of
 * `base64Data`/`path` must be present for the bridge to deliver it to the agent.
 */
export interface TurnAttachment {
  /** Wire discriminator (always `image` today). */
  type?: 'image';
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Inline base64 payload (no `data:` URI prefix). */
  base64Data?: string;
  /** Original/workspace path the image came from, if any. */
  path?: string;
  /** Pixel width, if known. */
  width?: number;
  /** Pixel height, if known. */
  height?: number;
}

/**
 * Result of a `workspace/exists` probe: whether a thread's `cwd` still exists
 * on disk (folders/worktrees can be removed outside the app), so the phone can
 * mark a thread unavailable instead of failing every action.
 */
export interface WorkspaceExistsResult {
  /** Whether the directory exists. */
  exists: boolean;
  /** Whether it is (still) a git repository / worktree, when it exists. */
  isGitRepo?: boolean;
}

export type WorkspaceEntryType = 'file' | 'dir';

export interface WorkspaceEntry {
  name: string;
  type: WorkspaceEntryType;
  /** Size in bytes (files only; absent for directories or unreadable entries). */
  size?: number;
  /**
   * Last-modified time as epoch milliseconds (files only; absent for
   * directories or unreadable entries). Lets the file browser show a "modified"
   * timestamp without a second stat round-trip.
   */
  mtime?: number;
}

export interface WorkspaceListing {
  cwd: string;
  entries: WorkspaceEntry[];
}

export interface Checkpoint {
  id: string;
  threadId?: string;
  label?: string;
  createdAt: number;
}

export type CheckpointFileStatus = 'added' | 'modified' | 'deleted';

export interface CheckpointDiff {
  diff: string;
  files: { path: string; status: CheckpointFileStatus }[];
}

export type PatchOp = 'add' | 'modify' | 'delete';

export interface PatchChange {
  op: PatchOp;
  path: string;
  content?: string;
}

export interface ApplyResult {
  success: boolean;
  applied: number;
}

/**
 * A configured base directory the phone may browse under. The phone can descend
 * into sub-directories but never above the root (no per-project pre-config).
 */
export interface BrowseRoot {
  /** Stable id derived from the absolute path. */
  id: string;
  /** Display name (the root's basename). */
  name: string;
  /** Absolute path of the root. */
  cwd: string;
}

/** A sub-directory under the current browse path. */
export interface BrowseDirEntry {
  name: string;
  /** Path relative to the browse root, POSIX separators (e.g. `projects/foo`). */
  path: string;
  /** Whether this directory is a git repository. */
  isGitRepo: boolean;
}

/** Result of browsing one directory under a configured {@link BrowseRoot}. */
export interface BrowseResult {
  /** All configured roots, so the phone can offer a root picker. */
  roots: BrowseRoot[];
  /** Id of the root currently being browsed. */
  rootId: string;
  /** Current path relative to the root (`''` = the root itself). */
  path: string;
  /** Parent path relative to the root, or `null` at the root (cannot go above it). */
  parent: string | null;
  /** Absolute directory — pass as `thread/start { cwd }` to root an agent here. */
  cwd: string;
  /** Whether the current directory is itself a git repository. */
  isGitRepo: boolean;
  /** Sub-directories the phone may open or descend into. */
  dirs: BrowseDirEntry[];
}
