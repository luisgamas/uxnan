//! Optional AI commit-message generation (spec `02c` §4.5).
//!
//! Drives one of the supported coding-agent CLIs (Claude Code, Codex, Gemini,
//! OpenCode, Pi — resolved by [`crate::agentcli`]) **non-interactively** (a
//! one-shot subprocess, *not* a PTY) with the worktree's staged diff, and returns
//! the drafted message. The user only picks an **agent** and a **model** in
//! Settings → AI commit; no command/flags to configure. No provider API/SDK/keys
//! — it runs the same local CLI the user already uses interactively.
//!
//! Guardrails: disabled by default; refuses when the agent isn't installed or
//! nothing is staged; caps the diff fed to the agent; runs with stdin closed and
//! a hard timeout (and `kill_on_drop`) so a hung CLI can never wedge the app.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::agentcli::{self, AgentModel};
use crate::error::AppError;
use crate::model::{AiCommitSettings, GithubSettings};

/// Maximum diff size (bytes) fed to the agent — keeps the prompt within CLI/arg
/// limits and avoids paying for a huge context on a sprawling changeset.
const MAX_DIFF_BYTES: usize = 24_000;

/// How long to wait for a generation run before giving up.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(120);

/// How long to wait for a model-list query before giving up.
const LIST_TIMEOUT: Duration = Duration::from_secs(15);

/// Which of the supported agents are installed in a runnable shape right now.
pub fn available_agents() -> Vec<String> {
    agentcli::SUPPORTED
        .iter()
        .filter(|id| agentcli::resolve(id).is_some())
        .map(|id| id.to_string())
        .collect()
}

/// The models offered by `agent_id`: a static set for Claude/Gemini, or a live
/// query for OpenCode (`opencode models`), Pi (`pi --list-models`) and Codex
/// (`codex app-server` `model/list`).
///
/// A discovery **failure is surfaced**, not flattened to an empty list: the two
/// mean different things to the user ("this CLI is broken / not signed in" vs
/// "this agent offers no models"), and collapsing them is what made a broken
/// OpenCode look like an agent with nothing to pick. An empty-but-successful
/// list still just means no models — the UI offers the CLI's "Default" anyway.
pub async fn list_models(agent_id: &str) -> Result<Vec<AgentModel>, AppError> {
    let Some(resolved) = agentcli::resolve(agent_id) else {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    };
    let models = match agent_id {
        "claude" | "gemini" => agentcli::static_models(agent_id),
        "opencode" => {
            // stderr included so a broken install's own complaint reaches the user.
            let out = run_list(&resolved, &["models"], false).await?;
            agentcli::parse_opencode_models(&out)
        }
        "pi" => {
            // pi prints its table to stdout; stderr is captured too so a warning
            // that precedes it isn't lost.
            let out = run_list(&resolved, &["--list-models"], true).await?;
            agentcli::parse_pi_models(&out)
        }
        "codex" => codex_models(&resolved).await,
        _ => vec![],
    };
    Ok(models)
}

/// Generate a commit message for `worktree_path` using `cfg`. Reads the staged
/// diff, builds the prompt, runs the configured agent, and returns the sanitized
/// message (subject on the first line, optional body after a blank line).
pub async fn generate(worktree_path: &str, cfg: &AiCommitSettings) -> Result<String, AppError> {
    if !cfg.enabled {
        return Err(AppError::Invalid(
            "AI commit-message generation is disabled".to_string(),
        ));
    }
    let agent = cfg.agent_id.trim();
    let Some(resolved) = agentcli::resolve(agent) else {
        return Err(AppError::Agent(format!(
            "the selected agent ('{agent}') isn't installed"
        )));
    };

    let diff = crate::git::staged_diff(worktree_path).await?;
    if diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "nothing is staged to summarize".to_string(),
        ));
    }

    let prompt = build_prompt(cfg, &diff);
    let args = agentcli::build_args(agent, &cfg.model, &prompt)
        .ok_or_else(|| AppError::Agent(format!("unsupported agent '{agent}'")))?;

    let raw = run_generate(&resolved, &args, worktree_path).await?;
    let message = sanitize_message(&raw);
    if message.is_empty() {
        return Err(AppError::Agent(
            "the agent returned an empty message".to_string(),
        ));
    }
    Ok(message)
}

