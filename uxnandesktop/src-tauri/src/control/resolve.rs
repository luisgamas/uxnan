//! Turn a selector into the thing it names.
//!
//! `current` is anchored on the caller's own terminal: only a process the app
//! launched has one (its `UXNAN_AGENT_ID`), so from the user's shell `current`
//! is an error that says to pass an explicit selector. From the terminal the
//! chain is terminal → its workspace (the worktree folder it was opened in) →
//! the project that folder belongs to.
//!
//! Paths are compared after normalizing separators and a trailing slash, and
//! case-insensitively on Windows, the way the sidebar keys them.

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};
use uxnan_control_protocol::selector::Selector;

use super::services::terminal::TabView;
use super::Caller;
use crate::git::WorktreeEntry;
use crate::model::RepoData;
use crate::state::AppState;

/// A project as every view names it. Slim on purpose: the icon and the
/// per-branch icons the sidebar keeps are not something a caller needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub path: String,
    /// `local` or `ssh:<hostId>`.
    pub target: String,
    pub is_git: bool,
    #[serde(skip)]
    repo: RepoData,
}

impl ProjectRef {
    pub fn of(repo: &RepoData) -> Self {
        ProjectRef {
            id: repo.id.clone(),
            name: repo.name.clone(),
            path: repo.path.clone(),
            target: repo.target.to_string(),
            is_git: repo.is_git,
            repo: repo.clone(),
        }
    }

    /// The full record, for services that need what the view leaves out.
    pub fn repo(&self) -> RepoData {
        self.repo.clone()
    }
}

/// Normalize a path for comparison: forward slashes, no trailing slash, and
/// case-folded on Windows (where the filesystem is).
pub fn path_key(path: &str) -> String {
    let p = path.replace('\\', "/");
    let p = p.trim_end_matches('/');
    if cfg!(windows) {
        p.to_lowercase()
    } else {
        p.to_string()
    }
}

/// Whether `path` is `root` or lies under it.
pub fn path_within(path: &str, root: &str) -> bool {
    let p = path_key(path);
    let r = path_key(root);
    p == r || p.starts_with(&format!("{r}/"))
}

fn parse(sel: &str) -> Result<Selector, RpcError> {
    Selector::parse(sel).map_err(|e| RpcError::new(ErrorCode::InvalidParams, e.to_string()))
}

fn not_found(what: &str, sel: &str) -> RpcError {
    RpcError::new(ErrorCode::NotFound, format!("no {what} matches `{sel}`"))
}

/// Resolves selectors for one caller.
pub struct Resolver<'a, R: tauri::Runtime> {
    app: &'a AppHandle<R>,
    caller: &'a Caller,
}

impl<'a, R: tauri::Runtime> Resolver<'a, R> {
    pub fn new(app: &'a AppHandle<R>, caller: &'a Caller) -> Self {
        Resolver { app, caller }
    }

    /// Every registered project.
    pub async fn projects(&self) -> Vec<ProjectRef> {
        let state = self.app.state::<AppState>();
        let data = state.data.read().await;
        data.repos.iter().map(ProjectRef::of).collect()
    }

    /// The caller's own terminal id, or the error that explains why there is
    /// none.
    fn current_terminal_id(&self) -> Result<String, RpcError> {
        match self.caller {
            Caller::Launch {
                agent_id: Some(id),
            } => Ok(id.clone()),
            Caller::Launch { agent_id: None } => Err(RpcError::new(
                ErrorCode::InvalidParams,
                "`current` needs the caller's terminal: pass your UXNAN_AGENT_ID (the CLI does this by itself inside a Uxnan terminal) or use an explicit selector",
            )),
            Caller::Control => Err(RpcError::new(
                ErrorCode::InvalidParams,
                "`current` only works from inside a Uxnan terminal; use `id:`, `path:`, `branch:` or `name:`",
            )),
        }
    }

