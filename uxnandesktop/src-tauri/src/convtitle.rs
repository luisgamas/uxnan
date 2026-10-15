//! Naming a conversation.
//!
//! Every agent CLI leaves titling to its client — Codex Desktop, the OpenCode
//! TUI and Claude's own picker all name conversations themselves, and the
//! headless surfaces expose no title of their own. uxnan is the client here, so
//! uxnan names them, instead of labelling a session with whatever the user
//! happened to type first (two sessions opened with the same phrase are then
//! indistinguishable in the panel and on the tab strip).
//!
//! Same shape as [`crate::aicommit`], and deliberately reusing its one-shot
//! runner: no provider API, no keys, just the agent's own CLI running under the
//! account the user already authenticated it with.

use std::time::Duration;

use crate::agentcli;
use crate::agentrun;
use crate::error::AppError;

/// Longest title we keep. Past this a tab or a card truncates anyway.
const TITLE_MAX_CHARS: usize = 72;

/// A title is worth a couple of seconds, never a stall.
const TITLE_TIMEOUT: Duration = Duration::from_secs(45);

/// The cheapest model to name a conversation with, per agent.
///
/// Naming is a trivial task and must not spend the quota of the model the user
/// is actually working with. An agent missing from this list runs on its CLI
/// default (`""`), which is still correct — just not necessarily the cheapest.
///
/// **Every id here has a twin in the bridge**, which names the phone's
/// conversations the same way (`claude-adapter.ts` `TITLE_MODEL`,
/// `codex-adapter.ts` `CODEX_TITLE_MODEL`). Move both halves together, or one
/// app keeps paying for a tier the other one dropped. Antigravity is not here:
/// its cheap tier is read from its own listing ([`agy_title_model`]).
fn title_model(agent_id: &str) -> &'static str {
    match agent_id {
        "claude" => "haiku",
        // Verified against the account's real `model/list` (codex). A wrong id
        // is not a cosmetic mistake here: the CLI rejects the run and the
        // session silently keeps its old label.
        //
        // Luna is the cheapest of Codex's line on both halves of the bill —
        // $0.20/$1.20 per 1M tokens against the mini tier's $0.75/$4.50 — and
        // measured on a real title it also spent *fewer* tokens (13.4k vs
        // 18.3k), so it is roughly 5× cheaper per name.
        "codex" => "gpt-5.6-luna",
        _ => "",
    }
}

/// The model a title run asks for: [`title_model`], except for Antigravity,
/// whose ids are the ones its own `agy models` lists this month — read, not
/// pinned, so a retired tier is never asked for (`""` when the listing cannot be
/// read: the run then takes `agy`'s default, and a failed read is logged like
/// any other failed naming).
async fn title_model_for(agent_id: &str) -> String {
    if agent_id != "agy" {
        return title_model(agent_id).to_string();
    }
    match crate::aicommit::list_models("agy").await {
        Ok(models) => agy_title_model(&models).unwrap_or_default(),
        Err(e) => {
            fail(agent_id, &format!("could not list its models: {e}"));
            String::new()
        }
    }
}

/// The reasoning tiers `agy` appends to a model id, cheapest first.
const AGY_TIERS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// The cheapest model `agy` offers to name a conversation with, from its listing
/// — the same rule as the bridge's `chooseAntigravityTitleModel`: the lowest
/// tier of a `flash` family, else any `-low` id. `None` when neither is listed
/// (the run then takes `agy`'s default).
fn agy_title_model(models: &[agentcli::AgentModel]) -> Option<String> {
    let rank = |id: &str| {
        let (base, tier) = id.rsplit_once('-')?;
        if !base.contains("flash") {
            return None;
        }
        AGY_TIERS.iter().position(|t| *t == tier)
    };
    models
        .iter()
        .filter_map(|m| rank(&m.id).map(|r| (r, &m.id)))
        .min_by_key(|(r, _)| *r)
        .map(|(_, id)| id.clone())
        .or_else(|| {
            models
                .iter()
                .find(|m| m.id.ends_with("-low"))
                .map(|m| m.id.clone())
        })
}

