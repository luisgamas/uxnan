//! Local agent hook server — Layer 1 of agent monitoring (spec `02d` §1.1).
//!
//! The ADE binds a small `axum` HTTP server to an ephemeral `127.0.0.1` port.
//! An agent's hook `POST`s a state report to `/hook`; we normalize it into
//! [`crate::model::AgentStatus`], upsert it into the persistent agent cache
//! (TTL-pruned, spec §1.5) and broadcast `agent:status-changed` to the frontend
//! so the sidebar/tab indicators update with a precise state — unlike the coarse
//! output-activity inference, the hook distinguishes `working`/`blocked`/
//! `waiting`/`done`.
//!
//! **Three report shapes are accepted**, so every kind of hook (a node relay, a
//! shell `curl`, a JS plugin, or the generic launcher wrapper) can report with
//! whatever it can build cheaply:
//!   * **Provider event, JSON body** — a node relay / JS plugin sends
//!     `{ "agentId", "agentType", "event", "source" }`. The server extracts the
//!     event name and maps it to a precise state ([`normalize_event`]).
//!   * **Provider event, raw body + headers** — a shell `curl` script (Codex)
//!     forwards the agent's raw hook JSON as the body and passes `agentId` /
//!     `agentType` in `X-Uxnan-Agent-Id` / `X-Uxnan-Agent-Type` headers, so the
//!     script never has to build JSON (which is brittle to quote across
//!     cmd / PowerShell / sh / fish). The server extracts the event from the body.
//!   * **Direct status** — the generic launcher wrapper knows the lifecycle
//!     state directly and sends it in the `X-Uxnan-Status` header (empty body),
//!     again to avoid shell JSON-building.
//!
//! Keeping the *normalization* on the server means the hook scripts stay dumb
//! and shell-agnostic, and a single code path owns "what does this event mean".
//!
//! The server's URL + a per-launch token are injected into every terminal as
//! `UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` (plus `UXNAN_ENDPOINT_FILE`, a
//! restart-stable file with the live coordinates), and each terminal carries its
//! PTY id as `UXNAN_AGENT_ID`; a hook echoes that id back so the frontend can map
//! the report to the terminal/worktree that produced it. The token (required in
//! the `X-Uxnan-Token` header) rejects stray local processes.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Router,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;

use crate::model::{AgentReport, AgentSession, AgentStatus, SubagentEntry};
use crate::state::{AppState, HookServerInfo};

/// Header carrying the shared secret that authorizes a hook report.
const TOKEN_HEADER: &str = "x-uxnan-token";
/// Header a shell `curl` script uses to pass the terminal (PTY) id out-of-band.
const AGENT_ID_HEADER: &str = "x-uxnan-agent-id";
/// Header a shell `curl` script uses to pass the agent kind out-of-band.
const AGENT_TYPE_HEADER: &str = "x-uxnan-agent-type";
/// Header the generic wrapper uses to name the event that fired.
///
/// Needed because a payload need not carry one: measured against the real CLI,
/// Antigravity posts `invocationNum` / `fullyIdle` / `terminationReason` and no
/// event field at all, so its reports had nothing to identify them and were
/// discarded. Its hooks are registered per event, so the reporter is given the
/// name as an argument and forwards it here.
const EVENT_HEADER: &str = "x-uxnan-event";
/// Header the generic wrapper uses to report an already-known lifecycle state.
const STATUS_HEADER: &str = "x-uxnan-status";
/// Header the generic wrapper uses to flag a non-zero (interrupted) exit.
const INTERRUPTED_HEADER: &str = "x-uxnan-interrupted";

/// Max hook body we read (1 MiB). A hook payload is small; this caps a stray /
/// malicious local process from pushing us to OOM. Oversized → 413, fail-open.
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Max characters of the response preview we attach to a `done` report.
const PREVIEW_MAX: usize = 240;

/// Current unix time in seconds — the stamp used for agent-cache entries.
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Map a provider hook `event` name (+ its raw `source` payload) to a precise
/// [`AgentStatus`] for `agent_type`. Returns `None` for events that aren't a
/// state transition (the server then ignores the report rather than caching a
/// misleading state). The tables encode each agent's lifecycle vocabulary — the
/// single source of truth for "what does this event mean" (spec `02d` §1.1).
pub fn normalize_event(
    agent_type: &str,
    event: &str,
    source: Option<&Value>,
) -> Option<AgentStatus> {
    match agent_type {
        "claude" => claude_vocabulary(event, source),
        // `SessionStart` is deliberately absent: it fires when the TUI opens (and
        // on resume), before the user has asked for anything — see
        // [`is_session_boundary`], which resets the tab instead of claiming work.
        // Codex has no `Notification` hook at all (verified against the running
        // CLI, which dispatches SessionStart / UserPromptSubmit / PreToolUse /
        // PostToolUse / PermissionRequest / PreCompact / Stop), so an arm for it
        // would be dead code pretending to be a mapping.
        "codex" => match event {
            "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PreCompact" => {
                Some(AgentStatus::Working)
            }
            "PermissionRequest" => Some(AgentStatus::Waiting),
            "Stop" => Some(AgentStatus::Done),
            _ => None,
        },
        // Grok's hook vocabulary *is* Claude Code's (it loads a Claude settings
        // file unchanged), plus a `StopFailure` of its own for a turn that died on
        // an API error — which makes Grok the second agent, after OpenCode, that
        // reports a real `blocked` instead of it being inferred.
        // Grok registers PascalCase keys in its config (it accepts those as
        // aliases) but **dispatches in snake_case**: its `HookEventName` carries
        // `#[serde(rename_all = "snake_case")]`, so the payload says `stop`, not
        // `Stop`. Matching only the PascalCase spelling made every Grok report
        // fall through to `None` and be discarded — which is why its card sat on
        // "working" with nothing left able to move it. Accept both spellings.
        // Antigravity exposes only its execution loop — there is no prompt,
        // permission or notification hook — so it reports `working` and `done`
        // precisely and can never claim to be waiting on the user.
        "antigravity" => match event {
            "PreInvocation" | "PostInvocation" | "PreToolUse" | "PostToolUse" => {
                Some(AgentStatus::Working)
            }
            "Stop" => Some(AgentStatus::Done),
            _ => None,
        },
        // OpenCode's in-process plugin, and the two CLIs that run the same
        // reporter because they share its plugin API: MiMo Code (a fork of
        // OpenCode) and Kilo Code (the same event bus, a different export
        // shape). They report the plugin's own synthetic vocabulary, not the
        // bus event names, so one arm serves all three.
        "opencode" | "mimo" | "kilocode" => match event {
            "SessionStart" | "SessionBusy" | "MessagePart" => Some(AgentStatus::Working),
            "SessionIdle" | "Stop" => Some(AgentStatus::Done),
            "PermissionRequest" | "AskUserQuestion" => Some(AgentStatus::Waiting),
            "Error" => Some(AgentStatus::Blocked),
            _ => None,
        },
        // Amp's plugin API is its own: five events, reported under their native
        // names. `agent.end` carries a `status`, which is the only way to tell a
        // finished turn from one that died — so Amp reports a real `blocked`
        // rather than one inferred from silence.
        "amp" => match event {
            "agent.start" | "tool.call" | "tool.result" => Some(AgentStatus::Working),
            "agent.end" => match source
                .and_then(|s| s.get("status"))
                .and_then(|v| v.as_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("error" | "failed" | "failure") => Some(AgentStatus::Blocked),
                _ => Some(AgentStatus::Done),
            },
            _ => None,
        },
        // ---- Agents that reimplement Claude Code's hook vocabulary ----------
        // A fork (OpenClaude) or a CLI that adopted the same event names (Qwen
        // Code, Kimi Code, Droid, Devin, Command Code, Auggie, Kiro). They differ
        // in *which* of those events they emit, not in what each one means, so
        // they share one table and each is narrowed to what it actually sends —
        // registering an event a CLI never fires is harmless, but claiming a
        // state it can't report is not.
        // Goose follows the Open Plugins hook spec, whose event names are Claude
        // Code's; it names the event `event` rather than `hook_event_name`,
        // which the payload reader already accepts.
        "openclaude" | "qwen" | "kimi" | "goose" => claude_vocabulary(event, source),
        // Grok's vocabulary IS Claude's (it loads a Claude settings file
        // unchanged) plus a `StopFailure` of its own, but it **dispatches in
        // snake_case** — its `HookEventName` carries
        // `#[serde(rename_all = "snake_case")]`, so the payload says `stop`, not
        // `Stop`. Matching only PascalCase dropped every Grok report and left the
        // card stuck on working with nothing able to move it.
        "grok" => claude_vocabulary(&pascal_case(event), source),
        // Droid, Devin, Kiro and Auggie expose the turn and tool loop plus an
        // approval prompt (Auggie and Kiro have none). None of them reports an
        // error event, so `blocked` is not something they can claim.
        "droid" | "devin" | "kiro" | "auggie" => match event {
            "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostCompaction" => {
                Some(AgentStatus::Working)
            }
            "PermissionRequest" => Some(AgentStatus::Waiting),
            "Stop" | "SessionEnd" => Some(AgentStatus::Done),
            _ => None,
        },
        // Command Code exposes only the tool loop and the end of a turn: no
        // prompt, permission or session event at all, so it reports `working`
        // and `done` and can never claim to be waiting on the user.
        "commandcode" => match event {
            "PreToolUse" | "PostToolUse" => Some(AgentStatus::Working),
            "Stop" => Some(AgentStatus::Done),
            _ => None,
        },
        // Cursor names its events in camelCase and its turn ends at `stop`.
        "cursor" => match event {
            "beforeSubmitPrompt"
            | "preToolUse"
            | "postToolUse"
            | "postToolUseFailure"
            | "beforeShellExecution"
            | "beforeMCPExecution"
            | "preCompact" => Some(AgentStatus::Working),
            "stop" | "sessionEnd" => Some(AgentStatus::Done),
            _ => None,
        },
        // Copilot accepts both spellings in its config but dispatches the ones
        // its own reference documents, so both are matched here — the same trap
        // Grok's snake_case dispatch set, which silently dropped every report.
        // `errorOccurred` makes it the third agent (with OpenCode and Grok) that
        // reports a real `blocked` instead of one inferred from silence.
        "copilot" => match event {
            "userPromptSubmitted"
            | "UserPromptSubmit"
            | "userPromptTransformed"
            | "preToolUse"
            | "PreToolUse"
            | "postToolUse"
            | "PostToolUse"
            | "postToolUseFailure"
            | "PostToolUseFailure"
            | "preCompact"
            | "PreCompact" => Some(AgentStatus::Working),
            "permissionRequest" | "PermissionRequest" | "notification" => {
                Some(AgentStatus::Waiting)
            }
            "errorOccurred" | "ErrorOccurred" => Some(AgentStatus::Blocked),
            "agentStop" | "Stop" | "sessionEnd" | "SessionEnd" => Some(AgentStatus::Done),
            _ => None,
        },
        // Pi / OMP share one in-process extension API; they only ever reach
        // `working` / `done` (no permission or blocked signal).
        "pi" | "omp" => match event {
            "before_agent_start"
            | "agent_start"
            | "tool_call"
            | "tool_execution_start"
            | "tool_execution_end"
            | "message_end" => Some(AgentStatus::Working),
            "agent_end" | "session_shutdown" => Some(AgentStatus::Done),
            _ => None,
        },
        _ => None,
    }
}

