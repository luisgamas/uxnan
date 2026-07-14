// Thin, typed wrappers over the Tauri command surface. One function per Rust
// `#[tauri::command]`; keep the names and payloads in lockstep with
// `src-tauri/src/commands.rs`.

import { invoke } from "@tauri-apps/api/core";
import type {
  AgentModel,
  AgentStateEntry,
  AppData,
  AppSettings,
  BranchList,
  AgentHooksStatus,
  CommitInfo,
  DirListing,
  FileChange,
  FileContent,
  FileNumstat,
  FileSearch,
  FsEntry,
  HookInstall,
  HookScripts,
  McpInfo,
  HookServerInfo,
  ImageDiff,
  RemoteOwner,
  RemoveOutcome,
  ProviderUsage,
  RepoData,
  SavedTerminalLayout,
  UpdateInfo,
  UsageProvider,
  WorktreeEntry,
  WorktreeStatus,
  ZeroSession,
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

/** List installed system font families (sorted, deduped) for the appearance
 *  font pickers. Falls back to a curated list on the backend if enumeration
 *  fails, so the result is never empty. */
export function listSystemFonts(): Promise<string[]> {
  return invoke<string[]>("list_system_fonts");
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

/** Read usage stats (quota windows / credit / local token tally) for the given
 *  providers — only the ones the user activated. Each provider carries its own
 *  status, so a slow/broken one never sinks the rest. */
export function usageRead(providers: UsageProvider[]): Promise<ProviderUsage[]> {
  return invoke<ProviderUsage[]>("usage_read", { providers });
}

/** The subset of `providers` whose CLI / config is present on this machine, so
 *  the Providers catalog can enable only the available ones. */
export function usageDetect(providers: UsageProvider[]): Promise<UsageProvider[]> {
  return invoke<UsageProvider[]>("usage_detect", { providers });
}

/** Redeem one Codex rate-limit reset ("reinicio"). Returns the outcome code
 *  (`reset` / `nothing_to_reset` / `no_credit` / `already_redeemed`). */
export function usageCodexRedeemReset(): Promise<string> {
  return invoke<string>("usage_codex_redeem_reset");
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
export function getClaudeHooksStatus(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("get_claude_hooks_status");
}

/** Add (or replace) the ADE-managed `hooks` block in `~/.claude/settings.json`,
 *  pointing at the installed script. Preserves every other top-level key.
 *  Returns the new status so the UI can refresh without a second round-trip. */
export function installClaudeHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("install_claude_hooks");
}

/** Remove the ADE-managed `hooks` block from `~/.claude/settings.json`.
 *  Idempotent; no-op if it's not ours. */
export function uninstallClaudeHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("uninstall_claude_hooks");
}

/** Status of the managed Codex `hooks.json` (+ `config.toml` trust entry). */
export function getCodexHooksStatus(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("get_codex_hooks_status");
}

/** Install the ADE-managed Codex hooks and trust the file in `config.toml`. */
export function installCodexHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("install_codex_hooks");
}

export function uninstallCodexHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("uninstall_codex_hooks");
}

/** Status of the managed Gemini CLI `settings.json` hooks block. */
export function getGeminiHooksStatus(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("get_gemini_hooks_status");
}

export function installGeminiHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("install_gemini_hooks");
}

export function uninstallGeminiHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("uninstall_gemini_hooks");
}

/** Status of the managed Pi/OMP status extension. */
export function getPiHooksStatus(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("get_pi_hooks_status");
}

export function installPiHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("install_pi_hooks");
}

export function uninstallPiHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("uninstall_pi_hooks");
}

/** Status of the managed OpenCode status plugin. */
export function getOpencodeHooksStatus(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("get_opencode_hooks_status");
}

export function installOpencodeHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("install_opencode_hooks");
}

export function uninstallOpencodeHooks(): Promise<AgentHooksStatus> {
  return invoke<AgentHooksStatus>("uninstall_opencode_hooks");
}

