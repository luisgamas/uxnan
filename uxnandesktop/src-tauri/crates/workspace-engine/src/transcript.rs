//! What an agent's session transcript says about its last turn: the prompt
//! and the reply, for the card and the notification of a finished turn.
//!
//! The transcript is a file on the machine the agent runs on, so this is the
//! workspace engine's: the app reads its own agents' here, and a host's engine
//! reads its agents' there (`uxnan-host` → `TranscriptPreview`) — never the
//! other machine's file by its path.
//!
//! A report names the transcript itself, so the path is dereferenced only when
//! it is a `.jsonl` inside the home that agent keeps its transcripts in
//! ([`preview`]); anything else reads nothing.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// Max characters of the response preview we attach to a `done` report.
pub const PREVIEW_MAX: usize = 240;
/// Collapse whitespace and truncate for a one-glance notification preview.
pub fn tidy(s: &str, max: usize) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > max {
        let mut out: String = collapsed.chars().take(max.saturating_sub(1)).collect();
        out = out.trim_end().to_string();
        out.push('…');
        out
    } else {
        collapsed
    }
}

/// Flatten a Claude transcript message `content` (string or array of blocks) to
/// plain text — only `text` blocks contribute (tool calls/results are ignored).
fn text_of(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    let Some(arr) = content.as_array() else {
        // A single block, the shape ACP transcripts use:
        // `"content": {"type":"text","text":"…"}`.
        if content.get("type").and_then(|t| t.as_str()) == Some("text") {
            return content
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
        }
        return String::new();
    };
    arr.iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The base directory Claude Code stores session transcripts under
/// (`~/.claude/projects/<sanitized-cwd>/<session>.jsonl`). Resolved from the
/// same home-dir source as the reporter installers; kept in one place so that if
/// Claude changes this upstream, previews degrade gracefully (skipped) instead of
/// breaking.
fn claude_transcript_base() -> Option<PathBuf> {
    crate::agent_hooks::home_dir().map(|h| h.join(".claude"))
}

/// Where Grok keeps the ACP transcript it points us at, for the same gate.
fn grok_transcript_base() -> Option<PathBuf> {
    crate::agent_hooks::home_dir().map(|h| h.join(".grok"))
}

/// Where Antigravity keeps the transcript it points us at, for the same gate.
fn antigravity_transcript_base() -> Option<PathBuf> {
    crate::agent_hooks::home_dir().map(|h| h.join(".gemini").join("antigravity-cli"))
}

/// The transcript root an agent's `transcriptPath` must live under, or `None`
/// when we know of no transcript for that agent (and so dereference nothing).
fn transcript_base_for(agent_type: &str) -> Option<PathBuf> {
    match agent_type {
        "claude" => claude_transcript_base(),
        "antigravity" => antigravity_transcript_base(),
        "grok" => grok_transcript_base(),
        _ => None,
    }
}

/// Whether a request-supplied `transcript_path` may be dereferenced: it must be a
/// `.jsonl` file that, once canonicalized, lives inside the canonicalized `base`
/// (the user's `~/.claude` home). Canonicalizing both sides collapses any `..`
/// traversal and resolves symlinks, so a token-holding caller cannot point the
/// preview at an arbitrary readable file (SSH keys, `.env`, …) outside the
/// transcript tree. Fails closed (`false`) when either path can't be
/// canonicalized — the caller then simply skips the preview.
fn transcript_path_allowed(path: &Path, base: &Path) -> bool {
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return false;
    }
    let (Ok(canon_path), Ok(canon_base)) =
        (std::fs::canonicalize(path), std::fs::canonicalize(base))
    else {
        return false;
    };
    canon_path.starts_with(&canon_base)
}

