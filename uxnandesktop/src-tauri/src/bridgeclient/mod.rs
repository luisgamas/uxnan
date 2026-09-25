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
//! - `managed`: the same, but start `uxnan-bridge start` when none is running
//!   and stop it again when the app exits. The binary is resolved on `PATH`
//!   like any agent CLI; nothing is installed on the user's behalf.
//!
//! The single-instance lock of the bridge stays the authority: `managed` never
//! checks-then-writes anything of the bridge's; it only starts the command and
//! reads the discovery file the bridge itself writes.
//!
//! The token never leaves this module: the frontend gets status, results and
//! notifications, never the discovery record.

pub mod commands;
pub mod connection;
pub mod discovery;
pub mod install;
pub mod lock;
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

/// The name this app registers under on the bridge (`local:desktop`).
pub const CLIENT_ID: &str = "desktop";

/// Frontend event carrying a bridge JSON-RPC notification verbatim.
pub const NOTIFICATION_EVENT: &str = "bridge:notification";
/// Frontend event carrying the new [`Status`] whenever it changes.
pub const STATUS_EVENT: &str = "bridge:status";

/// Longest wait between reconnect attempts while the bridge is unreachable.
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// How long a freshly started managed bridge gets to publish its file.
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
        /// This app started the bridge (and will stop it on exit).
        managed: bool,
    },
    Unavailable {
        reason: Unavailable,
        /// Human-safe detail (never the token, never a frame).
        detail: Option<String>,
    },
}

/// How an install/update ended, and whether the app restarted its bridge on
/// the new version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    #[serde(flatten)]
    pub outcome: install::InstallOutcome,
    /// The app's own (`managed`) bridge was restarted on the new version.
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
    mode: watch::Sender<Mode>,
    status: RwLock<Status>,
    connection: RwLock<Option<Arc<Connection>>>,
    /// Kicks the supervisor out of a backoff sleep ("Retry" in Settings).
    retry: Notify,
    /// The bridge process this app started in `managed` mode, if any.
    managed_child: Mutex<Option<tokio::process::Child>>,
    /// Mirrors `managed_child.is_some()` for the synchronous exit hook.
    owns_bridge: AtomicBool,
    /// An install/update is running (one at a time).
    installing: AtomicBool,
}

impl BridgeClient {
    pub fn new(mode: Mode) -> Arc<Self> {
        let (tx, _rx) = watch::channel(mode);
        Arc::new(Self {
            mode: tx,
            status: RwLock::new(Status::Off),
            connection: RwLock::new(None),
            retry: Notify::new(),
            managed_child: Mutex::new(None),
            owns_bridge: AtomicBool::new(false),
            installing: AtomicBool::new(false),
        })
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

    /// Synchronous teardown for the app's exit hook: if this app started the
    /// bridge, ask it to stop (`uxnan-bridge stop` signals the lock holder,
    /// which removes its discovery file and releases its lock cleanly).
    pub fn shutdown_blocking(&self) {
        if !self.owns_bridge.swap(false, Ordering::SeqCst) {
            return;
        }
        let Some(bin) = crate::which::resolve("uxnan-bridge") else {
            return;
        };
        let mut cmd = std::process::Command::new(bin);
        cmd.arg("stop")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        if let Ok(mut child) = cmd.spawn() {
            // Bounded: never hold the app's exit hostage to the bridge.
            for _ in 0..50 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
        }
    }

    /// Installs or updates the bridge (`npm install -g uxnan-bridge@latest`).
    /// When this app runs the bridge (`managed`), a successful update restarts
    /// it — the supervisor starts the new version straight away — and so it
    /// does, in `managed` mode, for a bridge that serves the desktop no channel
    /// (it is useless to the app until it runs the new version). Any other
    /// bridge the user runs is left alone; the result says it needs a restart.
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
        let serves_no_channel = matches!(
            self.status().await,
            Status::Unavailable {
                reason: Unavailable::Outdated | Unavailable::ChannelOff,
                ..
            }
        );
        if outcome.ok && self.owns_live_bridge() {
            self.stop_managed_bridge().await;
            self.retry_now();
            restarted = true;
        } else if outcome.ok && self.mode() == Mode::Managed && serves_no_channel {
            // The running bridge is useless to the desktop until it runs the
            // new version, and `managed` is the user asking Uxnan to run it.
            restarted = self.restart().await.is_ok();
        } else if outcome.ok {
            // Not running yet (or the user's own): nudge the supervisor so a
            // `managed` mode that was waiting on "not installed" starts now.
            self.retry_now();
        }
        self.installing.store(false, Ordering::SeqCst);
        InstallResult { outcome, restarted }
    }

