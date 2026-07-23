//! Tauri commands — the request/response surface exposed to the Svelte frontend.
//!
//! Phase 0 ships the minimal set needed to validate the round-trip and persist
//! UI settings. Repo/worktree/PTY/git commands arrive in later phases (see
//! `FOR-DEV.md` and the full planned list in
//! `architecture/03-implementation-guide.md` §2.1).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::agent_hooks::{self, AgentHooksStatus, HookInstall};
use crate::error::{AppError, CommandError};
use crate::git::{self, WorktreeEntry};
use crate::model::{AgentStateEntry, AppData, AppSettings, QuickCommand, RepoData};
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

/// Replace the full set of user-programmed quick commands. Create / edit /
/// duplicate / delete / move / prune all funnel through this snapshot setter,
/// mirroring [`update_settings`] — the frontend owns the array and persists the
/// whole list. Pruning on project/worktree removal is done frontend-side (it
/// holds the live worktree paths) and lands here as a plain overwrite.
#[tauri::command]
pub async fn quick_commands_set(
    state: State<'_, AppState>,
    commands: Vec<QuickCommand>,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.quick_commands = commands;
    state.persistence.save(&data).map_err(CommandError::from)
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

/// Persist the frontend-owned orchestration runs (opaque JSON — the `Run` graph,
/// step states + captured outputs; spec `02d` §3). The frontend debounces these
/// writes; restored on next startup via `get_app_state` so a run survives a
/// restart and the engine re-attaches. Mirror of `set_terminal_layout`.
#[tauri::command]
pub async fn set_orchestration_runs(
    state: State<'_, AppState>,
    runs: serde_json::Value,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    data.orchestration_runs = Some(runs);
    state.persistence.save(&data).map_err(CommandError::from)
}

// --- Terminals (PTY) -------------------------------------------------------
//
// The frontend chooses `id` (so it can subscribe to `pty:output:{id}` before
// the process produces any output), then calls `pty_create`. Output streams via
// `pty:output:{id}` events; `pty:exit:{id}` fires once the process ends.

/// Spawn a shell in a new pseudoterminal sized `cols`×`rows`. Returns `true`
/// when a fresh session was spawned, `false` when one already existed for `id`.
/// In-app remounts never respawn (the frontend keeps each xterm instance alive
/// and re-parents it — `src/lib/terminal/instances.ts`), so `false` only means
/// the webview reloaded over a live backend (dev/HMR); the frontend then nudges
/// the PTY with a row-bounce resize so the running app repaints.
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
    let (browser_enabled, allow_agents, mcp_enabled, mcp_managed_frictionless) = {
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (
            b.enabled,
            b.allow_agents,
            b.mcp_enabled,
            b.mcp_injection == crate::model::McpInjection::Managed && b.friction_free,
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
        // Frictionless (managed mode): trust the workspace for Gemini so it doesn't
        // prompt to trust the folder on launch. A version-robust env var is used
        // instead of a launch flag on purpose — an unknown env var is a harmless
        // no-op, whereas newer Gemini rejects the `--skip-trust` flag and would fail
        // the whole launch. Only a Gemini process reads it; scoped to this terminal.
        if mcp_managed_frictionless {
            env.push(("GEMINI_CLI_TRUST_WORKSPACE".to_string(), "true".to_string()));
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

/// Delay between delivering input and submitting it, so the TUI ingests it before
/// the Enter arrives as a *separate* event (see below).
const PASTE_SUBMIT_DELAY_MS: u64 = 50;

/// Longer gap before Enter for a **multi-line** (bracketed) paste: some TUIs
/// (Claude Code-family agents) briefly *guard* the Enter right after a paste — to
/// stop an accidental multi-line submit — so a too-quick Enter is swallowed and the
/// text is left in the composer. This gives that guard time to clear.
const BRACKETED_SUBMIT_DELAY_MS: u64 = 150;

/// Wrap `text` in bracketed-paste markers (`ESC[200~` … `ESC[201~`), stripping any
/// terminators already inside it so the payload can't break out of the paste early.
/// Pure so it can be unit-tested; the Enter is sent separately (see the command).
fn bracketed_paste(text: &str) -> String {
    let sanitized = text.replace("\u{1b}[200~", "").replace("\u{1b}[201~", "");
    format!("\u{1b}[200~{sanitized}\u{1b}[201~")
}

/// The text payload to write before the (separate) Enter, chosen so the trailing
/// Enter reliably *submits* on the widest range of agent TUIs:
///  - **Single-line** (no newline): sent **verbatim**. A bare Enter arriving as a
///    distinct write then submits it on every TUI — including Claude Code-family
///    agents that run a *paste guard* (they swallow the Enter right after a
///    bracketed paste to stop an accidental multi-line submit; a non-paste keeps
///    that guard from arming, so the Enter goes through).
///  - **Multi-line** (`\n`/`\r` inside): wrapped in **bracketed paste** so the
///    whole block lands as one paste and only the trailing Enter submits — never
///    at the first embedded newline.
fn pty_submit_payload(text: &str) -> String {
    if text.contains('\n') || text.contains('\r') {
        bracketed_paste(text)
    } else {
        text.to_string()
    }
}

/// Type `text` into an agent's PTY, then submit it with a **separate** Enter — the
/// robust way to drive an interactive TUI (used by the orchestration broadcast +
/// run engine). Solves two problems a plain `pty_write("{text}\r")` does not:
///  1. **Concatenation / no-submit.** Many TUIs treat a `\r` arriving in the *same*
///     input burst as part of the composer content (a literal newline, or a paste),
///     not "submit" — so the text is left in the box and the next message appends
///     to it. Sending the `\r` as a distinct write ~50 ms later makes the app read
///     it as a real keypress = submit.
///  2. **Multi-line prompts** (a chained `{{steps…}}` value, a multi-line message)
///     would otherwise submit at the first embedded `\n`. Multi-line text is sent
///     as **bracketed paste** so the whole block is one paste unit — see
///     [`pty_submit_payload`] for why single-line stays verbatim.
///
/// Best-effort like `pty_write`: a dead PTY drops it.
///
// FOR-DEV: bracketed paste assumes the agent enabled DECSET 2004 (every modern
// coding TUI — Claude Code, Codex, Gemini, OpenCode, Pi — does). A multi-line
// submit into an agent with a *long* post-paste Enter guard may still not fire; if
// one is found, add a per-agent submit strategy (delay / key) here. See FOR-DEV.md.
#[tauri::command]
pub async fn pty_paste_submit(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<(), CommandError> {
    let multiline = text.contains('\n') || text.contains('\r');
    state
        .pty
        .write(&id, &pty_submit_payload(&text))
        .map_err(CommandError::from)?;
    let delay = if multiline {
        BRACKETED_SUBMIT_DELAY_MS
    } else {
        PASTE_SUBMIT_DELAY_MS
    };
    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    state.pty.write(&id, "\r").map_err(CommandError::from)?;
    Ok(())
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

/// Redeem one Codex rate-limit reset ("reinicio") from the UI. Returns the outcome
/// code (`reset` / `nothing_to_reset` / `no_credit` / `already_redeemed`) so the
/// frontend can message the result and refresh.
#[tauri::command]
pub async fn usage_codex_redeem_reset() -> Result<String, CommandError> {
    crate::usage::codex_redeem_reset()
        .await
        .map_err(|e| CommandError::from(AppError::Invalid(e)))
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
        worktree_order: Vec::new(),
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

/// Reorder the registered projects to match the user's manual arrangement in the
/// sidebar. `ordered_ids` is the desired front-to-back order; any registered repo
/// not named in it keeps its relative order *after* the listed ones (so a stale
/// list from a concurrent add/remove never drops a project). Unknown ids are
/// ignored. Persists the new `repos` order, which is itself the manual order.
#[tauri::command]
pub async fn repo_reorder(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    reorder_by_ids(&mut data.repos, &ordered_ids, |r| r.id.as_str());
    state.persistence.save(&data).map_err(CommandError::from)
}

/// Reorder `items` in place to match `ordered_ids` (front-to-back). Any item whose
/// key is absent from `ordered_ids` keeps its position *after* the listed ones, in
/// its original relative order (the sort is stable). Unknown ids are ignored. This
/// makes a stale order list from a concurrent add/remove safe: nothing is dropped.
fn reorder_by_ids<T>(items: &mut [T], ordered_ids: &[String], key_of: impl Fn(&T) -> &str) {
    let rank: std::collections::HashMap<&str, usize> = ordered_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    items.sort_by_key(|it| rank.get(key_of(it)).copied().unwrap_or(usize::MAX));
}

/// Set a project's manual worktree order (child worktree paths, front-to-back).
/// The primary worktree is always rendered first regardless, so it need not be
/// included; unknown/removed paths are harmless (the frontend ignores them and
/// self-heals). Returns the updated repo so the frontend can reconcile.
#[tauri::command]
pub async fn repo_set_worktree_order(
    state: State<'_, AppState>,
    id: String,
    paths: Vec<String>,
) -> Result<RepoData, CommandError> {
    let mut data = state.data.write().await;
    let repo = data
        .repos
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {id}"))))?;
    repo.worktree_order = paths;
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
    /// Local branch names (the base picker + the "existing branch" picker).
    pub branches: Vec<String>,
    /// Branches that exist on `origin`, short-named (`origin/main` → `main`).
    /// Powers the "existing branch" mode so a remote-only branch can be checked
    /// out into a fresh worktree. Empty when the repo has no remote.
    pub remote_branches: Vec<String>,
    /// The base ref the dialog should preselect (remote HEAD → main → master → HEAD).
    pub default_base: String,
}

/// List a repo's local + remote branches and the resolved default base ref.
/// Powers both the base-branch picker (new-branch mode) and the existing-branch
/// picker (check out any local/remote branch) when creating a worktree.
#[tauri::command]
pub async fn branch_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<BranchList, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let branches = git::list_branches(&repo_path)
        .await
        .map_err(CommandError::from)?;
    // A repo with no remote simply has no remote branches — don't fail the dialog.
    let remote_branches = git::list_remote_branches(&repo_path)
        .await
        .unwrap_or_default();
    let default_base = git::default_base(&repo_path).await;
    Ok(BranchList {
        branches,
        remote_branches,
        default_base,
    })
}

/// Create a worktree in the given repo. Two modes:
/// - **new branch** (`from_existing = false`): create `branch` from `base` (or
///   the repo's resolved default base — remote HEAD → main → master → HEAD);
/// - **existing branch** (`from_existing = true`): check out an already-existing
///   local or remote-only `branch` (a remote-only one gets a local tracking
///   branch), ignoring `base`.
///
/// `path` is an optional custom worktree directory (must be absolute and not yet
/// exist); when omitted the backend uses the automatic sibling location
/// `<repo>--<branch>`. Returns the created entry as git itself lists it.
#[tauri::command]
pub async fn worktree_create(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: Option<String>,
    from_existing: Option<bool>,
    path: Option<String>,
) -> Result<WorktreeEntry, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "branch name is required".to_string(),
        )));
    }
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let from_existing = from_existing.unwrap_or(false);

    // Resolve the worktree location: a custom absolute path, or the automatic
    // sibling. A custom path is normalized to forward slashes (matching git's own
    // spelling) and must be absolute and not already exist.
    let worktree_path = match path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        Some(custom) => {
            let normalized = custom.replace('\\', "/");
            let normalized = normalized.trim_end_matches('/').to_string();
            if !std::path::Path::new(&normalized).is_absolute() {
                return Err(CommandError::from(AppError::Invalid(
                    "custom worktree path must be absolute".to_string(),
                )));
            }
            if std::path::Path::new(&normalized).exists() {
                return Err(CommandError::from(AppError::Invalid(
                    "a folder already exists at that path".to_string(),
                )));
            }
            normalized
        }
        None => git::worktree_path_for(&repo_path, &branch),
    };

    if from_existing {
        git::add_worktree_from_existing(&repo_path, &branch, &worktree_path)
            .await
            .map_err(CommandError::from)?;
    } else {
        let base = match base.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()) {
            Some(base) => base,
            None => git::default_base(&repo_path).await,
        };
        git::add_worktree(&repo_path, &branch, &worktree_path, Some(&base))
            .await
            .map_err(CommandError::from)?;
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

/// Remove a worktree (spec §2.3). With `force = false` the backend refuses when
/// the worktree has uncommitted changes; the frontend surfaces this so the user
/// can confirm a forced removal. Branch cleanup is **opt-in** via `cleanup`:
/// by default only the worktree is removed. When asked, the local branch is
/// deleted (safe, force, or squash-merge) and/or the remote branch on `origin`.
/// The returned [`git::RemoveOutcome`] tells the UI what happened to each.
#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: Option<String>,
    force: bool,
    cleanup: Option<git::BranchCleanup>,
) -> Result<git::RemoveOutcome, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::remove_worktree(
        &repo_path,
        &path,
        branch.as_deref(),
        force,
        cleanup.unwrap_or_default(),
    )
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

