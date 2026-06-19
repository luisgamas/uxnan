//! Tauri commands — the request/response surface exposed to the Svelte frontend.
//!
//! Phase 0 ships the minimal set needed to validate the round-trip and persist
//! UI settings. Repo/worktree/PTY/git commands arrive in later phases (see
//! `FOR-DEV.md` and the full planned list in
//! `architecture/03-implementation-guide.md` §2.1).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::agent_hooks::{self, ClaudeHooksStatus, HookInstall};
use crate::error::{AppError, CommandError};
use crate::git::{self, WorktreeEntry};
use crate::model::{AgentStateEntry, AppData, AppSettings, RepoData};
use crate::state::{AppState, HookServerInfo};

/// Return the full persisted application state. The frontend calls this once at
/// boot to hydrate its reactive store; it also doubles as the Phase 0
/// command round-trip validation.
#[tauri::command]
pub async fn get_app_state(state: State<'_, AppState>) -> Result<AppData, CommandError> {
    let data = state.data.read().await;
    Ok(data.clone())
}

/// Persist updated UI/app settings (sidebar widths + open state, theme) and
/// return the new full state so the frontend can stay in sync.
#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppData, CommandError> {
    let mut data = state.data.write().await;
    data.settings = settings;
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(data.clone())
}

/// Lightweight liveness probe. Used by the frontend at startup to confirm the
/// Rust backend is reachable before issuing real commands.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

/// Persist the frontend-owned terminal region/tab layout (opaque JSON). The
/// frontend debounces these writes; restored on next startup via `get_app_state`.
#[tauri::command]
pub async fn set_terminal_layout(
    state: State<'_, AppState>,
    layout: serde_json::Value,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.terminal_layout = Some(layout);
    state.persistence.save(&data).map_err(CommandError::from)
}

// --- Terminals (PTY) -------------------------------------------------------
//
// The frontend chooses `id` (so it can subscribe to `pty:output:{id}` before
// the process produces any output), then calls `pty_create`. Output streams via
// `pty:output:{id}` events; `pty:exit:{id}` fires once the process ends.

/// Spawn a shell in a new pseudoterminal sized `cols`×`rows`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command surface: flat params over the IPC boundary.
pub async fn pty_create(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    let out_app = app.clone();
    let out_id = id.clone();
    let on_output = move |bytes: &[u8]| {
        let _ = out_app.emit(&format!("pty:output:{out_id}"), bytes.to_vec());
    };
    let exit_app = app.clone();
    let exit_id = id.clone();
    let on_exit = move || {
        let _ = exit_app.emit(&format!("pty:exit:{exit_id}"), ());
    };

    // Inject the hook-server coordinates + this terminal's agent id, so an agent
    // run inside the shell can report precise state back to the local server.
    let mut env: Vec<(String, String)> = vec![("UXNAN_AGENT_ID".to_string(), id.clone())];
    if let Some(hook) = state.hook.read().await.clone() {
        env.push(("UXNAN_HOOK_URL".to_string(), hook.url));
        env.push(("UXNAN_HOOK_TOKEN".to_string(), hook.token));
    }

    state
        .pty
        .create(
            crate::pty::PtySpec {
                id,
                cwd,
                shell,
                args: args.unwrap_or_default(),
                env,
                cols,
                rows,
            },
            on_output,
            on_exit,
        )
        .map_err(CommandError::from)
}

/// Send user input to a PTY's stdin.
#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), CommandError> {
    state.pty.write(&id, &data).map_err(CommandError::from)
}

/// Return the subset of `commands` that resolve to an installed executable
/// (PATH + PATHEXT). Used by the Settings agent catalog to enable only the
/// agents actually present on the machine.
#[tauri::command]
pub async fn agents_detect(commands: Vec<String>) -> Result<Vec<String>, CommandError> {
    Ok(commands
        .into_iter()
        .filter(|c| crate::which::is_command_available(c))
        .collect())
}

/// Resize a PTY when its pane changes size.
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    state
        .pty
        .resize(&id, cols, rows)
        .map_err(CommandError::from)
}

/// Kill a PTY's process and drop the session (idempotent).
#[tauri::command]
pub async fn pty_close(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.pty.close(&id).map_err(CommandError::from)
}

// --- Repositories ----------------------------------------------------------

/// Register a git repository (by absolute path) with the ADE. Idempotent: a
/// path already registered returns the existing entry.
#[tauri::command]
pub async fn repo_add(state: State<'_, AppState>, path: String) -> Result<RepoData, CommandError> {
    if !git::is_git_repo(&path).await {
        return Err(CommandError::from(AppError::Invalid(format!(
            "{path} is not a git repository"
        ))));
    }
    let mut data = state.data.write().await;
    if let Some(existing) = data.repos.iter().find(|r| r.path == path) {
        return Ok(existing.clone());
    }
    let repo = RepoData {
        id: Uuid::new_v4().to_string(),
        name: git::repo_name(&path),
        path,
        worktrees: Vec::new(),
    };
    data.repos.push(repo.clone());
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(repo)
}

