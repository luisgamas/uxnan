// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStateEntry,
  AppData,
  AppSettings,
  BranchList,
  ClaudeHooksStatus,
  CommitInfo,
  DirListing,
  FileChange,
  FileContent,
  FileNumstat,
  FsEntry,
  HookInstall,
  HookScripts,
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

/** Request (or release) keeping the system awake while an agent works. */
export function setPreventSleep(active: boolean): Promise<void> {
  return invoke("set_prevent_sleep", { active });
}

/** Paths of the bundled hook scripts the ADE wrote to `<app-data>/hooks/`
 *  (Phase 4 follow-up, ready-made per-agent hook configs). `null` if the
 *  install-on-startup step failed — the one-click install is then unavailable
 *  but precise hook reporting still works. */
export function getHookInstall(): Promise<HookInstall | null> {
  return invoke<HookInstall | null>("get_hook_install");
}

/** Current state of the Claude `settings.json` `hooks` block. The UI uses
 *  this to render an honest "Installed" / "Not installed" / "Unavailable"
 *  badge — we never claim installed unless the file carries our marker. */
export function getClaudeHooksStatus(): Promise<ClaudeHooksStatus> {
  return invoke<ClaudeHooksStatus>("get_claude_hooks_status");
}

/** Add (or replace) the ADE-managed `hooks` block in `~/.claude/settings.json`,
 *  pointing at the installed script. Preserves every other top-level key.
 *  Returns the new status so the UI can refresh without a second round-trip. */
export function installClaudeHooks(): Promise<ClaudeHooksStatus> {
  return invoke<ClaudeHooksStatus>("install_claude_hooks");
}

/** Remove the ADE-managed `hooks` block from `~/.claude/settings.json`.
 *  Idempotent; no-op if it's not ours. */
export function uninstallClaudeHooks(): Promise<ClaudeHooksStatus> {
  return invoke<ClaudeHooksStatus>("uninstall_claude_hooks");
}

/** Textual content of every bundled hook script (rendered Claude JSON +
 *  the three platform wrappers). `null` if the startup install step failed. */
export function getHookScripts(): Promise<HookScripts | null> {
  return invoke<HookScripts | null>("get_hook_scripts");
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

// --- Filesystem: file tree + editor ----------------------------------------

/** List the immediate children of a directory (sub-dirs first, then files) for
 *  the file-tree tab. Lazy — called per folder on expand. */
export function fsListDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_list_dir", { path });
}

/** Read a single text file for the editor (binary / too-large guards in flags). */
export function fsReadFile(path: string): Promise<FileContent> {
  return invoke<FileContent>("fs_read_file", { path });
}

/** Overwrite a file with the editor's content (atomic on the backend). */
export function fsWriteFile(path: string, content: string): Promise<void> {
  return invoke("fs_write_file", { path, content });
}

/** Reveal a path in the OS file manager (Explorer / Finder / etc.). */
export function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

/** Set (or clear with `null`) the worktree root the filesystem watcher follows.
 *  The backend then emits `fs:changed` as files under it change on disk. */
export function fsSetWatch(path: string | null): Promise<void> {
  return invoke("fs_set_watch", { path });
}

/** Working-tree-vs-HEAD diff for one file, for the editor's change gutter.
 *  Empty for a clean or untracked file. */
export function gitDiffHead(path: string, file: string): Promise<string> {
  return invoke<string>("git_diff_head", { path, file });
}

// --- Git status, diffs & staging (right-panel review) ----------------------

/** List a worktree's changed files (staged + unstaged + untracked). */
export function gitStatus(path: string): Promise<FileChange[]> {
  return invoke<FileChange[]>("git_status", { path });
}

/** Per-file added/deleted line counts vs HEAD (for the changed-files list). */
export function gitNumstat(path: string): Promise<FileNumstat[]> {
  return invoke<FileNumstat[]>("git_numstat", { path });
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

/** Apply a single-hunk unified-diff patch to stage/unstage/discard it. `cached`
 *  targets the index; `reverse` reverses the patch (unstage / discard). */
export function gitApply(
  path: string,
  patch: string,
  cached: boolean,
  reverse: boolean,
): Promise<void> {
  return invoke("git_apply", { path, patch, cached, reverse });
}

/** Commit the staged changes with `message`. With `amend`, rewrites the current
 *  HEAD commit instead of creating a new one. With `signOff`, appends a
 *  `Signed-off-by:` trailer using the configured git identity. */
export function gitCommit(
  path: string,
  message: string,
  amend = false,
  signOff = false,
): Promise<void> {
  return invoke("git_commit", { path, message, amend, signOff });
}

/** List the worktree's commit history (newest first), `limit` commits from
 *  `skip`. Powers the History tab + branch graph. */
export function gitLog(
  path: string,
  limit: number,
  skip: number,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_log", { path, limit, skip });
}

/** Unified diff a single commit introduced (vs its first parent). */
export function gitShow(path: string, hash: string): Promise<string> {
  return invoke<string>("git_show", { path, hash });
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
