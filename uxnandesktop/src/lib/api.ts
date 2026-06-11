// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppData,
  AppSettings,
  BranchList,
  DirListing,
  RepoData,
  SavedTermNode,
  WorktreeEntry,
  WorktreeStatus,
} from "./types";

/** Load the full persisted application state (called once at boot). */
export function getAppState(): Promise<AppData> {
  return invoke<AppData>("get_app_state");
}

/** Persist updated settings; resolves to the new full state. */
export function updateSettings(settings: AppSettings): Promise<AppData> {
  return invoke<AppData>("update_settings", { settings });
}

/** Backend liveness probe; resolves to `"pong"`. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}

/** Persist the terminal region/tab layout (restored on next startup). `null`
 *  records an empty area (no terminals open). */
export function setTerminalLayout(layout: SavedTermNode | null): Promise<void> {
  return invoke("set_terminal_layout", { layout });
}

// --- Repositories & worktrees ----------------------------------------------

/** List a directory's sub-folders (flagging git repos) for the in-app project
 *  picker. Omit `path` to start at the home directory. */
export function browseDirs(path?: string): Promise<DirListing> {
  return invoke<DirListing>("browse_dirs", { path: path ?? null });
}

/** Register a git repository by path. */
export function repoAdd(path: string): Promise<RepoData> {
  return invoke<RepoData>("repo_add", { path });
}

/** Remove a registered repository (does not touch disk). */
export function repoRemove(id: string): Promise<void> {
  return invoke("repo_remove", { id });
}

/** List registered repositories. */
export function repoList(): Promise<RepoData[]> {
  return invoke<RepoData[]>("repo_list");
}

/** List a repo's local branches + the resolved default base. */
export function branchList(repoId: string): Promise<BranchList> {
  return invoke<BranchList>("branch_list", { repoId });
}

/** Create a worktree on a new branch in a repo. `base` is the ref to branch
 *  from; omit it to let the backend resolve the repo's default base. */
export function worktreeCreate(
  repoId: string,
  branch: string,
  base?: string,
): Promise<WorktreeEntry> {
  return invoke<WorktreeEntry>("worktree_create", {
    repoId,
    branch,
    base: base ?? null,
  });
}

/** Remove a worktree. Without `force`, the backend refuses when the worktree has
 *  uncommitted changes (surface the error and offer a forced retry). */
export function worktreeRemove(
  repoId: string,
  path: string,
  branch: string | null,
  force: boolean,
): Promise<void> {
  return invoke("worktree_remove", { repoId, path, branch: branch ?? null, force });
}

/** List a repo's worktrees (ADE- and agent-created). */
export function worktreeList(repoId: string): Promise<WorktreeEntry[]> {
  return invoke<WorktreeEntry[]>("worktree_list", { repoId });
}

/** Summarize a worktree's working-tree status (dirty count + ahead/behind). */
export function worktreeStatus(path: string): Promise<WorktreeStatus> {
  return invoke<WorktreeStatus>("worktree_status", { path });
}
