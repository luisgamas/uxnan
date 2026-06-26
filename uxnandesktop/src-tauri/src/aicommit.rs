//! Optional AI commit-message generation (spec `02c` §4.5).
//!
//! Spawns the user-configured CLI agent **non-interactively** (a one-shot
//! subprocess, *not* a PTY) with the worktree's staged diff and returns the
//! drafted message. The agent is whatever the user picked in Settings → AI
//! commit (e.g. `claude -p`, `codex exec`, `gemini -p`, `opencode run`): the
//! built prompt is appended as the final argument. No provider API/SDK/keys are
//! used — it drives the same local CLI the user already runs interactively.
//!
//! Guardrails: disabled by default; refuses when nothing is staged; caps the diff
//! fed to the agent; runs with stdin closed and a hard timeout (and
//! `kill_on_drop`) so a hung or prompt-blocked CLI can never wedge the app.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::error::AppError;
use crate::model::AiCommitSettings;

/// Maximum diff size (bytes) fed to the agent — keeps the prompt within CLI/arg
/// limits and avoids paying for a huge context on a sprawling changeset.
const MAX_DIFF_BYTES: usize = 24_000;

/// How long to wait for the agent before giving up.
const TIMEOUT: Duration = Duration::from_secs(120);

/// Generate a commit message for `worktree_path` using `cfg`. Reads the staged
/// diff, builds the prompt, runs the configured agent, and returns the sanitized
/// message (subject on the first line, optional body after a blank line).
pub async fn generate(worktree_path: &str, cfg: &AiCommitSettings) -> Result<String, AppError> {
    if !cfg.enabled {
        return Err(AppError::Invalid(
            "AI commit-message generation is disabled".to_string(),
        ));
    }
    let command = cfg.command.trim();
    if command.is_empty() {
        return Err(AppError::Invalid(
            "no AI agent is configured for commit messages".to_string(),
        ));
    }

    let diff = crate::git::staged_diff(worktree_path).await?;
    if diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "nothing is staged to summarize".to_string(),
        ));
    }

    let prompt = build_prompt(cfg, &diff);
    let raw = run_agent(command, &cfg.args, worktree_path, &prompt).await?;
    let message = sanitize_message(&raw);
    if message.is_empty() {
        return Err(AppError::Agent(
            "the agent returned an empty message".to_string(),
        ));
    }
    Ok(message)
}

/// Run `command args… prompt` in `cwd`, stdin closed, with a hard timeout; return
/// stdout. Maps a failed spawn / non-zero exit / timeout to [`AppError::Agent`].
async fn run_agent(
    command: &str,
    args: &[String],
    cwd: &str,
    prompt: &str,
) -> Result<String, AppError> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .arg(prompt)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to start '{command}': {e}")))?;

    let output = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Agent(e.to_string()))?,
        Err(_) => {
            return Err(AppError::Agent(format!(
                "'{command}' timed out after {}s",
                TIMEOUT.as_secs()
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        let detail = if detail.is_empty() {
            "no error output".to_string()
        } else {
            detail.chars().take(500).collect()
        };
        return Err(AppError::Agent(format!("'{command}' failed: {detail}")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Build the agent prompt from the config and the (capped) staged diff.
fn build_prompt(cfg: &AiCommitSettings, diff: &str) -> String {
    let mut p = String::new();
    p.push_str("Write a git commit message for the following staged changes.\n");
    if cfg.conventional {
        p.push_str(
            "Use the Conventional Commits format for the subject line \
             (e.g. `feat(scope): summary` / `fix: …` / `docs: …`).\n",
        );
    }
    p.push_str("Keep the subject line in the imperative mood and under 72 characters.\n");
    if cfg.include_body {
        p.push_str(
            "After the subject, add a blank line and a concise body explaining \
             what changed and why.\n",
        );
    } else {
        p.push_str("Output only the subject line — no body.\n");
    }
    let lang = cfg.language.trim();
    if !lang.is_empty() && !lang.eq_ignore_ascii_case("auto") {
        p.push_str(&format!("Write the message in {lang}.\n"));
    }
    let extra = cfg.instructions.trim();
    if !extra.is_empty() {
        p.push_str(&format!("Additional instructions: {extra}\n"));
    }
    p.push_str(
        "Output ONLY the commit message text — no code fences, no preamble, \
         no quotes, no explanation.\n\nStaged diff:\n",
    );
    p.push_str(&truncate_diff(diff, MAX_DIFF_BYTES));
    p
}

/// Truncate `diff` to at most `max` bytes on a char boundary, noting the cut so
/// the agent knows the input was clipped.
fn truncate_diff(diff: &str, max: usize) -> String {
    if diff.len() <= max {
        return diff.to_string();
    }
    let mut end = max;
    while end > 0 && !diff.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[diff truncated]…\n", &diff[..end])
}

/// Clean the agent's raw stdout into a bare commit message: trim whitespace and
/// strip a wrapping Markdown code fence if the agent added one despite the
/// instruction.
fn sanitize_message(raw: &str) -> String {
    let trimmed = raw.trim();
    let unfenced = if trimmed.starts_with("```") {
        // Drop the opening fence line (``` or ```lang) and any closing fence.
        let after_open = trimmed.split_once('\n').map(|x| x.1).unwrap_or("");
        after_open
            .trim_end()
            .strip_suffix("```")
            .unwrap_or(after_open)
            .trim()
    } else {
        trimmed
    };
    unfenced.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> AiCommitSettings {
        AiCommitSettings {
            enabled: true,
            command: "claude".into(),
            args: vec!["-p".into()],
            language: "auto".into(),
            conventional: true,
            include_body: true,
            instructions: String::new(),
        }
    }

    #[test]
    fn prompt_includes_conventional_body_and_diff() {
        let p = build_prompt(&cfg(), "diff --git a b\n+x");
        assert!(p.contains("Conventional Commits"));
        assert!(p.contains("concise body"));
        assert!(p.contains("diff --git a b"));
        // "auto" language adds no explicit language line.
        assert!(!p.to_lowercase().contains("write the message in auto"));
    }

    #[test]
    fn prompt_honors_language_no_body_and_instructions() {
        let c = AiCommitSettings {
            language: "Spanish".into(),
            include_body: false,
            conventional: false,
            instructions: "mention the ticket id".into(),
            ..cfg()
        };
        let p = build_prompt(&c, "diff");
        assert!(p.contains("Write the message in Spanish."));
        assert!(p.contains("Output only the subject line"));
        assert!(!p.contains("Conventional Commits"));
        assert!(p.contains("Additional instructions: mention the ticket id"));
    }

    #[test]
    fn truncate_diff_caps_on_char_boundary() {
        let big = "é".repeat(20_000); // 2 bytes each → 40k bytes
        let out = truncate_diff(&big, 100);
        assert!(out.len() <= 100 + "\n…[diff truncated]…\n".len());
        assert!(out.ends_with("…[diff truncated]…\n"));
        // A short diff is returned unchanged.
        assert_eq!(truncate_diff("small", 100), "small");
    }

    #[test]
    fn sanitize_strips_code_fence_and_whitespace() {
        assert_eq!(sanitize_message("  feat: x\n\nbody  "), "feat: x\n\nbody");
        assert_eq!(
            sanitize_message("```\nfeat: x\n\nbody\n```"),
            "feat: x\n\nbody"
        );
        assert_eq!(sanitize_message("```text\nfix: y\n```"), "fix: y");
    }
}
