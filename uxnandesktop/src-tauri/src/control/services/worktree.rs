//! Worktrees: the list a project has, and one of them in detail.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::RpcError;

use super::agent::AgentView;
use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::resolve::{ProjectRef, Resolver};
use crate::control::Caller;
use crate::error::AppError;
use crate::git::{self, WorktreeEntry, WorktreeStatus};
use crate::model::{RepoData, WorktreeLocationMode};
use crate::state::AppState;
use crate::target::TargetId;
use crate::worktreeloc;

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

/// What a new worktree is made of.
#[derive(Debug, Clone, Default)]
pub struct CreateSpec {
    /// The branch to create (or, with `from_existing`, to check out).
    pub branch: String,
    /// The ref to branch from; the project's default base when `None`.
    pub base: Option<String>,
    /// Check out an existing branch instead of creating one.
    pub from_existing: bool,
    /// A custom absolute folder; the location policy decides when `None`.
    pub path: Option<String>,
}

/// Create a worktree of a local repository. This is the one implementation:
/// the window's `worktree_create` command and the `worktree/create` entry both
/// end here. The folder comes from the worktree-location policy
/// (`worktreeloc`, spec `02c` §2.1) unless the caller names one, which must
/// then be absolute and not exist yet. Git's own listing names the result.
pub async fn create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo: &RepoData,
    spec: CreateSpec,
) -> Result<WorktreeEntry, AppError> {
    let branch = spec.branch.trim().to_string();
    if branch.is_empty() {
        return Err(AppError::Invalid("branch name is required".to_string()));
    }
    if !repo.target.is_local() {
        return Err(AppError::Invalid(
            "a worktree can only be created for a project on this machine".to_string(),
        ));
    }
    if !repo.is_git {
        return Err(AppError::Invalid(format!(
            "{} is a plain folder, not a git repository",
            repo.path
        )));
    }
    let repo_path = repo.path.clone();
    let worktree_path = match spec
        .path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
    {
        Some(custom) => {
            let normalized = custom.replace('\\', "/");
            let normalized = normalized.trim_end_matches('/').to_string();
            if !std::path::Path::new(&normalized).is_absolute() {
                return Err(AppError::Invalid(
                    "custom worktree path must be absolute".to_string(),
                ));
            }
            if std::path::Path::new(&normalized).exists() {
                return Err(AppError::Invalid(
                    "a folder already exists at that path".to_string(),
                ));
            }
            normalized
        }
        None => {
            let state = app.state::<AppState>();
            let resolved = resolve_location(&state, repo, &branch).await?;
            worktreeloc::prepare(&resolved).await;
            resolved.path
        }
    };

    if spec.from_existing {
        git::add_worktree_from_existing(&repo_path, &branch, &worktree_path).await?;
    } else {
        let base = match spec
            .base
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty())
        {
            Some(base) => base,
            None => git::default_base(&repo_path).await,
        };
        git::add_worktree(&repo_path, &branch, &worktree_path, Some(&base)).await?;
    }

    // Prefer git's own listing of the new worktree (canonical path/branch/head);
    // fall back to a hand-built entry if the re-list misses it for any reason.
    Ok(git::find_worktree_entry(&repo_path, &worktree_path)
        .await
        .unwrap_or(WorktreeEntry {
            path: worktree_path,
            branch: Some(branch),
            head: None,
            is_main: false,
        }))
}

/// Where the policy puts a new worktree of `repo` for `branch`: the project's
/// own root when it has one, else the global custom root, else the managed
/// layout (`worktreeloc`). Shared with the commands that preview a location or
/// create a worktree for a GitHub pull request or issue.
pub async fn resolve_location(
    state: &AppState,
    repo: &RepoData,
    branch: &str,
) -> Result<worktreeloc::Resolved, AppError> {
    let (mode, root) = {
        let data = state.data.read().await;
        let settings = data.settings.worktrees.clone();
        let global_root = match settings.location {
            WorktreeLocationMode::Custom => settings.root.clone(),
            _ => None,
        };
        (
            settings.location,
            repo.worktree_root.clone().or(global_root),
        )
    };
    worktreeloc::resolve(&repo.path, branch, mode, root.as_deref()).await
}

/// `worktree/create`: create on disk, then hand the worktree to the window so
/// it lands exactly as one created from the dialog — listed, active, and with
/// the agent launched in it when asked. If the window cannot adopt it (no
/// window, or it did not answer), the worktree still exists and the receipt
/// says so with `adopted: false`; the next reconcile pass lists it.
pub async fn create_entry<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let project = Resolver::new(app, caller).project(sel).await?;
    let agent = params
        .get("agent")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let prompt = params
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    super::terminal::check_prompt(agent.as_deref(), prompt.as_deref())?;
    let spec = CreateSpec {
        branch: params
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        base: params
            .get("base")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        from_existing: params
            .get("fromExisting")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        path: None,
    };
    let entry = create(app, &project.repo(), spec).await.map_err(|e| {
        RpcError::new(
            uxnan_control_protocol::rpc::ErrorCode::InvalidParams,
            e.to_string(),
        )
    })?;
    let adoption = Bridge::ask(
        app,
        "worktree/adopt",
        json!({
            "projectId": project.id,
            "worktree": entry,
            "agent": agent,
            "prompt": prompt,
        }),
    )
    .await;
    let view = WorktreeView::build(app, &project, &entry, false).await;
    let mut body = json!({ "worktree": view });
    match adoption {
        Ok(v) => {
            body["adopted"] = json!(true);
            // Only a launched agent has a terminal; the window answers `null`
            // for a plain adoption and the receipt then leaves the field out.
            if let Some(t) = v.get("terminal").filter(|t| !t.is_null()) {
                body["terminal"] = t.clone();
            }
        }
        Err(e) => {
            body["adopted"] = json!(false);
            body["warning"] = json!(format!(
                "created, but the window did not adopt it ({}); it will appear on the next refresh",
                e.message
            ));
        }
    }
    Ok(receipts::receipt(receipts::key_of(params).as_deref(), body))
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
