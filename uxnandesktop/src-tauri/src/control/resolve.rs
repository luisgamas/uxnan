//! Turn a selector into the thing it names.
//!
//! `current` is anchored on the caller's own terminal: only a process the app
//! launched has one (its `UXNAN_AGENT_ID`), so from the user's shell `current`
//! is an error that says to pass an explicit selector. From the terminal the
//! chain is terminal → its workspace (the worktree folder it was opened in) →
//! the project that folder belongs to.
//!
//! Every selector is also checked against the caller's **scope**: the control
//! token (the user's own shell) reaches every project, while a per-launch token
//! reaches only the project its terminal was opened in — the token that travels
//! in agent processes is the least trusted one, so the app never lets it name a
//! worktree or a terminal of another project. Naming one is *scope denied*,
//! distinct from *not found*, so an agent learns to stop rather than retry.
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

/// What a caller may name.
#[derive(Debug, Clone)]
pub enum Scope {
    /// Every registered project — the control token.
    All,
    /// One project — a per-launch token, from the folder its terminal runs in.
    /// `folders` are the project's checkout and every worktree git lists for
    /// it, captured when the scope was computed: the linked worktrees the app
    /// creates live outside the project's folder (under the worktree root), so
    /// the folder alone would leave a coordinator blind to the worker it just
    /// started there — and that worker with no scope at all.
    Project {
        project: Box<ProjectRef>,
        folders: Vec<String>,
    },
    /// No project — a per-launch token whose terminal is not inside a
    /// registered project (the Global space), is not alive, or did not say
    /// which terminal it is (a request without the agent-id header).
    None,
}

impl Scope {
    /// Whether `project` is within the scope.
    pub fn admits_project(&self, project: &ProjectRef) -> bool {
        match self {
            Scope::All => true,
            Scope::Project { project: own, .. } => own.id == project.id,
            Scope::None => false,
        }
    }

    /// Whether a terminal whose workspace (or, failing that, working folder)
    /// is `folder` is within the scope: inside the project's checkout or one
    /// of its worktrees. A terminal with no local folder — the Global space, a
    /// host's — belongs to no project.
    pub fn admits_folder(&self, folder: Option<&str>) -> bool {
        match self {
            Scope::All => true,
            Scope::Project { folders, .. } => {
                folder.is_some_and(|f| folders.iter().any(|root| path_within(f, root)))
            }
            Scope::None => false,
        }
    }
}

/// Resolves selectors for one caller.
pub struct Resolver<'a, R: tauri::Runtime> {
    app: &'a AppHandle<R>,
    caller: &'a Caller,
    scope: tokio::sync::OnceCell<Scope>,
    /// Every project with the worktrees git lists for it, computed once per
    /// request — the one source that knows where a linked worktree lives.
    worktrees: tokio::sync::OnceCell<Vec<(ProjectRef, Vec<WorktreeEntry>)>>,
}

impl<'a, R: tauri::Runtime> Resolver<'a, R> {
    pub fn new(app: &'a AppHandle<R>, caller: &'a Caller) -> Self {
        Resolver {
            app,
            caller,
            scope: tokio::sync::OnceCell::new(),
            worktrees: tokio::sync::OnceCell::new(),
        }
    }

    /// Every registered project, whoever asks.
    async fn all_projects(&self) -> Vec<ProjectRef> {
        let state = self.app.state::<AppState>();
        let data = state.data.read().await;
        data.repos.iter().map(ProjectRef::of).collect()
    }

    /// The caller's scope, computed once per request. A launch caller's is the
    /// project containing the folder its own PTY was opened in — backend state,
    /// so it needs no window. A bridge-run agent's is the project containing
    /// its conversation's folder (the `x-uxnan-cwd` header — named by the
    /// request, as a launch caller names its terminal); a folder in no
    /// registered project reaches nothing. Only the control token reaches all.
    pub async fn scope(&self) -> &Scope {
        self.scope
            .get_or_init(|| async {
                let cwd = match self.caller {
                    Caller::Control => return Scope::All,
                    Caller::Bridge { cwd: None } | Caller::Launch { agent_id: None } => {
                        return Scope::None
                    }
                    Caller::Bridge { cwd: Some(cwd) } => cwd.clone(),
                    Caller::Launch { agent_id: Some(id) } => {
                        let state = self.app.state::<AppState>();
                        let cwd = state
                            .pty
                            .live_sessions()
                            .into_iter()
                            .find(|(pty, _)| pty == id)
                            .map(|(_, cwd)| cwd);
                        let Some(cwd) = cwd else {
                            return Scope::None;
                        };
                        cwd
                    }
                };
                match self.project_of(&cwd).await {
                    Some(project) => {
                        let folders = self.folders_of(&project).await;
                        Scope::Project {
                            project: Box::new(project),
                            folders,
                        }
                    }
                    None => Scope::None,
                }
            })
            .await
    }

