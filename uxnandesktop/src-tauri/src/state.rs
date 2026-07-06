//! Shared application state injected into every Tauri command.
//!
//! Tauri owns a single [`AppState`] instance (registered via `app.manage`) and
//! hands it to commands as `State<'_, AppState>`. The in-memory [`AppData`] is
//! guarded by an async `RwLock` so reads (status, listing) and writes
//! (mutations) never race, and the [`PersistenceManager`] flushes it to disk.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::RwLock;

use serde::Serialize;

use crate::agent_hooks::HookInstall;
use crate::fswatch::FsWatcher;
use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::power::SleepBlocker;
use crate::pty::PtyManager;

/// Coordinates for the local agent hook server (spec `02d` §1.1). Published once
/// the server is listening, then injected into every terminal as environment so
/// an agent's hook knows where (and with what token) to POST its state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookServerInfo {
    /// Full POST endpoint, e.g. `http://127.0.0.1:51234/hook`.
    pub url: String,
    /// Shared secret required in the `X-Uxnan-Token` header (rejects stray local
    /// processes). Generated fresh each launch.
    pub token: String,
}

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
    /// Filesystem watcher for the active worktree's file tree + open editor.
    /// Emits `fs:changed` (debounced) so the UI reflects created/deleted/edited
    /// files without a manual refresh.
    pub fs_watcher: FsWatcher,
    /// Whether the app window is focused; the watcher pauses polling when not.
    pub focused: Arc<AtomicBool>,
    /// Agent commands to look for in the process-detection poll (the catalog +
    /// the user's configured agents, set by the frontend).
    pub agent_commands: Arc<RwLock<Vec<String>>>,
    /// Hook server coordinates, set once the local server is listening. `None`
    /// until then (e.g. if the port couldn't be bound — terminals still work,
    /// just without precise hook reporting).
    pub hook: Arc<RwLock<Option<HookServerInfo>>>,
    /// Absolute paths of the ready-made per-agent hook scripts the ADE wrote
    /// to `<app-data>/hooks/` at startup (Phase 4 follow-up; `None` if the
    /// install step failed — precise hook reporting still works, only the
    /// one-click install button is unavailable).
    pub hook_install: Arc<RwLock<Option<HookInstall>>>,
    /// Keep-awake controller: blocks system sleep while an agent works (opt-in).
    pub power: SleepBlocker,
    /// A downloaded-but-not-yet-installed update, staged in memory between the
    /// `updater_download` and `updater_install` commands so the background
    /// download and the (agent-stopping) install stay separate steps. `None`
    /// until a download finishes; cleared once installed. See `updater.rs`.
    pub staged_update: Arc<RwLock<Option<crate::updater::StagedUpdate>>>,
    /// Last URL the integrated browser navigated to, tracked so the browser MCP
    /// server's `browser_status` tool can report the live page to an agent
    /// (updated on open/navigate + the window's own navigations — see
    /// `browser.rs`). A plain `std::sync::Mutex` so the sync `on_navigation`
    /// closure can update it without an async context. `None` = never opened.
    pub browser_url: Arc<std::sync::Mutex<Option<String>>>,
    /// Dedup keys for MCP config injection (`mcpinject.rs`), so a workspace's (or
    /// the global) config is written at most once per session (`ws:<cwd>` /
    /// `global`).
    pub mcp_prepared: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    /// MCP config files we wrote, recorded so they're undone on exit (best-effort).
    pub mcp_written: Arc<std::sync::Mutex<Vec<crate::mcpinject::Written>>>,
}

impl AppState {
    pub fn new(persistence: PersistenceManager, data: AppData) -> Self {
        Self {
            data: RwLock::new(data),
            persistence,
            pty: PtyManager::default(),
            git_watch: Arc::new(RwLock::new(None)),
            fs_watcher: FsWatcher::default(),
            focused: Arc::new(AtomicBool::new(true)),
            agent_commands: Arc::new(RwLock::new(Vec::new())),
            hook: Arc::new(RwLock::new(None)),
            hook_install: Arc::new(RwLock::new(None)),
            power: SleepBlocker::new(),
            staged_update: Arc::new(RwLock::new(None)),
            browser_url: Arc::new(std::sync::Mutex::new(None)),
            mcp_prepared: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
            mcp_written: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }
}
