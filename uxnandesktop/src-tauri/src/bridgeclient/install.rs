//! Installing and updating the Uxnan bridge from the app, so a user who does
//! not have it yet never has to leave Uxnan to get chats working.
//!
//! The bridge is an npm package (`uxnan-bridge`), so installing it is exactly
//! what its README asks a person to type: `npm install -g uxnan-bridge@latest`.
//! The app runs that same command — only when the user presses the button,
//! never on its own unless they turned automatic updates on — streams its output
//! to the window (`bridge:install-log`), and reports how it ended. When it
//! cannot (no Node.js, npm refusing to write its global folder), it says why,
//! and the window offers the command to copy and run by hand instead.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

/// The npm package the bridge ships as.
pub const PACKAGE: &str = "uxnan-bridge";

/// Frontend event carrying one line of the install's output.
pub const LOG_EVENT: &str = "bridge:install-log";

/// The command the app runs — and the one it offers to copy.
pub fn install_command() -> String {
    format!("npm install -g {PACKAGE}@latest")
}

/// How long an install may take before it is abandoned.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
/// How long `uxnan-bridge version` / `node --version` may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
/// Output lines kept for the outcome (the whole log streams as it happens).
const TAIL_LINES: usize = 12;

/// What is on this machine, for Settings → Bridge & mobile and the chat gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    /// `uxnan-bridge` resolves on `PATH`.
    pub installed: bool,
    /// Its version, when it reports one (`uxnan-bridge version`; a bridge older
    /// than that command answers nothing usable, and this stays `None`).
    pub version: Option<String>,
    /// `npm` resolves on `PATH` — without it the app cannot install anything.
    pub npm: bool,
    /// `node --version`, when Node.js is there.
    pub node_version: Option<String>,
    /// The command to copy when the user would rather run it themselves.
    pub command: String,
}

/// How an install or update ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub ok: bool,
    /// The version installed now, when it could be read back.
    pub version: Option<String>,
    /// npm could not write its global folder (EACCES / EPERM): the fix is the
    /// user's — run the command in a terminal, or point npm at a user prefix.
    pub permission_denied: bool,
    /// The last lines of output, for the error message.
    pub tail: Vec<String>,
}

/// Looks for the bridge, npm and Node.js. Cheap: resolving on `PATH` and two
/// `--version` calls; never starts a bridge.
pub async fn probe() -> InstallInfo {
    let bridge = crate::which::resolve(PACKAGE);
    let version = installed_version().await;
    let node_version = match crate::which::resolve("node") {
        Some(node) => first_line_of(node, &["--version"]).await,
        None => None,
    };
    InstallInfo {
        installed: bridge.is_some(),
        version,
        npm: crate::which::resolve("npm").is_some(),
        node_version,
        command: install_command(),
    }
}

/// Runs `npm install -g uxnan-bridge@latest`, streaming each output line to the
/// window, and reads the installed version back when it succeeds.
pub async fn install(app: &AppHandle) -> InstallOutcome {
    let Some(npm) = crate::which::resolve("npm") else {
        return InstallOutcome {
            ok: false,
            version: None,
            permission_denied: false,
            tail: vec!["npm was not found on PATH — install Node.js 18 or newer first.".into()],
        };
    };
    let mut cmd = crate::winproc::command(npm);
    cmd.args(["install", "-g", &format!("{PACKAGE}@latest")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            return InstallOutcome {
                ok: false,
                version: None,
                permission_denied: false,
                tail: vec![format!("could not run npm: {err}")],
            }
        }
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });
    }
    drop(tx);

    let mut tail: Vec<String> = Vec::new();
    let collect = async {
        while let Some(line) = rx.recv().await {
            let _ = app.emit(LOG_EVENT, &line);
            tail.push(line);
            if tail.len() > TAIL_LINES * 4 {
                tail.drain(..tail.len() - TAIL_LINES);
            }
        }
        child.wait().await
    };
    let status = match tokio::time::timeout(INSTALL_TIMEOUT, collect).await {
        Ok(Ok(status)) => Some(status),
        _ => None,
    };
    let keep = tail.len().saturating_sub(TAIL_LINES);
    let tail: Vec<String> = tail.split_off(keep);
    let ok = status.map(|s| s.success()).unwrap_or(false);
    let permission_denied = !ok && mentions_permission_error(&tail);
    let version = if ok { installed_version().await } else { None };
    InstallOutcome {
        ok,
        version,
        permission_denied,
        tail,
    }
}

/// The version of the `uxnan-bridge` on `PATH` (`uxnan-bridge version`), or
/// `None` when it is missing or too old to have that command — the bridges
/// released before the desktop's local channel.
pub async fn installed_version() -> Option<String> {
    let path = crate::which::resolve(PACKAGE)?;
    first_line_of(path, &["version"])
        .await
        .and_then(parse_version)
}

/// The first non-empty stdout line of `program args`, bounded in time.
async fn first_line_of(program: PathBuf, args: &[&str]) -> Option<String> {
    let mut cmd = crate::winproc::command(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

/// Accepts a SemVer-looking version (`0.0.27`, `0.0.27-alpha.20260924`);
/// anything else — a usage text from a bridge too old for `version` — is none.
pub fn parse_version(line: String) -> Option<String> {
    let v = line.trim().trim_start_matches('v');
    let mut parts = v.splitn(3, '.');
    let (major, minor, rest) = (parts.next()?, parts.next()?, parts.next()?);
    let patch: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let numeric = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if numeric(major) && numeric(minor) && numeric(&patch) && v.len() <= 64 {
        Some(v.to_string())
    } else {
        None
    }
}

/// Whether npm's output says it could not write where it installs globally.
pub fn mentions_permission_error(lines: &[String]) -> bool {
    lines.iter().any(|l| {
        let l = l.to_ascii_uppercase();
        l.contains("EACCES") || l.contains("EPERM") || l.contains("PERMISSION DENIED")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_and_rejects_everything_else() {
        assert_eq!(parse_version("0.0.27".into()), Some("0.0.27".into()));
        assert_eq!(
            parse_version("0.0.27-alpha.20260924\n".into()),
            Some("0.0.27-alpha.20260924".into())
        );
        assert_eq!(parse_version("v1.2.3".into()), Some("1.2.3".into()));
        assert_eq!(parse_version("uxnan-bridge v0.0.26".into()), None);
        assert_eq!(parse_version("Unknown command: version".into()), None);
        assert_eq!(parse_version("1.2".into()), None);
    }

    #[test]
    fn recognizes_npm_permission_failures() {
        let denied = vec![
            "npm error code EACCES".to_string(),
            "npm error syscall mkdir".to_string(),
        ];
        assert!(mentions_permission_error(&denied));
        assert!(!mentions_permission_error(&[
            "npm error code E404".to_string()
        ]));
    }

    #[test]
    fn offers_the_same_command_it_runs() {
        assert_eq!(install_command(), "npm install -g uxnan-bridge@latest");
    }

    #[tokio::test]
    async fn probe_never_fails_and_always_carries_the_command() {
        let info = probe().await;
        assert_eq!(info.command, install_command());
        if !info.installed {
            assert_eq!(info.version, None);
        }
    }
}
