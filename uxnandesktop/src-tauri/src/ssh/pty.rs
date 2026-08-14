//! Terminals that live on another machine.
//!
//! A remote terminal is one channel on the host's existing connection carrying a
//! PTY and a shell. Deliberately the *same shape* as the local one
//! ([`crate::pty::PtyManager`]): the frontend chose the id before asking, output
//! arrives through the same `pty:output:{id}` event, exit through
//! `pty:exit:{id}`, and write/resize/close take the same arguments. Nothing in
//! the terminal UI — xterm, splits, re-parenting on a pane move — knows which
//! kind it got, which is the point. A second terminal implementation the UI had
//! to branch on would drift from the first within a release.
//!
//! What is genuinely different is stated rather than hidden:
//!
//! * **Closing kills the channel, not necessarily the tree.** The remote shell
//!   gets EOF and the channel closes; a descendant that detached survives. The
//!   local side has the same limitation today (`pty.rs` kills the direct child),
//!   but here it is less visible because a stray process is on a machine the
//!   user is not looking at.
//! * **There is no local process to inspect**, so the process-detection layer of
//!   agent monitoring cannot see these. The title/OSC layer works untouched,
//!   because it reads the byte stream.

use std::collections::HashMap;

use russh::ChannelMsg;
use tokio::sync::Mutex;

use super::conn::Connection;
use crate::error::AppError;

/// What a caller needs to open a remote terminal.
pub struct RemotePtySpec {
    /// Chosen by the frontend *before* the call, so it can subscribe to the
    /// output event with no risk of missing the first bytes.
    pub id: String,
    /// Working directory on the host. `None` = the shell's own default (the
    /// user's home), which is what a login shell would give them anyway.
    pub cwd: Option<String>,
    /// Command to run instead of an interactive shell, if any.
    pub command: Option<String>,
    /// Which shell this host starts, so the working directory is typed in a form
    /// that shell understands (`super::shellkind`). Never assumed: a machine's
    /// owner switches between cmd, PowerShell, WSL and Git Bash freely.
    pub shell: super::shellkind::ShellKind,
    pub cols: u16,
    pub rows: u16,
}

