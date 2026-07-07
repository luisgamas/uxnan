//! Tauri commands — the request/response surface exposed to the Svelte frontend.
//!
//! Phase 0 ships the minimal set needed to validate the round-trip and persist
//! UI settings. Repo/worktree/PTY/git commands arrive in later phases (see
//! `FOR-DEV.md` and the full planned list in
//! `architecture/03-implementation-guide.md` §2.1).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::agent_hooks::{self, AgentHooksStatus, HookInstall};
use crate::error::{AppError, CommandError};
use crate::git::{self, WorktreeEntry};
use crate::model::{AgentStateEntry, AppData, AppSettings, RepoData};
use crate::state::{AppState, HookServerInfo};

/// Return the full persisted application state. The frontend calls this once at
/// boot to hydrate its reactive store; it also doubles as the Phase 0
/// command round-trip validation.
#[tauri::command]
pub async fn get_app_state(state: State<'_, AppState>) -> Result<AppData, CommandError> {
    let data = state.data.read().await;
    Ok(data.clone())
}

/// Persist updated UI/app settings (sidebar widths + open state, theme) and
/// return the new full state so the frontend can stay in sync.
#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppData, CommandError> {
    let mut data = state.data.write().await;
    data.settings = settings;
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(data.clone())
}

/// Lightweight liveness probe. Used by the frontend at startup to confirm the
/// Rust backend is reachable before issuing real commands.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

/// Persist the frontend-owned terminal region/tab layout (opaque JSON). The
/// frontend debounces these writes; restored on next startup via `get_app_state`.
#[tauri::command]
pub async fn set_terminal_layout(
    state: State<'_, AppState>,
    layout: serde_json::Value,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.terminal_layout = Some(layout);
    state.persistence.save(&data).map_err(CommandError::from)
}

// --- Terminals (PTY) -------------------------------------------------------
//
// The frontend chooses `id` (so it can subscribe to `pty:output:{id}` before
// the process produces any output), then calls `pty_create`. Output streams via
// `pty:output:{id}` events; `pty:exit:{id}` fires once the process ends.

