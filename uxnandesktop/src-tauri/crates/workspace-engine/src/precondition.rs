//! An automation's gate: a cheap shell command that decides whether a run is
//! worth an agent (`architecture/02f`). Here, in the workspace engine, so a
//! host's engine runs the gate of an automation that works there, in that
//! machine's shell, with the same code the app runs locally.

use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::Error;

/// The captured result of running the precondition command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreconditionResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

impl PreconditionResult {
    /// Only a clean exit 0 lets the run proceed.
    pub fn passed(&self) -> bool {
        !self.timed_out && self.exit_code == Some(0)
    }
}

/// Run the precondition command in `cwd`, capturing everything so a skipped run
/// can explain itself. Uses the shell so a user can write a normal one-liner.
pub async fn run(
    command: &str,
    timeout_seconds: u32,
    cwd: &str,
) -> Result<PreconditionResult, Error> {
    let started = Instant::now();
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
        ("cmd", vec!["/C", command])
    } else {
        ("sh", vec!["-c", command])
    };
    let mut cmd = crate::winproc::command(program);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cwd.trim().is_empty() {
        cmd.current_dir(cwd);
    }

    let child = cmd
        .spawn()
        .map_err(|e| Error::Invalid(format!("failed to run the precondition: {e}")))?;

    let timeout = Duration::from_secs(u64::from(timeout_seconds));
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => {
            let output = res.map_err(|e| Error::Invalid(e.to_string()))?;
            Ok(PreconditionResult {
                command: command.to_string(),
                exit_code: output.status.code(),
                timed_out: false,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                duration_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(_) => Ok(PreconditionResult {
            command: command.to_string(),
            exit_code: None,
            timed_out: true,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: started.elapsed().as_millis() as u64,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn precondition_reports_a_non_zero_exit() {
        // A real subprocess: the gate must distinguish "go" from "don't".
        let ok = run("exit 0", 10, "").await.unwrap();
        assert!(ok.passed());

        let no = run("exit 3", 10, "").await.unwrap();
        assert!(!no.passed());
        assert_eq!(no.exit_code, Some(3));
        assert!(!no.timed_out);
    }
}
