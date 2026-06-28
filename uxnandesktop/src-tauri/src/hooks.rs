//! Local agent hook server — Layer 1 of agent monitoring (spec `02d` §1.1).
//!
//! The ADE binds a small `axum` HTTP server to an ephemeral `127.0.0.1` port.
//! An agent's hook `POST`s a JSON state report to `/hook`; we normalize it into
//! [`crate::model::AgentStatus`], upsert it into the persistent agent cache
//! (TTL-pruned, spec §1.5) and broadcast `agent:status-changed` to the frontend
//! so the sidebar/tab indicators update with a precise state — unlike the coarse
//! output-activity inference, the hook distinguishes `working`/`blocked`/
//! `waiting`/`done`.
//!
//! The server's URL + a per-launch token are injected into every terminal as
//! `UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN`, and each terminal carries its PTY id as
//! `UXNAN_AGENT_ID`; an agent's hook echoes that id back so the frontend can map
//! the report to the terminal/worktree that produced it. The token (required in
//! the `X-Uxnan-Token` header) rejects stray local processes.
//!
//! Wiring an agent to actually call this is per-agent configuration left to the
//! user/developer — see `docs/agent-hooks.md` and `FOR-DEV.md`.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::State as AxumState,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;

use crate::model::{AgentReport, AgentStatus};
use crate::state::{AppState, HookServerInfo};

/// Header carrying the shared secret that authorizes a hook report.
const TOKEN_HEADER: &str = "x-uxnan-token";

/// Current unix time in seconds — the stamp used for agent-cache entries.
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The JSON body an agent's hook POSTs to report its state (spec §1.1). Field
/// names are camelCase; `status` is one of `working`/`blocked`/`waiting`/`done`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPayload {
    /// Echo of the `UXNAN_AGENT_ID` env (the PTY id) the ADE injected.
    pub agent_id: String,
    /// Normalized lifecycle state.
    pub status: AgentStatus,
    /// Agent kind (`claude`, `codex`, …), if the hook reports it.
    #[serde(default)]
    pub agent_type: Option<String>,
    /// User prompt the agent is processing, if reported.
    #[serde(default)]
    pub prompt: Option<String>,
    /// Tool in use (`file_edit`, `bash`, `web_search`, …), if reported.
    #[serde(default)]
    pub tool: Option<String>,
    /// Whether the agent was interrupted.
    #[serde(default)]
    pub interrupted: bool,
    /// Short preview of the agent's latest response (sent on `done`), if any.
    #[serde(default)]
    pub summary: Option<String>,
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

/// Bind the hook server to an ephemeral `127.0.0.1` port and spawn its serve
/// loop on the Tokio runtime. Returns the coordinates (url + token) so the
/// caller can publish them for env injection. Errors if the port can't be bound
/// (the app still runs — just without precise hook reporting).
pub async fn start(app: AppHandle, token: String) -> std::io::Result<HookServerInfo> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let ctx = HookCtx {
        app,
        token: token.clone(),
    };
    let router = Router::new()
        .route("/hook", post(handle_hook))
        .route("/browser", post(handle_browser))
        .route("/health", get(|| async { "ok" }))
        .with_state(ctx);
    tauri::async_runtime::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            eprintln!("[uxnan-desktop] hook server stopped: {err}");
        }
    });
    Ok(HookServerInfo {
        url: format!("http://127.0.0.1:{port}/hook"),
        token,
    })
}

/// Handle one `POST /hook`: authorize, normalize, cache + persist, broadcast.
async fn handle_hook(
    AxumState(ctx): AxumState<HookCtx>,
    headers: HeaderMap,
    Json(payload): Json<HookPayload>,
) -> StatusCode {
    // Reject any local process that doesn't present the shared token.
    let authorized = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == ctx.token)
        .unwrap_or(false);
    if !authorized {
        return StatusCode::UNAUTHORIZED;
    }
    if payload.agent_id.trim().is_empty() {
        return StatusCode::BAD_REQUEST;
    }

    let now = now_secs();
    let state = ctx.app.state::<AppState>();
    let entry = {
        let mut data = state.data.write().await;
        let entry = data.upsert_agent_state(
            AgentReport {
                agent_id: payload.agent_id,
                status: payload.status,
                agent_type: payload.agent_type,
                prompt: payload.prompt,
                tool: payload.tool,
                interrupted: payload.interrupted,
                summary: payload.summary,
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

/// The JSON body the agent `BROWSER` shim POSTs to open a URL in-app: `{"url": …}`.
#[derive(Debug, Clone, Deserialize)]
struct BrowserRequest {
    url: String,
}

/// Handle one `POST /browser`: authorize, then route the URL through the user's
/// browser policy (in-app tab / OS browser / prompt). Lets an agent open a link in
/// the integrated browser via `UXNAN_BROWSER_URL` + `UXNAN_BROWSER_TOKEN`.
async fn handle_browser(
    AxumState(ctx): AxumState<HookCtx>,
    headers: HeaderMap,
    Json(payload): Json<BrowserRequest>,
) -> StatusCode {
    let authorized = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == ctx.token)
        .unwrap_or(false);
    if !authorized {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_secs_is_positive() {
        assert!(now_secs() > 0);
    }

    #[test]
    fn hook_payload_parses_camel_case_and_status_enum() {
        let json = r#"{"agentId":"pty-7","status":"working","agentType":"claude",
            "tool":"bash","interrupted":false}"#;
        let p: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.agent_id, "pty-7");
        assert_eq!(p.status, AgentStatus::Working);
        assert_eq!(p.agent_type.as_deref(), Some("claude"));
        assert_eq!(p.tool.as_deref(), Some("bash"));
        assert!(p.prompt.is_none());
    }

    #[test]
    fn hook_payload_requires_only_id_and_status() {
        let p: HookPayload = serde_json::from_str(r#"{"agentId":"x","status":"done"}"#).unwrap();
        assert_eq!(p.status, AgentStatus::Done);
        assert!(!p.interrupted);
    }

    #[test]
    fn unknown_status_is_rejected() {
        let bad = serde_json::from_str::<HookPayload>(r#"{"agentId":"x","status":"napping"}"#);
        assert!(bad.is_err());
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
