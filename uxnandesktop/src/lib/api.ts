// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppData, AppSettings, RepoData, WorktreeEntry } from "./types";

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

// --- Repositories & worktrees ----------------------------------------------

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

/** Create a worktree on a new branch in a repo. */
export function worktreeCreate(
  repoId: string,
  branch: string,
): Promise<WorktreeEntry> {
  return invoke<WorktreeEntry>("worktree_create", { repoId, branch });
}

/** List a repo's worktrees (ADE- and agent-created). */
export function worktreeList(repoId: string): Promise<WorktreeEntry[]> {
  return invoke<WorktreeEntry[]>("worktree_list", { repoId });
}