/// Read a local image file as an inline `data:<mime>;base64,…` URL for the
/// editor's image preview (multimodal file viewer). Refuses non-images and
/// anything over the preview size cap (see [`crate::fs::read_data_url`]).
#[tauri::command]
pub async fn fs_read_data_url(path: String) -> Result<String, CommandError> {
    crate::fs::read_data_url(&path)
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

/// Whether a filesystem path currently exists. Read-only; the frontend's boot
/// reconciler uses it to decide whether a restored terminal workspace still has
/// a worktree folder behind it (gone → the stale workspace entry is dropped).
#[tauri::command]
pub async fn fs_path_exists(path: String) -> Result<bool, CommandError> {
    Ok(tokio::fs::try_exists(&path).await.unwrap_or(false))
}

/// The terminal scrollback-snapshot sidecar, next to `state.json`. Kept out of
/// the main persistence file so bulky ANSI snapshots never ride the debounced
/// `state.json` hot path (they are written only on workspace sleep and window
/// close). The content is opaque, frontend-owned JSON (sid → snapshot).
pub(crate) fn term_buffers_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("terminal-buffers.json")
}

pub(crate) async fn read_term_buffers(path: &std::path::Path) -> Option<serde_json::Value> {
    let text = tokio::fs::read_to_string(path).await.ok()?;
    serde_json::from_str(&text).ok()
}

