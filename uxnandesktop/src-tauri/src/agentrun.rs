//! Headless (print-mode) agent runs for the orchestration engine (spec `02d`
//! §3, Stage B).
//!
//! Where the broadcast/interactive path types a message into a live agent's PTY
//! and can only read the coarse hook `summary`, a **headless** run drives the
//! same local CLI **non-interactively** (`agent -p …`, a one-shot subprocess) and
//! **owns the process** — so it captures the agent's full stdout *and* a verified
//! exit code. That verified completion (exit 0 = done, exit≠0 = failed) is what
//! lets the run engine chain steps robustly and detect failures, instead of
//! trusting a cooperative "I'm done" signal.
//!
//! Reuses the exact resolution + print-mode recipes the AI-commit generator uses
//! ([`crate::agentcli`]: `resolve` + `build_args` for Claude Code, Codex, Gemini,
//! OpenCode, Pi), the windowless spawn ([`crate::winproc`]), and the same
//! guardrails: stdin closed, a hard timeout with `kill_on_drop`, and a prompt cap
//! that keeps the command line within the OS argv limit.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use crate::agentcli;
use crate::error::AppError;

/// Cap on the prompt passed as a CLI argument. Windows' `CreateProcess` command
/// line is bounded (~32 KiB total); staying well under keeps a chained,
/// context-heavy prompt from overflowing the argv.
// FOR-DEV: large chained context is clipped by this cap — add a per-agent stdin
// variant for big prompts (pattern: `aicommit::codex_models_inner`). See FOR-DEV.md.
const MAX_PROMPT_BYTES: usize = 28_000;

/// Default wall-clock budget for a headless run when the caller doesn't pin one.
/// Headless steps can be real work (not just a model probe), so this is generous.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

/// The captured result of a headless run — the raw output plus the **verified**
/// process exit code (the run engine's completion signal).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessResult {
    pub stdout: String,
    pub stderr: String,
    /// Process exit code, or `None` if the process was terminated by a signal.
    pub exit_code: Option<i32>,
}

/// Run `agent_id` in print-mode against `prompt` in `cwd`, capturing stdout,
/// stderr and the exit code. `model` empty → the CLI's default model.
/// `timeout_ms` overrides [`DEFAULT_TIMEOUT`]. A non-zero exit is **not** an
/// error here (it's returned in `exit_code` so the engine can decide); only a
/// spawn failure, timeout, or an unsupported/uninstalled agent is an `Err`.
pub async fn run_headless(
    agent_id: &str,
    model: &str,
    prompt: &str,
    cwd: &str,
    timeout_ms: Option<u64>,
) -> Result<HeadlessResult, AppError> {
    let Some(resolved) = agentcli::resolve(agent_id) else {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    };
    let prompt = truncate_prompt(prompt, MAX_PROMPT_BYTES);
    let args = agentcli::build_args(agent_id, model, &prompt)
        .ok_or_else(|| AppError::Agent(format!("unsupported agent '{agent_id}'")))?;
    let timeout = timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);
    run(&resolved, &args, cwd, timeout).await
}

/// Spawn the resolved agent windowless, stdin closed, with a hard timeout and
/// `kill_on_drop`; capture stdout/stderr/exit. Mirrors `aicommit::run_generate`
/// but returns the raw capture (exit code included) instead of gating on success.
async fn run(
    resolved: &agentcli::Resolved,
    args: &[String],
    cwd: &str,
    timeout: Duration,
) -> Result<HeadlessResult, AppError> {
    let mut cmd = crate::winproc::command(&resolved.program);
    cmd.args(&resolved.prepend)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cwd.trim().is_empty() {
        // FOR-DEV: a `\\wsl$` worktree here runs the Windows CLI against the 9P
        // share (slow). Route WSL worktrees through `wsl.exe -d <distro>` with the
        // in-distro CLI (see `crate::wsl` + `git.rs`'s WSL path). See FOR-DEV.md.
        cmd.current_dir(cwd);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to start the agent: {e}")))?;

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Agent(e.to_string()))?,
        Err(_) => {
            return Err(AppError::Agent(format!(
                "the agent timed out after {}s",
                timeout.as_secs()
            )));
        }
    };

    Ok(HeadlessResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}

/// Truncate `prompt` to at most `max` bytes on a char boundary, noting the cut so
/// the agent knows its input was clipped (mirrors the AI-commit diff cap).
fn truncate_prompt(prompt: &str, max: usize) -> String {
    if prompt.len() <= max {
        return prompt.to_string();
    }
    let mut end = max;
    while end > 0 && !prompt.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[prompt truncated]…", &prompt[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_agent_errors_without_spawning() {
        let err = run_headless("definitely-not-an-agent", "", "hi", "", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Agent(_)));
    }

    #[test]
    fn truncate_prompt_caps_on_char_boundary() {
        // Multi-byte chars: cutting must land on a boundary, never mid-char.
        let big = "é".repeat(20_000); // 2 bytes each → 40k bytes
        let out = truncate_prompt(&big, 100);
        assert!(out.len() <= 100 + "\n…[prompt truncated]…".len());
        assert!(out.ends_with("…[prompt truncated]…"));
        // A short prompt is returned unchanged.
        assert_eq!(truncate_prompt("small", 100), "small");
    }

    #[test]
    fn headless_result_serializes_camel_case() {
        let r = HeadlessResult {
            stdout: "out".into(),
            stderr: "err".into(),
            exit_code: Some(0),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("exitCode"));
        assert!(!json.contains("exit_code"));
    }
}
