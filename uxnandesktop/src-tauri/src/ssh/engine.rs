//! The host's daemon (`uxnan-host`), from this side: putting it on the host and
//! talking to it.
//!
//! **Putting it there.** The daemon is one static binary per platform. The app
//! asks the host what it is (`uname -sm`), finds the matching build on this
//! machine, uploads it over the SFTP session the host already has, and asks it
//! to prove it runs (`uxnan-host version`). Nothing is downloaded on the host,
//! nothing is compiled there, nothing needs to be installed there first. A
//! build that is already in place is reused; each build gets its own directory
//! (`~/.uxnan/host/versions/<version>-<hash>/`), so an update never replaces the
//! binary a running daemon was started from.
//!
//! **Talking to it.** One SSH channel: an `exec` of `uxnan-host attach`, whose
//! stdin/stdout the daemon speaks frames on (`uxnan-host-protocol`). Every
//! terminal on the host is multiplexed over that one channel, which is also why
//! these terminals do not count against the host's `MaxSessions` one by one.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot, Mutex, Notify};
use uxnan_host_protocol::{
    read_frame, write_frame, Call, ClientMessage, Event, Frame, Outcome, Reply, ServerMessage,
    Welcome, PROTOCOL, PROTOCOL_MIN, READY_LINE,
};

use super::conn::Connection;
use super::sftp::RemoteFiles;
use super::shellkind::{self, ShellKind};
use crate::error::AppError;

/// Where the daemon lives on a host, under the user's home.
const HOST_DIR: &str = ".uxnan/host/versions";

/// How long `attach` may take to say it is joined: the first start of a daemon
/// on a slow machine included, and a login shell that prints a banner first.
const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// Noise a login shell may print before the ready line, at most. Past this the
/// stream is not what we think it is.
const MAX_PREAMBLE: usize = 64 * 1024;

/// How long one call waits for its answer.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// How often the daemon is asked whether it is still there, and how long a
/// silence counts as a link that is gone.
///
/// The SSH keepalive notices a dead link too, but only after ~two minutes
/// (`conn.rs`). A half-open link — a Wi-Fi that dropped without a word, a
/// laptop that slept — looks alive to TCP all that time, and a terminal that
/// silently swallows keystrokes for two minutes is worse than one that says it
/// is reconnecting. The daemon answers a ping at once, so 30 s of silence is not
/// a slow host; it is no host.
const PING_EVERY: Duration = Duration::from_secs(10);
const SILENCE_IS_GONE: Duration = Duration::from_secs(30);

/// Whether a link that last said something `since` ago is gone.
fn link_is_gone(since: Duration) -> bool {
    since >= SILENCE_IS_GONE
}

/// The build of `uxnan-host` a host needs, from what `uname -sm` printed.
pub fn triple_for(uname: &str) -> Option<&'static str> {
    let mut words = uname.split_whitespace();
    let (os, arch) = (words.next()?, words.next()?);
    match (os, arch) {
        ("Linux", "x86_64" | "amd64") => Some("x86_64-unknown-linux-musl"),
        ("Linux", "aarch64" | "arm64") => Some("aarch64-unknown-linux-musl"),
        ("Darwin", "arm64" | "aarch64") => Some("aarch64-apple-darwin"),
        ("Darwin", "x86_64") => Some("x86_64-apple-darwin"),
        _ => None,
    }
}

/// Where the installer put the host engines (`<resources>/host-engine/`), set
/// once at startup (`set_bundled_dir`).
static BUNDLED_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Record where the app's bundled host engines are. Called once, from the
/// app's setup, with its resource folder.
pub fn set_bundled_dir(dir: PathBuf) {
    let _ = BUNDLED_DIR.set(dir);
}

