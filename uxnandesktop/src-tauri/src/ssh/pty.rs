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

        match build_command(&spec) {
            // A shell, so the user gets their own environment: aliases, prompt,
            // PATH from their profile. This is the one place we *want* the
            // profile the inventory probe deliberately skips.
            None => channel
                .request_shell(true)
                .await
                .map_err(|e| AppError::Pty(format!("the host refused a shell: {e}")))?,
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

        // The one owner. It waits for remote output and for local commands at
        // the same time, so neither can starve the other.
        tokio::spawn(async move {
            let mut closing = false;
            loop {
                let command = tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            // stdout and stderr both belong on a terminal: that
                            // is what a terminal *is*. (`conn::exec` keeps them
                            // apart because there a caller parses the output.)
                            Some(ChannelMsg::Data { ref data }) => { on_output(data); None }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => { on_output(data); None }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            Some(_) => None,
                        }
                    }
                    cmd = rx.recv() => cmd.or(Some(PtyCommand::Close)),
                };
                // Handled out here rather than inside the arm: the other arm's
                // future still borrows the channel while the select is running.
                match command {
                    Some(PtyCommand::Write(bytes)) => {
                        if channel.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(PtyCommand::Resize(cols, rows)) => {
                        let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                    }
                    Some(PtyCommand::Close) => {
                        closing = true;
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

/// The command to run, if the caller asked for one rather than a shell.
///
/// A `cwd` is honored by prefixing a `cd`, because SSH has no "start here" — the
/// protocol only opens a shell in the user's default directory. Quoting is the
/// host's problem to interpret, so the path is wrapped in single quotes for a
/// POSIX host and left alone for a Windows one, decided by how the path is
/// written rather than by asking (one round trip is worth more than the guess).
fn build_command(spec: &RemotePtySpec) -> Option<String> {
    let cwd = spec.cwd.as_deref().map(str::trim).filter(|c| !c.is_empty());
    match (cwd, spec.command.as_deref()) {
        (None, None) => None,
        (None, Some(command)) => Some(command.to_string()),
        (Some(cwd), command) => {
            let windows_style = cwd.chars().nth(1) == Some(':') || cwd.starts_with('\\');
            let cd = if windows_style {
                format!("cd /d \"{cwd}\"")
            } else {
                format!("cd '{}'", cwd.replace('\'', r"'\''"))
            };
            Some(match command {
                Some(command) => format!("{cd} && {command}"),
                // No command: land in the directory and hand over an interactive
                // shell there.
                None if windows_style => format!("{cd} && cmd"),
                None => format!("{cd} && exec $SHELL -l"),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(cwd: Option<&str>, command: Option<&str>) -> RemotePtySpec {
        RemotePtySpec {
            id: "t1".into(),
            cwd: cwd.map(String::from),
            command: command.map(String::from),
            cols: 80,
            rows: 24,
        }
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
    fn a_posix_cwd_is_quoted_and_keeps_an_interactive_shell() {
        let out = build_command(&spec(Some("/home/dev/my repo"), None)).unwrap();
        assert_eq!(out, "cd '/home/dev/my repo' && exec $SHELL -l");
    }

    #[test]
    fn a_single_quote_in_a_posix_path_cannot_end_the_quoting() {
        // Otherwise a directory named `it's` would break out of the quotes and
        // whatever followed would run as a command.
        let out = build_command(&spec(Some("/home/dev/it's"), None)).unwrap();
        assert!(out.starts_with(r"cd '/home/dev/it'\''s'"), "{out}");
    }

    #[test]
    fn a_windows_cwd_uses_the_form_cmd_understands() {
        let out = build_command(&spec(Some(r"C:\code\repo"), None)).unwrap();
        assert_eq!(out, r#"cd /d "C:\code\repo" && cmd"#);
    }

    #[test]
    fn a_cwd_and_a_command_run_in_that_order() {
        let out = build_command(&spec(Some("/srv/app"), Some("claude"))).unwrap();
        assert_eq!(out, "cd '/srv/app' && claude");
    }

    #[test]
    fn a_blank_cwd_is_treated_as_none() {
        assert_eq!(build_command(&spec(Some("   "), None)), None);
    }
}