/// What the owning task is asked to do. The channel has exactly one owner — the
/// task pumping its output — and everything else talks to it through this.
///
/// The first version held the channel behind a mutex and let the pump hold that
/// mutex while awaiting the next message. Which is to say: it held the lock for
/// as long as the user was not typing, so writing, resizing and closing all
/// blocked until the remote said something — a terminal that deadlocks the
/// moment it goes idle. The fix is not a smarter lock, it is one owner.
enum PtyCommand {
    Write(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// One live remote terminal: the handle used to reach its owning task.
struct RemotePty {
    tx: tokio::sync::mpsc::Sender<PtyCommand>,
    /// Which host it runs on, so disconnecting that host can end its terminals.
    /// Without this they linger: dropping the connection does **not** wake a
    /// channel that is waiting for output, so the tab would go on claiming to be
    /// alive against a machine that is gone.
    host_id: String,
}

/// Every remote terminal, keyed by the frontend's id — the same key space the
/// local manager uses, because a terminal id must mean one thing app-wide.
#[derive(Default)]
pub struct RemotePtyManager {
    sessions: Mutex<HashMap<String, RemotePty>>,
}

/// Remote terminals write their lifecycle to the diagnostics log — opened,
/// closed, and *why* one ended.
///
/// It exists because a tab that vanishes has three possible causes that look
/// identical from the outside: uxnan closed it, the host ended the channel, or
/// the connection went away and took every terminal on it. Only the record tells
/// them apart, and a user reproducing the problem should not have to guess. Ids
/// and host ids only — never a path, never a byte of output.
fn log(message: &str) {
    crate::diagnostics::log(crate::diagnostics::Level::Info, "ssh-pty", message);
}

impl RemotePtyManager {
    /// Open a PTY on `conn` and start pumping its output.
    ///
    /// Returns `false` when this id already has a session, matching the local
    /// manager: creating twice is a no-op, not an error, because the frontend
    /// re-creates on webview reload.
    pub async fn create<FOut, FExit>(
        &self,
        host_id: &str,
        conn: &Connection,
        spec: RemotePtySpec,
        on_output: FOut,
        on_exit: FExit,
    ) -> Result<bool, AppError>
    where
        FOut: Fn(&[u8]) + Send + 'static,
        FExit: FnOnce() + Send + 'static,
    {
        if self.sessions.lock().await.contains_key(&spec.id) {
            return Ok(false);
        }

        let mut channel = conn
            .handle()
            .channel_open_session()
            .await
            .map_err(|e| AppError::Pty(format!("could not open a remote terminal: {e}")))?;

        // `xterm-256color` because that is what the frontend's xterm actually is;
        // claiming anything else makes a remote TUI draw for a terminal that is
        // not there.
        channel
            .request_pty(
                true,
                "xterm-256color",
                spec.cols as u32,
                spec.rows as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| AppError::Pty(format!("the host refused a terminal: {e}")))?;

        // A shell, so the user gets their own environment: aliases, prompt, PATH
        // from their profile. This is the one place we *want* the profile the
        // inventory probe deliberately skips. Only an explicit command takes the
        // `exec` path.
        let mut pending_init = None;
        match build_command(&spec) {
            None => {
                channel
                    .request_shell(true)
                    .await
                    .map_err(|e| AppError::Pty(format!("the host refused a shell: {e}")))?;
                pending_init = spec
                    .cwd
                    .as_deref()
                    .and_then(|cwd| super::shellkind::cd_line(spec.shell, cwd));
            }
            Some(command) => channel
                .exec(true, command)
                .await
                .map_err(|e| AppError::Pty(format!("the host refused the command: {e}")))?,
        }

        let (tx, mut rx) = tokio::sync::mpsc::channel::<PtyCommand>(64);
        self.sessions.lock().await.insert(
            spec.id.clone(),
            RemotePty {
                tx,
                host_id: host_id.to_string(),
            },
        );

        log(&format!("terminal {} opened on {host_id}", spec.id));

        // The one owner. It waits for remote output and for local commands at
        // the same time, so neither can starve the other.
        let log_id = spec.id.clone();
        tokio::spawn(async move {
            let mut closing = false;
            // Why this terminal ended, for the log: a tab that disappears has
            // exactly three possible causes, and only the record separates them.
            let mut reason = "the host ended the channel";
            // The `cd` waits for the shell to speak: the channel is open long
            // before the shell has finished starting, and typing into one that
            // is not there yet loses the front of the line.
            let mut init = pending_init;
            // Kept only until the terminal has proved it started (see
            // `early_exit_snippet`); a shell that dies young is the one case
            // where its own words are the diagnosis.
            let opened_at = std::time::Instant::now();
            let mut first_bytes: Vec<u8> = Vec::new();
            loop {
                let mut send_init = None;
                let command = tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            // stdout and stderr both belong on a terminal: that
                            // is what a terminal *is*. (`conn::exec` keeps them
                            // apart because there a caller parses the output.)
                            Some(ChannelMsg::Data { ref data }) => {
                                if first_bytes.len() < EARLY_EXIT_SNIPPET * 4
                                    && opened_at.elapsed().as_millis() < EARLY_EXIT_MS
                                {
                                    first_bytes.extend_from_slice(data);
                                }
                                on_output(data);
                                send_init = init.take();
                                None
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => { on_output(data); None }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            Some(_) => None,
                        }
                    }
                    cmd = rx.recv() => cmd.or(Some(PtyCommand::Close)),
                };
                // Both of these are handled out here rather than inside the arm:
                // the other arm's future still borrows the channel while the
                // select is running.
                if let Some(init) = send_init {
                    if channel.data(init.as_bytes()).await.is_err() {
                        reason = "the channel refused the initial directory";
                        break;
                    }
                }
                match command {
                    Some(PtyCommand::Write(bytes)) => {
                        if channel.data(&bytes[..]).await.is_err() {
                            reason = "the channel refused a write";
                            break;
                        }
                    }
                    Some(PtyCommand::Resize(cols, rows)) => {
                        let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                    }
                    Some(PtyCommand::Close) => {
                        closing = true;
                        reason = "uxnan closed it";
                        break;
                    }
                    None => {}
                }
            }
            if closing {
                // Tell the shell its input ended before the channel disappears
                // under it — the difference between "you are done" and being cut
                // off mid-write.
                let _ = channel.eof().await;
                let _ = channel.close().await;
            }
            let lived = opened_at.elapsed().as_millis();
            if lived < EARLY_EXIT_MS && !closing {
                // It never really started. Say how fast, and what the host said.
                log(&format!(
                    "terminal {log_id} ended after {lived} ms: {reason}; the host said: {}",
                    early_exit_snippet(&first_bytes)
                ));
            } else {
                log(&format!("terminal {log_id} ended: {reason}"));
            }
            on_exit();
        });

        Ok(true)
    }

