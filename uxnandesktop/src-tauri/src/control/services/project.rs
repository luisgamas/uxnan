//! Projects: the registered folders and repositories.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use super::worktree::{list_of, WorktreeView};
use crate::control::resolve::{ProjectRef, Resolver};
use crate::control::Caller;

/// One project with its worktrees.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: ProjectRef,
    pub worktrees: Vec<WorktreeView>,
}

async fn view<R: tauri::Runtime>(
    app: &AppHandle<R>,
    project: ProjectRef,
    with_status: bool,
) -> Result<ProjectView, RpcError> {
    let entries = list_of(app, &project.repo()).await?;
    let mut worktrees = Vec::with_capacity(entries.len());
    for entry in &entries {
        worktrees.push(WorktreeView::build(app, &project, entry, with_status).await);
    }
    Ok(ProjectView { project, worktrees })
}

/// `project/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let mut out = Vec::new();
    for project in Resolver::new(app, caller).projects().await {
        out.push(view(app, project, false).await?);
    }
    Ok(json!({ "projects": out }))
}

/// `project/show`.
pub async fn show<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let project = Resolver::new(app, caller).project(sel).await?;
    serde_json::to_value(view(app, project, true).await?)
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.to_string()))
}
