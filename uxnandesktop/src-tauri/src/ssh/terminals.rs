//! Terminals that live in a host's daemon, as the rest of the app sees them.
//!
//! The shape is the local one on purpose — the frontend picks the id, output
//! arrives as `pty:output:{id}`, the end as `pty:exit:{id}` — so nothing in the
//! terminal UI knows its tab is backed by a process on another machine that
//! outlives this app.
//!
//! What is new is what happens **between** connections:
//!
//! - **The connection drops.** The terminal is not ended and no exit is
//!   reported, because nothing ended: the program is still running on the host.
//!   The tab is told so in one dim line and keeps its place.
//! - **The connection comes back.** Each of the host's detached terminals is
//!   attached again and repainted from the daemon's screen, then live output
//!   carries on. A daemon that restarted in between (another epoch) no longer
//!   has them, and only then is an exit reported.
//! - **The app restarts.** A tab is recognised by its persistent session id
//!   (`sid`), which the daemon keeps as the terminal's label: recreating the tab
//!   attaches to the terminal it had instead of opening a second one.
//! - **A tab is closed while its host is away.** The close is kept and sent
//!   when the host is back, so no terminal is left running there by accident.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::engine::{HostEngine, Sink};
use crate::error::AppError;

type Output = Arc<dyn Fn(&[u8]) + Send + Sync>;
type Exit = Arc<std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>>>;

struct Terminal {
    host_id: String,
    session: u32,
    /// The daemon incarnation that holds `session`.
    epoch: String,
    cols: u16,
    rows: u16,
    output: Output,
    exit: Exit,
    /// Watching it right now (the host is connected and attached).
    attached: bool,
}

impl Terminal {
    fn sink(&self) -> Sink {
        let output = Arc::clone(&self.output);
        let exit = Arc::clone(&self.exit);
        Sink {
            output: Box::new(move |bytes| output(bytes)),
            exit: Some(Box::new(move || fire(&exit))),
        }
    }
}

/// Report the end once, whichever path gets there first.
fn fire(exit: &Exit) {
    let taken = exit.lock().unwrap().take();
    if let Some(exit) = taken {
        exit();
    }
}

/// What a tab is told when its host goes away. Dim, on its own line, and
/// erased by the repaint when the host comes back.
const DETACHED_NOTICE: &[u8] =
    b"\r\n\x1b[2m[uxnan] the connection to this host was lost; the terminal keeps running there. Reconnecting\xe2\x80\xa6\x1b[0m\r\n";

#[derive(Default)]
pub struct EngineTerminals {
    tabs: Mutex<HashMap<String, Terminal>>,
    /// Closes asked for while the host was unreachable, by host:
    /// `(epoch, session)`.
    closes: Mutex<HashMap<String, Vec<(String, u32)>>>,
}

/// What a caller needs to open (or find again) a terminal.
pub struct EngineTerminalSpec {
    pub id: String,
    /// The tab's persistent session id: the daemon's label for the terminal.
    pub sid: Option<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

impl EngineTerminals {
    pub async fn owns(&self, id: &str) -> bool {
        self.tabs.lock().await.contains_key(id)
    }

    /// Close the agent a tab's terminal runs, on its host.
    pub async fn stop_agent(
        &self,
        engine: Option<&HostEngine>,
        id: &str,
        commands: Vec<String>,
    ) -> Result<uxnan_workspace_engine::agentstop::StopOutcome, AppError> {
        let session = self.attached_session(id).await?;
        match engine {
            Some(engine) => engine.stop_agent(session, commands).await,
            None => Err(AppError::NotConnected("this terminal's host".to_string())),
        }
    }

    /// The tab whose terminal is `session` of the daemon `epoch` on `host_id`.
    /// A tab's id changes when the app restarts while its terminal on the host
    /// does not, so this — not the id the terminal was started with — is what
    /// names the tab now.
    pub async fn tab_for(&self, host_id: &str, epoch: &str, session: u32) -> Option<String> {
        self.tabs
            .lock()
            .await
            .iter()
            .find(|(_, t)| t.host_id == host_id && t.epoch == epoch && t.session == session)
            .map(|(id, _)| id.clone())
    }