/// Read the persisted terminal scrollback snapshots (`None` when absent/corrupt —
/// the app then simply restores without scrollback).
#[tauri::command]
pub async fn term_buffers_get(app: AppHandle) -> Result<Option<serde_json::Value>, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?;
    Ok(read_term_buffers(&term_buffers_path(&dir)).await)
}

/// Overwrite the terminal scrollback snapshots (atomic write, same envelope as
/// every other persisted file).
#[tauri::command]
pub async fn term_buffers_set(
    app: AppHandle,
    buffers: serde_json::Value,
) -> Result<(), CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?;
    let path = term_buffers_path(&dir);
    let text = serde_json::to_string(&buffers).map_err(AppError::from)?;
    tokio::task::spawn_blocking(move || agent_hooks::write_json_atomic(&path, &text))
        .await
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
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

/// Create a new, empty file in `dir` (the file tree's "New File"). `path` is a bare
/// name or a VSCode-style intercalated relative path (`sub/dir/file.js`) whose parent
/// segments are created as folders; the leaf must not already exist (see
/// [`crate::fs::create_file`]). Returns the new absolute, forward-slash path.
#[tauri::command]
pub async fn fs_create_file(dir: String, path: String) -> Result<String, CommandError> {
    crate::fs::create_file(&dir, &path)
        .await
        .map_err(CommandError::from)
}

/// Create a new empty directory in `dir` (the file tree's "New Folder"). Same
/// intercalated-path / no-clobber guards as [`fs_create_file`], with every segment
/// created as a folder. Returns the new path.
#[tauri::command]
pub async fn fs_create_dir(dir: String, path: String) -> Result<String, CommandError> {
    crate::fs::create_dir(&dir, &path)
        .await
        .map_err(CommandError::from)
}

