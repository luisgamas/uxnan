//! The bridge as the user's service (architecture/02a §5.8.17).
//!
//! In `managed` mode Uxnan does not run the bridge as its own child any more:
//! it makes sure the bridge is installed as the user's service (launchd /
//! systemd --user / Task Scheduler — the bridge's own `install-service`), that
//! the service is running, and then only connects to it. So the bridge keeps
//! serving the phone while the desktop is closed, and closing the desktop never
//! stops it. Everything goes through the bridge's own CLI, which owns the
//! service definition: `service-status`, `install-service`, `service-start`,
//! `stop`.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;

/// How long one service command may take.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// `uxnan-bridge service-status`, as the bridge prints it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct ServiceStatus {
    /// The platform has a service manager the bridge supports.
    pub supported: bool,
    /// The service definition exists.
    pub installed: bool,
    /// A bridge holds the single-instance lock (the service, or one the user
    /// started by hand).
    pub running: bool,
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

async fn run(bin: &PathBuf, args: &[&str]) -> Result<String, ServiceError> {
    let mut cmd = crate::winproc::command(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(COMMAND_TIMEOUT, cmd.output())
        .await
        .map_err(|_| ServiceError::Failed(format!("`uxnan-bridge {}` timed out", args.join(" "))))?
        .map_err(|err| ServiceError::Failed(format!("could not run uxnan-bridge: {err}")))?;
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
pub async fn status(bin: &PathBuf) -> Result<ServiceStatus, ServiceError> {
    let out = run(bin, &["service-status"]).await?;
    parse_status(&out).ok_or(ServiceError::Outdated)
}

/// Install the service (idempotent: it rewrites the definition with the
/// bridge's current node and path, and starts it where the platform does).
pub async fn install(bin: &PathBuf) -> Result<(), ServiceError> {
    run(bin, &["install-service"]).await.map(|_| ())
}

/// Start the installed service now.
pub async fn start(bin: &PathBuf) -> Result<(), ServiceError> {
    run(bin, &["service-start"]).await.map(|_| ())
}

/// Stop whichever bridge holds the lock (`uxnan-bridge stop`). The service
/// is not restarted by its manager after a deliberate stop.
pub async fn stop(bin: &PathBuf) {
    let _ = run(bin, &["stop"]).await;
}

/// Make sure the bridge runs as the user's service: installed (or
/// re-installed when [`reinstall`], after an update) and started.
pub async fn ensure_running(bin: &PathBuf, reinstall: bool) -> Result<(), ServiceError> {
    let current = status(bin).await?;
    if !current.supported {
        return Err(ServiceError::Failed(
            "this system has no service manager the bridge supports".into(),
        ));
    }
    if !current.installed || reinstall {
        install(bin).await?;
    }
    // Windows only registers the logon task; launchd and systemd already
    // started it. Either way: running, or start it.
    if !status(bin).await?.running {
        start(bin).await?;
    }
    Ok(())
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
                running: true
            })
        );
        assert_eq!(
            parse_status(
                "warning: something\n{\"supported\":false,\"installed\":false,\"running\":false}"
            ),
            Some(ServiceStatus {
                supported: false,
                installed: false,
                running: false
            })
        );
        assert_eq!(parse_status("Unknown command: service-status"), None);
    }
}