/// Draft a GitHub pull-request description (Markdown) from a branch `diff`, using
/// the GitHub-settings AI agent. Reuses the same one-shot, non-interactive agent
/// runner as commit generation — no provider API/keys. The caller supplies the
/// diff (branch-vs-base). Returns the sanitized body.
pub async fn draft_pr(
    worktree_path: &str,
    cfg: &GithubSettings,
    diff: &str,
) -> Result<String, AppError> {
    if !cfg.ai_enabled {
        return Err(AppError::Invalid("AI PR authoring is disabled".to_string()));
    }
    let agent = cfg.ai_agent_id.as_deref().unwrap_or("").trim();
    if agent.is_empty() {
        return Err(AppError::Invalid("no AI agent configured".to_string()));
    }
    let Some(resolved) = agentcli::resolve(agent) else {
        return Err(AppError::Agent(format!(
            "the selected agent ('{agent}') isn't installed"
        )));
    };
    if diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "no changes to summarize for the PR".to_string(),
        ));
    }
    let prompt = build_pr_prompt(cfg, diff);
    let model = cfg.ai_model.as_deref().unwrap_or("");
    let args = agentcli::build_args(agent, model, &prompt)
        .ok_or_else(|| AppError::Agent(format!("unsupported agent '{agent}'")))?;
    let raw = run_generate(&resolved, &args, worktree_path).await?;
    let body = sanitize_message(&raw);
    if body.is_empty() {
        return Err(AppError::Agent(
            "the agent returned an empty description".to_string(),
        ));
    }
    Ok(body)
}

/// Build the PR-body prompt. Pure, so the knobs are unit-tested without spawning
/// a CLI (mirrors [`build_prompt`] for commit messages).
fn build_pr_prompt(cfg: &GithubSettings, diff: &str) -> String {
    let mut p = String::from(
        "Write a GitHub pull request description in Markdown for the following \
         changes. Start with a one-sentence summary, then a short bullet list of \
         what changed and why. Do not include a title line or a code fence around \
         the whole thing.\n",
    );
    let lang = cfg.ai_language.trim();
    if !lang.is_empty() && !lang.eq_ignore_ascii_case("auto") {
        p.push_str(&format!("Write the description in {lang}.\n"));
    }
    let extra = cfg.ai_instructions.trim();
    if !extra.is_empty() {
        p.push_str(&format!("Additional instructions: {extra}\n"));
    }
    p.push_str(
        "Output ONLY the description text — no code fences, no preamble, \
         no explanation.\n\nBranch diff:\n",
    );
    p.push_str(&truncate_diff(diff, MAX_DIFF_BYTES));
    p
}

