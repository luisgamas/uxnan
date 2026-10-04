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

/// The build of `uxnan-host` a Windows host needs, from its
/// `PROCESSOR_ARCHITECTURE`.
pub fn windows_triple(arch: &str) -> Option<&'static str> {
    match arch.trim().to_ascii_uppercase().as_str() {
        "AMD64" | "X86_64" => Some("x86_64-pc-windows-msvc"),
        "ARM64" => Some("aarch64-pc-windows-msvc"),
        _ => None,
    }
}

/// The line that runs the program at `path` with `arg` in a shell of this
/// family — the engine's own path is the one thing typed into a host's shell,
/// so it is quoted for that shell and never assumed POSIX.
pub fn run_line(shell: ShellKind, path: &str, arg: &str) -> Option<String> {
    match shell {
        ShellKind::Posix => Some(format!("{} {arg}", shellkind::quote_arg(shell, path))),
        // Windows takes either slash, but cmd runs a quoted program path only
        // when it is written its own way.
        ShellKind::Cmd => Some(format!(
            "{} {arg}",
            shellkind::quote_arg(shell, &path.replace('/', "\\"))
        )),
        // A quoted path is a string to PowerShell; `&` runs it.
        ShellKind::PowerShell => Some(format!(
            "& {} {arg}",
            shellkind::quote_arg(shell, &path.replace('/', "\\"))
        )),
        ShellKind::Unknown => None,
    }
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
    // A shell nobody could name gets nothing typed into it.
    if shell == ShellKind::Unknown {
        return Err(AppError::Invalid(
            "could not tell which shell that host runs, so its engine is not started".to_string(),
        ));
    }
    let home = files.home().await.map_err(|e| {
        AppError::Invalid(format!(
            "could not find the home folder on that host: {}",
            failure(e)
        ))
    })?;
    // Which machine it is, asked the way that machine's shell can answer.
    let (asked, triple) = match shell {
        ShellKind::Posix => {
            let uname = conn.exec("uname -sm").await?;
            let said = uname.stdout.trim().to_string();
            let triple = triple_for(&said);
            (said, triple)
        }
        _ => {
            let probe = if shell == ShellKind::Cmd {
                "echo %PROCESSOR_ARCHITECTURE%"
            } else {
                "$env:PROCESSOR_ARCHITECTURE"
            };
            let said = conn.exec(probe).await?.stdout.trim().to_string();
            let triple = windows_triple(&said);
            (format!("Windows {said}"), triple)
        }
    };
    let triple = triple.ok_or_else(|| {
        AppError::Invalid(format!(
            "the host engine is not built for this host ({asked})"
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
    let name = if triple.contains("windows") {
        "uxnan-host.exe"
    } else {
        "uxnan-host"
    };
    let path = format!("{dir}/{name}");

    if runs_here(conn, shell, &path).await {
        return Ok(path);
    }
    // A file there that does not run is a broken copy (an upload cut short):
    // that one is replaced. Otherwise a racing install of the same build wins.
    let broken = files.exists(&path).await.unwrap_or(false);
    files
        .install_executable(&dir, name, &bytes, broken)
        .await
        .map_err(|e| {
            AppError::Invalid(format!(
                "could not put the host engine on that host: {}",
                failure(e)
            ))
        })?;
    if !runs_here(conn, shell, &path).await {
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
async fn runs_here(conn: &Connection, shell: ShellKind, path: &str) -> bool {
    let Some(command) = run_line(shell, path, "version") else {
        return false;
    };
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

fn unexpected(what: &str, reply: &Reply) -> AppError {
    AppError::Invalid(format!("unexpected answer to {what}: {reply:?}"))
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

/// What hears an MCP call from one of this host's terminals:
/// `(ticket, session, body)` — answered with [`HostEngine::answer_mcp`].
/// An MCP call from the host: its ticket, the terminal session it came from,
/// its body, and — for an agent of the host's own bridge, which has no
/// terminal — the conversation's folder as it named it (percent-encoded).
pub type McpFn = Box<dyn Fn(u64, u32, String, Option<String>) + Send + Sync>;
type OnMcp = Arc<std::sync::Mutex<Option<McpFn>>>;

/// What hears a URL one of this host's terminals asked to open:
/// `(session, url)`, the URL as it was given there.
pub type UrlFn = Box<dyn Fn(u32, String) + Send + Sync>;
type OnUrl = Arc<std::sync::Mutex<Option<UrlFn>>>;

/// What hears that the agent running in one of this host's terminals changed:
/// its session, and the agent's command (`None` when it is gone).
pub type AgentFn = Box<dyn Fn(u32, Option<String>) + Send + Sync>;
type OnAgent = Arc<std::sync::Mutex<Option<AgentFn>>>;

/// What a launch on the host needs to reach this app's tools through its
/// engine (`AgentTools`): the facts this app builds that host's launch
/// catalog from, with the same code it uses for its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostTools {
    pub mcp_url: String,
    pub browser_url: String,
    pub token: String,
    /// What the host's own bridge hands its agents (`desktop/attach`): `/mcp`
    /// only. `None` from an engine older than protocol 15.
    pub bridge_token: Option<String>,
    pub browser_shim: Option<String>,
    pub claude_config: Option<String>,
    pub opencode_major: Option<u32>,
}

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
    on_mcp: OnMcp,
    on_url: OnUrl,
    on_agent: OnAgent,
    /// The heartbeat's last round trip, in milliseconds (`u64::MAX`: none yet).
    round_trip: Arc<AtomicU64>,
    /// The host's facts for its launches, asked once per connection.
    tools: tokio::sync::OnceCell<Option<HostTools>>,
    /// Asks the reader and the writer to stop, which closes the channel. A
    /// `watch` rather than a notification: it holds the request, so a task that
    /// was busy when it came still sees it.
    shutdown: tokio::sync::watch::Sender<bool>,
    /// Which connection carries it: a reconnect means a new engine.
    generation: u64,
}

impl HostEngine {
    /// Join the daemon over a new channel on `conn`, starting it if needed.
    pub async fn start(
        conn: &Connection,
        shell: ShellKind,
        path: &str,
    ) -> Result<Arc<HostEngine>, AppError> {
        let command = run_line(shell, path, "attach").ok_or_else(|| {
            AppError::Invalid("could not tell which shell that host runs".to_string())
        })?;
        let (stream, lease) = conn.exec_stream("the host engine", &command).await?;
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
        // The heartbeat's own round trip: which ping is out, when it left, and
        // how long the last one took to come back (`u64::MAX`: not yet).
        let ping_out = Arc::new(AtomicU64::new(0));
        let ping_sent = Arc::new(AtomicU64::new(0));
        let round_trip = Arc::new(AtomicU64::new(u64::MAX));
        let pending: Arc<std::sync::Mutex<HashMap<u64, Pending>>> = Arc::default();
        let sinks: Sinks = Arc::default();
        let on_changed: OnChanged = Arc::default();
        let on_hook: OnHook = Arc::default();
        let on_mcp: OnMcp = Arc::default();
        let on_url: OnUrl = Arc::default();
        let on_agent: OnAgent = Arc::default();

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
        let reader_ping_out = Arc::clone(&ping_out);
        let reader_ping_sent = Arc::clone(&ping_sent);
        let reader_round_trip = Arc::clone(&round_trip);
        let reader_changed = Arc::clone(&on_changed);
        let reader_hook = Arc::clone(&on_hook);
        let reader_mcp = Arc::clone(&on_mcp);
        let reader_url = Arc::clone(&on_url);
        let reader_agent = Arc::clone(&on_agent);
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
                        Ok(ServerMessage::Event(Event::Mcp {
                            ticket,
                            session,
                            body,
                            bridge_cwd,
                        })) => {
                            if let Some(call) = reader_mcp.lock().unwrap().as_ref() {
                                call(ticket, session, body, bridge_cwd);
                            }
                        }
                        Ok(ServerMessage::Event(Event::OpenUrl { session, url })) => {
                            if let Some(open) = reader_url.lock().unwrap().as_ref() {
                                open(session, url);
                            }
                        }
                        Ok(ServerMessage::Event(Event::Agent { session, command })) => {
                            if let Some(heard) = reader_agent.lock().unwrap().as_ref() {
                                heard(session, command);
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
                    Frame::Pong(n) => {
                        if n == reader_ping_out.load(Ordering::SeqCst) {
                            let now = started.elapsed().as_millis() as u64;
                            let sent = reader_ping_sent.load(Ordering::SeqCst);
                            reader_round_trip.store(now.saturating_sub(sent), Ordering::SeqCst);
                        }
                    }
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
        let beat_ping_out = Arc::clone(&ping_out);
        let beat_ping_sent = Arc::clone(&ping_sent);
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
                beat_ping_sent.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                beat_ping_out.store(n, Ordering::SeqCst);
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
            on_mcp,
            on_url,
            on_agent,
            round_trip,
            tools: tokio::sync::OnceCell::new(),
            shutdown,
            generation: conn.generation(),
        }))
    }

    /// How long the last heartbeat took to come back — the link's latency as
    /// it stands, measured with no traffic of its own. `None` until one has.
    pub fn latency_ms(&self) -> Option<u64> {
        let rtt = self.round_trip.load(Ordering::SeqCst);
        (rtt != u64::MAX).then_some(rtt)
    }

    /// What the daemon said about itself when it answered: its build, the
    /// protocol both sides speak, its platform.
    pub fn welcome(&self) -> &Welcome {
        &self.welcome
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
        self.request_within(call, sink_for_open, CALL_TIMEOUT).await
    }

    /// [`Self::request`] with its own deadline — for the few calls that are
    /// slow by nature (an npm install on the host).
    async fn request_within(
        &self,
        call: Call,
        sink_for_open: Option<Sink>,
        deadline: Duration,
    ) -> Result<Reply, AppError> {
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
        match tokio::time::timeout(deadline, rx).await {
            Ok(Ok(Outcome::Ok { reply })) => Ok(reply),
            Ok(Ok(Outcome::Error { code, message })) => Err(match code {
                uxnan_host_protocol::ErrorCode::NotFound => AppError::NotFound(message),
                uxnan_host_protocol::ErrorCode::Invalid => AppError::Invalid(message),
                uxnan_host_protocol::ErrorCode::Git => AppError::Git(message),
                uxnan_host_protocol::ErrorCode::Io => AppError::Io(std::io::Error::other(message)),
                uxnan_host_protocol::ErrorCode::SpawnFailed => AppError::Pty(message),
                uxnan_host_protocol::ErrorCode::Agent => AppError::Agent(message),
                uxnan_host_protocol::ErrorCode::Cancelled => AppError::Cancelled,
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
    /// Watch a running terminal again. `history`: this side starts empty (the
    /// app restarted), so the lines above the screen come too.
    pub async fn attach(
        &self,
        session: u32,
        cols: u16,
        rows: u16,
        history: bool,
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
                    history,
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

    /// Close the agent running in `session` — one of `commands` — and only it,
    /// with the engine's own `agentstop` run there. Answers once it is gone.
    pub async fn stop_agent(
        &self,
        session: u32,
        commands: Vec<String>,
    ) -> Result<uxnan_workspace_engine::agentstop::StopOutcome, AppError> {
        use uxnan_host_protocol::AgentStop;
        use uxnan_workspace_engine::agentstop::StopOutcome;
        if self.welcome.protocol < 5 {
            return Err(AppError::Invalid(
                "the host engine running there is too old to close an agent".to_string(),
            ));
        }
        match self
            .request(Call::StopAgent { session, commands }, None)
            .await?
        {
            Reply::AgentStopped { outcome } => Ok(match outcome {
                AgentStop::NotRunning => StopOutcome::NotRunning,
                AgentStop::Exited => StopOutcome::Exited,
                AgentStop::Killed => StopOutcome::Killed,
            }),
            other => Err(AppError::Invalid(format!(
                "unexpected answer to closing an agent: {other:?}"
            ))),
        }
    }

    /// The last turn's `(prompt, reply)` from a transcript on the host, read
    /// there by the engine's own reader. `(None, None)` from an engine too old
    /// to read one, or when it is not that agent's transcript.
    pub async fn transcript_preview(
        &self,
        agent_type: String,
        path: String,
    ) -> (Option<String>, Option<String>) {
        if self.welcome.protocol < 6 {
            return (None, None);
        }
        match self
            .request(Call::TranscriptPreview { agent_type, path }, None)
            .await
        {
            Ok(Reply::Transcript { prompt, summary }) => (prompt, summary),
            _ => (None, None),
        }
    }

    /// Every agent's hook state on the host, read there by the same installer.
    pub async fn hooks_status(
        &self,
    ) -> Result<Vec<uxnan_workspace_engine::agent_hooks::HookAgentEntry>, AppError> {
        self.needs(8, "list its agents' hooks")?;
        match self.request(Call::HooksStatus, None).await? {
            Reply::Hooks { agents } => serde_json::from_value(agents).map_err(AppError::Serde),
            other => Err(unexpected("hooks status", &other)),
        }
    }

    /// Install (`on`) or remove one agent's reporter on the host.
    pub async fn set_hook(
        &self,
        agent: &str,
        on: bool,
    ) -> Result<uxnan_workspace_engine::agent_hooks::AgentHooksStatus, AppError> {
        self.needs(8, "change its agents' hooks")?;
        match self
            .request(
                Call::SetHook {
                    agent: agent.to_string(),
                    on,
                },
                None,
            )
            .await?
        {
            Reply::Hook { status } => serde_json::from_value(status).map_err(AppError::Serde),
            other => Err(unexpected("a hook change", &other)),
        }
    }

    /// Exactly what the installer writes for one agent on the host.
    pub async fn hook_config(&self, agent: &str) -> Result<String, AppError> {
        self.needs(8, "show its agents' hook configs")?;
        match self
            .request(
                Call::HookConfig {
                    agent: agent.to_string(),
                },
                None,
            )
            .await?
        {
            Reply::Text { text } => Ok(text),
            other => Err(unexpected("a hook config", &other)),
        }
    }

    /// Something done to a project's files on the host, by the engine's own
    /// `fs` there, answered in that module's shapes.
    pub async fn fs<T: serde::de::DeserializeOwned>(
        &self,
        call: uxnan_host_protocol::FsCall,
    ) -> Result<T, AppError> {
        self.needs(9, "serve a project's files")?;
        match self.request(Call::Fs(call), None).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a file call", &other)),
        }
    }

    /// Worktree upkeep in the host's managed roots, by its engine there.
    pub async fn cleanup<T: serde::de::DeserializeOwned>(
        &self,
        call: uxnan_host_protocol::CleanupCall,
    ) -> Result<T, AppError> {
        self.needs(14, "clean up its worktrees")?;
        match self.request(Call::Cleanup(call), None).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a cleanup answer", &other)),
        }
    }

    /// Run an agent CLI headless on the host (`agentrun`, there): the step of
    /// an orchestration, an automation, a commit draft on a host project. The
    /// call lasts as long as the run, plus a margin; without a timeout of its
    /// own it may take hours, as a step can here.
    #[allow(clippy::too_many_arguments)]
    pub async fn agent_run(
        &self,
        agent: &str,
        model: &str,
        prompt: &str,
        cwd: &str,
        timeout_ms: Option<u64>,
        autonomous: bool,
        extra: &[String],
        job: Option<&str>,
        memory_limit_mb: u64,
    ) -> Result<uxnan_workspace_engine::agentrun::HeadlessResult, AppError> {
        self.needs(16, "run an agent headless")?;
        let deadline = Duration::from_millis(timeout_ms.unwrap_or(12 * 60 * 60 * 1000))
            + Duration::from_secs(60);
        let call = Call::AgentRun {
            agent: agent.to_string(),
            model: model.to_string(),
            prompt: prompt.to_string(),
            cwd: cwd.to_string(),
            timeout_ms,
            autonomous,
            extra: extra.to_vec(),
            job: job.map(str::to_string),
            memory_limit_mb,
        };
        match self.request_within(call, None, deadline).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a run's result", &other)),
        }
    }

    /// Run an automation's gate on the host, in `cwd`, in that machine's shell.
    pub async fn precondition(
        &self,
        command: &str,
        timeout_seconds: u32,
        cwd: &str,
    ) -> Result<uxnan_workspace_engine::precondition::PreconditionResult, AppError> {
        self.needs(16, "run an automation's gate")?;
        let deadline = Duration::from_secs(u64::from(timeout_seconds)) + Duration::from_secs(60);
        let call = Call::Precondition {
            command: command.to_string(),
            timeout_seconds,
            cwd: cwd.to_string(),
        };
        match self.request_within(call, None, deadline).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a gate's result", &other)),
        }
    }

    /// End a headless run on the host by its name; whether one was running.
    pub async fn agent_cancel(&self, job: &str) -> Result<bool, AppError> {
        self.needs(16, "cancel a run")?;
        match self
            .request(
                Call::AgentCancel {
                    job: job.to_string(),
                },
                None,
            )
            .await?
        {
            Reply::Value { value } => Ok(value.as_bool().unwrap_or(false)),
            other => Err(unexpected("a cancel answer", &other)),
        }
    }

    /// The host's own bridge (`02g` §5.18): where it stands, installing it,
    /// and whether the engine keeps it running. An install may take minutes.
    pub async fn bridge<T: serde::de::DeserializeOwned>(
        &self,
        call: uxnan_host_protocol::BridgeCall,
    ) -> Result<T, AppError> {
        self.needs(15, "look after a bridge")?;
        let deadline = match call {
            uxnan_host_protocol::BridgeCall::Install => Duration::from_secs(660),
            _ => Duration::from_secs(60),
        };
        match self
            .request_within(Call::Bridge(call), None, deadline)
            .await?
        {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a bridge answer", &other)),
        }
    }

    /// The sub-folders of `path` on the host (its home when `None`), for the
    /// project picker — listed there by its engine.
    pub async fn browse(
        &self,
        path: Option<String>,
    ) -> Result<uxnan_workspace_engine::browse::DirListing, AppError> {
        self.needs(13, "list its folders")?;
        match self.request(Call::Browse { path }, None).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a folder listing", &other)),
        }
    }

    /// The TCP ports the host listens on, read there by its engine.
    pub async fn ports(
        &self,
    ) -> Result<Vec<uxnan_workspace_engine::ports::ListeningPort>, AppError> {
        self.needs(12, "list the ports it listens on")?;
        match self.request(Call::Ports, None).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a port listing", &other)),
        }
    }

    /// Something asked of a project's git on the host, by the engine's own
    /// `git` there, answered in that module's shapes.
    pub async fn git<T: serde::de::DeserializeOwned>(
        &self,
        call: uxnan_host_protocol::GitCall,
    ) -> Result<T, AppError> {
        self.needs(10, "serve a project's git")?;
        match self.request(Call::Git(call), None).await? {
            Reply::Value { value } => serde_json::from_value(value).map_err(AppError::Serde),
            other => Err(unexpected("a git call", &other)),
        }
    }

    fn needs(&self, protocol: u32, what: &str) -> Result<(), AppError> {
        if self.welcome.protocol < protocol {
            return Err(AppError::Invalid(format!(
                "the host engine running there is too old to {what}"
            )));
        }
        Ok(())
    }

    /// Where MCP calls from this host's terminals go.
    pub fn set_on_mcp(&self, call: McpFn) {
        *self.on_mcp.lock().unwrap() = Some(call);
    }

    /// Where URLs this host's terminals ask to open go.
    pub fn set_on_url(&self, open: UrlFn) {
        *self.on_url.lock().unwrap() = Some(open);
    }

    /// Where word of the agent each terminal runs goes ([`watch_agents`]).
    ///
    /// [`watch_agents`]: Self::watch_agents
    pub fn set_on_agent(&self, heard: AgentFn) {
        *self.on_agent.lock().unwrap() = Some(heard);
    }

    /// Ask the engine to say which agent each of its terminals runs — one of
    /// `commands`, the agent CLIs this app knows — as it changes. A newer list
    /// replaces this one. An engine too old to say is left alone: its tabs
    /// simply are not named by what runs in them.
    pub async fn watch_agents(&self, commands: Vec<String>) -> Result<(), AppError> {
        if self.welcome.protocol < 11 {
            return Ok(());
        }
        match self.request(Call::WatchAgents { commands }, None).await? {
            Reply::Done => Ok(()),
            other => Err(unexpected("watching agents", &other)),
        }
    }

    /// Answer an MCP call this engine relayed, with what this app's own MCP
    /// server answered.
    pub async fn answer_mcp(&self, ticket: u64, status: u16, body: String) {
        let _ = self
            .out
            .send(Frame::control(&ClientMessage::McpAnswer {
                ticket,
                status,
                body,
            }))
            .await;
    }

    /// The host's facts for reaching this app's tools from a launch there —
    /// asked once per connection; `None` from an engine too old to relay them
    /// or one that could not say.
    pub async fn agent_tools(&self) -> Option<HostTools> {
        if self.welcome.protocol < 7 {
            return None;
        }
        self.tools
            .get_or_init(|| async {
                match self.request(Call::AgentTools, None).await {
                    Ok(Reply::AgentTools {
                        mcp_url,
                        browser_url,
                        token,
                        bridge_token,
                        browser_shim,
                        claude_config,
                        opencode_major,
                    }) => Some(HostTools {
                        mcp_url,
                        browser_url,
                        token,
                        bridge_token,
                        browser_shim,
                        claude_config,
                        opencode_major,
                    }),
                    _ => None,
                }
            })
            .await
            .clone()
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
        let engine = HostEngine::start(conn, shell, &path).await?;
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

    /// The live engine of `host_id`, if one runs — never started for the ask.
    pub async fn live(&self, host_id: &str) -> Option<Arc<HostEngine>> {
        self.engines
            .lock()
            .await
            .get(host_id)
            .filter(|e| e.is_alive())
            .cloned()
    }

    /// Every live engine, of every connected host.
    pub async fn all(&self) -> Vec<Arc<HostEngine>> {
        self.engines
            .lock()
            .await
            .values()
            .filter(|e| e.is_alive())
            .cloned()
            .collect()
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
    fn a_windows_host_is_matched_by_its_architecture() {
        assert_eq!(windows_triple("AMD64\r\n"), Some("x86_64-pc-windows-msvc"));
        assert_eq!(windows_triple("ARM64"), Some("aarch64-pc-windows-msvc"));
        assert_eq!(windows_triple("x86"), None);
    }

    #[test]
    fn the_engine_is_run_the_way_each_shell_runs_a_program() {
        let unix = "/home/u/.uxnan/host/versions/v/uxnan-host";
        assert_eq!(
            run_line(ShellKind::Posix, unix, "attach").as_deref(),
            Some("'/home/u/.uxnan/host/versions/v/uxnan-host' attach")
        );
        let win = "C:/Users/a b/.uxnan/host/versions/v/uxnan-host.exe";
        assert_eq!(
            run_line(ShellKind::Cmd, win, "version").as_deref(),
            Some(r#""C:\Users\a b\.uxnan\host\versions\v\uxnan-host.exe" version"#)
        );
        assert_eq!(
            run_line(ShellKind::PowerShell, win, "attach").as_deref(),
            Some(r#"& "C:\Users\a b\.uxnan\host\versions\v\uxnan-host.exe" attach"#)
        );
        assert_eq!(run_line(ShellKind::Unknown, win, "attach"), None);
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