/// Spawn a shell in a new pseudoterminal sized `cols`×`rows`. Returns `true`
/// when a fresh session was spawned, `false` when one already existed for `id`
/// (a remount onto a live PTY — the frontend then replays `pty_snapshot`).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command surface: flat params over the IPC boundary.
pub async fn pty_create(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    // Extra environment variables for the spawned shell, as `[key, value]` pairs
    // (e.g. an agent's configured env). Applied *before* the ADE's own `UXNAN_*`
    // hook vars so those always win on a key clash.
    env: Option<Vec<(String, String)>>,
    cols: u16,
    rows: u16,
) -> Result<bool, CommandError> {
    let out_app = app.clone();
    let out_id = id.clone();
    let on_output = move |bytes: &[u8]| {
        let _ = out_app.emit(&format!("pty:output:{out_id}"), bytes.to_vec());
    };
    let exit_app = app.clone();
    let exit_id = id.clone();
    let on_exit = move || {
        let _ = exit_app.emit(&format!("pty:exit:{exit_id}"), ());
    };

    // User/agent-supplied env first (e.g. an agent's configured vars), then the
    // hook-server coordinates + this terminal's agent id so an agent run inside
    // the shell can report precise state back. The `UXNAN_*` keys are pushed last
    // and thus win over any user key of the same name (later sets override).
    let mut env: Vec<(String, String)> = env.unwrap_or_default();
    env.retain(|(k, _)| !k.trim().is_empty());
    // Preserve any WSLENV the user set so we can extend (not replace) it below.
    let user_wslenv = env
        .iter()
        .rev()
        .find(|(k, _)| k.eq_ignore_ascii_case("WSLENV"))
        .map(|(_, v)| v.clone());
    env.push(("UXNAN_AGENT_ID".to_string(), id.clone()));
    let hook = state.hook.read().await.clone();
    if let Some(h) = &hook {
        env.push(("UXNAN_HOOK_URL".to_string(), h.url.clone()));
        env.push(("UXNAN_HOOK_TOKEN".to_string(), h.token.clone()));
        // Restart survival: point hook scripts at the endpoint file so they can
        // re-read live coordinates if this terminal outlives an app restart.
        if let Some(ep) = &h.endpoint_file {
            env.push(("UXNAN_ENDPOINT_FILE".to_string(), ep.clone()));
        }
    }
    // WSL (basic support): the hook vars don't cross the Windows→Linux boundary
    // unless listed in `WSLENV`. Adding them here means an agent run inside a WSL
    // shell still sees the coordinates (`/p` path-translates the endpoint file to
    // its `/mnt/c/...` form). Harmless on non-WSL shells (only `wsl.exe` reads it).
    // Note: WSL2's `127.0.0.1` still points at the WSL VM, not the Windows host,
    // so reaching the server from WSL2 remains a documented limitation.
    #[cfg(windows)]
    {
        let mut parts: Vec<String> = Vec::new();
        if let Some(prev) = user_wslenv.filter(|s| !s.trim().is_empty()) {
            parts.push(prev);
        }
        parts.push("UXNAN_HOOK_URL".to_string());
        parts.push("UXNAN_HOOK_TOKEN".to_string());
        parts.push("UXNAN_AGENT_ID".to_string());
        if hook
            .as_ref()
            .and_then(|h| h.endpoint_file.as_ref())
            .is_some()
        {
            parts.push("UXNAN_ENDPOINT_FILE/p".to_string());
        }
        env.push(("WSLENV".to_string(), parts.join(":")));
    }
    #[cfg(not(windows))]
    let _ = user_wslenv;

    // Integrated browser: when enabled and agents are allowed, let an agent open a
    // URL in the in-app browser by POSTing it to the hook server's `/browser` route
    // (`UXNAN_BROWSER_URL` + `_TOKEN`), and point `$BROWSER` at the bundled shim so
    // tools that honor it (logins/previews) land in-app too. Honors the user's
    // link policy on arrival (see `browser::route_url`).
    let (browser_enabled, allow_agents, mcp_enabled) = {
        let data = state.data.read().await;
        (
            data.settings.browser.enabled,
            data.settings.browser.allow_agents,
            data.settings.browser.mcp_enabled,
        )
    };
    if browser_enabled && allow_agents {
        if let Some(h) = &hook {
            env.push((
                "UXNAN_BROWSER_URL".to_string(),
                h.url.replacen("/hook", "/browser", 1),
            ));
            env.push(("UXNAN_BROWSER_TOKEN".to_string(), h.token.clone()));
        }
        if let Some(install) = state.hook_install.read().await.clone() {
            let shim = if cfg!(windows) {
                install.browser_shim_cmd
            } else {
                install.browser_shim_bash
            };
            env.push(("BROWSER".to_string(), shim));
        }
    }

    // Browser-control MCP (spec `02d` §1.6): expose the `/mcp` endpoint + token so
    // the agent's injected MCP config (see `mcpinject.rs`) can reach it. The config
    // reads the token from `UXNAN_MCP_TOKEN` (never written to a file). Then write
    // that config for the terminal's cwd, per the user's injection mode.
    if mcp_enabled {
        if let Some(h) = &hook {
            env.push((
                "UXNAN_MCP_URL".to_string(),
                crate::mcpinject::mcp_endpoint(&h.url),
            ));
            env.push((crate::mcpinject::TOKEN_ENV.to_string(), h.token.clone()));
        }
        crate::mcpinject::prepare(&app, cwd.as_deref().unwrap_or_default()).await;
    }

    state
        .pty
        .create(
            crate::pty::PtySpec {
                id,
                cwd,
                shell,
                args: args.unwrap_or_default(),
                env,
                cols,
                rows,
            },
            on_output,
            on_exit,
        )
        .map_err(CommandError::from)
}

/// Runtime info for the Settings → Browser MCP panel: the live `/mcp` endpoint +
/// token (for the copy-paste config snippet) and the catalog of agents the ADE can
/// auto-configure. `endpoint`/`token` are `None` until the hook server is listening.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    pub endpoint: Option<String>,
    pub token: Option<String>,
    pub token_env: String,
    pub server_name: String,
    pub agents: Vec<crate::mcpinject::AgentInfo>,
}

/// Return the browser MCP server coordinates + supported-agent catalog for the
/// Settings panel. The token is the app's own local loopback secret, surfaced only
/// so the user can copy a ready-to-paste config for an agent the ADE doesn't
/// auto-configure yet.
#[tauri::command]
pub async fn mcp_info(state: State<'_, AppState>) -> Result<McpInfo, CommandError> {
    let hook = state.hook.read().await.clone();
    let (endpoint, token) = match hook {
        Some(h) => (Some(crate::mcpinject::mcp_endpoint(&h.url)), Some(h.token)),
        None => (None, None),
    };
    Ok(McpInfo {
        endpoint,
        token,
        token_env: crate::mcpinject::TOKEN_ENV.to_string(),
        server_name: crate::mcpinject::SERVER_NAME.to_string(),
        agents: crate::mcpinject::agent_infos(),
    })
}

/// Send user input to a PTY's stdin.
#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), CommandError> {
    state.pty.write(&id, &data).map_err(CommandError::from)
}

/// Return the subset of `commands` that resolve to an installed executable
/// (PATH + PATHEXT). Used by the Settings agent catalog to enable only the
/// agents actually present on the machine.
#[tauri::command]
pub async fn agents_detect(commands: Vec<String>) -> Result<Vec<String>, CommandError> {
    Ok(commands
        .into_iter()
        .filter(|c| crate::which::is_command_available(c))
        .collect())
}