    /// The host a tab's terminal lives on.
    pub async fn host_of(&self, id: &str) -> Option<String> {
        self.tabs.lock().await.get(id).map(|t| t.host_id.clone())
    }

    /// Open a terminal on the host — or attach to the one this tab already has
    /// there. `true` is a fresh terminal; `false` one found again (the frontend
    /// then repaints instead of launching anything into it).
    pub async fn create<FOut, FExit>(
        &self,
        host_id: &str,
        engine: &HostEngine,
        spec: EngineTerminalSpec,
        on_output: FOut,
        on_exit: FExit,
    ) -> Result<bool, AppError>
    where
        FOut: Fn(&[u8]) + Send + Sync + 'static,
        FExit: FnOnce() + Send + 'static,
    {
        if self.tabs.lock().await.contains_key(&spec.id) {
            return Ok(false);
        }
        let output: Output = Arc::new(on_output);
        let exit: Exit = Arc::new(std::sync::Mutex::new(Some(Box::new(on_exit))));
        let label = spec.sid.clone().unwrap_or_else(|| spec.id.clone());

        // The daemon may already hold this tab's terminal: the app restarted,
        // the window reloaded. Its label is the tab's persistent id.
        let existing = match spec.sid.as_deref() {
            Some(sid) => engine.list().await?.into_iter().find(|s| s.label == sid),
            None => None,
        };

        let mut terminal = Terminal {
            host_id: host_id.to_string(),
            session: 0,
            epoch: engine.epoch().to_string(),
            cols: spec.cols,
            rows: spec.rows,
            output,
            exit,
            attached: true,
        };

        let fresh = match existing {
            Some(found) => {
                terminal.session = found.session;
                let alive = engine
                    // A tab that starts empty: the history above the screen
                    // comes too.
                    .attach(found.session, spec.cols, spec.rows, true, terminal.sink())
                    .await?;
                if !alive {
                    // It ended while nobody watched: its last screen was just
                    // painted, and now the end is reported.
                    fire(&terminal.exit);
                }
                log(&format!(
                    "terminal {} found again on {host_id} (session {})",
                    spec.id, found.session
                ));
                false
            }
            None => {
                let (session, _pid) = engine
                    .open(
                        &label,
                        spec.cwd,
                        None,
                        spec.env,
                        spec.cols,
                        spec.rows,
                        terminal.sink(),
                    )
                    .await?;
                terminal.session = session;
                log(&format!(
                    "terminal {} opened on {host_id} (session {session})",
                    spec.id
                ));
                true
            }
        };
        self.tabs.lock().await.insert(spec.id, terminal);
        Ok(fresh)
    }

    pub async fn write(
        &self,
        engine: Option<&HostEngine>,
        id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), AppError> {
        let session = self.attached_session(id).await?;
        match engine {
            Some(engine) => engine.write(session, bytes).await,
            None => Err(AppError::NotConnected("this terminal's host".to_string())),
        }
    }

    pub async fn resize(
        &self,
        engine: Option<&HostEngine>,
        id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        let (session, attached) = {
            let mut tabs = self.tabs.lock().await;
            let t = tabs
                .get_mut(id)
                .ok_or_else(|| AppError::NotFound(format!("pty {id}")))?;
            t.cols = cols;
            t.rows = rows;
            (t.session, t.attached)
        };
        // A detached terminal is resized when it is attached again, to the size
        // remembered here.
        match engine {
            Some(engine) if attached => engine.resize(session, cols, rows).await,
            _ => Ok(()),
        }
    }

    /// End a tab's terminal — now, or as soon as its host is reachable.
    pub async fn close(&self, engine: Option<&HostEngine>, id: &str) -> Result<(), AppError> {
        let Some(t) = self.tabs.lock().await.remove(id) else {
            return Ok(());
        };
        match engine {
            Some(engine) if engine.epoch() == t.epoch && engine.is_alive() => {
                engine.close(t.session).await.or_else(|e| match e {
                    AppError::NotFound(_) => Ok(()),
                    other => Err(other),
                })
            }
            _ => {
                self.closes
                    .lock()
                    .await
                    .entry(t.host_id)
                    .or_default()
                    .push((t.epoch, t.session));
                Ok(())
            }
        }
    }