/// Move a file or directory to the OS trash (the file tree's "Delete"). Recoverable
/// by design; guarded against filesystem roots (see [`crate::fs::delete_to_trash`]).
#[tauri::command]
pub async fn fs_delete(path: String) -> Result<(), CommandError> {
    crate::fs::delete_to_trash(&path)
        .await
        .map_err(CommandError::from)
}

/// Duplicate a single file next to itself under a unique "… copy" name (the file
/// tree's "Duplicate"). Directories are refused. Returns the new path.
#[tauri::command]
pub async fn fs_duplicate(path: String) -> Result<String, CommandError> {
    crate::fs::duplicate_file(&path)
        .await
        .map_err(CommandError::from)
}

/// The current conversation of the **Zero** agent running in `cwd` (worktree
/// path): its session title + a coarse status, read from Zero's on-disk session
/// metadata (see [`crate::zero::session_for`]). `None` when no matching session
/// exists. Never errors — a missing/unreadable store just yields `None`.
#[tauri::command]
pub async fn zero_session(cwd: String) -> Result<Option<crate::zero::ZeroSession>, CommandError> {
    Ok(
        tokio::task::spawn_blocking(move || crate::zero::session_for(&cwd))
            .await
            .unwrap_or(None),
    )
}

/// Project-wide filename search for the file tree: recursively find files under
/// `root` whose relative path matches every token of `query` (see
/// [`crate::fs::search_files`]). `include_hidden` surfaces dotfiles; `limit` caps
/// the results. Runs the blocking walk on the blocking pool.
#[tauri::command]
pub async fn fs_search_files(
    root: String,
    query: String,
    include_hidden: bool,
    limit: usize,
) -> Result<crate::fs::FileSearch, CommandError> {
    tokio::task::spawn_blocking(move || {
        crate::fs::search_files(&root, &query, include_hidden, limit)
    })
    .await
    .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string()))
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
        .timeout(std::time::Duration::from_secs(15))
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

    // Stream the body chunk-by-chunk, enforcing the cap as it grows: a server
    // that lies about (or omits) Content-Length can't push more than
    // MAX_ICON_BYTES into memory, and the client timeout bounds a slow trickle.
    let mut bytes: Vec<u8> = Vec::new();
    let mut resp = resp;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| CommandError::new("IMAGE_FETCH_FAILED", e.to_string()))?
    {
        if (bytes.len() + chunk.len()) as u64 > MAX_ICON_BYTES {
            return Err(CommandError::new(
                "IMAGE_FETCH_FAILED",
                "the image is too large",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    // Prefer the server's content-type; else sniff from magic bytes. Refuse
    // anything that isn't a recognizable image so we never inline HTML/JSON.
    let mime = mime
        .or_else(|| crate::fs::sniff_image_mime(&bytes).map(str::to_string))
        .ok_or_else(|| CommandError::new("IMAGE_FETCH_FAILED", "the URL is not an image"))?;

    Ok(format!("data:{mime};base64,{}", BASE64.encode(&bytes)))
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

/// Set (or clear with `None`) the directory the in-app folder browser watches.
/// The picker calls this as the user navigates (and clears it on close); the
/// backend emits `browse:changed` when a folder is created/removed directly in
/// that directory so the listing refreshes without a manual reload.
#[tauri::command]
pub async fn browse_set_watch(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), CommandError> {
    state
        .browse_watcher
        .set(&app, path)
        .await
        .map_err(|e| CommandError::new("BROWSE_WATCH_FAILED", e.to_string()))
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

/// Detect the installed GUI editors/IDEs on this machine (a PATH probe plus a
/// per-OS install-location scan), for the "Open with" menus. Only the available
/// ones come back, each with the command used to launch it.
#[tauri::command]
pub fn editors_detect() -> Vec<crate::editors::DetectedEditor> {
    crate::editors::detect()
}

/// The platform's native plain-text editor (Notepad / TextEdit / a detected Linux
/// editor), offered for text files. `None` when none is found (bare Linux).
#[tauri::command]
pub fn native_text_editor() -> Option<crate::editors::NativeEditor> {
    crate::editors::native_text_editor()
}

/// Launch `path` (a folder or file) in an external editor: `command` (a detected
/// editor's PATH command, or a user-configured one) + `args`, with `path` last.
/// Detached and windowless — see `editors::open_in_editor`. `async` so the child
/// is spawned on the Tokio runtime (`winproc::command` builds a `tokio` command).
#[tauri::command]
pub async fn open_in_editor(
    command: String,
    args: Vec<String>,
    path: String,
) -> Result<(), CommandError> {
    crate::editors::open_in_editor(&command, &args, &path)
        .map_err(|e| CommandError::new("OPEN_IN_EDITOR_FAILED", e.to_string()))
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

/// Fetch the current branch's remote (`git fetch`) and return the refreshed
/// working-tree status, so ahead/behind now reflect the server. Lets the user
/// check for new upstream commits to pull without touching the working tree.
/// Errors (offline, no remote) surface to the caller.
#[tauri::command]
pub async fn git_fetch(path: String) -> Result<git::WorktreeStatus, CommandError> {
    git::fetch_remote(&path).await.map_err(CommandError::from)?;
    git::worktree_status(&path)
        .await
        .map_err(CommandError::from)
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

/// Run an agent **headless** (print-mode) for one orchestration-run step (spec
/// `02d` §3): drive the installed CLI non-interactively against `prompt` in `cwd`
/// and return its captured stdout/stderr + the verified exit code. `model` empty
/// → the CLI's default; `timeoutMs` overrides the default budget. Errors only on
/// a spawn failure / timeout / unsupported agent — a non-zero exit comes back in
/// `exitCode` so the engine can gate on it.
#[tauri::command]
pub async fn agent_run_headless(
    agent: String,
    model: String,
    prompt: String,
    cwd: String,
    timeout_ms: Option<u64>,
) -> Result<crate::agentrun::HeadlessResult, CommandError> {
    crate::agentrun::run_headless(&agent, &model, &prompt, &cwd, timeout_ms)
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
    /// The rendered `hooks` block for `~/.gemini/settings.json`.
    pub gemini_json: String,
    /// The full `~/.codex/hooks.json` body (the `trusted_hash` in `config.toml` is
    /// auto-managed, so it isn't shown here).
    pub codex_json: String,
    /// The in-process plugin source the ADE drops in OpenCode's `plugins/` dir.
    pub opencode_plugin_js: String,
    /// The in-process extension source the ADE drops in Pi's `extensions/` dir.
    pub pi_extension_js: String,
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
    let gemini_json = agent_hooks::render_gemini_settings_json(&install.status_relay_script)
        .map_err(CommandError::from)?;
    let codex_json = agent_hooks::render_codex_hooks_json(&install).map_err(CommandError::from)?;
    Ok(Some(HookScripts {
        claude_json,
        gemini_json,
        codex_json,
        opencode_plugin_js: agent_hooks::OPENCODE_STATUS_PLUGIN.to_string(),
        pi_extension_js: agent_hooks::PI_STATUS_EXTENSION.to_string(),
        status_relay_cjs: agent_hooks::STATUS_RELAY_SCRIPT.to_string(),
        wrapper_bash: agent_hooks::WRAPPER_BASH.to_string(),
        wrapper_powershell: agent_hooks::WRAPPER_POWERSHELL.to_string(),
        wrapper_cmd: agent_hooks::WRAPPER_CMD.to_string(),
        wrapper_fish: agent_hooks::WRAPPER_FISH.to_string(),
    }))
}

// --- GitHub integration (gh-backed) ----------------------------------------

/// Current GitHub sign-in status (gh installed? authenticated? login/host/scopes)
/// for the GitHub section's Account/Session panel and the section gate. Never
/// returns the token.
#[tauri::command]
pub async fn github_status() -> Result<crate::github::GithubStatus, CommandError> {
    Ok(crate::github::status().await)
}

/// The active worktree's GitHub context (owner/repo, current branch, and the PR
/// for that branch with a checks roll-up). `None` when it isn't a GitHub repo.
#[tauri::command]
pub async fn github_repo_context(
    worktree_path: String,
) -> Result<Option<crate::github::RepoContext>, CommandError> {
    Ok(crate::github::repo_context(&worktree_path).await)
}

/// List PRs for the worktree's repo. `state` is `open|closed|merged|all`.
#[tauri::command]
pub async fn github_pr_list(
    worktree_path: String,
    state: String,
    search: Option<String>,
    limit: u32,
) -> Result<Vec<crate::github::PrListItem>, CommandError> {
    crate::github::pr_list(&worktree_path, &state, search.as_deref(), limit)
        .await
        .map_err(CommandError::from)
}

/// Full detail for one PR (metadata + files + checks), for the review center tab.
#[tauri::command]
pub async fn github_pr_view(
    worktree_path: String,
    number: String,
) -> Result<crate::github::PrDetail, CommandError> {
    crate::github::pr_view(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// The unified diff of a PR.
#[tauri::command]
pub async fn github_pr_diff(worktree_path: String, number: String) -> Result<String, CommandError> {
    crate::github::pr_diff(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// The chronological timeline of a PR or issue (comments, reviews, commits, and
/// smaller events — labels, assignments, merges, cross-references, …).
#[tauri::command]
pub async fn github_pr_timeline(
    worktree_path: String,
    number: String,
) -> Result<Vec<crate::github::TimelineEvent>, CommandError> {
    crate::github::pr_timeline(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Create a PR. `options.base`/`options.head` select the target/source branches;
/// when omitted gh falls back to the default branch / the checked-out branch.
/// Returns the new PR URL.
#[tauri::command]
pub async fn github_pr_create(
    worktree_path: String,
    options: crate::github::PrCreateOptions,
) -> Result<String, CommandError> {
    crate::github::pr_create(&worktree_path, options)
        .await
        .map_err(CommandError::from)
}

/// The branch pickers' data for the create-PR form: local branches (head
/// candidates), `origin` branches (base candidates), the default base and the
/// checked-out branch.
#[tauri::command]
pub async fn github_branches(
    worktree_path: String,
) -> Result<crate::github::PrBranches, CommandError> {
    crate::github::pr_branches(&worktree_path)
        .await
        .map_err(CommandError::from)
}

/// Post a conversation comment on a PR (not a review verdict).
#[tauri::command]
pub async fn github_pr_comment(
    worktree_path: String,
    number: String,
    body: String,
) -> Result<(), CommandError> {
    crate::github::pr_comment(&worktree_path, &number, &body)
        .await
        .map_err(CommandError::from)
}

/// Submit a review verb (`approve|request-changes|comment`) on a PR.
#[tauri::command]
pub async fn github_pr_review(
    worktree_path: String,
    number: String,
    verb: String,
    body: Option<String>,
) -> Result<(), CommandError> {
    crate::github::pr_review(&worktree_path, &number, &verb, body.as_deref())
        .await
        .map_err(CommandError::from)
}

/// Close a PR without merging.
#[tauri::command]
pub async fn github_pr_close(worktree_path: String, number: String) -> Result<(), CommandError> {
    crate::github::pr_close(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Reopen a closed PR.
#[tauri::command]
pub async fn github_pr_reopen(worktree_path: String, number: String) -> Result<(), CommandError> {
    crate::github::pr_reopen(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Merge a PR, or arm auto-merge for it. See [`crate::github::PrMergeOptions`].
#[tauri::command]
pub async fn github_pr_merge(
    worktree_path: String,
    number: String,
    options: crate::github::PrMergeOptions,
) -> Result<(), CommandError> {
    crate::github::pr_merge(&worktree_path, &number, options)
        .await
        .map_err(CommandError::from)
}

/// Edit a PR's title and/or body. `None` leaves a field untouched.
#[tauri::command]
pub async fn github_pr_edit(
    worktree_path: String,
    number: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), CommandError> {
    crate::github::pr_edit(&worktree_path, &number, title.as_deref(), body.as_deref())
        .await
        .map_err(CommandError::from)
}

/// Edit an issue's title and/or body. `None` leaves a field untouched.
#[tauri::command]
pub async fn github_issue_edit(
    worktree_path: String,
    number: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), CommandError> {
    crate::github::issue_edit(&worktree_path, &number, title.as_deref(), body.as_deref())
        .await
        .map_err(CommandError::from)
}

/// Bring a PR's branch up to date with its base — the fix for a `BEHIND` state.
#[tauri::command]
pub async fn github_pr_update_branch(
    worktree_path: String,
    number: String,
    rebase: bool,
) -> Result<(), CommandError> {
    crate::github::pr_update_branch(&worktree_path, &number, rebase)
        .await
        .map_err(CommandError::from)
}

/// Take a PR out of draft, or (with `undo`) put it back.
#[tauri::command]
pub async fn github_pr_ready(
    worktree_path: String,
    number: String,
    undo: bool,
) -> Result<(), CommandError> {
    crate::github::pr_ready(&worktree_path, &number, undo)
        .await
        .map_err(CommandError::from)
}

/// Turn off a PR's armed auto-merge.
#[tauri::command]
pub async fn github_pr_disable_auto_merge(
    worktree_path: String,
    number: String,
) -> Result<(), CommandError> {
    crate::github::pr_disable_auto_merge(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// What the base branch's rules and the repo's settings allow for merging PR
/// `number`, plus the PR's live mergeability. Drives the merge controls.
#[tauri::command]
pub async fn github_merge_info(
    worktree_path: String,
    number: String,
    base: String,
) -> Result<crate::github::MergeInfo, CommandError> {
    crate::github::merge_info(&worktree_path, &number, &base)
        .await
        .map_err(CommandError::from)
}

/// Check out a PR into a **new worktree** (`pr-<n>` at the fetched PR head). Fetches
/// `pull/<n>/head` so forks work, then adds the worktree. Returns the new entry so
/// the frontend adds it to the repo's worktree list (like `worktree_create`).
#[tauri::command]
pub async fn github_pr_checkout(
    state: State<'_, AppState>,
    repo_id: String,
    number: String,
    branch: Option<String>,
) -> Result<WorktreeEntry, CommandError> {
    let number = crate::github::validate_number(&number).map_err(CommandError::from)?;
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let branch = branch_or_default(branch, || format!("pr-{number}"))?;
    git::fetch(&repo_path, &format!("pull/{number}/head"))
        .await
        .map_err(CommandError::from)?;
    let worktree_path = git::worktree_path_for(&repo_path, &branch);
    git::add_worktree(&repo_path, &branch, &worktree_path, Some("FETCH_HEAD"))
        .await
        .map_err(CommandError::from)?;
    Ok(WorktreeEntry {
        path: worktree_path,
        branch: Some(branch),
        head: None,
        is_main: false,
    })
}

/// Resolve a caller-supplied branch name, falling back to the generic default
/// (`pr-<n>` / `issue-<n>`) when it's absent or blank. Rejects a name git itself
/// would refuse, so the failure names the field rather than surfacing a raw git
/// error from three calls deeper.
fn branch_or_default(
    branch: Option<String>,
    default: impl FnOnce() -> String,
) -> Result<String, CommandError> {
    let branch = branch
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(default);
    if !crate::git::is_valid_branch_name(&branch) {
        return Err(CommandError::from(AppError::Invalid(format!(
            "invalid branch name: {branch:?}"
        ))));
    }
    Ok(branch)
}

/// List issues for the worktree's repo.
#[tauri::command]
pub async fn github_issue_list(
    worktree_path: String,
    state: String,
    search: Option<String>,
    limit: u32,
) -> Result<Vec<crate::github::IssueListItem>, CommandError> {
    crate::github::issue_list(&worktree_path, &state, search.as_deref(), limit)
        .await
        .map_err(CommandError::from)
}

/// Full detail for one issue (body + metadata).
#[tauri::command]
pub async fn github_issue_view(
    worktree_path: String,
    number: String,
) -> Result<crate::github::IssueDetail, CommandError> {
    crate::github::issue_view(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Post a comment on an issue.
#[tauri::command]
pub async fn github_issue_comment(
    worktree_path: String,
    number: String,
    body: String,
) -> Result<(), CommandError> {
    crate::github::issue_comment(&worktree_path, &number, &body)
        .await
        .map_err(CommandError::from)
}

/// Close an issue.
#[tauri::command]
pub async fn github_issue_close(worktree_path: String, number: String) -> Result<(), CommandError> {
    crate::github::issue_close(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Reopen a closed issue.
#[tauri::command]
pub async fn github_issue_reopen(
    worktree_path: String,
    number: String,
) -> Result<(), CommandError> {
    crate::github::issue_reopen(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
}

/// Create an issue in the worktree's repo, optionally labeled and assigned.
/// Returns the new issue URL.
#[tauri::command]
pub async fn github_issue_create(
    worktree_path: String,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
) -> Result<String, CommandError> {
    crate::github::issue_create(&worktree_path, &title, &body, &labels, &assignees)
        .await
        .map_err(CommandError::from)
}

/// The repo's labels, for the issue-create picker.
#[tauri::command]
pub async fn github_labels(
    worktree_path: String,
) -> Result<Vec<crate::github::Label>, CommandError> {
    crate::github::labels(&worktree_path)
        .await
        .map_err(CommandError::from)
}

/// Logins assignable in the worktree's repo.
#[tauri::command]
pub async fn github_assignees(worktree_path: String) -> Result<Vec<String>, CommandError> {
    crate::github::assignees(&worktree_path)
        .await
        .map_err(CommandError::from)
}

/// Request reviews on a PR from the given logins.
#[tauri::command]
pub async fn github_pr_add_reviewers(
    worktree_path: String,
    number: String,
    logins: Vec<String>,
) -> Result<(), CommandError> {
    crate::github::pr_add_reviewers(&worktree_path, &number, &logins)
        .await
        .map_err(CommandError::from)
}

/// Start work on an issue: create + link a branch (`gh issue develop`) and add it
/// as a **new worktree**. Returns the new entry.
#[tauri::command]
pub async fn github_issue_develop(
    state: State<'_, AppState>,
    repo_id: String,
    number: String,
    branch: Option<String>,
) -> Result<WorktreeEntry, CommandError> {
    let number = crate::github::validate_number(&number).map_err(CommandError::from)?;
    let repo_path = repo_path_of(&state, &repo_id).await?;
    let branch = branch_or_default(branch, || format!("issue-{number}"))?;
    // If a worktree for this branch already exists (a re-run), just return it.
    let worktree_path = git::worktree_path_for(&repo_path, &branch);
    if std::path::Path::new(&worktree_path).exists() {
        return Ok(WorktreeEntry {
            path: worktree_path,
            branch: Some(branch),
            head: None,
            is_main: false,
        });
    }
    // Create the linked branch on the remote. Tolerate an "already exists"/"already
    // linked" (a re-run) — the branch is materialized below regardless — but surface
    // any other failure (e.g. no write access) with gh's own message.
    if let Err(e) = crate::github::issue_develop(&repo_path, &number, &branch).await {
        let msg = e.to_string().to_lowercase();
        if !msg.contains("already") {
            return Err(CommandError::from(e));
        }
    }
    // Materialize the branch locally from origin (an explicit `branch:branch`
    // refspec creates the local branch), then add the worktree. A fetch failure here
    // means the linked branch wasn't created on the remote.
    git::fetch(&repo_path, &format!("{branch}:{branch}"))
        .await
        .map_err(CommandError::from)?;
    git::add_worktree_existing(&repo_path, &branch, &worktree_path)
        .await
        .map_err(CommandError::from)?;
    Ok(WorktreeEntry {
        path: worktree_path,
        branch: Some(branch),
        head: None,
        is_main: false,
    })
}

/// List recent workflow runs (optionally for a branch).
#[tauri::command]
pub async fn github_run_list(
    worktree_path: String,
    branch: Option<String>,
    limit: u32,
) -> Result<Vec<crate::github::RunListItem>, CommandError> {
    crate::github::run_list(&worktree_path, branch.as_deref(), limit)
        .await
        .map_err(CommandError::from)
}

/// The log of a workflow run (`failed` = failed steps only), rendered in a tab.
#[tauri::command]
pub async fn github_run_log(
    worktree_path: String,
    run_id: String,
    failed: bool,
) -> Result<String, CommandError> {
    crate::github::run_log(&worktree_path, &run_id, failed)
        .await
        .map_err(CommandError::from)
}

/// Re-run a workflow run (`failed` = only failed jobs).
#[tauri::command]
pub async fn github_run_rerun(
    worktree_path: String,
    run_id: String,
    failed: bool,
) -> Result<(), CommandError> {
    crate::github::run_rerun(&worktree_path, &run_id, failed)
        .await
        .map_err(CommandError::from)
}

/// Cancel an in-progress workflow run.
#[tauri::command]
pub async fn github_run_cancel(worktree_path: String, run_id: String) -> Result<(), CommandError> {
    crate::github::run_cancel(&worktree_path, &run_id)
        .await
        .map_err(CommandError::from)
}

/// The authenticated core REST rate limit, for the status-bar quota gauge.
#[tauri::command]
pub async fn github_rate_limit() -> Result<crate::github::RateLimit, CommandError> {
    crate::github::rate_limit()
        .await
        .map_err(CommandError::from)
}

/// Count of unread GitHub notifications, for the status-bar badge.
#[tauri::command]
pub async fn github_notifications_count() -> Result<u64, CommandError> {
    crate::github::notifications_count()
        .await
        .map_err(CommandError::from)
}

/// Clone a GitHub repo into `dest` (`gh repo clone`). Returns the destination path.
#[tauri::command]
pub async fn github_clone(repo: String, dest: String) -> Result<String, CommandError> {
    crate::github::clone(&repo, &dest)
        .await
        .map_err(CommandError::from)
}

/// Draft a PR description (Markdown) from the branch diff using a local CLI agent.
/// One-shot, non-interactive — no API/keys. The agent/model/language/instructions
/// come from `AppSettings.github` (GitHub → Settings), read here rather than passed
/// in, matching `git_generate_commit_message` — the settings are the source of
/// truth, so a caller can't run a different agent than the one configured.
#[tauri::command]
pub async fn github_ai_draft_pr(
    state: State<'_, AppState>,
    worktree_path: String,
    base: Option<String>,
) -> Result<String, CommandError> {
    let cfg = state.data.read().await.settings.github.clone();
    // Draft from the diff against the base the PR will actually target, so the body
    // describes the PR's own changes. Only when the caller has no base to offer do
    // we fall back to the repo's resolved default.
    let base = match base.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()) {
        Some(base) => base,
        None => git::default_base(&worktree_path).await,
    };
    let diff = git::branch_diff(&worktree_path, &base)
        .await
        .map_err(CommandError::from)?;
    crate::aicommit::draft_pr(&worktree_path, &cfg, &diff)
        .await
        .map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::{
        bracketed_paste, fs_path_exists, pty_submit_payload, read_term_buffers, reorder_by_ids,
        term_buffers_path,
    };

    #[tokio::test]
    async fn term_buffers_sidecar_round_trips_and_tolerates_corruption() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = term_buffers_path(dir.path());
        assert!(path.ends_with("terminal-buffers.json"));
        // Absent file → None (restore proceeds without scrollback).
        assert!(read_term_buffers(&path).await.is_none());
        // Round-trip through the same atomic writer the command uses.
        let value = serde_json::json!({ "sid-1": "\u{1b}[2J snapshot" });
        crate::agent_hooks::write_json_atomic(&path, &serde_json::to_string(&value).unwrap())
            .expect("write");
        assert_eq!(read_term_buffers(&path).await, Some(value));
        // Corrupt content → None, never an error.
        tokio::fs::write(&path, b"{not json")
            .await
            .expect("corrupt");
        assert!(read_term_buffers(&path).await.is_none());
    }

    #[tokio::test]
    async fn path_exists_reports_real_and_missing_paths() {
        let dir = std::env::temp_dir();
        assert!(fs_path_exists(dir.to_string_lossy().into_owned())
            .await
            .unwrap());
        let missing = dir.join("uxnan-definitely-missing-3f9a1c");
        assert!(!fs_path_exists(missing.to_string_lossy().into_owned())
            .await
            .unwrap());
    }

    #[test]
    fn bracketed_paste_wraps_and_sanitizes() {
        // Plain multi-line text is wrapped verbatim between the paste markers.
        assert_eq!(bracketed_paste("a\nb"), "\u{1b}[200~a\nb\u{1b}[201~");
        // Any embedded terminators are stripped so the payload can't escape early.
        let sneaky = "x\u{1b}[201~ then \u{1b}[200~y";
        assert_eq!(bracketed_paste(sneaky), "\u{1b}[200~x then y\u{1b}[201~");
    }

    #[test]
    fn submit_payload_wraps_only_multiline() {
        // Single-line goes verbatim (a separate Enter then submits on every TUI,
        // incl. Claude Code-family paste guards).
        assert_eq!(pty_submit_payload("hello world"), "hello world");
        // Multi-line (\n or \r) is wrapped so only the trailing Enter submits.
        assert_eq!(pty_submit_payload("a\nb"), "\u{1b}[200~a\nb\u{1b}[201~");
        assert_eq!(pty_submit_payload("a\rb"), "\u{1b}[200~a\rb\u{1b}[201~");
    }

    /// A minimal keyed item, so `reorder_by_ids` is exercised without building a
    /// full `RepoData`.
    #[derive(Debug)]
    struct Item {
        id: &'static str,
    }

    fn ids(items: &[Item]) -> Vec<&'static str> {
        items.iter().map(|i| i.id).collect()
    }

    #[test]
    fn reorder_applies_requested_order() {
        let mut items = vec![Item { id: "a" }, Item { id: "b" }, Item { id: "c" }];
        reorder_by_ids(&mut items, &["c".into(), "a".into(), "b".into()], |i| i.id);
        assert_eq!(ids(&items), vec!["c", "a", "b"]);
    }

    #[test]
    fn reorder_keeps_unlisted_items_after_in_original_order() {
        // Only "c" and "a" are listed; "b" and "d" are unlisted and must stay after
        // the listed ones in their original relative order (stable sort).
        let mut items = vec![
            Item { id: "a" },
            Item { id: "b" },
            Item { id: "c" },
            Item { id: "d" },
        ];
        reorder_by_ids(&mut items, &["c".into(), "a".into()], |i| i.id);
        assert_eq!(ids(&items), vec!["c", "a", "b", "d"]);
    }

    #[test]
    fn reorder_ignores_unknown_ids() {
        let mut items = vec![Item { id: "a" }, Item { id: "b" }];
        // "zzz" isn't present and must be ignored; the known ids still reorder.
        reorder_by_ids(&mut items, &["zzz".into(), "b".into(), "a".into()], |i| {
            i.id
        });
        assert_eq!(ids(&items), vec!["b", "a"]);
    }

    #[test]
    fn reorder_empty_order_is_noop() {
        let mut items = vec![Item { id: "a" }, Item { id: "b" }];
        reorder_by_ids(&mut items, &[], |i| i.id);
        assert_eq!(ids(&items), vec!["a", "b"]);
    }
}