/// Read usage statistics (quota windows / credit / local token tally) for the
/// activated providers only. Never fails as a whole — each provider reports its
/// own status, so a slow/broken one doesn't sink the rest.
#[tauri::command]
pub async fn usage_read(
    providers: Vec<crate::usage::UsageProvider>,
) -> Result<Vec<crate::usage::ProviderUsage>, CommandError> {
    Ok(crate::usage::read_usage(providers).await)
}

/// The subset of `providers` whose CLI / config is present on this machine, so
/// the Providers catalog can enable only the available ones (mirrors
/// `agents_detect`).
#[tauri::command]
pub async fn usage_detect(
    providers: Vec<crate::usage::UsageProvider>,
) -> Result<Vec<crate::usage::UsageProvider>, CommandError> {
    Ok(crate::usage::detect_present(&providers))
}

/// Resize a PTY when its pane changes size.
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    state
        .pty
        .resize(&id, cols, rows)
        .map_err(CommandError::from)
}

/// Kill a PTY's process and drop the session (idempotent).
#[tauri::command]
pub async fn pty_close(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.pty.close(&id).map_err(CommandError::from)
}

/// A PTY's retained recent output, for repainting a recreated xterm.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySnapshot {
    /// Raw bytes (same wire shape as a `pty:output:{id}` payload).
    data: Vec<u8>,
    /// True when older history was dropped to stay within the buffer cap.
    stale: bool,
}

/// Return a PTY's buffered recent output so a remounted pane can restore its
/// scrollback without a live PTY. Unknown ids yield an empty, non-stale
/// snapshot (the caller simply has nothing to replay).
#[tauri::command]
pub async fn pty_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<PtySnapshot, CommandError> {
    let (data, stale) = state.pty.snapshot(&id).unwrap_or_default();
    Ok(PtySnapshot { data, stale })
}

// --- Repositories ----------------------------------------------------------

/// Register a project folder (by absolute path) with the ADE. Any directory may
/// be added — git or not; a non-git folder simply has no worktrees/branches and
/// its git-only panels stay empty (see `git::list_worktrees`). Idempotent: a
/// path already registered returns the existing entry.
#[tauri::command]
pub async fn repo_add(state: State<'_, AppState>, path: String) -> Result<RepoData, CommandError> {
    if !std::path::Path::new(&path).is_dir() {
        return Err(CommandError::from(AppError::Invalid(format!(
            "{path} is not a folder"
        ))));
    }
    let is_git = git::is_git_repo(&path).await;
    let mut data = state.data.write().await;
    if let Some(existing) = data.repos.iter().find(|r| r.path == path) {
        return Ok(existing.clone());
    }
    let repo = RepoData {
        id: Uuid::new_v4().to_string(),
        name: git::repo_name(&path),
        path,
        worktrees: Vec::new(),
        is_git,
        icon: None,
        branch_icons: std::collections::HashMap::new(),
    };
    data.repos.push(repo.clone());
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(repo)
}

/// Update a project's display metadata: its card `name` and/or its `icon`. The
/// project's real folder is never touched — `name` is display-only, so renaming
/// only relabels the card. Both params follow the same convention: a missing arg
/// (`None`) leaves that field unchanged; a present value sets it, where an empty
/// string *resets* (name → the folder name, icon → the default glyph). Returns
/// the updated repo so the frontend can reconcile.
#[tauri::command]
pub async fn repo_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
) -> Result<RepoData, CommandError> {
    let mut data = state.data.write().await;
    let repo = data
        .repos
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {id}"))))?;
    if let Some(name) = name {
        let trimmed = name.trim();
        // An empty rename resets the label back to the real folder name.
        repo.name = if trimmed.is_empty() {
            git::repo_name(&repo.path)
        } else {
            trimmed.to_string()
        };
    }
    if let Some(icon) = icon {
        // An empty icon clears it back to the default glyph.
        repo.icon = Some(icon).filter(|s| !s.is_empty());
    }
    let updated = repo.clone();
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(updated)
}

/// Set (or clear) a per-branch custom icon for a project. Keyed by branch name
/// (or the worktree path when detached). Passing `None`/empty removes it. Returns
/// the updated repo.
#[tauri::command]
pub async fn repo_set_branch_icon(
    state: State<'_, AppState>,
    id: String,
    branch: String,
    icon: Option<String>,
) -> Result<RepoData, CommandError> {
    let mut data = state.data.write().await;
    let repo = data
        .repos
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {id}"))))?;
    match icon.filter(|s| !s.is_empty()) {
        Some(icon) => {
            repo.branch_icons.insert(branch, icon);
        }
        None => {
            repo.branch_icons.remove(&branch);
        }
    }
    let updated = repo.clone();
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(updated)
}