/// Claude Code's hook vocabulary, shared by the CLIs that reimplement it.
///
/// `SessionStart` is absent on purpose — it is a boundary, not a state (see
/// [`is_session_boundary`]). `StopFailure` is a turn that died on an API/model
/// error: the agent stops without ever sending `Stop`, so without this arm the
/// card would spin forever.
fn claude_vocabulary(event: &str, source: Option<&Value>) -> Option<AgentStatus> {
    match event {
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PreCompact"
        | "PostCompact" => Some(AgentStatus::Working),
        "PermissionRequest" => Some(AgentStatus::Waiting),
        "StopFailure" => Some(AgentStatus::Blocked),
        "Stop" | "SessionEnd" => Some(AgentStatus::Done),
        // Only the notification kinds that genuinely block on the user mid-turn
        // mean `waiting`; the post-turn idle notice is the resting state, and an
        // unrecognized kind must never override the turn's real state.
        "Notification" => match source.and_then(notification_type).as_deref() {
            Some("permission_prompt" | "elicitation_dialog" | "agent_needs_input") => {
                Some(AgentStatus::Waiting)
            }
            Some("idle_prompt") => Some(AgentStatus::Done),
            _ => None,
        },
        _ => None,
    }
}

/// Whether this event marks the **start of a provider session** rather than a
/// state — the moment a CLI's TUI opens, resumes or is cleared.
///
/// This is not a nuance: a session-start event fires while the agent sits at an
/// empty prompt with nothing asked of it. Mapping it to `working` (as Codex and
/// Grok did) painted a green pulsing dot the instant the TUI opened, and since
/// the next event only arrives when the user finally types, **nothing could move
/// it** — the tab claimed to be working for as long as it stayed unused.
/// Measured against the running Codex CLI, opening a session emits exactly
/// `SessionStart {"source":"startup"}` and then nothing until the first prompt.
///
/// So it is treated as a boundary: the tab's cached state is dropped (a new
/// session owns it now — the previous turn's prompt, tool, reply and children no
/// longer describe anything) while the session identity the payload carries is
/// kept for resume. The tab falls back to a neutral idle until the agent really
/// does something.
///
/// `source` is honoured as an allowlist when present, because the same event
/// name also fires *mid-turn* after a compaction, which must not wipe a live
/// turn. A payload with no `source` at all is taken as a boundary — for the CLIs
/// that omit it, opening/resuming is the only thing this event ever means.
pub fn is_session_boundary(agent_type: &str, event: &str, source: Option<&Value>) -> bool {
    let is_start = matches!(
        (agent_type, pascal_case(event).as_str()),
        (
            "claude"
                | "codex"
                | "grok"
                | "qwen"
                | "auggie"
                | "droid"
                | "devin"
                | "copilot"
                | "openclaude"
                | "cursor"
                | "kiro"
                | "goose",
            "SessionStart"
        ) | ("kiro", "AgentSpawn")
            // Amp's plugin reports its native name; a thread session starting is
            // the same boundary, and nothing has been asked of it yet.
            | ("amp", "Session.start")
    );
    if !is_start {
        return false;
    }
    match source.and_then(session_start_source) {
        Some(s) => matches!(s.as_str(), "startup" | "resume" | "clear"),
        None => true,
    }
}

/// The `source` of a session-start payload (`startup` / `resume` / `clear` /
/// `compact`), lowercased. Absent when the provider doesn't report one.
fn session_start_source(source: &Value) -> Option<String> {
    source
        .get("source")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}

