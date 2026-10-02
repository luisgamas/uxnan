//! Wiring the agents on this host to report their state.
//!
//! The installer is the desktop's own (`uxnan_workspace_engine::agent_hooks`):
//! the same scripts, written to this machine's `~/.uxnan/hooks/`, registered in
//! each agent's own config the same way, with the same rolling `.bak`. What is
//! the host's is only the answer to "is this agent here?" — asked of the `PATH`
//! a terminal here gets, which is the login shell's, not this daemon's (a
//! daemon started over `ssh host cmd` has the bare system `PATH`, and the
//! agents live in `~/.local/bin`, an npm prefix, …) — and the reach: only the
//! agents this machine shows signs of, never other products' config folders.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use uxnan_workspace_engine::agent_hooks::{self, Reach};

/// How long the login shell gets to say what its `PATH` is.
const LOGIN_PATH_DEADLINE: Duration = Duration::from_secs(5);

/// Write the reporters and register them with every agent this host has,
/// answering which ones are wired.
pub fn wire() -> Result<Vec<String>, String> {
    let install = agent_hooks::install_shared_scripts().map_err(|e| e.to_string())?;
    let dirs = search_dirs();
    let installed = |name: &str| on_path(&dirs, name);
    Ok(
        agent_hooks::install_all(&install, &installed, Reach::PresentAgents)
            .into_iter()
            .map(str::to_string)
            .collect(),
    )
}

/// The account's own shell, as a terminal here starts it.
fn account_shell() -> PathBuf {
    #[cfg(unix)]
    {
        // SAFETY: getpwuid returns a pointer into static storage (or null);
        // it is read at once, on this thread, before anything else calls it.
        unsafe {
            let entry = libc::getpwuid(libc::getuid());
            if !entry.is_null() && !(*entry).pw_shell.is_null() {
                let shell = std::ffi::CStr::from_ptr((*entry).pw_shell);
                if let Ok(shell) = shell.to_str() {
                    if !shell.is_empty() {
                        return PathBuf::from(shell);
                    }
                }
            }
        }
    }
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

/// The `PATH` a login shell here ends up with, or `None` when it does not say
/// in time. Read from `env`'s output, which every shell family prints the same
/// way (fish keeps `PATH` as a list, but exports it colon-joined).
fn login_path() -> Option<String> {
    let mut child = Command::new(account_shell())
        .args(["-l", "-c", "env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < LOGIN_PATH_DEADLINE => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    // The last one: a profile can print anything before `env` runs.
    out.lines()
        .rev()
        .find_map(|l| l.strip_prefix("PATH="))
        .map(str::to_string)
}

/// Where to look for an agent: the login shell's `PATH`, this process's own,
/// and the folders the agents' installers use when a profile does not add
/// them to `PATH` for a non-interactive shell.
fn search_dirs() -> Vec<PathBuf> {
    let home = agent_hooks::home_dir().unwrap_or_default();
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut add = |dir: PathBuf| {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };
    for path in [login_path(), std::env::var("PATH").ok()]
        .into_iter()
        .flatten()
    {
        for dir in std::env::split_paths(&path) {
            add(dir);
        }
    }
    for rel in [
        ".local/bin",
        ".npm-global/bin",
        ".bun/bin",
        ".cargo/bin",
        ".volta/bin",
        ".opencode/bin",
    ] {
        add(home.join(rel));
    }
    for abs in ["/usr/local/bin", "/opt/homebrew/bin"] {
        add(PathBuf::from(abs));
    }
    dirs
}

/// Whether `name` is an executable file in one of `dirs`.
fn on_path(dirs: &[PathBuf], name: &str) -> bool {
    dirs.iter().any(|d| executable(&d.join(name)))
}

fn executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.is_file() && meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        meta.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_is_found_only_as_an_executable_file() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().to_path_buf();
        std::fs::write(bin.join("claude"), "#!/bin/sh\n").unwrap();
        std::fs::write(bin.join("notes"), "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(bin.join("claude"), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        std::fs::create_dir(bin.join("codex")).unwrap();
        let dirs = vec![PathBuf::from("/nonexistent"), bin];
        assert!(on_path(&dirs, "claude"));
        assert!(!on_path(&dirs, "codex"), "a folder is not an executable");
        #[cfg(unix)]
        assert!(
            !on_path(&dirs, "notes"),
            "a file without the exec bit is not"
        );
        assert!(!on_path(&dirs, "grok"));
    }
}
