/**
 * Project models exchanged over JSON-RPC (project/* methods).
 *
 * The bridge keeps ONE persistent registry of projects (architecture/02a
 * §5.8.17): the phone and Uxnan Desktop are mirrors of it, so a project added
 * or removed on either appears or disappears on both. Removing a project never
 * deletes its conversations.
 */

/**
 * How a project entered the registry — informational, never a permission:
 * - `user` — added by hand on a client (`project/add`).
 * - `desktop` — published by Uxnan Desktop from its own project list.
 * - `thread` — registered because a conversation started in its folder.
 * - `config` — listed in the bridge config's `workspaceRoots`.
 */
export type ProjectSource = 'user' | 'desktop' | 'thread' | 'config';

export interface Project {
  id: string;
  name: string;
  /** Absolute, canonical (symlinks resolved) working directory on the PC. */
  cwd: string;
  /** Agent pinned for this project in bridge config (the thread's default agent). */
  agentId?: string;
  /** Model pinned for this project's agent in bridge config, when set. */
  model?: string;
  /** How it entered the registry. Absent on a project that is not registered
   *  (a `project/resolve` of a folder nobody added). */
  source?: ProjectSource;
  /** When it was registered (epoch ms). */
  addedAt?: number;
  /** When its entry last changed (epoch ms). */
  updatedAt?: number;
  /** Sync revision of its last change (see `SyncChanges`). */
  rev?: number;
}

export interface ProjectAddParams {
  /** Folder to register. A worktree registers the repository it belongs to. */
  cwd: string;
  /** Display name; defaults to the folder's name. */
  name?: string;
}

export interface ProjectRemoveParams {
  projectId: string;
}

export interface ProjectRemoveResult {
  removed: boolean;
}

export interface ProjectRenameParams {
  projectId: string;
  /** New display name; an empty string restores the folder's name. */
  name: string;
}

export interface AuthStatus {
  agentId: string;
  requiresLogin: boolean;
  loginInProgress: boolean;
  authenticatedProvider?: string;
  displayName?: string;
  transportMode: 'local' | 'relay';
  platform: NodeJS.Platform | string;
}