/// Where this app keeps the `uxnan-host` build for `triple`.
///
/// In order: the build the installer carries (`scripts/build-host-engine.mjs`
/// bundles one per platform into every installer), `UXNAN_HOST_BINARIES/
/// <triple>/uxnan-host` (a developer pointing at their own builds), and — in a
/// debug build only — the workspace's own outputs (`host-engine/`, where the
/// script leaves them, and cargo's `target/<triple>/release/`).
pub fn local_binary(triple: &str) -> Result<PathBuf, AppError> {
    let name = if triple.contains("windows") {
        "uxnan-host.exe"
    } else {
        "uxnan-host"
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = BUNDLED_DIR.get() {
        candidates.push(dir.join(triple).join(name));
    }
    if let Some(dir) = std::env::var_os("UXNAN_HOST_BINARIES") {
        candidates.push(PathBuf::from(dir).join(triple).join(name));
    }
    #[cfg(debug_assertions)]
    {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        candidates.push(manifest.join("host-engine").join(triple).join(name));
        candidates.push(
            manifest
                .join("target")
                .join(triple)
                .join("release")
                .join(name),
        );
    }
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| {
        AppError::Invalid(format!(
            "this build of Uxnan carries no host engine for {triple} — terminals on this host \
             cannot outlive a disconnection"
        ))
    })
}

/// Make sure this build's daemon is on the host and runs there; answer the
/// path to it.
pub async fn ensure_installed(
    conn: &Connection,
    shell: ShellKind,
    files: &RemoteFiles,
) -> Result<String, AppError> {
    if shell != ShellKind::Posix {
        // FOR-DEV: Windows hosts — the daemon has no named-pipe listener yet
        // (`crates/uxnan-host/src/daemon.rs` → `bind`), so their terminals stay
        // on plain SSH channels (`ssh/pty.rs`) until it does.
        return Err(AppError::Invalid(
            "the host engine does not run on Windows hosts yet".to_string(),
        ));
    }
    let home = files.home().await.map_err(|e| {
        AppError::Invalid(format!(
            "could not find the home folder on that host: {}",
            failure(e)
        ))
    })?;
    let uname = conn.exec("uname -sm").await?;
    let triple = triple_for(uname.stdout.trim()).ok_or_else(|| {
        AppError::Invalid(format!(
            "the host engine is not built for this host ({})",
            uname.stdout.trim()
        ))
    })?;
    let local = local_binary(triple)?;
    let bytes = tokio::fs::read(&local).await?;
    // The folder is named by the version **and** the bytes, so a different
    // build — a development build of the same version, a rebuilt release — is
    // a different folder, never a silent reuse of whatever is already there.
    let dir = format!(
        "{}/{HOST_DIR}/{}",
        home.trim_end_matches('/'),
        install_dir_name(&bytes)
    );
    let path = format!("{dir}/uxnan-host");

    if runs_here(conn, &path).await {
        return Ok(path);
    }
    // A file there that does not run is a broken copy (an upload cut short):
    // that one is replaced. Otherwise a racing install of the same build wins.
    let broken = files.exists(&path).await.unwrap_or(false);
    files
        .install_executable(&dir, "uxnan-host", &bytes, broken)
        .await
        .map_err(|e| {
            AppError::Invalid(format!(
                "could not put the host engine on that host: {}",
                failure(e)
            ))
        })?;
    if !runs_here(conn, &path).await {
        return Err(AppError::Invalid(format!(
            "the host engine was uploaded to {path} but does not run there"
        )));
    }
    crate::diagnostics::log(
        crate::diagnostics::Level::Info,
        "ssh-engine",
        &format!(
            "installed the host engine ({triple}, {} bytes)",
            bytes.len()
        ),
    );
    Ok(path)
}

/// `<version>-<first 12 hex of the binary's SHA-256>`.
fn install_dir_name(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    format!(
        "{}-{}",
        env!("CARGO_PKG_VERSION"),
        hex::encode(&digest[..6])
    )
}

fn failure(e: super::sftp::SftpFailure) -> String {
    match e {
        super::sftp::SftpFailure::Refused(e) => e.to_string(),
        super::sftp::SftpFailure::Gone(m) => m,
    }
}

