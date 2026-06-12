//! Uxnan Desktop (ADE) — Tauri backend entry point.
//!
//! Wires the shared [`AppState`] (loaded from disk at startup) and registers the
//! Phase 0 command surface. The three-actor architecture (Rust core ⇄ Svelte
//! webview ⇄ PTY processes) is documented in
//! `architecture/02a-system-architecture.md`.

mod browse;
mod commands;
mod error;
mod git;
mod model;
mod persistence;
mod pty;
mod state;
mod which;

use tauri::Manager;

use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Resolve the OS-specific app data directory and load (or default)
            // the persisted state, then publish it as managed state.
            let data_dir = app.path().app_data_dir()?;
            let persistence = PersistenceManager::new(&data_dir);
            let mut data = persistence.load().unwrap_or_else(|err| {
                eprintln!("[uxnan-desktop] failed to load persisted state ({err}); starting fresh");
                AppData::default()
            });
            // Seed terminal profiles when missing (state persisted before they
            // existed, or a fresh install where load() returned defaults anyway).
            data.settings.ensure_terminal_profiles();
            app.manage(AppState::new(persistence, data));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::update_settings,
            commands::ping,
            commands::pty_create,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::repo_add,
            commands::repo_remove,
            commands::repo_list,
            commands::branch_list,
            commands::worktree_create,
            commands::worktree_remove,
            commands::worktree_list,
            commands::worktree_status,
            commands::browse_dirs,
            commands::set_terminal_layout,
            commands::agents_detect,
            commands::git_status,
            commands::git_diff,
            commands::git_stage,
            commands::git_unstage,
            commands::git_stage_all,
            commands::git_unstage_all,
            commands::git_discard,
            commands::git_commit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill every live PTY child when the app exits, so no shell/agent
            // is left running in the background.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pty.close_all();
                }
            }
        });
}