/// Extra flags pinning the title run to the cheapest reasoning tier its CLI
/// offers, empty for the CLIs with no such knob.
///
/// This matters most on the model picked for being cheap: Luna's own default
/// effort is `medium`, and reasoning tokens are exactly what could make a cheap
/// model cost more than an expensive one on a task this small. Codex validates
/// the config key, so a typo fails the run instead of quietly naming on the
/// default tier. Claude's `haiku` and Antigravity's `-low` id carry their tier
/// already.
fn title_effort_args(agent_id: &str) -> Vec<String> {
    match agent_id {
        "codex" => vec!["-c".to_string(), "model_reasoning_effort=low".to_string()],
        _ => vec![],
    }
}

/// Everything a title run adds before the prompt: the cheap effort tier, and
/// keeping the errand out of the CLI's session history.
fn title_run_args(agent_id: &str) -> Vec<String> {
    let mut args = title_effort_args(agent_id);
    args.extend(agentcli::no_session_args(agent_id));
    args
}

/// Build the instruction from what the session's terminal shows.
///
/// The transcript is the material because it is the only source EVERY agent
/// has: measured against a real run, only Claude reports a prompt or a reply
/// through the hook, so a prompt/reply-shaped input named two agents and
/// silently skipped the rest.
///
/// The reply language is the user's, not English — a Spanish conversation with
/// an English title reads like somebody else's.
pub fn build_title_prompt(transcript: &str) -> String {
    let instruction = concat!(
        "Below is an excerpt of a terminal session with a coding agent.\n",
        "Name that conversation in 3 to 6 words, as a short title.\n",
        "Reply with ONLY the title: no quotes, no trailing period, no ",
        "preamble, no markdown. Write it in the same language the user ",
        "used. Name what the conversation is ABOUT, so it stays ",
        "recognizable next to conversations that opened with a similar ",
        "phrase. Ignore banners, prompts, spinners and tool output — ",
        "describe the actual task.\n\n",
    );
    format!("{instruction}{}", clip_tail(transcript, 1800))
}

/// Reduce whatever the CLI printed to a bare title, or `None` when there is
/// nothing usable in it.
///
/// A CLI answers with more than the title more often than not — a preamble, the
/// title in quotes, a markdown heading, several lines. Rather than trusting the
/// model to obey, take the first line with content and strip the decoration.
pub fn sanitize_title(raw: &str) -> Option<String> {
    let first = raw.lines().map(str::trim).find(|l| !l.is_empty())?;

    let mut title = first
        .trim_start_matches(['#', '>', '-', '*', ' '])
        .trim_matches(['"', '\'', '`', '“', '”', '‘', '’'])
        .trim()
        .to_string();

    // "Title:" / "Título:" lead-ins the model adds despite being told not to.
    for lead in ["title:", "titulo:", "título:"] {
        if title.to_lowercase().starts_with(lead) {
            title = title[lead.len()..].trim().to_string();
            break;
        }
    }
    // A trailing full stop is never part of a title (a "?" or "!" can be).
    title = title.trim_end_matches('.').trim().to_string();

    if title.is_empty() {
        return None;
    }
    // A model that ignored the instruction and wrote a paragraph is not a title;
    // the session's existing label beats a wall of text on a tab.
    let chars: Vec<char> = title.chars().collect();
    if chars.len() > TITLE_MAX_CHARS * 2 {
        return None;
    }
    if chars.len() > TITLE_MAX_CHARS {
        let mut clipped: String = chars[..TITLE_MAX_CHARS - 1].iter().collect();
        clipped = clipped.trim_end().to_string();
        clipped.push('…');
        return Some(clipped);
    }
    Some(title)
}