/// Resolve a git project's `origin` remote to its hosting owner/org so the UI can
/// offer the account avatar (e.g. `https://github.com/<owner>.png`). Returns
/// `None` when there's no parseable `origin` (non-git folder, no remote, or an
/// unrecognized host).
#[tauri::command]
pub async fn repo_remote_owner(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<git::RemoteOwner>, CommandError> {
    let repo_path = repo_path_of(&state, &id).await?;
    Ok(git::remote_owner(&repo_path).await)
}

/// Remove a repository from the ADE (does not touch the repo on disk).
#[tauri::command]
pub async fn repo_remove(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.repos.retain(|r| r.id != id);
    state.persistence.save(&data).map_err(CommandError::from)
}

/// List the registered repositories.
#[tauri::command]
pub async fn repo_list(state: State<'_, AppState>) -> Result<Vec<RepoData>, CommandError> {
    Ok(state.data.read().await.repos.clone())
}

// --- Worktrees -------------------------------------------------------------

/// Resolve a registered repo's absolute path by id (read lock released before
/// any git `await`, so we never hold the lock across a subprocess).
async fn repo_path_of(state: &AppState, repo_id: &str) -> Result<String, CommandError> {
    state
        .data
        .read()
        .await
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .map(|r| r.path.clone())
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))
}

/// A repo's branches plus the resolved default base, for the new-worktree dialog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    /// Local branch names.
    pub branches: Vec<String>,
    /// The base ref the dialog should preselect (remote HEAD → main → master → HEAD).
    pub default_base: String,
}

/// List a repo's local branches and the resolved default base ref. Powers the
/// base-branch picker when creating a worktree.
#[tauri::command]
pub async fn branch_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<BranchList, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let branches = git::list_branches(&repo_path)
        .await
        .map_err(CommandError::from)?;
    let default_base = git::default_base(&repo_path).await;
    Ok(BranchList {
        branches,
        default_base,
    })
}

/// Create a worktree on a new branch in the given repo, at a sibling directory
/// named `<repo>--<branch>`. `base` is the ref to branch from; when omitted the
/// backend resolves the repo's default base (remote HEAD → main → master → HEAD).
/// Returns the created entry.
#[tauri::command]
pub async fn worktree_create(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: Option<String>,
) -> Result<WorktreeEntry, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "branch name is required".to_string(),
        )));
    }
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let base = match base.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()) {
        Some(base) => base,
        None => git::default_base(&repo_path).await,
    };
    let worktree_path = git::worktree_path_for(&repo_path, &branch);
    git::add_worktree(&repo_path, &branch, &worktree_path, Some(&base))
        .await
        .map_err(CommandError::from)?;
    Ok(WorktreeEntry {
        path: worktree_path,
        branch: Some(branch),
        head: None,
        is_main: false,
    })
}

/// Remove a worktree (spec §2.3). With `force = false` the backend refuses when
/// the worktree has uncommitted changes; the frontend surfaces this so the user
/// can confirm a forced removal. Afterwards the branch is cleaned up: a safe
/// delete for merged work, a force-delete for a confirmed squash merge, or kept
/// otherwise. The returned [`git::RemoveOutcome`] tells the UI which happened.
#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: Option<String>,
    force: bool,
) -> Result<git::RemoveOutcome, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::remove_worktree(&repo_path, &path, branch.as_deref(), force)
        .await
        .map_err(CommandError::from)
}

/// List a repo's worktrees (ADE-created and ones made externally by agents).
#[tauri::command]
pub async fn worktree_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<WorktreeEntry>, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::list_worktrees(&repo_path)
        .await
        .map_err(CommandError::from)
}

/// Summarize a worktree's working-tree status (changed entries + ahead/behind)
/// for its sidebar card badges. Runs git directly in `path`.
#[tauri::command]
pub async fn worktree_status(path: String) -> Result<git::WorktreeStatus, CommandError> {
    if !git::is_git_repo(&path).await {
        return Ok(git::WorktreeStatus::default());
    }
    git::worktree_status(&path)
        .await
        .map_err(CommandError::from)
}

/// List a directory's sub-folders (flagging git repos) for the in-app project
/// picker. Defaults to the home directory when `path` is omitted.
#[tauri::command]
pub async fn browse_dirs(path: Option<String>) -> Result<crate::browse::DirListing, CommandError> {
    crate::browse::browse_dirs(path)
        .await
        .map_err(CommandError::from)
}

// --- Filesystem: file tree + editor ----------------------------------------
//
// Back the right-panel file-tree tab (browse the active worktree's working tree)
// and the center file editor (read/write one text file). Paths are absolute, on
// the user's own machine (not confined — mirrors `browse_dirs`).

/// List the immediate children of a directory (sub-dirs first, then files),
/// for the file-tree tab. Lazy: the frontend calls this per folder on expand,
/// so a huge tree (e.g. `node_modules`) never loads until opened.
#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<crate::fs::FsEntry>, CommandError> {
    crate::fs::list_dir(&path).await.map_err(CommandError::from)
}

/// Read a single text file for the editor (with binary / too-large guards).
#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<crate::fs::FileContent, CommandError> {
    crate::fs::read_file(&path)
        .await
        .map_err(CommandError::from)
}

