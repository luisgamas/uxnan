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

export type WorkspaceEntryType = 'file' | 'dir';

export interface WorkspaceEntry {
  name: string;
  type: WorkspaceEntryType;
  size?: number;
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
