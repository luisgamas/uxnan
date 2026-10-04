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
//!
//! **An agent's report goes to its own terminal's viewers.** Every terminal is
//! started with the daemon's hook coordinates (`endpoint`) and the id its client
//! gave it (`UXNAN_AGENT_ID`); a report naming that id is sent to whoever is
//! watching that terminal — never to another client's — and held, bounded,
//! while nobody is, so a laptop that slept still hears how the turn ended.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, Notify};
use uxnan_host_protocol::{
    negotiate, read_frame, write_frame, AgentStop, Call, ClientMessage, ErrorCode, Event, Frame,
    Outcome, Reply, ServerMessage, SessionInfo, Welcome, PROTOCOL,
};
use uxnan_workspace_engine::procscan;
use uxnan_workspace_engine::pty::{PtyManager, PtySpec};
use uxnan_workspace_engine::screen::Screen;

use crate::endpoint::{Answer, Incoming, Route};
use crate::{log, paths};

/// Frames queued for one connection before it counts as unable to keep up. A
/// terminal chunk is at most a few KiB, so this is a few MiB at worst.
const QUEUE: usize = 2048;

/// How long an ended terminal stays attachable with no one watching, so a
/// client that comes back can still read how it ended.
const EXITED_KEPT: Duration = Duration::from_secs(10 * 60);

/// How often the daemon looks at whether it has anything left to do.
const SWEEP: Duration = Duration::from_secs(15);

/// The largest piece a screen snapshot is sent in. With its history a snapshot
/// can outgrow a frame; the viewer applies the pieces in order.
const SNAPSHOT_PIECE: usize = 64 * 1024;

/// How long an MCP call from a terminal here waits for the app's answer. A
/// tool can take a while (waiting on a page, on an agent); past this the
/// caller is told the app did not answer.
const MCP_WAIT: Duration = Duration::from_secs(300);

/// How often the process table is read for the agent each terminal runs —
/// the app's own pace for its terminals here.
const AGENT_SCAN: Duration = Duration::from_secs(2);

/// Reports held for a terminal nobody is watching. The newest matter — they
/// are the agent's state now — so the oldest go first.
const HELD_REPORTS: usize = 64;

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
    /// Agent reports that arrived while nobody was watching.
    held: VecDeque<Frame>,
    /// The agent this terminal runs, as last seen ([`Daemon::scan_agents`]).
    agent: Option<String>,
}