/// Pull the kind out of a raw `Notification` payload.
///
/// Three spellings, because the same event is not spelled the same way twice:
/// Claude sends `notification_type`, and the CLIs that copied its vocabulary
/// carry their payloads in camelCase throughout (Grok's own fields are
/// `hookEventName` / `sessionId`), so a snake_case-only read would find nothing
/// and silently treat every notification as unclassifiable.
fn notification_type(source: &Value) -> Option<String> {
    ["notification_type", "notificationType", "type"]
        .iter()
        .find_map(|k| source.get(*k).and_then(|v| v.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `snake_case` → `PascalCase`, leaving an already-Pascal name untouched.
///
/// Exists because an agent's *config* spelling and its *dispatch* spelling are
/// not always the same — Grok accepts `Stop` in its hooks file and then reports
/// `stop`. Normalizing at the match site keeps one vocabulary per agent instead
/// of duplicating every arm.
fn pascal_case(event: &str) -> String {
    // Deliberately no "already Pascal?" shortcut: a single-word snake event has
    // no underscore at all (`stop`), so skipping on that basis would leave the
    // most important event of the lifecycle unmatched.
    event
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// Extract the provider event name from a raw hook payload, trying every key an
/// agent might use (`hook_event_name` for Claude/Codex, `event`/`type`/
/// `name` for others). Returns `None` when the payload carries no event name.
fn event_name(source: &Value) -> Option<String> {
    for key in ["hook_event_name", "hookEventName", "event", "type", "name"] {
        if let Some(s) = source.get(key).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Best-effort extraction of the user prompt from a raw provider payload.
fn source_prompt(source: &Value) -> Option<String> {
    let get = |k: &str| {
        source
            .get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    get("prompt")
        .or_else(|| get("user_prompt"))
        .or_else(|| get("message"))
        .or_else(|| get("input"))
        .filter(|s| !s.trim().is_empty())
}

/// Best-effort extraction of the tool name from a raw provider payload.
fn source_tool(source: &Value) -> Option<String> {
    let get = |k: &str| {
        source
            .get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    get("tool_name")
        .or_else(|| get("tool"))
        .or_else(|| get("name"))
        .or_else(|| {
            source
                .get("toolCall")
                .and_then(|t| t.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .filter(|s| !s.trim().is_empty())
}

/// The agent's final reply, when its completion payload carries one.
///
/// Worth reading before falling back to the transcript: measured against the
/// running CLI, Codex's `Stop` carries `last_assistant_message` with the answer
/// in it, so its card can show the reply instead of a bare status — without
/// opening (or being allowed to open) any file. Claude sends the same field on
/// `SubagentStop`, so the spelling is already known to be shared.
fn source_reply(source: &Value) -> Option<String> {
    ["last_assistant_message", "lastAssistantMessage"]
        .iter()
        .find_map(|k| source.get(*k).and_then(|v| v.as_str()))
        .map(|s| tidy(s, PREVIEW_MAX))
        .filter(|s| !s.is_empty())
}

/// Whether a raw provider `Stop`/result payload signals the agent was
/// interrupted (user hit Esc / Ctrl-C) rather than finishing naturally.
fn source_interrupted(source: &Value) -> bool {
    source
        .get("interrupted")
        .and_then(|v| v.as_bool())
        .or_else(|| source.get("is_interrupt").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

/// Best-effort extraction of a sub-agent (child) identity from a
/// `SubagentStart`/`SubagentStop` payload: `(id, agent_type, description)`.
///
/// Every spelling below was captured from a real run, because the four CLIs that
/// report children do not agree on one:
///
/// | CLI | id | kind | final reply |
/// |---|---|---|---|
/// | Claude Code 2.1.225 | `agent_id` | `agent_type` | `last_assistant_message` |
/// | Codex 0.147.0 | `agent_id` | `agent_type` | `last_assistant_message` |
/// | Grok 0.2.118 | `subagentId` | `subagentType` | `lastAssistantMessage` |
/// | OpenCode 1.18.15 | `agent_id` (child session) | `agent_type` | — |
///
/// Grok is camelCase throughout, which is why its `lastAssistantMessage` needs
/// its own alias: matching only the snake_case spelling silently dropped the
/// child's answer and left the row showing the task it was given instead.
/// Returns `None` when no stable child id is present — the caller then ignores
/// the event rather than inventing a bogus row.
fn source_subagent(source: &Value) -> Option<(String, Option<String>, Option<String>)> {
    let first_str = |keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|k| source.get(*k).and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let id = first_str(&["agent_id", "subagent_id", "agentId", "subagentId"])?;
    let agent_type = first_str(&["agent_type", "subagent_type", "agentType", "subagentType"]);
    let description = first_str(&[
        "description",
        "task",
        "last_assistant_message",
        "lastAssistantMessage",
    ])
    .or_else(|| {
        source
            .get("tool_input")
            .and_then(|t| t.get("description").or_else(|| t.get("prompt")))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
    // A child's final reply can be long — collapse + cap for the roster.
    .map(|d| tidy(&d, PREVIEW_MAX));
    Some((id, agent_type, description))
}

/// Whether a hook event name is a sub-agent lifecycle event. Claude sends these
/// natively (`SubagentStart`/`SubagentStop`); OpenCode's plugin maps its
/// child-session lifecycle to the same names, so the routing is agent-agnostic.
fn is_subagent_event(event: &str) -> bool {
    // Matched on the normalized spelling: Cursor and Copilot dispatch
    // `subagentStart` / `subagentStop`, and matching only PascalCase would route
    // their children into the parent's own status — flipping the parent to
    // `working` every time it spawned one, and to `done` before it had finished.
    matches!(
        pascal_case(event).as_str(),
        "SubagentStart" | "SubagentStop"
    )
}

/// Drop a leading UTF-8 byte-order mark from a hook body.
///
/// `serde_json` rejects a BOM outright, and the whole body is parsed leniently —
/// a parse failure degrades to "no body", which for a raw provider event means
/// **no event name**, so the report is dropped without a sound. Measured on
/// Cursor 2026.08.04, which prefixes its payload with one: every Cursor report
/// was being discarded on Windows, so its cards never moved off the coarse
/// fallback. Cheap and agent-agnostic, so it guards whoever does it next.
fn strip_bom(body: &[u8]) -> &[u8] {
    body.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(body)
}

/// Collapse whitespace and truncate for a one-glance notification preview.
fn tidy(s: &str, max: usize) -> String {
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

/// The `agent:status-changed` event payload broadcast to the frontend on every
/// accepted hook report (mirrors the cached [`crate::model::AgentStateEntry`]).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusEvent {
    pub agent_id: String,
    pub status: AgentStatus,
    pub agent_type: Option<String>,
    pub prompt: Option<String>,
    pub tool: Option<String>,
    pub interrupted: bool,
    pub summary: Option<String>,
    pub subagents: Vec<SubagentEntry>,
    /// Provider session identity (latest captured) — the frontend stamps it on
    /// the owning tab so restore/wake can resume the CLI's own session. This
    /// field MUST mirror the cache: omitting it here is exactly the bug that
    /// silently disabled resume while the cache captured perfectly.
    pub session: Option<AgentSession>,
    pub first_seen: i64,
    pub last_update: i64,
}

/// The `agent:status-cleared` event payload: a provider session boundary (its
/// TUI opened, resumed or was cleared) dropped this tab's cached state.
///
/// A separate event rather than a status, because there is no state to report —
/// the agent is present and at rest, which is exactly the neutral idle the
/// display already derives when no hook state exists. It still carries the two
/// things the frontend must not lose: the agent kind (so a hand-typed agent
/// keeps the identity its hook sealed) and the freshly started session (so
/// restore/wake can resume it).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusClearedEvent {
    pub agent_id: String,
    pub agent_type: Option<String>,
    pub session: Option<AgentSession>,
}

/// Broadcast a session boundary to the frontend as `agent:status-cleared`.
fn emit_agent_status_cleared(
    app: &AppHandle,
    agent_id: String,
    agent_type: Option<String>,
    session: Option<AgentSession>,
) {
    let _ = app.emit(
        "agent:status-cleared",
        AgentStatusClearedEvent {
            agent_id,
            agent_type,
            session,
        },
    );
}

/// Broadcast a cached agent entry to the frontend as `agent:status-changed`.
fn emit_agent_status(app: &AppHandle, entry: crate::model::AgentStateEntry) {
    let _ = app.emit(
        "agent:status-changed",
        AgentStatusEvent {
            agent_id: entry.agent_id,
            status: entry.status,
            agent_type: entry.agent_type,
            prompt: entry.prompt,
            tool: entry.tool,
            interrupted: entry.interrupted,
            summary: entry.summary,
            subagents: entry.subagents,
            session: entry.session,
            first_seen: entry.first_seen,
            last_update: entry.last_update,
        },
    );
}

/// Shared context handed to the axum handlers.
#[derive(Clone)]
struct HookCtx {
    app: AppHandle,
    token: String,
}

/// Write the "endpoint file" the hook scripts source to recover live
/// coordinates after an app restart. POSIX writes `endpoint.env` (sourced with
/// `.`), Windows writes `endpoint.cmd` (sourced with `call`, so each line is
/// `set KEY=VALUE`). Values are validated shell-safe before writing (the file is
/// sourced as shell); an unsafe value aborts the write and the caller falls back
/// to PTY-env-only injection. Atomic (temp + rename). Returns the file path.
fn write_endpoint_file(dir: &Path, url: &str, token: &str) -> Option<PathBuf> {
    fn shell_safe(v: &str) -> bool {
        !v.is_empty()
            && v.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
    }
    if !shell_safe(url) || !shell_safe(token) {
        return None;
    }
    let (name, prefix, eol) = if cfg!(windows) {
        ("endpoint.cmd", "set ", "\r\n")
    } else {
        ("endpoint.env", "", "\n")
    };
    let body = format!("{prefix}UXNAN_HOOK_URL={url}{eol}{prefix}UXNAN_HOOK_TOKEN={token}{eol}");
    if std::fs::create_dir_all(dir).is_err() {
        return None;
    }
    let path = dir.join(name);
    let tmp = dir.join(format!(".endpoint-{}.tmp", std::process::id()));
    if std::fs::write(&tmp, body.as_bytes()).is_err() {
        return None;
    }
    // Best-effort 0600 so a co-tenant can't read the token off disk.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    Some(path)
}

/// Bind the hook server to an ephemeral `127.0.0.1` port and spawn its serve
/// loop on the Tokio runtime. `hooks_dir` is where the endpoint file is written.
/// Returns the coordinates (url + token + endpoint-file path) so the caller can
/// publish them for env injection. Errors if the port can't be bound (the app
/// still runs — just without precise hook reporting).
pub async fn start(
    app: AppHandle,
    token: String,
    hooks_dir: PathBuf,
) -> std::io::Result<HookServerInfo> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let url = format!("http://127.0.0.1:{port}/hook");
    let endpoint_file =
        write_endpoint_file(&hooks_dir, &url, &token).map(|p| p.to_string_lossy().into_owned());
    let ctx = HookCtx {
        app,
        token: token.clone(),
    };
    let router = Router::new()
        .route("/hook", post(handle_hook))
        .route("/browser", post(handle_browser))
        // Browser-control MCP server (spec `02d` §1.6): makes the integrated
        // browser discoverable to agents as MCP tools. Same server + token.
        .route("/mcp", post(handle_mcp).get(mcp_get))
        .route("/health", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(ctx);
    tauri::async_runtime::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            eprintln!("[uxnan-desktop] hook server stopped: {err}");
        }
    });
    Ok(HookServerInfo {
        url,
        token,
        endpoint_file,
    })
}

/// Constant-time equality for the shared per-launch token. Comparing the
/// SHA-256 digests of both sides (rather than the raw strings) removes the
/// short-circuit timing side channel a plain `==` on a secret leaks — the count
/// of matching leading bytes — because the comparison runs over fixed-length,
/// unpredictable digest bytes an attacker cannot steer toward the target. `sha2`
/// is already a dependency (Codex trust hashing), so this adds no crate.
///
/// `pub(crate)` because `mcp.rs` authorizes callers against the same token and
/// must use the same constant-time check.
pub(crate) fn token_eq(a: &str, b: &str) -> bool {
    let da = Sha256::digest(a.as_bytes());
    let db = Sha256::digest(b.as_bytes());
    // Data-independent fold over the two fixed-length (32-byte) digests.
    let mut diff = 0u8;
    for (x, y) in da.iter().zip(db.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Whether the request carries the shared token.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| token_eq(v, token))
        .unwrap_or(false)
}

/// Whether an HTTP authority (`host[:port]`, or a bracketed IPv6 literal) points
/// at loopback: `127.0.0.1`, `localhost`, or `::1`. Any other host — a real
/// name a DNS-rebinding/CSRF attacker would use — is rejected. A present but
/// empty authority is treated as suspicious (rejected).
fn host_is_loopback(authority: &str) -> bool {
    let authority = authority.trim();
    if authority.is_empty() {
        return false;
    }
    let host = if let Some(rest) = authority.strip_prefix('[') {
        // Bracketed IPv6 literal: `[::1]` or `[::1]:port` → take up to `]`.
        match rest.split_once(']') {
            Some((inner, _)) => inner,
            None => return false,
        }
    } else if authority == "::1" {
        // Bare IPv6 loopback (no brackets, no port).
        "::1"
    } else {
        // `host` or `host:port` → the part before the first `:`.
        authority.split(':').next().unwrap_or(authority)
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Whether an `Origin` header value is a loopback `http`/`https` origin. A real
/// web page (the CSRF / DNS-rebinding vector) always sends its true,
/// non-loopback `Origin`, so only a loopback one is accepted.
fn origin_is_loopback(origin: &str) -> bool {
    origin
        .trim()
        .strip_prefix("http://")
        .or_else(|| origin.trim().strip_prefix("https://"))
        .map(host_is_loopback)
        .unwrap_or(false)
}

/// Reject non-loopback callers by header — an explicit gate against
/// browser-driven CSRF / DNS-rebinding that does not depend on the token or on
/// CORS-preflight behavior. `Host` must be absent or loopback; `Origin` must be
/// absent or a loopback `http(s)` origin. The reporters send a loopback `Host`
/// and no `Origin`; a browser page always sends its real `Origin`. Every
/// state-changing route runs this before the token check.
pub(crate) fn loopback_caller(headers: &HeaderMap) -> bool {
    if let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        if !host_is_loopback(host) {
            return false;
        }
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if !origin_is_loopback(origin) {
            return false;
        }
    }
    true
}

/// Read a header as an owned, trimmed, non-empty string.
fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Handle one `POST /hook`: authorize, resolve the report (from headers and/or
/// body, in any of the three accepted shapes), normalize, cache + persist,
/// broadcast. Always fails open — an unrecognized event or a malformed body
/// returns `204` so a broken hook can never break the agent that fired it.
async fn handle_hook(
    AxumState(ctx): AxumState<HookCtx>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !loopback_caller(&headers) {
        return StatusCode::FORBIDDEN;
    }
    if !authorized(&headers, &ctx.token) {
        return StatusCode::UNAUTHORIZED;
    }

    // The body may be: a JSON envelope `{agentId, agentType, event, source, …}`
    // (node relay / JS plugin), a raw provider event (shell curl), or empty
    // (generic wrapper — everything is in headers). Parse leniently.
    let body_val: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(strip_bom(&body)).unwrap_or(Value::Null)
    };
    let body_get = |k: &str| body_val.get(k).and_then(|v| v.as_str()).map(str::to_string);

    let agent_id = header_str(&headers, AGENT_ID_HEADER)
        .or_else(|| body_get("agentId"))
        .filter(|s| !s.trim().is_empty());
    let Some(agent_id) = agent_id else {
        return StatusCode::BAD_REQUEST;
    };
    let agent_type = header_str(&headers, AGENT_TYPE_HEADER)
        .or_else(|| body_get("agentType"))
        .and_then(|t| normalize_agent_type(&t));

    // The raw provider event object: an explicit `source` field (relay/plugin
    // envelope) or the whole body (a raw event forwarded by a shell curl).
    let source_owned: Option<Value> = body_val.get("source").cloned().or_else(|| {
        if body_val.is_object() {
            Some(body_val.clone())
        } else {
            None
        }
    });
    let source = source_owned.as_ref();
    // Header first: it is the only source for an agent whose payload names no
    // event, and it is what the hook was registered under either way.
    let event = header_str(&headers, EVENT_HEADER)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| body_get("event"))
        .or_else(|| source.and_then(event_name));

    // Sub-agent (child) lifecycle. A child runs inside the parent's session
    // (Claude's Task tool = same PTY; OpenCode = a child session), so its report
    // arrives under the parent's `agent_id`. Route it to the parent's roster
    // WITHOUT touching the parent's own status (a child spawn/finish must not flip
    // the parent), then broadcast the parent entry with its updated child list.
    if event.as_deref().is_some_and(is_subagent_event) {
        // Normalized, for the same reason `is_subagent_event` is: a camelCase
        // `subagentStart` would otherwise be read as the child having finished.
        let child_status = if event.as_deref().map(pascal_case).as_deref() == Some("SubagentStart")
        {
            AgentStatus::Working
        } else {
            AgentStatus::Done
        };
        let Some((id, child_type, description)) = source.and_then(source_subagent) else {
            // No stable child id in the payload — ignore rather than invent a row.
            return StatusCode::NO_CONTENT;
        };
        let now = now_secs();
        let state = ctx.app.state::<AppState>();
        let entry = {
            let mut data = state.data.write().await;
            let entry = data.upsert_subagent(
                agent_id,
                SubagentEntry {
                    id,
                    agent_type: child_type,
                    description,
                    // A lifecycle event says nothing about what the child is
                    // running; its tool arrives on the child's own events.
                    tool: None,
                    status: child_status,
                    started_at: now,
                    last_update: now,
                },
                now,
            );
            let _ = state.persistence.save(&data);
            entry
        };
        emit_agent_status(&ctx.app, entry);
        return StatusCode::NO_CONTENT;
    }

    // An ordinary event that belongs to a CHILD, not to this tab's agent.
    //
    // On the CLIs that run a sub-agent in a session of its own, the child's own
    // events come up the same pipe under the parent's PTY id, distinguished only
    // by the session they name. Measured on Grok 0.2.118: a child emits its own
    // `user_prompt_submit` (which overwrote the parent's conversation title with
    // the child's task) and its own `session_end` — which maps to `done`, so the
    // parent's card went to "Done" while it was still working, and no done-gate
    // could help because the child had already finished. Its session id also
    // landed in the parent's captured session, which is what a restored tab
    // resumes: the tab would have come back on the sub-agent's conversation.
    //
    // So: attribute it to the child's row (its current tool) and let nothing of
    // it reach the parent. Claude and Codex never take this path — their
    // children's events carry the parent's session id.
    if let Some(child_id) = source
        .and_then(|s| {
            SESSION_ID_KEYS
                .iter()
                .find_map(|k| s.get(k).and_then(|v| v.as_str()))
        })
        .map(str::to_string)
    {
        let state = ctx.app.state::<AppState>();
        let is_child = {
            let data = state.data.read().await;
            data.is_subagent_session(&agent_id, &child_id)
        };
        if is_child {
            let tool = source.and_then(source_tool).map(|t| tidy(&t, PREVIEW_MAX));
            let now = now_secs();
            let entry = {
                let mut data = state.data.write().await;
                let entry = data.touch_subagent_activity(&agent_id, &child_id, tool, now);
                if entry.is_some() {
                    let _ = state.persistence.save(&data);
                }
                entry
            };
            if let Some(entry) = entry {
                emit_agent_status(&ctx.app, entry);
            }
            return StatusCode::NO_CONTENT;
        }
    }

    // Resolve the effective status. Priority: an explicit header/body status
    // (the wrapper knows it directly), else derive from the provider event.
    let direct_status = header_str(&headers, STATUS_HEADER)
        .or_else(|| body_get("status"))
        .and_then(|s| parse_status(&s));
    let status = match direct_status {
        Some(s) => s,
        None => match (agent_type.as_deref(), event.as_deref()) {
            // A session boundary is not a state — a new session owns this tab, so
            // the previous one's cached turn is dropped (keeping the session
            // identity this payload carries, which is what resume needs) and the
            // tab reads as a neutral idle until the agent actually does something.
            (Some(at), Some(ev)) if is_session_boundary(at, ev, source) => {
                let now = now_secs();
                let session = source.and_then(|s| extract_session(s, now));
                let state = ctx.app.state::<AppState>();
                {
                    let mut data = state.data.write().await;
                    data.clear_agent_state(&agent_id);
                    let _ = state.persistence.save(&data);
                }
                emit_agent_status_cleared(&ctx.app, agent_id, agent_type, session);
                return StatusCode::NO_CONTENT;
            }
            (Some(at), Some(ev)) => match normalize_event(at, ev, source) {
                Some(s) => s,
                // Not a state-changing event — ignore, don't cache a lie.
                None => return StatusCode::NO_CONTENT,
            },
            // No status and nothing to normalize: nothing to do.
            _ => return StatusCode::NO_CONTENT,
        },
    };

    // Enrich from the raw payload / headers.
    let interrupted = headers
        .get(INTERRUPTED_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
        || body_val
            .get("interrupted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        || source.map(source_interrupted).unwrap_or(false);
    let mut prompt = body_get("prompt")
        .filter(|s| !s.trim().is_empty())
        .or_else(|| source.and_then(source_prompt));
    let tool = body_get("tool")
        .filter(|s| !s.trim().is_empty())
        .or_else(|| source.and_then(source_tool));
    let mut summary = body_get("summary")
        .filter(|s| !s.trim().is_empty())
        .or_else(|| source.and_then(source_reply));

    // On a completion, enrich with the task + a short response preview, read
    // from the session transcript the hook pointed us at. Only Claude fills the
    // hook's own `summary` (measured across a real run of every wired agent), so
    // for the others this file IS the reply — without it their card can only ever
    // show a bare status.
    if status == AgentStatus::Done {
        let base = agent_type.as_deref().and_then(transcript_base_for);
        if let (Some(base), Some(tp)) = (
            base,
            source
                .and_then(|s| s.get("transcript_path").or_else(|| s.get("transcriptPath")))
                .and_then(|v| v.as_str()),
        ) {
            // Only dereference a request-supplied path that is a `.jsonl`
            // transcript inside the user's `~/.claude` home — never an arbitrary
            // readable file a token-holding caller named. On any failure the
            // report still succeeds, just without the preview.
            let allowed = transcript_path_allowed(Path::new(tp), &base);
            if allowed {
                let (t_prompt, t_summary) = transcript_preview(tp);
                if let Some(p) = t_prompt {
                    prompt = Some(p);
                }
                if summary.is_none() {
                    summary = t_summary;
                }
            }
        }
    }

    let now = now_secs();
    // Provider session identity (for resume) — most events repeat it; a miss
    // never clears an id captured earlier (see `upsert_agent_state`).
    let session = source.and_then(|s| extract_session(s, now));
    let state = ctx.app.state::<AppState>();
    let entry = {
        let mut data = state.data.write().await;
        let entry = data.upsert_agent_state(
            AgentReport {
                agent_id,
                status,
                agent_type,
                prompt,
                tool,
                interrupted,
                summary,
                session,
            },
            now,
        );
        // Best-effort persist so the state survives a restart (TTL-pruned).
        let _ = state.persistence.save(&data);
        entry
    };

    emit_agent_status(&ctx.app, entry);
    StatusCode::NO_CONTENT
}

/// The placeholder an early build's shared hook bridge reported when its
/// (since-removed) `UXNAN_AGENT_TYPE` env var was unset. It is not an agent id:
/// accepting it mislabels the tab's captured session with a type that has no
/// resume entry, and no `normalize_event` arm matches it, so the state is dropped
/// too. The script itself is swept on startup (`agent_hooks`); this rejects the
/// value at the door for a config we never rewrite.
const PLACEHOLDER_AGENT_TYPE: &str = "agent";

/// Canonicalize a reported agent type: trimmed and lowercased (a config may hold
/// any casing), blank treated as absent, and the legacy placeholder rejected.
/// An unrecognized-but-real type is kept — the generic wrapper takes the type as
/// a user-supplied argument, so the server is deliberately not a whitelist.
fn normalize_agent_type(raw: &str) -> Option<String> {
    let t = raw.trim().to_ascii_lowercase();
    if t.is_empty() || t == PLACEHOLDER_AGENT_TYPE {
        return None;
    }
    Some(t)
}

/// Field names providers use for their session id, across the wired agents
/// (Claude: `session_id`; OpenCode plugin: `sessionID`; Antigravity:
/// `conversationId`; other spellings kept for robustness — the value is
/// sanitized regardless of its source).
const SESSION_ID_KEYS: [&str; 8] = [
    "session_id",
    "sessionID",
    "sessionId",
    "session-id",
    "conversation_id",
    "conversationId",
    "conversationID",
    "conversation-id",
];
/// Field names carrying a session/transcript FILE path (Pi resumes by file;
/// Claude's transcript file is named separately from its session id).
const SESSION_FILE_KEYS: [&str; 3] = ["session_file", "sessionFile", "transcript_path"];

/// Sanitize a provider-supplied session id. The id later reaches a command
/// line (the resume command is pre-typed into a shell), so it is validated as
/// hostile input at ingestion: bounded length, no leading dash (option
/// injection), and a conservative charset covering every observed provider id
/// format (UUIDs and friends). Anything else is dropped, never "fixed".
fn sanitize_session_id(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 256 || s.starts_with('-') {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return None;
    }
    Some(s.to_string())
}

/// Extract the provider session identity from a raw hook payload, if present
/// and sane. The file path (when reported) is stored verbatim apart from a
/// length/control-character bound — it is only ever passed as a single argv
/// element, never interpolated.
fn extract_session(source: &serde_json::Value, now: i64) -> Option<AgentSession> {
    let id = SESSION_ID_KEYS
        .iter()
        .find_map(|k| source.get(k).and_then(|v| v.as_str()))
        .and_then(sanitize_session_id)?;
    let file = SESSION_FILE_KEYS
        .iter()
        .find_map(|k| source.get(k).and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
        .map(String::from);
    Some(AgentSession {
        id,
        file,
        captured_at: now,
    })
}

/// Parse a lifecycle-state string into an [`AgentStatus`] (case-insensitive).
fn parse_status(s: &str) -> Option<AgentStatus> {
    match s.trim().to_ascii_lowercase().as_str() {
        "working" => Some(AgentStatus::Working),
        "blocked" => Some(AgentStatus::Blocked),
        "waiting" => Some(AgentStatus::Waiting),
        "done" => Some(AgentStatus::Done),
        _ => None,
    }
}

/// The JSON body the agent `BROWSER` shim POSTs to open a URL in-app: `{"url": …}`.
#[derive(Debug, Clone, serde::Deserialize)]
struct BrowserRequest {
    url: String,
}

/// Handle one `POST /browser`: authorize, then route the URL through the user's
/// browser policy (in-app tab / OS browser / prompt). Lets an agent open a link in
/// the integrated browser via `UXNAN_BROWSER_URL` + `UXNAN_BROWSER_TOKEN`.
async fn handle_browser(
    AxumState(ctx): AxumState<HookCtx>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<BrowserRequest>,
) -> StatusCode {
    if !loopback_caller(&headers) {
        return StatusCode::FORBIDDEN;
    }
    if !authorized(&headers, &ctx.token) {
        return StatusCode::UNAUTHORIZED;
    }
    if payload.url.trim().is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    match crate::browser::route_url(&ctx.app, payload.url).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::BAD_REQUEST,
    }
}

/// Handle a `POST /mcp`: the browser-control MCP endpoint. Thin wrapper that hands
/// the app handle + token to [`crate::mcp::handle`] (which authorizes and runs the
/// JSON-RPC handshake). Kept here so it shares the hook server's `HookCtx`/token.
async fn handle_mcp(
    AxumState(ctx): AxumState<HookCtx>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    crate::mcp::handle(ctx.app.clone(), ctx.token.clone(), headers, body).await
}

/// Handle a `GET /mcp`: we don't offer the optional server→client SSE stream.
async fn mcp_get() -> Response {
    crate::mcp::handle_get().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn now_secs_is_positive() {
        assert!(now_secs() > 0);
    }

    #[test]
    fn status_event_payload_carries_the_session() {
        // Regression pin: the broadcast event must mirror the cached entry's
        // session — dropping it here silently disables resume everywhere while
        // the backend cache keeps capturing (the frontend stamps tabs from
        // this event, never from the cache).
        let event = AgentStatusEvent {
            agent_id: "a1".into(),
            status: AgentStatus::Working,
            agent_type: Some("claude".into()),
            prompt: None,
            tool: None,
            interrupted: false,
            summary: None,
            subagents: Vec::new(),
            session: Some(AgentSession {
                id: "s-99".into(),
                file: None,
                captured_at: 5,
            }),
            first_seen: 1,
            last_update: 5,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"session\""));
        assert!(json.contains("s-99"));
    }

    #[test]
    fn extract_session_reads_each_provider_spelling() {
        // Claude: session_id (+ its separately-named transcript).
        let claude = json!({
            "session_id": "3f9a1c2e-1111-2222-3333-444455556666",
            "transcript_path": "C:/Users/dev/.claude/projects/x/t.jsonl",
            "hook_event_name": "Stop"
        });
        let s = extract_session(&claude, 7).expect("claude session");
        assert_eq!(s.id, "3f9a1c2e-1111-2222-3333-444455556666");
        assert_eq!(
            s.file.as_deref(),
            Some("C:/Users/dev/.claude/projects/x/t.jsonl")
        );
        assert_eq!(s.captured_at, 7);
        // OpenCode plugin: sessionID, no file.
        let oc = json!({ "sessionID": "ses_01J0ABC" });
        assert_eq!(extract_session(&oc, 1).expect("opencode").id, "ses_01J0ABC");
        // Codex: golden shape captured from a real intercepted hook payload —
        // `session_id` + rollout `transcript_path` ride every lifecycle event,
        // so capture needs no Codex-specific wiring (`codex resume <id>`).
        let codex = json!({
            "session_id": "019f77df-f3e1-7bd2-91bf-d32de3b44b26",
            "turn_id": "019f77df-f6d4-7d31-b93a-d2296a3fe117",
            "transcript_path":
                "C:\\Users\\dev\\.codex\\sessions\\2026\\07\\18\\rollout-x.jsonl",
            "cwd": "C:\\Users\\dev\\repo",
            "hook_event_name": "Stop",
            "last_assistant_message": "ok"
        });
        let cx = extract_session(&codex, 3).expect("codex session");
        assert_eq!(cx.id, "019f77df-f3e1-7bd2-91bf-d32de3b44b26");
        assert!(cx
            .file
            .as_deref()
            .unwrap_or("")
            .ends_with("rollout-x.jsonl"));
        // Antigravity: `conversationId` (camelCase) — the id `agy --conversation`
        // takes. Its `conversation_id` snake spelling was accepted before this,
        // but the CLI emits the camel one, so nothing was ever captured.
        let agy = json!({ "conversationId": "0f6b9e14-77aa-4c1e-9f0e-2b3c4d5e6f70" });
        assert_eq!(
            extract_session(&agy, 2).expect("antigravity session").id,
            "0f6b9e14-77aa-4c1e-9f0e-2b3c4d5e6f70"
        );
        // No recognized key → None.
        assert!(extract_session(&json!({ "prompt": "hi" }), 1).is_none());
    }

    #[test]
    fn agent_type_normalizes_and_rejects_the_legacy_placeholder() {
        assert_eq!(normalize_agent_type("codex").as_deref(), Some("codex"));
        // Casing/whitespace from a hand-edited config.
        assert_eq!(normalize_agent_type("  Codex \n").as_deref(), Some("codex"));
        // A custom wrapper agent keeps its user-chosen type: the server is not a
        // whitelist, it only rejects the value that is provably not an agent.
        assert_eq!(normalize_agent_type("my-cli").as_deref(), Some("my-cli"));
        // The pre-relay bridge's fallback, in any casing → absent.
        assert!(normalize_agent_type("agent").is_none());
        assert!(normalize_agent_type("AGENT").is_none());
        assert!(normalize_agent_type("   ").is_none());
    }

    #[test]
    fn extract_session_rejects_hostile_ids() {
        // Option injection, shell metacharacters, whitespace, oversized.
        for bad in [
            "-rm", "a b", "x;y", "x`y`", "x$(y)", "x|y", "x\"y", "x'y", "", " ",
        ] {
            assert!(
                extract_session(&json!({ "session_id": bad }), 1).is_none(),
                "id {bad:?} must be rejected"
            );
        }
        let oversized = "a".repeat(257);
        assert!(extract_session(&json!({ "session_id": oversized }), 1).is_none());
        // A hostile FILE drops the file but keeps a good id.
        let s = extract_session(
            &json!({ "session_id": "ok-1", "session_file": "bad\u{0007}path" }),
            1,
        )
        .expect("id survives");
        assert_eq!(s.file, None);
    }

    #[test]
    fn session_start_is_a_boundary_not_work() {
        let start = codex_session_start();
        assert!(is_session_boundary("codex", "SessionStart", Some(&start)));
        // …and it must not also resolve to a state, or the boundary would be
        // shadowed by a `working` the moment the ordering changed.
        assert_eq!(normalize_event("codex", "SessionStart", Some(&start)), None);

        // Grok dispatches in snake_case (its config takes PascalCase aliases).
        let grok = json!({ "hook_event_name": "session_start", "source": "startup" });
        assert!(is_session_boundary("grok", "session_start", Some(&grok)));

        // A resumed or cleared session is the same boundary…
        for source in ["resume", "clear"] {
            let ev = json!({ "source": source });
            assert!(is_session_boundary("codex", "SessionStart", Some(&ev)));
        }
        // …but a compaction fires the same event name MID-TURN, and wiping a live
        // turn there would blank a working agent's card.
        let compact = json!({ "source": "compact" });
        assert!(!is_session_boundary(
            "codex",
            "SessionStart",
            Some(&compact)
        ));
        // No `source` reported at all: the event only ever means "a session
        // opened" for those CLIs, so it still counts.
        assert!(is_session_boundary("codex", "SessionStart", None));

        // Only session-start events, and only for agents that emit one.
        assert!(!is_session_boundary(
            "codex",
            "Stop",
            Some(&codex_session_start())
        ));
        assert!(!is_session_boundary("opencode", "SessionStart", None));
    }

    #[test]
    fn codex_stop_carries_the_reply() {
        // Captured from the running CLI: Codex reports no `summary`, but its
        // `Stop` holds the answer — so the card can show the reply rather than a
        // bare status, with no transcript file involved.
        let stop = json!({
            "hook_event_name": "Stop",
            "session_id": "019fdd8a-d95e-7883-a78c-a291a89dd5e3",
            "stop_hook_active": false,
            "last_assistant_message": "ok"
        });
        assert_eq!(source_reply(&stop).as_deref(), Some("ok"));
        assert_eq!(source_reply(&json!({ "hook_event_name": "Stop" })), None);
        // Whitespace-only is nothing to show.
        assert_eq!(
            source_reply(&json!({ "last_assistant_message": "  \n " })),
            None
        );
    }

    #[test]
    fn clearing_state_drops_only_the_named_agent() {
        let mut data = crate::model::AppData::default();
        for id in ["tab-a", "tab-b"] {
            data.upsert_agent_state(
                AgentReport {
                    agent_id: id.into(),
                    status: AgentStatus::Working,
                    agent_type: Some("codex".into()),
                    prompt: Some("old turn".into()),
                    tool: None,
                    interrupted: false,
                    summary: None,
                    session: None,
                },
                1,
            );
        }
        assert!(data.clear_agent_state("tab-a"));
        assert!(!data.agent_cache.iter().any(|e| e.agent_id == "tab-a"));
        assert!(data.agent_cache.iter().any(|e| e.agent_id == "tab-b"));
        // Clearing what isn't there is a no-op, not an error.
        assert!(!data.clear_agent_state("tab-a"));
    }

    /// The exact `SessionStart` Codex posts when its TUI opens — captured from
    /// the running CLI, not written from the docs.
    fn codex_session_start() -> Value {
        json!({
            "session_id": "019fdd8a-d95e-7883-a78c-a291a89dd5e3",
            "transcript_path": "C:\\Users\\u\\.codex\\sessions\\2026\\08\\07\\rollout-019fdd8a.jsonl",
            "cwd": "C:\\tmp",
            "hook_event_name": "SessionStart",
            "model": "gpt-5.6-luna",
            "permission_mode": "bypassPermissions",
            "source": "startup"
        })
    }

    #[test]
    fn normalize_event_maps_grok_and_antigravity() {
        // Grok speaks Claude's vocabulary, and adds a real error state of its own.
        assert_eq!(
            normalize_event("grok", "UserPromptSubmit", None),
            Some(AgentStatus::Working)
        );
        // A notification is only `waiting` when it says it is one of the kinds
        // that actually blocks on the user. A bare notification with no kind is
        // NOT: Grok emits routine ones (a tool-permission notice it fires even
        // when permissions are bypassed, and an idle nudge once the turn ends),
        // and mapping them all to `waiting` is what parked finished sessions in
        // the "Needs you" lane. Its payloads are camelCase throughout.
        let grok_permission = json!({ "notificationType": "permission_prompt" });
        assert_eq!(
            normalize_event("grok", "notification", Some(&grok_permission)),
            Some(AgentStatus::Waiting)
        );
        assert_eq!(normalize_event("grok", "Notification", None), None);
        assert_eq!(
            normalize_event("grok", "StopFailure", None),
            Some(AgentStatus::Blocked)
        );
        assert_eq!(
            normalize_event("grok", "Stop", None),
            Some(AgentStatus::Done)
        );

        // Antigravity exposes only its execution loop.
        assert_eq!(
            normalize_event("antigravity", "PreInvocation", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("antigravity", "PostToolUse", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("antigravity", "Stop", None),
            Some(AgentStatus::Done)
        );
        // It has no prompt/permission/notification hook at all, so it must never
        // be able to claim the user is needed — the state that drives the badge.
        for event in ["Notification", "PermissionRequest", "UserPromptSubmit"] {
            assert_eq!(normalize_event("antigravity", event, None), None);
        }
    }

    #[test]
    fn normalize_event_maps_each_agent() {
        assert_eq!(
            normalize_event("claude", "PreToolUse", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("claude", "PermissionRequest", None),
            Some(AgentStatus::Waiting)
        );
        assert_eq!(
            normalize_event("claude", "Stop", None),
            Some(AgentStatus::Done)
        );
        // Claude Notification is waiting only for the genuine mid-turn "needs you"
        // types; `idle_prompt` (fires right after Stop) is the finished/resting
        // state → done, and auth/unknown notices are ignored (never override the
        // turn state).
        let notif = json!({ "notification_type": "permission_prompt" });
        assert_eq!(
            normalize_event("claude", "Notification", Some(&notif)),
            Some(AgentStatus::Waiting)
        );
        let idle = json!({ "notification_type": "idle_prompt" });
        assert_eq!(
            normalize_event("claude", "Notification", Some(&idle)),
            Some(AgentStatus::Done)
        );
        let auth = json!({ "notification_type": "auth_success" });
        assert_eq!(normalize_event("claude", "Notification", Some(&auth)), None);
        let chatty = json!({ "notification_type": "auth_refresh" });
        assert_eq!(
            normalize_event("claude", "Notification", Some(&chatty)),
            None
        );
        // Codex reports a permission prompt as `PermissionRequest`; it has no
        // `Notification` hook at all (verified against the running CLI), so the
        // arm that used to map one was a mapping for an event that never arrives.
        assert_eq!(
            normalize_event("codex", "PermissionRequest", None),
            Some(AgentStatus::Waiting)
        );
        assert_eq!(normalize_event("codex", "Notification", None), None);
        // Opening a session is not work: neither Codex nor Grok may mint a
        // `working` from it (see `is_session_boundary`), or the tab claims to be
        // busy from the moment its TUI opens until the user finally types.
        assert_eq!(normalize_event("codex", "SessionStart", None), None);
        assert_eq!(normalize_event("grok", "session_start", None), None);
        assert_eq!(
            normalize_event("opencode", "PermissionRequest", None),
            Some(AgentStatus::Waiting)
        );
        assert_eq!(
            normalize_event("opencode", "Error", None),
            Some(AgentStatus::Blocked)
        );
        // Pi / OMP: only working / done.
        assert_eq!(
            normalize_event("pi", "tool_call", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("pi", "agent_end", None),
            Some(AgentStatus::Done)
        );
        assert_eq!(
            normalize_event("omp", "before_agent_start", None),
            Some(AgentStatus::Working)
        );
        // Unknown event / agent → ignored, never a bogus state.
        assert_eq!(normalize_event("claude", "What", None), None);
        assert_eq!(normalize_event("mystery", "Stop", None), None);
    }

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
    fn event_name_reads_any_key() {
        assert_eq!(
            event_name(&json!({ "hook_event_name": "Stop" })).as_deref(),
            Some("Stop")
        );
        assert_eq!(
            event_name(&json!({ "event": "agent_end" })).as_deref(),
            Some("agent_end")
        );
        assert_eq!(event_name(&json!({ "unrelated": 1 })), None);
    }

    #[test]
    fn parse_status_is_case_insensitive() {
        assert_eq!(parse_status("Working"), Some(AgentStatus::Working));
        assert_eq!(parse_status("  done "), Some(AgentStatus::Done));
        assert_eq!(parse_status("napping"), None);
    }

    #[test]
    fn source_helpers_extract_prompt_and_tool() {
        let src = json!({ "prompt": "fix the bug", "tool_name": "Bash", "interrupted": true });
        assert_eq!(source_prompt(&src).as_deref(), Some("fix the bug"));
        assert_eq!(source_tool(&src).as_deref(), Some("Bash"));
        assert!(source_interrupted(&src));
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
    fn source_subagent_extracts_child_or_none() {
        // Real Claude Code 2.1.209 `SubagentStart` shape: id + type, no description.
        let start = json!({ "agent_id": "a0be512ce35611391", "agent_type": "general-purpose" });
        assert_eq!(
            source_subagent(&start),
            Some((
                "a0be512ce35611391".to_string(),
                Some("general-purpose".to_string()),
                None,
            ))
        );
        // Real `SubagentStop` shape adds the child's final reply as the description.
        let stop = json!({
            "agent_id": "a0be512ce35611391",
            "agent_type": "code-reviewer",
            "last_assistant_message": "Found 2 issues.",
        });
        assert_eq!(
            source_subagent(&stop),
            Some((
                "a0be512ce35611391".to_string(),
                Some("code-reviewer".to_string()),
                Some("Found 2 issues.".to_string()),
            ))
        );
        // No stable child id → None (never invent a bogus row).
        assert_eq!(source_subagent(&json!({ "foo": "bar" })), None);
    }

    /// Captured from a real `codex exec` run on Codex 0.147.0, which spells its
    /// sub-agent payload exactly as Claude does — the reason subscribing to the
    /// two events was the whole change.
    #[test]
    fn source_subagent_reads_codex_payload() {
        let stop = json!({
            "session_id": "019fdfd4-9bfd-7060-bf35-c8fae1fb6a9b",
            "turn_id": "019fdfd4-d605-70f1-aa74-96e0beaf4e76",
            "hook_event_name": "SubagentStop",
            "agent_id": "019fdfd4-d3e9-7943-8fbc-29eb4169f4ca",
            "agent_type": "default",
            "last_assistant_message": "hello",
        });
        assert_eq!(
            source_subagent(&stop),
            Some((
                "019fdfd4-d3e9-7943-8fbc-29eb4169f4ca".to_string(),
                Some("default".to_string()),
                Some("hello".to_string()),
            ))
        );
    }

    /// Captured from a real Grok 0.2.118 run. Grok is camelCase throughout, so
    /// matching only `last_assistant_message` dropped the child's answer.
    #[test]
    fn source_subagent_reads_grok_camel_case_payload() {
        let start = json!({
            "hookEventName": "subagent_start",
            "subagentId": "019fdfc7-67cc-79c2-ad4b-fe50ebe9362a",
            "subagentType": "general-purpose",
            "description": "Report the word hello",
        });
        assert_eq!(
            source_subagent(&start),
            Some((
                "019fdfc7-67cc-79c2-ad4b-fe50ebe9362a".to_string(),
                Some("general-purpose".to_string()),
                Some("Report the word hello".to_string()),
            ))
        );
        let stop = json!({
            "hookEventName": "subagent_stop",
            "subagentId": "019fdfc7-67cc-79c2-ad4b-fe50ebe9362a",
            "subagentType": "general-purpose",
            "lastAssistantMessage": "hello",
        });
        assert_eq!(
            source_subagent(&stop).and_then(|(_, _, d)| d),
            Some("hello".to_string()),
            "Grok's camelCase final reply must reach the roster"
        );
    }

    /// Cursor's real body, byte for byte: a UTF-8 BOM in front of the JSON.
    /// Without the strip, `serde_json` refuses the whole thing and the report
    /// silently loses its event name — which is every Cursor report on Windows.
    #[test]
    fn a_bom_prefixed_body_still_parses() {
        let raw = b"\xEF\xBB\xBF{\"hook_event_name\":\"preToolUse\",\"tool_name\":\"Task\"}";
        let parsed: Value = serde_json::from_slice(strip_bom(raw)).expect("BOM stripped");
        assert_eq!(event_name(&parsed).as_deref(), Some("preToolUse"));
        // Untouched when there is no BOM.
        let plain = b"{\"hook_event_name\":\"stop\"}";
        assert_eq!(strip_bom(plain), plain);
        // And a body that is genuinely broken still fails, rather than being
        // "fixed" into something it never was.
        assert!(serde_json::from_slice::<Value>(strip_bom(b"\xEF\xBB\xBFnot json")).is_err());
    }

    #[test]
    fn is_subagent_event_matches_lifecycle() {
        assert!(is_subagent_event("SubagentStart"));
        assert!(is_subagent_event("SubagentStop"));
        // Grok dispatches snake_case, Cursor/Copilot camelCase — both normalize.
        assert!(is_subagent_event("subagent_start"));
        assert!(is_subagent_event("subagentStop"));
        assert!(!is_subagent_event("Stop"));
        assert!(!is_subagent_event("PreToolUse"));
    }

    #[test]
    fn status_event_serializes_camel_case() {
        let ev = AgentStatusEvent {
            agent_id: "x".into(),
            status: AgentStatus::Waiting,
            agent_type: None,
            prompt: None,
            tool: None,
            interrupted: false,
            summary: None,
            subagents: Vec::new(),
            session: None,
            first_seen: 1,
            last_update: 2,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("agentId"));
        assert!(json.contains("firstSeen"));
        assert!(json.contains("\"waiting\""));
    }

    #[test]
    fn token_eq_matches_only_equal_strings() {
        assert!(token_eq("s3cret-token", "s3cret-token"));
        assert!(token_eq("", ""));
        // Same length, one differing byte.
        assert!(!token_eq("s3cret-token", "s3cret-tokeN"));
        // Prefix of the real token must not pass.
        assert!(!token_eq("s3cret", "s3cret-token"));
        assert!(!token_eq("", "x"));
    }

    #[test]
    fn loopback_caller_gates_by_host_and_origin() {
        use axum::http::{HeaderName, HeaderValue};
        let with = |pairs: &[(HeaderName, &str)]| {
            let mut h = HeaderMap::new();
            for (name, value) in pairs {
                h.insert(name.clone(), HeaderValue::from_str(value).unwrap());
            }
            h
        };
        // No Host/Origin at all → allowed (programmatic clients may omit both).
        assert!(loopback_caller(&HeaderMap::new()));
        // Loopback Host, no Origin → allowed (the reporters' request shape).
        assert!(loopback_caller(&with(&[(header::HOST, "127.0.0.1:5123")])));
        assert!(loopback_caller(&with(&[(header::HOST, "localhost")])));
        assert!(loopback_caller(&with(&[(header::HOST, "[::1]:80")])));
        assert!(loopback_caller(&with(&[(header::HOST, "::1")])));
        // A loopback http(s) Origin (a dev page served from localhost) → allowed.
        assert!(loopback_caller(&with(&[(
            header::ORIGIN,
            "http://localhost:1420"
        )])));
        // A real, non-loopback Host or Origin → rejected (CSRF / DNS-rebinding).
        assert!(!loopback_caller(&with(&[(header::HOST, "evil.example")])));
        assert!(!loopback_caller(&with(&[(
            header::ORIGIN,
            "https://evil.example"
        )])));
        // A loopback Host paired with a hostile Origin → still rejected.
        assert!(!loopback_caller(&with(&[
            (header::HOST, "127.0.0.1:5123"),
            (header::ORIGIN, "https://evil.example"),
        ])));
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

#[cfg(test)]
mod grok_snake_case_tests {
    use super::*;

    #[test]
    fn grok_reports_snake_case_and_must_still_be_understood() {
        // Grok's HookEventName is `#[serde(rename_all = "snake_case")]`, so this
        // is what actually arrives — the PascalCase spelling only ever appears
        // in the config file we write.
        assert_eq!(
            normalize_event("grok", "stop", None),
            Some(AgentStatus::Done),
            "a finished Grok turn was being discarded, leaving the card on working"
        );
        assert_eq!(
            normalize_event("grok", "session_end", None),
            Some(AgentStatus::Done)
        );
        assert_eq!(
            normalize_event("grok", "pre_tool_use", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("grok", "stop_failure", None),
            Some(AgentStatus::Blocked)
        );
        // The config spelling keeps working, so nothing regresses.
        assert_eq!(
            normalize_event("grok", "Stop", None),
            Some(AgentStatus::Done)
        );
        // An event we do not model is still ignored rather than guessed at.
        assert_eq!(normalize_event("grok", "some_future_event", None), None);
    }

    #[test]
    fn pascal_case_leaves_other_agents_vocabularies_alone() {
        assert_eq!(pascal_case("Stop"), "Stop");
        assert_eq!(pascal_case("pre_tool_use"), "PreToolUse");
        assert_eq!(pascal_case(""), "");
        // pi speaks snake_case by design and matches it directly, so its arm
        // must not be routed through this.
        assert_eq!(
            normalize_event("pi", "agent_end", None),
            Some(AgentStatus::Done)
        );
    }
}
