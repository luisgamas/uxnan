//! Reads the on-disk session metadata of the **Zero** agent (a Go CLI, `zero`) so
//! the left-panel agent view can show Zero's current conversation title + a coarse
//! status. Zero writes each session to `<data>/zero/sessions/<id>/metadata.json`;
//! it emits no terminal-title OSC and exposes no HTTP session API, so reading that
//! file (matched by the worktree cwd) is the practical way to surface its
//! conversation title. Like the rest of `fs`/`browse`, this is the user's own
//! machine, so access is not confined.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// One Zero session's on-disk metadata (only the fields the agent view uses). Zero
/// serializes these keys in camelCase (see `internal/sessions/store.go`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    /// "", "fork", "child", "spec-draft", "spec-impl". Only "" / "fork" are the
    /// user-facing resumable conversations; the rest are sub-runs we skip.
    #[serde(default)]
    session_kind: String,
    /// Human-readable conversation name (first user message, later LLM-upgraded).
    #[serde(default)]
    title: String,
    /// Working directory the session ran in — how we map it to a worktree.
    #[serde(default)]
    cwd: String,
    /// RFC3339 timestamp; newest wins when several sessions share a cwd.
    #[serde(default)]
    updated_at: String,
    /// "message" | "tool_call" | "tool_result" | "permission_request" | … — the
    /// coarse status is derived from this.
    #[serde(default)]
    last_event_type: String,
}

/// What the agent view shows for a Zero agent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZeroSession {
    pub title: String,
    /// Coarse status in the agent-view vocabulary: working / waiting / done / idle.
    pub status: String,
    pub updated_at: String,
    /// The agent's latest reply, when the session log holds one.
    ///
    /// Every other agent's card can show what the agent just said, because its
    /// hook reports it. Zero reports nothing at all, so its second line only
    /// ever showed a status label — the one agent whose card said less the more
    /// it did. Its own event log has the answer (`events.jsonl`, the last
    /// `message` with `role: "assistant"`), so it gets the same line.
    #[serde(default)]
    pub reply: Option<String>,
}

/// The user's home directory (`USERPROFILE` on Windows, `HOME` elsewhere).
fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

/// Zero's sessions directory: `$XDG_DATA_HOME/zero/sessions`, else
/// `~/.local/share/zero/sessions` (Zero's own fallback on every OS, Windows
/// included — see `internal/sessions/store.go` `DefaultRoot`).
fn sessions_root() -> Option<PathBuf> {
    if let Some(x) = std::env::var_os("XDG_DATA_HOME") {
        if !x.is_empty() {
            return Some(PathBuf::from(x).join("zero").join("sessions"));
        }
    }
    Some(
        home_dir()?
            .join(".local")
            .join("share")
            .join("zero")
            .join("sessions"),
    )
}

/// Normalize a path for comparison: forward slashes, no trailing slash, and
/// case-folded on Windows (its filesystem is case-insensitive).
fn norm(p: &str) -> String {
    let s = p.replace('\\', "/");
    let s = s.trim_end_matches('/').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// Map Zero's `lastEventType` to the agent-view status.
///
/// **Staleness ends every claim, not just the busy one.** A session file that
/// hasn't been touched in [`FRESH_SECS`] describes a conversation that is over,
/// so none of its states is true of the agent now: a `message` from three days
/// ago read as a **`done` check the moment you opened Zero**, before you had
/// asked it anything (its session dir keeps every past conversation, and the
/// newest one for this worktree is usually yesterday's finished turn). A stale
/// `permission_request` is no better — it would park the card in "needs you"
/// over a question nobody is still asking.
fn derive_status(last_event: &str, stale: bool) -> &'static str {
    if stale {
        return "idle";
    }
    match last_event {
        "permission_request" => "waiting",
        "tool_call" | "tool_result" => "working",
        "message" => "done",
        _ => "idle",
    }
}

/// A `metadata.json` older than this reads as at-rest for the working downgrade.
const FRESH_SECS: u64 = 10 * 60;