struct Session {
    /// The id the client gave this terminal (`UXNAN_AGENT_ID`), which its
    /// agent's reports carry back.
    agent_id: Option<String>,
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
    /// Where this daemon's terminals reach the app, once its listener is up.
    hooks: OnceLock<crate::endpoint::Endpoint>,
    /// MCP calls waiting for the app's answer: ticket → the connection it was
    /// sent to, and where the answer goes.
    mcp_waiting: Mutex<HashMap<u64, (u64, tokio::sync::oneshot::Sender<Answer>)>>,
    next_ticket: AtomicU64,
    /// The agent CLIs a client asked to be told about (`WatchAgents`); empty
    /// means nobody asked, and the process table is left alone.
    agent_commands: Mutex<Vec<String>>,
    /// This machine's own bridge, kept running while asked (`bridge`).
    bridge: crate::bridge::Supervisor,
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
            hooks: OnceLock::new(),
            mcp_waiting: Mutex::new(HashMap::new()),
            next_ticket: AtomicU64::new(1),
            agent_commands: Mutex::new(Vec::new()),
            bridge: crate::bridge::Supervisor::default(),
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
            held: VecDeque::new(),
            agent: None,
        }));
        let alive = Arc::new(AtomicBool::new(true));
        let ended_at = Arc::new(Mutex::new(None));

        let (shell, args) = match command {
            Some(mut argv) if !argv.is_empty() => {
                let program = argv.remove(0);
                (Some(program), argv)
            }
            // What an SSH login here starts (`login_shell`): on a Windows host
            // whose owner set `DefaultShell`, that shell — not `cmd`.
            _ => (crate::login_shell(), Vec::new()),
        };
        let home = crate::paths_home();
        let cwd = cwd.filter(|c| !c.is_empty()).unwrap_or(home);
        let agent_id = env
            .iter()
            .rev()
            .find(|(k, _)| k == "UXNAN_AGENT_ID")
            .map(|(_, v)| v.clone())
            .filter(|v| !v.trim().is_empty());
        // The client's variables, then this machine's hook coordinates — last,
        // so they win: a URL from the client's machine names a port that
        // means nothing here.
        let mut env = env;
        if let Some(hooks) = self.hooks.get() {
            env.extend(hooks.env());
        }

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
                agent_id,
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

    #[allow(clippy::too_many_arguments)]
    fn attach(
        &self,
        viewer_id: u64,
        viewer: &Viewer,
        id: u64,
        session: u32,
        cols: u16,
        rows: u16,
        history: bool,
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
        for piece in shared.screen.snapshot(history).chunks(SNAPSHOT_PIECE) {
            viewer.send(Frame::Data {
                session,
                bytes: piece.to_vec(),
            });
        }
        // What the agent said while nobody was watching, after the screen
        // that shows where it got to.
        for report in shared.held.drain(..) {
            viewer.send(report);
        }
        // And which agent it is: a tab that comes back names it at once
        // instead of on the next change.
        if let Some(command) = shared.agent.clone() {
            viewer.send(Frame::control(&ServerMessage::Event(Event::Agent {
                session,
                command: Some(command),
            })));
        }
        shared.viewers.insert(viewer_id, viewer.clone());
        true
    }

    /// Where this daemon's live terminals stand — what the cleanup must never
    /// take away from under them.
    fn terminal_folders(&self) -> Vec<String> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter(|s| s.alive.load(Ordering::SeqCst))
            .map(|s| s.cwd.clone())
            .collect()
    }

    /// The terminals to look at for agents, and the commands to look for —
    /// `None` when there is nobody to tell or nothing to look for, so an idle
    /// host's process table is never walked.
    #[allow(clippy::type_complexity)]
    fn agent_targets(&self) -> Option<(Vec<String>, Vec<(u32, u32, Arc<Mutex<Shared>>)>)> {
        if self.clients.load(Ordering::SeqCst) == 0 {
            return None;
        }
        let commands = self.agent_commands.lock().unwrap().clone();
        if commands.is_empty() {
            return None;
        }
        let targets: Vec<_> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.alive.load(Ordering::SeqCst))
            .filter_map(|(id, s)| s.pid.map(|pid| (*id, pid, Arc::clone(&s.shared))))
            .collect();
        (!targets.is_empty()).then_some((commands, targets))
    }

    /// One look at the process table: each terminal whose agent changed says
    /// so to its viewers. A terminal nobody watches still keeps what it runs,
    /// for the viewer that attaches.
    async fn scan_agents(&self, table: &mut Option<procscan::Table>) {
        let Some((commands, targets)) = self.agent_targets() else {
            return;
        };
        let mut owned = table.take().unwrap_or_default();
        owned = match tokio::task::spawn_blocking(move || {
            owned.refresh();
            owned
        })
        .await
        {
            Ok(refreshed) => refreshed,
            Err(_) => return,
        };
        for (session, pid, shared) in targets {
            let command = owned.agent_of(pid, &commands);
            let mut shared = shared.lock().unwrap();
            if shared.agent == command {
                continue;
            }
            shared.agent = command.clone();
            let frame = Frame::control(&ServerMessage::Event(Event::Agent { session, command }));
            for viewer in shared.viewers.values() {
                viewer.send(frame.clone());
            }
        }
        *table = Some(owned);
    }

    /// Answer a request from a terminal here (`endpoint`): a report goes to
    /// the terminal's viewers, a URL to one of them, an MCP call to one of them
    /// and back. A request naming no terminal of this daemon is refused: nobody
    /// here could take it.
    pub async fn answer(&self, incoming: Incoming) -> Answer {
        match incoming.route {
            Route::Hook => {
                self.report(incoming);
                Answer::empty(204)
            }
            Route::Browser => self.open_url(incoming),
            Route::Mcp => self.relay_mcp(incoming).await,
        }
    }

    /// The terminal a request names, and its shared state.
    fn session_of(&self, incoming: &Incoming) -> Option<(u32, Arc<Mutex<Shared>>)> {
        let agent_id = incoming.agent_id()?;
        let sessions = self.sessions.lock().unwrap();
        sessions
            .iter()
            .find(|(_, s)| s.agent_id.as_deref() == Some(agent_id.as_str()))
            .map(|(&session, s)| (session, Arc::clone(&s.shared)))
    }

    /// One connection watching `shared`, if any.
    fn a_viewer_of(shared: &Mutex<Shared>) -> Option<(u64, Viewer)> {
        let shared = shared.lock().unwrap();
        shared.viewers.iter().next().map(|(id, v)| (*id, v.clone()))
    }

    fn open_url(&self, incoming: Incoming) -> Answer {
        let Some((session, shared)) = self.session_of(&incoming) else {
            return Answer::empty(404);
        };
        let Some(url) = serde_json::from_str::<serde_json::Value>(&incoming.body)
            .ok()
            .and_then(|v| v.get("url")?.as_str().map(str::to_string))
            .filter(|u| !u.trim().is_empty())
        else {
            return Answer::empty(400);
        };
        // A URL is worth opening only while someone is looking; one asked for
        // while the lid was closed would open at a random moment later.
        let Some((_, viewer)) = Self::a_viewer_of(&shared) else {
            return Answer::empty(503);
        };
        viewer.send(Frame::control(&ServerMessage::Event(Event::OpenUrl {
            session,
            url,
        })));
        Answer::empty(204)
    }

    async fn relay_mcp(&self, incoming: Incoming) -> Answer {
        let Some((session, shared)) = self.session_of(&incoming) else {
            return Answer::empty(404);
        };
        let Some((viewer_id, viewer)) = Self::a_viewer_of(&shared) else {
            return Answer::empty(503);
        };
        let ticket = self.next_ticket.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.mcp_waiting
            .lock()
            .unwrap()
            .insert(ticket, (viewer_id, tx));
        viewer.send(Frame::control(&ServerMessage::Event(Event::Mcp {
            ticket,
            session,
            body: incoming.body,
        })));
        let answered = tokio::time::timeout(MCP_WAIT, rx).await;
        self.mcp_waiting.lock().unwrap().remove(&ticket);
        match answered {
            Ok(Ok(answer)) => answer,
            // The connection went before answering.
            Ok(Err(_)) => Answer::empty(502),
            Err(_) => Answer::empty(504),
        }
    }

    /// The app's answer to an MCP call it was sent.
    fn mcp_answered(&self, ticket: u64, status: u16, body: String) {
        if let Some((_, tx)) = self.mcp_waiting.lock().unwrap().remove(&ticket) {
            let _ = tx.send(Answer { status, body });
        }
    }

    /// A connection that ends leaves no call waiting on it.
    fn forget_mcp_of(&self, viewer_id: u64) {
        self.mcp_waiting
            .lock()
            .unwrap()
            .retain(|_, (viewer, _)| *viewer != viewer_id);
    }

    /// Route an agent's report to the terminal it came from. A report naming
    /// no terminal of this daemon is dropped: nobody here could show it.
    pub fn report(&self, report: Incoming) {
        let Some((session, shared)) = self.session_of(&report) else {
            return;
        };
        let frame = Frame::control(&ServerMessage::Event(Event::Hook {
            session,
            headers: report.headers,
            body: report.body,
        }));
        let mut shared = shared.lock().unwrap();
        if shared.viewers.is_empty() {
            if shared.held.len() == HELD_REPORTS {
                shared.held.pop_front();
            }
            shared.held.push_back(frame);
        } else {
            for viewer in shared.viewers.values() {
                viewer.send(frame.clone());
            }
        }
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
                history,
            } => {
                if self.attach(viewer_id, viewer, id, session, cols, rows, history) {
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
            // Handled where the connection lives: a watch is per connection,
            // and wiring blocks on files and a login shell.
            Call::Watch { .. }
            | Call::Unwatch
            | Call::WireHooks
            | Call::StopAgent { .. }
            | Call::TranscriptPreview { .. }
            | Call::AgentTools
            | Call::HooksStatus
            | Call::SetHook { .. }
            | Call::HookConfig { .. }
            | Call::Fs(_)
            | Call::Git(_)
            | Call::Ports
            | Call::Browse { .. }
            | Call::Cleanup(_)
            | Call::Bridge(_) => Outcome::Error {
                code: ErrorCode::Invalid,
                message: "handled by the connection".to_string(),
            },
            Call::WatchAgents { commands } => {
                *self.agent_commands.lock().unwrap() = commands;
                Outcome::Ok { reply: Reply::Done }
            }
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
        // Keeping the bridge running is a reason to live: it is what serves
        // the phone and the chats while nobody is connected.
        let busy = self.clients.load(Ordering::SeqCst) > 0
            || self.bridge.busy()
            || sessions.values().any(|s| s.alive.load(Ordering::SeqCst));
        drop(sessions);
        if busy {
            self.touch();
            return true;
        }
        self.last_busy.lock().unwrap().elapsed() < idle
    }
}

