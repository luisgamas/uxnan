//! Terminals: the tabs the window holds, enriched with what the backend knows
//! about the agent in each.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use super::agent::AgentView;
use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::resolve::{path_within, Resolver};
use crate::control::Caller;

/// The most a first message to an agent may weigh. A prompt is a message, not
/// a document: anything larger belongs in a file the agent is told to read.
pub const PROMPT_MAX_BYTES: usize = 64 * 1024;

/// The `prompt` rules shared by every entry that launches an agent: it needs
/// an agent to be typed into, and it is capped.
pub fn check_prompt(agent: Option<&str>, prompt: Option<&str>) -> Result<(), RpcError> {
    if let Some(p) = prompt {
        if agent.is_none() {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                "`prompt` needs `agent`: a plain terminal has nobody to read it",
            ));
        }
        if p.len() > PROMPT_MAX_BYTES {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!(
                    "`prompt` is {} bytes; the most a first message may be is {} — put the rest in a file and tell the agent to read it",
                    p.len(),
                    PROMPT_MAX_BYTES
                ),
            ));
        }
    }
    Ok(())
}

/// A terminal tab as the window reports it. The window owns tabs, so this is
/// the window's word; the backend adds the agent state below.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabView {
    /// The tab id, which is also the PTY id and the agent id.
    pub id: String,
    pub title: String,
    /// The workspace key the tab belongs to: a worktree path, prefixed with
    /// `ssh:<hostId>::` when on a host; empty for the Global space.
    pub workspace: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// `local` or `ssh:<hostId>`.
    #[serde(default = "local")]
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_model: Option<String>,
    #[serde(default)]
    pub exited: bool,
    #[serde(default)]
    pub asleep: bool,
}

fn local() -> String {
    "local".into()
}

impl TabView {
    /// The worktree folder of the tab's workspace, for a local tab. A host's
    /// workspace has no folder on this machine; the Global space has none at all.
    pub fn workspace_path(&self) -> Option<&str> {
        if self.workspace.is_empty() || self.workspace.contains("::") {
            return None;
        }
        Some(self.workspace.as_str())
    }
}

/// The window's tab list.
pub async fn tabs<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Vec<TabView>, RpcError> {
    let value = Bridge::ask(app, "terminal/list", Value::Null).await?;
    let tabs = value.get("tabs").cloned().unwrap_or(Value::Array(vec![]));
    serde_json::from_value(tabs).map_err(|e| {
        RpcError::new(
            ErrorCode::Internal,
            format!("the window's tab list could not be read: {e}"),
        )
    })
}

/// A tab plus the agent state the backend knows for it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalView {
    #[serde(flatten)]
    pub tab: TabView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentView>,
}

async fn enrich<R: tauri::Runtime>(app: &AppHandle<R>, tabs: Vec<TabView>) -> Vec<TerminalView> {
    let agents = super::agent::all(app).await;
    tabs.into_iter()
        .map(|tab| {
            let agent = agents.iter().find(|a| a.terminal_id == tab.id).cloned();
            TerminalView { tab, agent }
        })
        .collect()
}

/// `terminal/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let mut all = tabs(app).await?;
    if let Some(sel) = params.get("worktree").and_then(|v| v.as_str()) {
        let (_, entry) = Resolver::new(app, caller).worktree(sel).await?;
        all.retain(|t| {
            t.workspace_path()
                .is_some_and(|w| path_within(w, &entry.path))
        });
    }
    Ok(json!({ "terminals": enrich(app, all).await }))
}

/// `terminal/create`: a new tab in a worktree, optionally with an agent and its
/// first message. The window does the opening (a tab is its object); the
/// receipt carries the tab id it minted.
pub async fn create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("worktree")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let (project, entry) = Resolver::new(app, caller).worktree(sel).await?;
    let agent = params.get("agent").and_then(|v| v.as_str());
    let prompt = params.get("prompt").and_then(|v| v.as_str());
    check_prompt(agent, prompt)?;
    let answer = Bridge::ask(
        app,
        "terminal/create",
        json!({
            "worktree": entry.path,
            "target": project.target,
            "agent": agent,
            "title": params.get("title").and_then(|v| v.as_str()),
            "prompt": prompt,
        }),
    )
    .await?;
    if let Some(message) = answer.get("error").and_then(|v| v.as_str()) {
        return Err(RpcError::new(ErrorCode::NotFound, message));
    }
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "terminal": answer.get("terminal").cloned().unwrap_or(Value::Null), "worktree": entry.path }),
    ))
}

/// `terminal/show`.
pub async fn show<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("terminal")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tab = Resolver::new(app, caller).terminal(sel).await?;
    let mut views = enrich(app, vec![tab]).await;
    serde_json::to_value(views.remove(0))
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_needs_an_agent_and_a_size_under_the_cap() {
        assert!(check_prompt(None, None).is_ok());
        assert!(check_prompt(Some("claude"), None).is_ok());
        assert!(check_prompt(Some("claude"), Some("hi")).is_ok());
        let no_agent = check_prompt(None, Some("hi")).unwrap_err();
        assert!(no_agent.message.contains("needs `agent`"));
        let big = "x".repeat(PROMPT_MAX_BYTES + 1);
        let too_big = check_prompt(Some("claude"), Some(&big)).unwrap_err();
        assert!(too_big.message.contains("the most a first message may be"));
    }

    #[test]
    fn a_tab_knows_whether_its_workspace_is_a_local_folder() {
        let mut t: TabView = serde_json::from_value(json!({
            "id": "t1", "title": "zsh", "workspace": "/home/dev/app"
        }))
        .unwrap();
        assert_eq!(t.workspace_path(), Some("/home/dev/app"));
        assert_eq!(t.target, "local");
        t.workspace = "ssh:h1::/srv/app".into();
        assert_eq!(t.workspace_path(), None);
        t.workspace = String::new();
        assert_eq!(t.workspace_path(), None);
    }
}
