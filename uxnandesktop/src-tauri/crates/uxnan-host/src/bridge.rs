//! This machine's own Uxnan bridge (`02g` §5.18): found, installed into the
//! account, and kept running by this daemon.
//!
//! Conversations, headless runs and the phone belong to the bridge; on a host
//! that is the host's own `uxnan-bridge`, and the desktop reaches it through
//! this daemon. Three things are done here, and only here:
//!
//! - **Finding it.** A bridge the user installed themselves — on their login
//!   `PATH`, or already running as their own service — is the one used: that
//!   was their choice. Otherwise the one Uxnan put in the account's
//!   `~/.uxnan/bridge`.
//! - **Installing it** into that folder with the npm beside the account's
//!   Node (`npm install --global --prefix`): no administrator, nothing outside
//!   the account, and a layout the bridge's own `bridge/update` recognises, so
//!   it updates itself afterwards like anywhere else.
//! - **Keeping it running.** This daemon already outlives the SSH session, so
//!   it starts the bridge (`start --service`) and starts it again when it ends
//!   — including after the bridge's own update, which installs the new version
//!   and exits. No OS service is needed, so no lingering, no administrator,
//!   and the same on Linux, macOS and Windows. A bridge somebody else started
//!   is left alone; this never runs a second one beside it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use uxnan_host_protocol::{BridgeInstall, BridgeInstalled, BridgeState};

use crate::log;

/// How long an install may take: npm fetching the package and its
/// dependencies on a slow link.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
/// How often a supervisor that has nothing to start looks again.
const IDLE_LOOK: Duration = Duration::from_secs(15);
/// Restart backoff after the bridge ends, doubling to the cap while it keeps
/// ending quickly.
const FIRST_BACKOFF: Duration = Duration::from_secs(2);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// A run shorter than this counts as "ended quickly".
const QUICK_EXIT: Duration = Duration::from_secs(20);
/// The bridge's own log here is cut back once it passes this.
const LOG_CAP: u64 = 5 * 1024 * 1024;

/// The account's home, as the bridge sees it (its state is `~/.uxnan`).
fn account_home() -> PathBuf {
    PathBuf::from(crate::paths_home())
}

/// Where Uxnan installs the bridge for this account.
pub fn managed_prefix() -> PathBuf {
    account_home().join(".uxnan").join("bridge")
}

/// The managed install's entry point: npm's global layout under the prefix —
/// `lib/node_modules` on Unix, `node_modules` on Windows.
fn managed_cli() -> PathBuf {
    let modules = if cfg!(windows) {
        managed_prefix().join("node_modules")
    } else {
        managed_prefix().join("lib").join("node_modules")
    };
    modules
        .join("uxnan-bridge")
        .join("dist")
        .join("src")
        .join("cli.js")
}

/// Where this daemon remembers whether it was asked to keep the bridge
/// running — its own folder, never the bridge's state.
fn wish_file() -> PathBuf {
    crate::paths::home().join("bridge.json")
}

/// The bridge's output while this daemon runs it.
fn bridge_log() -> PathBuf {
    crate::paths::home().join("bridge.log")
}

/// The version in the `package.json` three folders above `cli`.
fn version_of(cli: &Path) -> Option<String> {
    let root = cli.parent()?.parent()?.parent()?;
    let raw = std::fs::read_to_string(root.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if json.get("name")?.as_str()? != "uxnan-bridge" {
        return None;
    }
    json.get("version")?.as_str().map(str::to_string)
}

/// The entry point behind a `uxnan-bridge` command found on `PATH`.
fn cli_behind(command: &Path) -> Option<PathBuf> {
    if cfg!(windows) {
        // npm's shim (`uxnan-bridge.cmd`) sits in the global prefix, beside
        // its `node_modules`.
        let cli = command
            .parent()?
            .join("node_modules")
            .join("uxnan-bridge")
            .join("dist")
            .join("src")
            .join("cli.js");
        cli.is_file().then_some(cli)
    } else {
        // A symlink into the package's `dist/src/cli.js`.
        let cli = std::fs::canonicalize(command).ok()?;
        (cli.file_name()? == "cli.js").then_some(cli)
    }
}

/// What is installed: the user's own first, then the managed one.
fn find_install(dirs: &[PathBuf]) -> Option<BridgeInstall> {
    let managed = managed_cli();
    for dir in dirs {
        let Some(command) = crate::agents::found_in(dir, "uxnan-bridge") else {
            continue;
        };
        let Some(cli) = cli_behind(&command) else {
            continue;
        };
        if cli == managed || std::fs::canonicalize(&managed).ok().as_ref() == Some(&cli) {
            continue;
        }
        if let Some(version) = version_of(&cli) {
            return Some(BridgeInstall {
                kind: "own".into(),
                version,
                cli: cli.to_string_lossy().into_owned(),
            });
        }
    }
    version_of(&managed).map(|version| BridgeInstall {
        kind: "managed".into(),
        version,
        cli: managed.to_string_lossy().into_owned(),
    })
}

/// A program's first line of `--version` output, if it answers in time.
fn version_line(program: &Path, path_env: &str) -> Option<String> {
    let out = std::process::Command::new(program)
        .arg("--version")
        .env("PATH", path_env)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_string())
}

