//! The daemon: the host's terminals, served to whoever attaches.
//!
//! A terminal here belongs to the daemon, not to a connection. A client opens
//! one and watches it; when the client goes — on purpose or because the network
//! did — the terminal keeps running and keeps its screen, and the next client to
//! attach is repainted with that screen before live output resumes. Closing a
//! terminal is an explicit call.
//!
//! **Order is the invariant.** A viewer must see the snapshot and then every
//! byte after it, nothing twice and nothing missing. The terminal's reader feeds
//! the screen model and then fans out to viewers *under the same lock*, and
//! attaching takes that lock to cut the snapshot and register the viewer, so
//! there is no gap between the two for output to fall into.
//!
//! **A slow viewer is cut off, never buffered without bound.** Each connection
//! has a bounded queue; one that cannot keep up is closed, and its client
//! reattaches and gets a fresh snapshot — which costs a repaint instead of the
//! daemon's memory.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, Notify};
use uxnan_host_protocol::{
    negotiate, read_frame, write_frame, Call, ClientMessage, ErrorCode, Event, Frame, Outcome,
    Reply, ServerMessage, SessionInfo, Welcome, PROTOCOL,
};
use uxnan_workspace_engine::pty::{PtyManager, PtySpec};
use uxnan_workspace_engine::screen::Screen;

use crate::{log, paths};

/// Frames queued for one connection before it counts as unable to keep up. A
/// terminal chunk is at most a few KiB, so this is a few MiB at worst.
const QUEUE: usize = 2048;

/// How long an ended terminal stays attachable with no one watching, so a
/// client that comes back can still read how it ended.
const EXITED_KEPT: Duration = Duration::from_secs(10 * 60);

/// How often the daemon looks at whether it has anything left to do.
const SWEEP: Duration = Duration::from_secs(15);

/// One connection's way out: its queue, and the switch that closes it.
#[derive(Clone)]
struct Viewer {
    tx: mpsc::Sender<Frame>,
    cut: Arc<Notify>,
    cut_flag: Arc<AtomicBool>,
}

impl Viewer {
    /// Queue a frame, or close the connection if its queue is full.
    fn send(&self, frame: Frame) {
        if self.tx.try_send(frame).is_err() && !self.cut_flag.swap(true, Ordering::SeqCst) {
            self.cut.notify_one();
        }
    }
}

/// What a terminal's reader thread and the daemon both touch.
struct Shared {
    screen: Screen,
    viewers: HashMap<u64, Viewer>,
}

struct Session {
    label: String,
    cwd: String,
    started: Instant,
    pid: Option<u32>,
    shared: Arc<Mutex<Shared>>,
    alive: Arc<AtomicBool>,
    ended_at: Arc<Mutex<Option<Instant>>>,
}

pub struct Daemon {
    engine: PtyManager,
    sessions: Mutex<HashMap<u32, Session>>,
    next_session: AtomicU32,
    next_client: AtomicU64,
    clients: AtomicUsize,
    last_busy: Mutex<Instant>,
    epoch: String,
}