    /// The caller's own terminal tab.
    pub async fn current_terminal(&self) -> Result<TabView, RpcError> {
        let id = self.current_terminal_id()?;
        let tabs = super::services::terminal::tabs(self.app).await?;
        tabs.into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| not_found("terminal", "current"))
    }

    /// A terminal by selector.
    pub async fn terminal(&self, sel: &str) -> Result<TabView, RpcError> {
        match parse(sel)? {
            Selector::Current => self.current_terminal().await,
            Selector::Id(id) => {
                let tabs = super::services::terminal::tabs(self.app).await?;
                tabs.into_iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| not_found("terminal", sel))
            }
            other => Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("a terminal is selected by `current` or `id:<terminalId>`, not `{other}`"),
            )),
        }
    }

    /// A project by selector.
    pub async fn project(&self, sel: &str) -> Result<ProjectRef, RpcError> {
        let projects = self.projects().await;
        match parse(sel)? {
            Selector::Current => {
                let tab = self.current_terminal().await?;
                let folder = tab.workspace_path().or(tab.cwd.as_deref()).ok_or_else(|| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        "the current terminal is not inside a project",
                    )
                })?;
                project_containing(&projects, folder).ok_or_else(|| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        format!("the current terminal's folder {folder} is not inside a registered project"),
                    )
                })
            }
            Selector::Id(id) => projects
                .into_iter()
                .find(|p| p.id == id)
                .ok_or_else(|| not_found("project", sel)),
            Selector::Path(path) => {
                let key = path_key(&path);
                projects
                    .into_iter()
                    .find(|p| path_key(&p.path) == key)
                    .ok_or_else(|| not_found("project", sel))
            }
            Selector::Name(name) => {
                let lower = name.to_lowercase();
                let mut hits: Vec<ProjectRef> = projects
                    .into_iter()
                    .filter(|p| p.name.to_lowercase() == lower)
                    .collect();
                match hits.len() {
                    0 => Err(not_found("project", sel)),
                    1 => Ok(hits.remove(0)),
                    _ => Err(RpcError::new(
                        ErrorCode::InvalidParams,
                        format!("`{sel}` names {} projects; use `id:` or `path:`", hits.len()),
                    )
                    .with_data(json!({ "candidates": hits.iter().map(|p| json!({ "id": p.id, "path": p.path })).collect::<Vec<_>>() }))),
                }
            }
            Selector::Branch(_) => Err(RpcError::new(
                ErrorCode::InvalidParams,
                "a project is selected by `current`, `id:`, `path:` or `name:`, not `branch:`",
            )),
        }
    }

    /// A worktree by selector, with the project it belongs to.
    pub async fn worktree(&self, sel: &str) -> Result<(ProjectRef, WorktreeEntry), RpcError> {
        match parse(sel)? {
            Selector::Current => {
                let tab = self.current_terminal().await?;
                let folder = tab.workspace_path().or(tab.cwd.as_deref()).ok_or_else(|| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        "the current terminal is not inside a worktree",
                    )
                })?;
                self.worktree_at(folder).await.ok_or_else(|| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        format!(
                            "the current terminal's folder {folder} is not a registered worktree"
                        ),
                    )
                })
            }
            Selector::Path(path) => self
                .worktree_at(&path)
                .await
                .ok_or_else(|| not_found("worktree", sel)),
            Selector::Branch(branch) => {
                let mut hits = Vec::new();
                for project in self.projects().await {
                    for entry in super::services::worktree::list_of(self.app, &project.repo())
                        .await
                        .unwrap_or_default()
                    {
                        if entry.branch.as_deref() == Some(branch.as_str()) {
                            hits.push((project.clone(), entry));
                        }
                    }
                }
                match hits.len() {
                    0 => Err(not_found("worktree", sel)),
                    1 => Ok(hits.remove(0)),
                    _ => Err(RpcError::new(
                        ErrorCode::InvalidParams,
                        format!("`{sel}` names {} worktrees; use `path:`", hits.len()),
                    )
                    .with_data(json!({ "candidates": hits.iter().map(|(p, w)| json!({ "project": p.name, "path": w.path })).collect::<Vec<_>>() }))),
                }
            }
            other => Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("a worktree is selected by `current`, `path:` or `branch:`, not `{other}`"),
            )),
        }
    }

    /// The worktree whose folder is `path`, or whose folder contains it.
    async fn worktree_at(&self, path: &str) -> Option<(ProjectRef, WorktreeEntry)> {
        let projects = self.projects().await;
        let project = project_containing(&projects, path)?;
        let entries = super::services::worktree::list_of(self.app, &project.repo())
            .await
            .ok()?;
        // The deepest worktree containing the path wins: a linked worktree under
        // the main checkout's folder is the one the path is really in.
        entries
            .into_iter()
            .filter(|e| path_within(path, &e.path))
            .max_by_key(|e| path_key(&e.path).len())
            .map(|e| (project, e))
    }
}

/// The project whose folder is, or contains, `path` — or whose registered
/// worktree location does. The deepest match wins.
fn project_containing(projects: &[ProjectRef], path: &str) -> Option<ProjectRef> {
    projects
        .iter()
        .filter(|p| {
            path_within(path, &p.path)
                || p.repo
                    .worktree_root
                    .as_deref()
                    .is_some_and(|root| path_within(path, root))
                || p.repo.worktrees.iter().any(|w| path_within(path, &w.path))
        })
        .max_by_key(|p| path_key(&p.path).len())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_keys_ignore_separators_and_trailing_slashes() {
        assert_eq!(path_key("/a/b/"), "/a/b");
        assert_eq!(
            path_key("C:\\x\\y"),
            if cfg!(windows) { "c:/x/y" } else { "C:/x/y" }
        );
        assert!(path_within("/a/b/c", "/a/b"));
        assert!(path_within("/a/b", "/a/b/"));
        assert!(!path_within("/a/bc", "/a/b"));
    }
}
