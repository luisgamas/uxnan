//! Worktrees: the list a project has, and one of them in detail.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::RpcError;

use super::agent::AgentView;
use crate::control::resolve::{ProjectRef, Resolver};
use crate::control::Caller;
use crate::git::{self, WorktreeEntry, WorktreeStatus};
use crate::model::RepoData;
use crate::state::AppState;
use crate::target::TargetId;

/// The worktree list of one project, wherever it lives. This is the one
/// implementation: the sidebar's `worktree_list` command delegates here.
///
/// A project on a host is asked over its SSH session (its shell was identified
/// when it connected, so the arguments are quoted for the shell that receives
/// them); a host that could not be named, has no git, or holds a plain folder
/// answers "not a repository" and the row says the branch was not read — never
/// a branch this machine made up. A local plain folder lists its own folder with
/// no branch. A local repository asks git.
pub async fn list_of<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo: &RepoData,
) -> Result<Vec<WorktreeEntry>, RpcError> {
    let state = app.state::<AppState>();
    if let Some(host_id) = repo.target.ssh_host_id() {
        let shell = state
            .ssh_shells
            .read()
            .await
            .get(host_id)
            .copied()
            .unwrap_or_default();
        let conn = state.ssh_sessions.read().await.get(host_id).cloned();
        let branch = match conn {
            Some(conn) => {
                crate::ssh::git::status(&conn, shell, &repo.path)
                    .await
                    .branch
            }
            None => None,
        };
        return Ok(vec![WorktreeEntry {
            path: repo.path.clone(),
            branch,
            head: None,
            is_main: true,
        }]);
    }
    if let Some(entries) = worktrees_without_git(&repo.target, &repo.path) {
        return Ok(entries);
    }
    git::list_worktrees(&repo.path).await.map_err(|e| {
        RpcError::new(
            uxnan_control_protocol::rpc::ErrorCode::Internal,
            e.to_string(),
        )
    })
}

/// The worktree list for a project this machine's git cannot answer for: one
/// entry, the project's own folder, and **no branch**. `None` means "local — go
/// ask git".
///
/// Split out so the decision is testable on its own, because the invariant is
/// easy to break and expensive when broken: a project on a host must never
/// report a branch, or the sidebar would put this machine's answer on another
/// machine's repository.
pub fn worktrees_without_git(target: &TargetId, repo_path: &str) -> Option<Vec<WorktreeEntry>> {
    if target.is_local() {
        return None;
    }
    Some(vec![WorktreeEntry {
        path: repo_path.to_string(),
        branch: None,
        head: None,
        is_main: true,
    }])
}

/// The badge summary of a local worktree (changed entries, ahead/behind). A
/// folder that is not a repository, or a worktree on a host, has none.
pub async fn status_of(repo: &RepoData, path: &str) -> Option<WorktreeStatus> {
    if !repo.target.is_local() || !repo.is_git {
        return None;
    }
    git::worktree_status(path).await.ok()
}

/// One worktree as the catalog describes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeView {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_main: bool,
    pub project: ProjectRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<WorktreeStatus>,
    pub agents: Vec<AgentView>,
}

impl WorktreeView {
    pub async fn build<R: tauri::Runtime>(
        app: &AppHandle<R>,
        project: &ProjectRef,
        entry: &WorktreeEntry,
        with_status: bool,
    ) -> Self {
        let repo = project.repo();
        let status = if with_status {
            status_of(&repo, &entry.path).await
        } else {
            None
        };
        let agents = super::agent::in_worktree(app, &entry.path).await;
        WorktreeView {
            path: entry.path.clone(),
            branch: entry.branch.clone(),
            head: entry.head.clone(),
            is_main: entry.is_main,
            project: project.clone(),
            status,
            agents,
        }
    }
}

/// `worktree/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let resolver = Resolver::new(app, caller);
    let projects = match params.get("project").and_then(|v| v.as_str()) {
        Some(sel) => vec![resolver.project(sel).await?],
        None => resolver.projects().await,
    };
    let mut out = Vec::new();
    for project in projects {
        for entry in list_of(app, &project.repo()).await? {
            out.push(WorktreeView::build(app, &project, &entry, false).await);
        }
    }
    Ok(json!({ "worktrees": out }))
}

/// `worktree/show`.
pub async fn show<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("worktree")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let (project, entry) = Resolver::new(app, caller).worktree(sel).await?;
    let view = WorktreeView::build(app, &project, &entry, true).await;
    serde_json::to_value(view).map_err(|e| {
        RpcError::new(
            uxnan_control_protocol::rpc::ErrorCode::Internal,
            e.to_string(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_project_lists_its_folder_with_no_branch() {
        let got = worktrees_without_git(&TargetId::Ssh("h1".into()), "/srv/app").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, "/srv/app");
        assert_eq!(got[0].branch, None);
        assert!(got[0].is_main);
        assert!(worktrees_without_git(&TargetId::Local, "/srv/app").is_none());
    }
}