/// Whether the binary at `path` runs on this host and speaks a protocol this
/// app does.
async fn runs_here(conn: &Connection, path: &str) -> bool {
    let command = format!("{} version", shellkind::quote_arg(ShellKind::Posix, path));
    let Ok(out) = conn.exec(&command).await else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(out.stdout.trim()) else {
        return false;
    };
    let protocol = v["protocol"].as_u64().unwrap_or(0) as u32;
    let protocol_min = v["protocolMin"].as_u64().unwrap_or(u64::MAX) as u32;
    uxnan_host_protocol::negotiate(protocol_min, protocol).is_some()
        && v["version"].as_str() == Some(env!("CARGO_PKG_VERSION"))
}

/// What receives a session's output.
pub type OutputFn = Box<dyn Fn(&[u8]) + Send + Sync>;
/// What is told, once, that a session's program ended.
pub type ExitFn = Box<dyn FnOnce() + Send>;

/// Where a session's output goes, on this side.
pub struct Sink {
    pub output: OutputFn,
    pub exit: Option<ExitFn>,
}

type Sinks = Arc<std::sync::Mutex<HashMap<u32, Sink>>>;

/// What hears that something changed under the folder this engine watches:
/// `(root, paths, overflow, git)`.
pub type ChangedFn = Box<dyn Fn(String, Vec<String>, bool, bool) + Send + Sync>;
type OnChanged = Arc<std::sync::Mutex<Option<ChangedFn>>>;

/// What hears an agent's report from one of this host's terminals:
/// `(session, headers, body)`, exactly as its reporter posted them on the host.
pub type HookFn = Box<dyn Fn(u32, Vec<(String, String)>, String) + Send + Sync>;
type OnHook = Arc<std::sync::Mutex<Option<HookFn>>>;

/// A request waiting for its answer, and — for an `open` — the sink to install
/// for the session it creates, *before* that session's first output is read.
struct Pending {
    reply: oneshot::Sender<Outcome>,
    sink_for_open: Option<Sink>,
}

/// A live connection to one host's daemon.
pub struct HostEngine {
    welcome: Welcome,
    out: mpsc::Sender<Frame>,
    pending: Arc<std::sync::Mutex<HashMap<u64, Pending>>>,
    sinks: Sinks,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    lost: Arc<Notify>,
    on_changed: OnChanged,
    on_hook: OnHook,
    /// Asks the reader and the writer to stop, which closes the channel. A
    /// `watch` rather than a notification: it holds the request, so a task that
    /// was busy when it came still sees it.
    shutdown: tokio::sync::watch::Sender<bool>,
    /// Which connection carries it: a reconnect means a new engine.
    generation: u64,
}

impl HostEngine {
    /// Join the daemon over a new channel on `conn`, starting it if needed.
    pub async fn start(conn: &Connection, path: &str) -> Result<Arc<HostEngine>, AppError> {
        let (channel, lease) = conn.open_channel("the host engine", false).await?;
        let command = format!("{} attach", shellkind::quote_arg(ShellKind::Posix, path));
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::Invalid(format!("could not start the host engine: {e}")))?;
        let stream = channel.into_stream();
        let (mut reader, mut writer) = tokio::io::split(stream);

        tokio::time::timeout(READY_TIMEOUT, skip_to_ready(&mut reader))
            .await
            .map_err(|_| {
                AppError::Invalid("the host engine did not answer in time".to_string())
            })??;

        write_frame(
            &mut writer,
            &Frame::control(&ClientMessage::Hello {
                protocol_min: PROTOCOL_MIN,
                protocol: PROTOCOL,
                client: format!("uxnan-desktop {}", env!("CARGO_PKG_VERSION")),
            }),
        )
        .await?;
        let welcome = match read_frame(&mut reader).await? {
            Some(Frame::Control(json)) => match serde_json::from_slice::<ServerMessage>(&json) {
                Ok(ServerMessage::Welcome(w)) => w,
                Ok(ServerMessage::Refused { reason }) => {
                    return Err(AppError::Invalid(format!(
                        "the host engine refused us: {reason}"
                    )))
                }
                _ => {
                    return Err(AppError::Invalid(
                        "the host engine answered nonsense".to_string(),
                    ))
                }
            },
            _ => {
                return Err(AppError::Invalid(
                    "the host engine closed the channel".to_string(),
                ))
            }
        };

