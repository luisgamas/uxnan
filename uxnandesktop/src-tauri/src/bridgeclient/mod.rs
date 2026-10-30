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
//! - `managed` (a fresh install's default): the same, but make sure the
//!   bridge runs as the user's service when none is running — the registered
//!   one, an independent `uxnan-bridge` the user already installed, or else
//!   the runtime this app carries (`runtime.rs`), installed and registered
//!   through the bridge's own CLI (`service.rs`). The service outlives the
//!   app — it keeps serving the phone while the desktop is closed — so the app
//!   never stops it on its own.
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
pub mod hosts;
pub mod lock;
pub mod reconnect;
pub mod runtime;
pub mod service;
#[cfg(test)]
mod socket_tests;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch, Mutex, Notify, RwLock};

use connection::{CallError, ConnectError, Connection, Event, Resume};
use discovery::DiscoveryError;
use service::{BridgeCli, ServiceError};

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

/// How long a freshly started service gets to publish its file.
const MANAGED_START_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a stopped bridge gets to let go of its lock.
const STOP_TIMEOUT: Duration = Duration::from_secs(10);

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
    /// `managed` found no bridge on this machine, and this build of the app
    /// carries none to install (a development build).
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

/// Who the registered service is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceOwner {
    /// A runtime this app installed (`runtime::runtime_root`).
    Bundled,
    /// Anything else: an npm install, a checkout.
    Independent,
}

/// What is on this machine, for Settings → Bridge & mobile and the chat gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    /// The bridge version this app carries; `None` for a build without one.
    pub bundled_version: Option<String>,
    /// The platform has a service manager the bridge supports.
    pub service_supported: bool,
    /// Who the registered service is, when one is registered.
    pub service: Option<ServiceOwner>,
    /// The version of the bridge the service runs, when it can be read.
    pub service_version: Option<String>,
    /// The version of an independent `uxnan-bridge` on `PATH`, when there is one.
    pub path_version: Option<String>,
    /// An independent `uxnan-bridge` resolves on `PATH`.
    pub path_found: bool,
}

/// How installing (or switching to) the app's bridge ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub ok: bool,
    /// The version running now, when it came up.
    pub version: Option<String>,
    /// The new bridge did not come up and the previous one was put back.
    pub rolled_back: bool,
    /// What went wrong, safe to show.
    pub error: Option<String>,
}

impl InstallResult {
    fn failed(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            version: None,
            rolled_back: false,
            error: Some(error.into()),
        }
    }
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
    /// A service start, install or switch is in flight (one at a time).
    starting: Mutex<()>,
    /// Where this app carries its bridge runtime, and where it installs it
    /// (set once at startup, [`BridgeClient::set_runtime`]).
    runtime: std::sync::RwLock<RuntimePaths>,
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

/// The app's bundled runtime folder and the per-user folder it is installed to.
#[derive(Debug, Clone, Default)]
struct RuntimePaths {
    bundle: Option<PathBuf>,
    root: Option<PathBuf>,
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
            runtime: std::sync::RwLock::new(RuntimePaths::default()),
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