    async fn attached_session(&self, id: &str) -> Result<u32, AppError> {
        let tabs = self.tabs.lock().await;
        let t = tabs
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("pty {id}")))?;
        if !t.attached {
            return Err(AppError::NotConnected("this terminal's host".to_string()));
        }
        Ok(t.session)
    }

    /// The host's engine went away: every terminal on it is detached, told so,
    /// and kept.
    pub async fn detach_host(&self, host_id: &str, epoch: &str) {
        let mut tabs = self.tabs.lock().await;
        for (id, t) in tabs.iter_mut() {
            if t.host_id == host_id && t.epoch == epoch && t.attached {
                t.attached = false;
                (t.output)(DETACHED_NOTICE);
                log(&format!("terminal {id} detached from {host_id}"));
            }
        }
    }

    /// Whether `host_id` has terminals waiting for it to come back, or closes
    /// owed to it.
    pub async fn waiting_on(&self, host_id: &str) -> bool {
        self.tabs
            .lock()
            .await
            .values()
            .any(|t| t.host_id == host_id && !t.attached)
            || self
                .closes
                .lock()
                .await
                .get(host_id)
                .is_some_and(|c| !c.is_empty())
    }

    /// The host is back: attach its detached terminals again and send the
    /// closes it is owed.
    pub async fn reattach_host(&self, host_id: &str, engine: &HostEngine) {
        let owed = self.closes.lock().await.remove(host_id).unwrap_or_default();
        for (epoch, session) in owed {
            if epoch == engine.epoch() {
                let _ = engine.close(session).await;
            }
        }

        let detached: Vec<(String, u32, String, u16, u16, Sink, Exit)> = {
            let tabs = self.tabs.lock().await;
            tabs.iter()
                .filter(|(_, t)| t.host_id == host_id && !t.attached)
                .map(|(id, t)| {
                    (
                        id.clone(),
                        t.session,
                        t.epoch.clone(),
                        t.cols,
                        t.rows,
                        t.sink(),
                        Arc::clone(&t.exit),
                    )
                })
                .collect()
        };
        for (id, session, epoch, cols, rows, sink, exit) in detached {
            let came_back = epoch == engine.epoch() && {
                // The tab kept its own history through the drop.
                match engine.attach(session, cols, rows, false, sink).await {
                    Ok(alive) => {
                        if !alive {
                            fire(&exit);
                        }
                        true
                    }
                    Err(_) => false,
                }
            };
            let mut tabs = self.tabs.lock().await;
            if came_back {
                if let Some(t) = tabs.get_mut(&id) {
                    t.attached = true;
                }
                log(&format!("terminal {id} attached again on {host_id}"));
            } else {
                // The daemon that held it is gone (the host rebooted, or the
                // daemon was stopped): the terminal ended, and now it says so.
                tabs.remove(&id);
                drop(tabs);
                fire(&exit);
                log(&format!("terminal {id} was gone when {host_id} came back"));
            }
        }
    }
}

fn log(message: &str) {
    crate::diagnostics::log(crate::diagnostics::Level::Info, "ssh-engine", message);
}

#[cfg(test)]
mod tests {
    /// The whole path against a real machine, through the user's own route and
    /// agent: install the daemon over SFTP, open a terminal, lose the
    /// connection, connect again, find the terminal, see its screen. Writes
    /// only under `~/.uxnan/host/` on that machine, and closes the terminal it
    /// opened.
    ///
    /// `UXNAN_SSH_TEST_ALIAS=<alias> cargo test --manifest-path
    /// uxnandesktop/src-tauri/Cargo.toml -- --ignored engine_terminal --nocapture`
    mod live {
        use super::super::*;
        use crate::model::{SshHost, SshHostSource};
        use crate::ssh::dial::{route_for, Dial, Step};
        use std::sync::Mutex as StdMutex;