/// Remove a repository from the ADE (does not touch the repo on disk).
#[tauri::command]
pub async fn repo_remove(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.repos.retain(|r| r.id != id);
    state.persistence.save(&data).map_err(CommandError::from)
}

/// List the registered repositories.
#[tauri::command]
pub async fn repo_list(state: State<'_, AppState>) -> Result<Vec<RepoData>, CommandError> {
    Ok(state.data.read().await.repos.clone())
}

// --- Worktrees -------------------------------------------------------------

/// Resolve a registered repo's absolute path by id (read lock released before
/// any git `await`, so we never hold the lock across a subprocess).
async fn repo_path_of(state: &AppState, repo_id: &str) -> Result<String, CommandError> {
    state
        .data
        .read()
        .await
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .map(|r| r.path.clone())
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))
}

/// A repo's branches plus the resolved default base, for the new-worktree dialog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    /// Local branch names.
    pub branches: Vec<String>,
    /// The base ref the dialog should preselect (remote HEAD → main → master → HEAD).
    pub default_base: String,
}

/// List a repo's local branches and the resolved default base ref. Powers the
/// base-branch picker when creating a worktree.
#[tauri::command]
pub async fn branch_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<BranchList, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let branches = git::list_branches(&repo_path)
        .await
        .map_err(CommandError::from)?;
    let default_base = git::default_base(&repo_path).await;
    Ok(BranchList {
        branches,
        default_base,
    })
}

/// Create a worktree on a new branch in the given repo, at a sibling directory
/// named `<repo>--<branch>`. `base` is the ref to branch from; when omitted the
/// backend resolves the repo's default base (remote HEAD → main → master → HEAD).
/// Returns the created entry.
#[tauri::command]
pub async fn worktree_create(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: Option<String>,
) -> Result<WorktreeEntry, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "branch name is required".to_string(),
        )));
    }
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let base = match base.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()) {
        Some(base) => base,
        None => git::default_base(&repo_path).await,
    };
    let worktree_path = git::worktree_path_for(&repo_path, &branch);
    git::add_worktree(&repo_path, &branch, &worktree_path, Some(&base))
        .await
        .map_err(CommandError::from)?;
    Ok(WorktreeEntry {
        path: worktree_path,
        branch: Some(branch),
        head: None,
        is_main: false,
    })
}

/// Remove a worktree (spec §2.3). With `force = false` the backend refuses when
/// the worktree has uncommitted changes; the frontend surfaces this so the user
/// can confirm a forced removal. A safe branch delete is attempted afterwards.
#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: Option<String>,
    force: bool,
) -> Result<(), CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::remove_worktree(&repo_path, &path, branch.as_deref(), force)
        .await
        .map_err(CommandError::from)
}

/// List a repo's worktrees (ADE-created and ones made externally by agents).
#[tauri::command]
pub async fn worktree_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<WorktreeEntry>, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::list_worktrees(&repo_path)
        .await
        .map_err(CommandError::from)
}

/// Summarize a worktree's working-tree status (changed entries + ahead/behind)
/// for its sidebar card badges. Runs git directly in `path`.
#[tauri::command]
pub async fn worktree_status(path: String) -> Result<git::WorktreeStatus, CommandError> {
    git::worktree_status(&path)
        .await
        .map_err(CommandError::from)
}

/// List a directory's sub-folders (flagging git repos) for the in-app project
/// picker. Defaults to the home directory when `path` is omitted.
#[tauri::command]
pub async fn browse_dirs(path: Option<String>) -> Result<crate::browse::DirListing, CommandError> {
    crate::browse::browse_dirs(path)
        .await
        .map_err(CommandError::from)
}

// --- Filesystem: file tree + editor ----------------------------------------
//
// Back the right-panel file-tree tab (browse the active worktree's working tree)
// and the center file editor (read/write one text file). Paths are absolute, on
// the user's own machine (not confined — mirrors `browse_dirs`).

/// List the immediate children of a directory (sub-dirs first, then files),
/// for the file-tree tab. Lazy: the frontend calls this per folder on expand,
/// so a huge tree (e.g. `node_modules`) never loads until opened.
#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<crate::fs::FsEntry>, CommandError> {
    crate::fs::list_dir(&path).await.map_err(CommandError::from)
}

/// Read a single text file for the editor (with binary / too-large guards).
#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<crate::fs::FileContent, CommandError> {
    crate::fs::read_file(&path)
        .await
        .map_err(CommandError::from)
}