impl Daemon {
    fn new() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        Self {
            engine: PtyManager::default(),
            sessions: Mutex::new(HashMap::new()),
            next_session: AtomicU32::new(1),
            next_client: AtomicU64::new(1),
            clients: AtomicUsize::new(0),
            last_busy: Mutex::new(Instant::now()),
            epoch: format!("{nanos:x}-{:x}", std::process::id()),
        }
    }

    fn touch(&self) {
        *self.last_busy.lock().unwrap() = Instant::now();
    }

    fn welcome(&self, protocol: u32) -> Welcome {
        Welcome {
            protocol,
            version: env!("CARGO_PKG_VERSION").to_string(),
            epoch: self.epoch.clone(),
            pid: std::process::id(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn open(
        &self,
        viewer_id: u64,
        viewer: &Viewer,
        id: u64,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        command: Option<Vec<String>>,
        env: Vec<(String, String)>,
        label: String,
    ) -> Option<Outcome> {
        let session = self.next_session.fetch_add(1, Ordering::SeqCst);
        let shared = Arc::new(Mutex::new(Shared {
            screen: Screen::new(rows, cols),
            viewers: HashMap::new(),
        }));
        let alive = Arc::new(AtomicBool::new(true));
        let ended_at = Arc::new(Mutex::new(None));

        let (shell, args) = match command {
            Some(mut argv) if !argv.is_empty() => {
                let program = argv.remove(0);
                (Some(program), argv)
            }
            _ => (None, Vec::new()),
        };
        let home = paths_home();
        let cwd = cwd.filter(|c| !c.is_empty()).unwrap_or(home);

        // Held across the spawn: the reader thread's first bytes wait for it, so
        // the client hears "opened" (with the id of the request it answers)
        // before any output — and the viewer is registered before that output
        // fans out.
        let mut guard = shared.lock().unwrap();
        let output_shared = Arc::clone(&shared);
        let exit_shared = Arc::clone(&shared);
        let exit_alive = Arc::clone(&alive);
        let exit_ended = Arc::clone(&ended_at);
        let created = self.engine.create(
            PtySpec {
                id: session.to_string(),
                cwd: Some(cwd.clone()),
                shell,
                args,
                env,
                cols,
                rows,
                login: true,
            },
            move |bytes| {
                let mut shared = output_shared.lock().unwrap();
                shared.screen.feed(bytes);
                for viewer in shared.viewers.values() {
                    viewer.send(Frame::Data {
                        session,
                        bytes: bytes.to_vec(),
                    });
                }
            },
            move || {
                exit_alive.store(false, Ordering::SeqCst);
                *exit_ended.lock().unwrap() = Some(Instant::now());
                let shared = exit_shared.lock().unwrap();
                for viewer in shared.viewers.values() {
                    viewer.send(Frame::control(&ServerMessage::Event(Event::Exited {
                        session,
                        code: None,
                    })));
                }
            },
        );
        if let Err(e) = created {
            return Some(Outcome::Error {
                code: ErrorCode::SpawnFailed,
                message: e.to_string(),
            });
        }
        let pid = self.engine.pid_of(&session.to_string());
        viewer.send(Frame::control(&ServerMessage::Response {
            id,
            outcome: Outcome::Ok {
                reply: Reply::Opened { session, pid },
            },
        }));
        guard.viewers.insert(viewer_id, viewer.clone());
        drop(guard);

        self.sessions.lock().unwrap().insert(
            session,
            Session {
                label: label.clone(),
                cwd,
                started: Instant::now(),
                pid,
                shared,
                alive,
                ended_at,
            },
        );
        log::line(&format!("terminal {session} opened ({label})"));
        None
    }

    fn attach(
        &self,
        viewer_id: u64,
        viewer: &Viewer,
        id: u64,
        session: u32,
        cols: u16,
        rows: u16,
    ) -> bool {
        let sessions = self.sessions.lock().unwrap();
        let Some(s) = sessions.get(&session) else {
            return false;
        };
        if s.alive.load(Ordering::SeqCst) {
            let _ = self.engine.resize(&session.to_string(), cols, rows);
        }
        let mut shared = s.shared.lock().unwrap();
        shared.screen.resize(rows, cols);
        viewer.send(Frame::control(&ServerMessage::Response {
            id,
            outcome: Outcome::Ok {
                reply: Reply::Attached {
                    session,
                    alive: s.alive.load(Ordering::SeqCst),
                },
            },
        }));
        viewer.send(Frame::Data {
            session,
            bytes: shared.screen.snapshot(),
        });
        shared.viewers.insert(viewer_id, viewer.clone());
        true
    }

    fn detach_everywhere(&self, viewer_id: u64) {
        for s in self.sessions.lock().unwrap().values() {
            s.shared.lock().unwrap().viewers.remove(&viewer_id);
        }
    }

    fn call(&self, viewer_id: u64, viewer: &Viewer, id: u64, call: Call) -> Option<Outcome> {
        let not_found = |session: u32| Outcome::Error {
            code: ErrorCode::NotFound,
            message: format!("no terminal {session} in this daemon"),
        };
        let done = Outcome::Ok { reply: Reply::Done };
        Some(match call {
            Call::Open {
                cols,
                rows,
                cwd,
                command,
                env,
                label,
            } => {
                // `open` queues its own reply, in order before the first output.
                return self.open(viewer_id, viewer, id, cols, rows, cwd, command, env, label);
            }
            Call::Attach {
                session,
                cols,
                rows,
            } => {
                if self.attach(viewer_id, viewer, id, session, cols, rows) {
                    return None;
                }
                not_found(session)
            }
            Call::Detach { session } => match self.sessions.lock().unwrap().get(&session) {
                Some(s) => {
                    s.shared.lock().unwrap().viewers.remove(&viewer_id);
                    done
                }
                None => not_found(session),
            },
            Call::Resize {
                session,
                cols,
                rows,
            } => match self.sessions.lock().unwrap().get(&session) {
                Some(s) => {
                    if s.alive.load(Ordering::SeqCst) {
                        let _ = self.engine.resize(&session.to_string(), cols, rows);
                    }
                    s.shared.lock().unwrap().screen.resize(rows, cols);
                    done
                }
                None => not_found(session),
            },
            Call::Close { session } => {
                let removed = self.sessions.lock().unwrap().remove(&session);
                match removed {
                    Some(_) => {
                        let _ = self.engine.close(&session.to_string());
                        log::line(&format!("terminal {session} closed"));
                        done
                    }
                    None => not_found(session),
                }
            }
            // Per connection, handled where the connection lives.
            Call::Watch { .. } | Call::Unwatch => Outcome::Error {
                code: ErrorCode::Invalid,
                message: "watching is per connection".to_string(),
            },
            Call::List => {
                let sessions = self.sessions.lock().unwrap();
                let mut list: Vec<SessionInfo> = sessions
                    .iter()
                    .map(|(id, s)| SessionInfo {
                        session: *id,
                        label: s.label.clone(),
                        cwd: s.cwd.clone(),
                        pid: s.pid,
                        alive: s.alive.load(Ordering::SeqCst),
                        started_ago_ms: s.started.elapsed().as_millis() as u64,
                        viewers: s.shared.lock().unwrap().viewers.len() as u32,
                    })
                    .collect();
                list.sort_by_key(|s| s.session);
                Outcome::Ok {
                    reply: Reply::Sessions { sessions: list },
                }
            }
        })
    }

    /// Drop terminals that ended long enough ago with nobody watching, and say
    /// whether the daemon has anything left to live for.
    fn sweep(&self, idle: Duration) -> bool {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|id, s| {
            let ended = *s.ended_at.lock().unwrap();
            let watched = !s.shared.lock().unwrap().viewers.is_empty();
            let keep = watched || ended.is_none_or(|t| t.elapsed() < EXITED_KEPT);
            if !keep {
                log::line(&format!("terminal {id} forgotten after it ended"));
                let _ = self.engine.close(&id.to_string());
            }
            keep
        });
        let busy = self.clients.load(Ordering::SeqCst) > 0
            || sessions.values().any(|s| s.alive.load(Ordering::SeqCst));
        drop(sessions);
        if busy {
            self.touch();
            return true;
        }
        self.last_busy.lock().unwrap().elapsed() < idle
    }
}

fn paths_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

/// Leave the SSH session that started us: a new session (so its hang-up does
/// not reach us), SIGHUP ignored, a private umask.
pub fn detach_from_session() {
    #[cfg(unix)]
    unsafe {
        // SAFETY: plain libc calls on our own process, before any thread
        // exists; failure leaves us attached, which `attach` notices.
        libc::setsid();
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
        libc::umask(0o077);
    }
}

/// Be the daemon until there is nothing left to do.
pub async fn serve(idle: Duration) -> std::io::Result<()> {
    paths::ensure_private_dir(&paths::run_dir())?;
    let listener = bind().await?;
    let ours = socket_identity();
    let daemon = Arc::new(Daemon::new());
    log::line(&format!(
        "daemon {} started (protocol {PROTOCOL}, epoch {})",
        env!("CARGO_PKG_VERSION"),
        daemon.epoch
    ));

    let sweeper = Arc::clone(&daemon);
    let mut ticks = tokio::time::interval(SWEEP.min(idle.max(Duration::from_secs(1))));
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let daemon = Arc::clone(&daemon);
                tokio::spawn(async move { serve_client(daemon, stream).await });
            }
            _ = ticks.tick() => {
                if !sweeper.sweep(idle) {
                    log::line("nothing left to do; exiting");
                    // Only our own socket. A daemon that was frozen long enough
                    // to be replaced must not, on waking, take away the socket
                    // of the one that replaced it.
                    if socket_identity().is_some() && socket_identity() == ours {
                        let _ = std::fs::remove_file(paths::socket());
                    }
                    return Ok(());
                }
            }
        }
    }
}

