//! Pseudoterminal (PTY) management — the heart of the terminal-centric ADE.
//!
//! Each terminal pane is an OS pseudoterminal spawned via `portable-pty`
//! (ConPTY on Windows, openpty elsewhere). The [`PtyManager`] owns every live
//! session keyed by an id chosen by the frontend, exposes write/resize/close,
//! and streams stdout/stderr bytes through caller-supplied sinks. The Tauri
//! command layer wires those sinks to `pty:output:{id}` / `pty:exit:{id}`
//! events; tests wire them to channels, so the manager needs no `AppHandle` and
//! is unit-testable.
//!
//! The backend retains no output history. The frontend keeps every terminal's
//! xterm instance alive for the tab's whole life and re-parents its DOM element
//! on pane moves (`src/lib/terminal/instances.ts`), so scrollback lives — once,
//! authoritatively — in xterm's buffer and there is nothing to snapshot or
//! replay. (The previous raw-output ring buffer existed to repaint recreated
//! xterms; replaying a TUI's raw byte stream was unsound — it could start
//! mid-escape-sequence and raced live output — and was removed with the
//! recreate-on-move model itself.)

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::error::AppError;

/// Shared child handle: the reader/waiter threads, `close`/`close_all` and the
/// pid scan all need it, so it lives behind an `Arc<Mutex<…>>`.
type SharedChild = Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>;

/// Parameters to spawn a new PTY. `id` is chosen by the frontend so it can
/// subscribe to the output event before any bytes are produced.
pub struct PtySpec {
    pub id: String,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    /// Arguments for the shell/command (e.g. `["-d", "Ubuntu"]` for `wsl.exe`).
    pub args: Vec<String>,
    /// Extra environment variables to set on the spawned shell (inherited by any
    /// agent run inside it) — e.g. `UXNAN_HOOK_URL` / `UXNAN_AGENT_ID` so an
    /// agent's hook can report state to the local server.
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

/// One live pseudoterminal: the master handle (for resize), its writer (stdin)
/// and the child process (for kill).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: SharedChild,
}

/// Owns all live PTY sessions for the app, keyed by frontend-chosen id.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    /// Spawn a shell in a new PTY. `on_output` is called (on a dedicated reader
    /// thread) for every chunk of output; `on_exit` fires once when the process
    /// ends or the PTY closes. The frontend chooses `id` *before* calling so it
    /// can subscribe to the output event with no risk of missing early bytes.
    /// Returns `true` when a fresh session was spawned, `false` when one with
    /// this id already existed (the call is then a no-op). Since the frontend
    /// keeps xterm instances alive across pane moves, `false` only happens when
    /// the webview reloaded over a live backend (dev/HMR); the frontend then
    /// nudges the PTY with a row-bounce resize to make the running app repaint.
    pub fn create<FOut, FExit>(
        &self,
        spec: PtySpec,
        on_output: FOut,
        on_exit: FExit,
    ) -> Result<bool, AppError>
    where
        FOut: Fn(&[u8]) + Send + 'static,
        FExit: FnOnce() + Send + 'static,
    {
        // Idempotent: if a session with this id already exists, keep it running
        // instead of spawning a replacement (a stray double-create must never
        // restart a live shell / agent).
        if self.sessions.lock().unwrap().contains_key(&spec.id) {
            return Ok(false);
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: spec.rows,
                cols: spec.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(spec.shell.unwrap_or_else(default_shell));
        for arg in &spec.args {
            cmd.arg(arg);
        }
        for (key, value) in &spec.env {
            cmd.env(key, value);
        }
        cmd.cwd(spec.cwd.unwrap_or_else(default_cwd));

        // FOR-DEV: Windows redirection-guard structural fix (alternative to the
        // shipped detection). On Windows this child inherits the app's
        // redirection-trust enforcement, so a command traversing an "untrusted"
        // junction/symlink (npm-workspace links, OneDrive placeholders) fails with
        // `os error 448` where a standalone shell succeeds. The shipped fix detects
        // + guides the user (`src/lib/terminal/windowsJunctionGuard.ts`). The
        // structural alternative — spawn PTYs from a separate process off the
        // WebView2 host so children don't inherit the mitigation — is a large,
        // cross-platform change; see `FOR-DEV.md` → Terminal.
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(e.to_string()))?;
        // Drop the slave in the parent so only the child holds it; otherwise the
        // reader never sees EOF when the child exits.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(e.to_string()))?;
        let child: SharedChild = Arc::new(Mutex::new(child));

        // Blocking reads run on a dedicated OS thread (portable-pty's reader is
        // not async). Each chunk streams straight to the sink (the frontend's
        // live xterm buffer is the only retained copy); it ends when the PTY
        // closes. It does not signal exit, because on Windows ConPTY read-EOF
        // is unreliable (it can fire during a full-screen agent's teardown, or
        // *not* fire when the shell exits). Exit is detected by waiting on the
        // child instead.
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(&buf[..n]),
                    Err(_) => break,
                }
            }
        });

        // Authoritative exit signal: poll the *shell* process. This fires only
        // when the shell itself exits (the user ran `exit`/Ctrl-D), not when an
        // agent running inside it quits.
        let child_for_wait = child.clone();
        std::thread::spawn(move || {
            loop {
                let status = child_for_wait.lock().unwrap().try_wait();
                match status {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) => {}
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            on_exit();
        });

        self.sessions.lock().unwrap().insert(
            spec.id,
            PtySession {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(true)
    }

    /// Write user input to the PTY's stdin.
    pub fn write(&self, id: &str, data: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("pty {id}")))?;
        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    /// Resize the PTY (columns/rows) when its pane changes size.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("pty {id}")))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(e.to_string()))?;
        Ok(())
    }

    /// Kill the child and drop the session. Idempotent — closing an unknown id
    /// is a no-op (it may already have exited on its own).
    pub fn close(&self, id: &str) -> Result<(), AppError> {
        if let Some(session) = self.sessions.lock().unwrap().remove(id) {
            let _ = session.child.lock().unwrap().kill();
        }
        Ok(())
    }

    /// Kill every live session. Called on app exit so no shell/agent is leaked.
    pub fn close_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_id, session) in sessions.drain() {
            let _ = session.child.lock().unwrap().kill();
        }
    }

    /// Live sessions paired with their shell's process id, for the agent
    /// process-detection poll. Sessions whose pid is unknown are skipped.
    pub fn live_pids(&self) -> Vec<(String, u32)> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, s)| {
                s.child
                    .lock()
                    .unwrap()
                    .process_id()
                    .map(|pid| (id.clone(), pid))
            })
            .collect()
    }

    /// Number of live sessions (used by tests).
    #[cfg(test)]
    fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