/// Run the resolved agent for a generation turn (stdin closed, hard timeout,
/// `kill_on_drop`); return stdout. Maps spawn / non-zero exit / timeout to
/// [`AppError::Agent`].
async fn run_generate(
    resolved: &agentcli::Resolved,
    args: &[String],
    cwd: &str,
) -> Result<String, AppError> {
    let mut cmd = crate::winproc::command(&resolved.program);
    cmd.args(&resolved.prepend)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to start the agent: {e}")))?;

    let output = match tokio::time::timeout(GENERATE_TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Agent(e.to_string()))?,
        Err(_) => {
            return Err(AppError::Agent(format!(
                "the agent timed out after {}s",
                GENERATE_TIMEOUT.as_secs()
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
        return Err(AppError::Agent(format!("the agent failed: {detail}")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run a one-shot model-list command and return its stdout.
///
/// A **non-zero exit is an error**, carrying the CLI's own stderr. That matters:
/// a broken install (e.g. an `opencode.exe` whose postinstall never ran, which
/// prints its complaint to stderr and exits 1 with empty stdout) used to be
/// swallowed here and reach the UI as an empty model list — indistinguishable
/// from "this agent has no models". The message is what tells the two apart.
async fn run_list(
    resolved: &agentcli::Resolved,
    extra: &[&str],
    include_stderr: bool,
) -> Result<String, AppError> {
    let mut cmd = crate::winproc::command(&resolved.program);
    cmd.args(&resolved.prepend)
        .args(extra)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("{} could not be started: {e}", resolved.program)))?;
    let output = tokio::time::timeout(LIST_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            AppError::Agent(format!(
                "listing models timed out after {}s",
                LIST_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| AppError::Agent(e.to_string()))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let detail = if stderr.is_empty() {
            format!("exited with status {}", output.status)
        } else {
            stderr
        };
        return Err(AppError::Agent(detail));
    }
    let mut s = String::from_utf8_lossy(&output.stdout).to_string();
    if include_stderr {
        s.push('\n');
        s.push_str(&stderr);
    }
    Ok(s)
}

/// Query Codex's models via a minimal `codex app-server` JSON-RPC handshake
/// (`initialize` → `model/list`), bounded by [`LIST_TIMEOUT`]. Any error yields
/// an empty list (the frontend still offers "Default").
async fn codex_models(resolved: &agentcli::Resolved) -> Vec<AgentModel> {
    codex_models_inner(resolved).await.unwrap_or_default()
}

async fn codex_models_inner(resolved: &agentcli::Resolved) -> Option<Vec<AgentModel>> {
    let mut child = crate::winproc::command(&resolved.program)
        .args(&resolved.prepend)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;

    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;

    let work = async {
        let mut lines = BufReader::new(stdout).lines();

        // 1) initialize, then wait for its response (id:1).
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"uxnan-desktop","title":null,"version":"1.0.0"}}}"#;
        stdin.write_all(init.as_bytes()).await.ok()?;
        stdin.write_all(b"\n").await.ok()?;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.get("id") == Some(&serde_json::json!(1)) {
                    break;
                }
            }
        }

        // 2) model/list, then read until its response (id:2).
        let list = r#"{"jsonrpc":"2.0","id":2,"method":"model/list","params":{}}"#;
        stdin.write_all(list.as_bytes()).await.ok()?;
        stdin.write_all(b"\n").await.ok()?;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.get("id") == Some(&serde_json::json!(2)) {
                    let data = v.get("result").and_then(|r| r.get("data"))?;
                    return Some(agentcli::parse_codex_models(data));
                }
            }
        }
        None
    };

    let result = tokio::time::timeout(LIST_TIMEOUT, work)
        .await
        .ok()
        .flatten();
    let _ = child.kill().await;
    result
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
            agent_id: "claude".into(),
            model: String::new(),
            language: "auto".into(),
            conventional: true,
            include_body: true,
            instructions: String::new(),
        }
    }

    fn gh_cfg() -> GithubSettings {
        GithubSettings {
            ai_enabled: true,
            ai_agent_id: Some("claude".into()),
            ..GithubSettings::default()
        }
    }

    #[test]
    fn pr_prompt_includes_diff_and_no_language_line_on_auto() {
        let p = build_pr_prompt(&gh_cfg(), "diff --git a b\n+x");
        assert!(p.contains("pull request description in Markdown"));
        assert!(p.contains("diff --git a b"));
        // The default language is "auto" — it must not leak in as a literal.
        assert!(!p.to_lowercase().contains("write the description in auto"));
    }

    #[test]
    fn pr_prompt_honors_language_and_instructions() {
        let c = GithubSettings {
            ai_language: "Spanish".into(),
            ai_instructions: "link the issue".into(),
            ..gh_cfg()
        };
        let p = build_pr_prompt(&c, "diff");
        assert!(p.contains("Write the description in Spanish."));
        assert!(p.contains("Additional instructions: link the issue"));
    }

    #[tokio::test]
    async fn draft_pr_refuses_when_disabled() {
        // The master switch gates the backend too, not just the button's visibility.
        let c = GithubSettings {
            ai_enabled: false,
            ..gh_cfg()
        };
        assert!(draft_pr(".", &c, "diff").await.is_err());
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
