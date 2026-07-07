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
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Router,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;

use crate::model::{AgentReport, AgentStatus};
use crate::state::{AppState, HookServerInfo};

/// Header carrying the shared secret that authorizes a hook report.
const TOKEN_HEADER: &str = "x-uxnan-token";
/// Header a shell `curl` script uses to pass the terminal (PTY) id out-of-band.
const AGENT_ID_HEADER: &str = "x-uxnan-agent-id";
/// Header a shell `curl` script uses to pass the agent kind out-of-band.
const AGENT_TYPE_HEADER: &str = "x-uxnan-agent-type";
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
        "claude" => match event {
            "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
            | "PreCompact" => Some(AgentStatus::Working),
            "PermissionRequest" => Some(AgentStatus::Waiting),
            // Claude also surfaces a permission/idle prompt as a `Notification`
            // with a `notification_type`; only the "needs you" kinds mean waiting.
            "Notification" => match source.and_then(notification_type).as_deref() {
                Some(
                    "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog"
                    | "agent_needs_input",
                ) => Some(AgentStatus::Waiting),
                _ => None,
            },
            "Stop" | "SessionEnd" => Some(AgentStatus::Done),
            _ => None,
        },
        "codex" => match event {
            "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PreCompact" => {
                Some(AgentStatus::Working)
            }
            "PermissionRequest" | "Notification" => Some(AgentStatus::Waiting),
            "Stop" => Some(AgentStatus::Done),
            _ => None,
        },
        "gemini" => match event {
            // Gemini's turn events are Before/After Agent/Tool (it has no
            // permission hook, so no `waiting`).
            "BeforeAgent" | "BeforeTool" | "AfterTool" | "PreToolUse" | "PostToolUse" => {
                Some(AgentStatus::Working)
            }
            "AfterAgent" | "SessionEnd" => Some(AgentStatus::Done),
            _ => None,
        },
        "opencode" => match event {
            "SessionStart" | "SessionBusy" | "MessagePart" => Some(AgentStatus::Working),
            "SessionIdle" | "Stop" => Some(AgentStatus::Done),
            "PermissionRequest" | "AskUserQuestion" => Some(AgentStatus::Waiting),
            "Error" => Some(AgentStatus::Blocked),
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

/// Pull a `notification_type` out of a raw Claude `Notification` payload.
fn notification_type(source: &Value) -> Option<String> {
    source
        .get("notification_type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract the provider event name from a raw hook payload, trying every key an
/// agent might use (`hook_event_name` for Claude/Codex/Gemini, `event`/`type`/
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

/// Whether a raw provider `Stop`/result payload signals the agent was
/// interrupted (user hit Esc / Ctrl-C) rather than finishing naturally.
fn source_interrupted(source: &Value) -> bool {
    source
        .get("interrupted")
        .and_then(|v| v.as_bool())
        .or_else(|| source.get("is_interrupt").and_then(|v| v.as_bool()))
        .unwrap_or(false)
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
        return String::new();
    };
    arr.iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Read a Claude session transcript (JSONL) and return the last user prompt +
/// the last assistant text response, to enrich a `done` notification. All I/O is
/// best-effort: any read/parse problem yields `(None, None)`. The transcript can
/// be large, so this only runs on the (infrequent) `done` transition.
fn transcript_preview(path: &str) -> (Option<String>, Option<String>) {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return (None, None);
    };
    let mut prompt = None;
    let mut summary = None;
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let msg = entry.get("message");
        let role = msg
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            .or_else(|| entry.get("type").and_then(|t| t.as_str()));
        let content = msg.and_then(|m| m.get("content"));
        let text = content.map(text_of).unwrap_or_default();
        let text = tidy(&text, PREVIEW_MAX);
        if text.is_empty() {
            continue;
        }
        match role {
            Some("user") => prompt = Some(text),
            Some("assistant") => summary = Some(text),
            _ => {}
        }
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
    pub first_seen: i64,
    pub last_update: i64,
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

/// Whether the request carries the shared token.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == token)
        .unwrap_or(false)
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
    if !authorized(&headers, &ctx.token) {
        return StatusCode::UNAUTHORIZED;
    }

    // The body may be: a JSON envelope `{agentId, agentType, event, source, …}`
    // (node relay / JS plugin), a raw provider event (shell curl), or empty
    // (generic wrapper — everything is in headers). Parse leniently.
    let body_val: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap_or(Value::Null)
    };
    let body_get = |k: &str| body_val.get(k).and_then(|v| v.as_str()).map(str::to_string);

    let agent_id = header_str(&headers, AGENT_ID_HEADER)
        .or_else(|| body_get("agentId"))
        .filter(|s| !s.trim().is_empty());
    let Some(agent_id) = agent_id else {
        return StatusCode::BAD_REQUEST;
    };
    let agent_type = header_str(&headers, AGENT_TYPE_HEADER).or_else(|| body_get("agentType"));

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

    // Resolve the effective status. Priority: an explicit header/body status
    // (the wrapper knows it directly), else derive from the provider event.
    let direct_status = header_str(&headers, STATUS_HEADER)
        .or_else(|| body_get("status"))
        .and_then(|s| parse_status(&s));
    let status = match direct_status {
        Some(s) => s,
        None => {
            let event = body_get("event").or_else(|| source.and_then(event_name));
            match (agent_type.as_deref(), event.as_deref()) {
                (Some(at), Some(ev)) => match normalize_event(at, ev, source) {
                    Some(s) => s,
                    // Not a state-changing event — ignore, don't cache a lie.
                    None => return StatusCode::NO_CONTENT,
                },
                // No status and nothing to normalize: nothing to do.
                _ => return StatusCode::NO_CONTENT,
            }
        }
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
    let mut summary = body_get("summary").filter(|s| !s.trim().is_empty());

    // On a Claude completion, enrich with the task + a short response preview,
    // read from the session transcript the hook pointed us at.
    if status == AgentStatus::Done && agent_type.as_deref() == Some("claude") {
        if let Some(tp) = source
            .and_then(|s| s.get("transcript_path"))
            .and_then(|v| v.as_str())
        {
            let (t_prompt, t_summary) = transcript_preview(tp);
            if let Some(p) = t_prompt {
                prompt = Some(p);
            }
            if summary.is_none() {
                summary = t_summary;
            }
        }
    }

    let now = now_secs();
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
            },
            now,
        );
        // Best-effort persist so the state survives a restart (TTL-pruned).
        let _ = state.persistence.save(&data);
        entry
    };

    let _ = ctx.app.emit(
        "agent:status-changed",
        AgentStatusEvent {
            agent_id: entry.agent_id,
            status: entry.status,
            agent_type: entry.agent_type,
            prompt: entry.prompt,
            tool: entry.tool,
            interrupted: entry.interrupted,
            summary: entry.summary,
            first_seen: entry.first_seen,
            last_update: entry.last_update,
        },
    );
    StatusCode::NO_CONTENT
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
        // Claude Notification is waiting only for the "needs you" types.
        let notif = json!({ "notification_type": "permission_prompt" });
        assert_eq!(
            normalize_event("claude", "Notification", Some(&notif)),
            Some(AgentStatus::Waiting)
        );
        let chatty = json!({ "notification_type": "auth_refresh" });
        assert_eq!(
            normalize_event("claude", "Notification", Some(&chatty)),
            None
        );
        assert_eq!(
            normalize_event("codex", "Notification", None),
            Some(AgentStatus::Waiting)
        );
        assert_eq!(
            normalize_event("gemini", "BeforeTool", None),
            Some(AgentStatus::Working)
        );
        assert_eq!(
            normalize_event("gemini", "AfterAgent", None),
            Some(AgentStatus::Done)
        );
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
    fn status_event_serializes_camel_case() {
        let ev = AgentStatusEvent {
            agent_id: "x".into(),
            status: AgentStatus::Waiting,
            agent_type: None,
            prompt: None,
            tool: None,
            interrupted: false,
            summary: None,
            first_seen: 1,
            last_update: 2,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("agentId"));
        assert!(json.contains("firstSeen"));
        assert!(json.contains("\"waiting\""));
    }
}