/// Default shell per platform: honor the user's configured shell, else a sane
/// built-in (PowerShell on Windows, the user's `$SHELL`, then `zsh` on macOS —
/// its modern default — or `/bin/bash` elsewhere).
fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("UXNAN_SHELL").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}

/// Default working directory when none is given: the user's home directory, so
/// shells don't open in the app's install folder.
fn default_cwd() -> String {
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE")
    } else {
        std::env::var("HOME")
    };
    home.unwrap_or_else(|_| ".".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn default_shell_is_nonempty() {
        assert!(!default_shell().is_empty());
        assert!(!default_cwd().is_empty());
    }

    #[test]
    fn create_write_read_close_lifecycle() {
        let mgr = PtyManager::default();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        // Use a shell that doesn't do the cursor-position (`ESC[6n`) handshake on
        // startup: in a headless test there's no xterm to answer it, so
        // PowerShell would block. `cmd.exe` echoes input and runs immediately.
        // The real app uses the PowerShell/bash default against a live xterm.js.
        let shell = if cfg!(windows) {
            Some("cmd.exe".to_string())
        } else {
            None
        };

        mgr.create(
            PtySpec {
                id: "t1".to_string(),
                cwd: None,
                shell,
                args: Vec::new(),
                env: Vec::new(),
                cols: 80,
                rows: 24,
            },
            move |bytes| {
                let _ = tx.send(bytes.to_vec());
            },
            || {},
        )
        .expect("pty should spawn");

        assert_eq!(mgr.len(), 1);

        // Type a command whose echo contains a unique marker (interactive shells
        // echo input, so the marker appears regardless of the shell).
        mgr.write("t1", "echo uxnan_pty_marker\r\n").expect("write");

        // Accumulate output until the marker shows up (or we time out). On
        // Windows, ConPTY queries the terminal's cursor position (`ESC[6n`) at
        // startup and waits for a reply before flushing — a live xterm answers
        // automatically, so here we answer it ourselves to unblock the console.
        let mut seen = String::new();
        let mut answered_dsr = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(chunk) => {
                    seen.push_str(&String::from_utf8_lossy(&chunk));
                    if !answered_dsr && seen.contains("\u{1b}[6n") {
                        answered_dsr = true;
                        mgr.write("t1", "\u{1b}[1;1R").ok();
                    }
                    if seen.contains("uxnan_pty_marker") {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(
            seen.contains("uxnan_pty_marker"),
            "expected the echoed marker in PTY output, got: {seen:?}"
        );

        mgr.write("t1", "exit\r\n").ok();
        mgr.close("t1").expect("close");
        assert_eq!(mgr.len(), 0);
    }

    #[test]
    fn create_is_idempotent_for_same_id() {
        let mgr = PtyManager::default();
        let shell = if cfg!(windows) {
            Some("cmd.exe".to_string())
        } else {
            None
        };
        let spec = || PtySpec {
            id: "dup".to_string(),
            cwd: None,
            shell: shell.clone(),
            args: Vec::new(),
            env: Vec::new(),
            cols: 80,
            rows: 24,
        };
        assert!(
            mgr.create(spec(), |_| {}, || {}).unwrap(),
            "first create spawns"
        );
        assert_eq!(mgr.len(), 1);
        // Second create with the same id is a no-op (created == false), not a restart.
        assert!(
            !mgr.create(spec(), |_| {}, || {}).unwrap(),
            "second create reports the existing session"
        );
        assert_eq!(mgr.len(), 1);
        mgr.close("dup").unwrap();
    }

    #[test]
    fn write_unknown_pty_is_not_found() {
        let mgr = PtyManager::default();
        let err = mgr.write("missing", "x").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn close_unknown_pty_is_noop() {
        let mgr = PtyManager::default();
        assert!(mgr.close("missing").is_ok());
    }
}