/// Name a conversation from its opening exchange, using [`agent_id`]'s own CLI
/// on this machine.
///
/// Best-effort by contract: a missing CLI, no credit or a timeout returns an
/// error the caller is expected to ignore, leaving the session's existing label
/// alone. Naming must never disturb a session that is otherwise working.
pub async fn generate(agent_id: &str, transcript: &str, cwd: &str) -> Result<String, AppError> {
    if !transcript.trim().is_empty() && agentcli::resolve(agent_id).is_none() {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    }
    let cwd = cwd.to_string();
    generate_with(agent_id, transcript, |run| async move {
        agentrun::run_headless(
            &run.agent,
            &run.model,
            &run.prompt,
            &cwd,
            Some(run.timeout_ms),
            // A title is read-only work: never let it act on the workspace.
            false,
            &run.extra,
            None,
            0,
        )
        .await
        .map_err(AppError::from)
    })
    .await
}

/// The one-shot run a title takes, for whichever machine runs it: the
/// session's own agent, on its cheapest model, leaving no session behind.
pub struct TitleRun {
    pub agent: String,
    pub model: String,
    pub prompt: String,
    pub timeout_ms: u64,
    pub extra: Vec<String>,
}

/// Name a conversation with `run` doing the run — this machine's runner
/// ([`generate`]), or a host's engine for a session that lives there, where its
/// agent is (`HostEngine::agent_run`).
pub async fn generate_with<F, Fut>(
    agent_id: &str,
    transcript: &str,
    run: F,
) -> Result<String, AppError>
where
    F: FnOnce(TitleRun) -> Fut,
    Fut: std::future::Future<Output = Result<agentrun::HeadlessResult, AppError>>,
{
    if transcript.trim().is_empty() {
        return Err(AppError::Invalid("nothing to name yet".to_string()));
    }

    let result = run(TitleRun {
        agent: agent_id.to_string(),
        model: title_model_for(agent_id).await,
        prompt: build_title_prompt(transcript),
        timeout_ms: TITLE_TIMEOUT.as_millis() as u64,
        extra: title_run_args(agent_id),
    })
    .await
    .inspect_err(|e| fail(agent_id, &format!("could not run the CLI: {e}")))?;

    if result.exit_code != Some(0) {
        // Every failure is logged because naming is silent by design: the card
        // just keeps its old label, so without a line here a session that never
        // gets named leaves no evidence at all of why.
        fail(
            agent_id,
            &format!("exit {:?}: {}", result.exit_code, tail_of(&result.stderr)),
        );
        return Err(AppError::Agent("the agent failed to name it".to_string()));
    }
    match sanitize_title(&result.stdout) {
        Some(title) => {
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "convtitle",
                &format!("{agent_id} named a conversation: {title:?}"),
            );
            Ok(title)
        }
        None => {
            fail(
                agent_id,
                &format!("no usable title in {:?}", tail_of(&result.stdout)),
            );
            Err(AppError::Agent(
                "the agent returned no usable title".to_string(),
            ))
        }
    }
}

/// Record why a session went unnamed.
fn fail(agent_id: &str, detail: &str) {
    crate::diagnostics::log(
        crate::diagnostics::Level::Warn,
        "convtitle",
        &format!("{agent_id} could not name a conversation — {detail}"),
    );
}

/// The end of a CLI's output, short enough for a log line. The tail is what
/// carries the error; a banner would just push it out of view.
fn tail_of(text: &str) -> String {
    let t = text.trim();
    let chars: Vec<char> = t.chars().collect();
    if chars.len() <= 200 {
        return t.to_string();
    }
    format!("…{}", chars[chars.len() - 200..].iter().collect::<String>())
}

