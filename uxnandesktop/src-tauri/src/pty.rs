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
//! Hidden-tab back-pressure (the spec's 2 MB ring buffer + snapshot/restore) is
//! a later optimization — for now the webview keeps each xterm instance mounted
//! so background output is retained client-side. See `FOR-DEV.md`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::error::AppError;

/// Parameters to spawn a new PTY. `id` is chosen by the frontend so it can
/// subscribe to the output event before any bytes are produced.
pub struct PtySpec {
    pub id: String,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// One live pseudoterminal: the master handle (for resize), its writer (stdin),
/// and the child process (for kill).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
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
    pub fn create<FOut, FExit>(
        &self,
        spec: PtySpec,
        on_output: FOut,
        on_exit: FExit,
    ) -> Result<(), AppError>
    where
        FOut: Fn(&[u8]) + Send + 'static,
        FExit: FnOnce() + Send + 'static,
    {
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
        cmd.cwd(spec.cwd.unwrap_or_else(default_cwd));

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

        // Blocking reads run on a dedicated OS thread (portable-pty's reader is
        // not async). It ends when the PTY closes (read returns 0 or errors).
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(&buf[..n]),
                    Err(_) => break,
                }
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
        Ok(())
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
        if let Some(mut session) = self.sessions.lock().unwrap().remove(id) {
            let _ = session.child.kill();
        }
        Ok(())
    }

    /// Number of live sessions (used by tests).
    #[cfg(test)]
    fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

/// Default shell per platform: honor the user's configured shell, else a sane
/// built-in (PowerShell on Windows, `/bin/bash` elsewhere).
fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("UXNAN_SHELL").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
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
