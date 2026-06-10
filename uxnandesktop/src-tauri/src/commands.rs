//! Tauri commands — the request/response surface exposed to the Svelte frontend.
//!
//! Phase 0 ships the minimal set needed to validate the round-trip and persist
//! UI settings. Repo/worktree/PTY/git commands arrive in later phases (see
//! `FOR-DEV.md` and the full planned list in
//! `architecture/03-implementation-guide.md` §2.1).

use tauri::{AppHandle, Emitter, State};

use crate::error::CommandError;
use crate::model::{AppData, AppSettings};
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
