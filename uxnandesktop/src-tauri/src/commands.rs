//! Tauri commands — the request/response surface exposed to the Svelte frontend.
//!
//! Phase 0 ships the minimal set needed to validate the round-trip and persist
//! UI settings. Repo/worktree/PTY/git commands arrive in later phases (see
//! `FOR-DEV.md` and the full planned list in
//! `architecture/03-implementation-guide.md` §2.1).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::error::{AppError, CommandError};
use crate::git::{self, WorktreeEntry};
use crate::model::{AppData, AppSettings, RepoData};
use crate::state::AppState;

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
pub async fn pty_create(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
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

    state
        .pty
        .create(
            crate::pty::PtySpec {
                id,
                cwd,
                shell,
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