/// Overwrite a file with the editor's content (atomic temp-write + rename).
#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), CommandError> {
    crate::fs::write_file(&path, &content)
        .await
        .map_err(CommandError::from)
}

/// Reveal a path in the OS file manager (Explorer / Finder / the default file
/// manager), selecting the item. Powers the file tree's "open in file manager".
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(std::path::PathBuf::from(path))
        .map_err(|e| CommandError::new("REVEAL_FAILED", e.to_string()))
}

/// Working-tree-vs-`HEAD` diff for one file, powering the editor's change gutter
/// (added lines + a peek at the removed lines). Empty for clean/untracked files.
#[tauri::command]
pub async fn git_diff_head(path: String, file: String) -> Result<String, CommandError> {
    git::diff_head(&path, &file)
        .await
        .map_err(CommandError::from)
}

// --- Git status, diffs & staging (Phase 3) ---------------------------------
//
// These run git directly in the worktree `path` (the right panel's review view).

/// List a worktree's changed files (staged + unstaged + untracked).
#[tauri::command]
pub async fn git_status(path: String) -> Result<Vec<git::FileChange>, CommandError> {
    git::status_files(&path).await.map_err(CommandError::from)
}

/// Per-file added/deleted line counts vs `HEAD` for the changed-files list.
#[tauri::command]
pub async fn git_numstat(path: String) -> Result<Vec<git::FileNumstat>, CommandError> {
    git::numstat(&path).await.map_err(CommandError::from)
}

/// Unified diff for one file. `staged` selects the index-vs-HEAD diff.
#[tauri::command]
pub async fn git_diff(path: String, file: String, staged: bool) -> Result<String, CommandError> {
    git::diff_file(&path, &file, staged)
        .await
        .map_err(CommandError::from)
}

/// Stage one file.
#[tauri::command]
pub async fn git_stage(path: String, file: String) -> Result<(), CommandError> {
    git::stage_file(&path, &file)
        .await
        .map_err(CommandError::from)
}

/// Unstage one file.
#[tauri::command]
pub async fn git_unstage(path: String, file: String) -> Result<(), CommandError> {
    git::unstage_file(&path, &file)
        .await
        .map_err(CommandError::from)
}

/// Stage every change.
#[tauri::command]
pub async fn git_stage_all(path: String) -> Result<(), CommandError> {
    git::stage_all(&path).await.map_err(CommandError::from)
}

/// Unstage everything.
#[tauri::command]
pub async fn git_unstage_all(path: String) -> Result<(), CommandError> {
    git::unstage_all(&path).await.map_err(CommandError::from)
}

/// Discard a file's local changes (tracked → restore to HEAD; untracked → delete).
#[tauri::command]
pub async fn git_discard(path: String, file: String, untracked: bool) -> Result<(), CommandError> {
    git::discard_file(&path, &file, untracked)
        .await
        .map_err(CommandError::from)
}

/// Apply a unified-diff patch (a single hunk, from the frontend) to stage,
/// unstage, or discard it. `cached` targets the index; `reverse` reverses it.
#[tauri::command]
pub async fn git_apply(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<(), CommandError> {
    git::apply_patch(&path, &patch, cached, reverse)
        .await
        .map_err(CommandError::from)
}

/// Commit the staged changes with `message`.
#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<(), CommandError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "commit message is required".to_string(),
        )));
    }
    git::commit(&path, message)
        .await
        .map_err(CommandError::from)
}

/// Payload of the `git:status-changed` event emitted by the background watcher
/// for the worktree the right panel is reviewing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEvent {
    pub path: String,
    pub files: Vec<git::FileChange>,
    pub ahead: u32,
    pub behind: u32,
}

/// Set (or clear with `None`) the worktree the background watcher polls. The
/// frontend calls this when the active worktree changes.
#[tauri::command]
pub async fn git_set_watch(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), CommandError> {
    *state.git_watch.write().await = path;
    Ok(())
}

/// Push the current branch (`git push`). Not retried.
#[tauri::command]
pub async fn git_push(path: String) -> Result<(), CommandError> {
    git::push(&path).await.map_err(CommandError::from)
}

/// Pull fast-forward-only (`git pull --ff-only`).
#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), CommandError> {
    git::pull(&path).await.map_err(CommandError::from)
}

/// Payload of the `agent:detected` event: which agent command (if any) the
/// background process scan found running in a terminal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectedEvent {
    pub pty_id: String,
    pub command: Option<String>,
}

/// Set the agent commands the process-detection poll looks for (the catalog +
/// the user's configured agents). The frontend calls this on startup and when
/// the configured agents change.
#[tauri::command]
pub async fn set_agent_commands(
    state: State<'_, AppState>,
    commands: Vec<String>,
) -> Result<(), CommandError> {
    *state.agent_commands.write().await = commands;
    Ok(())
}

