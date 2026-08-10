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
fn title_model(agent_id: &str) -> &'static str {
    match agent_id {
        "claude" => "haiku",
        // Verified against the account's real `model/list` (codex) and
        // `agy models`. A wrong id is not a cosmetic mistake here: the CLI
        // rejects the run and the session silently keeps its old label.
        "codex" => "gpt-5.4-mini",
        "agy" => "gemini-3.6-flash-low",
        _ => "",
    }
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

/// Name a conversation from its opening exchange, using [`agent_id`]'s own CLI.
///
/// Best-effort by contract: a missing CLI, no credit or a timeout returns an
/// error the caller is expected to ignore, leaving the session's existing label
/// alone. Naming must never disturb a session that is otherwise working.
pub async fn generate(agent_id: &str, transcript: &str, cwd: &str) -> Result<String, AppError> {
    if transcript.trim().is_empty() {
        return Err(AppError::Invalid("nothing to name yet".to_string()));
    }
    if agentcli::resolve(agent_id).is_none() {
        return Err(AppError::Agent(format!(
            "agent '{agent_id}' is not installed"
        )));
    }

    let prompt = build_title_prompt(transcript);
    let result = agentrun::run_headless(
        agent_id,
        title_model(agent_id),
        &prompt,
        cwd,
        Some(TITLE_TIMEOUT.as_millis() as u64),
        // A title is read-only work: never let it act on the workspace.
        false,
    )
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
        assert_eq!(title_model("codex"), "gpt-5.4-mini");
        assert_eq!(title_model("agy"), "gemini-3.6-flash-low");
        // An agent whose cheap tier we cannot name falls back to its CLI
        // default rather than guessing an id the CLI would reject.
        assert_eq!(title_model("opencode"), "");
        assert_eq!(title_model("unknown"), "");
    }
}
