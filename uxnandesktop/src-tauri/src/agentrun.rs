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
//! Built on [`crate::agentcli`] (`resolve` + `build_args`) and the windowless
//! spawn ([`crate::winproc`]), with a hard timeout, `kill_on_drop`, and a prompt
//! cap for the agents whose only channel is the command line. **This is the one
//! one-shot runner**: AI commit messages and AI PR bodies
//! ([`crate::aicommit`]) and automation steps go through it too, so they all get
//! the same prompt-delivery handling instead of each re-deriving it.
//!
//! How each CLI is handed its prompt is not incidental: an `argv` prompt is
//! bounded by the OS, and a chained step planting the previous step's whole
//! output hits that ceiling easily — losing the tail of its own context in
//! silence. Agents that read stdin (Claude, Codex, OpenCode, Pi) or a prompt
//! file (Grok, Zero) therefore get the whole thing.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use crate::agentcli;
use crate::error::AppError;

/// Cap on a prompt passed as a CLI **argument**. Windows' `CreateProcess`
/// command line is bounded (~32 KiB total), so this only applies to the agents
/// that accept the prompt no other way; everything else takes it via stdin or a
/// prompt file and is uncapped (see [`agentcli::prompt_delivery`]).
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
/// `autonomous` adds the CLI's auto-approve flag (see
/// [`agentcli::build_args`]) — required for a step that must actually use
/// tools, and opt-in for exactly that reason.
/// `timeout_ms` overrides [`DEFAULT_TIMEOUT`]. A non-zero exit is **not** an
/// error here (it's returned in `exit_code` so the engine can decide); only a
/// spawn failure, timeout, or an unsupported/uninstalled agent is an `Err`.
/// `extra` are CLI arguments beyond the model and the autonomy posture, placed
/// before the prompt (see [`agentcli::build_args`]) — how the title runner pins
/// Codex to its lowest reasoning effort.
#[allow(clippy::too_many_arguments)]
pub async fn run_headless(
    agent_id: &str,
    model: &str,
    prompt: &str,
    cwd: &str,
    timeout_ms: Option<u64>,
    autonomous: bool,
    extra: &[String],
) -> Result<HeadlessResult, AppError> {
    let Some(resolved) = agentcli::resolve(agent_id) else {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    };
    let timeout = timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);

    // How the prompt travels decides whether it can be long at all. Only the
    // argv path is capped; stdin and a prompt file carry the whole thing, which
    // is what a chained step planting a previous step's full output needs.
    match agentcli::prompt_delivery(agent_id) {
        agentcli::PromptDelivery::Stdin => {
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::Stdin,
                autonomous,
                extra,
            )?;
            run(&resolved, &args, cwd, timeout, Some(prompt)).await
        }
        agentcli::PromptDelivery::File => {
            let file = PromptFile::write(prompt)?;
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::File(&file.path_str),
                autonomous,
                extra,
            )?;
            // The file must outlive the run; `PromptFile` removes it on drop.
            run(&resolved, &args, cwd, timeout, None).await
        }
        agentcli::PromptDelivery::Argv => {
            let capped = truncate_prompt(prompt, MAX_PROMPT_BYTES);
            let args = build(
                agent_id,
                model,
                agentcli::PromptSource::Argv(&capped),
                autonomous,
                extra,
            )?;
            run(&resolved, &args, cwd, timeout, None).await
        }
    }
}

fn build(
    agent_id: &str,
    model: &str,
    prompt: agentcli::PromptSource<'_>,
    autonomous: bool,
    extra: &[String],
) -> Result<Vec<String>, AppError> {
    agentcli::build_args(agent_id, model, prompt, autonomous, extra)
        .ok_or_else(|| AppError::Agent(format!("unsupported agent '{agent_id}'")))
}

/// A temporary file holding a prompt, removed when it goes out of scope so a
/// timed-out or panicking run can't leave the user's prompts lying around in
/// `%TEMP%`.
struct PromptFile {
    path: std::path::PathBuf,
    path_str: String,
}

impl PromptFile {
    fn write(prompt: &str) -> Result<Self, AppError> {
        let path = std::env::temp_dir().join(format!("uxnan-prompt-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, prompt.as_bytes())
            .map_err(|e| AppError::Agent(format!("could not stage the prompt: {e}")))?;
        Ok(Self {
            path_str: path.to_string_lossy().to_string(),
            path,
        })
    }
}

impl Drop for PromptFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Spawn the resolved agent windowless, with a hard timeout and `kill_on_drop`;
/// capture stdout/stderr/exit. Returns the raw capture (exit code included)
/// rather than gating on success — the run engine decides what a non-zero exit
/// means, and `aicommit` turns it into an error carrying the CLI's stderr.
///
/// `stdin_prompt` is written to the child and the pipe then closed, which is how
/// the CLIs that read their prompt from stdin know the input is complete. When
/// it is `None` stdin is closed outright, so nothing can ever sit waiting on it.
async fn run(
    resolved: &agentcli::Resolved,
    args: &[String],
    cwd: &str,
    timeout: Duration,
    stdin_prompt: Option<&str>,
) -> Result<HeadlessResult, AppError> {
    use tokio::io::AsyncWriteExt;

    let mut cmd = crate::winproc::command(&resolved.program);
    cmd.args(&resolved.prepend)
        .args(args)
        .stdin(if stdin_prompt.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cwd.trim().is_empty() {
        // FOR-DEV: a `\\wsl$` worktree here runs the Windows CLI against the 9P
        // share (slow). Route WSL worktrees through `wsl.exe -d <distro>` with the
        // in-distro CLI (see `crate::wsl` + `git.rs`'s WSL path). See FOR-DEV.md.
        cmd.current_dir(cwd);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to start the agent: {e}")))?;

    if let Some(text) = stdin_prompt {
        // Take the handle so it drops here: the close is the CLI's EOF, and
        // without it the agent would wait for more input forever.
        if let Some(mut sink) = child.stdin.take() {
            sink.write_all(text.as_bytes())
                .await
                .map_err(|e| AppError::Agent(format!("could not send the prompt: {e}")))?;
            sink.shutdown().await.ok();
        }
    }

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
        let err = run_headless("definitely-not-an-agent", "", "hi", "", None, false, &[])
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