    /// Whether agents get Uxnan's tools (Settings → Browser), which a host's
    /// own bridge follows too.
    pub fn tools_enabled(&self) -> bool {
        self.tools_enabled.load(Ordering::SeqCst)
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

    /// Where the app carries its runtime (`<resources>/bridge-runtime`) and
    /// where it installs it ([`runtime::runtime_root`]). Called once at
    /// startup; tests point both at scratch folders.
    pub fn set_runtime(&self, bundle: Option<PathBuf>, root: Option<PathBuf>) {
        *self.runtime.write().unwrap_or_else(|e| e.into_inner()) = RuntimePaths { bundle, root };
    }

    fn paths(&self) -> RuntimePaths {
        self.runtime
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The runtime this app carries, when it carries one.
    fn bundled_runtime(&self) -> Option<runtime::Runtime> {
        runtime::bundled(self.paths().bundle.as_deref()?).ok()
    }

    /// The runtimes installed for this user, newest first.
    fn installed_runtimes(&self) -> Vec<runtime::Runtime> {
        self.paths()
            .root
            .as_deref()
            .map(runtime::installed)
            .unwrap_or_default()
    }

    /// Any bridge CLI that can answer `service-status`, `stop` and
    /// `service-start` (they act on the one service and the one lock, whoever
    /// runs them): an installed runtime, else `uxnan-bridge` on `PATH`, else
    /// the app's own copy run in place.
    fn any_cli(&self) -> Option<BridgeCli> {
        self.installed_runtimes()
            .first()
            .map(BridgeCli::runtime)
            .or_else(|| crate::which::resolve(install_name()).map(BridgeCli::Path))
            .or_else(|| self.bundled_runtime().as_ref().map(BridgeCli::runtime))
    }

    /// Who a registered service program is.
    fn owner_of(&self, program: &service::ServiceProgram) -> ServiceOwner {
        match self.paths().root {
            Some(root) if runtime::is_inside(&root, Path::new(&program.cli)) => {
                ServiceOwner::Bundled
            }
            _ => ServiceOwner::Independent,
        }
    }

    /// What is on this machine: the app's bridge, the registered service and
    /// who it is, an independent `uxnan-bridge` on `PATH`. Never starts a
    /// bridge.
    pub async fn runtime_info(&self) -> RuntimeInfo {
        let path_bin = crate::which::resolve(install_name()).map(BridgeCli::Path);
        let path_version = match &path_bin {
            Some(cli) => service::version(cli).await,
            None => None,
        };
        let status = match self.any_cli() {
            Some(cli) => service::status(&cli).await.ok(),
            None => None,
        };
        let program = status.as_ref().and_then(|s| s.program.clone());
        let service_version = match program.as_ref().and_then(BridgeCli::of_program) {
            Some(cli) => service::version(&cli).await,
            None => None,
        };
        RuntimeInfo {
            bundled_version: self.bundled_runtime().map(|r| r.bridge_version),
            service_supported: status.as_ref().map(|s| s.supported).unwrap_or(false),
            service: status
                .as_ref()
                .filter(|s| s.installed)
                .map(|_| match &program {
                    Some(program) => self.owner_of(program),
                    None => ServiceOwner::Independent,
                }),
            service_version,
            path_found: path_bin.is_some(),
            path_version,
        }
    }

    /// Install the bridge this app carries and make it the user's service —
    /// the user's "Set up" / "Update" / "Use Uxnan's bridge", or the app
    /// bringing its own bridge up to the version it ships. Atomic: the new
    /// runtime is copied and verified before anything stops, and when it does
    /// not come up the service is put back on what it ran before.
    // FOR-DEV: the switch, its rollback and the first-launch registration are
    // unit-tested and verified against a scratch bridge, but have not yet run as
    // a real service on Windows/Linux/macOS (uxnandesktop/FOR-DEV.md → *The
    // bridge Uxnan carries*): registering touches the machine's one bridge.
    pub async fn install_bundled(&self) -> InstallResult {
        if self.installing.swap(true, Ordering::SeqCst) {
            return InstallResult::failed("an install is already running");
        }
        let result = {
            let _one = self.starting.lock().await;
            self.switch_to_bundled_locked().await
        };
        self.installing.store(false, Ordering::SeqCst);
        self.retry_now();
        result
    }

    async fn switch_to_bundled_locked(&self) -> InstallResult {
        let paths = self.paths();
        let (Some(bundle), Some(root)) = (paths.bundle.clone(), paths.root.clone()) else {
            return InstallResult::failed("this build of Uxnan carries no bridge");
        };
        let installed = match tokio::task::spawn_blocking({
            let (bundle, root) = (bundle.clone(), root.clone());
            move || runtime::install(&bundle, &root)
        })
        .await
        {
            Ok(Ok(runtime)) => runtime,
            Ok(Err(why)) => return InstallResult::failed(why),
            Err(err) => return InstallResult::failed(err.to_string()),
        };
        let new_cli = BridgeCli::runtime(&installed);
        // What the service runs now, to put back if the new one fails.
        let previous = match service::status(&new_cli).await {
            Ok(status) => status.program.as_ref().and_then(BridgeCli::of_program),
            Err(err) => return InstallResult::failed(service_error_text(err)),
        };
        // Already the registered service, and that version is the one serving
        // the channel: nothing to switch.
        if previous.as_ref() == Some(&new_cli) && serving(&installed.bridge_version) {
            return InstallResult {
                ok: true,
                version: Some(installed.bridge_version),
                rolled_back: false,
                error: None,
            };
        }
        if let Err(why) = stop_running(&new_cli).await {
            return InstallResult::failed(why);
        }
        let registered = service::register(&new_cli).await;
        let came_up = match registered {
            Ok(()) => wait_for_version(&installed.bridge_version).await,
            Err(err) => Err(service_error_text(err)),
        };
        match came_up {
            Ok(()) => {
                let keep_previous = previous
                    .as_ref()
                    .and_then(BridgeCli::cli_path)
                    .filter(|cli| runtime::is_inside(&root, cli))
                    .and_then(|cli| runtime_dir_of(&root, cli));
                let mut keep: Vec<&Path> = vec![installed.dir.as_path()];
                if let Some(dir) = keep_previous.as_deref() {
                    keep.push(dir);
                }
                runtime::prune(&root, &keep);
                InstallResult {
                    ok: true,
                    version: Some(installed.bridge_version),
                    rolled_back: false,
                    error: None,
                }
            }
            Err(why) => {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Warn,
                    "bridge",
                    &format!(
                        "the bridge {} did not come up: {why}",
                        installed.bridge_version
                    ),
                );
                let rolled_back = match previous.as_ref().filter(|p| **p != new_cli) {
                    Some(previous) => {
                        let _ = stop_running(previous).await;
                        service::register(previous).await.is_ok()
                    }
                    None => false,
                };
                if previous.as_ref() != Some(&new_cli) {
                    let _ = std::fs::remove_dir_all(&installed.dir);
                }
                InstallResult {
                    ok: false,
                    version: None,
                    rolled_back,
                    error: Some(why),
                }
            }
        }
    }

    /// Remove the bridge this app installed: its service (and what that
    /// service kept in agents' configs) and every runtime folder. Never
    /// `~/.uxnan` — the identity, the trusted phones and the conversations
    /// stay for whichever bridge runs next. An independent bridge registered
    /// as the service is the user's: it is left alone, and said so.
    pub async fn uninstall_bundled(&self) -> Result<(), String> {
        let _one = self.starting.lock().await;
        let root = self
            .paths()
            .root
            .ok_or("no runtime folder on this system")?;
        if let Some(cli) = self.any_cli() {
            let status = service::status(&cli).await.map_err(service_error_text)?;
            if let Some(program) = status.program.as_ref().filter(|_| status.installed) {
                if self.owner_of(program) == ServiceOwner::Independent {
                    return Err(
                        "the bridge service on this PC is not the one Uxnan installed; remove it with its own `uxnan-bridge uninstall-service`"
                            .into(),
                    );
                }
                let ours = BridgeCli::of_program(program).unwrap_or(cli.clone());
                stop_running(&ours).await?;
                service::uninstall(&ours)
                    .await
                    .map_err(service_error_text)?;
            }
        }
        runtime::remove_all(&root)
    }

    /// Restarts the bridge on the version installed now: stops whichever
    /// bridge holds the lock through the bridge's own `stop`, then — unless
    /// the mode is `off` — brings the service up again.
    pub async fn restart(&self) -> Result<(), String> {
        let cli = self.any_cli().ok_or("no bridge is installed")?;
        stop_running(&cli).await?;
        if self.mode() != Mode::Off {
            self.ensure_service().await.map_err(|(_, why)| why)?;
        }
        self.retry_now();
        Ok(())
    }

    /// Make sure the bridge runs as the user's service (`managed`, nothing
    /// running), in this order: the registered service; an independent
    /// `uxnan-bridge` the user installed (registered, never duplicated); the
    /// runtime this app carries. A registered service whose files are gone
    /// is replaced by the app's.
    async fn ensure_service(&self) -> Result<(), (Unavailable, String)> {
        let _one = self.starting.lock().await;
        let path_cli = crate::which::resolve(install_name()).map(BridgeCli::Path);
        let Some(probe) = self.any_cli() else {
            return Err((
                Unavailable::NotInstalled,
                "no bridge on this PC, and this build of Uxnan carries none".to_string(),
            ));
        };
        match service::status(&probe).await {
            Ok(status) if !status.supported => Err((
                Unavailable::ServiceFailed,
                "this system has no service manager the bridge supports".to_string(),
            )),
            Ok(status) if status.installed => match &status.program {
                Some(program) => match BridgeCli::of_program(program) {
                    Some(cli) => service::start(&cli).await.map_err(service_unavailable),
                    // Its files are gone (an uninstalled npm package, a
                    // deleted runtime): nothing could start it.
                    None => self.register_bundled_locked().await,
                },
                // A bridge older than `program`: let it start what it knows.
                None => service::start(&probe).await.map_err(service_unavailable),
            },
            Ok(_) => {
                if let Some(path) = path_cli {
                    match service::register(&path).await {
                        Ok(()) => return Ok(()),
                        // Too old to run as a service: the app's own instead.
                        Err(ServiceError::Outdated) => {}
                        Err(err) => return Err(service_unavailable(err)),
                    }
                }
                self.register_bundled_locked().await
            }
            Err(ServiceError::Outdated) => self.register_bundled_locked().await,
            Err(err) => Err(service_unavailable(err)),
        }
    }

    /// Install the app's runtime and register it (the starting lock is held).
    /// A development build never does this on its own — the service it would
    /// register is the machine's one bridge — only when the user asks
    /// ([`Self::install_bundled`]).
    async fn register_bundled_locked(&self) -> Result<(), (Unavailable, String)> {
        if cfg!(debug_assertions) && !cfg!(test) {
            return Err((
                Unavailable::NotInstalled,
                "a development build sets up the bridge it carries only when asked".to_string(),
            ));
        }
        let paths = self.paths();
        let (Some(bundle), Some(root)) = (paths.bundle, paths.root) else {
            return Err((
                Unavailable::NotInstalled,
                "no bridge on this PC, and this build of Uxnan carries none".to_string(),
            ));
        };
        let runtime = tokio::task::spawn_blocking(move || runtime::install(&bundle, &root))
            .await
            .map_err(|e| (Unavailable::Failed, e.to_string()))?
            .map_err(|why| (Unavailable::Failed, why))?;
        service::register(&BridgeCli::runtime(&runtime))
            .await
            .map_err(service_unavailable)
    }

    /// The version of the bridge installed now (what a restart would run).
    async fn installed_version(&self) -> Option<String> {
        let cli = self.any_cli()?;
        let program = service::status(&cli).await.ok()?.program;
        match program.as_ref().and_then(BridgeCli::of_program) {
            Some(cli) => service::version(&cli).await,
            None => service::version(&cli).await,
        }
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

/// The command an independent (npm) bridge installs as.
fn install_name() -> &'static str {
    "uxnan-bridge"
}

fn service_error_text(err: ServiceError) -> String {
    match err {
        ServiceError::Outdated => "the installed bridge predates running as a service".to_string(),
        ServiceError::Failed(why) => why,
    }
}

fn service_unavailable(err: ServiceError) -> (Unavailable, String) {
    match err {
        ServiceError::Outdated => (Unavailable::Outdated, service_error_text(err)),
        ServiceError::Failed(why) => (Unavailable::ServiceFailed, why),
    }
}

/// The `versions/<…>` folder a runtime CLI path sits in.
fn runtime_dir_of(root: &Path, cli: &Path) -> Option<PathBuf> {
    let versions = root.join("versions");
    let rest = cli.strip_prefix(&versions).ok()?;
    rest.components()
        .next()
        .map(|first| versions.join(first.as_os_str()))
}

/// Stop whichever bridge holds the lock and wait (bounded) for it to let go.
async fn stop_running(cli: &BridgeCli) -> Result<(), String> {
    let Some(path) = lock::default_path() else {
        return Ok(());
    };
    if lock::running(&path).is_none() {
        return Ok(());
    }
    service::stop(cli).await;
    let deadline = tokio::time::Instant::now() + STOP_TIMEOUT;
    while lock::running(&path).is_some() {
        if tokio::time::Instant::now() >= deadline {
            return Err("the running bridge did not stop".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Ok(())
}

/// Whether the bridge serving the local channel right now is `version`: its
/// discovery record names it and was written by the process holding the lock
/// (a stopped bridge's record can outlive it).
fn serving(version: &str) -> bool {
    let (Some(path), Some(lock_path)) = (discovery::default_path(), lock::default_path()) else {
        return false;
    };
    matches!(
        (discovery::read(&path), lock::running(&lock_path)),
        (Ok(record), Some(held)) if record.bridge_version == version && record.pid == held.pid
    )
}

/// Wait for the bridge at `version` to serve the local channel.
async fn wait_for_version(version: &str) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + MANAGED_START_TIMEOUT;
    loop {
        if serving(version) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "the bridge {version} did not start within {} s; see ~/.uxnan/logs",
                MANAGED_START_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Why a running bridge serves no local channel (see [`Unavailable::Outdated`]
/// and [`Unavailable::ChannelOff`]). A bridge that only just started may still
/// be about to publish it.
async fn no_channel(client: &BridgeClient, running: lock::LockInfo) -> (Unavailable, String) {
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
    match client.installed_version().await {
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
    let mut policy = reconnect::Reconnect::default();
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
        let wait = match connect_once(&client, mode, resume.as_ref()).await {
            Ok((connection, mut events)) => {
                let opened = std::time::Instant::now();
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
                let mut closed_because = None;
                let mut switched_off = false;
                loop {
                    tokio::select! {
                        event = events.recv() => match event {
                            Some(Event::Notification { message, .. }) => {
                                let _ = app.emit(NOTIFICATION_EVENT, message);
                            }
                            Some(Event::Closed { reason }) => {
                                closed_because = reason;
                                break;
                            }
                            None => break,
                        },
                        changed = mode_rx.changed() => {
                            if changed.is_err() {
                                connection.close();
                                return;
                            }
                            if *mode_rx.borrow() == Mode::Off {
                                connection.close();
                                switched_off = true;
                                break;
                            }
                            // attach ↔ managed keeps the live connection.
                        }
                    }
                }
                resume = Some(connection.resume_point());
                client.connection.write().await.take();
                if switched_off {
                    // Off is handled at the top of the loop, at once.
                    continue;
                }
                let lived = opened.elapsed();
                if let Some(reason) = closed_because {
                    crate::diagnostics::log(
                        crate::diagnostics::Level::Warn,
                        "bridge",
                        &format!(
                            "the bridge connection closed after {} ms: {reason}",
                            lived.as_millis()
                        ),
                    );
                }
                // Promptly when it had been up a while (a restarted bridge, a
                // superseded socket); a connection that died at once backs off.
                policy.after_close(lived)
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
                policy.after_failure()
            }
        };

        // Wait it out, unless asked to retry or the mode changes.
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = client.retry.notified() => {}
            changed = mode_rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
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
            let (reason, detail) = no_channel(client, running).await;
            if reason != Unavailable::NotRunning || mode != Mode::Managed {
                return Err((reason, detail));
            }
            record = wait_for_discovery(client, &path).await?;
        } else if mode == Mode::Managed {
            client.ensure_service().await?;
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
        if tokio::time::Instant::now() >= deadline {
            return Err(match lock::default_path().and_then(|p| lock::running(&p)) {
                Some(running) => no_channel(client, running).await,
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
