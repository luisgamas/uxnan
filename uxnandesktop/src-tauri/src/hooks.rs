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
//!
//! The server itself — binding, routing, the loopback and token gates, the
//! endpoint file — lives in `control::server`, which owns every local route
//! (`/hook`, `/browser`, `/mcp`, the control RPC). This module is only the
//! meaning of a hook report: [`normalize_event`] and [`handle_report`].

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use uxnan_workspace_engine::transcript::{tidy, PREVIEW_MAX};

use crate::model::{AgentReport, AgentSession, AgentStatus, SubagentEntry};
use crate::state::AppState;

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
        // precisely and can never claim to be waiting on the user. The reporter
        // registers no `PreToolUse` (it is a permission gate, see
        // `agent_hooks::ANTIGRAVITY_TOOL_EVENTS`); it is still accepted here so a
        // config written by an older release keeps reporting until the next
        // launch rewrites it.
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
fn emit_agent_status_cleared<R: tauri::Runtime>(
    app: &AppHandle<R>,
    agent_id: String,
    agent_type: Option<String>,
    session: Option<AgentSession>,
) {
    app.state::<AppState>().agent_changes.notify_waiters();
    let _ = app.emit(
        "agent:status-cleared",
        AgentStatusClearedEvent {
            agent_id,
            agent_type,
            session,
        },
    );
}

/// Broadcast a cached agent entry to the frontend as `agent:status-changed`,
/// and wake whoever waits on agent state (`agent/wait`).
fn emit_agent_status<R: tauri::Runtime>(app: &AppHandle<R>, entry: crate::model::AgentStateEntry) {
    app.state::<AppState>().agent_changes.notify_waiters();
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

/// Read a header as an owned, trimmed, non-empty string.
fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Asks a host's engine for the last turn's `(prompt, reply)` from a
/// transcript on that host: `(agent_type, path)`.
pub(crate) type TranscriptAsk = std::sync::Arc<
    dyn Fn(
            String,
            String,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = (Option<String>, Option<String>)> + Send>,
        > + Send
        + Sync,
>;

/// Which machine a report was made on.
#[derive(Clone)]
pub(crate) enum ReportOrigin {
    /// An agent in a terminal here, through the local server.
    ThisMachine,
    /// An agent in a terminal on a host, forwarded by that host's engine. The
    /// paths it names are the host's, so nothing here is read on their word:
    /// what a transcript there says is asked of that engine.
    Host(TranscriptAsk),
}

/// Handle one report: a `POST /hook` that the local server has already
/// authorized (`control::server`), or one a host's engine forwarded
/// (`ssh::engine`). Resolve it (from headers and/or body, in any of the three
/// accepted shapes), normalize, cache + persist, broadcast. Always fails open —
/// an unrecognized event or a malformed body returns `204` so a broken hook can
/// never break the agent that fired it.
pub(crate) async fn handle_report<R: tauri::Runtime>(
    app: &AppHandle<R>,
    headers: HeaderMap,
    body: Bytes,
    origin: ReportOrigin,
) -> StatusCode {
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
        let state = app.state::<AppState>();
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
        emit_agent_status(app, entry);
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
        let state = app.state::<AppState>();
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
                emit_agent_status(app, entry);
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
                let state = app.state::<AppState>();
                {
                    let mut data = state.data.write().await;
                    data.clear_agent_state(&agent_id);
                    let _ = state.persistence.save(&data);
                }
                emit_agent_status_cleared(app, agent_id, agent_type, session);
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
    // show a bare status. The file is read on the machine the agent runs on: a
    // host's transcript by that host's engine, never here by its path. Either
    // way it is read only if it is a transcript of that agent's own
    // (`transcript::preview`); on any failure the report still succeeds, just
    // without the preview.
    if status == AgentStatus::Done {
        let named = source
            .and_then(|s| s.get("transcript_path").or_else(|| s.get("transcriptPath")))
            .and_then(|v| v.as_str());
        if let (Some(kind), Some(tp)) = (agent_type.as_deref(), named) {
            let (t_prompt, t_summary) = match &origin {
                ReportOrigin::ThisMachine => uxnan_workspace_engine::transcript::preview(kind, tp),
                ReportOrigin::Host(ask) => ask(kind.to_string(), tp.to_string()).await,
            };
            if let Some(p) = t_prompt {
                prompt = Some(p);
            }
            if summary.is_none() {
                summary = t_summary;
            }
        }
    }

    let now = now_secs();
    // Provider session identity (for resume) — most events repeat it; a miss
    // never clears an id captured earlier (see `upsert_agent_state`).
    let session = source.and_then(|s| extract_session(s, now));
    let state = app.state::<AppState>();
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

    emit_agent_status(app, entry);
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
