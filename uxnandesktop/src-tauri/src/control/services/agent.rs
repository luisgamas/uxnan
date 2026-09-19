//! Agents: what the hook reports have told the backend about each one.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::RpcError;

use crate::control::resolve::path_within;
use crate::control::Caller;
use crate::model::{AgentStateEntry, AgentStatus};
use crate::state::AppState;

/// One tracked agent, as the catalog describes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    /// The terminal it runs in (its `UXNAN_AGENT_ID`).
    pub terminal_id: String,
    /// `claude`, `codex`, … when the hook said; absent for an agent whose hooks
    /// never reported a kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// `working`, `blocked`, `waiting` or `done`.
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub interrupted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// The provider's own session id, when captured — what `--resume` takes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// The worktree folder the terminal was opened in, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Epoch seconds.
    pub first_seen: i64,
    pub last_update: i64,
}

impl AgentView {
    fn of(entry: &AgentStateEntry, cwd: Option<String>) -> Self {
        AgentView {
            terminal_id: entry.agent_id.clone(),
            kind: entry.agent_type.clone(),
            status: entry.status,
            prompt: entry.prompt.clone(),
            tool: entry.tool.clone(),
            interrupted: entry.interrupted,
            summary: entry.summary.clone(),
            session_id: entry.session.as_ref().map(|s| s.id.clone()),
            cwd,
            first_seen: entry.first_seen,
            last_update: entry.last_update,
        }
    }
}

/// Every agent in the cache whose terminal is still alive. The cache keeps an
/// entry for a while after its terminal closes (so a restored tab can resume);
/// a caller asking "who is running" is told only about live ones.
pub async fn all<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<AgentView> {
    let state = app.state::<AppState>();
    let live: std::collections::HashMap<String, String> =
        state.pty.live_sessions().into_iter().collect();
    let data = state.data.read().await;
    data.agent_cache
        .iter()
        .filter_map(|e| {
            live.get(&e.agent_id)
                .map(|cwd| AgentView::of(e, Some(cwd.clone())))
        })
        .collect()
}

/// The live agents whose terminal was opened inside `worktree_path`.
pub async fn in_worktree<R: tauri::Runtime>(
    app: &AppHandle<R>,
    worktree_path: &str,
) -> Vec<AgentView> {
    all(app)
        .await
        .into_iter()
        .filter(|a| {
            a.cwd
                .as_deref()
                .is_some_and(|c| path_within(c, worktree_path))
        })
        .collect()
}

/// `agent/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    Ok(json!({ "agents": all(app).await }))
}