/// How much of the tail of `events.jsonl` is read to find the latest reply.
///
/// The log grows for the whole conversation (tool results included, which are
/// the big ones), and this runs on a poll — so it reads the end of the file
/// rather than the file. A reply longer than what fits in the window is
/// truncated to the preview length anyway.
const EVENTS_TAIL_BYTES: u64 = 64 * 1024;

/// Longest reply preview kept; the row truncates visually, but the string
/// crosses the IPC boundary on every poll, so it is cut here too.
const REPLY_MAX_CHARS: usize = 240;

/// The agent's latest reply in a Zero session directory, if its event log has
/// one. Best-effort: any I/O or parse problem simply yields `None`.
///
/// Reads only the tail of the log and scans it backwards for the last
/// `{"type":"message", payload:{role:"assistant"}}`. The first line of the
/// window is skipped — a tail cut lands mid-line, and half a JSON object is not
/// a record.
fn latest_reply(session_dir: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};

    let path = session_dir.join("events.jsonl");
    let mut file = std::fs::File::open(&path).ok()?;
    let len = file.metadata().ok()?.len();
    let from = len.saturating_sub(EVENTS_TAIL_BYTES);
    file.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = String::new();
    file.take(EVENTS_TAIL_BYTES).read_to_string(&mut buf).ok()?;

    let mut lines: Vec<&str> = buf.lines().collect();
    if from > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    for line in lines.iter().rev() {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if event.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let payload = event.get("payload")?;
        if payload.get("role").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let content = payload.get("content").and_then(|v| v.as_str())?;
        let collapsed = content.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            continue;
        }
        return Some(if collapsed.chars().count() > REPLY_MAX_CHARS {
            let mut out: String = collapsed.chars().take(REPLY_MAX_CHARS - 1).collect();
            out.push('…');
            out
        } else {
            collapsed
        });
    }
    None
}

/// The newest resumable Zero session whose `cwd` matches `cwd`, or `None`.
pub fn session_for(cwd: &str) -> Option<ZeroSession> {
    pick_session(&sessions_root()?, cwd)
}

