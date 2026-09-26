//! The desktop as a client of the Uxnan bridge (architecture/02a
//! §5.8.15, desktop `02e` §3.4 option B).
//!
//! The bridge owns every linked conversation — its agent processes, queue,
//! approvals and history — and the desktop is one more client of it next to
//! the phone: it calls the bridge's JSON-RPC router and receives the same
//! `stream/*` notifications, over a loopback WebSocket authorized by a token
//! only this user can read. Nothing here runs an agent.
//!
//! Three modes (Settings → Bridge):
//! - `off` (default): no socket, no file read, no timer, no process — the
//!   desktop is exactly the standalone ADE.
//! - `attach`: connect to a bridge the user already runs (service, terminal).
//! - `managed`: the same, but make sure the bridge runs as the user's service
//!   (installed and started through its own CLI, `service.rs`) when none is
//!   running. The service outlives the app — it keeps serving the phone while
//!   the desktop is closed — so the app never stops it.
//!
//! The single-instance lock of the bridge stays the authority: `managed` never
//! checks-then-writes anything of the bridge's; it only runs the bridge's own
//! commands and reads the discovery file the bridge itself writes.
//!
//! The token never leaves this module: the frontend gets status, results and
//! notifications, never the discovery record.

pub mod commands;
pub mod connection;
pub mod discovery;
pub mod install;
pub mod lock;
pub mod service;
#[cfg(test)]
mod socket_tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch, Mutex, Notify, RwLock};

use connection::{CallError, ConnectError, Connection, Event, Resume};
use discovery::DiscoveryError;

/// What every desktop client id starts with (`DESKTOP_LOCAL_CLIENT` in
/// `shared/src/local-control/local-control.ts`).
const CLIENT_ID_PREFIX: &str = "desktop";

/// The name this app registers under on the bridge: `desktop-<profile>`, one
/// per profile directory. The channel keeps one live connection per name, so
/// the installed app and a development build (or a disposable
/// `UXNAN_DATA_DIR`) running at once must never share one — sharing it, each
/// superseded the other in an endless reconnect loop, the windows flickered,
/// and the outbound log, the presence and the tools the bridge's agents get
/// flipped between the two apps (architecture/02a §5.8.15). Derived from the
/// directory, so a profile keeps its name across restarts and resumes its own
/// log; hashed, so it fits the channel's `[a-z0-9-]{1,32}` whatever the path.
pub fn client_id_for(data_dir: &std::path::Path) -> String {
    use sha2::Digest as _;
    let digest = sha2::Sha256::digest(data_dir.to_string_lossy().as_bytes());
    format!("{CLIENT_ID_PREFIX}-{}", &hex::encode(digest)[..12])
}

/// Frontend event carrying a bridge JSON-RPC notification verbatim.
pub const NOTIFICATION_EVENT: &str = "bridge:notification";
/// Frontend event carrying the new [`Status`] whenever it changes.
pub const STATUS_EVENT: &str = "bridge:status";

/// Longest wait between reconnect attempts while the bridge is unreachable.
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// How long a freshly started service gets to publish its file.
const MANAGED_START_TIMEOUT: Duration = Duration::from_secs(20);

/// How the desktop relates to the bridge (Settings → Bridge).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Off,
    Attach,
    Managed,
}

/// Why the bridge is not reachable right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unavailable {
    /// No bridge serves the local channel (not running, or started with
    /// `localControlEnabled: false`).
    NotRunning,
    /// `managed` could not find `uxnan-bridge` on `PATH`.
    NotInstalled,
    /// `managed` could not install or start the bridge's service.
    ServiceFailed,
    /// A bridge answered but refused this app (token mismatch — another
    /// user's bridge, or a stale file).
    Rejected,
    /// A bridge is running but predates the local channel: it must be
    /// updated (and restarted) before the desktop can talk to it.
    Outdated,
    /// A bridge that knows the local channel is running without it: either an
    /// older process still runs after an update (restart it), or it was
    /// started with `localControlEnabled: false`.
    ChannelOff,
    /// Anything else (unreadable file, failed start, bad handshake).
    Failed,
}