fn find(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    dirs.iter().find_map(|d| crate::agents::found_in(d, name))
}

fn path_env(dirs: &[PathBuf]) -> String {
    std::env::join_paths(dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The pid in the bridge's lock, when that process is alive.
fn running_pid() -> Option<u32> {
    let raw = std::fs::read_to_string(account_home().join(".uxnan").join("bridge.lock")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let pid = u32::try_from(json.get("pid")?.as_u64()?).ok()?;
    alive(pid).then_some(pid)
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only asks whether the process exists.
    let rc = unsafe { libc::kill(pid, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: the handle is checked before use and closed after it.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code) != 0;
        CloseHandle(handle);
        ok && code == STILL_ACTIVE as u32
    }
}

/// Install (or update) the bridge into [`managed_prefix`].
pub fn install() -> BridgeInstalled {
    let dirs = crate::agents::search_dirs();
    let fail = |line: String| BridgeInstalled {
        ok: false,
        version: None,
        tail: vec![line],
    };
    let Some(npm) = find(&dirs, "npm") else {
        return fail(
            "npm was not found on this machine — install Node.js 18 or newer first".into(),
        );
    };
    let prefix = managed_prefix();
    if let Err(e) = std::fs::create_dir_all(&prefix) {
        return fail(format!("could not create {}: {e}", prefix.display()));
    }
    let child = std::process::Command::new(&npm)
        .args(["install", "--global", "--prefix"])
        .arg(&prefix)
        .args([
            "uxnan-bridge@latest",
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
        ])
        .env("PATH", path_env(&dirs))
        .current_dir(account_home())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(e) => return fail(format!("could not run npm: {e}")),
    };
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < INSTALL_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(200));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let mut output = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = std::io::Read::read_to_string(&mut out, &mut output);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = std::io::Read::read_to_string(&mut err, &mut output);
    }
    let mut tail: Vec<String> = output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect();
    if tail.len() > 20 {
        tail.drain(..tail.len() - 20);
    }
    let version = version_of(&managed_cli());
    match status {
        Some(status) if status.success() && version.is_some() => {
            closed_by_default();
            log::line(&format!(
                "bridge {} installed into {}",
                version.as_deref().unwrap_or("?"),
                prefix.display()
            ));
            BridgeInstalled {
                ok: true,
                version,
                tail,
            }
        }
        Some(_) => BridgeInstalled {
            ok: false,
            version: None,
            tail,
        },
        None => {
            tail.push(format!(
                "npm did not finish within {} minutes",
                INSTALL_TIMEOUT.as_secs() / 60
            ));
            BridgeInstalled {
                ok: false,
                version: None,
                tail,
            }
        }
    }
}

/// Answer a [`BridgeCall`]. The slow parts (an npm install, asking Node and
/// npm their versions) run off the connection.
pub async fn serve(
    supervisor: &Supervisor,
    call: uxnan_host_protocol::BridgeCall,
) -> uxnan_host_protocol::Outcome {
    use uxnan_host_protocol::{BridgeCall, Outcome, Reply};
    let value = match call {
        BridgeCall::Status => {
            let this = supervisor.clone();
            tokio::task::spawn_blocking(move || serde_json::to_value(this.state())).await
        }
        BridgeCall::Install => {
            tokio::task::spawn_blocking(|| serde_json::to_value(install())).await
        }
        BridgeCall::Supervise { on } => {
            supervisor.set(on);
            let this = supervisor.clone();
            tokio::task::spawn_blocking(move || serde_json::to_value(this.state())).await
        }
    };
    match value {
        Ok(Ok(value)) => Outcome::Ok {
            reply: Reply::Value { value },
        },
        Ok(Err(e)) => Outcome::Error {
            code: uxnan_host_protocol::ErrorCode::Invalid,
            message: e.to_string(),
        },
        Err(e) => Outcome::Error {
            code: uxnan_host_protocol::ErrorCode::Invalid,
            message: format!("the bridge call did not finish: {e}"),
        },
    }
}