        async fn connect(alias: &str) -> Arc<crate::ssh::conn::Connection> {
            let host = SshHost {
                id: "live".into(),
                label: alias.into(),
                config_host: Some(alias.into()),
                hostname: String::new(),
                port: 22,
                user: String::new(),
                identity_files: vec![],
                identity_agent: None,
                identities_only: false,
                forward_agent: false,
                proxy_command: None,
                proxy_jump: None,
                source: SshHostSource::SshConfig,
                needs_prompt: false,
            };
            let route = route_for(&host).await.unwrap();
            match Dial::new(route)
                .run(&|_| crate::ssh::auth::Secrets::default())
                .await
                .unwrap()
            {
                Step::Ready(ready) => Arc::new(ready.connection),
                _ => panic!("could not reach {alias} silently"),
            }
        }

        async fn engine(conn: &crate::ssh::conn::Connection) -> Arc<HostEngine> {
            let shell = crate::ssh::shellkind::classify(conn).await;
            let files = Arc::new(crate::ssh::sftp::open(conn).await.unwrap());
            let path = crate::ssh::engine::ensure_installed(conn, shell, &files)
                .await
                .unwrap();
            HostEngine::start(conn, shell, &path).await.unwrap()
        }

        fn collector() -> (
            Arc<StdMutex<String>>,
            impl Fn(&[u8]) + Send + Sync + 'static,
        ) {
            let seen = Arc::new(StdMutex::new(String::new()));
            let sink = Arc::clone(&seen);
            (seen, move |b: &[u8]| {
                sink.lock().unwrap().push_str(&String::from_utf8_lossy(b))
            })
        }

        /// A line that prints `<label>_<n>` in a shell of this family, typed so
        /// that the line itself never contains it — waiting for the marker waits
        /// for the output, not for the echo of what was typed. Each family's
        /// own way to compute it, and its own Enter.
        fn print_line(shell: crate::ssh::shellkind::ShellKind, label: &str, n: u32) -> Vec<u8> {
            use crate::ssh::shellkind::ShellKind;
            match shell {
                ShellKind::Posix => format!("echo {label}_$(({n}+0))\n"),
                // A caret escapes the next character, and disappears.
                ShellKind::Cmd => format!("echo {label}_^{n}\r"),
                ShellKind::PowerShell => format!("echo \"{label}_$({n}+0)\"\r"),
                ShellKind::Unknown => panic!("the host's shell could not be named"),
            }
            .into_bytes()
        }

