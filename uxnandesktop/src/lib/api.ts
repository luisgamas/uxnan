// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppData,
  AppSettings,
  BranchList,
  RepoData,
  SavedTermNode,
  WorktreeEntry,
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

// FOR-DEV: replace this OS-native folder dialog with an in-app shadcn-svelte
// directory picker (Dialog + tree) backed by a Rust `browse_dirs` command, so
// "Add project" stays inside the ADE's own UI. See uxnandesktop/FOR-DEV.md.
/** Open a native folder picker; resolves to the chosen path or null. */
export async function pickDirectory(title?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
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