/// Connection state shown in Settings and the status bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Status {
    Off,
    Connecting,
    Connected {
        bridge_version: String,
        instance_id: String,
        /// Uxnan keeps the bridge running as the user's service (`managed`).
        managed: bool,
    },
    Unavailable {
        reason: Unavailable,
        /// Human-safe detail (never the token, never a frame).
        detail: Option<String>,
    },
}

/// How an install/update ended, and whether the bridge was restarted on the
/// new version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    #[serde(flatten)]
    pub outcome: install::InstallOutcome,
    /// The bridge's service was restarted on the new version (`managed`).
    pub restarted: bool,
}

/// Why a call could not be made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeCallError {
    /// There is no live connection (mode off, or the bridge is unreachable).
    NotConnected,
    /// The method name is not a bridge method name.
    InvalidMethod,
    Call(CallError),
}

impl std::fmt::Display for BridgeCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BridgeCallError::NotConnected => write!(f, "not connected to the bridge"),
            BridgeCallError::InvalidMethod => write!(f, "not a bridge method"),
            BridgeCallError::Call(err) => write!(f, "{err}"),
        }
    }
}

/// The long-lived client, held in `AppState`.
pub struct BridgeClient {
    /// This profile's name on the bridge ([`client_id_for`]).
    client_id: String,
    mode: watch::Sender<Mode>,
    status: RwLock<Status>,
    connection: RwLock<Option<Arc<Connection>>>,
    /// Kicks the supervisor out of a backoff sleep ("Retry" in Settings).
    retry: Notify,
    /// A service start is in flight (one at a time).
    starting: Mutex<()>,
    /// An install/update is running (one at a time).
    installing: AtomicBool,
    /// This app's tools for the agents the bridge runs (`desktop/attach`),
    /// known once the control server is up.
    desktop_tools: std::sync::Mutex<Option<DesktopTools>>,
    /// Settings → Browser → "give agents Uxnan's tools" (`mcp_enabled`): the
    /// same switch that registers the server for the agents launched in a
    /// terminal decides whether the bridge's agents get it.
    tools_enabled: AtomicBool,
}

/// The desktop's MCP endpoint and the token for bridge-run agents. The token
/// never reaches a log: `Debug` redacts it.
#[derive(Clone, PartialEq, Eq)]
pub struct DesktopTools {
    pub mcp_url: String,
    pub token: String,
}

impl std::fmt::Debug for DesktopTools {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DesktopTools")
            .field("mcp_url", &self.mcp_url)
            .field("token", &"<redacted>")
            .finish()
    }
}

impl BridgeClient {
    pub fn new(mode: Mode, client_id: String) -> Arc<Self> {
        let (tx, _rx) = watch::channel(mode);
        Arc::new(Self {
            client_id,
            mode: tx,
            status: RwLock::new(Status::Off),
            connection: RwLock::new(None),
            retry: Notify::new(),
            starting: Mutex::new(()),
            installing: AtomicBool::new(false),
            desktop_tools: std::sync::Mutex::new(None),
            tools_enabled: AtomicBool::new(true),
        })
    }

    /// The control server is up: remember its MCP endpoint and the token the
    /// bridge's agents will present, and hand them to a connected bridge.
    pub async fn set_desktop_tools(&self, tools: DesktopTools) {
        *self.desktop_tools.lock().unwrap_or_else(|e| e.into_inner()) = Some(tools);
        self.sync_desktop_tools().await;
    }

    /// Settings changed whether agents get Uxnan's tools. No-op when unchanged.
    pub async fn set_tools_enabled(&self, enabled: bool) {
        if self.tools_enabled.swap(enabled, Ordering::SeqCst) != enabled {
            self.sync_desktop_tools().await;
        }
    }