// --- Agent hooks (Phase 4, Layer 1) ----------------------------------------

/// Coordinates of the local agent hook server, for the Settings docs panel so a
/// user can wire their agent to report state. `None` until the server is up (or
/// if its port couldn't be bound).
#[tauri::command]
pub async fn get_hook_info(
    state: State<'_, AppState>,
) -> Result<Option<HookServerInfo>, CommandError> {
    Ok(state.hook.read().await.clone())
}

/// The cached last-known agent states (hook reports). The frontend fetches this
/// at boot to hydrate the sidebar, then keeps it live via `agent:status-changed`.
#[tauri::command]
pub async fn agent_states(
    state: State<'_, AppState>,
) -> Result<Vec<AgentStateEntry>, CommandError> {
    Ok(state.data.read().await.agent_cache.clone())
}

/// Request (or release) keeping the system awake. The frontend calls this with
/// `active = settings.preventSleep && (an agent is working)`; the backend
/// auto-releases after 2 h regardless (see `power.rs`).
#[tauri::command]
pub async fn set_prevent_sleep(
    state: State<'_, AppState>,
    active: bool,
) -> Result<(), CommandError> {
    state.power.set(active);
    Ok(())
}

// --- Ready-made agent hook configs (Phase 4 follow-up) ----------------------

/// The textual content of every bundled hook script (with the Claude template
/// already rendered for the installed script path). The Settings → Agents →
/// Hooks pane uses this to show copy-pasteable snippets without having to
/// shell out to `cat` the files.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookScripts {
    /// The rendered `hooks` block ready to paste into `~/.claude/settings.json`.
    pub claude_json: String,
    pub wrapper_bash: String,
    pub wrapper_powershell: String,
    pub wrapper_cmd: String,
}

/// Paths of the bundled hook scripts the ADE writes to `<app-data>/hooks/`
/// on startup, plus the resolved `~/.claude/settings.json` path. Settings →
/// Agents → Hooks uses this to render copy-pasteable commands and the install
/// buttons. `None` if the install-on-startup step failed (e.g. the app-data
/// directory is not writable) — in that case precise hook reporting still
/// works, just the one-click install is unavailable.
#[tauri::command]
pub async fn get_hook_install(
    state: State<'_, AppState>,
) -> Result<Option<HookInstall>, CommandError> {
    Ok(state.hook_install.read().await.clone())
}

/// The current state of the Claude `settings.json` `hooks` block. Lets the
/// UI render an honest "Installed" / "Not installed" / "Unavailable" badge
/// (we never claim installed unless our `__uxnan_managed_hooks__` marker is
/// actually present).
#[tauri::command]
pub async fn get_claude_hooks_status() -> Result<ClaudeHooksStatus, CommandError> {
    Ok(agent_hooks::read_claude_status())
}

/// Add (or replace) the ADE-managed `hooks` block in
/// `~/.claude/settings.json`, pointing at the installed script. Preserves
/// every other top-level key — existing Claude settings are untouched.
/// Returns the new status so the UI can refresh without a second round-trip.
#[tauri::command]
pub async fn install_claude_hooks(
    state: State<'_, AppState>,
) -> Result<ClaudeHooksStatus, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    let script_path = std::path::PathBuf::from(install.claude_hook_script);
    agent_hooks::install_claude_hooks(&script_path).map_err(CommandError::from)
}

/// Remove the ADE-managed `hooks` block from `~/.claude/settings.json` (no
/// op if it's not ours). Idempotent: safe to call repeatedly.
#[tauri::command]
pub async fn uninstall_claude_hooks() -> Result<ClaudeHooksStatus, CommandError> {
    agent_hooks::uninstall_claude_hooks().map_err(CommandError::from)
}

/// The textual content of every bundled hook script. The Settings UI uses
/// this to show copy-pasteable snippets (rendered Claude `settings.json`,
/// platform wrapper script). The Claude JSON is rendered against the
/// installed script path so the user can copy it as-is.
#[tauri::command]
pub async fn get_hook_scripts(
    state: State<'_, AppState>,
) -> Result<Option<HookScripts>, CommandError> {
    let install = match state.hook_install.read().await.clone() {
        Some(install) => install,
        None => return Ok(None),
    };
    let script_path = std::path::PathBuf::from(install.claude_hook_script);
    let claude_json =
        agent_hooks::render_claude_settings_json(&script_path).map_err(CommandError::from)?;
    Ok(Some(HookScripts {
        claude_json,
        wrapper_bash: agent_hooks::WRAPPER_BASH.to_string(),
        wrapper_powershell: agent_hooks::WRAPPER_POWERSHELL.to_string(),
        wrapper_cmd: agent_hooks::WRAPPER_CMD.to_string(),
    }))
}