/// Overwrite a file with the editor's content (atomic temp-write + rename).
#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), CommandError> {
    crate::fs::write_file(&path, &content)
        .await
        .map_err(CommandError::from)
}

/// Rename a file on disk to a new bare file name, keeping it in the same folder
/// (the real rename behind a file tab's "Rename"). Guards against path
/// separators, traversal and clobbering (see [`crate::fs::rename_path`]). Returns
/// the new absolute, forward-slash path so the frontend can re-point the tab.
#[tauri::command]
pub async fn fs_rename(path: String, new_name: String) -> Result<String, CommandError> {
    crate::fs::rename_path(&path, &new_name)
        .await
        .map_err(CommandError::from)
}

/// Largest remote image the icon fetcher will inline (5 MiB). Icons are tiny;
/// this only guards against a hostile/oversized URL streaming forever.
const MAX_ICON_BYTES: u64 = 5 * 1024 * 1024;

/// Download an image from an `http(s)` URL and return it as an inline
/// `data:<mime>;base64,…` URL. Fetching in Rust (not the webview) sidesteps CORS
/// and canvas-taint, so a project/branch icon picked "from URL" or a git-host
/// avatar can be embedded and persisted offline. Rejects non-`http(s)` schemes,
/// non-image content, and anything over [`MAX_ICON_BYTES`].
#[tauri::command]
pub async fn image_fetch_data_url(url: String) -> Result<String, CommandError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(CommandError::new(
            "IMAGE_FETCH_FAILED",
            "only http(s) image URLs are supported",
        ));
    }
    let client = reqwest::Client::builder()
        .user_agent("uxnan-desktop")
        .build()
        .map_err(|e| CommandError::new("IMAGE_FETCH_FAILED", e.to_string()))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| CommandError::new("IMAGE_FETCH_FAILED", e.to_string()))?;

    // Content-Length (when present) short-circuits an oversized download.
    if let Some(len) = resp.content_length() {
        if len > MAX_ICON_BYTES {
            return Err(CommandError::new(
                "IMAGE_FETCH_FAILED",
                "the image is too large",
            ));
        }
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .filter(|m| m.starts_with("image/"));

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| CommandError::new("IMAGE_FETCH_FAILED", e.to_string()))?;
    if bytes.len() as u64 > MAX_ICON_BYTES {
        return Err(CommandError::new(
            "IMAGE_FETCH_FAILED",
            "the image is too large",
        ));
    }
    // Prefer the server's content-type; else sniff from magic bytes. Refuse
    // anything that isn't a recognizable image so we never inline HTML/JSON.
    let mime = mime
        .or_else(|| sniff_image_mime(&bytes).map(str::to_string))
        .ok_or_else(|| CommandError::new("IMAGE_FETCH_FAILED", "the URL is not an image"))?;

    Ok(format!("data:{mime};base64,{}", BASE64.encode(&bytes)))
}

/// Best-effort image type detection from the leading magic bytes, for responses
/// that omit a usable `Content-Type`.
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// Set (or clear with `None`) the worktree root the filesystem watcher follows.
/// The frontend calls this when the active worktree changes; the backend emits
/// `fs:changed` (debounced) as files under it are created/deleted/edited so the
/// file tree + open editor stay current without a manual refresh.
#[tauri::command]
pub async fn fs_set_watch(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), CommandError> {
    state
        .fs_watcher
        .set(&app, path)
        .await
        .map_err(|e| CommandError::new("FS_WATCH_FAILED", e.to_string()))
}

/// Reveal a path in the OS file manager (Explorer / Finder / the default file
/// manager), selecting the item. Powers the file tree's "open in file manager".
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(std::path::PathBuf::from(path))
        .map_err(|e| CommandError::new("REVEAL_FAILED", e.to_string()))
}

/// The single decision point every link in the ADE funnels through: open `url` in
/// the integrated browser tab, hand it to the OS default browser, or (for the
/// `Ask` policy) let the frontend prompt — per the user's `BrowserSettings`.
/// Powers the `openUrl` frontend wrapper and terminal link clicks; the agent
/// `BROWSER` shim reaches the same logic via the hook server's `/browser` route.
#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Result<(), CommandError> {
    crate::browser::route_url(&app, url).await
}

/// Open `url` in the OS default browser unconditionally (ignores the link policy).
/// Powers the integrated browser's "open in system browser" action and the `Ask`
/// prompt's external choice.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| CommandError::new("OPEN_EXTERNAL_FAILED", e.to_string()))
}

/// Working-tree-vs-`HEAD` diff for one file, powering the editor's change gutter
/// (added lines + a peek at the removed lines). Empty for clean/untracked files.
#[tauri::command]
pub async fn git_diff_head(path: String, file: String) -> Result<String, CommandError> {
    git::diff_head(&path, &file)
        .await
        .map_err(CommandError::from)
}