    /// What the bridge should hold now: the tools when they are known and
    /// enabled, else nothing.
    fn wanted_tools(&self) -> Option<DesktopTools> {
        if !self.tools_enabled.load(Ordering::SeqCst) {
            return None;
        }
        self.desktop_tools
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Tell a connected bridge what it should hold (`desktop/attach` or
    /// `desktop/detach`). A bridge too old for these methods answers "method
    /// not found": its agents simply run without the tools. Never fatal.
    async fn sync_desktop_tools(&self) {
        if self.connection.read().await.is_none() {
            return;
        }
        let result = match self.wanted_tools() {
            Some(tools) => {
                self.call(
                    "desktop/attach",
                    serde_json::json!({ "mcpUrl": tools.mcp_url, "token": tools.token }),
                    Duration::from_secs(10),
                )
                .await
            }
            None => {
                self.call("desktop/detach", Value::Null, Duration::from_secs(10))
                    .await
            }
        };
        if let Err(err) = result {
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "bridge",
                &format!("the bridge did not take this app's tools for its agents: {err}"),
            );
        }
    }

    /// Switches mode; the supervisor reacts at once. No-op when unchanged.
    pub fn set_mode(&self, mode: Mode) {
        self.mode.send_if_modified(|current| {
            if *current == mode {
                false
            } else {
                *current = mode;
                true
            }
        });
    }

    pub fn mode(&self) -> Mode {
        *self.mode.borrow()
    }

    pub async fn status(&self) -> Status {
        self.status.read().await.clone()
    }

    /// Wakes a supervisor waiting out a backoff so it tries again now.
    pub fn retry_now(&self) {
        self.retry.notify_one();
    }

    /// Calls a bridge JSON-RPC method.
    pub async fn call(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, BridgeCallError> {
        if !is_method_name(method) {
            return Err(BridgeCallError::InvalidMethod);
        }
        let connection = self
            .connection
            .read()
            .await
            .clone()
            .ok_or(BridgeCallError::NotConnected)?;
        connection
            .call(method, params, timeout)
            .await
            .map_err(BridgeCallError::Call)
    }

    /// Installs or updates the bridge (`npm install -g uxnan-bridge@latest`).
    /// In `managed` mode a successful update re-installs the service (so it
    /// points at the new version's node and entry) and restarts it; in
    /// `attach` a running bridge is left to the user, and the result says a
    /// restart is needed.
    pub async fn install_or_update(&self, app: &AppHandle) -> InstallResult {
        if self.installing.swap(true, Ordering::SeqCst) {
            return InstallResult {
                outcome: install::InstallOutcome {
                    ok: false,
                    version: None,
                    permission_denied: false,
                    tail: vec!["an install is already running".into()],
                },
                restarted: false,
            };
        }
        let outcome = install::install(app).await;
        let mut restarted = false;
        if outcome.ok && self.mode() == Mode::Managed {
            restarted = self.restart_with(true).await.is_ok();
        } else if outcome.ok {
            // Not running yet: nudge the supervisor so it tries now.
            self.retry_now();
        }
        self.installing.store(false, Ordering::SeqCst);
        InstallResult { outcome, restarted }
    }

    /// Restarts the bridge on the version installed now: stops whichever
    /// bridge holds the lock through the bridge's own `stop`, then — unless
    /// the mode is `off` — brings the service up again.
    pub async fn restart(&self) -> Result<(), String> {
        self.restart_with(false).await
    }

    async fn restart_with(&self, reinstall: bool) -> Result<(), String> {
        let bin = crate::which::resolve("uxnan-bridge")
            .ok_or_else(|| "uxnan-bridge is not on PATH".to_string())?;
        if let Some(path) = lock::default_path() {
            if lock::running(&path).is_some() {
                service::stop(&bin).await;
            }
            // Bounded wait for the old process to release the lock.
            for _ in 0..40 {
                if lock::running(&path).is_none() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if lock::running(&path).is_some() {
                return Err("the running bridge did not stop".into());
            }
        }
        if self.mode() != Mode::Off {
            self.ensure_service(reinstall)
                .await
                .map_err(|(_, why)| why)?;
        }
        self.retry_now();
        Ok(())
    }

    /// Make sure the bridge runs as the user's service (`managed`).
    async fn ensure_service(&self, reinstall: bool) -> Result<(), (Unavailable, String)> {
        let _one = self.starting.lock().await;
        let bin = crate::which::resolve("uxnan-bridge").ok_or((
            Unavailable::NotInstalled,
            "uxnan-bridge is not on PATH".to_string(),
        ))?;
        service::ensure_running(&bin, reinstall)
            .await
            .map_err(|err| match err {
                service::ServiceError::Outdated => (
                    Unavailable::Outdated,
                    "the installed bridge predates running as a service".to_string(),
                ),
                service::ServiceError::Failed(why) => (Unavailable::ServiceFailed, why),
            })
    }

    async fn set_status(&self, app: &AppHandle, status: Status) {
        let mut current = self.status.write().await;
        if *current == status {
            return;
        }
        *current = status.clone();
        drop(current);
        let _ = app.emit(STATUS_EVENT, status);
    }
}

/// Why a running bridge serves no local channel (see [`Unavailable::Outdated`]
/// and [`Unavailable::ChannelOff`]). A bridge that only just started may still
/// be about to publish it.
async fn no_channel(running: lock::LockInfo) -> (Unavailable, String) {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if lock::just_started(&running, now_ms) {
        return (
            Unavailable::NotRunning,
            "the bridge is still starting".to_string(),
        );
    }
    match install::installed_version().await {
        None => (
            Unavailable::Outdated,
            format!(
                "a bridge is running (pid {}) but predates the desktop channel",
                running.pid
            ),
        ),
        Some(version) => (
            Unavailable::ChannelOff,
            format!(
                "a bridge is running (pid {}) without the desktop channel; {version} is installed",
                running.pid
            ),
        ),
    }
}

/// Whether `method` looks like a bridge method (`area/name`). The bridge's own
/// registry is the real allowlist — an unknown method is refused there — but
/// nothing that is not even shaped like one is sent.
pub fn is_method_name(method: &str) -> bool {
    let Some((area, name)) = method.split_once('/') else {
        return false;
    };
    method.len() <= 64
        && !area.is_empty()
        && !name.is_empty()
        && area.bytes().all(|b| b.is_ascii_lowercase())
        && name.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Starts the supervisor. It costs nothing while the mode is `off`: it only
/// waits for the mode to change.
pub fn spawn(app: AppHandle, client: Arc<BridgeClient>) {
    tauri::async_runtime::spawn(supervise(app, client));
}

async fn supervise(app: AppHandle, client: Arc<BridgeClient>) {
    let mut mode_rx = client.mode.subscribe();
    let mut resume: Option<Resume> = None;
    let mut backoff = Duration::from_millis(500);
    loop {
        let mode = *mode_rx.borrow_and_update();
        if mode == Mode::Off {
            if let Some(connection) = client.connection.write().await.take() {
                connection.close();
            }
            client.set_status(&app, Status::Off).await;
            if mode_rx.changed().await.is_err() {
                return;
            }
            continue;
        }
        client.set_status(&app, Status::Connecting).await;
        match connect_once(&client, mode, resume.as_ref()).await {
            Ok((connection, mut events)) => {
                backoff = Duration::from_millis(500);
                let hello = connection.hello().clone();
                *client.connection.write().await = Some(connection.clone());
                client
                    .set_status(
                        &app,
                        Status::Connected {
                            bridge_version: hello.bridge_version,
                            instance_id: hello.instance_id,
                            managed: mode == Mode::Managed,
                        },
                    )
                    .await;
                // Every (re)connect: a restarted bridge forgot them, and the
                // token is only good for this app's run.
                {
                    let client = client.clone();
                    tauri::async_runtime::spawn(async move { client.sync_desktop_tools().await });
                }
                // Pump notifications until the socket closes or the mode moves.
                loop {
                    tokio::select! {
                        event = events.recv() => match event {
                            Some(Event::Notification { message, .. }) => {
                                let _ = app.emit(NOTIFICATION_EVENT, message);
                            }
                            Some(Event::Closed) | None => break,
                        },
                        changed = mode_rx.changed() => {
                            if changed.is_err() {
                                connection.close();
                                return;
                            }
                            if *mode_rx.borrow() == Mode::Off {
                                connection.close();
                                break;
                            }
                            // attach ↔ managed keeps the live connection.
                        }
                    }
                }
                resume = Some(connection.resume_point());
                client.connection.write().await.take();
                // Reconnect promptly: a restarted bridge or a superseded
                // socket should not leave the chat dark for long.
                continue;
            }
            Err((reason, detail)) => {
                client
                    .set_status(
                        &app,
                        Status::Unavailable {
                            reason,
                            detail: Some(detail),
                        },
                    )
                    .await;
            }
        }

        // Wait out the backoff, unless asked to retry or the mode changes.
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = client.retry.notified() => {}
            changed = mode_rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

type Opened = (Arc<Connection>, mpsc::UnboundedReceiver<Event>);

/// One attempt: read the discovery file (starting the bridge first in
/// `managed` mode when none is running) and open the channel.
async fn connect_once(
    client: &BridgeClient,
    mode: Mode,
    resume: Option<&Resume>,
) -> Result<Opened, (Unavailable, String)> {
    let path =
        discovery::default_path().ok_or((Unavailable::Failed, "no home directory".to_string()))?;
    let mut record = discovery::read(&path);
    if matches!(record, Err(DiscoveryError::Missing)) {
        if let Some(running) = lock::default_path().and_then(|p| lock::running(&p)) {
            // A bridge holds the lock but serves no channel (yet): one that
            // just started is given its grace; any other needs an update or a
            // restart — starting another would only exit on the held lock.
            let (reason, detail) = no_channel(running).await;
            if reason != Unavailable::NotRunning || mode != Mode::Managed {
                return Err((reason, detail));
            }
            record = wait_for_discovery(&path).await?;
        } else if mode == Mode::Managed {
            client.ensure_service(false).await?;
            record = wait_for_discovery(&path).await?;
        }
    }
    let record = match record {
        Ok(record) => record,
        Err(DiscoveryError::Missing) => {
            return Err((
                Unavailable::NotRunning,
                "no bridge is serving the local channel".to_string(),
            ))
        }
        Err(DiscoveryError::Invalid(why)) => return Err((Unavailable::Failed, why)),
    };
    let (tx, rx) = mpsc::unbounded_channel();
    match Connection::open(&record, &client.client_id, resume, tx).await {
        Ok(connection) => Ok((connection, rx)),
        Err(ConnectError::Rejected(status)) => Err((
            Unavailable::Rejected,
            format!("the bridge refused this app (HTTP {status})"),
        )),
        Err(err @ ConnectError::Refused(_)) => Err((Unavailable::NotRunning, err.to_string())),
        Err(err) => Err((Unavailable::Failed, err.to_string())),
    }
}

/// Polls for the file a just-started bridge writes once its listener is up.
/// When the time runs out, a bridge that holds the lock but still serves no
/// channel is reported as such (outdated, or the channel is off); nothing
/// holding it means the service did not come up — its log says why.
async fn wait_for_discovery(
    path: &std::path::Path,
) -> Result<Result<discovery::Discovery, DiscoveryError>, (Unavailable, String)> {
    let deadline = tokio::time::Instant::now() + MANAGED_START_TIMEOUT;
    loop {
        match discovery::read(path) {
            Ok(record) => return Ok(Ok(record)),
            Err(DiscoveryError::Invalid(why)) => return Ok(Err(DiscoveryError::Invalid(why))),
            Err(DiscoveryError::Missing) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(match lock::default_path().and_then(|p| lock::running(&p)) {
                Some(running) => no_channel(running).await,
                None => (
                    Unavailable::ServiceFailed,
                    "the bridge service did not start; see ~/.uxnan/logs".to_string(),
                ),
            });
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_names_are_area_slash_name() {
        assert!(is_method_name("thread/list"));
        assert!(is_method_name("turn/send"));
        assert!(is_method_name("agent/usageStats"));
        assert!(!is_method_name("thread"));
        assert!(!is_method_name("/list"));
        assert!(!is_method_name("thread/"));
        assert!(!is_method_name("Thread/list"));
        assert!(!is_method_name("thread/list/x"));
        assert!(!is_method_name("thread/li st"));
        assert!(!is_method_name(&format!("a/{}", "b".repeat(80))));
    }

    #[test]
    fn modes_and_status_serialize_for_the_frontend() {
        assert_eq!(serde_json::to_value(Mode::Managed).unwrap(), "managed");
        assert_eq!(
            serde_json::from_value::<Mode>(serde_json::json!("attach")).unwrap(),
            Mode::Attach
        );
        let status = Status::Connected {
            bridge_version: "1.0".into(),
            instance_id: "i".into(),
            managed: true,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "state": "connected",
                "bridgeVersion": "1.0",
                "instanceId": "i",
                "managed": true
            })
        );
        assert_eq!(
            serde_json::to_value(Status::Unavailable {
                reason: Unavailable::NotInstalled,
                detail: None
            })
            .unwrap(),
            serde_json::json!({ "state": "unavailable", "reason": "notInstalled", "detail": null })
        );
    }

    #[tokio::test]
    async fn calls_without_a_connection_fail_cleanly() {
        let client = BridgeClient::new(Mode::Off, "desktop-test".to_string());
        assert_eq!(
            client
                .call("thread/list", Value::Null, Duration::from_secs(1))
                .await,
            Err(BridgeCallError::NotConnected)
        );
        assert_eq!(
            client
                .call("not a method", Value::Null, Duration::from_secs(1))
                .await,
            Err(BridgeCallError::InvalidMethod)
        );
    }

    #[test]
    fn each_profile_has_its_own_stable_client_id() {
        let installed = client_id_for(std::path::Path::new(
            "/Users/u/Library/Application Support/dev.luisgamas.uxnandesktop",
        ));
        let dev = client_id_for(std::path::Path::new(
            "/Users/u/Library/Application Support/dev.luisgamas.uxnandesktop-dev",
        ));
        // Two profiles on one bridge never share a name…
        assert_ne!(installed, dev);
        // …a profile keeps its own across restarts…
        assert_eq!(
            installed,
            client_id_for(std::path::Path::new(
                "/Users/u/Library/Application Support/dev.luisgamas.uxnandesktop"
            ))
        );
        // …and it is a name the channel accepts (`[a-z0-9][a-z0-9-]{0,31}`)
        // that the bridge recognizes as a desktop (`desktop-…`).
        for id in [&installed, &dev] {
            assert!(id.starts_with("desktop-"));
            assert!(id.len() <= 32);
            assert!(id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
        }
    }

    #[test]
    fn set_mode_is_observable_and_idempotent() {
        let client = BridgeClient::new(Mode::Off, "desktop-test".to_string());
        let rx = client.mode.subscribe();
        client.set_mode(Mode::Off);
        assert!(!rx.has_changed().unwrap());
        client.set_mode(Mode::Attach);
        assert!(rx.has_changed().unwrap());
        assert_eq!(client.mode(), Mode::Attach);
    }
}