    /// Every project paired with its worktrees as git lists them (the main
    /// checkout included), computed once per request.
    async fn worktrees_by_project(&self) -> &Vec<(ProjectRef, Vec<WorktreeEntry>)> {
        self.worktrees
            .get_or_init(|| async {
                let mut out = Vec::new();
                for project in self.all_projects().await {
                    let entries = super::services::worktree::list_of(self.app, &project.repo())
                        .await
                        .unwrap_or_default();
                    out.push((project, entries));
                }
                out
            })
            .await
    }

    /// The folders that are `project`: its checkout, its registered worktree
    /// location, and every worktree git lists for it.
    async fn folders_of(&self, project: &ProjectRef) -> Vec<String> {
        let mut folders = vec![project.path.clone()];
        folders.extend(project.repo().worktree_root);
        if let Some((_, entries)) = self
            .worktrees_by_project()
            .await
            .iter()
            .find(|(p, _)| p.id == project.id)
        {
            folders.extend(entries.iter().map(|e| e.path.clone()));
        }
        folders
    }

    /// The project `path` is in: by its checkout or registered worktree
    /// location first (no git needed), else by the worktrees git lists — a
    /// linked worktree under the worktree root is the app's own creation and
    /// belongs to the project it was cut from. The deepest match wins.
    async fn project_of(&self, path: &str) -> Option<ProjectRef> {
        if let Some(project) = project_containing(&self.all_projects().await, path) {
            return Some(project);
        }
        self.worktrees_by_project()
            .await
            .iter()
            .flat_map(|(project, entries)| {
                entries
                    .iter()
                    .filter(|e| path_within(path, &e.path))
                    .map(move |e| (project, path_key(&e.path).len()))
            })
            .max_by_key(|(_, depth)| *depth)
            .map(|(project, _)| project.clone())
    }

    /// The projects the caller may see.
    pub async fn projects(&self) -> Vec<ProjectRef> {
        let scope = self.scope().await;
        self.all_projects()
            .await
            .into_iter()
            .filter(|p| scope.admits_project(p))
            .collect()
    }

    /// The window's tabs the caller may see: its own, and those inside its scope.
    pub async fn tabs(&self) -> Result<Vec<TabView>, RpcError> {
        let scope = self.scope().await;
        let own = self.current_terminal_id().ok();
        Ok(super::services::terminal::tabs(self.app)
            .await?
            .into_iter()
            .filter(|t| own.as_deref() == Some(t.id.as_str()) || self.admits_tab(scope, t))
            .collect())
    }

    /// Whether the caller may name `tab`.
    fn admits_tab(&self, scope: &Scope, tab: &TabView) -> bool {
        scope.admits_folder(tab.workspace_path().or(tab.cwd.as_deref()))
    }

    /// The error a selector outside the scope gets.
    fn denied(&self, what: &str, sel: &str) -> RpcError {
        let reach = match self.caller {
            Caller::Launch {
                agent_id: Some(_),
            } => "reaches only the project its terminal runs in",
            Caller::Launch { agent_id: None } => {
                "reaches only the project of the terminal it names, and this request named none (send the agent-id header, or use uxnan-cli inside the terminal)"
            }
            Caller::Control => "is outside the caller's scope",
            Caller::Bridge { cwd: Some(_) } => {
                "reaches only the project its conversation's folder belongs to"
            }
            Caller::Bridge { cwd: None } => {
                "reaches only the project of the folder it names, and this request named none (send the x-uxnan-cwd header)"
            }
        };
        RpcError::new(
            ErrorCode::ScopeDenied,
            format!("`{sel}` names a {what} outside your scope: a launch token {reach}"),
        )
    }