// --- Git status, diffs & staging (Phase 3) ---------------------------------
//
// These run git directly in the worktree `path` (the right panel's review view).

/// List a worktree's changed files (staged + unstaged + untracked). A registered
/// folder that isn't a git repo simply has no changes, so we return an empty list
/// rather than an error (keeps the Changes tab + project card quiet for non-git
/// projects).
#[tauri::command]
pub async fn git_status(path: String) -> Result<Vec<git::FileChange>, CommandError> {
    if !git::is_git_repo(&path).await {
        return Ok(Vec::new());
    }
    git::status_files(&path).await.map_err(CommandError::from)
}

/// Per-file added/deleted line counts vs `HEAD` for the changed-files list.
#[tauri::command]
pub async fn git_numstat(path: String) -> Result<Vec<git::FileNumstat>, CommandError> {
    git::numstat(&path).await.map_err(CommandError::from)
}

/// Unified diff for one file. `staged` selects the index-vs-HEAD diff.
#[tauri::command]
pub async fn git_diff(path: String, file: String, staged: bool) -> Result<String, CommandError> {
    git::diff_file(&path, &file, staged)
        .await
        .map_err(CommandError::from)
}

/// Before/after image versions for a changed **image** file, base64-encoded for
/// the visual diff viewer. `staged` selects HEAD→index vs index→working-tree,
/// mirroring `git_diff`. A missing side (added/deleted) comes back as `null`.
#[tauri::command]
pub async fn git_image_diff(
    path: String,
    file: String,
    staged: bool,
) -> Result<git::ImageDiff, CommandError> {
    git::image_diff(&path, &file, staged)
        .await
        .map_err(CommandError::from)
}

/// Stage one file.
#[tauri::command]
pub async fn git_stage(path: String, file: String) -> Result<(), CommandError> {
    git::stage_file(&path, &file)
        .await
        .map_err(CommandError::from)
}

/// Unstage one file.
#[tauri::command]
pub async fn git_unstage(path: String, file: String) -> Result<(), CommandError> {
    git::unstage_file(&path, &file)
        .await
        .map_err(CommandError::from)
}

/// Stage every change.
#[tauri::command]
pub async fn git_stage_all(path: String) -> Result<(), CommandError> {
    git::stage_all(&path).await.map_err(CommandError::from)
}

/// Unstage everything.
#[tauri::command]
pub async fn git_unstage_all(path: String) -> Result<(), CommandError> {
    git::unstage_all(&path).await.map_err(CommandError::from)
}

/// Discard a file's local changes (tracked → restore to HEAD; untracked → delete).
#[tauri::command]
pub async fn git_discard(path: String, file: String, untracked: bool) -> Result<(), CommandError> {
    git::discard_file(&path, &file, untracked)
        .await
        .map_err(CommandError::from)
}

/// Apply a unified-diff patch (a single hunk, from the frontend) to stage,
/// unstage, or discard it. `cached` targets the index; `reverse` reverses it.
#[tauri::command]
pub async fn git_apply(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<(), CommandError> {
    git::apply_patch(&path, &patch, cached, reverse)
        .await
        .map_err(CommandError::from)
}

/// Commit the staged changes with `message`. With `amend`, rewrites the current
/// `HEAD` commit instead of creating a new one. With `sign_off`, appends a
/// `Signed-off-by:` trailer using the configured git identity.
#[tauri::command]
pub async fn git_commit(
    path: String,
    message: String,
    amend: bool,
    sign_off: bool,
) -> Result<(), CommandError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "commit message is required".to_string(),
        )));
    }
    git::commit(&path, message, amend, sign_off)
        .await
        .map_err(CommandError::from)
}

/// List the worktree's commit history (newest first), `limit` commits from
/// `skip`. Powers the right panel's "History" tab + branch graph.
#[tauri::command]
pub async fn git_log(
    path: String,
    limit: u32,
    skip: u32,
) -> Result<Vec<git::CommitInfo>, CommandError> {
    git::log(&path, limit as usize, skip as usize)
        .await
        .map_err(CommandError::from)
}

/// Unified diff a single commit introduced (vs its first parent), for the
/// "History" tab's commit viewer.
#[tauri::command]
pub async fn git_show(path: String, hash: String) -> Result<String, CommandError> {
    git::show(&path, &hash).await.map_err(CommandError::from)
}

/// Payload of the `git:status-changed` event emitted by the background watcher
/// for the worktree the right panel is reviewing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEvent {
    pub path: String,
    pub files: Vec<git::FileChange>,
    pub ahead: u32,
    pub behind: u32,
}

/// Set (or clear with `None`) the worktree the background watcher polls. The
/// frontend calls this when the active worktree changes.
#[tauri::command]
pub async fn git_set_watch(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), CommandError> {
    *state.git_watch.write().await = path;
    Ok(())
}

