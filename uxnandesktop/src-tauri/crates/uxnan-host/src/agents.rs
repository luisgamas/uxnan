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

use uxnan_host_protocol::Reply;
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

/// What a launch here needs to reach the app's tools, through this daemon's
/// endpoint: the scripts (the `$BROWSER` shim among them), Claude Code's launch
/// config naming this endpoint, and the version of the OpenCode installed
/// here — the facts the app builds this machine's launch catalog from.
pub fn tools(endpoint: &crate::endpoint::Endpoint) -> Reply {
    use uxnan_workspace_engine::mcp_launch;
    let mcp_url = endpoint.mcp_url();
    let browser_shim = agent_hooks::install_shared_scripts()
        .ok()
        .map(|install| {
            if cfg!(windows) {
                install.browser_shim_cmd
            } else {
                install.browser_shim_bash
            }
        })
        .filter(|path| Path::new(path).is_file());
    let claude_config = write_claude_config(&mcp_url);
    let opencode_major = search_dirs()
        .into_iter()
        .find_map(|dir| found_in(&dir, "opencode"))
        .and_then(|path| version_of(&path))
        .as_deref()
        .and_then(mcp_launch::parse_major_version);
    Reply::AgentTools {
        mcp_url,
        browser_url: endpoint.browser_url(),
        token: endpoint.token.clone(),
        bridge_token: Some(endpoint.bridge_token.clone()),
        browser_shim,
        claude_config,
        opencode_major,
    }
}

/// Claude Code's launch config for this endpoint, in this daemon's own run
/// folder — named by the port, as the app names its own, so a later daemon's
/// file never hands an agent an endpoint that has gone. The file holds no
/// secret: it names the token's variable.
fn write_claude_config(mcp_url: &str) -> Option<String> {
    use uxnan_workspace_engine::mcp_launch;
    let dir = crate::paths::run_dir().join("mcp");
    crate::paths::ensure_private_dir(&dir).ok()?;
    let path = dir.join(format!(
        "claude-{}.json",
        mcp_launch::endpoint_port(mcp_url)
    ));
    agent_hooks::write_json_atomic(&path, &mcp_launch::claude_config_json(mcp_url)).ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// What `program --version` prints, if it answers in time.
fn version_of(program: &Path) -> Option<String> {
    let mut child = Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
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
    Some(out)
}

/// Every agent's hook state on this machine, as the engine's installer sees
/// it — "is it here?" answered with the login shell's `PATH`.
pub fn status() -> serde_json::Value {
    let dirs = search_dirs();
    let installed = |name: &str| on_path(&dirs, name);
    serde_json::to_value(agent_hooks::read_all_agent_status(&installed))
        .unwrap_or(serde_json::Value::Null)
}

/// Install (`on`) or remove one agent's reporter here.
pub fn set(agent: &str, on: bool) -> Result<serde_json::Value, String> {
    let status = if on {
        let install = agent_hooks::install_shared_scripts().map_err(|e| e.to_string())?;
        agent_hooks::install_agent(agent, &install)
    } else {
        agent_hooks::uninstall_agent(agent)
    }
    .map_err(|e| e.to_string())?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

/// Exactly what the installer writes for one agent here.
pub fn config(agent: &str) -> Result<String, String> {
    let install = agent_hooks::install_shared_scripts().map_err(|e| e.to_string())?;
    agent_hooks::render_agent_config(agent, &install).map_err(|e| e.to_string())
}

/// The account's own shell, as a terminal here starts it.
#[cfg(unix)]
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
#[cfg(unix)]
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
/// Windows has no login shell to ask: a session's `PATH` is the account's own,
/// from the registry, which this process already has.
#[cfg(windows)]
fn login_path() -> Option<String> {
    None
}

pub(crate) fn search_dirs() -> Vec<PathBuf> {
    // Tests name exactly where to look, like `UXNAN_HOST_HOME` for where to
    // live: a daemon under test must never find — and run — the machine's
    // real programs, such as the bridge installed for the person.
    if let Some(only) = std::env::var_os("UXNAN_HOST_SEARCH_PATH") {
        return std::env::split_paths(&only).collect();
    }
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
    if cfg!(windows) {
        // npm's global shims, and the per-user installers' folders.
        for var in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var) {
                add(PathBuf::from(&base).join("npm"));
            }
        }
    } else {
        for abs in ["/usr/local/bin", "/opt/homebrew/bin"] {
            add(PathBuf::from(abs));
        }
    }
    dirs
}

/// Whether `name` is an executable file in one of `dirs`.
fn on_path(dirs: &[PathBuf], name: &str) -> bool {
    dirs.iter().any(|d| found_in(d, name).is_some())
}

/// `name` in `dir` as this platform runs it: the file itself on Unix; on
/// Windows with one of the extensions a command is found by (`PATHEXT`).
pub(crate) fn found_in(dir: &Path, name: &str) -> Option<PathBuf> {
    if cfg!(windows) {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        exts.split(';')
            .filter(|e| !e.is_empty())
            .map(|e| dir.join(format!("{name}{}", e.to_ascii_lowercase())))
            .find(|p| executable(p))
    } else {
        let path = dir.join(name);
        executable(&path).then_some(path)
    }
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
        // Named as each platform names a command: bare on Unix, with an
        // extension `PATHEXT` lists on Windows.
        let named = |base: &str| {
            if cfg!(windows) {
                format!("{base}.cmd")
            } else {
                base.to_string()
            }
        };
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().to_path_buf();
        std::fs::write(bin.join(named("claude")), "#!/bin/sh\n").unwrap();
        std::fs::write(bin.join("notes"), "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(bin.join("claude"), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        std::fs::create_dir(bin.join(named("codex"))).unwrap();
        let dirs = vec![PathBuf::from("/nonexistent"), bin];
        assert!(on_path(&dirs, "claude"));
        assert!(!on_path(&dirs, "codex"), "a folder is not an executable");
        // Unix: no exec bit; Windows: no extension a command is found by.
        assert!(!on_path(&dirs, "notes"));
        assert!(!on_path(&dirs, "grok"));
    }
}
