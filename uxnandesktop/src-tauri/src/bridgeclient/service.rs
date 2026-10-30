//! The bridge as the user's service (architecture/02a §5.8.17).
//!
//! In `managed` mode Uxnan does not run the bridge as its own child: it makes
//! sure the bridge is installed as the user's service (launchd / systemd
//! --user / Task Scheduler — the bridge's own `install-service`), that the
//! service is running, and then only connects to it. So the bridge keeps
//! serving the phone while the desktop is closed, and closing the desktop never
//! stops it. Everything goes through the bridge's own CLI, which owns the
//! service definition: `service-status`, `install-service`, `service-start`,
//! `uninstall-service`, `stop`, `version`.
//!
//! The CLI is either a runtime's `node` + `cli.js` (the one Uxnan ships,
//! `runtime.rs`) or an independent `uxnan-bridge` on `PATH` (npm) —
//! [`BridgeCli`] runs both the same way.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;

/// How long one service command may take.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// A bridge CLI to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeCli {
    /// A runtime's own Node and `cli.js` (absolute paths).
    Runtime { node: PathBuf, cli: PathBuf },
    /// `uxnan-bridge` resolved on `PATH` (an npm install).
    Path(PathBuf),
}

impl BridgeCli {
    /// The CLI of a runtime folder.
    pub fn runtime(runtime: &super::runtime::Runtime) -> Self {
        BridgeCli::Runtime {
            node: runtime.node.clone(),
            cli: runtime.cli.clone(),
        }
    }

    /// The CLI a registered service runs, when its files are still there.
    pub fn of_program(program: &ServiceProgram) -> Option<Self> {
        let (node, cli) = (PathBuf::from(&program.node), PathBuf::from(&program.cli));
        (node.is_file() && cli.is_file()).then_some(BridgeCli::Runtime { node, cli })
    }

    /// The `cli.js` it runs, when known.
    pub fn cli_path(&self) -> Option<&Path> {
        match self {
            BridgeCli::Runtime { cli, .. } => Some(cli),
            BridgeCli::Path(_) => None,
        }
    }

    fn command(&self, args: &[&str]) -> tokio::process::Command {
        let mut cmd = match self {
            BridgeCli::Runtime { node, cli } => {
                let mut cmd = crate::winproc::command(node);
                cmd.arg(cli);
                cmd
            }
            BridgeCli::Path(bin) => crate::winproc::command(bin),
        };
        cmd.args(args);
        cmd
    }
}

/// What a registered service runs (`service-status` → `program`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ServiceProgram {
    pub node: String,
    pub cli: String,
}

/// `uxnan-bridge service-status`, as the bridge prints it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ServiceStatus {
    /// The platform has a service manager the bridge supports.
    pub supported: bool,
    /// The service definition exists.
    pub installed: bool,
    /// A bridge holds the single-instance lock (the service, or one the user
    /// started by hand).
    pub running: bool,
    /// What the registered service runs. Absent from a bridge older than the
    /// field, or with no service registered.
    #[serde(default)]
    pub program: Option<ServiceProgram>,
}

/// Why the service could not be brought up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceError {
    /// The installed bridge has no service commands: it predates them.
    Outdated,
    /// A command failed; the text is safe to show.
    Failed(String),
}

/// Parse the one JSON line `service-status` prints.
pub fn parse_status(stdout: &str) -> Option<ServiceStatus> {
    stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('{'))
        .and_then(|l| serde_json::from_str(l).ok())
}

async fn run(cli: &BridgeCli, args: &[&str]) -> Result<String, ServiceError> {
    let mut cmd = cli.command(args);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(COMMAND_TIMEOUT, cmd.output())
        .await
        .map_err(|_| ServiceError::Failed(format!("`uxnan-bridge {}` timed out", args.join(" "))))?
        .map_err(|err| ServiceError::Failed(format!("could not run the bridge: {err}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("Unknown command") {
        return Err(ServiceError::Outdated);
    }
    let reason = stderr
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("it failed")
        .chars()
        .take(300)
        .collect::<String>();
    Err(ServiceError::Failed(format!(
        "`uxnan-bridge {}`: {reason}",
        args.join(" ")
    )))
}

/// The service's state.
pub async fn status(cli: &BridgeCli) -> Result<ServiceStatus, ServiceError> {
    let out = run(cli, &["service-status"]).await?;
    parse_status(&out).ok_or(ServiceError::Outdated)
}

/// The CLI's version (`uxnan-bridge version`), when it reports one.
pub async fn version(cli: &BridgeCli) -> Option<String> {
    let out = run(cli, &["version"]).await.ok()?;
    out.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .and_then(|l| parse_version(l.to_string()))
}

/// Install the service with this CLI (idempotent: it rewrites the definition
/// with this CLI's node and path, and starts it where the platform does).
pub async fn install(cli: &BridgeCli) -> Result<(), ServiceError> {
    run(cli, &["install-service"]).await.map(|_| ())
}

/// Remove the service definition (and the entries it kept in agents' configs).
pub async fn uninstall(cli: &BridgeCli) -> Result<(), ServiceError> {
    run(cli, &["uninstall-service"]).await.map(|_| ())
}

/// Start the installed service now.
pub async fn start(cli: &BridgeCli) -> Result<(), ServiceError> {
    run(cli, &["service-start"]).await.map(|_| ())
}

/// Stop whichever bridge holds the lock (`uxnan-bridge stop`). The service
/// is not restarted by its manager after a deliberate stop.
pub async fn stop(cli: &BridgeCli) {
    let _ = run(cli, &["stop"]).await;
}

/// Register `cli` as the service and make sure it runs.
pub async fn register(cli: &BridgeCli) -> Result<(), ServiceError> {
    let current = status(cli).await?;
    if !current.supported {
        return Err(ServiceError::Failed(
            "this system has no service manager the bridge supports".into(),
        ));
    }
    install(cli).await?;
    // Windows only registers the logon task; launchd and systemd already
    // started it. Either way: running, or start it.
    if !status(cli).await?.running {
        start(cli).await?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_status_line_among_any_noise() {
        assert_eq!(
            parse_status("{\"supported\":true,\"installed\":false,\"running\":true,\"pid\":12}\n"),
            Some(ServiceStatus {
                supported: true,
                installed: false,
                running: true,
                program: None,
            })
        );
        assert_eq!(
            parse_status(
                "warning: something\n{\"supported\":false,\"installed\":false,\"running\":false}"
            ),
            Some(ServiceStatus {
                supported: false,
                installed: false,
                running: false,
                program: None,
            })
        );
        assert_eq!(parse_status("Unknown command: service-status"), None);
    }

    #[test]
    fn reads_the_program_a_service_runs() {
        let status = parse_status(
            r#"{"supported":true,"installed":true,"running":false,"program":{"node":"/r/node/bin/node","cli":"/r/app/cli.js"}}"#,
        )
        .unwrap();
        assert_eq!(
            status.program,
            Some(ServiceProgram {
                node: "/r/node/bin/node".into(),
                cli: "/r/app/cli.js".into()
            })
        );
        // A program whose files are gone is no CLI to run.
        assert_eq!(
            BridgeCli::of_program(status.program.as_ref().unwrap()),
            None
        );
    }

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

    #[tokio::test]
    async fn a_missing_cli_fails_cleanly() {
        let cli = BridgeCli::Path(PathBuf::from("/nonexistent/uxnan-bridge"));
        assert!(matches!(status(&cli).await, Err(ServiceError::Failed(_))));
        assert_eq!(version(&cli).await, None);
    }
}