/// Push the current branch (`git push`). Not retried.
#[tauri::command]
pub async fn git_push(path: String) -> Result<(), CommandError> {
    git::push(&path).await.map_err(CommandError::from)
}

/// Pull fast-forward-only (`git pull --ff-only`).
#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), CommandError> {
    git::pull(&path).await.map_err(CommandError::from)
}

/// Draft a commit message for `path`'s **staged** changes using the configured
/// AI agent (Settings → AI commit). Opt-in: errors when disabled/unconfigured,
/// when nothing is staged, or when the agent fails / times out. Returns the
/// message (subject on the first line, optional body after a blank line).
#[tauri::command]
pub async fn git_generate_commit_message(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, CommandError> {
    let cfg = state.data.read().await.settings.ai_commit.clone();
    crate::aicommit::generate(&path, &cfg)
        .await
        .map_err(CommandError::from)
}

/// Which of the supported AI-commit agents (Claude Code, Codex, Gemini, OpenCode,
/// Pi) are installed in a runnable shape, so Settings → AI commit offers only
/// those.
#[tauri::command]
pub async fn ai_commit_agents() -> Result<Vec<String>, CommandError> {
    Ok(crate::aicommit::available_agents())
}

/// The models offered by `agentId` for AI commit messages (static for
/// Claude/Gemini, a live CLI query for OpenCode/Pi/Codex). Best-effort: an empty
/// list just means the user falls back to the CLI's default model.
#[tauri::command]
pub async fn ai_commit_models(
    agent_id: String,
) -> Result<Vec<crate::agentcli::AgentModel>, CommandError> {
    crate::aicommit::list_models(&agent_id)
        .await
        .map_err(CommandError::from)
}

/// Payload of the `agent:detected` event: which agent command (if any) the
/// background process scan found running in a terminal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectedEvent {
    pub pty_id: String,
    pub command: Option<String>,
}

/// Set the agent commands the process-detection poll looks for (the catalog +
/// the user's configured agents). The frontend calls this on startup and when
/// the configured agents change.
#[tauri::command]
pub async fn set_agent_commands(
    state: State<'_, AppState>,
    commands: Vec<String>,
) -> Result<(), CommandError> {
    *state.agent_commands.write().await = commands;
    Ok(())
}

// --- Agent hooks (Phase 4, Layer 1) ----------------------------------------

/// Coordinates of the local agent hook server, for the Settings docs panel so a
/// user can wire their agent to report state. `None` until the server is up (or
/// if its port couldn't be bound).
#[tauri::command]
pub async fn get_hook_info(
    state: State<'_, AppState>,
) -> Result<Option<HookServerInfo>, CommandError> {
    Ok(state.hook.read().await.clone())
}

/// The cached last-known agent states (hook reports). The frontend fetches this
/// at boot to hydrate the sidebar, then keeps it live via `agent:status-changed`.
#[tauri::command]
pub async fn agent_states(
    state: State<'_, AppState>,
) -> Result<Vec<AgentStateEntry>, CommandError> {
    Ok(state.data.read().await.agent_cache.clone())
}

/// Request (or release) keeping the system awake. The frontend calls this with
/// `active = settings.preventSleep && (an agent is working)`; the backend
/// auto-releases after 2 h regardless (see `power.rs`).
#[tauri::command]
pub async fn set_prevent_sleep(
    state: State<'_, AppState>,
    active: bool,
) -> Result<(), CommandError> {
    state.power.set(active);
    Ok(())
}

// --- Ready-made agent hook configs (Phase 4 follow-up) ----------------------

/// The textual content of every bundled hook script (with the Claude template
/// already rendered for the installed script path). The Settings → Agents →
/// Hooks pane uses this to show copy-pasteable snippets without having to
/// shell out to `cat` the files.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookScripts {
    /// The rendered `hooks` block ready to paste into `~/.claude/settings.json`.
    pub claude_json: String,
    /// The shell-agnostic relay shared by Codex / Gemini / OpenCode.
    pub status_relay_cjs: String,
    pub wrapper_bash: String,
    pub wrapper_powershell: String,
    pub wrapper_cmd: String,
    pub wrapper_fish: String,
}

/// Paths of the bundled hook scripts the ADE writes to `<app-data>/hooks/`
/// on startup, plus the resolved `~/.claude/settings.json` path. Settings →
/// Agents → Hooks uses this to render copy-pasteable commands and the install
/// buttons. `None` if the install-on-startup step failed (e.g. the app-data
/// directory is not writable) — in that case precise hook reporting still
/// works, just the one-click install is unavailable.
#[tauri::command]
pub async fn get_hook_install(
    state: State<'_, AppState>,
) -> Result<Option<HookInstall>, CommandError> {
    Ok(state.hook_install.read().await.clone())
}

/// The current state of the Claude `settings.json` `hooks` block. Lets the
/// UI render an honest "Installed" / "Not installed" / "Unavailable" badge
/// (we never claim installed unless our managed reporter is actually present).
#[tauri::command]
pub async fn get_claude_hooks_status() -> Result<AgentHooksStatus, CommandError> {
    Ok(agent_hooks::read_claude_status())
}