/// The id of a request this build cannot read, if it is a request at all.
fn unknown_request_id(json: &[u8]) -> Option<u64> {
    let v: serde_json::Value = serde_json::from_slice(json).ok()?;
    (v.get("type")?.as_str()? == "request").then(|| v.get("id")?.as_u64())?
}

/// Which file is at the socket's path (device and inode), to tell our socket
/// from one another daemon put there.
#[cfg(unix)]
fn socket_identity() -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(paths::socket())
        .ok()
        .map(|m| (m.dev(), m.ino()))
}

#[cfg(not(unix))]
fn socket_identity() -> Option<(u64, u64)> {
    None
}

#[cfg(unix)]
async fn bind() -> std::io::Result<tokio::net::UnixListener> {
    let path = paths::socket();
    match tokio::net::UnixListener::bind(&path) {
        Ok(listener) => Ok(listener),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            // Something is at the socket's path. Never remove it blindly: a
            // live daemon there holds terminals. Ask it first.
            if tokio::net::UnixStream::connect(&path).await.is_ok() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "a daemon is already serving this socket",
                ));
            }
            // Nobody answers: a daemon that died without cleaning up.
            std::fs::remove_file(&path)?;
            tokio::net::UnixListener::bind(&path)
        }
        Err(e) => Err(e),
    }
}

#[cfg(not(unix))]
async fn bind() -> std::io::Result<NeverListener> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "this build of uxnan-host does not serve Windows hosts yet",
    ))
}