        async fn until(seen: &Arc<StdMutex<String>>, needle: &str) {
            for _ in 0..200 {
                if seen.lock().unwrap().contains(needle) {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            panic!("never saw {needle:?} in {:?}", seen.lock().unwrap());
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS; writes under /tmp on that host"]
        async fn a_change_on_the_host_reaches_this_side_without_asking() {
            // The engine watches a folder **there**; this side is told, with no
            // command run to look. The folder is a fresh one under /tmp.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let conn = connect(&alias).await;
            let engine = engine(&conn).await;
            let dir = format!("/tmp/uxnan-watch-{}", std::process::id());
            conn.exec(&format!("mkdir -p {dir} && mkdir -p {dir}/.git"))
                .await
                .unwrap();
            type Heard = Vec<(Vec<String>, bool)>;
            let heard: Arc<StdMutex<Heard>> = Arc::default();
            let sink = Arc::clone(&heard);
            engine.set_on_changed(Box::new(move |_root, paths, _overflow, git| {
                sink.lock().unwrap().push((paths, git));
            }));
            engine.watch(&dir).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            conn.exec(&format!("echo hi > {dir}/notes.md"))
                .await
                .unwrap();
            conn.exec(&format!("echo x > {dir}/.git/index"))
                .await
                .unwrap();
            let file = format!("{dir}/notes.md");
            for _ in 0..100 {
                let got = heard.lock().unwrap().clone();
                let saw_file = got.iter().any(|(p, _)| p.contains(&file));
                let saw_git = got.iter().any(|(_, g)| *g);
                if saw_file && saw_git {
                    println!("live: {alias} reported the new file and the .git change by itself");
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            panic!(
                "the host's change never arrived: {:?}",
                heard.lock().unwrap()
            );
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS; freezes its own daemon for ~40 s"]
        async fn a_daemon_that_stops_answering_is_given_up_on() {
            // A half-open link, made on purpose: our own daemon on the host is
            // frozen (SIGSTOP — that one process, nothing else), so TCP and SSH
            // stay up while nothing answers. The heartbeat must notice.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let conn = connect(&alias).await;
            let engine = engine(&conn).await;
            let pid = engine.daemon_pid();
            let side = connect(&alias).await;
            side.exec(&format!("kill -STOP {pid}")).await.unwrap();
            let gave_up = tokio::time::timeout(std::time::Duration::from_secs(50), engine.lost())
                .await
                .is_ok();
            side.exec(&format!("kill -CONT {pid}")).await.unwrap();
            assert!(gave_up, "the frozen daemon was not noticed");
            assert!(!engine.is_alive());
            println!("live: {alias} frozen daemon noticed by the heartbeat");
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS; idles 45 s on purpose"]
        async fn an_idle_engine_stays_up_on_its_heartbeat() {
            // The heartbeat gives up on a link silent for 30 s. A healthy link
            // with nothing to say must never look like that — this is the test
            // that every idle terminal is not cut off half a minute in.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let conn = connect(&alias).await;
            let engine = engine(&conn).await;
            tokio::time::sleep(std::time::Duration::from_secs(45)).await;
            assert!(engine.is_alive(), "an idle engine was given up on");
            assert!(engine.list().await.is_ok(), "and it still answers");
            println!("live: {alias} engine idle for 45 s, still up");
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn a_dropped_connection_detaches_and_the_return_reattaches_in_place() {
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let terminals = EngineTerminals::default();
            let conn = connect(&alias).await;
            let shell = crate::ssh::shellkind::classify(&conn).await;
            let first = engine(&conn).await;
            let exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let exit_flag = Arc::clone(&exited);
            let (seen, output) = collector();
            terminals
                .create(
                    "live",
                    &first,
                    EngineTerminalSpec {
                        id: "tab-drop".into(),
                        sid: Some(format!("drop-{}", std::process::id())),
                        cwd: None,
                        env: vec![],
                        cols: 90,
                        rows: 25,
                    },
                    output,
                    move || exit_flag.store(true, std::sync::atomic::Ordering::SeqCst),
                )
                .await
                .unwrap();
            terminals
                .write(Some(&first), "tab-drop", print_line(shell, "BEFORE", 2))
                .await
                .unwrap();
            until(&seen, "BEFORE_2").await;

            // The link goes. What the app does when it notices: detach, keep.
            let epoch = first.epoch().to_string();
            conn.handle()
                .disconnect(russh::Disconnect::ByApplication, "test drop", "")
                .await
                .unwrap();
            drop(conn);
            tokio::time::timeout(std::time::Duration::from_secs(20), first.lost())
                .await
                .expect("the engine notices its connection ended");
            terminals.detach_host("live", &epoch).await;
            until(&seen, "connection to this host was lost").await;
            assert!(terminals.waiting_on("live").await);
            assert!(
                terminals
                    .write(None, "tab-drop", b"x".to_vec())
                    .await
                    .is_err(),
                "a detached terminal refuses input instead of losing it silently"
            );

            // It comes back: the same tab, the same terminal, repainted.
            seen.lock().unwrap().clear();
            let conn = connect(&alias).await;
            let second = engine(&conn).await;
            terminals.reattach_host("live", &second).await;
            until(&seen, "BEFORE_2").await;
            assert!(!terminals.waiting_on("live").await);
            terminals
                .write(Some(&second), "tab-drop", print_line(shell, "AFTER", 4))
                .await
                .unwrap();
            until(&seen, "AFTER_4").await;
            assert!(
                !exited.load(std::sync::atomic::Ordering::SeqCst),
                "nothing ended"
            );
            println!("live: {alias} terminal detached on the drop and came back in place");
            terminals.close(Some(&second), "tab-drop").await.unwrap();
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn an_agents_report_on_the_host_reaches_the_tab_that_shows_it_now() {
            // What a reporter does, typed into a terminal on the host: POST to
            // the coordinates the engine gave that terminal. Then the app
            // "restarts": a new tab id finds the same terminal, whose agent still
            // carries the old id — and its report must land on the new tab.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let sid = format!("hook-{}", std::process::id());
            let spec = |id: &str| EngineTerminalSpec {
                id: id.into(),
                sid: Some(sid.clone()),
                cwd: None,
                env: vec![("UXNAN_AGENT_ID".into(), id.into())],
                cols: 100,
                rows: 30,
            };
            let first_run = EngineTerminals::default();
            let conn = connect(&alias).await;
            let shell = crate::ssh::shellkind::classify(&conn).await;
            let first = engine(&conn).await;
            let (seen, output) = collector();
            first_run
                .create("live", &first, spec("tab-hook-1"), output, || {})
                .await
                .unwrap();
            first_run
                .write(Some(&first), "tab-hook-1", print_line(shell, "READY", 6))
                .await
                .unwrap();
            until(&seen, "READY_6").await;
            drop(first_run);
            drop(first);
            drop(conn);

            let second_run = EngineTerminals::default();
            let conn = connect(&alias).await;
            let second = engine(&conn).await;
            type Heard = Vec<(u32, Vec<(String, String)>, String)>;
            let heard: Arc<StdMutex<Heard>> = Arc::default();
            let sink = Arc::clone(&heard);
            second.set_on_hook(Box::new(move |session, headers, body| {
                sink.lock().unwrap().push((session, headers, body));
            }));
            let (_seen, output) = collector();
            let fresh = second_run
                .create("live", &second, spec("tab-hook-2"), output, || {})
                .await
                .unwrap();
            assert!(!fresh, "the terminal is found again by its sid");
            // What a reporter does, in that shell's own words (`curl` ships
            // with Windows too).
            let report = match shell {
                crate::ssh::shellkind::ShellKind::Cmd => concat!(
                    "curl -fsS -X POST \"%UXNAN_HOOK_URL%\" -H \"X-Uxnan-Token: %UXNAN_HOOK_TOKEN%\" ",
                    "-H \"X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%\" -H \"X-Uxnan-Agent-Type: claude\" ",
                    "-d \"{\\\"hook_event_name\\\":\\\"Stop\\\"}\"\r"
                ),
                _ => concat!(
                    "printf '%s' '{\"hook_event_name\":\"Stop\"}' | curl -fsS -X POST \"$UXNAN_HOOK_URL\" ",
                    "-H \"X-Uxnan-Token: $UXNAN_HOOK_TOKEN\" -H \"X-Uxnan-Agent-Id: $UXNAN_AGENT_ID\" ",
                    "-H 'X-Uxnan-Agent-Type: claude' --data-binary @-\n"
                ),
            };
            second_run
                .write(Some(&second), "tab-hook-2", report.as_bytes().to_vec())
                .await
                .unwrap();
            let mut got = None;
            for _ in 0..100 {
                if let Some(first) = heard.lock().unwrap().first().cloned() {
                    got = Some(first);
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let (session, headers, body) = got.expect("the report never arrived");
            assert_eq!(body, r#"{"hook_event_name":"Stop"}"#);
            let id = headers
                .iter()
                .find(|(k, _)| k == "x-uxnan-agent-id")
                .map(|(_, v)| v.as_str());
            assert_eq!(
                id,
                Some("tab-hook-1"),
                "the agent kept the id it started with"
            );
            assert!(headers.iter().all(|(k, _)| k != "x-uxnan-token"));
            assert_eq!(
                second_run
                    .tab_for("live", second.epoch(), session)
                    .await
                    .as_deref(),
                Some("tab-hook-2"),
                "and the session names the tab that shows it now"
            );
            println!("live: {alias} forwarded the agent's report to the tab that shows it");
            second_run.close(Some(&second), "tab-hook-2").await.unwrap();
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS and UXNAN_SSH_TEST_WIRE=1; wires the host's real agents and runs its Claude Code once"]
        async fn the_hosts_own_claude_reports_its_turn_through_the_wired_hooks() {
            // The whole path with nothing stood in: the engine wires the host's
            // agents with the app's own installer, then Claude Code itself runs
            // one turn in a terminal there and its hooks report it here. It
            // changes that machine's agent configs (keeping a rolling `.bak`),
            // so it runs only when asked twice.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            assert_eq!(
                std::env::var("UXNAN_SSH_TEST_WIRE").as_deref(),
                Ok("1"),
                "set UXNAN_SSH_TEST_WIRE=1: this writes the host's agent configs"
            );
            let conn = connect(&alias).await;
            let engine = engine(&conn).await;
            let wired = engine.wire_hooks().await.unwrap();
            assert!(wired.contains(&"claude".to_string()), "{wired:?}");

            type Heard = Vec<(Vec<(String, String)>, String)>;
            let heard: Arc<StdMutex<Heard>> = Arc::default();
            let sink = Arc::clone(&heard);
            engine.set_on_hook(Box::new(move |_session, headers, body| {
                sink.lock().unwrap().push((headers, body));
            }));
            let dir = format!("/tmp/uxnan-claude-{}", std::process::id());
            conn.exec(&format!("mkdir -p {dir}")).await.unwrap();
            let terminals = EngineTerminals::default();
            let (seen, output) = collector();
            terminals
                .create(
                    "live",
                    &engine,
                    EngineTerminalSpec {
                        id: "tab-claude".into(),
                        sid: None,
                        cwd: Some(dir.clone()),
                        env: vec![("UXNAN_AGENT_ID".into(), "tab-claude".into())],
                        cols: 120,
                        rows: 30,
                    },
                    output,
                    || {},
                )
                .await
                .unwrap();
            terminals
                .write(
                    Some(&engine),
                    "tab-claude",
                    b"claude -p 'Reply with exactly the word: ok'; echo CLAUDE_RAN_$((1+1))\n"
                        .to_vec(),
                )
                .await
                .unwrap();
            for _ in 0..1200 {
                if seen.lock().unwrap().contains("CLAUDE_RAN_2") {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            // The last reports may trail the turn's output a little.
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let got = heard.lock().unwrap().clone();
            let events: Vec<String> = got
                .iter()
                .filter_map(|(_, body)| {
                    let v: serde_json::Value = serde_json::from_str(body).ok()?;
                    let source = v.get("source").unwrap_or(&v);
                    source
                        .get("hook_event_name")
                        .and_then(|e| e.as_str())
                        .map(str::to_string)
                })
                .collect();
            println!("live: {alias} wired {wired:?}; Claude reported {events:?}");
            terminals.close(Some(&engine), "tab-claude").await.unwrap();
            conn.exec(&format!("rm -rf {dir}")).await.unwrap();
            assert!(
                got.iter().all(|(h, _)| h
                    .iter()
                    .any(|(k, v)| k == "x-uxnan-agent-id" && v == "tab-claude")),
                "every report names the terminal it came from"
            );
            assert!(events.iter().any(|e| e == "UserPromptSubmit"), "{events:?}");
            assert!(events.iter().any(|e| e == "Stop"), "{events:?}");
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS and UXNAN_SSH_TEST_WIRE=1; runs the host's Claude Code once"]
        async fn the_hosts_own_claude_calls_this_apps_tools_through_the_engine() {
            // Nothing stood in but the window: the host's Claude, launched with
            // the catalog the host's engine gave, calls `uxnan_status`; the
            // engine relays it here, the app's own MCP server answers as the
            // tab that shows the terminal — and Claude prints which tab that is.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            assert_eq!(
                std::env::var("UXNAN_SSH_TEST_WIRE").as_deref(),
                Ok("1"),
                "set UXNAN_SSH_TEST_WIRE=1: this runs the host's Claude Code"
            );
            let dir = tempfile::tempdir().unwrap();
            let app = tauri::test::mock_builder()
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .unwrap();
            tauri::Manager::manage(
                &app,
                crate::state::AppState::new(
                    crate::persistence::PersistenceManager::new(dir.path()),
                    crate::model::AppData::default(),
                    dir.path().to_path_buf(),
                ),
            );
            let state = tauri::Manager::state::<crate::state::AppState>(app.handle());
            let conn = connect(&alias).await;
            let engine = engine(&conn).await;
            crate::commands::serve_host_tools(app.handle(), "live", &engine);
            let tools = engine.agent_tools().await.expect("the engine relays tools");
            let catalog = crate::mcpinject::agent_infos(
                Some(&tools.mcp_url),
                tools.claude_config.as_deref(),
                tools.opencode_major,
            );
            let claude = catalog.iter().find(|a| a.id == "claude").unwrap();
            assert!(
                !claude.args.is_empty(),
                "a Claude launch config on the host"
            );

            let tab = "tab-claude-tools";
            let mut env = vec![("UXNAN_AGENT_ID".to_string(), tab.to_string())];
            env.extend(crate::commands::host_tool_env(&state, &engine, Some("claude")).await);
            let workdir = format!("/tmp/uxnan-tools-{}", std::process::id());
            conn.exec(&format!("mkdir -p {workdir}")).await.unwrap();
            let (seen, output) = collector();
            state
                .engine_terminals
                .create(
                    "live",
                    &engine,
                    EngineTerminalSpec {
                        id: tab.into(),
                        sid: None,
                        cwd: Some(workdir.clone()),
                        env,
                        cols: 160,
                        rows: 40,
                    },
                    output,
                    || {},
                )
                .await
                .unwrap();
            let line = format!(
                "claude -p 'Call the uxnan_status tool, then reply with only the value of caller.terminalId from its answer.' {} --allowedTools mcp__uxnan-browser__uxnan_status; echo CLAUDE_RAN_$((2+3))\n",
                claude.args.join(" ")
            );
            state
                .engine_terminals
                .write(Some(&engine), tab, line.into_bytes())
                .await
                .unwrap();
            for _ in 0..1800 {
                if seen.lock().unwrap().contains("CLAUDE_RAN_5") {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            let shown = seen.lock().unwrap().clone();
            state
                .engine_terminals
                .close(Some(&engine), tab)
                .await
                .unwrap();
            conn.exec(&format!("rm -rf {workdir}")).await.unwrap();
            // The answer is a line of its own: the typed command names the
            // tab nowhere, so a line that is exactly its id is Claude's reply.
            let answered = shown.lines().any(|l| l.trim() == tab);
            println!("live: {alias}'s Claude called this app's tools through the engine as {tab}: {answered}");
            assert!(
                shown.contains("CLAUDE_RAN_5"),
                "Claude never finished: {shown}"
            );
            assert!(
                answered,
                "Claude did not print the tab the call was attributed to:\n{shown}"
            );
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn an_engine_terminal_survives_a_new_connection_and_is_found_by_its_sid() {
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let sid = format!("live-{}", std::process::id());

            // First app session: open the tab's terminal.
            let terminals = EngineTerminals::default();
            let conn = connect(&alias).await;
            let shell = crate::ssh::shellkind::classify(&conn).await;
            let first = engine(&conn).await;
            let (seen, output) = collector();
            let fresh = terminals
                .create(
                    "live",
                    &first,
                    EngineTerminalSpec {
                        id: "tab-1".into(),
                        sid: Some(sid.clone()),
                        cwd: None,
                        env: vec![],
                        cols: 100,
                        rows: 30,
                    },
                    output,
                    || {},
                )
                .await
                .unwrap();
            assert!(fresh);
            terminals
                .write(Some(&first), "tab-1", print_line(shell, "SURVIVES", 42))
                .await
                .unwrap();
            until(&seen, "SURVIVES_42").await;

            // The connection goes; the tab is told and kept.
            drop(first);
            drop(conn);
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            // A new app session (a restart): a new registry, a new connection —
            // and a tab with the same persistent id finds its terminal.
            let again = EngineTerminals::default();
            let conn = connect(&alias).await;
            let second = engine(&conn).await;
            let (seen, output) = collector();
            let fresh = again
                .create(
                    "live",
                    &second,
                    EngineTerminalSpec {
                        id: "tab-1-restored".into(),
                        sid: Some(sid.clone()),
                        cwd: None,
                        env: vec![],
                        cols: 100,
                        rows: 30,
                    },
                    output,
                    || {},
                )
                .await
                .unwrap();
            assert!(!fresh, "the terminal was found again, not opened anew");
            until(&seen, "SURVIVES_42").await;
            println!("live: {alias} repainted the terminal that outlived its connection");

            again.close(Some(&second), "tab-1-restored").await.unwrap();
            let left = second.list().await.unwrap();
            assert!(
                left.iter().all(|s| s.label != sid),
                "closed for good: {left:?}"
            );
        }
    }
}