    /// Restarts the bridge on the version installed now: stops whichever
    /// bridge holds the lock — this app's, or one the user started — through
    /// the bridge's own `stop` command, then lets the supervisor start a fresh
    /// one. In `attach` mode the new bridge is left running when the app
    /// exits, like one the user started.
    pub async fn restart(&self) -> Result<(), String> {
        self.stop_managed_bridge().await;
        if let Some(path) = lock::default_path() {
            if lock::running(&path).is_some() {
                run_stop_command().await;
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
            self.ensure_managed_bridge().await.map_err(|(_, why)| why)?;
        }
        self.retry_now();
        Ok(())
    }

    /// How this app's bridge process ended, once it has (and forgets it), so a
    /// start that fails is reported at once instead of after a long wait.
    async fn managed_exit(&self) -> Option<String> {
        let mut slot = self.managed_child.lock().await;
        let status = slot.as_mut()?.try_wait().ok()??;
        slot.take();
        self.owns_bridge.store(false, Ordering::SeqCst);
        Some(status.to_string())
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

    /// Starts `uxnan-bridge start` if this app does not already have one alive.
    async fn ensure_managed_bridge(&self) -> Result<(), (Unavailable, String)> {
        let mut slot = self.managed_child.lock().await;
        if let Some(child) = slot.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        let bin = crate::which::resolve("uxnan-bridge").ok_or((
            Unavailable::NotInstalled,
            "uxnan-bridge is not on PATH".to_string(),
        ))?;
        let mut cmd = crate::winproc::command(bin);
        cmd.arg("start")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let child = cmd.spawn().map_err(|err| {
            (
                Unavailable::Failed,
                format!("could not start the bridge: {err}"),
            )
        })?;
        *slot = Some(child);
        self.owns_bridge.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Stops the bridge this app started, if any (mode switched away from
    /// `managed`, or off).
    async fn stop_managed_bridge(&self) {
        let child = self.managed_child.lock().await.take();
        let Some(mut child) = child else {
            return;
        };
        if matches!(child.try_wait(), Ok(Some(_))) {
            self.owns_bridge.store(false, Ordering::SeqCst);
            return;
        }
        // Graceful first, through the bridge's own stop command, so it removes
        // its discovery file and lock; kill only if it will not go.
        if self.owns_bridge.load(Ordering::SeqCst) {
            run_stop_command().await;
        }
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_err()
        {
            let _ = child.start_kill();
        }
        self.owns_bridge.store(false, Ordering::SeqCst);
    }

    fn owns_live_bridge(&self) -> bool {
        self.owns_bridge.load(Ordering::SeqCst)
    }
}

/// `uxnan-bridge stop`: signals the lock holder, which removes its discovery
/// file and releases its lock cleanly. Bounded, and silent when it fails.
async fn run_stop_command() {
    let Some(bin) = crate::which::resolve("uxnan-bridge") else {
        return;
    };
    let mut stop = crate::winproc::command(bin);
    stop.arg("stop")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Ok(mut stopper) = stop.spawn() {
        let _ = tokio::time::timeout(Duration::from_secs(5), stopper.wait()).await;
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
            client.stop_managed_bridge().await;
            client.set_status(&app, Status::Off).await;
            if mode_rx.changed().await.is_err() {
                return;
            }
            continue;
        }
        if mode == Mode::Attach && client.owns_live_bridge() {
            // Switched from managed to attach: keep using that bridge, but it
            // is no longer ours to stop.
            client.managed_child.lock().await.take();
            client.owns_bridge.store(false, Ordering::SeqCst);
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
                            managed: client.owns_live_bridge(),
                        },
                    )
                    .await;
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
        if mode == Mode::Managed && client.owns_live_bridge() {
            // This app's bridge, still starting (or just restarted).
            record = wait_for_discovery(client, &path).await?;
        } else if let Some(running) = lock::default_path().and_then(|p| lock::running(&p)) {
            // A bridge holds the lock but serves no channel: starting another
            // would only exit on the held lock.
            return Err(no_channel(running).await);
        } else if mode == Mode::Managed {
            client.ensure_managed_bridge().await?;
            record = wait_for_discovery(client, &path).await?;
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
    match Connection::open(&record, CLIENT_ID, resume, tx).await {
        Ok(connection) => Ok((connection, rx)),
        Err(ConnectError::Rejected(status)) => Err((
            Unavailable::Rejected,
            format!("the bridge refused this app (HTTP {status})"),
        )),
        Err(err @ ConnectError::Refused(_)) => Err((Unavailable::NotRunning, err.to_string())),
        Err(err) => Err((Unavailable::Failed, err.to_string())),
    }
}

/// Polls for the file a just-started bridge writes once its listener is up,
/// giving up at once when that bridge exits instead (another bridge holds the
/// lock, a crash) — the reason is then in its log, `~/.uxnan/logs/`.
async fn wait_for_discovery(
    client: &BridgeClient,
    path: &std::path::Path,
) -> Result<Result<discovery::Discovery, DiscoveryError>, (Unavailable, String)> {
    let deadline = tokio::time::Instant::now() + MANAGED_START_TIMEOUT;
    loop {
        match discovery::read(path) {
            Ok(record) => return Ok(Ok(record)),
            Err(DiscoveryError::Invalid(why)) => return Ok(Err(DiscoveryError::Invalid(why))),
            Err(DiscoveryError::Missing) => {}
        }
        if let Some(exit) = client.managed_exit().await {
            return Err(match lock::default_path().and_then(|p| lock::running(&p)) {
                Some(running) => no_channel(running).await,
                None => (
                    Unavailable::Failed,
                    format!("the bridge exited right after starting ({exit}); see ~/.uxnan/logs"),
                ),
            });
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(Err(DiscoveryError::Missing));
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
        let client = BridgeClient::new(Mode::Off);
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
    fn set_mode_is_observable_and_idempotent() {
        let client = BridgeClient::new(Mode::Off);
        let rx = client.mode.subscribe();
        client.set_mode(Mode::Off);
        assert!(!rx.has_changed().unwrap());
        client.set_mode(Mode::Attach);
        assert!(rx.has_changed().unwrap());
        assert_eq!(client.mode(), Mode::Attach);
    }
}