/// Merge the ADE-managed `hooks` block into `~/.claude/settings.json`, pointing
/// at the installed relay (exec-form `node`, so it runs from any shell).
/// Preserves every other hook and top-level key. Returns the new status so the
/// UI can refresh without a second round-trip.
#[tauri::command]
pub async fn install_claude_hooks(
    state: State<'_, AppState>,
) -> Result<AgentHooksStatus, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_claude_hooks(&install.status_relay_script).map_err(CommandError::from)
}

/// Remove the ADE-managed `hooks` block from `~/.claude/settings.json` (no
/// op if it's not ours). Idempotent: safe to call repeatedly.
#[tauri::command]
pub async fn uninstall_claude_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_claude_hooks().map_err(CommandError::from)
}

/// Status of the managed Codex `hooks.json` (and its `config.toml` trust entry).
#[tauri::command]
pub async fn get_codex_hooks_status() -> Result<AgentHooksStatus, CommandError> {
    Ok(agent_hooks::read_codex_hooks_status())
}

/// Install the ADE-managed hooks into `~/.codex/hooks.json` and trust the file
/// in `~/.codex/config.toml`, so Codex reports precise state out of the box.
#[tauri::command]
pub async fn install_codex_hooks(
    state: State<'_, AppState>,
) -> Result<AgentHooksStatus, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_codex_hooks(&install).map_err(CommandError::from)
}

#[tauri::command]
pub async fn uninstall_codex_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_codex_hooks().map_err(CommandError::from)
}

/// Status of the managed Gemini CLI `settings.json` hooks block.
#[tauri::command]
pub async fn get_gemini_hooks_status() -> Result<AgentHooksStatus, CommandError> {
    Ok(agent_hooks::read_gemini_hooks_status())
}

/// Install the ADE-managed hooks into `~/.gemini/settings.json`.
#[tauri::command]
pub async fn install_gemini_hooks(
    state: State<'_, AppState>,
) -> Result<AgentHooksStatus, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_gemini_hooks(&install.status_relay_script).map_err(CommandError::from)
}

#[tauri::command]
pub async fn uninstall_gemini_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_gemini_hooks().map_err(CommandError::from)
}

/// Status of the managed Pi/OMP status extension.
#[tauri::command]
pub async fn get_pi_hooks_status() -> Result<AgentHooksStatus, CommandError> {
    Ok(agent_hooks::read_pi_hooks_status())
}

/// Install the ADE-managed Pi/OMP status extension into `~/.pi/agent/extensions`.
#[tauri::command]
pub async fn install_pi_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::install_pi_hooks().map_err(CommandError::from)
}

#[tauri::command]
pub async fn uninstall_pi_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_pi_hooks().map_err(CommandError::from)
}

/// Status of the managed OpenCode status plugin.
#[tauri::command]
pub async fn get_opencode_hooks_status() -> Result<AgentHooksStatus, CommandError> {
    Ok(agent_hooks::read_opencode_hooks_status())
}

/// Install the ADE-managed OpenCode status plugin and register it.
#[tauri::command]
pub async fn install_opencode_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::install_opencode_hooks().map_err(CommandError::from)
}

#[tauri::command]
pub async fn uninstall_opencode_hooks() -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_opencode_hooks().map_err(CommandError::from)
}

/// (Re)install the managed hooks for every supported agent. Used by the
/// Settings → Agents → Hooks "Install all" action and at startup.
#[tauri::command]
pub async fn install_all_hooks(state: State<'_, AppState>) -> Result<(), CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_all(&install);
    Ok(())
}

/// The textual content of every bundled hook script. The Settings UI uses
/// this to show copy-pasteable snippets (rendered Claude `settings.json`,
/// the shell-agnostic relay, and the per-platform launcher wrappers). The
/// Claude JSON is rendered against the installed script path so the user can
/// copy it as-is.
#[tauri::command]
pub async fn get_hook_scripts(
    state: State<'_, AppState>,
) -> Result<Option<HookScripts>, CommandError> {
    let install = match state.hook_install.read().await.clone() {
        Some(install) => install,
        None => return Ok(None),
    };
    let claude_json = agent_hooks::render_claude_settings_json(&install.status_relay_script)
        .map_err(CommandError::from)?;
    Ok(Some(HookScripts {
        claude_json,
        status_relay_cjs: agent_hooks::STATUS_RELAY_SCRIPT.to_string(),
        wrapper_bash: agent_hooks::WRAPPER_BASH.to_string(),
        wrapper_powershell: agent_hooks::WRAPPER_POWERSHELL.to_string(),
        wrapper_cmd: agent_hooks::WRAPPER_CMD.to_string(),
        wrapper_fish: agent_hooks::WRAPPER_FISH.to_string(),
    }))
}