/// Read a Claude session transcript (JSONL) and return the last user prompt +
/// the last assistant text response, to enrich a `done` notification. All I/O is
/// best-effort: any read/parse problem yields `(None, None)`. The transcript can
/// be large, so this only runs on the (infrequent) `done` transition.
///
/// The caller MUST first validate `path` with [`transcript_path_allowed`] — this
/// function dereferences the path directly and must never be handed an arbitrary
/// request-supplied path.
fn transcript_preview(path: &str) -> (Option<String>, Option<String>) {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return (None, None);
    };
    let mut prompt = None;
    let mut summary = None;
    // ACP transcripts (Grok) stream a turn as CHUNKS, so the reply has to be
    // reassembled: taking the last line would show the tail of a sentence. A new
    // user chunk starts a new turn and drops what came before, leaving the last
    // turn's reply at the end.
    let mut acp_prompt = String::new();
    let mut acp_reply = String::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        // ACP shape (Grok): the interesting part is nested under
        // `params.update`, and `agent_thought_chunk` is the model thinking out
        // loud — never the answer, so it must not reach the card.
        if let Some(update) = entry.get("params").and_then(|p| p.get("update")) {
            let text = update.get("content").map(text_of).unwrap_or_default();
            match update.get("sessionUpdate").and_then(|u| u.as_str()) {
                Some("user_message_chunk") => {
                    if !acp_reply.is_empty() {
                        acp_prompt.clear();
                        acp_reply.clear();
                    }
                    acp_prompt.push_str(&text);
                }
                Some("agent_message_chunk") => acp_reply.push_str(&text),
                _ => {}
            }
            continue;
        }
        let msg = entry.get("message");
        let role = msg
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            .or_else(|| entry.get("type").and_then(|t| t.as_str()));
        // Claude nests the text under `message`; Antigravity's records are flat.
        let content = msg
            .and_then(|m| m.get("content"))
            .or_else(|| entry.get("content"));
        let text = content.map(text_of).unwrap_or_default();
        let text = tidy(&text, PREVIEW_MAX);
        if text.is_empty() {
            continue;
        }
        match role {
            Some("user") => prompt = Some(text),
            Some("assistant") => summary = Some(text),
            // Antigravity's records are flat and speak their own vocabulary:
            // `{"source":"MODEL","type":"PLANNER_RESPONSE","content":"…"}` for a
            // reply, `USER_INPUT` for the turn that asked for it. Verified
            // against real transcripts under `~/.gemini/antigravity-cli/brain/`.
            Some("PLANNER_RESPONSE")
                if entry.get("source").and_then(Value::as_str) == Some("MODEL") =>
            {
                summary = Some(text)
            }
            Some("USER_INPUT") => prompt = Some(text),
            _ => {}
        }
    }
    // Reassembled ACP chunks win: a transcript in that shape has nothing else.
    let acp_reply = tidy(&acp_reply, PREVIEW_MAX);
    if !acp_reply.is_empty() {
        summary = Some(acp_reply);
    }
    let acp_prompt = tidy(&acp_prompt, PREVIEW_MAX);
    if !acp_prompt.is_empty() {
        prompt = Some(acp_prompt);
    }
    (prompt, summary)
}