/** (Re)install the managed hooks for every supported agent at once. */
export function installAllHooks(): Promise<void> {
  return invoke("install_all_hooks");
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

/** Update a project's display metadata (card `name` and/or `icon`) without
 *  touching the folder on disk. Only the fields present in `changes` are applied
 *  (an omitted field is left unchanged); pass an empty string to reset (`name`
 *  → the folder name, `icon` → the default glyph). */
export function repoUpdate(
  id: string,
  changes: { name?: string; icon?: string | null },
): Promise<RepoData> {
  return invoke<RepoData>("repo_update", {
    id,
    // Tauri omits `undefined` args → the backend sees `None` (leave unchanged);
    // an empty string means "reset". `null` icon (clear) is normalized to "".
    name: changes.name,
    icon: "icon" in changes ? (changes.icon ?? "") : undefined,
  });
}

/** Set (or clear with null) a per-branch custom icon for a project. */
export function repoSetBranchIcon(
  repoId: string,
  branch: string,
  icon: string | null,
): Promise<RepoData> {
  return invoke<RepoData>("repo_set_branch_icon", { id: repoId, branch, icon });
}

/** Reorder the registered projects to the user's manual arrangement. `orderedIds`
 *  is the desired front-to-back order; any repo omitted keeps its position after
 *  the listed ones, so a stale list never drops a project. Persists the order. */
export function repoReorder(orderedIds: string[]): Promise<void> {
  return invoke("repo_reorder", { orderedIds });
}

/** Set a project's manual worktree order (child worktree paths, front-to-back).
 *  The primary worktree is always shown first regardless. Returns the updated
 *  repo so the caller can reconcile `app.repos`. */
export function setWorktreeOrder(
  repoId: string,
  paths: string[],
): Promise<RepoData> {
  return invoke<RepoData>("repo_set_worktree_order", { id: repoId, paths });
}

/** Resolve a git project's `origin` remote to its hosting owner/avatar, for the
 *  "use the account avatar" icon option. Null when there's no parseable origin. */
export function repoRemoteOwner(repoId: string): Promise<RemoteOwner | null> {
  return invoke<RemoteOwner | null>("repo_remote_owner", { id: repoId });
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
 *  uncommitted changes (surface the error and offer a forced retry). Resolves to
 *  the branch-cleanup outcome (deleted / squash-merged / preserved). */
export function worktreeRemove(
  repoId: string,
  path: string,
  branch: string | null,
  force: boolean,
): Promise<RemoveOutcome> {
  return invoke<RemoveOutcome>("worktree_remove", {
    repoId,
    path,
    branch: branch ?? null,
    force,
  });
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

/** Read a local image file as an inline `data:<mime>;base64,…` URL for the
 *  editor's image preview. Rejects non-images and anything over the size cap. */
export function fsReadDataUrl(path: string): Promise<string> {
  return invoke<string>("fs_read_data_url", { path });
}

/** Overwrite a file with the editor's content (atomic on the backend). */
export function fsWriteFile(path: string, content: string): Promise<void> {
  return invoke("fs_write_file", { path, content });
}

/** Rename a file on disk to a new bare file name, keeping it in the same folder.
 *  Returns the new absolute, forward-slash path. Rejects path separators,
 *  traversal, and clobbering an existing sibling. */
export function fsRename(path: string, newName: string): Promise<string> {
  return invoke<string>("fs_rename", { path, newName });
}

/** Create a new empty file `name` inside directory `dir` (file tree "New File").
 *  `name` must be a bare name that doesn't already exist. Returns the new
 *  absolute, forward-slash path. */
export function fsCreateFile(dir: string, name: string): Promise<string> {
  return invoke<string>("fs_create_file", { dir, name });
}

/** Create a new empty directory `name` inside `dir` (file tree "New Folder").
 *  Same bare-name / no-clobber guards as {@link fsCreateFile}. */
export function fsCreateDir(dir: string, name: string): Promise<string> {
  return invoke<string>("fs_create_dir", { dir, name });
}

/** Move a file or directory to the OS trash (file tree "Delete") — recoverable,
 *  not a permanent unlink. Refuses a filesystem root. */
export function fsDelete(path: string): Promise<void> {
  return invoke("fs_delete", { path });
}

/** Duplicate a single file next to itself under a unique "… copy" name (file tree
 *  "Duplicate"). Directories are refused. Returns the new absolute path. */
export function fsDuplicate(path: string): Promise<string> {
  return invoke<string>("fs_duplicate", { path });
}

/** Project-wide filename search for the Files tab: recursively find files under
 *  `root` whose relative path matches every whitespace token of `query`. Honors
 *  `.gitignore` and skips `.git`; `includeHidden` surfaces dotfiles; `limit` caps
 *  the results (`truncated` flags an over-cap walk). */
export function fsSearchFiles(
  root: string,
  query: string,
  includeHidden: boolean,
  limit: number,
): Promise<FileSearch> {
  return invoke<FileSearch>("fs_search_files", { root, query, includeHidden, limit });
}

/** The current conversation (title + coarse status) of the Zero agent running in
 *  `cwd` (a worktree path), read from Zero's on-disk session metadata. `null` when
 *  no matching session exists. Powers the Zero row in the left-panel agent view. */
export function zeroSession(cwd: string): Promise<ZeroSession | null> {
  return invoke<ZeroSession | null>("zero_session", { cwd });
}

/** Download an image from an http(s) URL into an inline `data:` URL (fetched in
 *  the backend to sidestep CORS). Used for "icon from URL" and git-host avatars. */
export function imageFetchDataUrl(url: string): Promise<string> {
  return invoke<string>("image_fetch_data_url", { url });
}

/** Reveal a path in the OS file manager (Explorer / Finder / etc.). */
export function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

// --- Integrated browser ----------------------------------------------------
// The browser is a docked, frameless `WebviewWindow` (a real system webview, so it
// loads any site + has DevTools), positioned by the frontend over uxnan's browser
// panel. `openUrl` is the single decision point: in-app window / OS browser / ask.
// Window geometry is in CSS (logical) px relative to the main window content area.

/** Route a URL per the user's browser settings (in-app window / OS browser / ask). */
export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

/** Open a URL in the OS default browser unconditionally (ignores the policy). */
export function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}

/** Open (or reuse + navigate) the docked browser window at `url`, glued to the
 *  panel rect (CSS px relative to the main window content area). */
export function browserWindowOpen(
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  return invoke("browser_window_open", { url, x, y, width, height });
}

/** Reposition / resize the browser window to track the panel rect. */
export function browserWindowSetBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  return invoke("browser_window_set_bounds", { x, y, width, height });
}

/** Navigate the browser window to a new URL. */
export function browserWindowNavigate(url: string): Promise<void> {
  return invoke("browser_window_navigate", { url });
}

/** Reload the current page. */
export function browserWindowReload(): Promise<void> {
  return invoke("browser_window_reload");
}

/** Go back in the page's history. */
export function browserWindowBack(): Promise<void> {
  return invoke("browser_window_back");
}

/** Go forward in the page's history. */
export function browserWindowForward(): Promise<void> {
  return invoke("browser_window_forward");
}

/** Show the browser window (its panel became visible again). */
export function browserWindowShow(): Promise<void> {
  return invoke("browser_window_show");
}

/** Hide the browser window without destroying it. */
export function browserWindowHide(): Promise<void> {
  return invoke("browser_window_hide");
}

/** Destroy the browser window (the panel closed). */
export function browserWindowClose(): Promise<void> {
  return invoke("browser_window_close");
}

/** Open the browser window's DevTools. */
export function browserWindowDevtools(): Promise<void> {
  return invoke("browser_window_devtools");
}

/** Browser-control MCP coordinates + supported-agent catalog for Settings →
 *  Browser (the live `/mcp` endpoint + token for the copy-paste snippet). */
export function mcpInfo(): Promise<McpInfo> {
  return invoke("mcp_info");
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

/** Before/after image versions for a changed image file (base64), for the visual
 *  diff viewer. `staged` mirrors `gitDiff`. */
export function gitImageDiff(
  path: string,
  file: string,
  staged: boolean,
): Promise<ImageDiff> {
  return invoke<ImageDiff>("git_image_diff", { path, file, staged });
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

/** Draft a commit message for the worktree's staged changes using the configured
 *  AI agent (Settings → AI commit). Rejects when disabled/unconfigured, nothing
 *  is staged, or the agent fails/times out. */
export function generateCommitMessage(path: string): Promise<string> {
  return invoke<string>("git_generate_commit_message", { path });
}

/** Which of the supported AI-commit agents (claude/codex/gemini/opencode/pi) are
 *  installed in a runnable shape, so the picker offers only those. */
export function aiCommitAgents(): Promise<string[]> {
  return invoke<string[]>("ai_commit_agents");
}

/** The models offered by `agentId` for AI commit messages (static for
 *  Claude/Gemini, a live CLI query for OpenCode/Pi/Codex). */
export function aiCommitModels(agentId: string): Promise<AgentModel[]> {
  return invoke<AgentModel[]>("ai_commit_models", { agentId });
}

// --- Auto-updater (Settings → Updates) -------------------------------------

/** The full human-facing app version for display (e.g. `0.0.5-alpha.20260628`).
 *  Unlike `@tauri-apps/api/app`'s `getVersion()` (the numeric MSI-safe base CI
 *  bundles, e.g. `0.0.5`), this is the full release name CI injects at build
 *  time; falls back to the crate version for local/dev builds. */
export function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** Check the configured release channel for a newer version. Resolves to `null`
 *  when the app is up to date. Downloads nothing. */
export function updaterCheck(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("updater_check");
}

/** Download the available update in the background, staging it for install.
 *  Emits `updater:download-progress` while running and `updater:downloaded` on
 *  success; resolves to the downloaded version's info. */
export function updaterDownload(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("updater_download");
}

/** The staged (downloaded-but-not-installed) update version, or `null`. */
export function updaterStaged(): Promise<string | null> {
  return invoke<string | null>("updater_staged");
}

/** Apply the staged update and restart into the new version. **Stops every
 *  running agent** (the app restarts) — call only when it's safe to do so. */
export function updaterInstall(): Promise<void> {
  return invoke("updater_install");
}