/// Keep the **tail** of a transcript, not its head.
///
/// A terminal starts with a banner, a version line and the agent's own splash;
/// the conversation is at the bottom. Clipping from the front would hand the
/// model the boilerplate and cut off the actual task.
fn clip_tail(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count <= max {
        return trimmed.to_string();
    }
    let tail: String = trimmed.chars().skip(count - max).collect();
    format!("…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_the_decoration_a_cli_adds() {
        assert_eq!(
            sanitize_title("Fix the login bug").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(
            sanitize_title("\"Fix the login bug\"").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(
            sanitize_title("## Fix the login bug").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(
            sanitize_title("- Fix the login bug").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(
            sanitize_title("Title: Fix the login bug").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(
            sanitize_title("Título: Arreglar el login").as_deref(),
            Some("Arreglar el login")
        );
        assert_eq!(
            sanitize_title("Fix the login bug.").as_deref(),
            Some("Fix the login bug")
        );
        // A question mark belongs to the title; a full stop never does.
        assert_eq!(
            sanitize_title("Why does login fail?").as_deref(),
            Some("Why does login fail?")
        );
    }

    #[test]
    fn sanitize_takes_the_first_line_with_content() {
        assert_eq!(
            sanitize_title("\n\n  Fix the login bug\nSome rambling after.").as_deref(),
            Some("Fix the login bug")
        );
    }

    #[test]
    fn sanitize_rejects_nothing_usable_rather_than_inventing_a_title() {
        assert_eq!(sanitize_title(""), None);
        assert_eq!(sanitize_title("   \n  "), None);
        assert_eq!(sanitize_title("\"\""), None);
        // Prose is not a title — the existing label beats a wall of text.
        assert_eq!(sanitize_title(&"x".repeat(TITLE_MAX_CHARS * 2 + 1)), None);
    }

    #[test]
    fn sanitize_clips_a_slightly_long_title_instead_of_dropping_it() {
        let title = sanitize_title(&"word ".repeat(20)).expect("kept");
        assert_eq!(title.chars().count(), TITLE_MAX_CHARS);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn a_non_ascii_title_survives_untouched() {
        assert_eq!(
            sanitize_title("\"Arreglar el inicio de sesión\"").as_deref(),
            Some("Arreglar el inicio de sesión")
        );
    }

    #[test]
    fn the_prompt_keeps_the_tail_of_a_transcript_and_stays_small() {
        let p = build_title_prompt(
            "fix the login bug
agent: the token expired",
        );
        assert!(p.contains("fix the login bug"));
        assert!(p.contains("same language"));
        assert!(p.contains("ONLY the title"));

        // A terminal opens with a banner and the conversation is at the BOTTOM,
        // so a long transcript must be clipped from the front, not the back.
        let long = format!(
            "{}THE ACTUAL TASK",
            "banner line
"
            .repeat(400)
        );
        let clipped = build_title_prompt(&long);
        assert!(clipped.contains("THE ACTUAL TASK"), "the tail must survive");
        assert!(
            clipped.len() < 2600,
            "prompt should stay small, got {}",
            clipped.len()
        );
    }

    #[test]
    fn the_title_model_is_the_cheap_tier_where_we_know_one() {
        assert_eq!(title_model("claude"), "haiku");
        assert_eq!(title_model("codex"), "gpt-5.6-luna");
        // An agent whose cheap tier we cannot name falls back to its CLI
        // default rather than guessing an id the CLI would reject.
        assert_eq!(title_model("opencode"), "");
        assert_eq!(title_model("unknown"), "");
    }

    fn listed(ids: &[&str]) -> Vec<agentcli::AgentModel> {
        ids.iter()
            .map(|id| agentcli::AgentModel {
                id: id.to_string(),
                display_name: id.to_string(),
                is_legacy: false,
            })
            .collect()
    }

    #[test]
    fn agy_names_a_conversation_on_the_cheap_flash_family_it_lists() {
        // The listing of `agy` 1.3.5, in its own order.
        let models = listed(&[
            "gemini-3.8-flash-high",
            "gemini-3.8-flash-medium",
            "gemini-3.8-flash-low",
            "claude-sonnet-4-6",
            "gpt-oss-120b-medium",
        ]);
        assert_eq!(
            agy_title_model(&models).as_deref(),
            Some("gemini-3.8-flash-low")
        );
        // A flash family with no low tier is named on its lowest one.
        assert_eq!(
            agy_title_model(&listed(&[
                "claude-sonnet-4-6",
                "gemini-3.9-flash-high",
                "gemini-3.9-flash-medium"
            ]))
            .as_deref(),
            Some("gemini-3.9-flash-medium")
        );
    }

    #[test]
    fn agy_falls_back_to_a_low_tier_then_to_its_own_default() {
        assert_eq!(
            agy_title_model(&listed(&["claude-sonnet-4-6", "gemini-3.1-pro-low"])).as_deref(),
            Some("gemini-3.1-pro-low")
        );
        // Nothing cheap listed: no model is named, so agy's default runs.
        assert_eq!(agy_title_model(&listed(&["claude-sonnet-4-6"])), None);
        assert_eq!(agy_title_model(&[]), None);
    }

    #[test]
    fn the_title_run_pins_the_lowest_reasoning_effort_it_can() {
        // Luna is picked for being cheap and defaults to `medium` effort, so
        // the tier has to be said out loud or the saving is spent on thinking.
        assert_eq!(
            title_effort_args("codex"),
            vec!["-c".to_string(), "model_reasoning_effort=low".to_string()]
        );
        // The others carry their tier in the model id itself (`haiku`, an
        // Antigravity `-low` id) or expose no knob at all.
        for id in ["claude", "agy", "opencode", "grok", "zero", "pi", "unknown"] {
            assert!(title_effort_args(id).is_empty(), "{id}");
        }
    }

    #[test]
    fn a_title_run_keeps_no_session_and_opens_like_a_one_shot() {
        assert!(title_run_args("claude").contains(&"--no-session-persistence".to_string()));
        assert!(title_run_args("codex").contains(&"--ephemeral".to_string()));
        let prompt = build_title_prompt("$ claude\n> fix the login");
        assert!(
            crate::agentcli::one_shot_openers()
                .iter()
                .any(|o| prompt.starts_with(o.as_str())),
            "the title prompt must open like shared/src/agents/one-shot.ts says"
        );
    }

    #[test]
    fn the_title_flags_land_before_the_prompt() {
        // A flag after the prompt is ignored by some CLIs and swallowed into
        // the prompt by others, so the effort override must precede it.
        let args = crate::agentcli::build_args(
            "codex",
            title_model("codex"),
            crate::agentcli::PromptSource::Argv("name this"),
            false,
            &title_effort_args("codex"),
        )
        .unwrap();
        assert_eq!(args.last().unwrap(), "name this");
        let c = args.iter().position(|a| a == "-c").unwrap();
        assert_eq!(args[c + 1], "model_reasoning_effort=low");
        assert!(c < args.len() - 1);
    }

    #[tokio::test]
    async fn a_title_comes_from_whichever_machine_runs_it() {
        let mut asked = None;
        let title = generate_with("codex", "user: fix the login bug", |run| {
            asked = Some((run.agent.clone(), run.model.clone(), run.extra.clone()));
            async {
                Ok(agentrun::HeadlessResult {
                    stdout: "\"Fix the login bug\"\n".into(),
                    stderr: String::new(),
                    exit_code: Some(0),
                    stdout_bytes: 20,
                    stderr_bytes: 0,
                    truncated: false,
                    peak_memory_mb: 0,
                })
            }
        })
        .await
        .unwrap();
        assert_eq!(title, "Fix the login bug");
        let (agent, model, extra) = asked.unwrap();
        assert_eq!(agent, "codex");
        assert_eq!(model, title_model("codex"));
        assert_eq!(extra, title_run_args("codex"));
    }
}