    /// Send bytes to a remote terminal's stdin. Unknown id is a no-op: a write
    /// racing a close is ordinary, not an error worth surfacing.
    pub async fn write(&self, id: &str, data: &[u8]) -> Result<(), AppError> {
        self.send(id, PtyCommand::Write(data.to_vec())).await
    }

    /// Tell the host the window changed size, so a full-screen TUI redraws to
    /// the right shape.
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        self.send(id, PtyCommand::Resize(cols, rows)).await
    }

    /// Close a remote terminal. Idempotent.
    pub async fn close(&self, id: &str) -> Result<(), AppError> {
        let Some(session) = self.sessions.lock().await.remove(id) else {
            return Ok(());
        };
        log(&format!("closing terminal {id} on {}", session.host_id));
        // The task may already be gone (the host dropped the connection); that
        // is the outcome we wanted anyway, so it is not an error.
        let _ = session.tx.send(PtyCommand::Close).await;
        Ok(())
    }

    /// End every terminal running on a host.
    ///
    /// Called when that host is disconnected. It exists because dropping the
    /// connection is *not* enough: a channel parked waiting for output never
    /// learns its session went away, so its tab would keep claiming to be alive.
    /// Telling them directly is the difference between a terminal that says it
    /// exited and one that silently stops answering.
    ///
    /// A genuine network drop (rather than the user disconnecting) is still only
    /// noticed when the connection's inactivity timeout expires — recorded in
    /// `FOR-DEV.md` rather than papered over.
    pub async fn close_host(&self, host_id: &str) {
        let doomed: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, pty)| pty.host_id == host_id)
                .map(|(id, _)| id.clone())
                .collect()
        };
        if !doomed.is_empty() {
            log(&format!(
                "{host_id} disconnected: ending {} terminal(s)",
                doomed.len()
            ));
        }
        for id in doomed {
            let _ = self.close(&id).await;
        }
    }

    async fn send(&self, id: &str, command: PtyCommand) -> Result<(), AppError> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(id) else {
            return Ok(());
        };
        session
            .tx
            .send(command)
            .await
            .map_err(|_| AppError::Pty("the remote terminal is gone".to_string()))
    }

    /// Whether this id is a remote terminal, so the command layer knows which
    /// manager owns it without the frontend having to remember.
    pub async fn owns(&self, id: &str) -> bool {
        self.sessions.lock().await.contains_key(id)
    }
}

/// What a shell said before dying young, for the log.
///
/// A terminal that ends within seconds of opening has failed to start, and the
/// reason is almost always printed by the shell itself — the one place uxnan
/// cannot see from here. So an **early** exit, and only an early one, records a
/// short prefix of what the host sent.
///
/// The bounds are the point: at most [`EARLY_EXIT_SNIPPET`] characters, control
/// bytes and escape sequences collapsed to spaces, and nothing at all once the
/// terminal has lived past [`EARLY_EXIT_MS`] — by which point the bytes are the
/// user's work rather than a startup failure, and none of it belongs in a log.
fn early_exit_snippet(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::new();
    let mut spaced = false;
    for ch in text.chars() {
        if ch.is_control() || ch == '\u{1b}' {
            if !spaced && !out.is_empty() {
                out.push(' ');
                spaced = true;
            }
            continue;
        }
        out.push(ch);
        spaced = false;
        if out.chars().count() >= EARLY_EXIT_SNIPPET {
            break;
        }
    }
    out.trim().to_string()
}

