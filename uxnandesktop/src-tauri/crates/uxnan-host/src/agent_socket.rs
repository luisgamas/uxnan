//! The SSH agent a connection forwards, followed across connections.
//!
//! A connection with `ForwardAgent` gives every process it starts an
//! `SSH_AUTH_SOCK` that lives exactly as long as that connection. The daemon
//! outlives connections, so the socket it was started with goes stale at the
//! first reconnect — and with it every `git push` its terminals and its git
//! make over SSH. So each `attach` points one stable path in the run folder at
//! its own connection's socket, and the daemon hands that stable path to
//! everything it starts: whatever runs there uses the agent of whichever
//! connection came last, the way a terminal opened over that connection would.
//!
//! Unix only: on Windows the forwarded agent is a named pipe with no such
//! indirection, and Win32-OpenSSH does not forward one to a server anyway.

#[cfg(unix)]
use std::path::{Path, PathBuf};

#[cfg(unix)]
const VAR: &str = "SSH_AUTH_SOCK";

/// The stable path, in the run folder only this account can open.
#[cfg(unix)]
fn stable_path() -> PathBuf {
    crate::paths::run_dir().join("agent.sock")
}

/// For `attach`: point the stable path at this connection's agent, when it
/// forwards one. Nothing changes for a connection that forwards none — the
/// last one that did keeps serving.
pub fn follow_this_connection() {
    #[cfg(unix)]
    if let Some(socket) = std::env::var_os(VAR).map(PathBuf::from) {
        let stable = stable_path();
        if socket != stable && crate::paths::ensure_private_dir(&crate::paths::run_dir()).is_ok() {
            let _ = point(&stable, &socket);
        }
    }
}

/// For `serve`, before any thread exists: everything this daemon starts gets
/// the stable path, so the agent of whichever connection came last reaches it
/// — including one that connects after the daemon started. Where no connection
/// forwards an agent the path leads nowhere, which `ssh` treats exactly as no
/// agent; a shell whose profile starts its own still sets its own.
pub fn hand_on_the_stable_path() {
    #[cfg(unix)]
    std::env::set_var(VAR, stable_path());
}

/// Make `stable` a symlink to `target`, replacing whatever it was, atomically:
/// a link made beside it and renamed over it, so nothing ever finds it absent.
#[cfg(unix)]
fn point(stable: &Path, target: &Path) -> std::io::Result<()> {
    let scratch = stable.with_extension(format!("sock.{}", std::process::id()));
    let _ = std::fs::remove_file(&scratch);
    std::os::unix::fs::symlink(target, &scratch)?;
    std::fs::rename(&scratch, stable).inspect_err(|_| {
        let _ = std::fs::remove_file(&scratch);
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn the_stable_path_follows_the_latest_connection() {
        let dir = tempfile::tempdir().unwrap();
        let stable = dir.path().join("agent.sock");
        let first = dir.path().join("agent.1");
        let second = dir.path().join("agent.2");

        point(&stable, &first).unwrap();
        assert_eq!(std::fs::read_link(&stable).unwrap(), first);
        // A second connection replaces it in place, leaving nothing behind.
        point(&stable, &second).unwrap();
        assert_eq!(std::fs::read_link(&stable).unwrap(), second);
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["agent.sock"]);
    }
}
