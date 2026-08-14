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
use crate::fswatch::{BrowseWatcher, FsWatcher};
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
    /// Absolute path of the "endpoint file" the server (re)writes on start with
    /// the live url + token (`endpoint.env` on POSIX / `endpoint.cmd` on
    /// Windows). Injected into every terminal as `UXNAN_ENDPOINT_FILE` so a
    /// long-lived hook script re-reads fresh coordinates after an app restart
    /// instead of POSTing to a dead port. `None` if it couldn't be written.
    #[serde(default)]
    pub endpoint_file: Option<String>,
}

/// Process-wide state shared across all Tauri commands.
pub struct AppState {
    /// Authoritative in-memory copy of the persisted document.
    pub data: RwLock<AppData>,
    /// Atomic disk persistence for `data`.
    pub persistence: PersistenceManager,
    /// Live pseudoterminal sessions.
    pub pty: PtyManager,
    /// Terminals running on a remote host. Separate from `pty` because they are
    /// a different mechanism, but keyed in the same id space: a terminal id
    /// means one thing app-wide, and the command layer asks who owns it rather
    /// than making the frontend remember.
    pub ssh_pty: crate::ssh::pty::RemotePtyManager,
    /// Live, authenticated sessions, keyed by host id.
    ///
    /// One connection per host, shared by everything that runs on it — the
    /// terminal, the inventory probe, git calls. That is the whole reason the
    /// SSH client is in-process: each of those is a channel here, not another
    /// handshake and another login.
    pub ssh_sessions: Arc<RwLock<std::collections::HashMap<String, crate::ssh::conn::Connection>>>,
    /// One file session per connected host, opened on first use. It is a channel
    /// on the connection that host already has, so keeping it costs nothing while
    /// re-opening one per listing would cost a round trip each time. Dropped with
    /// the session — and replaced, without being asked, whenever the host ends
    /// the channel under it (`commands::with_sftp`).
    pub ssh_sftp: Arc<
        tokio::sync::Mutex<
            std::collections::HashMap<String, std::sync::Arc<crate::ssh::sftp::RemoteFiles>>,
        >,
    >,
    /// Which shell each connected host's `sshd` starts, learned once per
    /// connection (`ssh::shellkind`). Everything shell-shaped uxnan sends is
    /// chosen from this rather than assumed — a host's owner switches between
    /// cmd, PowerShell, WSL and Git Bash as they please, and guessing wrong
    /// killed every project terminal on a PowerShell machine. Dropped with the
    /// session, because a reconnect may find a different configuration.
    pub ssh_shells:
        Arc<RwLock<std::collections::HashMap<String, crate::ssh::shellkind::ShellKind>>>,
    /// Host keys seen during a probe, kept between "we asked" and "the user
    /// said yes", keyed by host id.
    ///
    /// The key never travels to the frontend and back. The UI is shown a
    /// fingerprint and returns a decision, not a blob it could have altered —
    /// what gets written to `known_hosts` is exactly what the server presented.
    pub ssh_pending_keys:
        Arc<RwLock<std::collections::HashMap<String, crate::ssh::hostkey::PresentedKey>>>,
    /// Worktree path the right panel is reviewing, polled for status while set
    /// (the background git watcher reads this). `None` = nothing to watch.
    pub git_watch: Arc<RwLock<Option<String>>>,
    /// Filesystem watcher for the active worktree's file tree + open editor.
    /// Emits `fs:changed` (debounced) so the UI reflects created/deleted/edited
    /// files without a manual refresh.
    pub fs_watcher: FsWatcher,
    /// Filesystem watcher for the in-app directory browser (the "Add project" and
    /// "new-worktree location" pickers). Non-recursive, single-directory; emits
    /// `browse:changed` so a folder created/removed in the browsed directory
    /// appears without a manual refresh.
    pub browse_watcher: BrowseWatcher,
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
    /// Dedup keys for the per-launch MCP preparation (`mcpinject.rs`) — today the
    /// Codex per-folder trust seed, keyed `codextrust:<cwd>` so it is seeded at
    /// most once per working directory per session.
    pub mcp_prepared: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    /// Local resource observability: the PTY-link registry, the adaptive
    /// sampler's leases and the aggregated circular buffer (`resources.rs`).
    /// Parked (no timer, no OS handle) unless a consumer subscribes.
    pub resources: Arc<crate::resources::ResourceMonitor>,
}

impl AppState {
    pub fn new(persistence: PersistenceManager, data: AppData) -> Self {
        let resources = crate::resources::ResourceMonitor::new((&data.settings.resources).into());
        Self {
            data: RwLock::new(data),
            persistence,
            pty: PtyManager::default(),
            ssh_pty: crate::ssh::pty::RemotePtyManager::default(),
            ssh_sessions: Arc::new(RwLock::new(std::collections::HashMap::new())),
            ssh_shells: Arc::new(RwLock::new(std::collections::HashMap::new())),
            ssh_sftp: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            ssh_pending_keys: Arc::new(RwLock::new(std::collections::HashMap::new())),
            git_watch: Arc::new(RwLock::new(None)),
            fs_watcher: FsWatcher::default(),
            browse_watcher: BrowseWatcher::default(),
            focused: Arc::new(AtomicBool::new(true)),
            agent_commands: Arc::new(RwLock::new(Vec::new())),
            hook: Arc::new(RwLock::new(None)),
            hook_install: Arc::new(RwLock::new(None)),
            power: SleepBlocker::new(),
            staged_update: Arc::new(RwLock::new(None)),
            browser_url: Arc::new(std::sync::Mutex::new(None)),
            mcp_prepared: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
            resources,
        }
    }
}