/// Leave the SSH session that started us: a new session (so its hang-up does
/// not reach us), SIGHUP ignored.
///
/// On Windows the leaving is done at creation (`attach`: detached, its own
/// process group, out of the session's job). What is done here is undoing the
/// one thing a new process group carries with it: **Ctrl+C ignored**, a flag
/// every process it starts inherits. Left alone, Ctrl+C in a host terminal
/// interrupted nothing — not a dev server, not a command, not an agent. The
/// daemon has no console, so it receives no Ctrl+C itself either way.
///
/// The umask is left as the account has it. Every terminal inherits this
/// process's, and a file made in one must come out as it would in any SSH
/// session; the daemon's own files get their modes explicitly instead
/// (`paths::ensure_private_dir`, the log, the endpoint file).
pub fn detach_from_session() {
    #[cfg(unix)]
    unsafe {
        // SAFETY: plain libc calls on our own process, before any thread
        // exists; failure leaves us attached, which `attach` notices.
        libc::setsid();
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
    }
    #[cfg(windows)]
    unsafe {
        // SAFETY: a documented call on our own process. A null handler with
        // FALSE restores normal Ctrl+C processing, and that is inherited by
        // the terminals this daemon starts.
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
    }
}

/// Be the daemon until there is nothing left to do.
pub async fn serve(idle: Duration) -> std::io::Result<()> {
    paths::ensure_private_dir(&paths::home())?;
    paths::ensure_private_dir(&paths::run_dir())?;
    let listener = bind().await?;
    let ours = socket_identity();
    // The daemon of record now: this build is in use while it lives, and the
    // builds nothing runs any more can go.
    let _in_use = crate::versions::hold();
    let swept = tokio::task::spawn_blocking(|| crate::versions::sweep(crate::versions::MIN_AGE));
    tokio::spawn(async move {
        if let Ok(removed) = swept.await {
            if !removed.is_empty() {
                log::line(&format!("removed old builds: {}", removed.join(", ")));
            }
        }
    });
    let daemon = Arc::new(Daemon::new());
    tokio::spawn(crate::cleanup::sweep_leftovers());
    // The bridge it was keeping before it last exited (or the machine
    // rebooted and a client brought it back).
    daemon.bridge.resume();
    log::line(&format!(
        "daemon {} started (protocol {PROTOCOL}, epoch {})",
        env!("CARGO_PKG_VERSION"),
        daemon.epoch
    ));
    // Before any terminal opens, so every one is started with it. Without it
    // the terminals still work; their agents just cannot say what they do.
    let routed = Arc::clone(&daemon);
    let handler: crate::endpoint::Handler = Arc::new(move |incoming| {
        let daemon = Arc::clone(&routed);
        Box::pin(async move { daemon.answer(incoming).await })
    });
    match crate::endpoint::start(handler).await {
        Ok(endpoint) => {
            let _ = daemon.hooks.set(endpoint);
        }
        Err(e) => log::line(&format!("agent reports unavailable: {e}")),
    }

    // Which agent each terminal runs, looked at every two seconds — only while
    // a client is connected and has said what to look for.
    let scanner = Arc::clone(&daemon);
    tokio::spawn(async move {
        let mut table = None;
        let mut every = tokio::time::interval(AGENT_SCAN);
        every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            every.tick().await;
            scanner.scan_agents(&mut table).await;
        }
    });

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