    /// `project` if the caller may name it, else the scope error.
    async fn admit_project(&self, project: ProjectRef, sel: &str) -> Result<ProjectRef, RpcError> {
        if self.scope().await.admits_project(&project) {
            Ok(project)
        } else {
            Err(self.denied("project", sel))
        }
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
            Caller::Bridge { .. } => Err(RpcError::new(
                ErrorCode::InvalidParams,
                "`current` names a terminal, and an agent of a bridge conversation runs in none; use `id:`, `path:`, `branch:` or `name:`",
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
                let tab = tabs
                    .into_iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| not_found("terminal", sel))?;
                let own = self.current_terminal_id().ok();
                if own.as_deref() == Some(tab.id.as_str())
                    || self.admits_tab(self.scope().await, &tab)
                {
                    Ok(tab)
                } else {
                    Err(self.denied("terminal", sel))
                }
            }
            other => Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("a terminal is selected by `current` or `id:<terminalId>`, not `{other}`"),
            )),
        }
    }

    /// A project by selector. Resolved among every project, then checked
    /// against the scope, so a project that exists but is not the caller's is
    /// *scope denied* rather than *not found*.
    pub async fn project(&self, sel: &str) -> Result<ProjectRef, RpcError> {
        let project = self.project_anywhere(sel).await?;
        self.admit_project(project, sel).await
    }

    async fn project_anywhere(&self, sel: &str) -> Result<ProjectRef, RpcError> {
        let projects = self.all_projects().await;
        match parse(sel)? {
            Selector::Current => {
                let tab = self.current_terminal().await?;
                let folder = tab.workspace_path().or(tab.cwd.as_deref()).ok_or_else(|| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        "the current terminal is not inside a project",
                    )
                })?;
                self.project_of(folder).await.ok_or_else(|| {
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

    /// A worktree by selector, with the project it belongs to — checked against
    /// the scope like a project.
    pub async fn worktree(&self, sel: &str) -> Result<(ProjectRef, WorktreeEntry), RpcError> {
        let (project, entry) = self.worktree_anywhere(sel).await?;
        let project = self.admit_project(project, sel).await?;
        Ok((project, entry))
    }

    async fn worktree_anywhere(&self, sel: &str) -> Result<(ProjectRef, WorktreeEntry), RpcError> {
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
                for (project, entries) in self.worktrees_by_project().await {
                    for entry in entries {
                        if entry.branch.as_deref() == Some(branch.as_str()) {
                            hits.push((project.clone(), entry.clone()));
                        }
                    }
                }
                // A branch name shared across projects is ambiguous only among
                // the projects the caller may see; the others are denied anyway.
                let scope = self.scope().await;
                let visible = hits.iter().filter(|(p, _)| scope.admits_project(p)).count();
                if visible == 0 && !hits.is_empty() {
                    return Ok(hits.remove(0));
                }
                hits.retain(|(p, _)| scope.admits_project(p));
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
        let project = self.project_of(path).await?;
        let (_, entries) = self
            .worktrees_by_project()
            .await
            .iter()
            .find(|(p, _)| p.id == project.id)?;
        // The deepest worktree containing the path wins: a linked worktree under
        // the main checkout's folder is the one the path is really in.
        entries
            .iter()
            .filter(|e| path_within(path, &e.path))
            .max_by_key(|e| path_key(&e.path).len())
            .map(|e| (project, e.clone()))
    }
}

/// The project whose folder is, or contains, `path` — or whose registered
/// worktree location does. The deepest match wins. Linked worktrees elsewhere
/// are found by `Resolver::project_of`, which asks git; the persisted
/// `RepoData::worktrees` is never written and is not consulted.
fn project_containing(projects: &[ProjectRef], path: &str) -> Option<ProjectRef> {
    projects
        .iter()
        .filter(|p| {
            path_within(path, &p.path)
                || p.repo
                    .worktree_root
                    .as_deref()
                    .is_some_and(|root| path_within(path, root))
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

    fn repo(id: &str, path: &str) -> RepoData {
        RepoData {
            id: id.to_string(),
            name: id.to_string(),
            path: path.to_string(),
            target: Default::default(),
            worktrees: vec![],
            is_git: true,
            icon: None,
            branch_icons: std::collections::HashMap::new(),
            worktree_order: vec![],
            worktree_root: None,
        }
    }

    fn project(id: &str, path: &str) -> ProjectRef {
        ProjectRef::of(&repo(id, path))
    }

    #[test]
    fn a_project_scope_admits_its_linked_worktrees() {
        // The folders come from git, not the project's checkout: a worker in a
        // linked worktree under the worktree root is inside the scope, and so
        // is a terminal opened there; a sibling project's folder is not.
        let own = project("p1", "/home/me/code/app");
        let scope = Scope::Project {
            project: Box::new(own.clone()),
            folders: vec![
                "/home/me/code/app".to_string(),
                "/home/me/uxnan/worktrees/app/feat-x".to_string(),
            ],
        };
        assert!(scope.admits_folder(Some("/home/me/code/app/src")));
        assert!(scope.admits_folder(Some("/home/me/uxnan/worktrees/app/feat-x")));
        assert!(scope.admits_folder(Some("/home/me/uxnan/worktrees/app/feat-x/src")));
        assert!(!scope.admits_folder(Some("/home/me/uxnan/worktrees/app/feat-y")));
        assert!(!scope.admits_folder(Some("/home/me/code/other")));
        assert!(!scope.admits_folder(None));
        assert!(scope.admits_project(&own));
        assert!(!scope.admits_project(&project("p2", "/home/me/code/other")));
    }

    #[test]
    fn project_containing_matches_the_checkout_and_the_registered_root_only() {
        let mut with_root = repo("p1", "/home/me/code/app");
        with_root.worktree_root = Some("/home/me/wt/app".into());
        let projects = vec![
            ProjectRef::of(&with_root),
            project("p2", "/home/me/code/app/vendor"),
        ];
        // Deepest wins.
        assert_eq!(
            project_containing(&projects, "/home/me/code/app/vendor/x").map(|p| p.id),
            Some("p2".into())
        );
        assert_eq!(
            project_containing(&projects, "/home/me/wt/app/feat").map(|p| p.id),
            Some("p1".into())
        );
        // A linked worktree elsewhere is git's to answer (`project_of`).
        assert!(project_containing(&projects, "/home/me/uxnan/worktrees/app/feat").is_none());
    }
}
