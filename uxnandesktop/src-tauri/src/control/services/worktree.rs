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
/// A project on a host is asked of that host's engine, which lists its
/// worktrees with the same git there. A host that is not connected (or where
/// the engine cannot run) answers its own folder with **no branch** — the row
/// says the branch was not read, never a branch this machine made up. A local
/// plain folder lists its own folder with no branch. A local repository asks
/// git.
pub async fn list_of<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo: &RepoData,
) -> Result<Vec<WorktreeEntry>, RpcError> {
    let state = app.state::<AppState>();
    if let Some(host_id) = repo.target.ssh_host_id() {
        if repo.is_git {
            if let Some(engine) = crate::commands::connected_engine(app, &state, host_id).await {
                if let Ok(list) = engine
                    .git::<Vec<WorktreeEntry>>(uxnan_host_protocol::GitCall::Worktrees {
                        path: repo.path.clone(),
                    })
                    .await
                {
                    if !list.is_empty() {
                        return Ok(list);
                    }
                }
            }
        }
        return Ok(worktrees_without_git(&repo.target, &repo.path).unwrap_or_default());
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

/// The worktree list for a host project its engine could not answer for (not
/// connected, no engine there): one entry, the project's own folder, and **no
/// branch**. `None` means "local — go ask git".
///
/// Split out so the decision is testable on its own, because the invariant is
/// easy to break and expensive when broken: this machine's git must never
/// answer for a project on a host, or the sidebar would put this machine's
/// branch on another machine's repository.
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

/// The badge summary of a worktree (changed entries, ahead/behind), read on
/// the machine it is on. A folder that is not a repository, or a host that
/// cannot be asked right now, has none.
pub async fn status_of<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo: &RepoData,
    path: &str,
) -> Option<WorktreeStatus> {
    if !repo.is_git {
        return None;
    }
    if let Some(host_id) = repo.target.ssh_host_id() {
        let state = app.state::<AppState>();
        let engine = crate::commands::connected_engine(app, &state, host_id).await?;
        let status: git::RepoStatus = engine
            .git(uxnan_host_protocol::GitCall::Status {
                path: path.to_string(),
            })
            .await
            .ok()?;
        return status.is_repo.then_some(status.status);
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
            status_of(app, &repo, &entry.path).await
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

/// What a new worktree is made of — the engine's, shared with a host's.
pub use crate::worktreeloc::CreateSpec;

/// Create a worktree of a project, on the machine it is on. The window's
/// `worktree_create` command and the `worktree/create` entry both end here, and
/// both machines run the same `worktreeloc::create`: in process for a project
/// here, by its engine for one on a host.
pub async fn create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo: &RepoData,
    spec: CreateSpec,
) -> Result<WorktreeEntry, AppError> {
    if spec.branch.trim().is_empty() {
        return Err(AppError::Invalid("branch name is required".to_string()));
    }
    if !repo.is_git {
        return Err(AppError::Invalid(format!(
            "{} is a plain folder, not a git repository",
            repo.path
        )));
    }
    let state = app.state::<AppState>();
    let (mode, root) = location_policy(&state, repo).await;
    if let Some(host_id) = repo.target.ssh_host_id() {
        let engine = crate::commands::connected_engine(app, &state, host_id)
            .await
            .ok_or_else(|| AppError::NotConnected(host_id.to_string()))?;
        return engine
            .git(uxnan_host_protocol::GitCall::AddWorktree {
                path: repo.path.clone(),
                spec: serde_json::to_value(spec)?,
                mode: serde_json::to_value(mode)?,
                root,
            })
            .await;
    }
    Ok(worktreeloc::create(&repo.path, spec, mode, root.as_deref()).await?)
}

/// The layout a new worktree of `repo` uses, and the root it goes under: the
/// project's own root when it has one, else the global custom root. On a host
/// the global root is a folder on **this** machine, so only the project's own
/// (a path on that host) applies there; the managed root is then that host's.
pub(crate) async fn location_policy(
    state: &AppState,
    repo: &RepoData,
) -> (WorktreeLocationMode, Option<String>) {
    let data = state.data.read().await;
    let settings = data.settings.worktrees.clone();
    let global_root = match settings.location {
        WorktreeLocationMode::Custom if repo.target.is_local() => settings.root.clone(),
        _ => None,
    };
    (
        settings.location,
        repo.worktree_root.clone().or(global_root),
    )
}

/// Where the policy puts a new worktree of a **local** `repo` for `branch`
/// (`worktreeloc`). Shared with the commands that create a worktree for a
/// GitHub pull request or issue, which only exist for projects here.
pub async fn resolve_location(
    state: &AppState,
    repo: &RepoData,
    branch: &str,
) -> Result<worktreeloc::Resolved, AppError> {
    let (mode, root) = location_policy(state, repo).await;
    Ok(worktreeloc::resolve(&repo.path, branch, mode, root.as_deref()).await?)
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
    // With an agent, the launch budget is asked before anything exists on
    // disk: a refused launch must not leave a worktree behind.
    if agent.is_some() {
        let admitted = Bridge::ask(app, "launch/admit", json!({})).await?;
        if let Some(refusal) = crate::control::bridge::refused(&admitted) {
            return Err(refusal);
        }
    }
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
            "unattended": params.get("unattended"),
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
            if let Some(mode) = v.get("unattended") {
                body["unattended"] = mode.clone();
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
