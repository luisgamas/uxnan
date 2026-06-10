//! Shared application state injected into every Tauri command.
//!
//! Tauri owns a single [`AppState`] instance (registered via `app.manage`) and
//! hands it to commands as `State<'_, AppState>`. The in-memory [`AppData`] is
//! guarded by an async `RwLock` so reads (status, listing) and writes
//! (mutations) never race, and the [`PersistenceManager`] flushes it to disk.

use tokio::sync::RwLock;

use crate::model::AppData;
use crate::persistence::PersistenceManager;

/// Process-wide state shared across all Tauri commands.
pub struct AppState {
    /// Authoritative in-memory copy of the persisted document.
    pub data: RwLock<AppData>,
    /// Atomic disk persistence for `data`.
    pub persistence: PersistenceManager,
}

impl AppState {
    pub fn new(persistence: PersistenceManager, data: AppData) -> Self {
        Self {
            data: RwLock::new(data),
            persistence,
        }
    }
}