/// A bridge Uxnan installs on a host opens no port: unless the account
/// already has a configuration of its own, it starts with its LAN listener and
/// mDNS off, and the phone reaches it through the user's relay — on a server,
/// publishing a port to its network is the owner's decision, made in
/// Settings, never a default. An existing file is the user's and is left as it
/// is.
fn closed_by_default() {
    if closed_by_default_in(&account_home().join(".uxnan")) {
        log::line("bridge: configured with its LAN listener off (the relay is the way in)");
    }
}

/// [`closed_by_default`] in the bridge state folder `dir`; whether it wrote.
fn closed_by_default_in(dir: &Path) -> bool {
    let file = dir.join("daemon-config.json");
    if file.exists() || std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    std::fs::write(
        &file,
        serde_json::json!({ "lanEnabled": false, "mdnsEnabled": false }).to_string(),
    )
    .is_ok()
}

#[derive(Default)]
struct Inner {
    /// Asked to keep it running.
    wish: bool,
    /// The bridge this daemon started, while it runs.
    child: Option<u32>,
    last_error: Option<String>,
    /// Ends the running supervision loop.
    stop: Option<tokio::sync::watch::Sender<bool>>,
}

/// Keeps the bridge running while asked to. One per daemon.
#[derive(Clone, Default)]
pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
}

impl Supervisor {
    /// Pick up the wish a previous daemon was left with.
    pub fn resume(&self) {
        let wish = std::fs::read_to_string(wish_file())
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| v.get("supervise").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        if wish {
            log::line("keeping the bridge running, as asked before");
            self.set(true);
        }
    }

    /// Whether the daemon has a reason to stay up for the bridge.
    pub fn busy(&self) -> bool {
        self.inner.lock().unwrap().wish
    }

    /// Start or stop keeping the bridge running, and remember it.
    pub fn set(&self, on: bool) {
        let previous = {
            let mut inner = self.inner.lock().unwrap();
            inner.wish = on;
            if !on {
                inner.last_error = None;
            }
            inner.stop.take()
        };
        if let Some(stop) = previous {
            let _ = stop.send(true);
        }
        let _ = crate::paths::ensure_private_dir(&crate::paths::home());
        let _ = std::fs::write(
            wish_file(),
            serde_json::json!({ "supervise": on }).to_string(),
        );
        if on {
            let (tx, rx) = tokio::sync::watch::channel(false);
            self.inner.lock().unwrap().stop = Some(tx);
            let this = self.clone();
            tokio::spawn(async move { this.run(rx).await });
        }
    }

    /// Where the bridge stands.
    pub fn state(&self) -> BridgeState {
        let dirs = crate::agents::search_dirs();
        let env = path_env(&dirs);
        let node = find(&dirs, "node").and_then(|n| version_line(&n, &env));
        let npm = find(&dirs, "npm").and_then(|n| version_line(&n, &env));
        let inner = self.inner.lock().unwrap();
        let running = running_pid();
        BridgeState {
            node,
            npm,
            install: find_install(&dirs),
            running,
            supervised: inner.child.is_some() && inner.child == running,
            supervise: inner.wish,
            last_error: inner.last_error.clone(),
        }
    }

    fn fail(&self, why: String) {
        let mut inner = self.inner.lock().unwrap();
        if inner.last_error.as_deref() != Some(why.as_str()) {
            log::line(&format!("bridge: {why}"));
        }
        inner.last_error = Some(why);
    }