#[cfg(not(unix))]
struct NeverListener;

#[cfg(not(unix))]
impl NeverListener {
    async fn accept(&self) -> std::io::Result<(tokio::io::DuplexStream, ())> {
        std::future::pending().await
    }
}

async fn serve_client<S>(daemon: Arc<Daemon>, stream: S)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::channel::<Frame>(QUEUE);
    let viewer = Viewer {
        tx,
        cut: Arc::new(Notify::new()),
        cut_flag: Arc::new(AtomicBool::new(false)),
    };
    let viewer_id = daemon.next_client.fetch_add(1, Ordering::SeqCst);

    let writing = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            if write_frame(&mut writer, &frame).await.is_err() {
                break;
            }
        }
    });

    // The hello, or nothing.
    let accepted = match read_frame(&mut reader).await {
        Ok(Some(Frame::Control(json))) => match serde_json::from_slice::<ClientMessage>(&json) {
            Ok(ClientMessage::Hello {
                protocol_min,
                protocol,
                client,
            }) => match negotiate(protocol_min, protocol) {
                Some(v) => {
                    viewer.send(Frame::control(&ServerMessage::Welcome(daemon.welcome(v))));
                    log::line(&format!("client {viewer_id} ({client}) attached"));
                    true
                }
                None => {
                    viewer.send(Frame::control(&ServerMessage::Refused {
                        reason: format!(
                            "this daemon speaks protocol {}..={PROTOCOL}; the client speaks {protocol_min}..={protocol}",
                            uxnan_host_protocol::PROTOCOL_MIN
                        ),
                    }));
                    false
                }
            },
            _ => false,
        },
        _ => false,
    };

    if accepted {
        daemon.clients.fetch_add(1, Ordering::SeqCst);
        // This connection's folder watch, if it asked for one. Dropped with
        // the connection, which stops its thread.
        let mut watch: Option<uxnan_workspace_engine::watch::Watch> = None;
        loop {
            tokio::select! {
                frame = read_frame(&mut reader) => match frame {
                    Ok(Some(Frame::Control(json))) => {
                        match serde_json::from_slice::<ClientMessage>(&json) {
                            Ok(ClientMessage::Request { id, call: Call::Watch { root } }) => {
                                watch = None;
                                let reporter = viewer.clone();
                                let watched = root.clone();
                                let outcome = match uxnan_workspace_engine::watch::start(&root, move |batch| {
                                    reporter.send(Frame::control(&ServerMessage::Event(Event::Changed {
                                        root: watched.clone(),
                                        paths: batch.paths,
                                        overflow: batch.overflow,
                                        git: batch.git,
                                    })));
                                }) {
                                    Ok(w) => {
                                        watch = Some(w);
                                        Outcome::Ok { reply: Reply::Done }
                                    }
                                    Err(e) => Outcome::Error {
                                        code: ErrorCode::Invalid,
                                        message: format!("could not watch {root}: {e}"),
                                    },
                                };
                                viewer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                            }
                            Ok(ClientMessage::Request { id, call: Call::Unwatch }) => {
                                watch = None;
                                viewer.send(Frame::control(&ServerMessage::Response {
                                    id,
                                    outcome: Outcome::Ok { reply: Reply::Done },
                                }));
                            }
                            Ok(ClientMessage::Request { id, call }) => {
                                if let Some(outcome) = daemon.call(viewer_id, &viewer, id, call) {
                                    viewer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                }
                            }
                            // A call this daemon does not know — a newer client
                            // asking for something added after it was built —
                            // is answered, never a reason to hang up: the
                            // terminals on this connection have nothing to do
                            // with it.
                            _ => match unknown_request_id(&json) {
                                Some(id) => viewer.send(Frame::control(&ServerMessage::Response {
                                    id,
                                    outcome: Outcome::Error {
                                        code: ErrorCode::Invalid,
                                        message: "this host engine does not know that call".to_string(),
                                    },
                                })),
                                None => break,
                            },
                        }
                    }
                    Ok(Some(Frame::Data { session, bytes })) => {
                        let _ = daemon.engine.write_bytes(&session.to_string(), &bytes);
                    }
                    Ok(Some(Frame::Ping(n))) => viewer.send(Frame::Pong(n)),
                    Ok(Some(Frame::Pong(_))) => {}
                    Ok(None) | Err(_) => break,
                },
                _ = viewer.cut.notified() => {
                    log::line(&format!("client {viewer_id} could not keep up; closed"));
                    break;
                }
            }
        }
        drop(watch);
        daemon.detach_everywhere(viewer_id);
        daemon.clients.fetch_sub(1, Ordering::SeqCst);
        daemon.touch();
        log::line(&format!("client {viewer_id} detached"));
    }
    drop(viewer);
    let _ = writing.await;
}
