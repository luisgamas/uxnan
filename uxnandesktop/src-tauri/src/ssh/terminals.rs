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
                    .attach(found.session, spec.cols, spec.rows, terminal.sink())
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
                match engine.attach(session, cols, rows, sink).await {
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
            HostEngine::start(conn, &path).await.unwrap()
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
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn an_engine_terminal_survives_a_new_connection_and_is_found_by_its_sid() {
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let sid = format!("live-{}", std::process::id());

            // First app session: open the tab's terminal.
            let terminals = EngineTerminals::default();
            let conn = connect(&alias).await;
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
                .write(Some(&first), "tab-1", b"echo SURVIVES_$((6*7))\n".to_vec())
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