    async fn run(&self, mut stop: tokio::sync::watch::Receiver<bool>) {
        let mut backoff = FIRST_BACKOFF;
        loop {
            if *stop.borrow() {
                return;
            }
            let wait = match self.start_once(&mut stop).await {
                Step::Stopped => return,
                Step::Wait(wait) => wait,
                Step::Ended(ran) => {
                    let wait = if ran < QUICK_EXIT {
                        backoff
                    } else {
                        FIRST_BACKOFF
                    };
                    backoff = if ran < QUICK_EXIT {
                        (backoff * 2).min(MAX_BACKOFF)
                    } else {
                        FIRST_BACKOFF
                    };
                    wait
                }
            };
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = stop.changed() => return,
            }
        }
    }

    async fn start_once(&self, stop: &mut tokio::sync::watch::Receiver<bool>) -> Step {
        // Somebody else's bridge (the user's own service, a terminal): leave
        // it be, and look again later.
        if let Some(pid) = running_pid() {
            if self.inner.lock().unwrap().child != Some(pid) {
                return Step::Wait(IDLE_LOOK);
            }
        }
        let dirs = crate::agents::search_dirs();
        let Some(install) = find_install(&dirs) else {
            self.fail("no bridge is installed on this machine".into());
            return Step::Wait(IDLE_LOOK);
        };
        let Some(node) = find(&dirs, "node") else {
            self.fail("Node.js was not found on this machine".into());
            return Step::Wait(IDLE_LOOK);
        };
        let log_path = bridge_log();
        if std::fs::metadata(&log_path)
            .map(|m| m.len() > LOG_CAP)
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(&log_path);
        }
        let Ok(out) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        else {
            self.fail(format!("could not open {}", log_path.display()));
            return Step::Wait(IDLE_LOOK);
        };
        let Ok(err) = out.try_clone() else {
            return Step::Wait(IDLE_LOOK);
        };
        let mut command = tokio::process::Command::new(&node);
        command
            .arg(&install.cli)
            .args(["start", "--service"])
            .env("PATH", path_env(&dirs))
            // Not a systemd unit: the bridge must not hand its update helper
            // to `systemd-run` as if it were one.
            .env_remove("INVOCATION_ID")
            .current_dir(account_home())
            .stdin(Stdio::null())
            .stdout(Stdio::from(out))
            .stderr(Stdio::from(err))
            .kill_on_drop(true);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(e) => {
                self.fail(format!("could not start the bridge: {e}"));
                return Step::Wait(IDLE_LOOK);
            }
        };
        let pid = child.id();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.child = pid;
            inner.last_error = None;
        }
        log::line(&format!(
            "bridge {} started ({} install, pid {})",
            install.version,
            install.kind,
            pid.unwrap_or(0)
        ));
        let started = Instant::now();
        let outcome = tokio::select! {
            status = child.wait() => {
                let ran = started.elapsed();
                log::line(&format!(
                    "bridge ended after {}s ({})",
                    ran.as_secs(),
                    status.map(|s| s.to_string()).unwrap_or_else(|e| e.to_string())
                ));
                Step::Ended(ran)
            }
            _ = stop.changed() => {
                stop_bridge(&mut child).await;
                log::line("bridge stopped: no longer asked to keep it running");
                Step::Stopped
            }
        };
        self.inner.lock().unwrap().child = None;
        outcome
    }
}

enum Step {
    Stopped,
    Wait(Duration),
    Ended(Duration),
}

/// End the bridge politely — its own shutdown saves state and releases the
/// lock — and hard only if it does not go.
async fn stop_bridge(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id().and_then(|p| libc::pid_t::try_from(p).ok()) {
        // SAFETY: a signal to the process this daemon started.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        if tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .is_ok()
        {
            return;
        }
    }
    let _ = child.kill().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_package(root: &Path, name: &str, version: &str) -> PathBuf {
        let cli = root.join("dist").join("src").join("cli.js");
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, "").unwrap();
        std::fs::write(
            root.join("package.json"),
            serde_json::json!({ "name": name, "version": version }).to_string(),
        )
        .unwrap();
        cli
    }

    #[test]
    fn a_version_is_read_only_from_the_bridges_own_package() {
        let dir = tempfile::tempdir().unwrap();
        let ours = fake_package(&dir.path().join("a"), "uxnan-bridge", "0.0.46");
        let other = fake_package(&dir.path().join("b"), "something-else", "9.9.9");
        assert_eq!(version_of(&ours).as_deref(), Some("0.0.46"));
        assert_eq!(version_of(&other), None);
        assert_eq!(
            version_of(&dir.path().join("missing/dist/src/cli.js")),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_command_on_path_leads_to_the_package_it_links_to() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_package(
            &dir.path().join("lib/node_modules/uxnan-bridge"),
            "uxnan-bridge",
            "0.0.46",
        );
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::os::unix::fs::symlink(&cli, bin.join("uxnan-bridge")).unwrap();
        assert_eq!(
            cli_behind(&bin.join("uxnan-bridge")),
            Some(std::fs::canonicalize(&cli).unwrap())
        );
    }

    #[test]
    fn a_new_install_opens_no_port_and_an_existing_configuration_is_kept() {
        let fresh = tempfile::tempdir().unwrap();
        let state = fresh.path().join(".uxnan");
        assert!(closed_by_default_in(&state));
        let written: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(state.join("daemon-config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(written["lanEnabled"], false);
        assert_eq!(written["mdnsEnabled"], false);

        // The user's own file is theirs: never rewritten.
        let theirs = tempfile::tempdir().unwrap();
        std::fs::write(
            theirs.path().join("daemon-config.json"),
            r#"{"lanEnabled":true}"#,
        )
        .unwrap();
        assert!(!closed_by_default_in(theirs.path()));
        assert_eq!(
            std::fs::read_to_string(theirs.path().join("daemon-config.json")).unwrap(),
            r#"{"lanEnabled":true}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_pid_of_a_process_that_is_gone_is_not_running() {
        assert!(alive(std::process::id()));
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!alive(pid));
    }
}