/// Core of [`session_for`], split out so it can be tested against a temp root
/// without touching real user data or process env.
fn pick_session(root: &Path, cwd: &str) -> Option<ZeroSession> {
    let want = norm(cwd);
    let mut best: Option<ZeroSession> = None;
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let meta_path = entry.path().join("metadata.json");
        let Ok(bytes) = std::fs::read(&meta_path) else {
            continue;
        };
        let Ok(m) = serde_json::from_slice::<Metadata>(&bytes) else {
            continue;
        };
        // Only the user-facing resumable conversations; skip child / spec sub-runs.
        if !(m.session_kind.is_empty() || m.session_kind == "fork") {
            continue;
        }
        if m.title.trim().is_empty() || norm(&m.cwd) != want {
            continue;
        }
        let stale = std::fs::metadata(&meta_path)
            .and_then(|md| md.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs() > FRESH_SECS)
            .unwrap_or(true);
        let candidate = ZeroSession {
            title: m.title.trim().to_string(),
            status: derive_status(&m.last_event_type, stale).to_string(),
            updated_at: m.updated_at.clone(),
            reply: latest_reply(&entry.path()),
        };
        // Newest `updatedAt` wins (RFC3339 sorts lexicographically).
        if best
            .as_ref()
            .map(|b| candidate.updated_at > b.updated_at)
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_session(root: &Path, id: &str, json: &str) {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("metadata.json"), json).unwrap();
    }

    #[test]
    fn reads_the_latest_reply_from_the_event_log() {
        // The record shape is Zero's own, captured from a real session log.
        let dir = std::env::temp_dir().join(format!("uxnan-zero-reply-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let log = [
            r#"{"id":"s:1","type":"message","createdAt":"2026-08-07T20:22:37Z","payload":{"content":"qué es uxnan?","role":"user"}}"#,
            r#"{"id":"s:2","type":"tool_call","createdAt":"2026-08-07T20:22:40Z","payload":{"name":"read"}}"#,
            r#"{"id":"s:3","type":"message","createdAt":"2026-08-07T20:22:45Z","payload":{"content":"Uxnan   is\ntwo apps","role":"assistant"}}"#,
            r#"{"id":"s:4","type":"provider_usage","createdAt":"2026-08-07T20:22:45Z","payload":{"totalTokens":10}}"#,
        ]
        .join("\n");
        std::fs::write(dir.join("events.jsonl"), log).unwrap();

        // The assistant's last message, whitespace collapsed — never the user's
        // prompt (which is also a `message`) nor a tool record.
        assert_eq!(latest_reply(&dir).as_deref(), Some("Uxnan is two apps"));

        // No log, or no assistant turn yet → nothing to show, not an error.
        let empty = dir.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(latest_reply(&empty), None);
        std::fs::write(
            empty.join("events.jsonl"),
            r#"{"type":"message","payload":{"content":"hi","role":"user"}}"#,
        )
        .unwrap();
        assert_eq!(latest_reply(&empty), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn picks_newest_root_session_matching_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let cwd = "/home/u/proj";

        write_session(
            root,
            "old",
            r#"{"sessionKind":"","title":"Old task","cwd":"/home/u/proj","updatedAt":"2026-01-01T10:00:00Z","lastEventType":"message"}"#,
        );
        write_session(
            root,
            "new",
            r#"{"sessionKind":"fork","title":"New task","cwd":"/home/u/proj","updatedAt":"2026-01-02T10:00:00Z","lastEventType":"tool_call"}"#,
        );
        // A child sub-run + a different-cwd session must be ignored.
        write_session(
            root,
            "child",
            r#"{"sessionKind":"child","title":"Sub run","cwd":"/home/u/proj","updatedAt":"2026-09-09T10:00:00Z","lastEventType":"tool_call"}"#,
        );
        write_session(
            root,
            "other",
            r#"{"sessionKind":"","title":"Elsewhere","cwd":"/home/u/other","updatedAt":"2026-09-09T10:00:00Z","lastEventType":"message"}"#,
        );

        let s = pick_session(root, cwd).unwrap();
        assert_eq!(s.title, "New task");
        // Fresh file + tool_call → working.
        assert_eq!(s.status, "working");

        // Case-only / separator differences still match on Windows-style paths.
        assert!(pick_session(root, "/home/u/proj/").is_some());
        // A cwd with no matching session → None.
        assert!(pick_session(root, "/nope").is_none());
    }

    #[test]
    fn maps_last_event_to_status() {
        assert_eq!(derive_status("permission_request", false), "waiting");
        assert_eq!(derive_status("tool_call", false), "working");
        assert_eq!(derive_status("tool_result", false), "working");
        assert_eq!(derive_status("message", false), "done");
        assert_eq!(derive_status("session_start", false), "idle");
    }

    #[test]
    fn a_stale_session_claims_nothing() {
        // Zero keeps every past conversation for a worktree, so the newest one
        // is usually the last finished turn — days old. Reading its `message` as
        // `done` put a completion check on the card the instant Zero opened,
        // before the user had asked it anything. Nothing a stale file says
        // describes the agent now.
        for event in [
            "message",
            "permission_request",
            "tool_call",
            "tool_result",
            "session_start",
        ] {
            assert_eq!(
                derive_status(event, true),
                "idle",
                "a stale `{event}` must not claim a state"
            );
        }
    }

    #[test]
    fn skips_titleless_and_missing_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // A session dir with no metadata.json, and one with an empty title.
        std::fs::create_dir_all(root.join("empty")).unwrap();
        write_session(
            root,
            "blank",
            r#"{"sessionKind":"","title":"   ","cwd":"/c","updatedAt":"2026-01-01T00:00:00Z","lastEventType":"message"}"#,
        );
        assert!(pick_session(root, "/c").is_none());
        // A missing root directory is fine (returns None, no panic).
        assert!(pick_session(&root.join("nonexistent"), "/c").is_none());
    }
}
