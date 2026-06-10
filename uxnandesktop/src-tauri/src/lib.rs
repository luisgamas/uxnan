//! Uxnan Desktop (ADE) — Tauri backend entry point.
//!
//! Wires the shared [`AppState`] (loaded from disk at startup) and registers the
//! Phase 0 command surface. The three-actor architecture (Rust core ⇄ Svelte
//! webview ⇄ PTY processes) is documented in
//! `architecture/02a-system-architecture.md`.

mod commands;
mod error;
mod model;
mod persistence;
mod pty;
mod state;

use tauri::Manager;

use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Resolve the OS-specific app data directory and load (or default)
            // the persisted state, then publish it as managed state.
            let data_dir = app.path().app_data_dir()?;
            let persistence = PersistenceManager::new(&data_dir);
            let data = persistence.load().unwrap_or_else(|err| {
                eprintln!("[uxnan-desktop] failed to load persisted state ({err}); starting fresh");
                AppData::default()
            });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