/// How soon an exit counts as "it never started".
const EARLY_EXIT_MS: u128 = 5_000;
/// How much of the host's first output an early exit may record.
const EARLY_EXIT_SNIPPET: usize = 200;

/// The command to run, if the caller asked for one rather than a shell.
///
/// Deliberately does **not** touch `cwd`. It used to prefix a `cd` here, in a
/// syntax picked from how the path was spelled — which is how a PowerShell host
/// came to be sent cmd syntax and closed the channel on every project terminal.
/// The directory now belongs to [`super::shellkind::cd_line`], which asks the
/// host what it runs instead of inferring it; a caller that supplies its own
/// command supplies whatever directory handling that command needs.
fn build_command(spec: &RemotePtySpec) -> Option<String> {
    spec.command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(cwd: Option<&str>, command: Option<&str>) -> RemotePtySpec {
        RemotePtySpec {
            id: "t1".into(),
            cwd: cwd.map(String::from),
            command: command.map(String::from),
            // The live tests run against this machine's sshd, whose configured
            // shell is cmd; the classifier is exercised on its own replies in
            // `super::shellkind`.
            shell: super::super::shellkind::ShellKind::Cmd,
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn an_early_exit_records_what_the_shell_said_and_no_more() {
        // The escape sequences a shell paints on startup carry no information
        // here and would drown the one line that does.
        let raw = b"\x1b[2J\x1b[H'cd' is not recognized as an internal or external command.\r\n";
        let snippet = early_exit_snippet(raw);
        assert!(snippet.contains("not recognized"), "{snippet}");
        assert!(!snippet.contains('\x1b'), "{snippet}");
        assert!(!snippet.contains('\r'), "{snippet}");
    }

    #[test]
    fn the_snippet_is_bounded() {
        // A terminal that dies with a screenful of output must not put a
        // screenful into the log.
        let raw = "x".repeat(10_000);
        assert!(early_exit_snippet(raw.as_bytes()).chars().count() <= EARLY_EXIT_SNIPPET);
    }

    /// A real terminal on the sshd of this machine: open it, type a command,
    /// read what comes back, resize it, close it. Ignored by default — it needs
    /// a host that authorizes a key held by this machine's agent.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored remote_terminal --nocapture`
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn remote_terminal_live_echoes_what_is_typed_into_it() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use std::sync::atomic::{AtomicBool, Ordering};

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host on an empty known_hosts");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the key just recorded should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        let manager = RemotePtyManager::default();
        let output = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
        let exited = std::sync::Arc::new(AtomicBool::new(false));

        let sink = std::sync::Arc::clone(&output);
        let exit_flag = std::sync::Arc::clone(&exited);
        let created = manager
            .create(
                "h1",
                &conn,
                spec(None, None),
                move |bytes| {
                    if let Ok(mut buf) = sink.try_lock() {
                        buf.extend_from_slice(bytes);
                    }
                },
                move || exit_flag.store(true, Ordering::SeqCst),
            )
            .await
            .expect("the host should give us a terminal");
        assert!(created, "a fresh id must open a session");

        // Creating the same id twice is a no-op, exactly like the local manager.
        assert!(
            !manager
                .create("h1", &conn, spec(None, None), |_| {}, || {})
                .await
                .unwrap(),
            "a second create for the same id must not open a second terminal"
        );

        // Type something and wait for the shell to echo it back.
        manager
            .write(
                "t1",
                b"echo uxnan-remote-terminal

",
            )
            .await
            .expect("write");
        let mut seen = String::new();
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            seen = String::from_utf8_lossy(&output.lock().await.clone()).to_string();
            if seen.contains("uxnan-remote-terminal") {
                break;
            }
        }
        assert!(
            seen.contains("uxnan-remote-terminal"),
            "the shell should have echoed the command; got {seen:?}"
        );
        println!("live: remote terminal echoed {} bytes", seen.len());

        manager.resize("t1", 120, 40).await.expect("resize");
        assert!(manager.owns("t1").await);
        manager.close("t1").await.expect("close");
        assert!(!manager.owns("t1").await, "close must drop the session");
    }

    /// Two terminals on one host: closing one must leave the other alive.
    ///
    /// Reported from the app — one tab closed took the other with it. They share
    /// a connection but not a channel, and nothing about closing one may reach
    /// the other; a shared session that dies together is the bug this pins.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn closing_one_terminal_leaves_the_other_running() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use std::sync::atomic::{AtomicBool, Ordering};

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        let manager = RemotePtyManager::default();
        let survivor_out = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
        let survivor_exited = std::sync::Arc::new(AtomicBool::new(false));

        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .expect("a home directory");
        // With a cwd the manager `exec`s a shell rather than requesting one —
        // the path a project terminal takes, and a different channel setup, so
        // the pair is driven exactly as the app drives it.
        let mut first = spec(Some(&home), None);
        first.id = "keep".into();
        let sink = std::sync::Arc::clone(&survivor_out);
        let flag = std::sync::Arc::clone(&survivor_exited);
        manager
            .create(
                "h1",
                &conn,
                first,
                move |bytes| {
                    if let Ok(mut buf) = sink.try_lock() {
                        buf.extend_from_slice(bytes);
                    }
                },
                move || flag.store(true, Ordering::SeqCst),
            )
            .await
            .expect("the first terminal");

        let mut second = spec(Some(&home), None);
        second.id = "doomed".into();
        manager
            .create("h1", &conn, second, |_| {}, || {})
            .await
            .expect("the second terminal");

        manager.close("doomed").await.expect("close");
        assert!(!manager.owns("doomed").await);
        assert!(manager.owns("keep").await, "the other session must survive");

        // Owning the session is not the same as it still working: prove the
        // survivor still reaches its shell.
        manager
            .write("keep", b"echo uxnan-still-here\r")
            .await
            .expect("write to the survivor");
        let mut seen = String::new();
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            seen = String::from_utf8_lossy(&survivor_out.lock().await.clone()).to_string();
            if seen.contains("uxnan-still-here") {
                break;
            }
        }
        assert!(
            seen.contains("uxnan-still-here"),
            "the surviving terminal must still answer; got {seen:?}"
        );
        // Settle before judging: a teardown that reaches the other channel a
        // moment later would look identical to none at all if this asserted the
        // instant the echo came back.
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        assert!(
            !survivor_exited.load(Ordering::SeqCst),
            "the surviving terminal must not have reported an exit"
        );
        assert!(
            manager.owns("keep").await,
            "the survivor must still be held"
        );
        println!("live: closed one terminal, the other still answered");

        manager.close("keep").await.expect("close");
    }

    /// Ask the sshd of this machine which shell it starts, and use the answer.
    ///
    /// The end-to-end shape of the fix: nothing here knows in advance whether
    /// the host runs cmd, PowerShell or a POSIX shell — it asks, and the
    /// terminal it then opens lands in the folder it was given.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn the_host_is_asked_which_shell_it_runs() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use crate::ssh::shellkind::{classify, ShellKind};

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        let kind = classify(&conn).await;
        println!("live: this machine's sshd starts {kind:?}");
        assert_ne!(
            kind,
            ShellKind::Unknown,
            "a real host must be classifiable; an unknown answer means the probe \
             stopped working, and every remote terminal silently loses its folder"
        );
    }

    /// A terminal opened **in a folder** must actually be in it, and must still
    /// be alive a few seconds later.
    ///
    /// The bug this pins: the directory used to be applied by `exec`ing
    /// `cd /d "..." && cmd`, which only cmd understands. A Windows host whose
    /// sshd starts PowerShell answered with a parameter error and closed the
    /// channel about a second later, so every project terminal on that machine
    /// opened and died — while a terminal with no folder (the host card's) was
    /// fine, which is what made it look like the project was at fault.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn a_terminal_opens_in_its_folder_and_stays_alive() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use std::sync::atomic::{AtomicBool, Ordering};

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        // A folder that is not the home directory, so landing in it proves the
        // `cd` arrived: the app data directory of this very app.
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .expect("a home directory");
        let target = std::path::Path::new(&home).join("Documents");
        let target = target.to_string_lossy().to_string();

        let manager = RemotePtyManager::default();
        let output = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
        let exited = std::sync::Arc::new(AtomicBool::new(false));
        let sink = std::sync::Arc::clone(&output);
        let flag = std::sync::Arc::clone(&exited);
        manager
            .create(
                "h1",
                &conn,
                spec(Some(&target), None),
                move |bytes| {
                    if let Ok(mut buf) = sink.try_lock() {
                        buf.extend_from_slice(bytes);
                    }
                },
                move || flag.store(true, Ordering::SeqCst),
            )
            .await
            .expect("a terminal in a folder");

        // The proof is the **prompt**: cmd draws `…\Documents>` and PowerShell
        // `PS …\Documents>`, so the folder is followed by the prompt character.
        // The echo of the cd cannot fake it — that line ends in a quote — and on
        // a shell that clears its screen at startup the echo is gone anyway.
        let mut seen = String::new();
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            seen = String::from_utf8_lossy(&output.lock().await.clone()).to_string();
            if seen.contains("Documents>") {
                break;
            }
        }
        println!(
            "live: the prompt reads {:?}",
            seen.rsplit('\n').next().unwrap_or_default()
        );
        assert!(
            seen.contains("Documents>"),
            "the shell should be *in* the folder it was opened in; got {seen:?}"
        );
        assert!(
            !exited.load(Ordering::SeqCst),
            "a terminal opened in a folder must not die on the syntax of its own cd"
        );

        manager.close("t1").await.expect("close");
    }

    /// What a dropped connection does to a terminal running on it.
    ///
    /// This is the failure the UI has to render honestly: the host goes away and
    /// the tab must end up looking exactly like a local shell that exited, not
    /// like a live terminal that silently stopped responding.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn losing_the_connection_ends_the_terminal_like_an_exit() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use std::sync::atomic::{AtomicBool, Ordering};

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        let manager = RemotePtyManager::default();
        let exited = std::sync::Arc::new(AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&exited);
        manager
            .create(
                "h1",
                &conn,
                spec(None, None),
                |_| {},
                move || flag.store(true, Ordering::SeqCst),
            )
            .await
            .expect("terminal");

        // Disconnecting the host is what the UI does. Dropping the connection
        // alone is *not* enough — a channel parked waiting for output never
        // learns its session went away — which is exactly what this test found
        // the first time it was written, and why `close_host` exists.
        manager.close_host("h1").await;
        drop(conn);

        let mut fired = false;
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if exited.load(Ordering::SeqCst) {
                fired = true;
                break;
            }
        }
        assert!(
            fired,
            "losing the connection must fire the exit event; a terminal that just              stops answering leaves the tab claiming to be alive"
        );
        println!("live: connection dropped, terminal reported exit");
    }

    #[test]
    fn no_cwd_and_no_command_is_a_plain_shell() {
        // The common case: the host's own login shell, in the user's home.
        assert_eq!(build_command(&spec(None, None)), None);
    }

    #[test]
    fn a_command_without_a_cwd_runs_as_given() {
        assert_eq!(
            build_command(&spec(None, Some("claude"))).as_deref(),
            Some("claude")
        );
    }

    #[test]
    fn a_cwd_alone_asks_for_a_shell_rather_than_a_command() {
        // The directory is no longer smuggled into a command line: it is typed
        // into the shell the host actually runs (`shellkind::cd_line`). Building
        // one here again would reintroduce the assumption that broke every
        // project terminal on a PowerShell host.
        assert_eq!(build_command(&spec(Some("/home/dev/my repo"), None)), None);
        assert_eq!(build_command(&spec(Some(r"C:\code\repo"), None)), None);
    }

    #[test]
    fn a_cwd_never_leaks_into_a_command() {
        let out = build_command(&spec(Some("/srv/app"), Some("claude"))).unwrap();
        assert_eq!(
            out, "claude",
            "the cwd belongs to the shell, not the command"
        );
    }

    #[test]
    fn a_blank_command_is_treated_as_none() {
        assert_eq!(build_command(&spec(None, Some("   "))), None);
        assert_eq!(build_command(&spec(Some("   "), None)), None);
    }
}