/// Close the agent in terminal `session` (whose shell is `shell`) with the
/// engine's own `agentstop`, the code the desktop runs on its own terminals.
async fn stop_agent_in(session: u32, shell: u32, commands: Vec<String>) -> Outcome {
    use uxnan_workspace_engine::agentstop::{stop_agent, StopOutcome, EXIT_GRACE};
    match tokio::task::spawn_blocking(move || stop_agent(shell, &commands, EXIT_GRACE)).await {
        Ok(done) => {
            let outcome = match done {
                StopOutcome::NotRunning => AgentStop::NotRunning,
                StopOutcome::Exited => AgentStop::Exited,
                StopOutcome::Killed => AgentStop::Killed,
            };
            log::line(&format!("terminal {session}: agent stop {outcome:?}"));
            Outcome::Ok {
                reply: Reply::AgentStopped { outcome },
            }
        }
        Err(e) => Outcome::Error {
            code: ErrorCode::Invalid,
            message: e.to_string(),
        },
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

/// On Windows the daemon's channel is a named pipe whose access list names the
/// user alone (the one the app's discovery file gets), refusing remote
/// clients. The first instance is created with `FIRST_PIPE_INSTANCE`, so a
/// second daemon finds the name taken instead of serving beside the first;
/// each accepted client is handed its instance and a new one is made for the
/// next. A pipe disappears with its process, so there is never a stale one.
#[cfg(windows)]
async fn bind() -> std::io::Result<PipeListener> {
    PipeListener::new()
}

#[cfg(windows)]
struct PipeListener {
    name: String,
    next: tokio::sync::Mutex<tokio::net::windows::named_pipe::NamedPipeServer>,
    /// The descriptor every instance is created with, and the list it names.
    descriptor: Box<windows_sys::Win32::Security::SECURITY_DESCRIPTOR>,
    _dacl: uxnan_control_protocol::private::UserOnlyDacl,
}

#[cfg(windows)]
impl PipeListener {
    fn new() -> std::io::Result<Self> {
        use windows_sys::Win32::Security::{
            InitializeSecurityDescriptor, SetSecurityDescriptorDacl, PSECURITY_DESCRIPTOR,
        };
        const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
        let dacl = uxnan_control_protocol::private::UserOnlyDacl::new()?;
        // SAFETY: a zeroed descriptor initialised in place, then given the
        // list this value keeps alive alongside it.
        let mut descriptor: Box<windows_sys::Win32::Security::SECURITY_DESCRIPTOR> =
            Box::new(unsafe { std::mem::zeroed() });
        let pointer = &mut *descriptor as *mut _ as PSECURITY_DESCRIPTOR;
        unsafe {
            if InitializeSecurityDescriptor(pointer, SECURITY_DESCRIPTOR_REVISION) == 0
                || SetSecurityDescriptorDacl(pointer, 1, dacl.as_ptr(), 0) == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        let name = paths::pipe_name();
        let first = Self::instance(&name, pointer, true).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "a daemon is already serving this pipe",
                )
            } else {
                e
            }
        })?;
        Ok(Self {
            name,
            next: tokio::sync::Mutex::new(first),
            descriptor,
            _dacl: dacl,
        })
    }

    /// `descriptor` is only read by the call (the pipe keeps its own copy).
    fn instance(
        name: &str,
        descriptor: *mut std::ffi::c_void,
        first: bool,
    ) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
        use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        // SAFETY: the attributes and the descriptor they point to outlive the
        // call; the pipe keeps its own copy of the security it was given.
        unsafe {
            tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    name,
                    &mut attributes as *mut _ as *mut std::ffi::c_void,
                )
        }
    }

    async fn accept(
        &self,
    ) -> std::io::Result<(tokio::net::windows::named_pipe::NamedPipeServer, ())> {
        let mut next = self.next.lock().await;
        next.connect().await?;
        let descriptor = &*self.descriptor as *const _ as *mut std::ffi::c_void;
        let fresh = Self::instance(&self.name, descriptor, false)?;
        Ok((std::mem::replace(&mut *next, fresh), ()))
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
                            Ok(ClientMessage::Request { id, call: Call::Fs(call) }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let outcome = crate::files::serve(call).await;
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::Browse { path } }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let found = uxnan_workspace_engine::browse::browse_dirs(path)
                                        .await
                                        .map(uxnan_workspace_engine::browse::DirListing::forward_slashed)
                                        .and_then(crate::files::value);
                                    let outcome = crate::files::outcome(found);
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::Cleanup(call) }) => {
                                let answer = viewer.clone();
                                let busy = daemon.terminal_folders();
                                tokio::spawn(async move {
                                    let outcome = crate::cleanup::serve(call, busy).await;
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::Bridge(call) }) => {
                                let answer = viewer.clone();
                                let bridge = daemon.bridge.clone();
                                tokio::spawn(async move {
                                    let outcome = crate::bridge::serve(&bridge, call).await;
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::Ports }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let found = uxnan_workspace_engine::ports::listening()
                                        .await
                                        .and_then(crate::files::value);
                                    let outcome = crate::files::outcome(found);
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::Git(call) }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let outcome = crate::repo::serve(call).await;
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::McpAnswer { ticket, status, body }) => {
                                daemon.mcp_answered(ticket, status, body);
                            }
                            Ok(ClientMessage::Request { id, call: Call::AgentTools }) => {
                                let answer = viewer.clone();
                                let endpoint = daemon.hooks.get().cloned();
                                tokio::spawn(async move {
                                    let outcome = match endpoint {
                                        None => Outcome::Error {
                                            code: ErrorCode::Invalid,
                                            message: "this daemon's endpoint is not listening".to_string(),
                                        },
                                        Some(endpoint) => match tokio::task::spawn_blocking(move || crate::agents::tools(&endpoint)).await {
                                            Ok(reply) => Outcome::Ok { reply },
                                            Err(e) => Outcome::Error { code: ErrorCode::Invalid, message: e.to_string() },
                                        },
                                    };
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: call @ (Call::HooksStatus | Call::SetHook { .. } | Call::HookConfig { .. }) }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    // Files and a login shell: off the connection.
                                    let done = tokio::task::spawn_blocking(move || match call {
                                        Call::HooksStatus => Ok(Reply::Hooks { agents: crate::agents::status() }),
                                        Call::SetHook { agent, on } => {
                                            crate::agents::set(&agent, on).map(|status| Reply::Hook { status })
                                        }
                                        Call::HookConfig { agent } => {
                                            crate::agents::config(&agent).map(|text| Reply::Text { text })
                                        }
                                        _ => Err("not a hook call".to_string()),
                                    })
                                    .await;
                                    let outcome = match done {
                                        Ok(Ok(reply)) => Outcome::Ok { reply },
                                        Ok(Err(message)) => Outcome::Error { code: ErrorCode::Invalid, message },
                                        Err(e) => Outcome::Error { code: ErrorCode::Invalid, message: e.to_string() },
                                    };
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::WireHooks }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let outcome = match tokio::task::spawn_blocking(crate::agents::wire).await {
                                        Ok(Ok(agents)) => {
                                            log::line(&format!("agent reporters wired: {}", agents.join(", ")));
                                            Outcome::Ok { reply: Reply::HooksWired { agents } }
                                        }
                                        Ok(Err(e)) => Outcome::Error { code: ErrorCode::Invalid, message: e },
                                        Err(e) => Outcome::Error { code: ErrorCode::Invalid, message: e.to_string() },
                                    };
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::StopAgent { session, commands } }) => {
                                let answer = viewer.clone();
                                let shell = daemon.engine.pid_of(&session.to_string());
                                tokio::spawn(async move {
                                    let outcome = match shell {
                                        None => Outcome::Error {
                                            code: ErrorCode::NotFound,
                                            message: format!("no running terminal {session} in this daemon"),
                                        },
                                        Some(pid) => stop_agent_in(session, pid, commands).await,
                                    };
                                    answer.send(Frame::control(&ServerMessage::Response { id, outcome }));
                                });
                            }
                            Ok(ClientMessage::Request { id, call: Call::TranscriptPreview { agent_type, path } }) => {
                                let answer = viewer.clone();
                                tokio::spawn(async move {
                                    let read = tokio::task::spawn_blocking(move || {
                                        uxnan_workspace_engine::transcript::preview(&agent_type, &path)
                                    })
                                    .await
                                    .unwrap_or((None, None));
                                    answer.send(Frame::control(&ServerMessage::Response {
                                        id,
                                        outcome: Outcome::Ok { reply: Reply::Transcript { prompt: read.0, summary: read.1 } },
                                    }));
                                });
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
        daemon.forget_mcp_of(viewer_id);
        daemon.detach_everywhere(viewer_id);
        daemon.clients.fetch_sub(1, Ordering::SeqCst);
        daemon.touch();
        log::line(&format!("client {viewer_id} detached"));
    }
    drop(viewer);
    let _ = writing.await;
}