        let (out, mut out_rx) = mpsc::channel::<Frame>(1024);
        let alive = Arc::new(AtomicBool::new(true));
        let lost = Arc::new(Notify::new());
        let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        // When anything last arrived from the daemon, as milliseconds since
        // `started`: every frame is proof of life, not only a pong.
        let started = std::time::Instant::now();
        let last_heard = Arc::new(AtomicU64::new(0));
        let pending: Arc<std::sync::Mutex<HashMap<u64, Pending>>> = Arc::default();
        let sinks: Sinks = Arc::default();
        let on_changed: OnChanged = Arc::default();
        let on_hook: OnHook = Arc::default();

        // Writer: one owner of the channel's write half.
        let writer_alive = Arc::clone(&alive);
        let mut writer_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            let _lease = lease;
            loop {
                tokio::select! {
                    frame = out_rx.recv() => match frame {
                        Some(frame) => {
                            if write_frame(&mut writer, &frame).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    },
                    _ = writer_shutdown.changed() => break,
                }
            }
            let _ = tokio::io::AsyncWriteExt::shutdown(&mut writer).await;
            writer_alive.store(false, Ordering::SeqCst);
        });

        // Reader: answers to their callers, output to its terminal.
        let reader_alive = Arc::clone(&alive);
        let reader_lost = Arc::clone(&lost);
        let reader_pending = Arc::clone(&pending);
        let reader_sinks = Arc::clone(&sinks);
        let reader_changed = Arc::clone(&on_changed);
        let reader_hook = Arc::clone(&on_hook);
        let pong = out.clone();
        let mut reader_shutdown = shutdown_rx.clone();
        let reader_heard = Arc::clone(&last_heard);
        tokio::spawn(async move {
            loop {
                let frame = tokio::select! {
                    frame = read_frame(&mut reader) => match frame {
                        Ok(Some(frame)) => frame,
                        _ => break,
                    },
                    _ = reader_shutdown.changed() => break,
                };
                reader_heard.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                match frame {
                    Frame::Data { session, bytes } => {
                        if let Some(sink) = reader_sinks.lock().unwrap().get(&session) {
                            (sink.output)(&bytes);
                        }
                    }
                    Frame::Control(json) => match serde_json::from_slice::<ServerMessage>(&json) {
                        Ok(ServerMessage::Response { id, outcome }) => {
                            let waiting = reader_pending.lock().unwrap().remove(&id);
                            if let Some(waiting) = waiting {
                                if let (
                                    Outcome::Ok {
                                        reply: Reply::Opened { session, .. },
                                    },
                                    Some(sink),
                                ) = (&outcome, waiting.sink_for_open)
                                {
                                    reader_sinks.lock().unwrap().insert(*session, sink);
                                }
                                let _ = waiting.reply.send(outcome);
                            }
                        }
                        Ok(ServerMessage::Event(Event::Changed {
                            root,
                            paths,
                            overflow,
                            git,
                        })) => {
                            if let Some(report) = reader_changed.lock().unwrap().as_ref() {
                                report(root, paths, overflow, git);
                            }
                        }
                        Ok(ServerMessage::Event(Event::Hook {
                            session,
                            headers,
                            body,
                        })) => {
                            if let Some(report) = reader_hook.lock().unwrap().as_ref() {
                                report(session, headers, body);
                            }
                        }
                        Ok(ServerMessage::Event(Event::Exited { session, .. })) => {
                            let exit = reader_sinks
                                .lock()
                                .unwrap()
                                .get_mut(&session)
                                .and_then(|s| s.exit.take());
                            if let Some(exit) = exit {
                                exit();
                            }
                        }
                        _ => {}
                    },
                    Frame::Ping(n) => {
                        let _ = pong.try_send(Frame::Pong(n));
                    }
                    Frame::Pong(_) => {}
                }
            }
            reader_alive.store(false, Ordering::SeqCst);
            // Nobody will answer what is still waiting.
            reader_pending.lock().unwrap().clear();
            reader_lost.notify_waiters();
        });

        // Heartbeat: ask, and give up on a link that stopped answering.
        let beat_out = out.clone();
        let beat_alive = Arc::clone(&alive);
        let beat_shutdown = shutdown.clone();
        let mut beat_stop = shutdown_rx;
        tokio::spawn(async move {
            let mut n: u64 = 0;
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(PING_EVERY) => {}
                    _ = beat_stop.changed() => return,
                }
                if !beat_alive.load(Ordering::SeqCst) {
                    return;
                }
                let heard = Duration::from_millis(last_heard.load(Ordering::SeqCst));
                if link_is_gone(started.elapsed().saturating_sub(heard)) {
                    crate::diagnostics::log(
                        crate::diagnostics::Level::Info,
                        "ssh-engine",
                        "the host engine stopped answering; treating the link as gone",
                    );
                    beat_alive.store(false, Ordering::SeqCst);
                    let _ = beat_shutdown.send(true);
                    return;
                }
                n += 1;
                let _ = beat_out.try_send(Frame::Ping(n));
            }
        });

        crate::diagnostics::log(
            crate::diagnostics::Level::Info,
            "ssh-engine",
            &format!(
                "joined the host engine {} (protocol {}, epoch {})",
                welcome.version, welcome.protocol, welcome.epoch
            ),
        );
        Ok(Arc::new(HostEngine {
            welcome,
            out,
            pending,
            sinks,
            next_id: AtomicU64::new(1),
            alive,
            lost,
            on_changed,
            on_hook,
            shutdown,
            generation: conn.generation(),
        }))
    }

    pub fn epoch(&self) -> &str {
        &self.welcome.epoch
    }

    /// The daemon's process id on the host.
    pub fn daemon_pid(&self) -> u32 {
        self.welcome.pid
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Close the channel to the daemon. Its terminals keep running there; this
    /// side stops watching them, and [`Self::lost`] wakes whoever waits on it.
    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        let _ = self.shutdown.send(true);
    }

    /// Wait until the channel to the daemon is gone.
    pub async fn lost(&self) {
        if !self.is_alive() {
            return;
        }
        self.lost.notified().await;
    }

    async fn request(&self, call: Call, sink_for_open: Option<Sink>) -> Result<Reply, AppError> {
        if !self.is_alive() {
            return Err(AppError::NotConnected("the host engine".to_string()));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                reply: tx,
                sink_for_open,
            },
        );
        self.out
            .send(Frame::control(&ClientMessage::Request { id, call }))
            .await
            .map_err(|_| AppError::NotConnected("the host engine".to_string()))?;
        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(Outcome::Ok { reply })) => Ok(reply),
            Ok(Ok(Outcome::Error { code, message })) => Err(match code {
                uxnan_host_protocol::ErrorCode::NotFound => AppError::NotFound(message),
                _ => AppError::Pty(message),
            }),
            Ok(Err(_)) => Err(AppError::NotConnected("the host engine".to_string())),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(AppError::Invalid(
                    "the host engine did not answer in time".to_string(),
                ))
            }
        }
    }

    /// Start a terminal; its output goes to `sink` from the first byte.
    #[allow(clippy::too_many_arguments)]
    pub async fn open(
        &self,
        label: &str,
        cwd: Option<String>,
        command: Option<Vec<String>>,
        env: Vec<(String, String)>,
        cols: u16,
        rows: u16,
        sink: Sink,
    ) -> Result<(u32, Option<u32>), AppError> {
        match self
            .request(
                Call::Open {
                    cols,
                    rows,
                    cwd,
                    command,
                    env,
                    label: label.to_string(),
                },
                Some(sink),
            )
            .await?
        {
            Reply::Opened { session, pid } => Ok((session, pid)),
            other => Err(AppError::Invalid(format!(
                "unexpected reply to open: {other:?}"
            ))),
        }
    }

    /// Watch a running terminal: `sink` gets its screen, then its output.
    pub async fn attach(
        &self,
        session: u32,
        cols: u16,
        rows: u16,
        sink: Sink,
    ) -> Result<bool, AppError> {
        // Installed before asking, so the snapshot that follows the answer has
        // somewhere to go.
        self.sinks.lock().unwrap().insert(session, sink);
        match self
            .request(
                Call::Attach {
                    session,
                    cols,
                    rows,
                },
                None,
            )
            .await
        {
            Ok(Reply::Attached { alive, .. }) => Ok(alive),
            Ok(other) => Err(AppError::Invalid(format!(
                "unexpected reply to attach: {other:?}"
            ))),
            Err(e) => {
                self.sinks.lock().unwrap().remove(&session);
                Err(e)
            }
        }
    }

    pub async fn list(&self) -> Result<Vec<uxnan_host_protocol::SessionInfo>, AppError> {
        match self.request(Call::List, None).await? {
            Reply::Sessions { sessions } => Ok(sessions),
            other => Err(AppError::Invalid(format!(
                "unexpected reply to list: {other:?}"
            ))),
        }
    }

    pub async fn write(&self, session: u32, bytes: Vec<u8>) -> Result<(), AppError> {
        self.out
            .send(Frame::Data { session, bytes })
            .await
            .map_err(|_| AppError::NotConnected("the host engine".to_string()))
    }

    pub async fn resize(&self, session: u32, cols: u16, rows: u16) -> Result<(), AppError> {
        self.request(
            Call::Resize {
                session,
                cols,
                rows,
            },
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn close(&self, session: u32) -> Result<(), AppError> {
        self.sinks.lock().unwrap().remove(&session);
        self.request(Call::Close { session }, None)
            .await
            .map(|_| ())
    }

    /// Where reports of changes under the watched folder go.
    pub fn set_on_changed(&self, report: ChangedFn) {
        *self.on_changed.lock().unwrap() = Some(report);
    }

    /// Where the agents' reports from this host's terminals go.
    pub fn set_on_hook(&self, report: HookFn) {
        *self.on_hook.lock().unwrap() = Some(report);
    }

    /// Wire the agents on the host to report their state — the same installer
    /// this machine runs, run there — answering which agents are wired.
    pub async fn wire_hooks(&self) -> Result<Vec<String>, AppError> {
        if self.welcome.protocol < 3 {
            return Err(AppError::Invalid(
                "the host engine running there is too old to wire agent hooks".to_string(),
            ));
        }
        match self.request(Call::WireHooks, None).await? {
            Reply::HooksWired { agents } => Ok(agents),
            other => Err(AppError::Invalid(format!(
                "unexpected answer to wiring hooks: {other:?}"
            ))),
        }
    }

    /// Watch `root` on the host (replacing any folder watched before).
    pub async fn watch(&self, root: &str) -> Result<(), AppError> {
        // An older daemon still serving this host's terminals does not watch;
        // the panels then refresh on open, on act and on their button.
        if self.welcome.protocol < 2 {
            return Err(AppError::Invalid(
                "the host engine running there is too old to watch folders".to_string(),
            ));
        }
        self.request(
            Call::Watch {
                root: root.to_string(),
            },
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn unwatch(&self) -> Result<(), AppError> {
        if self.welcome.protocol < 2 {
            return Ok(());
        }
        self.request(Call::Unwatch, None).await.map(|_| ())
    }

    /// Stop delivering a session's output here without ending it.
    pub fn forget(&self, session: u32) {
        self.sinks.lock().unwrap().remove(&session);
    }
}

/// Read and drop whatever a login shell printed before `attach` was joined.
async fn skip_to_ready<R: tokio::io::AsyncRead + Unpin>(reader: &mut R) -> Result<(), AppError> {
    let mut line = Vec::new();
    let mut seen = 0usize;
    let mut byte = [0u8; 1];
    loop {
        if reader.read(&mut byte).await? == 0 {
            return Err(AppError::Invalid(
                "the host engine ended before it was ready".to_string(),
            ));
        }
        seen += 1;
        if seen > MAX_PREAMBLE {
            return Err(AppError::Invalid(
                "the host engine never said it was ready".to_string(),
            ));
        }
        if byte[0] == b'\n' {
            if String::from_utf8_lossy(&line)
                .trim_start()
                .starts_with(READY_LINE)
            {
                return Ok(());
            }
            line.clear();
        } else {
            line.push(byte[0]);
        }
    }
}

/// The engines of the connected hosts, one each, started on first use.
#[derive(Default)]
pub struct Engines {
    engines: Mutex<HashMap<String, Arc<HostEngine>>>,
    /// One start at a time per host: two terminals opening at once must not
    /// upload the binary twice or start two channels.
    starting: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Engines {
    /// The live engine for `host_id` on connection `conn`, starting (and
    /// installing) it when there is none. The flag says it was started now, so
    /// the caller can watch it once.
    pub async fn get_or_start(
        &self,
        host_id: &str,
        conn: &Connection,
        shell: ShellKind,
        files: impl std::future::Future<Output = Result<Arc<RemoteFiles>, AppError>>,
    ) -> Result<(Arc<HostEngine>, bool), AppError> {
        if let Some(engine) = self.current(host_id, conn.generation()).await {
            return Ok((engine, false));
        }
        let gate = {
            let mut starting = self.starting.lock().await;
            Arc::clone(starting.entry(host_id.to_string()).or_default())
        };
        let _one_at_a_time = gate.lock().await;
        if let Some(engine) = self.current(host_id, conn.generation()).await {
            return Ok((engine, false));
        }
        let files = files.await?;
        let path = ensure_installed(conn, shell, &files).await?;
        let engine = HostEngine::start(conn, &path).await?;
        self.engines
            .lock()
            .await
            .insert(host_id.to_string(), Arc::clone(&engine));
        Ok((engine, true))
    }

    /// The engine for `host_id`, if it is alive and rides connection
    /// `generation`.
    pub async fn current(&self, host_id: &str, generation: u64) -> Option<Arc<HostEngine>> {
        let engines = self.engines.lock().await;
        engines
            .get(host_id)
            .filter(|e| e.is_alive() && e.generation() == generation)
            .cloned()
    }

    /// Forget a host's engine and close its channel — it would otherwise keep
    /// the SSH connection under it alive.
    pub async fn remove(&self, host_id: &str) {
        if let Some(engine) = self.engines.lock().await.remove(host_id) {
            engine.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_is_gone_after_a_silence_no_live_daemon_keeps() {
        // The daemon answers a ping at once and pings come every 10 s, so even
        // a slow host is heard several times inside the window.
        assert!(!link_is_gone(Duration::from_secs(0)));
        assert!(!link_is_gone(PING_EVERY * 2));
        assert!(link_is_gone(SILENCE_IS_GONE));
        assert!(
            SILENCE_IS_GONE >= PING_EVERY * 3,
            "three missed answers, not one"
        );
    }

    #[test]
    fn a_different_build_gets_a_different_folder() {
        let a = install_dir_name(b"one build");
        assert_ne!(a, install_dir_name(b"another build"));
        assert_eq!(
            a,
            install_dir_name(b"one build"),
            "and the same build, the same folder"
        );
        assert!(a.starts_with(&format!("{}-", env!("CARGO_PKG_VERSION"))));
    }

    #[test]
    fn a_host_is_matched_to_the_build_it_needs() {
        assert_eq!(
            triple_for("Linux x86_64"),
            Some("x86_64-unknown-linux-musl")
        );
        assert_eq!(
            triple_for("Linux aarch64"),
            Some("aarch64-unknown-linux-musl")
        );
        assert_eq!(triple_for("Darwin arm64"), Some("aarch64-apple-darwin"));
        assert_eq!(triple_for("Darwin x86_64"), Some("x86_64-apple-darwin"));
        // Something no build exists for is said plainly, never guessed.
        assert_eq!(triple_for("FreeBSD amd64"), None);
        assert_eq!(triple_for(""), None);
    }

    #[tokio::test]
    async fn a_login_banner_before_the_ready_line_is_skipped() {
        let wire = format!(
            "Welcome to the build box!\r\nLast login: yesterday\n{READY_LINE} {PROTOCOL}\nFRAMES"
        );
        let mut reader = wire.as_bytes();
        skip_to_ready(&mut reader).await.unwrap();
        assert_eq!(
            reader, b"FRAMES",
            "the frames after the line are left to read"
        );

        let mut nothing: &[u8] = b"no ready line here\n";
        assert!(skip_to_ready(&mut nothing).await.is_err());
    }
}
