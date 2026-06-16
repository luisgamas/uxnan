// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStateEntry,
  AppData,
  AppSettings,
  BranchList,
  DirListing,
  FileChange,
  HookServerInfo,
  RepoData,
  SavedTerminalLayout,
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

/** Return the subset of `commands` installed on the machine (PATH + PATHEXT),
 *  so the agent catalog can enable only the agents actually present. */
export function detectAgents(commands: string[]): Promise<string[]> {
  return invoke<string[]>("agents_detect", { commands });
}

/** Set the agent commands the backend process-detection poll looks for. */
export function setAgentCommands(commands: string[]): Promise<void> {
  return invoke("set_agent_commands", { commands });
}

/** Coordinates of the local agent hook server (null until it's listening). */
export function getHookInfo(): Promise<HookServerInfo | null> {
  return invoke<HookServerInfo | null>("get_hook_info");
}

/** The cached last-known agent states (hook reports), to hydrate the sidebar. */
export function agentStates(): Promise<AgentStateEntry[]> {
  return invoke<AgentStateEntry[]>("agent_states");
}

/** Persist the per-workspace terminal layout (restored on next startup). */
export function setTerminalLayout(
  layout: SavedTerminalLayout | null,
): Promise<void> {
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

// --- Git status, diffs & staging (right-panel review) ----------------------

/** List a worktree's changed files (staged + unstaged + untracked). */
export function gitStatus(path: string): Promise<FileChange[]> {
  return invoke<FileChange[]>("git_status", { path });
}

/** Unified diff for one file (`staged` = index-vs-HEAD, else worktree-vs-index). */
export function gitDiff(
  path: string,
  file: string,
  staged: boolean,
): Promise<string> {
  return invoke<string>("git_diff", { path, file, staged });
}

/** Stage one file. */
export function gitStage(path: string, file: string): Promise<void> {
  return invoke("git_stage", { path, file });
}

/** Unstage one file. */
export function gitUnstage(path: string, file: string): Promise<void> {
  return invoke("git_unstage", { path, file });
}

/** Stage every change. */
export function gitStageAll(path: string): Promise<void> {
  return invoke("git_stage_all", { path });
}

/** Unstage everything. */
export function gitUnstageAll(path: string): Promise<void> {
  return invoke("git_unstage_all", { path });
}

/** Discard a file's local changes (tracked → restore HEAD; untracked → delete). */
export function gitDiscard(
  path: string,
  file: string,
  untracked: boolean,
): Promise<void> {
  return invoke("git_discard", { path, file, untracked });
}

/** Commit the staged changes with `message`. */
export function gitCommit(path: string, message: string): Promise<void> {
  return invoke("git_commit", { path, message });
}

/** Set (or clear) the worktree the backend watcher polls for live status. */
export function gitSetWatch(path: string | null): Promise<void> {
  return invoke("git_set_watch", { path });
}

/** Push the current branch. */
export function gitPush(path: string): Promise<void> {
  return invoke("git_push", { path });
}

/** Pull fast-forward-only. */
export function gitPull(path: string): Promise<void> {
  return invoke("git_pull", { path });
}