/// The last turn's `(prompt, reply)` from the transcript a report named, read
/// only when `path` is a transcript of `agent_type`'s own (see the module
/// docs); `(None, None)` otherwise, and on any read problem.
pub fn preview(agent_type: &str, path: &str) -> (Option<String>, Option<String>) {
    let Some(base) = transcript_base_for(agent_type) else {
        return (None, None);
    };
    if !transcript_path_allowed(Path::new(path), &base) {
        return (None, None);
    }
    transcript_preview(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transcript_preview_reads_antigravitys_own_record_shape() {
        // Captured from a real `~/.gemini/antigravity-cli/brain/**/
        // transcript_full.jsonl`: flat records, not Claude's `{message:{role}}`,
        // and the reply is the LAST `MODEL`/`PLANNER_RESPONSE`.
        let dir = std::env::temp_dir().join("uxnan-agy-transcript-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("transcript_full.jsonl");
        let lines = [
            json!({"source":"USER_EXPLICIT","type":"USER_INPUT","content":"que es esta app"}),
            json!({"source":"SYSTEM","type":"CONVERSATION_HISTORY","content":""}),
            json!({"source":"MODEL","type":"VIEW_FILE","content":"File Path: `README.md`"}),
            json!({"source":"MODEL","type":"PLANNER_RESPONSE","content":"Uxnan es una plataforma para controlar agentes"}),
            json!({"source":"SYSTEM","type":"CHECKPOINT","content":"{{ CHECKPOINT 0 }}"}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        std::fs::write(&path, lines).expect("write");

        let (prompt, summary) = transcript_preview(path.to_str().expect("utf-8"));
        assert_eq!(prompt.as_deref(), Some("que es esta app"));
        assert_eq!(
            summary.as_deref(),
            Some("Uxnan es una plataforma para controlar agentes"),
            "a tool record or the checkpoint must not be mistaken for the reply"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_transcript_outside_its_agents_home_is_never_dereferenced() {
        // The path is request-supplied, so the gate is what stops a token-holding
        // caller pointing the preview at any readable file.
        let base = std::env::temp_dir().join("uxnan-base");
        assert!(!transcript_path_allowed(
            Path::new("/etc/passwd.jsonl"),
            &base
        ));
        assert!(transcript_base_for("opencode").is_none());
        assert!(transcript_base_for("claude").is_some());
        assert!(transcript_base_for("antigravity").is_some());
        assert!(transcript_base_for("grok").is_some());
    }

    #[test]
    fn transcript_preview_reassembles_groks_acp_chunks() {
        // Captured from a real `~/.grok/sessions/**/updates.jsonl`: the turn is
        // streamed as chunks under `params.update`, so the reply has to be put
        // back together — and the model's thinking must never reach the card.
        let dir = std::env::temp_dir().join("uxnan-grok-transcript-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("updates.jsonl");
        let chunk = |kind: &str, text: &str| {
            json!({"method":"session/update","params":{"update":{
                "sessionUpdate": kind, "content": {"type":"text","text": text}}}})
            .to_string()
        };
        let lines = [
            chunk("user_message_chunk", "first question"),
            chunk("agent_message_chunk", "first answer"),
            chunk("user_message_chunk", "que es uxnan"),
            chunk(
                "agent_thought_chunk",
                "The user wants an explanation, I should",
            ),
            chunk("agent_message_chunk", "Uxnan es un monorepo "),
            chunk("agent_message_chunk", "para controlar agentes"),
        ]
        .join(
            "
",
        );
        std::fs::write(&path, lines).expect("write");

        let (prompt, summary) = transcript_preview(path.to_str().expect("utf-8"));
        // The LAST turn, reassembled — not the first, and not a tail fragment.
        assert_eq!(
            summary.as_deref(),
            Some("Uxnan es un monorepo para controlar agentes")
        );
        assert_eq!(prompt.as_deref(), Some("que es uxnan"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tidy_collapses_and_truncates() {
        assert_eq!(tidy("  a\n\n b  ", 100), "a b");
        let long = "x".repeat(300);
        let out = tidy(&long, 10);
        assert!(out.chars().count() <= 10);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn text_of_flattens_blocks() {
        let content = json!([
            { "type": "text", "text": "hello" },
            { "type": "tool_use", "name": "Bash" },
            { "type": "text", "text": "world" }
        ]);
        assert_eq!(text_of(&content), "hello\nworld");
        assert_eq!(text_of(&json!("plain")), "plain");
    }

    #[test]
    fn transcript_path_allowed_requires_jsonl_under_base() {
        let base = std::env::temp_dir().join(format!("uxnan-transcript-{}", uuid::Uuid::new_v4()));
        let inside = base.join("projects").join("proj");
        std::fs::create_dir_all(&inside).unwrap();
        let good = inside.join("session.jsonl");
        std::fs::write(&good, "{}\n").unwrap();
        let wrong_ext = inside.join("notes.txt");
        std::fs::write(&wrong_ext, "x").unwrap();

        let outside_dir =
            std::env::temp_dir().join(format!("uxnan-outside-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&outside_dir).unwrap();
        let outside = outside_dir.join("evil.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();

        // A `.jsonl` inside the base is allowed.
        assert!(transcript_path_allowed(&good, &base));
        // Wrong extension → rejected even inside the base.
        assert!(!transcript_path_allowed(&wrong_ext, &base));
        // A `.jsonl` genuinely outside the base → rejected.
        assert!(!transcript_path_allowed(&outside, &base));
        // A `..` traversal that lexically starts inside the base but resolves
        // outside it is rejected (canonicalization collapses the `..`).
        let traversal = base
            .join("projects")
            .join("..")
            .join("..")
            .join(outside_dir.file_name().unwrap())
            .join("evil.jsonl");
        assert!(!transcript_path_allowed(&traversal, &base));

        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&outside_dir);
    }
}
