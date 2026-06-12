//! Shared application state injected into every Tauri command.
//!
//! Tauri owns a single [`AppState`] instance (registered via `app.manage`) and
//! hands it to commands as `State<'_, AppState>`. The in-memory [`AppData`] is
//! guarded by an async `RwLock` so reads (status, listing) and writes
//! (mutations) never race, and the [`PersistenceManager`] flushes it to disk.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::pty::PtyManager;

/// Process-wide state shared across all Tauri commands.
pub struct AppState {
    /// Authoritative in-memory copy of the persisted document.
    pub data: RwLock<AppData>,
    /// Atomic disk persistence for `data`.
    pub persistence: PersistenceManager,
    /// Live pseudoterminal sessions.
    pub pty: PtyManager,
    /// Worktree path the right panel is reviewing, polled for status while set
    /// (the background git watcher reads this). `None` = nothing to watch.
    pub git_watch: Arc<RwLock<Option<String>>>,
    /// Whether the app window is focused; the watcher pauses polling when not.
    pub focused: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(persistence: PersistenceManager, data: AppData) -> Self {
        Self {
            data: RwLock::new(data),
            persistence,
            pty: PtyManager::default(),
            git_watch: Arc::new(RwLock::new(None)),
            focused: Arc::new(AtomicBool::new(true)),
        }
    }
}
