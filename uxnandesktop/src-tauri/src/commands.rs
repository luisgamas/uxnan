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
use crate::model::{
    AgentStateEntry, AppData, AppSettings, QuickCommand, RepoData, SshHost, WorktreeLocationMode,
};
use crate::ssh;
use crate::state::{AppState, HookServerInfo};
use crate::target::{self, TargetExpectation, TargetId, LOCAL_GENERATION};
use crate::worktreeclean;
use crate::worktreeloc::{self, Resolved};
use uxnan_host_protocol::{CleanupCall, FsCall, GitCall};

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
    data.settings = preserve_backend_owned(&mut data.settings, settings);
    state.persistence.save(&data).map_err(CommandError::from)?;
    // Keep the resource monitor's cadence in step (no-op unless the resource
    // settings actually changed — this command fires for every settings write).
    state.resources.apply_settings(&data.settings.resources);
    // Same for the bridge connection: a no-op unless the mode changed.
    state.bridge.set_mode(data.settings.bridge.mode);
    let tools_enabled = data.settings.browser.mcp_enabled;
    let snapshot = data.clone();
    // Never hold the settings lock across a call to the bridge.
    drop(data);
    state.bridge.set_tools_enabled(tools_enabled).await;
    Ok(snapshot)
}

/// Merge a settings payload from the UI over what is already stored, keeping the
/// fields the **backend** owns.
///
/// Settings travel as one whole object, so every field in the payload replaces
/// its stored counterpart. That is fine for things the user edits and wrong for
/// anything only the backend writes: the frontend does not model those, so its
/// copy is an empty one, and accepting it deletes them.
///
/// This is not hypothetical. Adding an SSH host and then changing any unrelated
/// setting silently deleted every host *and* every tombstone — and because the
/// tombstones went too, re-adding the same machine minted a fresh id, which no
/// live session matched, so opening a terminal on it failed with "connect
/// first" while the host sat there looking connected.
fn preserve_backend_owned(stored: &mut AppSettings, incoming: AppSettings) -> AppSettings {
    AppSettings {
        ssh_hosts: std::mem::take(&mut stored.ssh_hosts),
        removed_ssh_hosts: std::mem::take(&mut stored.removed_ssh_hosts),
        ..incoming
    }
}

// --- Resource observability (`resources.rs`) ---------------------------------

/// The consolidated resource summary (from the buffered frames; no fresh
/// sample). The live feed is the `resources:summary` event while subscribed.
#[tauri::command]
pub async fn resources_summary(
    state: State<'_, AppState>,
) -> Result<crate::resources::ResourceSummary, CommandError> {
    Ok(state.resources.summary(crate::resources::now_ms()))
}

/// Take (or renew) a sampling lease. `token` identifies the consumer surface;
/// leases expire on their own, so the frontend renews while its surface is open.
#[tauri::command]
pub async fn resources_subscribe(
    state: State<'_, AppState>,
    token: String,
    kind: crate::resources::ConsumerKind,
) -> Result<(), CommandError> {
    state
        .resources
        .subscribe(&token, kind, crate::resources::now_ms());
    Ok(())
}

/// Release a sampling lease (idempotent).
#[tauri::command]
pub async fn resources_unsubscribe(
    state: State<'_, AppState>,
    token: String,
) -> Result<(), CommandError> {
    state.resources.unsubscribe(&token);
    Ok(())
}

/// Apply the frontend-resolved resource-mode parameters the monitor consumes —
/// today just the history budget (seconds of aggregated frames retained). The
/// policy engine (`src/lib/resources/policy.ts`) is the single place presets
/// and overrides resolve; the backend receives only the resulting parameter
/// and clamps it defensively (see `ResourceMonitor::set_history_seconds`).
#[tauri::command]
pub async fn resources_set_policy(
    state: State<'_, AppState>,
    history_seconds: u32,
) -> Result<(), CommandError> {
    state
        .resources
        .set_history_seconds(history_seconds, crate::resources::now_ms());
    Ok(())
}

/// The sanitized diagnostics document for a manual export. The frontend shows
/// its `fields` list in a consent dialog and writes this exact document only
/// after the user confirms — nothing is saved here.
#[tauri::command]
pub async fn resources_export(
    state: State<'_, AppState>,
) -> Result<crate::resources::ResourceExport, CommandError> {
    Ok(state.resources.export(crate::resources::now_ms()))
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

// ---------------------------------------------------------------------- pets
//
// Installed pets live under `<app-data>/pets/`, one folder per pet, in the same
// `pet.json` + spritesheet format the Codex CLI uses (so community packs load
// unmodified). uxnan bundles only its own pets — see `pets.rs`.

/// Resolve `<app-data>` — the root every persisted file hangs off, honouring the
/// `UXNAN_DATA_DIR` override so a disposable profile really is self-contained.
fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map(crate::datadir::resolve)
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))
}

/// Every installed pet (metadata only — sheets are fetched lazily by
/// [`pets_sheet`] so listing a large library stays cheap).
#[tauri::command]
pub async fn pets_list(app: AppHandle) -> Result<Vec<crate::pets::InstalledPet>, CommandError> {
    let dir = app_data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::pets::list(&dir))
        .await
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
        .map_err(CommandError::from)
}

/// One installed pet's spritesheet as an inline `data:<mime>;base64,…` URL.
#[tauri::command]
pub async fn pets_sheet(app: AppHandle, id: String) -> Result<String, CommandError> {
    let dir = app_data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::pets::read_sheet(&dir, &id))
        .await
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
        .map_err(CommandError::from)
}

/// List the pets available for import in `source` — either a folder of pets
/// (e.g. `~/.codex/pets`) or a single pet folder.
#[tauri::command]
pub async fn pets_scan(
    app: AppHandle,
    source: String,
) -> Result<Vec<crate::pets::ImportablePet>, CommandError> {
    let dir = app_data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::pets::scan(&dir, std::path::Path::new(&source)))
        .await
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
        .map_err(CommandError::from)
}

/// Where the Codex CLI keeps its pets, when that folder exists on this machine.
/// `None` simply means "nothing to offer" — the UI hides the shortcut.
#[tauri::command]
pub fn pets_codex_dir() -> Option<String> {
    crate::pets::codex_pets_dir()
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// Import one pet folder. Copies only the manifest and its spritesheet (never a
/// blind directory clone) and records `origin` so the UI can attribute it.
#[tauri::command]
pub async fn pets_import(
    app: AppHandle,
    source: String,
    origin: String,
    overwrite: bool,
) -> Result<crate::pets::InstalledPet, CommandError> {
    let dir = app_data_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        crate::pets::import(&dir, std::path::Path::new(&source), &origin, overwrite)
    })
    .await
    .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
    .map_err(CommandError::from)
}

/// Delete an installed pet (idempotent).
#[tauri::command]
pub async fn pets_delete(app: AppHandle, id: String) -> Result<(), CommandError> {
    let dir = app_data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::pets::delete(&dir, &id))
        .await
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?
        .map_err(CommandError::from)
}

// ---------------------------------------------------------------- pet window
//
// The optional desktop presentation: a borderless, transparent, always-on-top
// window of its own, so the pet stays visible over other apps and while uxnan
// is minimized — like the Codex desktop pet. Opt-in (`PetSettings.overlay`);
// the in-window layer stays the default.
//
// Two hard-won constraints shape this code (both cost a broken round once):
//   • **Capabilities are per window.** The new label needs its own capability
//     file (`capabilities/pet.json`) or `listen`/`emitTo` fail silently inside
//     it and it renders as an empty transparent rectangle.
//   • **The static build has no per-route files.** The window must load
//     `index.html?window=pet` (branched in the root layout), because a
//     SvelteKit route URL resolves in dev via Vite's fallback and 404s in a
//     packaged build.

/// Label of the desktop pet overlay window (also the capability's scope).
pub const PET_WINDOW_LABEL: &str = "pet";

/// A monitor's rectangle in physical px: `(position, size)`.
type MonitorRect = ((i32, i32), (u32, u32));

/// Whether a window of `size` at `pos` (both physical px) would be visible on
/// any of the given monitor rects.
///
/// Pure half of the pet-window placement, split out so the unplugged-monitor
/// case is testable: a saved position that no longer intersects a live monitor
/// must be rejected, or the pet comes back stranded off-screen.
fn rect_on_any_monitor(pos: (i32, i32), size: (i32, i32), monitors: &[MonitorRect]) -> bool {
    monitors.iter().any(|((mx, my), (mw, mh))| {
        pos.0 + size.0 > *mx
            && pos.0 < mx + *mw as i32
            && pos.1 + size.1 > *my
            && pos.1 < my + *mh as i32
    })
}

/// The fallback resting spot: above a monitor's bottom-right corner, with an
/// extra vertical margin that keeps the pet clear of a conventionally-placed
/// taskbar (the monitor API reports full bounds, not the work area).
fn resting_corner(
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
    scale: f64,
    size: (i32, i32),
) -> (i32, i32) {
    let margin = (24.0 * scale) as i32;
    let taskbar = (48.0 * scale) as i32;
    (
        monitor_pos.0 + monitor_size.0 as i32 - size.0 - margin,
        monitor_pos.1 + monitor_size.1 as i32 - size.1 - margin - taskbar,
    )
}

/// Show the desktop pet window, creating it on first use.
///
/// `width`/`height` are logical px (the sprite box plus a little padding);
/// `x`/`y` the last saved position in physical px, used only at creation. A
/// saved position is validated against the live monitors first — a spot on an
/// unplugged display falls back to resting near the primary monitor's
/// bottom-right corner, so the pet can never come back stranded off-screen.
#[tauri::command]
pub async fn pet_window_show(
    app: AppHandle,
    width: f64,
    height: f64,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), CommandError> {
    use tauri::{PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
        let _ = win.show();
        return Ok(());
    }

    // The URL differs by mode and both halves matter: the packaged build has no
    // per-route files, only `index.html` (a route URL 404s there) — while the
    // SvelteKit dev server serves routes only at `/` (`/index.html` 404s there).
    let url = if tauri::is_dev() {
        "/?window=pet"
    } else {
        "index.html?window=pet"
    };
    let win = WebviewWindowBuilder::new(&app, PET_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title("Uxnan Pet")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| CommandError::new("IO_ERROR", e.to_string()))?;

    // Alt+F4 on the pet must not half-close the feature (the setting would stay
    // on with nothing on screen). The Settings switch is the way to dismiss it;
    // app exit destroys the window regardless (see the main-window handler).
    win.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });

    let scale = win.scale_factor().unwrap_or(1.0);
    let (w, h) = ((width * scale) as i32, (height * scale) as i32);
    let saved = match (x, y) {
        (Some(x), Some(y)) => Some(PhysicalPosition::new(x, y)),
        _ => None,
    };
    let on_screen = |p: &PhysicalPosition<i32>| {
        let monitors: Vec<MonitorRect> = app
            .available_monitors()
            .ok()
            .into_iter()
            .flatten()
            .map(|m| {
                let mp = m.position();
                let ms = m.size();
                ((mp.x, mp.y), (ms.width, ms.height))
            })
            .collect();
        rect_on_any_monitor((p.x, p.y), (w, h), &monitors)
    };
    let pos = saved.filter(on_screen).or_else(|| {
        let m = app.primary_monitor().ok().flatten()?;
        let mp = m.position();
        let ms = m.size();
        let (x, y) = resting_corner(
            (mp.x, mp.y),
            (ms.width, ms.height),
            m.scale_factor(),
            (w, h),
        );
        Some(PhysicalPosition::new(x, y))
    });
    if let Some(pos) = pos {
        let _ = win.set_position(pos);
    }
    let _ = win.show();
    Ok(())
}

/// Tear the desktop pet window down (the overlay switch was turned off).
/// `destroy` rather than `close`: close would be swallowed by the
/// prevent-close guard above.
#[tauri::command]
pub fn pet_window_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.destroy();
    }
}

/// Bring the main window to the front. The pet window asks for this when its
/// pet is clicked, right before the main window reveals the agent's terminal —
/// a shortcut is no shortcut if the app stays buried.
#[tauri::command]
pub fn pet_focus_main(app: AppHandle) {
    if let Some(win) = app.get_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
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
    // Workspace this terminal belongs to (the tab's workspace key), used only to
    // attribute the shell's resource cost to its workspace (`resources.rs`).
    workspace: Option<String>,
    // Machine to open it on. Absent or `local` spawns a process here; an
    // `ssh:<hostId>` target opens a channel on that host's live session.
    target: Option<String>,
    // The executable uxnan will type into this terminal once it is ready
    // (`opencode`, `claude`, …) — absent for a plain terminal. It scopes the
    // env-based MCP registrations that must not reach every shell (see
    // `mcpinject::launch_env_all`).
    launching: Option<String>,
    // The tab's persistent session id. A terminal on a host keeps it as its
    // label there, so a tab recreated after a restart finds its terminal again
    // instead of opening a second one (`ssh::terminals`).
    sid: Option<String>,
) -> Result<bool, CommandError> {
    // Remote first, because everything below this line is about spawning a local
    // process: hook coordinates for a local server, WSLENV, resource attribution
    // of a pid. None of it applies to a terminal on another machine, and running
    // it anyway would inject a loopback URL the host cannot reach.
    if let Some(target) = target.as_deref().filter(|t| !t.is_empty() && *t != "local") {
        let host_id = TargetId::parse(target)
            .map_err(CommandError::from)?
            .ssh_host_id()
            .ok_or_else(|| {
                CommandError::from(AppError::Invalid(format!(
                    "{target} is not a machine a terminal can open on"
                )))
            })?
            .to_string();

        let Some(conn) = session_for(&state, &host_id).await else {
            return Err(CommandError::from(AppError::Invalid(
                "connect to this host before opening a terminal on it".to_string(),
            )));
        };

        // Which shell this host starts, asked once per connection. A terminal is
        // placed in its folder by *typing* a `cd`, and the families do not share
        // syntax — assuming cmd is what killed every project terminal on a
        // PowerShell host. An unrecognised shell types nothing at all.
        let shell = host_shell(&state, &host_id, &conn).await;

        // The host's daemon first: a terminal there outlives a dropped
        // connection and an app restart. Where the daemon cannot run (a Windows
        // host, a platform with no build), the terminal is a plain channel on
        // the session instead, as it always was.
        match engine_for(&app, &state, &host_id, &conn, shell).await {
            Ok(engine) => {
                // The tab's id, then — when this app's settings offer them
                // here — the coordinates of its tools as reached on the host,
                // through its engine. The hook coordinates are the engine's
                // own (it adds them); nothing else of this machine's
                // environment means anything there.
                let mut env = vec![("UXNAN_AGENT_ID".to_string(), id.clone())];
                env.extend(host_tool_env(&state, &engine, launching.as_deref()).await);
                let exit_app = app.clone();
                let exit_id = id.clone();
                return state
                    .engine_terminals
                    .create(
                        &host_id,
                        &engine,
                        crate::ssh::terminals::EngineTerminalSpec {
                            id: id.clone(),
                            sid,
                            cwd,
                            env,
                            cols,
                            rows,
                        },
                        remote_terminal_output(&app, &host_id, &id),
                        move || {
                            exit_app.state::<AppState>().agent_changes.notify_waiters();
                            let _ = exit_app.emit(&format!("pty:exit:{exit_id}"), ());
                        },
                    )
                    .await
                    .map_err(CommandError::from);
            }
            Err(why) => crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh-engine",
                &format!("{host_id}: no host engine ({why}); this terminal is a plain channel"),
            ),
        }

        let exit_app = app.clone();
        let exit_id = id.clone();
        return state
            .ssh_pty
            .create(
                &host_id,
                &conn,
                crate::ssh::pty::RemotePtySpec {
                    id: id.clone(),
                    cwd,
                    shell,
                    // An interactive shell, like the local path: the launcher
                    // delivers its command by typing it in afterwards
                    // (`pty_paste_submit`), which works the same either side.
                    command: None,
                    cols,
                    rows,
                },
                remote_terminal_output(&app, &host_id, &id),
                move || {
                    exit_app.state::<AppState>().agent_changes.notify_waiters();
                    let _ = exit_app.emit(&format!("pty:exit:{exit_id}"), ());
                },
            )
            .await
            .map_err(CommandError::from);
    }
    let out_app = app.clone();
    let out_id = id.clone();
    let on_output = move |bytes: &[u8]| {
        let _ = out_app.emit(&format!("pty:output:{out_id}"), bytes.to_vec());
    };
    let exit_app = app.clone();
    let exit_id = id.clone();
    let on_exit = move || {
        exit_app.state::<AppState>().agent_changes.notify_waiters();
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
    // The bundled `uxnan-cli`, on this terminal's PATH and named by UXNAN_CLI,
    // so an agent or a script in it needs nothing installed (`control::cli`).
    if let Some(cli) = crate::control::cli::bundled() {
        env.extend(crate::control::cli::terminal_env(&cli));
    }
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
    let (browser_enabled, allow_agents, mcp_enabled, mcp_disabled) = {
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (
            b.enabled,
            b.allow_agents,
            b.mcp_enabled,
            b.mcp_disabled_agents.clone(),
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

    // The control surface as MCP tools (spec `02d` §1.6): expose the `/mcp`
    // endpoint + token so this terminal's agents can reach it, and register the
    // server **for this launch only** (see `mcpinject.rs`) — nothing is written
    // to any config the user keeps, so an agent started outside uxnan never sees
    // the server at all. Env-registered agents (OpenCode) are covered right here;
    // the flag-registered ones (Claude, Codex) get their arguments appended to
    // the command the frontend types (`$lib/mcpLaunch`), which reads the same
    // switch — so both halves are gated identically, by the agent-tools switch
    // alone: the integrated browser being off takes away the `$BROWSER` shim
    // above, never the catalog (the browser tools then answer *unavailable*).
    if mcp_enabled {
        if let Some(h) = &hook {
            let endpoint = crate::mcpinject::mcp_endpoint(&h.url);
            env.push(("UXNAN_MCP_URL".to_string(), endpoint.clone()));
            env.push((crate::mcpinject::TOKEN_ENV.to_string(), h.token.clone()));
            let disabled: std::collections::HashSet<&str> =
                mcp_disabled.iter().map(String::as_str).collect();
            let opencode_major = crate::agentcli::opencode_major_version().await;
            env.extend(crate::mcpinject::launch_env_all(
                &endpoint,
                &disabled,
                launching.as_deref().filter(|exe| !exe.is_empty()),
                opencode_major,
            ));
        }
        crate::mcpinject::prepare(&app, cwd.as_deref().unwrap_or_default()).await;
    }

    let created = state
        .pty
        .create(
            crate::pty::PtySpec {
                id: id.clone(),
                cwd,
                shell,
                args: args.unwrap_or_default(),
                env,
                cols,
                rows,
                login: false,
            },
            on_output,
            on_exit,
        )
        .map_err(CommandError::from)?;

    // Register the fresh shell with the resource monitor: pid now, start time
    // probed off-thread (fire-and-forget — attribution is best-effort and must
    // never delay the spawn path).
    if created {
        if let Some(pid) = state.pty.pid_of(&id) {
            let monitor = state.resources.clone();
            tauri::async_runtime::spawn(crate::resources::register_terminal_probed(
                monitor, id, pid, workspace,
            ));
        }
    }
    Ok(created)
}

/// Runtime info for the browser MCP: the live `/mcp` endpoint + token (for the
/// Settings copy-paste snippet) and the catalog of agents the ADE registers per
/// launch, each carrying the exact arguments to append to its command line.
/// `endpoint`/`token` are `None` until the hook server is listening.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    pub endpoint: Option<String>,
    pub token: Option<String>,
    pub token_env: String,
    pub server_name: String,
    /// The header a launched agent sends with its terminal id, and the env var
    /// it is expanded from — spelled out in the manual snippet.
    pub agent_id_header: String,
    pub agent_id_env: String,
    pub agents: Vec<crate::mcpinject::AgentInfo>,
}

/// Return the browser MCP server coordinates + per-launch agent catalog. Used by
/// the Settings panel (per-agent toggles + snippet) **and** by the launch path,
/// which appends each agent's `requiredArgs` — and, with the agent tools on,
/// its `args` — to the command it types. The launch path asks again before
/// every launch, so an OpenCode upgraded mid-session is launched the way its
/// new version needs (the version is cached against the binary, so this costs
/// a `stat` when nothing changed). The token is the
/// app's own local loopback secret, surfaced only so the user can copy a
/// ready-to-paste config for an agent the ADE doesn't auto-configure.
#[tauri::command]
pub async fn mcp_info(
    app: AppHandle,
    state: State<'_, AppState>,
    // The machine a launch is for. Absent or `local` is this one; for an
    // `ssh:<hostId>` target the catalog is that host's — its engine's
    // endpoint, the Claude config it wrote there, its OpenCode's version —
    // built by the same code. A host whose engine cannot relay them gets the
    // catalog with nothing to add, so a launch there is typed as it is.
    target: Option<String>,
) -> Result<McpInfo, CommandError> {
    let host = target
        .as_deref()
        .filter(|t| !t.is_empty() && *t != "local")
        .and_then(|t| TargetId::parse(t).ok())
        .and_then(|t| t.ssh_host_id().map(str::to_string));
    if let Some(host) = host {
        let tools = match session_for(&state, &host).await {
            Some(conn) => match state.ssh_engines.current(&host, conn.generation()).await {
                Some(engine) => engine.agent_tools().await,
                None => None,
            },
            None => None,
        };
        let (endpoint, claude_config, opencode_major) = match &tools {
            Some(t) => (
                Some(t.mcp_url.clone()),
                t.claude_config.clone(),
                t.opencode_major,
            ),
            None => (None, None, None),
        };
        return Ok(McpInfo {
            endpoint: endpoint.clone(),
            // The host's token stays with the host's terminals.
            token: None,
            token_env: crate::mcpinject::TOKEN_ENV.to_string(),
            server_name: crate::mcpinject::SERVER_NAME.to_string(),
            agent_id_header: crate::mcpinject::AGENT_ID_HEADER.to_string(),
            agent_id_env: crate::mcpinject::AGENT_ID_ENV.to_string(),
            agents: crate::mcpinject::agent_infos(
                endpoint.as_deref(),
                claude_config.as_deref(),
                opencode_major,
            ),
        });
    }
    let hook = state.hook.read().await.clone();
    let (endpoint, token) = match hook {
        Some(h) => (Some(crate::mcpinject::mcp_endpoint(&h.url)), Some(h.token)),
        None => (None, None),
    };
    // Claude launches with a config file this window owns; make sure it exists
    // before its path is handed out (the flag is dropped when it can't be
    // written, never left pointing at nothing).
    let claude_config = endpoint
        .as_deref()
        .and_then(|e| crate::mcpinject::ensure_claude_config(&app, e));
    Ok(McpInfo {
        endpoint: endpoint.clone(),
        token,
        token_env: crate::mcpinject::TOKEN_ENV.to_string(),
        server_name: crate::mcpinject::SERVER_NAME.to_string(),
        agent_id_header: crate::mcpinject::AGENT_ID_HEADER.to_string(),
        agent_id_env: crate::mcpinject::AGENT_ID_ENV.to_string(),
        agents: crate::mcpinject::agent_infos(
            endpoint.as_deref(),
            claude_config.as_deref(),
            crate::agentcli::opencode_major_version().await,
        ),
    })
}

/// Where a remote terminal's output goes: to its tab, and through the scan for
/// a dev server announcing its address.
///
/// A dev server on the host announces its address the moment it is ready, and
/// that line is already on its way to the terminal — so reading it costs
/// nothing and needs nothing installed there (`crate::portscan`). Only remote
/// terminals are scanned: a local server is already reachable, so announcing it
/// would be noise about nothing.
fn remote_terminal_output<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host_id: &str,
    id: &str,
) -> impl Fn(&[u8]) + Send + Sync + 'static {
    let out_app = app.clone();
    let out_id = id.to_string();
    let announce_host = host_id.to_string();
    let tail = std::sync::Mutex::new(crate::portscan::Tail::default());
    move |bytes: &[u8]| {
        let _ = out_app.emit(&format!("pty:output:{out_id}"), bytes.to_vec());
        let text = String::from_utf8_lossy(bytes);
        // A poisoned lock would mean a panic in this closure, which cannot
        // happen here; either way the terminal's output must not stop because a
        // scan did.
        let found = match tail.lock() {
            Ok(mut tail) => tail.scan(&text),
            Err(_) => Vec::new(),
        };
        for announced in found {
            let _ = out_app.emit(
                "ports:announced",
                AnnouncedPort {
                    host_id: announce_host.clone(),
                    terminal_id: out_id.clone(),
                    port: announced.port,
                    path: announced.path,
                },
            );
        }
    }
}

/// The variables a terminal on a host gets for this app's tools, under the
/// same settings a terminal here does (`pty_create` below): the integrated
/// browser's route and `$BROWSER` shim, and the control surface's MCP server
/// with the env-based registrations — every one of them as reached on the
/// host, through its engine (`HostEngine::agent_tools`).
pub(crate) async fn host_tool_env(
    state: &AppState,
    engine: &ssh::engine::HostEngine,
    launching: Option<&str>,
) -> Vec<(String, String)> {
    let Some(tools) = engine.agent_tools().await else {
        return Vec::new();
    };
    let (browser_enabled, allow_agents, mcp_enabled, mcp_disabled) = {
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (
            b.enabled,
            b.allow_agents,
            b.mcp_enabled,
            b.mcp_disabled_agents.clone(),
        )
    };
    let mut env = Vec::new();
    if browser_enabled && allow_agents {
        env.push(("UXNAN_BROWSER_URL".to_string(), tools.browser_url.clone()));
        env.push(("UXNAN_BROWSER_TOKEN".to_string(), tools.token.clone()));
        if let Some(shim) = &tools.browser_shim {
            env.push(("BROWSER".to_string(), shim.clone()));
        }
    }
    if mcp_enabled {
        env.push(("UXNAN_MCP_URL".to_string(), tools.mcp_url.clone()));
        env.push((crate::mcpinject::TOKEN_ENV.to_string(), tools.token.clone()));
        let disabled: std::collections::HashSet<&str> =
            mcp_disabled.iter().map(String::as_str).collect();
        env.extend(crate::mcpinject::launch_env_all(
            &tools.mcp_url,
            &disabled,
            launching.filter(|exe| !exe.is_empty()),
            tools.opencode_major,
        ));
    }
    env
}

/// What a host's terminals ask of this app's tools — an MCP call, a URL to
/// open — answered by the same code that answers a terminal here, as the tab
/// that shows the terminal. Each call runs on its own: a tool can take a while,
/// and the others need not wait for it.
pub(crate) fn serve_host_tools<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host_id: &str,
    engine: &std::sync::Arc<ssh::engine::HostEngine>,
) {
    let calls = std::sync::Arc::downgrade(engine);
    let (call_app, call_host, call_epoch) =
        (app.clone(), host_id.to_string(), engine.epoch().to_string());
    engine.set_on_mcp(Box::new(move |ticket, session, body| {
        let (app, host, epoch, engine) = (
            call_app.clone(),
            call_host.clone(),
            call_epoch.clone(),
            calls.clone(),
        );
        tauri::async_runtime::spawn(async move {
            let caller = crate::control::Caller::Launch {
                agent_id: host_tab(&app, &host, &epoch, session).await,
            };
            let response =
                crate::control::mcp::handle(&app, caller, body.into_bytes().into()).await;
            let status = response.status().as_u16();
            let body = axum::body::to_bytes(response.into_body(), 32 * 1024 * 1024)
                .await
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default();
            if let Some(engine) = engine.upgrade() {
                engine.answer_mcp(ticket, status, body).await;
            }
        });
    }));
    let (url_app, url_host, url_epoch) =
        (app.clone(), host_id.to_string(), engine.epoch().to_string());
    engine.set_on_url(Box::new(move |session, url| {
        let (app, host, epoch) = (url_app.clone(), url_host.clone(), url_epoch.clone());
        tauri::async_runtime::spawn(async move {
            let agent_id = host_tab(&app, &host, &epoch, session).await;
            let caller = crate::control::Caller::Launch {
                agent_id: agent_id.clone(),
            };
            let workspace = match agent_id {
                Some(_) => crate::control::services::browser::workspace_of(&app, &caller)
                    .await
                    .ok(),
                None => None,
            };
            let url = reached_from_here(&app, &host, url).await;
            let _ = crate::browser::route_url(&app, url, workspace).await;
        });
    }));
}

/// The tab that shows `session` of the engine `epoch` on `host`, waiting a
/// moment for one being registered (a call can follow the screen that
/// reattaches its terminal).
async fn host_tab<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host: &str,
    epoch: &str,
    session: u32,
) -> Option<String> {
    let state = app.state::<AppState>();
    for _ in 0..20 {
        if let Some(tab) = state.engine_terminals.tab_for(host, epoch, session).await {
            return Some(tab);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    None
}

/// A URL a terminal on `host` asked to open, as this machine reaches it: one on
/// the host's own loopback (`localhost:5173`, a dev server there) is brought
/// here over the connection the host already has, as the ports indicator's
/// "Open" does; any other is the same URL from here.
async fn reached_from_here<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host: &str,
    url: String,
) -> String {
    let Some((port, rest)) = host_loopback_port(&url) else {
        return url;
    };
    let state = app.state::<AppState>();
    let Some(conn) = session_for(&state, host).await else {
        return url;
    };
    match state.ssh_forwards.open(host, &conn, port, &[]).await {
        Ok(forward) => format!("http://127.0.0.1:{}{rest}", forward.local_port),
        Err(_) => url,
    }
}

/// `(port, everything after it)` when `url` is plain HTTP on the loopback of
/// the machine it was made on.
fn host_loopback_port(url: &str) -> Option<(u16, &str)> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (name, port) = authority.rsplit_once(':')?;
    let loopback = matches!(name, "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]");
    if !loopback {
        return None;
    }
    Some((port.parse().ok()?, path))
}

/// Which agent a host's terminals run, as its engine sees it (layer 3 there),
/// told to the window exactly as this machine's own watch tells it
/// (`agent:detected`), under the tab that shows the terminal now. The engine
/// is asked to look for the agents this app knows, and told again whenever
/// that list changes (`set_agent_commands`).
fn forward_host_agents<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host_id: &str,
    engine: &std::sync::Arc<ssh::engine::HostEngine>,
) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(u32, Option<String>)>();
    engine.set_on_agent(Box::new(move |session, command| {
        let _ = tx.send((session, command));
    }));
    let host = host_id.to_string();
    let epoch = engine.epoch().to_string();
    let emitter = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((session, command)) = rx.recv().await {
            let state = emitter.state::<AppState>();
            // Sent right after the screen that reattaches a terminal — a
            // moment before its tab is registered.
            let mut tab = None;
            for _ in 0..20 {
                tab = state.engine_terminals.tab_for(&host, &epoch, session).await;
                if tab.is_some() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            if let Some(pty_id) = tab {
                let _ = emitter.emit("agent:detected", AgentDetectedEvent { pty_id, command });
            }
        }
    });
    let asking = std::sync::Arc::clone(engine);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let commands = app.state::<AppState>().agent_commands.read().await.clone();
        if let Err(e) = asking.watch_agents(commands).await {
            crate::diagnostics::log(
                crate::diagnostics::Level::Warn,
                "ssh-engine",
                &format!("could not ask the host engine which agents run: {e}"),
            );
        }
    });
}

/// A host's agent reports, fed — one at a time, in order — to the same reader
/// as this machine's (`hooks::handle_report`), under the tab that shows the
/// terminal now. That tab is found by the terminal's session, not by the id the
/// terminal was started with: the tab's id changes when the app restarts, the
/// terminal (and the agent's environment in it) does not.
fn forward_host_reports<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host_id: &str,
    engine: &std::sync::Arc<ssh::engine::HostEngine>,
) {
    use axum::http::{HeaderMap, HeaderName, HeaderValue};
    let (tx, mut rx) =
        tokio::sync::mpsc::unbounded_channel::<(u32, Vec<(String, String)>, String)>();
    engine.set_on_hook(Box::new(move |session, headers, body| {
        let _ = tx.send((session, headers, body));
    }));
    let app = app.clone();
    let host = host_id.to_string();
    let epoch = engine.epoch().to_string();
    // Weak: the engine holds this task's sender, and the task must end with
    // the engine rather than keep it alive.
    let transcripts = std::sync::Arc::downgrade(engine);
    let ask: crate::hooks::TranscriptAsk = std::sync::Arc::new(move |kind, path| {
        let engine = transcripts.upgrade();
        Box::pin(async move {
            match engine {
                Some(engine) => engine.transcript_preview(kind, path).await,
                None => (None, None),
            }
        })
    });
    tauri::async_runtime::spawn(async move {
        while let Some((session, headers, body)) = rx.recv().await {
            let state = app.state::<AppState>();
            // A report held while nobody watched arrives right after the screen
            // that reattaches its terminal — a moment before the tab is
            // registered.
            let mut tab = None;
            for _ in 0..20 {
                tab = state.engine_terminals.tab_for(&host, &epoch, session).await;
                if tab.is_some() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            let Some(tab) = tab else {
                continue;
            };
            let Ok(tab) = HeaderValue::from_str(&tab) else {
                continue;
            };
            let mut map = HeaderMap::new();
            for (name, value) in headers {
                if name == "x-uxnan-agent-id" || !name.starts_with("x-uxnan-") {
                    continue;
                }
                if let (Ok(name), Ok(value)) = (
                    HeaderName::from_bytes(name.as_bytes()),
                    HeaderValue::from_str(&value),
                ) {
                    map.insert(name, value);
                }
            }
            map.insert(HeaderName::from_static("x-uxnan-agent-id"), tab);
            crate::hooks::handle_report(
                &app,
                map,
                body.into_bytes().into(),
                crate::hooks::ReportOrigin::Host(std::sync::Arc::clone(&ask)),
            )
            .await;
        }
    });
}

/// The host's daemon for this connection, started (and installed) when it is
/// not running yet. One started now is watched, so its terminals are told —
/// and kept — when the connection under it goes away.
/// Which shell `host_id` starts, asked once per connection and remembered.
async fn host_shell(
    state: &AppState,
    host_id: &str,
    conn: &ssh::conn::Connection,
) -> ssh::shellkind::ShellKind {
    let known = state.ssh_shells.read().await.get(host_id).copied();
    match known {
        Some(kind) => kind,
        None => {
            let kind = crate::ssh::shellkind::classify(conn).await;
            state
                .ssh_shells
                .write()
                .await
                .insert(host_id.to_string(), kind);
            kind
        }
    }
}

/// The engine of a connected host — started (and installed) if no terminal
/// started it yet, as the first terminal there would. `None` for a host that is
/// not connected or where the engine cannot run.
pub(crate) async fn connected_engine<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    host_id: &str,
) -> Option<std::sync::Arc<ssh::engine::HostEngine>> {
    let conn = session_for(state, host_id).await?;
    let shell = host_shell(state, host_id, &conn).await;
    engine_for(app, state, host_id, &conn, shell).await.ok()
}

/// One connected host's agents, as its engine reports them — for Settings →
/// Agents → Hooks, asked only for the host the panel is showing, so a long list
/// of hosts costs nothing until one is picked.
#[tauri::command]
pub async fn host_hooks(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<Vec<agent_hooks::HookAgentEntry>, CommandError> {
    let Some(engine) = connected_engine(&app, &state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    engine.hooks_status().await.map_err(CommandError::from)
}

/// Install (`on`) or remove one agent's reporter on a host, by its engine.
#[tauri::command]
pub async fn host_hook_set(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    agent: String,
    on: bool,
) -> Result<AgentHooksStatus, CommandError> {
    let Some(engine) = connected_engine(&app, &state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    engine
        .set_hook(&agent, on)
        .await
        .map_err(CommandError::from)
}

/// Exactly what the installer writes for one agent on a host.
#[tauri::command]
pub async fn host_hook_config(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    agent: String,
) -> Result<String, CommandError> {
    let Some(engine) = connected_engine(&app, &state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    engine.hook_config(&agent).await.map_err(CommandError::from)
}

async fn engine_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    host_id: &str,
    conn: &std::sync::Arc<ssh::conn::Connection>,
    shell: ssh::shellkind::ShellKind,
) -> Result<std::sync::Arc<ssh::engine::HostEngine>, AppError> {
    let (engine, fresh) = state
        .ssh_engines
        .get_or_start(host_id, conn, shell, async {
            sftp_for(state, host_id)
                .await
                .map_err(|e| AppError::Invalid(e.message))
        })
        .await?;
    if fresh {
        let emit_app = app.clone();
        let target = format!("ssh:{host_id}");
        engine.set_on_changed(Box::new(move |root, paths, overflow, git| {
            // An overflow lists nothing; reporting the root makes the tree
            // reload what it shows from the top.
            let paths = if overflow { vec![root.clone()] } else { paths };
            let _ = emit_app.emit(
                "fs:changed",
                crate::fswatch::FsChangedEvent {
                    root,
                    paths,
                    target: target.clone(),
                    git,
                },
            );
        }));
        forward_host_reports(app, host_id, &engine);
        forward_host_agents(app, host_id, &engine);
        serve_host_tools(app, host_id, &engine);
        if state.data.read().await.settings.auto_install_hooks {
            let wiring = std::sync::Arc::clone(&engine);
            let host = host_id.to_string();
            tauri::async_runtime::spawn(async move {
                let (level, message) = match wiring.wire_hooks().await {
                    Ok(agents) if agents.is_empty() => (
                        crate::diagnostics::Level::Info,
                        format!("{host}: no agent there to wire hooks for"),
                    ),
                    Ok(agents) => (
                        crate::diagnostics::Level::Info,
                        format!("{host}: agent hooks wired for {}", agents.join(", ")),
                    ),
                    Err(e) => (
                        crate::diagnostics::Level::Warn,
                        format!("{host}: could not wire agent hooks: {e}"),
                    ),
                };
                crate::diagnostics::log(level, "ssh-engine", &message);
            });
        }
        // The host's own bridge, if its account runs one: linked through this
        // engine, and gone with it (`bridgeclient::hosts`).
        {
            let app = app.clone();
            let bridges = std::sync::Arc::clone(&state.host_bridges);
            let conn = std::sync::Arc::clone(conn);
            let engine = std::sync::Arc::clone(&engine);
            let host = host_id.to_string();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let home = match sftp_for(&state, &host).await {
                    Ok(files) => files.home().await.ok(),
                    Err(_) => None,
                };
                let Some(home) = home else {
                    crate::diagnostics::log(
                        crate::diagnostics::Level::Info,
                        "bridge",
                        &format!("{host}: its home is unknown, so its bridge is not looked for"),
                    );
                    return;
                };
                crate::bridgeclient::hosts::link(app.clone(), bridges, host, conn, engine, home);
            });
        }
        let terminals = std::sync::Arc::clone(&state.engine_terminals);
        let watched = std::sync::Arc::clone(&engine);
        let host = host_id.to_string();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            watched.lost().await;
            terminals.detach_host(&host, watched.epoch()).await;
            // The engine went quiet while the connection under it still looks
            // up — a half-open link. Hang that connection up, so the session
            // watcher sees it end and the reconnect ladder brings the host (and
            // these terminals) back, instead of waiting minutes for the SSH
            // keepalive to reach the same verdict.
            let state = app.state::<AppState>();
            if let Some(conn) = session_for(&state, &host).await {
                if conn.generation() == watched.generation() && !conn.handle().is_closed() {
                    let _ = conn
                        .handle()
                        .disconnect(
                            russh::Disconnect::ByApplication,
                            "the link stopped answering",
                            "",
                        )
                        .await;
                }
            }
        });
    }
    Ok(engine)
}

/// A host's connection, step by step, for the host page's check: the way
/// there, whether it answers, its key, the sign-in, the shell, the engine and
/// the round trip (`ssh::doctor`). Never signs in to find out: a host that is
/// not connected says so, and the steps that need a session wait for one.
#[tauri::command]
pub async fn ssh_host_doctor(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<ssh::doctor::HostDoctor, CommandError> {
    let host = state
        .data
        .read()
        .await
        .settings
        .ssh_hosts
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("host {host_id}"))))?;
    let mut doctor = ssh::doctor::HostDoctor::default();
    ssh::doctor::route_facts(&host, &mut doctor).await;
    let shell = state.ssh_shells.read().await.get(&host_id).copied();
    doctor.shell = shell.map(|s| s.as_str().to_string());
    let Some(conn) = session_for(&state, &host_id)
        .await
        .filter(|c| !c.handle().is_closed())
    else {
        return Ok(doctor);
    };
    doctor.connected = true;
    match engine_for(&app, &state, &host_id, &conn, shell.unwrap_or_default()).await {
        Ok(engine) => {
            let welcome = engine.welcome();
            doctor.engine = Some(ssh::doctor::DoctorEngine {
                version: welcome.version.clone(),
                protocol: welcome.protocol,
                os: welcome.os.clone(),
                arch: welcome.arch.clone(),
            });
            let started = std::time::Instant::now();
            if engine.list().await.is_ok() {
                doctor.round_trip_ms = Some(started.elapsed().as_millis() as u64);
            }
        }
        Err(e) => doctor.engine_error = Some(e.to_string()),
    }
    Ok(doctor)
}

/// One terminal the host's engine holds, as the host page lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSession {
    pub session: u32,
    pub label: String,
    pub cwd: String,
    pub alive: bool,
    /// An age, never a timestamp: the two machines' clocks do not agree.
    pub started_ago_ms: u64,
    /// The tab of this window that shows it, if one does — `None` for one a
    /// previous run of the app left there, or another app opened.
    pub tab: Option<String>,
}

/// The host's own bridge as its engine sees it: Node and npm there, what is
/// installed (the user's own or Uxnan's), whether it runs and who keeps it
/// running (`02g` §5.18).
#[tauri::command]
pub async fn host_bridge_status(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<uxnan_host_protocol::BridgeState, CommandError> {
    let Some(engine) = connected_engine(&app, &state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    engine
        .bridge(uxnan_host_protocol::BridgeCall::Status)
        .await
        .map_err(CommandError::from)
}

/// Install (or update) the bridge into the host account's own folder, then
/// have the engine keep it running and look for it at once. Fenced: it
/// changes that machine.
#[tauri::command]
pub async fn host_bridge_install(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    expect: Option<TargetExpectation>,
) -> Result<uxnan_host_protocol::BridgeInstalled, CommandError> {
    let engine = host_engine_fenced(&app, &state, &host_id, expect.as_ref()).await?;
    let installed: uxnan_host_protocol::BridgeInstalled = engine
        .bridge(uxnan_host_protocol::BridgeCall::Install)
        .await
        .map_err(CommandError::from)?;
    if installed.ok {
        let _: uxnan_host_protocol::BridgeState = engine
            .bridge(uxnan_host_protocol::BridgeCall::Supervise { on: true })
            .await
            .map_err(CommandError::from)?;
        state.host_bridges.retry(&host_id).await;
    }
    Ok(installed)
}

/// Whether the host's engine keeps its bridge running. Fenced.
#[tauri::command]
pub async fn host_bridge_supervise(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    on: bool,
    expect: Option<TargetExpectation>,
) -> Result<uxnan_host_protocol::BridgeState, CommandError> {
    let engine = host_engine_fenced(&app, &state, &host_id, expect.as_ref()).await?;
    let standing = engine
        .bridge(uxnan_host_protocol::BridgeCall::Supervise { on })
        .await
        .map_err(CommandError::from)?;
    state.host_bridges.retry(&host_id).await;
    Ok(standing)
}

/// Open (or close) the host bridge's LAN listener on that machine's network.
/// Off by default; opening it publishes a port there, which is the owner's
/// decision. A bridge the engine runs is restarted to take it. Fenced.
#[tauri::command]
pub async fn host_bridge_set_lan(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    on: bool,
    expect: Option<TargetExpectation>,
) -> Result<uxnan_host_protocol::BridgeState, CommandError> {
    let engine = host_engine_fenced(&app, &state, &host_id, expect.as_ref()).await?;
    let standing = engine
        .bridge(uxnan_host_protocol::BridgeCall::SetLan { on })
        .await
        .map_err(CommandError::from)?;
    state.host_bridges.retry(&host_id).await;
    Ok(standing)
}

/// A connected host's engine, for a call that changes that machine: refused
/// unless the caller's expectation still names this connection.
async fn host_engine_fenced(
    app: &AppHandle,
    state: &AppState,
    host_id: &str,
    expect: Option<&TargetExpectation>,
) -> Result<std::sync::Arc<ssh::engine::HostEngine>, CommandError> {
    match machine_for(app, state, Some(&format!("ssh:{host_id}")), Some(expect)).await? {
        Machine::Host(engine) => Ok(engine),
        Machine::Here => Err(CommandError::from(AppError::Invalid(format!(
            "{host_id} is not a host"
        )))),
    }
}

/// The terminals a connected host's engine holds, newest first — including
/// ones no tab of this window shows.
#[tauri::command]
pub async fn ssh_host_sessions(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<Vec<HostSession>, CommandError> {
    let Some(engine) = connected_engine(&app, &state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    engine_sessions(&state, &host_id, &engine)
        .await
        .map_err(CommandError::from)
}

/// What `engine` holds, each with the tab of this window that shows it — the
/// one listing the host page and `host/show` both read.
pub(crate) async fn engine_sessions(
    state: &AppState,
    host_id: &str,
    engine: &ssh::engine::HostEngine,
) -> Result<Vec<HostSession>, AppError> {
    let listed = engine.list().await?;
    let mut sessions = Vec::with_capacity(listed.len());
    for s in listed {
        let tab = state
            .engine_terminals
            .tab_for(host_id, engine.epoch(), s.session)
            .await;
        sessions.push(HostSession {
            session: s.session,
            label: s.label,
            cwd: s.cwd,
            alive: s.alive,
            started_ago_ms: s.started_ago_ms,
            tab,
        });
    }
    sessions.sort_by_key(|s| s.started_ago_ms);
    Ok(sessions)
}

/// End one terminal a host's engine holds — its program, and with it whatever
/// ran there. Fenced: it cannot be taken back.
#[tauri::command]
pub async fn ssh_host_session_end(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    session: u32,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(
        &app,
        &state,
        Some(&format!("ssh:{host_id}")),
        Some(expect.as_ref()),
    )
    .await?
    {
        Machine::Host(engine) => engine.close(session).await.map_err(CommandError::from),
        Machine::Here => Err(CommandError::from(AppError::Invalid(format!(
            "{host_id} is not a host"
        )))),
    }
}

/// The running daemon of the host a tab's terminal lives on, if the host is
/// connected now.
async fn engine_of_tab(
    state: &AppState,
    id: &str,
) -> Option<std::sync::Arc<ssh::engine::HostEngine>> {
    let host_id = state.engine_terminals.host_of(id).await?;
    let conn = session_for(state, &host_id).await?;
    state.ssh_engines.current(&host_id, conn.generation()).await
}

/// A host just connected: watch its project folder again if the file tree
/// follows one there, and give back the terminals that were waiting for it.
async fn host_came_back<R: tauri::Runtime>(app: AppHandle<R>, host_id: String) {
    let state = app.state::<AppState>();
    arm_remote_watch(&app, &state, &host_id).await;
    if !state.engine_terminals.waiting_on(&host_id).await {
        return;
    }
    let Some(conn) = session_for(&state, &host_id).await else {
        return;
    };
    let Some(shell) = state.ssh_shells.read().await.get(&host_id).copied() else {
        return;
    };
    match engine_for(&app, &state, &host_id, &conn, shell).await {
        Ok(engine) => {
            state
                .engine_terminals
                .reattach_host(&host_id, &engine)
                .await
        }
        Err(why) => crate::diagnostics::log(
            crate::diagnostics::Level::Info,
            "ssh-engine",
            &format!("{host_id} is back but its host engine is not ({why})"),
        ),
    }
}

/// Send user input to a PTY's stdin.
#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), CommandError> {
    if state.engine_terminals.owns(&id).await {
        let engine = engine_of_tab(&state, &id).await;
        return state
            .engine_terminals
            .write(engine.as_deref(), &id, data.into_bytes())
            .await
            .map_err(CommandError::from);
    }
    if state.ssh_pty.owns(&id).await {
        return state
            .ssh_pty
            .write(&id, data.as_bytes())
            .await
            .map_err(CommandError::from);
    }
    state.pty.write(&id, &data).map_err(CommandError::from)
}

/// Delay between delivering input and submitting it, so the TUI ingests it before
/// the Enter arrives as a *separate* event (see below).
const PASTE_SUBMIT_DELAY_MS: u64 = 50;

/// Longer gap before Enter for a **multi-line** (bracketed) paste: some TUIs
/// (Claude Code-family agents, Codex) briefly *guard* the Enter right after a
/// paste — to stop an accidental multi-line submit — so a too-quick Enter is
/// swallowed and the text is left in the composer. This gives that guard time to
/// clear. 150 ms was swallowed by Codex's guard (the first message of a launched
/// worker sat unsent); 400 ms submits it on every driven agent.
const BRACKETED_SUBMIT_DELAY_MS: u64 = 400;

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
// coding TUI — Claude Code, Codex, OpenCode, Pi, Antigravity — does). A multi-line
// submit into an agent with a post-paste Enter guard *longer* than
// `BRACKETED_SUBMIT_DELAY_MS` would still not fire; if one is found, add a
// per-agent submit strategy (delay / key) here. See FOR-DEV.md.
#[tauri::command]
pub async fn pty_paste_submit(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<(), CommandError> {
    let multiline = text.contains('\n') || text.contains('\r');
    let payload = pty_submit_payload(&text);
    let delay = if multiline {
        BRACKETED_SUBMIT_DELAY_MS
    } else {
        PASTE_SUBMIT_DELAY_MS
    };
    // A terminal on a host takes the same two writes, on its own channel. This
    // branch was missing while `pty_write`, `pty_resize` and `pty_close` all had
    // one, so every paste-and-submit aimed at a remote agent went to the local
    // manager, which does not know that id: the run engine, the orchestration
    // broadcast and mid-turn delivery each silently did nothing over SSH.
    if state.engine_terminals.owns(&id).await {
        let engine = engine_of_tab(&state, &id).await;
        state
            .engine_terminals
            .write(engine.as_deref(), &id, payload.into_bytes())
            .await
            .map_err(CommandError::from)?;
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        return state
            .engine_terminals
            .write(engine.as_deref(), &id, b"\r".to_vec())
            .await
            .map_err(CommandError::from);
    }
    if state.ssh_pty.owns(&id).await {
        state
            .ssh_pty
            .write(&id, payload.as_bytes())
            .await
            .map_err(CommandError::from)?;
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        return state
            .ssh_pty
            .write(&id, b"\r")
            .await
            .map_err(CommandError::from);
    }
    state.pty.write(&id, &payload).map_err(CommandError::from)?;
    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    state.pty.write(&id, "\r").map_err(CommandError::from)?;
    Ok(())
}

/// Return the subset of `commands` that are installed. Used by the Settings
/// agent catalog to enable only the agents actually present on the machine. A
/// known agent CLI is found with the rule shared with the bridge
/// (`agentcli::command_installed` — npm installs `PATH` does not show
/// included); any other command by `PATH` (+ `PATHEXT`).
#[tauri::command]
pub async fn agents_detect(commands: Vec<String>) -> Result<Vec<String>, CommandError> {
    Ok(commands
        .into_iter()
        .filter(|c| crate::agentcli::command_installed(c))
        .collect())
}

/// Resize a PTY when its pane changes size.
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    if state.engine_terminals.owns(&id).await {
        let engine = engine_of_tab(&state, &id).await;
        return state
            .engine_terminals
            .resize(engine.as_deref(), &id, cols, rows)
            .await
            .map_err(CommandError::from);
    }
    if state.ssh_pty.owns(&id).await {
        return state
            .ssh_pty
            .resize(&id, cols, rows)
            .await
            .map_err(CommandError::from);
    }
    state
        .pty
        .resize(&id, cols, rows)
        .map_err(CommandError::from)
}

/// Kill a PTY's process and drop the session (idempotent).
#[tauri::command]
pub async fn pty_close(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    // Snapshot the terminal's last-known members first, so a subtree that
    // survives the kill shows up as an orphan on the next resource sample.
    if state.engine_terminals.owns(&id).await {
        // Ends the terminal on the host — or, when the host is away, as soon as
        // it is back, so nothing is left running there by accident.
        let engine = engine_of_tab(&state, &id).await;
        return state
            .engine_terminals
            .close(engine.as_deref(), &id)
            .await
            .map_err(CommandError::from);
    }
    if state.ssh_pty.owns(&id).await {
        // No local process tree to account for: this terminal never had one.
        return state.ssh_pty.close(&id).await.map_err(CommandError::from);
    }
    state
        .resources
        .terminal_closed(&id, crate::resources::now_ms());
    state.pty.close(&id).map_err(CommandError::from)
}

/// Close the agent a terminal runs, and only it: the shell and the tab stay.
/// Used when the terminal hands its agent's session over to a chat — here or
/// on the phone (architecture/02a §5.8.19). Returns once the agent is gone.
#[tauri::command]
pub async fn pty_stop_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::agentstop::StopOutcome, CommandError> {
    let commands = state.agent_commands.read().await.clone();
    // A terminal on a host: its engine closes the agent there, with the same
    // code this machine runs below.
    if state.engine_terminals.owns(&id).await {
        let engine = engine_of_tab(&state, &id).await;
        return state
            .engine_terminals
            .stop_agent(engine.as_deref(), &id, commands)
            .await
            .map_err(CommandError::from);
    }
    let Some(shell_pid) = state.pty.pid_of(&id) else {
        return Err(CommandError::from(AppError::NotFound(format!(
            "terminal {id}"
        ))));
    };
    tokio::task::spawn_blocking(move || {
        crate::agentstop::stop_agent(shell_pid, &commands, crate::agentstop::EXIT_GRACE)
    })
    .await
    .map_err(|e| CommandError::new("INTERNAL", e.to_string()))
}

// --- Remote hosts (SSH) ----------------------------------------------------

/// List the `Host` aliases in the user's own OpenSSH configuration, so adding a
/// remote host is picking one rather than retyping what they already wrote.
///
/// Read-only and connectionless. An absent config file is an empty list, not an
/// error: plenty of users have none.
#[tauri::command]
pub async fn ssh_config_hosts() -> Result<Vec<ssh::config::ConfigAlias>, CommandError> {
    let Some(path) = ssh::config::default_config_path() else {
        return Ok(Vec::new());
    };
    Ok(ssh::config::enumerate(&path))
}

/// Resolve one alias to the settings OpenSSH would actually use, by asking
/// `ssh -G` rather than reimplementing its precedence rules (`Match` blocks,
/// pattern order, per-user defaults). Getting those subtly wrong would mean
/// connecting somewhere the user's own `ssh` would not.
#[tauri::command]
pub async fn ssh_config_resolve(alias: String) -> Result<ssh::config::ResolvedHost, CommandError> {
    ssh::config::resolve(&alias)
        .await
        .map_err(CommandError::from)
}

/// The registered remote machines.
#[tauri::command]
pub async fn ssh_hosts_list(state: State<'_, AppState>) -> Result<Vec<SshHost>, CommandError> {
    Ok(state.data.read().await.settings.ssh_hosts.clone())
}

/// What adding a host did. `recovered` matters to the user: it means projects
/// they thought were gone came back with the id, and saying so is better than
/// having them reappear unannounced.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostAdded {
    pub host: SshHost,
    pub recovered: bool,
    pub updated_existing: bool,
}

/// Register a machine (or update the one already registered for it).
///
/// Ids are minted here and nowhere else: the frontend sends a description, never
/// an id, so there is no way for the UI to overwrite a record by guessing one.
#[tauri::command]
pub async fn ssh_host_add(
    state: State<'_, AppState>,
    draft: ssh::registry::HostDraft,
) -> Result<SshHostAdded, CommandError> {
    if draft.hostname.trim().is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "a host needs a hostname".to_string(),
        )));
    }
    let mut data = state.data.write().await;
    let settings = &mut data.settings;
    let outcome = ssh::registry::add_host(
        &mut settings.ssh_hosts,
        &mut settings.removed_ssh_hosts,
        draft,
        || Uuid::new_v4().to_string(),
    );
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(SshHostAdded {
        host: outcome.host,
        recovered: outcome.recovered,
        updated_existing: outcome.updated_existing,
    })
}

/// Forget a machine, remembering enough to give its projects back if it returns.
/// Idempotent — removing an unknown id answers `false` rather than failing.
#[tauri::command]
pub async fn ssh_host_remove(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut data = state.data.write().await;
    let settings = &mut data.settings;
    let removed = ssh::registry::remove_host(
        &mut settings.ssh_hosts,
        &mut settings.removed_ssh_hosts,
        &host_id,
        now,
    )
    .is_some();
    if removed {
        state.persistence.save(&data).map_err(CommandError::from)?;
    }
    Ok(removed)
}

/// Record the key the host just presented, after the person confirmed its
/// fingerprint.
///
/// Only ever appends the key **this app watched the server present**, for a
/// host whose last connect stopped at "unknown" — on whichever hop of its route
/// presented it — and only into the `known_hosts` file that hop's configuration
/// names. A key that *replaces* one on file is never recorded from here: that
/// is [`ssh_host_replace_key`], a separate and deliberate act.
#[tauri::command]
pub async fn ssh_host_trust(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    let pending = take_pending_key(&state, &host_id, false).await?;
    ssh::dial::record_key(&pending.pending).map_err(CommandError::from)?;
    Ok(true)
}

/// Replace the key on file for a host whose key changed, after the person
/// confirmed the change is theirs (the machine was reinstalled, its keys
/// regenerated).
///
/// The stale entries are backed up to `known_hosts.old` and only they go: the
/// same name, port and algorithm. The alternative the interface used to offer —
/// nothing, edit the file yourself — left people deleting whole lines of a file
/// they could not read, which is how a real warning gets dismissed next time.
#[tauri::command]
pub async fn ssh_host_replace_key(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    let pending = take_pending_key(&state, &host_id, true).await?;
    let removed = ssh::dial::replace_key(&pending.pending).map_err(CommandError::from)?;
    crate::diagnostics::log(
        crate::diagnostics::Level::Info,
        "ssh",
        &format!(
            "replaced {removed} known_hosts entr{} for {} with {}",
            if removed == 1 { "y" } else { "ies" },
            pending.hop,
            pending.pending.fingerprint()
        ),
    );
    Ok(true)
}

/// The key a host's last connect stopped on, if it is the kind of decision the
/// caller is about to make.
async fn take_pending_key(
    state: &AppState,
    host_id: &str,
    changed: bool,
) -> Result<ssh::PendingHostKey, CommandError> {
    let mut pending = state.ssh_pending_keys.write().await;
    match pending.get(host_id) {
        Some(p) if p.changed == changed => Ok(pending.remove(host_id).expect("just found")),
        _ => Err(CommandError::from(AppError::Invalid(if changed {
            "no changed host key is awaiting replacement for this host".to_string()
        } else {
            "no host key is awaiting confirmation for this host".to_string()
        }))),
    }
}

/// The result of trying to open a working session on a host.
///
/// One shape for every outcome, because each one sends the user somewhere
/// different and "it failed" sends them nowhere.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectReport {
    /// `connected` | `hostUnknown` | `hostChanged` | `hostRevoked` |
    /// `needsPassword` | `needsPassphrase` | `needsAnswers` | `failed` |
    /// `noUsableMethod` | `unreachable` | `proxyFailed`.
    pub status: String,
    /// For `unreachable`: which kind of not-reachable it was (`timeout` |
    /// `unknownAddress` | `refused` | `handshake`). They lead to different
    /// actions — a machine that is asleep is worth another try, a name that does
    /// not resolve is not — and one failure string made them look alike.
    pub reason: Option<ssh::conn::Unreachable>,
    /// A sentence naming the host and what happened, for `unreachable` and
    /// `proxyFailed`.
    pub detail: Option<String>,
    /// The connection incarnation, for `connected`. Travels with every mutation
    /// prepared against this session (`target::TargetExpectation`).
    pub generation: Option<u64>,
    /// Which credential worked, so the UI can say how you got in.
    pub method: Option<String>,
    /// For the host-key outcomes.
    pub fingerprint: Option<String>,
    pub stored_fingerprint: Option<String>,
    /// For `hostUnknown`: the configuration says `StrictHostKeyChecking yes`,
    /// so a new key cannot be trusted from here — only shown.
    pub strict: bool,
    /// For `needsPassphrase`: which key file needs one.
    pub path: Option<String>,
    /// For `needsPassphrase`: one was given and it did not open the key.
    pub wrong: bool,
    /// What was offered and refused, in order, so the message can name it.
    pub attempted: Vec<String>,
    /// For `needsAnswers`: the questions, as the server asked them.
    pub challenge: Option<ssh::auth::Challenge>,
    /// Which hop the outcome is about, when it is a **bastion** on the way and
    /// not the host itself ("the bastion wants a password").
    pub hop: Option<String>,
    /// The identity of the hop that asked, to send its secret back with
    /// (`user@hostname:port`). Set on every outcome that is about a hop.
    pub hop_key: Option<String>,
    /// Hosts whose new key was recorded without asking (`StrictHostKeyChecking
    /// accept-new`), as `label → fingerprint`, for `connected`.
    pub learned_keys: Vec<(String, String)>,
    /// Which shell this host starts (`posix` | `cmd` | `powershell` |
    /// `unknown`), for `connected`. The interface needs it to quote an agent's
    /// command line for the shell that will actually receive it — quoting for
    /// *this* machine's shell is how a launch lands in a dead pane.
    pub shell: Option<String>,
}

impl SshConnectReport {
    fn of(status: &str) -> Self {
        Self {
            status: status.to_string(),
            reason: None,
            detail: None,
            shell: None,
            generation: None,
            method: None,
            fingerprint: None,
            stored_fingerprint: None,
            strict: false,
            path: None,
            wrong: false,
            attempted: Vec::new(),
            challenge: None,
            hop: None,
            hop_key: None,
            learned_keys: Vec::new(),
        }
    }

    fn about(status: &str, hop: &ssh::dial::HopRef) -> Self {
        let mut report = Self::of(status);
        report.hop = (!hop.is_target).then(|| hop.label.clone());
        report.hop_key = Some(hop.key.clone());
        report
    }
}

/// Something the person typed for one hop of a host's route. Deliberately has
/// no `Debug`: it carries the secret itself.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSecret {
    /// `password` | `passphrase`.
    pub kind: String,
    /// The hop it is for, as the report that asked named it (`hopKey`).
    pub hop_key: String,
    /// For a passphrase: the key file it opens.
    pub path: Option<String>,
    pub value: String,
}

/// How long a connection paused on a second factor waits for the answers. A
/// server's own login grace time is typically two minutes; past it the server
/// has hung up anyway.
const CHALLENGE_TTL: std::time::Duration = std::time::Duration::from_secs(180);

/// Open an authenticated session on a host and keep it.
///
/// Idempotent: a host that already has a live session reports it rather than
/// opening a second one. Everything that runs on the host — terminal, inventory,
/// git — shares this connection, which is the point of an in-process client.
///
/// `secret` is supplied on a retry, after the app asked for a password or a
/// passphrase. It is kept in memory for the app's session (`ssh::secrets`) so a
/// dropped connection can come back without asking again — never on disk.
#[tauri::command]
pub async fn ssh_host_connect<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    host_id: String,
    secret: Option<SshSecret>,
) -> Result<SshConnectReport, CommandError> {
    // An existing session is only worth keeping while its transport is up. One
    // that has ended answers nothing and can open no channel, so reporting it as
    // connected would leave the user pressing Connect on a host that is already
    // "connected" and still broken. Let it go instead, and reach the machine
    // again below — with everything that was learned from the old connection.
    // `Some(Some(generation))` is a session still up; `Some(None)`, one that has
    // ended; `None`, a host with no session at all.
    let existing = {
        let sessions = state.ssh_sessions.read().await;
        sessions
            .get(&host_id)
            .map(|conn| (!conn.handle().is_closed()).then(|| conn.generation()))
    };
    match existing {
        Some(Some(generation)) => {
            let mut report = SshConnectReport::of("connected");
            report.generation = Some(generation);
            return Ok(report);
        }
        Some(None) => {
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh",
                &format!("the connection to {host_id} had ended; connecting again"),
            );
            // Everything learned from that connection went with it: its shell,
            // and the file session that was a channel on it.
            state.ssh_sessions.write().await.remove(&host_id);
            state.ssh_shells.write().await.remove(&host_id);
            state.ssh_sftp.lock().await.remove(&host_id);
        }
        None => {}
    }
    if let Some(secret) = secret {
        remember_secret(&state, secret).await;
    }
    connect_fresh(app, state, host_id).await
}

/// Send the person's answers to the questions a host's second factor asked, on
/// the connection that is waiting for them, and carry on connecting.
#[tauri::command]
pub async fn ssh_host_answer<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    host_id: String,
    answers: Vec<String>,
) -> Result<SshConnectReport, CommandError> {
    let parked = state.ssh_dials.lock().await.remove(&host_id);
    let Some((mut dial, since)) = parked else {
        return Err(CommandError::from(AppError::Invalid(
            "this host is not waiting for answers — connect again".to_string(),
        )));
    };
    if since.elapsed() > CHALLENGE_TTL {
        return Err(CommandError::from(AppError::Invalid(
            "the host stopped waiting for these answers — connect again".to_string(),
        )));
    }
    let secrets = secrets_snapshot(&state, dial.route()).await;
    let step = dial
        .answer(answers, &|hop| secrets_for_hop(&secrets, hop))
        .await
        .map_err(CommandError::from)?;
    settle_dial(app, &state, &host_id, dial, step).await
}

/// Give up on a connection paused on a second factor (the person closed the
/// dialog). Dropping it closes the connection that was waiting.
#[tauri::command]
pub async fn ssh_host_cancel(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    Ok(state.ssh_dials.lock().await.remove(&host_id).is_some())
}

/// Edit a registered host (see `ssh::registry::update_host` for what an imported
/// host lets you change). A live session is left alone: it was opened with the
/// old settings and keeps working; the next connect uses the new ones.
#[tauri::command]
pub async fn ssh_host_update(
    state: State<'_, AppState>,
    host_id: String,
    draft: ssh::registry::HostDraft,
) -> Result<SshHost, CommandError> {
    if draft.hostname.trim().is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "a host needs a hostname".to_string(),
        )));
    }
    let mut data = state.data.write().await;
    let updated = ssh::registry::update_host(&mut data.settings.ssh_hosts, &host_id, draft)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("ssh host {host_id}"))))?;
    state.persistence.save(&data).map_err(CommandError::from)?;
    drop(data);
    state.ssh_unlocked.write().await.remove(&host_id);
    Ok(updated)
}

async fn remember_secret(state: &AppState, secret: SshSecret) {
    let mut store = state.ssh_secrets.write().await;
    match (secret.kind.as_str(), secret.path) {
        ("passphrase", Some(path)) => {
            store.put_passphrase(&ssh::auth::expand_path(&path), secret.value)
        }
        _ => store.put_password(&secret.hop_key, secret.value),
    }
}

/// What the person has given for each hop of `route`, copied out so the lock
/// is not held while talking to any of them.
async fn secrets_snapshot(
    state: &AppState,
    route: &ssh::dial::Route,
) -> std::collections::HashMap<String, ssh::auth::Secrets> {
    let store = state.ssh_secrets.read().await;
    route
        .hops
        .iter()
        .map(|hop| {
            let files: Vec<std::path::PathBuf> = hop
                .resolved
                .identity_files
                .iter()
                .map(|f| ssh::auth::expand_path(f))
                .collect();
            (hop.key.clone(), store.secrets_for(&hop.key, &files))
        })
        .collect()
}

fn secrets_for_hop(
    snapshot: &std::collections::HashMap<String, ssh::auth::Secrets>,
    hop: &ssh::dial::Hop,
) -> ssh::auth::Secrets {
    snapshot.get(&hop.key).cloned().unwrap_or_default()
}

/// Reach a host that has no live session, from its route to the shell it
/// starts. Split out of [`ssh_host_connect`] so both the first connection and a
/// replacement for one that ended take exactly the same path.
async fn connect_fresh<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<SshConnectReport, CommandError> {
    let host = find_ssh_host(&state, &host_id).await?;
    // Resolved now, not when the host was added: an edit to `~/.ssh/config`
    // takes effect on the next connect, as it would for `ssh`.
    let route = ssh::dial::route_for(&host)
        .await
        .map_err(CommandError::from)?;
    refresh_host_snapshot(&state, &host_id, route.target()).await?;

    // A connection left paused on an earlier attempt is superseded by this one.
    state.ssh_dials.lock().await.remove(&host_id);

    let secrets = secrets_snapshot(&state, &route).await;
    let mut dial = ssh::dial::Dial::new(route);
    let step = dial
        .run(&|hop| secrets_for_hop(&secrets, hop))
        .await
        .map_err(CommandError::from)?;
    settle_dial(app, &state, &host_id, dial, step).await
}

/// Keep an imported host's record in step with what its configuration says now.
async fn refresh_host_snapshot(
    state: &AppState,
    host_id: &str,
    target: &ssh::dial::Hop,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    let Some(host) = data.settings.ssh_hosts.iter_mut().find(|h| h.id == host_id) else {
        return Ok(());
    };
    if ssh::registry::refresh_snapshot(host, &target.resolved) {
        state.persistence.save(&data).map_err(CommandError::from)?;
    }
    Ok(())
}

/// Turn where a dial got to into the report the interface acts on — and do
/// what each outcome implies: keep the session, park the paused connection,
/// hold a key for the person's decision, forget a secret that was refused.
async fn settle_dial<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    host_id: &str,
    dial: ssh::dial::Dial,
    step: ssh::dial::Step,
) -> Result<SshConnectReport, CommandError> {
    use ssh::dial::{Step, Stop};
    let host_id = host_id.to_string();
    match step {
        Step::Ready(ready) => {
            let ssh::dial::Ready {
                connection,
                method,
                needed_secrets,
                answered_challenges,
                learned,
            } = *ready;
            for (label, fingerprint) in &learned {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh",
                    &format!("recorded the new key of {label} ({fingerprint}) — StrictHostKeyChecking accept-new"),
                );
            }
            let mut report = SshConnectReport::of("connected");
            report.generation = Some(connection.generation());
            report.method = Some(method);
            report.learned_keys = learned;
            // Ask now, once, which shell this machine starts. Everything that
            // later types into it — a terminal's `cd`, an agent's quoted command
            // line — needs the answer, and asking here means no caller has to
            // guess while it waits (`ssh::shellkind`).
            let shell = ssh::shellkind::classify(&connection).await;
            state
                .ssh_shells
                .write()
                .await
                .insert(host_id.clone(), shell);
            report.shell = Some(shell.as_str().to_string());
            let generation = connection.generation();
            let session = std::sync::Arc::new(connection);
            state
                .ssh_sessions
                .write()
                .await
                .insert(host_id.clone(), std::sync::Arc::clone(&session));
            watch_session(app.clone(), host_id.clone(), generation, session);
            // Terminals that were waiting for this host — detached by a drop,
            // or restored by the app before the host was up — come back now.
            tauri::async_runtime::spawn(host_came_back(app, host_id.clone()));
            // Startup reconnects the hosts that let us in without asking and
            // leaves the rest until the person is here. Within this session, a
            // host that needed only a password or a passphrase can come back on
            // its own — the app still holds them; one that needed a code cannot.
            set_needs_prompt(state, &host_id, needed_secrets).await?;
            let mut unlocked = state.ssh_unlocked.write().await;
            if needed_secrets && !answered_challenges {
                unlocked.insert(host_id.clone());
            } else {
                unlocked.remove(&host_id);
            }
            Ok(report)
        }
        Step::Paused { hop, challenge } => {
            let mut report = SshConnectReport::about("needsAnswers", &hop);
            report.challenge = Some(challenge);
            set_needs_prompt(state, &host_id, true).await?;
            state
                .ssh_dials
                .lock()
                .await
                .insert(host_id, (dial, std::time::Instant::now()));
            Ok(report)
        }
        Step::Stopped(stop) => {
            let report = match stop {
                Stop::Unreachable { hop, why, detail } => {
                    let mut r = SshConnectReport::about("unreachable", &hop);
                    r.reason = Some(why);
                    r.detail = Some(detail);
                    r
                }
                Stop::ProxyFailed { hop, detail } => {
                    let mut r = SshConnectReport::about("proxyFailed", &hop);
                    r.detail = Some(detail);
                    r
                }
                Stop::HostUnknown {
                    hop,
                    pending,
                    strict,
                } => {
                    let mut r = SshConnectReport::about("hostUnknown", &hop);
                    r.fingerprint = Some(pending.fingerprint());
                    r.strict = strict;
                    if !strict {
                        state.ssh_pending_keys.write().await.insert(
                            host_id.clone(),
                            ssh::PendingHostKey {
                                hop: hop.label.clone(),
                                pending,
                                changed: false,
                            },
                        );
                    }
                    r
                }
                Stop::HostChanged {
                    hop,
                    pending,
                    stored_fingerprint,
                } => {
                    let mut r = SshConnectReport::about("hostChanged", &hop);
                    r.fingerprint = Some(pending.fingerprint());
                    r.stored_fingerprint = Some(stored_fingerprint);
                    state.ssh_pending_keys.write().await.insert(
                        host_id.clone(),
                        ssh::PendingHostKey {
                            hop: hop.label.clone(),
                            pending,
                            changed: true,
                        },
                    );
                    r
                }
                Stop::HostRevoked { hop, fingerprint } => {
                    let mut r = SshConnectReport::about("hostRevoked", &hop);
                    r.fingerprint = Some(fingerprint);
                    r
                }
                Stop::NeedsPassword { hop, attempted } => {
                    set_needs_prompt(state, &host_id, true).await?;
                    let mut r = SshConnectReport::about("needsPassword", &hop);
                    r.attempted = attempted;
                    r
                }
                Stop::NeedsPassphrase { hop, path, wrong } => {
                    set_needs_prompt(state, &host_id, true).await?;
                    if wrong {
                        state
                            .ssh_secrets
                            .write()
                            .await
                            .forget_passphrase(&ssh::auth::expand_path(&path));
                    }
                    let mut r = SshConnectReport::about("needsPassphrase", &hop);
                    r.path = Some(path);
                    r.wrong = wrong;
                    r
                }
                Stop::Failed { hop, attempted } => {
                    // A password the person gave was part of what got refused:
                    // forget it, so the next attempt asks instead of replaying
                    // the wrong one.
                    state.ssh_secrets.write().await.forget_password(&hop.key);
                    let mut r = SshConnectReport::about("failed", &hop);
                    r.attempted = attempted;
                    r
                }
                Stop::NoUsableMethod { hop } => SshConnectReport::about("noUsableMethod", &hop),
            };
            Ok(report)
        }
    }
}

/// How often a live connection is looked at to see whether it is still there.
///
/// This is a **local** check — one boolean on a channel this process owns, no
/// traffic at all — so the interval only decides how quickly the interface hears
/// about something the transport already knows. Two seconds is imperceptible to
/// a user and free to the host.
const SESSION_WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Tell the interface, once, when a host's connection ends.
///
/// Everything else about a dropped session was already right — the keepalive
/// notices a dead host in ~2 min, a listing opens a new file channel, a
/// connection that has ended stops counting as connected — but only *when asked*.
/// With nothing asking, a host that dropped while its panel was open kept
/// looking connected until the user clicked something, and the click was how
/// they found out. This is the missing half: the app says so by itself.
///
/// Deliberately a poll of a local flag rather than a subscription: russh's
/// handle exposes `is_closed()` and no notification, and reaching into its
/// internals to await the channel would tie us to a private detail of a
/// dependency for two seconds of latency.
///
/// **Only its own incarnation is cleaned up.** A reconnect stores a new
/// connection under the same host id; this task compares generations before
/// removing anything, so a watcher for a dead session can never take away the
/// live one that replaced it.
fn watch_session<R: tauri::Runtime>(
    app: AppHandle<R>,
    host_id: String,
    generation: u64,
    session: std::sync::Arc<ssh::conn::Connection>,
) {
    tauri::async_runtime::spawn(async move {
        while !session.handle().is_closed() {
            tokio::time::sleep(SESSION_WATCH_INTERVAL).await;
        }
        // Nothing else holds this connection open; let it go before the state is
        // touched, so the entry that is removed is the last reference.
        drop(session);

        let state = app.state::<AppState>();
        let was_current = {
            let mut sessions = state.ssh_sessions.write().await;
            let stored = sessions.get(&host_id).map(|c| c.generation());
            if ends_the_current_session(stored, generation) {
                sessions.remove(&host_id);
                true
            } else {
                false
            }
        };
        if was_current {
            // Everything learned from that connection went with it: its shell,
            // and the file session that was a channel on it.
            state.ssh_shells.write().await.remove(&host_id);
            state.ssh_sftp.lock().await.remove(&host_id);
            state.ssh_engines.remove(&host_id).await;
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh",
                &format!("the connection to {host_id} ended"),
            );
            // Try to bring it back. Only for a session that was still the
            // current one: a user who pressed Disconnect removed it first, and
            // reconnecting them would be the app arguing with them.
            tauri::async_runtime::spawn(reconnect_ladder(app.clone(), host_id.clone()));
        }
        // Emitted either way: the interface asked to be told when a session ends,
        // and it re-reads the live set rather than trusting this payload — one
        // source of truth, and no chance of the two disagreeing.
        let _ = app.emit(
            "ssh:session-ended",
            SshSessionEnded {
                host_id,
                generation,
            },
        );
    });
}

/// Whether the connection that just ended is the one the app is still holding.
///
/// A reconnect stores a new connection under the same host id, so a watcher for
/// a dead session must never take away the live one that replaced it — and a
/// session already removed (the user pressed Disconnect) has nothing to clean.
/// Split out so the rule is testable without a host to talk to.
fn ends_the_current_session(stored: Option<u64>, ended: u64) -> bool {
    stored == Some(ended)
}

/// How long to wait before each reconnect attempt after a host drops.
///
/// Growing, and short at first: most drops are a laptop lid, a Wi-Fi handover or
/// a VPN blink, and those come back in seconds. The last step is a minute
/// because a machine that has been gone that long is usually gone for a reason a
/// user has to fix — and a client that keeps dialling forever is one that fills
/// a log, holds a password prompt hostage, and looks broken.
const RECONNECT_BACKOFF: [u64; 5] = [2, 5, 15, 30, 60];

/// Come back after a drop, for the hosts that can come back **silently**.
///
/// The rule is the one startup already uses (`ssh_hosts_resumable`): a host that
/// let us in with no password and whose key is on file is reconnected on its
/// own; one that would ask for anything is not. A ladder that raised a password
/// dialog by itself, minutes after the user walked away from the machine, would
/// be worse than staying disconnected.
///
/// It stops for good on the first outcome that says trying again cannot help — a
/// name that does not resolve, a refused credential, a host key that changed
/// (which is the one case where retrying would be actively wrong: something is
/// answering for that address and it is not the machine we trusted).
async fn reconnect_ladder<R: tauri::Runtime>(app: AppHandle<R>, host_id: String) {
    for (attempt, wait) in RECONNECT_BACKOFF.iter().enumerate() {
        tokio::time::sleep(std::time::Duration::from_secs(*wait)).await;

        let state = app.state::<AppState>();
        // Someone may have connected by hand, or removed the host, while this
        // was sleeping. Both mean this ladder has nothing left to do.
        if state.ssh_sessions.read().await.contains_key(&host_id) {
            return;
        }
        if !is_resumable(&state, &host_id).await {
            return;
        }

        match connect_fresh(app.clone(), state, host_id.clone()).await {
            Ok(report) if report.status == "connected" => {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh",
                    &format!(
                        "{host_id} came back on attempt {} of {}",
                        attempt + 1,
                        RECONNECT_BACKOFF.len()
                    ),
                );
                // Same event either way: the interface re-reads the live set
                // rather than trusting a payload, so one signal covers a session
                // that ended and one that came back.
                let _ = app.emit(
                    "ssh:session-ended",
                    SshSessionEnded {
                        host_id,
                        generation: report.generation.unwrap_or_default(),
                    },
                );
                return;
            }
            Ok(report) if !worth_retrying(&report) => {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh",
                    &format!(
                        "{host_id} will not be retried: {}",
                        report.detail.as_deref().unwrap_or(report.status.as_str())
                    ),
                );
                return;
            }
            // Still unreachable in a way that could clear up, or an error on our
            // side: sleep longer and try again.
            _ => {}
        }
    }
    crate::diagnostics::log(
        crate::diagnostics::Level::Info,
        "ssh",
        &format!("{host_id} did not come back; connect it when you are ready"),
    );
}

/// Whether another attempt could plausibly succeed.
///
/// Anything that needs the user — a password, a passphrase, a key decision — is
/// not retried: the ladder exists to survive a network blip, not to ask someone
/// who is not there.
fn worth_retrying(report: &SshConnectReport) -> bool {
    match report.status.as_str() {
        "unreachable" => report.reason.map(|r| r.worth_retrying()).unwrap_or(false),
        // A transient failure with no reason attached; one more try is fair.
        "failed" => true,
        _ => false,
    }
}

/// Whether this host is one the app may bring back without asking anything:
/// it let us in without a prompt last time — or needed only a password or a
/// passphrase that this session still holds — and every hop of its route has
/// its key settled. The same rule `ssh_hosts_resumable` applies at startup.
async fn is_resumable(state: &AppState, host_id: &str) -> bool {
    let Some(host) = state
        .data
        .read()
        .await
        .settings
        .ssh_hosts
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
    else {
        return false;
    };
    let unlocked = state.ssh_unlocked.read().await.contains(host_id);
    if host.needs_prompt && !unlocked {
        return false;
    }
    route_is_silent(&host).await
}

/// Whether reaching `host` can go through without a key decision on any hop.
async fn route_is_silent(host: &SshHost) -> bool {
    match ssh::dial::route_for(host).await {
        Ok(route) => route.hops.iter().all(ssh::dial::Hop::key_is_settled),
        Err(_) => false,
    }
}

/// Payload of `ssh:session-ended`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionEnded {
    pub host_id: String,
    /// Which incarnation ended. The frontend uses it to ignore an event for a
    /// connection that has already been replaced.
    pub generation: u64,
}

/// Ask a connected host what it has: its OS, home, git, a multiplexer, and which
/// agent CLIs are installed there with what version.
///
/// Requires a live session — the answer is what the launcher filters on, and
/// guessing it from the local machine would offer agents that are not there.
#[tauri::command]
pub async fn ssh_host_inventory(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<ssh::inventory::HostInventory, CommandError> {
    let commands = state.agent_commands.read().await.clone();
    // The shell this host reported when it connected. The probe asks in that
    // dialect instead of trying POSIX and falling back, which cost every Windows
    // host a wasted round trip.
    let shell = state
        .ssh_shells
        .read()
        .await
        .get(&host_id)
        .copied()
        .unwrap_or_default();
    let Some(conn) = session_for(&state, &host_id).await else {
        return Err(CommandError::from(AppError::Invalid(
            "connect to this host before asking what it has".to_string(),
        )));
    };
    ssh::inventory::probe(&conn, &commands, shell)
        .await
        .map_err(CommandError::from)
}

/// List the directories inside `path` on a connected host, for the picker that
/// adds a project living there — listed by its engine, with the code that lists
/// this machine's. An empty `path` starts at that machine's home.
#[tauri::command]
pub async fn ssh_browse_dirs(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<crate::browse::DirListing, CommandError> {
    let path = path.trim();
    let path = (!path.is_empty()).then(|| path.to_string());
    match machine_for(&app, &state, Some(&format!("ssh:{host_id}")), None).await? {
        Machine::Host(engine) => engine.browse(path).await.map_err(CommandError::from),
        Machine::Here => Err(CommandError::from(AppError::Invalid(format!(
            "{host_id} is not a host"
        )))),
    }
}

/// Register a folder that lives on a host as a project.
///
/// The path is the host's, so it is stored exactly as that machine spells it;
/// the identity is the pair `(target, path)`, which is why the same absolute
/// path on two machines is two projects rather than one.
#[tauri::command]
pub async fn ssh_repo_add(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<RepoData, CommandError> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "a project needs a folder".to_string(),
        )));
    }
    let target = TargetId::Ssh(host_id.clone());
    // Ask the host whether this is a git repository, the same question the local
    // path asks — a plain folder is a valid project too, it just has no branches.
    // Never a reason to refuse the project: a host that could not be asked
    // answers "not a repository", the same as one whose folder is not.
    let is_git = match connected_engine(&app, &state, &host_id).await {
        Some(engine) => engine
            .git::<git::RepoStatus>(GitCall::Status { path: path.clone() })
            .await
            .map(|status| status.is_repo)
            .unwrap_or(false),
        None => false,
    };

    let mut data = state.data.write().await;
    if let Some(existing) = data
        .repos
        .iter()
        .find(|r| r.target == target && r.path == path)
    {
        return Ok(existing.clone());
    }
    let name = path
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(&path)
        .to_string();
    let repo = RepoData {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        target,
        worktrees: Vec::new(),
        is_git,
        icon: None,
        branch_icons: std::collections::HashMap::new(),
        worktree_order: Vec::new(),
        // No per-project worktree root: a project on a host has nowhere local to
        // put one, and the global setting is the honest default until worktrees
        // can be created there at all.
        worktree_root: None,
    };
    data.repos.push(repo.clone());
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(repo)
}

/// The file session for a host, opening one on first use.
///
/// Held per host because it is a channel on a connection that already exists:
/// keeping it costs nothing, and re-opening one per listing would put a round
/// trip in front of every folder the user expands.
///
/// A cached session is only handed out while its transport is still there
/// ([`ssh::sftp::RemoteFiles::usable`]). That check is what keeps the first click
/// after a host ends the channel from waiting out a ten-second timeout before
/// anything can be done about it.
async fn sftp_for(
    state: &AppState,
    host_id: &str,
) -> Result<std::sync::Arc<ssh::sftp::RemoteFiles>, CommandError> {
    {
        let mut cached = state.ssh_sftp.lock().await;
        match cached.get(host_id) {
            Some(session) if session.usable() => return Ok(std::sync::Arc::clone(session)),
            Some(_) => {
                cached.remove(host_id);
                // Logged because this is the ordinary recovery, and a file panel
                // that hesitates for a moment should be explainable from the log
                // rather than from another screenshot. Host ids only.
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh-files",
                    &format!("the file session on {host_id} had ended; opening another"),
                );
            }
            None => {}
        }
    }
    let Some(conn) = session_for(state, host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(
            host_id.to_string(),
        )));
    };
    // A connection whose transport has ended cannot carry another channel, and
    // saying so is the difference between the panel waiting for its host and the
    // panel showing the user a sentence about a channel they never asked for.
    if conn.handle().is_closed() {
        return Err(CommandError::from(AppError::NotConnected(
            host_id.to_string(),
        )));
    }
    let session = std::sync::Arc::new(ssh::sftp::open(&conn).await.map_err(CommandError::from)?);
    state
        .ssh_sftp
        .lock()
        .await
        .insert(host_id.to_string(), std::sync::Arc::clone(&session));
    Ok(session)
}

/// A host's live connection, cloned out of the registry.
///
/// **The guard is released before this returns**, and that is the entire point.
/// Everything here talks to another machine, `ssh_sessions` is a fair
/// (write-preferring) lock, and one connect needs to write to it — so a caller
/// that kept the guard while it waited on the network queued that write, and
/// every later reader queued behind the write. One slow round trip then stalled
/// the connected list, the git panels, the file tree and the Settings dialog at
/// once. Reported from the app as "adding a second host froze it".
async fn session_for(
    state: &AppState,
    host_id: &str,
) -> Option<std::sync::Arc<ssh::conn::Connection>> {
    state.ssh_sessions.read().await.get(host_id).cloned()
}

/// A port a terminal on a host just announced (`ports:announced`).
///
/// Announced, not opened: nothing is forwarded until the user asks for it, so
/// this event is the app noticing rather than the app acting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncedPort {
    pub host_id: String,
    /// Which terminal printed it, so the list can say where it came from.
    pub terminal_id: String,
    pub port: u16,
    /// The path the server named (`/`, `/admin`), kept so opening the preview
    /// lands where the server pointed.
    pub path: String,
}

/// Ask a host what it is listening on, right now — its engine reads that
/// machine's own socket table (`ports::listening`).
///
/// The deliberate second way in, next to what terminals announce: it runs
/// when the user asks, never on a timer. A host where the engine cannot run
/// says so, as its files and git do.
#[tauri::command]
pub async fn ssh_ports_listening(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
) -> Result<Vec<uxnan_workspace_engine::ports::ListeningPort>, CommandError> {
    match machine_for(&app, &state, Some(&format!("ssh:{host_id}")), None).await? {
        Machine::Host(engine) => engine.ports().await.map_err(CommandError::from),
        Machine::Here => Err(CommandError::from(AppError::Invalid(format!(
            "{host_id} is not a host"
        )))),
    }
}

/// Bring a port on a host to this machine, and answer where it landed.
///
/// The local port is the same number whenever it is free, because an application
/// writes its own address into redirects and cookies; when it is not, the port
/// actually opened is in the answer rather than substituted quietly
/// (`ssh::forward`). Asking twice for the same port returns the tunnel that is
/// already there.
///
/// Not fenced, unlike the writes: this changes nothing on the host — it opens a
/// socket *here* — and the host it reaches is decided by `host_id` resolving to
/// a live connection, so there is no second machine for it to be wrong about.
#[tauri::command]
pub async fn ssh_forward_open(
    state: State<'_, AppState>,
    host_id: String,
    remote_port: u16,
    addresses: Option<Vec<String>>,
) -> Result<ssh::forward::ForwardInfo, CommandError> {
    let Some(conn) = session_for(&state, &host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(host_id)));
    };
    state
        .ssh_forwards
        .open(&host_id, &conn, remote_port, &addresses.unwrap_or_default())
        .await
        .map_err(CommandError::from)
}

/// Close a forward. `false` when there was none — closing twice is a no-op.
#[tauri::command]
pub async fn ssh_forward_close(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, CommandError> {
    Ok(state.ssh_forwards.close(&id).await)
}

/// Every forward that is live right now, on any host.
#[tauri::command]
pub async fn ssh_forwards(
    state: State<'_, AppState>,
) -> Result<Vec<ssh::forward::ForwardInfo>, CommandError> {
    Ok(state.ssh_forwards.list().await)
}

/// Drop a host's session. Idempotent — disconnecting one that is not connected
/// answers `false` rather than failing.
#[tauri::command]
pub async fn ssh_host_disconnect(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    // End its terminals first, while the session is still there to carry the
    // goodbye. Afterwards they would have no way to be told.
    state.ssh_pty.close_host(&host_id).await;
    // The host's daemon is *not* told to end anything: its terminals keep
    // running there, and come back when the host is connected again. Dropping
    // the engine closes its channel, which detaches them.
    state.ssh_engines.remove(&host_id).await;
    // Its forwards go with it: a socket here that carries connections over a
    // connection that no longer exists would accept them into nothing.
    state.ssh_forwards.close_host(&host_id).await;
    // A reconnect may find the machine configured differently, so the shell is
    // learned again rather than remembered across sessions.
    state.ssh_shells.write().await.remove(&host_id);
    state.ssh_sftp.lock().await.remove(&host_id);
    let session = state.ssh_sessions.write().await.remove(&host_id);
    // Said to the host, not left to dropping it: any channel still open (a
    // file session, a forward) keeps an SSH connection alive, and a
    // "disconnected" host that is still connected underneath is a lie.
    if let Some(conn) = &session {
        let _ = conn
            .handle()
            .disconnect(
                russh::Disconnect::ByApplication,
                "disconnected in Uxnan",
                "",
            )
            .await;
    }
    Ok(session.is_some())
}

/// One live session, as the UI needs to know it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostSession {
    pub host_id: String,
    /// Which incarnation of the connection this is. The frontend sends it back
    /// with every mutation it prepares (`target::TargetExpectation`), so a call
    /// made against one connection cannot execute against its replacement. It is
    /// reported here, and not only by `ssh_host_connect`, because the app is
    /// restarted and reloaded far more often than a host is connected — without
    /// it, every save after a reload would carry a generation of nobody's.
    pub generation: u64,
    /// The link's latency as the host engine's heartbeat last measured it.
    pub latency_ms: Option<u64>,
}

/// The hosts that can be brought back **without asking the user anything**.
///
/// Startup uses this instead of "every host that is not marked as needing a
/// prompt", because that mark is only written once a host has been connected —
/// a machine registered five seconds ago carries the same `false` as one that
/// has let us in silently for weeks. The difference that matters is whether
/// reaching it can raise a dialog, and there are exactly two ways it can:
///
/// - it asked for a password or a passphrase last time (`needs_prompt`), or
/// - **a host key along its route is not on file** — the host's own, or a
///   bastion's — which can only end in the trust prompt.
///
/// Neither belongs on screen unprompted while the app is still opening. A host
/// left out of this list is not refused — it connects the moment the user asks.
#[tauri::command]
pub async fn ssh_hosts_resumable(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    let hosts = state.data.read().await.settings.ssh_hosts.clone();
    // Each host resolves its route through `ssh -G`, a few milliseconds apiece.
    let mut silent = Vec::new();
    for host in hosts.into_iter().filter(|h| !h.needs_prompt) {
        if route_is_silent(&host).await {
            silent.push(host.id);
        }
    }
    Ok(silent)
}

/// The hosts with a live session, and which incarnation each one is.
///
/// "Live" is checked, not assumed: a connection whose transport has ended is
/// still in the map until something tries to use it, and listing it would have
/// the app claim a host is connected while every panel on it fails.
#[tauri::command]
pub async fn ssh_hosts_connected(
    state: State<'_, AppState>,
) -> Result<Vec<SshHostSession>, CommandError> {
    let live: Vec<(String, u64)> = state
        .ssh_sessions
        .read()
        .await
        .iter()
        .filter(|(_, conn)| !conn.handle().is_closed())
        .map(|(host_id, conn)| (host_id.clone(), conn.generation()))
        .collect();
    let mut sessions = Vec::with_capacity(live.len());
    for (host_id, generation) in live {
        let latency_ms = match state.ssh_engines.live(&host_id).await {
            Some(engine) => engine.latency_ms(),
            None => None,
        };
        sessions.push(SshHostSession {
            host_id,
            generation,
            latency_ms,
        });
    }
    Ok(sessions)
}

/// Record whether a host asked for something interactive. Persisted because the
/// value is only learned by connecting, and losing it means prompting at every
/// startup for a host we already knew was silent.
async fn set_needs_prompt(
    state: &AppState,
    host_id: &str,
    needs_prompt: bool,
) -> Result<(), CommandError> {
    let mut data = state.data.write().await;
    let Some(host) = data.settings.ssh_hosts.iter_mut().find(|h| h.id == host_id) else {
        return Ok(());
    };
    if host.needs_prompt == needs_prompt {
        return Ok(());
    }
    host.needs_prompt = needs_prompt;
    state.persistence.save(&data).map_err(CommandError::from)
}

async fn find_ssh_host(state: &AppState, host_id: &str) -> Result<SshHost, CommandError> {
    state
        .data
        .read()
        .await
        .settings
        .ssh_hosts
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("ssh host {host_id}"))))
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
    // Identity is `(target, path)`, not the path: the same absolute path names a
    // different folder on each machine. Only local projects exist today, so the
    // target check is a no-op that stays correct once remote ones do.
    if let Some(existing) = data
        .repos
        .iter()
        .find(|r| r.target.is_local() && r.path == path)
    {
        return Ok(existing.clone());
    }
    let repo = RepoData {
        id: Uuid::new_v4().to_string(),
        name: git::repo_name(&path),
        path,
        // This command registers a folder on the machine the ADE runs on; adding
        // a project that lives on a remote host is a separate entry point.
        target: TargetId::Local,
        worktrees: Vec::new(),
        is_git,
        icon: None,
        branch_icons: std::collections::HashMap::new(),
        worktree_order: Vec::new(),
        worktree_root: None,
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

/// Re-ask whether a project's folder is a git repository. `RepoData::is_git` is
/// decided once, when the folder is added, and a plain folder does not stay one:
/// `git init` run in a terminal (or by an agent) turns it into a repository the
/// record still calls a folder — and everything that trusts the record (the
/// card, the Changes panel, the worktree affordances) keeps treating it as one,
/// while the panels that ask git directly (History, GitHub) already show the
/// repository. Only local projects are probed: a host's folder is asked over SSH
/// by the layers that read it, and the record is not the authority there.
///
/// Returns the updated project when the answer changed, in either direction,
/// after persisting it; `None` when the record was already right. The frontend
/// calls it for plain folders from the same reconcile pass that lists worktrees,
/// so it is one `git rev-parse` per plain folder per pass — cheap, and only
/// while the answer is still "no".
#[tauri::command]
pub async fn repo_probe_git(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<RepoData>, CommandError> {
    let (path, target) = repo_location_of(&state, &id).await?;
    if !target.is_local() {
        return Ok(None);
    }
    let is_git = git::is_git_repo(&path).await;
    let mut data = state.data.write().await;
    let repo = data
        .repos
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {id}"))))?;
    if !redetect_git(repo, is_git) {
        return Ok(None);
    }
    let updated = repo.clone();
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(Some(updated))
}

/// Apply a fresh "is this a repository?" answer to a project record. Returns
/// whether the record changed — the caller persists only then. Split out so the
/// rule is testable without a Tauri state: the flag follows the folder in both
/// directions, and an unchanged answer is not a write.
fn redetect_git(repo: &mut RepoData, is_git_now: bool) -> bool {
    if repo.is_git == is_git_now {
        return false;
    }
    repo.is_git = is_git_now;
    true
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
    Ok(repo_location_of(state, repo_id).await?.0)
}

/// Resolve a registered repo's absolute path **and** the machine it lives on.
/// Same lock discipline as [`repo_path_of`].
async fn repo_location_of(
    state: &AppState,
    repo_id: &str,
) -> Result<(String, TargetId), CommandError> {
    state
        .data
        .read()
        .await
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .map(|r| (r.path.clone(), r.target.clone()))
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))
}

/// A registered project, cloned out of the store.
async fn repo_data_of(state: &AppState, repo_id: &str) -> Result<RepoData, CommandError> {
    state
        .data
        .read()
        .await
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .cloned()
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))
}

/// A repo's path and the machine it is on, for a project command. With
/// `fence`, the call is a **mutation** and is refused when the target the
/// caller prepared it for is no longer the one the work would run on — every
/// destructive repo-bound command goes through here, so "which machine does
/// this run on" is answered once (`machine_for`, `target::check`).
async fn repo_machine<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    repo_id: &str,
    fence: Option<Option<&TargetExpectation>>,
) -> Result<(String, Machine), CommandError> {
    let (path, target) = repo_location_of(state, repo_id).await?;
    let machine = machine_for(app, state, Some(&target.to_string()), fence).await?;
    Ok((path, machine))
}

/// List a repo's local + remote branches and the resolved default base ref.
/// Powers both the base-branch picker (new-branch mode) and the existing-branch
/// picker (check out any local/remote branch) when creating a worktree.
#[tauri::command]
pub async fn branch_list(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<git::BranchList, CommandError> {
    match repo_machine(&app, &state, &repo_id, None).await? {
        (path, Machine::Here) => git::branch_list(&path).await.map_err(CommandError::from),
        (path, Machine::Host(engine)) => engine
            .git(GitCall::Branches { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Where a new worktree of `repo_id` for `branch` goes: the control service's
/// one implementation of the location policy (`services::worktree::resolve_location`).
async fn resolve_worktree_location(
    state: &AppState,
    repo_id: &str,
    _repo_path: &str,
    branch: &str,
) -> Result<Resolved, CommandError> {
    let repo = {
        let data = state.data.read().await;
        data.repos
            .iter()
            .find(|r| r.id == repo_id)
            .cloned()
            .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))?
    };
    crate::control::services::worktree::resolve_location(state, &repo, branch)
        .await
        .map_err(CommandError::from)
}

/// The git identity commits are authored with (Settings → Git), read from the
/// global/system config rather than any open repository. Never fails: an unset
/// field comes back as `null` so the pane can say so — an identity that isn't
/// set is exactly what makes `git commit` fail later.
#[tauri::command]
pub async fn git_identity() -> Result<git::GitIdentity, CommandError> {
    let home = agent_hooks::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    Ok(git::identity(&home).await)
}

/// Where a worktree for `branch` **would** be created, for the create dialog's
/// location field. Read-only — it neither creates directories nor claims a
/// group, so it is safe to call while the user is still typing the branch name.
#[tauri::command]
pub async fn worktree_preview_path(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<String, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Ok(String::new());
    }
    match repo_machine(&app, &state, &repo_id, None).await? {
        (path, Machine::Here) => Ok(resolve_worktree_location(&state, &repo_id, &path, &branch)
            .await?
            .path),
        (path, Machine::Host(engine)) => {
            let repo = repo_data_of(&state, &repo_id).await?;
            let (mode, root) =
                crate::control::services::worktree::location_policy(&state, &repo).await;
            engine
                .git(GitCall::WorktreeLocation {
                    path,
                    branch,
                    mode: serde_json::to_value(mode).map_err(AppError::Serde)?,
                    root,
                })
                .await
                .map_err(CommandError::from)
        }
    }
}

/// Set (or clear, with `None`/blank) a project's own managed-worktree root, so a
/// repository can live somewhere else than the global setting says.
#[tauri::command]
pub async fn repo_set_worktree_root(
    state: State<'_, AppState>,
    repo_id: String,
    root: Option<String>,
) -> Result<RepoData, CommandError> {
    let root = root
        .map(|r| worktreeloc::normalize(r.trim()))
        .filter(|r| !r.is_empty());
    if let Some(root) = root.as_deref() {
        if !std::path::Path::new(root).is_absolute() {
            return Err(CommandError::from(AppError::Invalid(
                "worktree root must be an absolute path".to_string(),
            )));
        }
    }
    let mut data = state.data.write().await;
    let repo = data
        .repos
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))?;
    repo.worktree_root = root;
    let updated = repo.clone();
    state.persistence.save(&data).map_err(CommandError::from)?;
    Ok(updated)
}

/// Every managed root worth scanning for cleanup: the global one (default or
/// custom) plus each project's own override. Deduplicated, and **only** these —
/// the cleanup screen never looks anywhere else, which is what makes it safe to
/// offer a delete button at all.
pub(crate) async fn managed_roots(state: &AppState) -> Vec<String> {
    let (global, overrides) = {
        let data = state.data.read().await;
        let settings = data.settings.worktrees.clone();
        // A host project's own root is a folder on that host, its engine's to
        // clean (`host_cleanup_scope`), never one on this machine.
        let overrides: Vec<String> = data
            .repos
            .iter()
            .filter(|r| r.target.is_local())
            .filter_map(|r| r.worktree_root.clone())
            .collect();
        (settings, overrides)
    };
    let mut roots: Vec<String> = Vec::new();
    let default_root = agent_hooks::home_dir()
        .map(|home| worktreeloc::default_root(&home.to_string_lossy()))
        .unwrap_or_default();
    // The sibling layout has no root of its own, so nothing to scan; the managed
    // default still applies to any project that overrode nothing.
    for candidate in std::iter::once(match global.location {
        WorktreeLocationMode::Custom => global
            .root
            .clone()
            .filter(|r| !r.trim().is_empty())
            .unwrap_or(default_root.clone()),
        _ => default_root.clone(),
    })
    .chain(overrides)
    {
        let normalized = worktreeloc::normalize(candidate.trim());
        if !normalized.is_empty() && !roots.contains(&normalized) {
            roots.push(normalized);
        }
    }
    roots
}

/// Registered projects whose folder is not on disk right now, by id.
///
/// **Not proof that anything was deleted.** An unmounted drive, an offline
/// network share and a cloud placeholder all look exactly like this, which is
/// why the app only *marks* such a project and stops spending work on it —
/// polling git and `gh` against a path that is not there produces nothing but
/// errors — and never removes it. Removing stays the user's call.
///
/// **A project on a host is asked of that host's engine**, when one runs there
/// — this machine's filesystem cannot answer for another one's path (asked
/// anyway, it once marked a healthy remote project missing). Only the host's
/// own filesystem saying the folder is not there marks it; a host that is not
/// connected, or does not answer, leaves its projects unmarked: unknown is
/// shown as present. No engine is started just to ask.
#[tauri::command]
pub async fn repos_missing(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    let repos: Vec<(String, TargetId, String)> = state
        .data
        .read()
        .await
        .repos
        .iter()
        .map(|r| (r.id.clone(), r.target.clone(), r.path.clone()))
        .collect();
    let mut missing = Vec::new();
    for (id, target, path) in repos {
        let gone = match target.ssh_host_id() {
            Some(host) => match state.ssh_engines.live(host).await {
                Some(engine) => missing_on_host(engine.browse(Some(path)).await),
                None => false,
            },
            None => missing_locally(&target, &path),
        };
        if gone {
            missing.push(id);
        }
    }
    Ok(missing)
}

/// Whether a host's answer about a project folder says it is not there: only
/// that host's filesystem refusing it (no such folder) counts — a connection
/// that dropped or an engine that did not answer in time is not a verdict.
fn missing_on_host<T>(answer: Result<T, AppError>) -> bool {
    matches!(answer, Err(AppError::Io(_)) | Err(AppError::NotFound(_)))
}

/// Whether *this* machine can say the folder is not there.
///
/// Only ever true for a local project: for any other target the honest answer
/// is "not mine to say", and `false` is what carries that — the app marks
/// nothing rather than inventing a verdict from the wrong filesystem.
fn missing_locally(target: &TargetId, path: &str) -> bool {
    target.is_local() && !std::path::Path::new(path).is_dir()
}

/// A project still carrying worktree bookkeeping for folders that are gone.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleWorktrees {
    pub repo_id: String,
    pub name: String,
    /// Paths git still lists that are not on disk.
    pub paths: Vec<String>,
}

/// Projects whose git bookkeeping still lists worktrees that are gone.
///
/// Read-only, and it deliberately skips a project whose own folder is missing:
/// there is no repository left to ask, and the answer for that is to deal with
/// the project itself.
#[tauri::command]
pub async fn worktree_stale_scan(
    state: State<'_, AppState>,
) -> Result<Vec<StaleWorktrees>, CommandError> {
    let repos: Vec<(String, String, String)> = state
        .data
        .read()
        .await
        .repos
        .iter()
        .filter(|r| r.is_git)
        .map(|r| (r.id.clone(), r.name.clone(), r.path.clone()))
        .collect();

    let mut found = Vec::new();
    for (repo_id, name, path) in repos {
        if !std::path::Path::new(&path).is_dir() {
            continue;
        }
        let paths = git::stale_worktrees(&path).await;
        if !paths.is_empty() {
            found.push(StaleWorktrees {
                repo_id,
                name,
                paths,
            });
        }
    }
    Ok(found)
}

/// Drop a project's bookkeeping for worktrees whose folders are gone
/// (`git worktree prune`).
///
/// Safe in a way the cleanup is not: it removes **records, never files** — the
/// directories it forgets are already missing. It is still never automatic,
/// because a folder that is absent today can be a drive that is plugged in
/// tomorrow, and pruning first would leave that checkout orphaned from its
/// repository.
#[tauri::command]
pub async fn worktree_prune(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<String>, CommandError> {
    let repo_path = repo_path_of(&state, &repo_id).await?;
    git::prune_worktrees(&repo_path).await;
    Ok(git::stale_worktrees(&repo_path).await)
}

/// How many worktree folders the managed roots hold — the cheap question the
/// status bar asks at startup to decide whether to mention the folder at all.
/// Directory counting only: no git, and emphatically no size walk.
#[tauri::command]
pub async fn worktree_cleanup_count(state: State<'_, AppState>) -> Result<u32, CommandError> {
    let roots = managed_roots(&state).await;
    Ok(worktreeclean::count(&roots).await)
}

/// The managed `repos` folder — where the clone flow suggests putting a
/// repository. Not configurable: the clone destination is an editable
/// suggestion, so the only folder the cleanup may consider its own is this one.
/// A repository the user keeps anywhere else is never listed and never touched.
fn repos_root() -> String {
    agent_hooks::home_dir()
        .map(|home| {
            format!(
                "{}/uxnan/repos",
                worktreeloc::normalize(&home.to_string_lossy())
            )
        })
        .unwrap_or_default()
}

/// The paths of the repositories currently registered as projects on this
/// machine (a host's are its engine's, `host_cleanup_scope`). A worktree
/// under a managed root whose repository is not among them belongs to a project
/// the user closed — removing one touches nothing on disk, so its worktrees stay
/// behind, and this is what lets the cleanup see them.
async fn project_paths(state: &AppState) -> Vec<String> {
    state
        .data
        .read()
        .await
        .repos
        .iter()
        .filter(|r| r.target.is_local())
        .map(|r| r.path.clone())
        .collect()
}

/// What a host adds to its own managed roots for the cleanup: the paths of its
/// projects here, and the custom roots they name.
async fn host_cleanup_scope(state: &AppState, host_id: &str) -> (Vec<String>, Vec<String>) {
    let data = state.data.read().await;
    let mine = data
        .repos
        .iter()
        .filter(|r| r.target.ssh_host_id() == Some(host_id));
    let projects = mine.clone().map(|r| r.path.clone()).collect();
    let roots = mine.filter_map(|r| r.worktree_root.clone()).collect();
    (roots, projects)
}

/// Worktrees inside the managed folders of the machine `target` names that can
/// be cleaned up, plus the ones blocked by uncommitted work (listed, never
/// removable). Read-only. On a host its engine scans its own roots with the
/// same rules.
#[tauri::command]
pub async fn worktree_cleanup_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    target: Option<String>,
) -> Result<Vec<worktreeclean::CleanupCandidate>, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => {
            let roots = managed_roots(&state).await;
            let projects = project_paths(&state).await;
            let busy = state.pty.live_cwds();
            Ok(worktreeclean::scan_all(&roots, &repos_root(), &projects, &busy).await)
        }
        Machine::Host(engine) => {
            let host = target
                .as_deref()
                .and_then(|t| t.strip_prefix("ssh:"))
                .unwrap_or("");
            let (roots, projects) = host_cleanup_scope(&state, host).await;
            engine
                .cleanup(CleanupCall::Scan { roots, projects })
                .await
                .map_err(CommandError::from)
        }
    }
}

/// Size on disk of each given worktree, in bytes, in the order asked.
///
/// Separate from the scan on purpose: walking a checkout's `node_modules` costs
/// far more than every git query in the scan combined, so the list appears
/// immediately and the sizes fill in.
#[tauri::command]
pub async fn worktree_cleanup_sizes(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    target: Option<String>,
) -> Result<Vec<u64>, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => {
            let mut sizes = Vec::with_capacity(paths.len());
            for path in paths {
                sizes.push(worktreeclean::dir_size(path).await);
            }
            Ok(sizes)
        }
        Machine::Host(engine) => engine
            .cleanup(CleanupCall::Sizes { paths })
            .await
            .map_err(CommandError::from),
    }
}

/// Remove the given worktrees, on the machine `target` names. Every path is
/// re-verified against a fresh scan — inside a managed root, still disposable,
/// still clean — so a stale list can never delete the wrong folder. Fenced on
/// a host, like every other change there.
#[tauri::command]
pub async fn worktree_cleanup_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<worktreeclean::CleanupOutcome, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => {
            let roots = managed_roots(&state).await;
            let projects = project_paths(&state).await;
            let busy = state.pty.live_cwds();
            Ok(worktreeclean::remove(&roots, &repos_root(), &projects, &busy, &paths).await)
        }
        Machine::Host(engine) => {
            let host = target
                .as_deref()
                .and_then(|t| t.strip_prefix("ssh:"))
                .unwrap_or("");
            let (roots, projects) = host_cleanup_scope(&state, host).await;
            engine
                .cleanup(CleanupCall::Remove {
                    roots,
                    projects,
                    paths,
                })
                .await
                .map_err(CommandError::from)
        }
    }
}

/// Create a worktree in the given repo. Two modes:
/// - **new branch** (`from_existing = false`): create `branch` from `base` (or
///   the repo's resolved default base — remote HEAD → main → master → HEAD);
/// - **existing branch** (`from_existing = true`): check out an already-existing
///   local or remote-only `branch` (a remote-only one gets a local tracking
///   branch), ignoring `base`.
///
/// `path` is an optional custom worktree directory for this one creation (must
/// be absolute and not yet exist); when omitted the backend resolves the
/// location from the user's settings — by default the managed root
/// `<home>/uxnan/worktrees/<repo>/<branch>` (`worktreeloc.rs`). Returns the
/// created entry as git itself lists it.
///
/// `expect` fences the call to the machine the caller prepared it for (see
/// `target::check`): creating a worktree writes to disk, so it must never land
/// on a target other than the intended one.
#[tauri::command]
pub async fn worktree_create(
    app: AppHandle,
    repo_id: String,
    branch: String,
    base: Option<String>,
    from_existing: Option<bool>,
    path: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<WorktreeEntry, CommandError> {
    // The fence stays here: it is about the *caller's* expectation of which
    // machine this is, which only the window carries. The creation itself is
    // the control service's, shared with `worktree/create`.
    let state = app.state::<AppState>();
    repo_machine(&app, &state, &repo_id, Some(expect.as_ref())).await?;
    let repo = repo_data_of(&state, &repo_id).await?;
    crate::control::services::worktree::create(
        &app,
        &repo,
        crate::control::services::worktree::CreateSpec {
            branch,
            base,
            from_existing: from_existing.unwrap_or(false),
            path,
        },
    )
    .await
    .map_err(CommandError::from)
}

/// Remove a worktree (spec §2.3). With `force = false` the backend refuses when
/// the worktree has uncommitted changes; the frontend surfaces this so the user
/// can confirm a forced removal. Branch cleanup is **opt-in** via `cleanup`:
/// by default only the worktree is removed. When asked, the local branch is
/// deleted (safe, force, or squash-merge) and/or the remote branch on `origin`.
/// The returned [`git::RemoveOutcome`] tells the UI what happened to each.
///
/// `expect` fences the call (see `target::check`). This is the single most
/// dangerous command to run on the wrong machine — it deletes a working tree and
/// can delete branches — so an expectation that no longer matches aborts before
/// any git process starts.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn worktree_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: Option<String>,
    force: bool,
    cleanup: Option<git::BranchCleanup>,
    expect: Option<TargetExpectation>,
) -> Result<git::RemoveOutcome, CommandError> {
    let cleanup = cleanup.unwrap_or_default();
    match repo_machine(&app, &state, &repo_id, Some(expect.as_ref())).await? {
        (repo_path, Machine::Here) => {
            git::remove_worktree(&repo_path, &path, branch.as_deref(), force, cleanup)
                .await
                .map_err(CommandError::from)
        }
        (repo_path, Machine::Host(engine)) => engine
            .git(GitCall::RemoveWorktree {
                path: repo_path,
                worktree: path,
                branch,
                force,
                cleanup: serde_json::to_value(cleanup).map_err(AppError::Serde)?,
            })
            .await
            .map_err(CommandError::from),
    }
}

/// List a repo's worktrees (ADE-created and ones made externally by agents).
///
/// A project on another machine reports **one** workspace — its own folder, with
/// no branch — and no local git runs. Running it would be worse than useless: the
/// path belongs to the host, so at best git fails, and at worst a folder with the
/// same absolute path *does* exist here and the sidebar would show this machine's
/// branches for someone else's repository. Reading git over SSH is phase 3; until
/// then the interface says "not available here" rather than filling the gap with
/// local data (`architecture/02g-remote-hosts.md` §6).
#[tauri::command]
pub async fn worktree_list(
    state: State<'_, AppState>,
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<WorktreeEntry>, CommandError> {
    let repo = {
        let data = state.data.read().await;
        data.repos
            .iter()
            .find(|r| r.id == repo_id)
            .cloned()
            .ok_or_else(|| CommandError::from(AppError::NotFound(format!("repo {repo_id}"))))?
    };
    crate::control::services::worktree::list_of(&app, &repo)
        .await
        .map_err(|e| CommandError::from(AppError::Git(e.message)))
}

/// Whether a worktree's branch already landed in its repo's default base —
/// merged outright or squashed. Read-only; nothing is deleted.
///
/// This is the "is this space finished?" question the sidebar asks before
/// offering to close one, so it deliberately reuses the exact check
/// [`git::remove_worktree`] runs on its way to a safe delete: whatever the
/// sidebar claims is finished is, by construction, what the removal would agree
/// to clean up.
///
/// A detached worktree (no branch) is never "finished" — there is no branch to
/// have landed anywhere.
#[tauri::command]
pub async fn branch_integrated(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    branch: String,
    target: Option<String>,
) -> Result<bool, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Ok(false);
    }
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => {
            if !git::is_git_repo(&path).await {
                return Ok(false);
            }
            Ok(git::branch_integrated(&path, &branch).await)
        }
        Machine::Host(engine) => engine
            .git(GitCall::BranchIntegrated { path, branch })
            .await
            .map_err(CommandError::from),
    }
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

/// Which machine a project call runs on: this one, or a host's engine.
enum Machine {
    Here,
    Host(std::sync::Arc<ssh::engine::HostEngine>),
}

/// The machine `target` names, for a project call — its files or its git. On
/// a host, a **mutation** is fenced first (`02a` §2.9): the expectation the
/// caller prepared has to name the machine and the connection the change would
/// land on — the same absolute path usually exists on both machines, and a
/// misrouted save, discard or delete is silent. A host's projects are its
/// engine's: one where the engine cannot run says so, rather than being served
/// some other way.
async fn machine_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    target: Option<&str>,
    fence: Option<Option<&TargetExpectation>>,
) -> Result<Machine, CommandError> {
    let host = match target.filter(|t| !t.is_empty()).map(TargetId::parse) {
        None | Some(Ok(TargetId::Local)) => {
            // A mutation prepared for another machine never runs here.
            if let Some(expect) = fence {
                target::check(expect, &TargetId::Local, LOCAL_GENERATION)
                    .map_err(CommandError::from)?;
            }
            return Ok(Machine::Here);
        }
        Some(Ok(TargetId::Ssh(host))) => host,
        Some(Ok(other)) => {
            return Err(CommandError::from(AppError::Invalid(format!(
                "{other} is not a machine this app reaches"
            ))))
        }
        Some(Err(e)) => return Err(CommandError::from(e)),
    };
    let Some(conn) = session_for(state, &host).await else {
        return Err(CommandError::from(AppError::NotConnected(host)));
    };
    if let Some(expect) = fence {
        target::check(expect, &TargetId::Ssh(host.clone()), conn.generation())
            .map_err(CommandError::from)?;
    }
    match connected_engine(app, state, &host).await {
        Some(engine) => Ok(Machine::Host(engine)),
        None => Err(CommandError::from(AppError::Invalid(
            "this host's projects are served by its engine, which does not run there".to_string(),
        ))),
    }
}

/// List the immediate children of a directory (sub-dirs first, then files),
/// for the file-tree tab. Lazy: the frontend calls this per folder on expand,
/// so a huge tree (e.g. `node_modules`) never loads until opened.
#[tauri::command]
pub async fn fs_list_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<Vec<crate::fs::FsEntry>, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => crate::fs::list_dir(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::List { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Read a single text file for the editor (with binary / too-large guards).
#[tauri::command]
pub async fn fs_read_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<crate::fs::FileContent, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => crate::fs::read_file(&path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::Read { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Read a local previewable file as an inline `data:<mime>;base64,…` URL for
/// the multimodal viewer. Refuses anything except known images/PDFs and anything
/// over the preview size cap (see [`crate::fs::read_data_url`]).
#[tauri::command]
pub async fn fs_read_data_url(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => crate::fs::read_data_url(&path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::ReadDataUrl { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Read any file to attach it to a chat message (name, MIME type, base64).
#[tauri::command]
pub async fn fs_read_attachment(path: String) -> Result<crate::fs::FileAttachment, CommandError> {
    crate::fs::read_attachment(&path)
        .await
        .map_err(CommandError::from)
}

/// Whether a path is a folder (`false` for a file or a missing path): a folder
/// dropped on the chat composer is written as its path, a file is attached.
#[tauri::command]
pub async fn fs_is_dir(path: String) -> Result<bool, CommandError> {
    Ok(crate::fs::is_dir(&path).await)
}

/// Overwrite a file with the editor's content (atomic temp-write + rename,
/// keeping the file's mode) — on the machine `target` names, fenced there.
#[tauri::command]
pub async fn fs_write_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    content: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::write_file(&path, &content)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::Write { path, content })
            .await
            .map_err(CommandError::from),
    }
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
    let dir = app_data_dir(&app)?;
    Ok(read_term_buffers(&term_buffers_path(&dir)).await)
}

/// Overwrite the terminal scrollback snapshots (atomic write, same envelope as
/// every other persisted file).
#[tauri::command]
pub async fn term_buffers_set(
    app: AppHandle,
    buffers: serde_json::Value,
) -> Result<(), CommandError> {
    let dir = app_data_dir(&app)?;
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
pub async fn fs_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    new_name: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::rename_path(&path, &new_name)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::Rename { path, new_name })
            .await
            .map_err(CommandError::from),
    }
}

/// Create a new, empty file in `dir` (the file tree's "New File"). `path` is a bare
/// name or a VSCode-style intercalated relative path (`sub/dir/file.js`) whose parent
/// segments are created as folders; the leaf must not already exist (see
/// [`crate::fs::create_file`]). Returns the new absolute, forward-slash path.
#[tauri::command]
pub async fn fs_create_file(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::create_file(&dir, &path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::CreateFile { dir, path })
            .await
            .map_err(CommandError::from),
    }
}

/// Create a new empty directory in `dir` (the file tree's "New Folder"). Same
/// intercalated-path / no-clobber guards as [`fs_create_file`], with every segment
/// created as a folder. Returns the new path.
#[tauri::command]
pub async fn fs_create_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::create_dir(&dir, &path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::CreateDir { dir, path })
            .await
            .map_err(CommandError::from),
    }
}

/// The file tree's "Delete": to the system trash on this machine (recoverable),
/// for good on a host, which has none — the dialog says which. Guarded against
/// filesystem roots either way (`crate::fs::check_deletable`).
#[tauri::command]
pub async fn fs_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::delete_to_trash(&path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::Delete { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Duplicate a single file next to itself under a unique "… copy" name (the file
/// tree's "Duplicate"). Directories are refused. Returns the new path.
#[tauri::command]
pub async fn fs_duplicate(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => crate::fs::duplicate_file(&path)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .fs(FsCall::Duplicate { path })
            .await
            .map_err(CommandError::from),
    }
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
/// [`crate::fs::search_files`]). `include_hidden` surfaces dotfiles, `filters`
/// narrows by include/exclude globs, and `limit` caps the results. Runs the
/// blocking walk on the blocking pool.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_search_files(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
    query: String,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
    target: Option<String>,
) -> Result<crate::fs::FileSearch, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => tokio::task::spawn_blocking(move || {
            crate::fs::search_files(&root, &query, include_hidden, &filters, limit)
        })
        .await
        .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string())),
        Machine::Host(engine) => engine
            .fs(FsCall::SearchFiles {
                root,
                query,
                include_hidden,
                filters: serde_json::to_value(filters).map_err(AppError::Serde)?,
                limit,
            })
            .await
            .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string())),
    }
}

/// Project-wide **content** search for the file tree: find the lines under `root`
/// matching `query` — the text plus its case / whole-word / regex modes (see
/// [`crate::fs::search_content`]). `include_hidden` and `filters` narrow the walk
/// the same way the filename search does; `limit` caps total matches. Runs the
/// multi-threaded walk on the blocking pool. An unparsable pattern comes back as
/// `SEARCH_INVALID` so the UI can show it under the input.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_search_content(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
    query: crate::fs::ContentQuery,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
    target: Option<String>,
) -> Result<crate::fs::ContentSearch, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => tokio::task::spawn_blocking(move || {
            crate::fs::search_content(&root, &query, include_hidden, &filters, limit)
        })
        .await
        .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string()))?
        .map_err(|e| CommandError::new("SEARCH_INVALID", e.to_string())),
        // The host answers an unparsable pattern as an invalid call, which
        // is the one way its content search fails on its own.
        Machine::Host(engine) => engine
            .fs(FsCall::SearchContent {
                root,
                query: serde_json::to_value(query).map_err(AppError::Serde)?,
                include_hidden,
                filters: serde_json::to_value(filters).map_err(AppError::Serde)?,
                limit,
            })
            .await
            .map_err(|e| match e {
                AppError::Invalid(msg) => CommandError::new("SEARCH_INVALID", msg),
                other => CommandError::new("SEARCH_FAILED", other.to_string()),
            }),
    }
}

/// Largest remote image the icon fetcher will inline (5 MiB). Icons are tiny;
/// this guards against a hostile/oversized URL streaming forever.
const MAX_ICON_BYTES: u64 = 5 * 1024 * 1024;

/// README screenshots and animated GIFs are legitimately larger than icons, but
/// still need the same hard bound as local file previews.
const MAX_REMOTE_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

/// Download an image from an `http(s)` URL and return it as an inline
/// `data:<mime>;base64,…` URL. Fetching in Rust (not the webview) sidesteps CORS
/// and canvas-taint, so a project/branch icon picked "from URL" or a git-host
/// avatar or README asset can be embedded. Rejects non-`http(s)` schemes,
/// non-image content, and anything over the purpose-specific hard limit.
#[tauri::command]
pub async fn image_fetch_data_url(
    url: String,
    preview: Option<bool>,
) -> Result<String, CommandError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(CommandError::new(
            "IMAGE_FETCH_FAILED",
            "only http(s) image URLs are supported",
        ));
    }
    let max_bytes = if preview.unwrap_or(false) {
        MAX_REMOTE_PREVIEW_BYTES
    } else {
        MAX_ICON_BYTES
    };
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
        if len > max_bytes {
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
    // max_bytes into memory, and the client timeout bounds a slow trickle.
    let mut bytes: Vec<u8> = Vec::new();
    let mut resp = resp;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| CommandError::new("IMAGE_FETCH_FAILED", e.to_string()))?
    {
        if (bytes.len() + chunk.len()) as u64 > max_bytes {
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
///
/// `target` says which machine `path` is on. For a host, the folder is watched
/// **there**, by the host's engine, and its changes arrive as the same
/// `fs:changed` (with that target) — so a project on a host refreshes by itself
/// without this app asking the host anything. Where the engine cannot run, the
/// remote panels keep refreshing on open, on act and on their button.
#[tauri::command]
pub async fn fs_set_watch(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    target: Option<String>,
) -> Result<(), CommandError> {
    let host_id = match target.as_deref().filter(|t| !t.is_empty() && *t != "local") {
        Some(t) => TargetId::parse(t)
            .map_err(CommandError::from)?
            .ssh_host_id()
            .map(str::to_string),
        None => None,
    };
    let previous = state.remote_watch.write().await.take();
    if let Some((old_host, _)) = &previous {
        if Some(old_host) != host_id.as_ref() {
            if let Some(engine) = engine_of_host(&state, old_host).await {
                let _ = engine.unwatch().await;
            }
        }
    }
    let Some(host_id) = host_id else {
        return state
            .fs_watcher
            .set(&app, path)
            .await
            .map_err(|e| CommandError::new("FS_WATCH_FAILED", e.to_string()));
    };
    // A remote root: nothing on this machine to watch.
    let _ = state.fs_watcher.set(&app, None).await;
    let Some(root) = path else {
        if let Some(engine) = engine_of_host(&state, &host_id).await {
            let _ = engine.unwatch().await;
        }
        return Ok(());
    };
    *state.remote_watch.write().await = Some((host_id.clone(), root.clone()));
    // Watched now if the host is up; otherwise when it comes back
    // (`host_came_back`).
    arm_remote_watch(&app, &state, &host_id).await;
    Ok(())
}

/// The running engine of `host_id`'s current connection, if there is one.
async fn engine_of_host(
    state: &AppState,
    host_id: &str,
) -> Option<std::sync::Arc<ssh::engine::HostEngine>> {
    let conn = session_for(state, host_id).await?;
    state.ssh_engines.current(host_id, conn.generation()).await
}

/// Ask `host_id`'s engine to watch the folder the file tree follows there, if
/// it is on that host and the host is connected. Quiet on failure: the panels
/// still refresh on open, on act and on their button.
async fn arm_remote_watch<R: tauri::Runtime>(app: &AppHandle<R>, state: &AppState, host_id: &str) {
    let wanted = state.remote_watch.read().await.clone();
    let Some((host, root)) = wanted.filter(|(h, _)| h == host_id) else {
        return;
    };
    let Some(conn) = session_for(state, &host).await else {
        return;
    };
    let Some(shell) = state.ssh_shells.read().await.get(&host).copied() else {
        return;
    };
    match engine_for(app, state, &host, &conn, shell).await {
        Ok(engine) => {
            if let Err(e) = engine.watch(&root).await {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh-engine",
                    &format!("{host}: could not watch the project folder ({e})"),
                );
            }
        }
        Err(why) => crate::diagnostics::log(
            crate::diagnostics::Level::Info,
            "ssh-engine",
            &format!("{host}: no host engine to watch with ({why})"),
        ),
    }
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
/// the integrated browser of the workspace on screen, hand it to the OS default
/// browser, or (for the `Ask` policy) let the frontend prompt — per the user's
/// `BrowserSettings`. Powers the `openUrl` frontend wrapper and terminal link
/// clicks; the agent `BROWSER` shim reaches the same logic via the hook
/// server's `/browser` route.
#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Result<(), CommandError> {
    crate::browser::route_url(&app, url, None).await.map(|_| ())
}

/// Open `url` in the OS default browser unconditionally (ignores the link policy).
/// Powers the integrated browser's "open in system browser" action and the `Ask`
/// prompt's external choice.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), CommandError> {
    crate::browser::open_external(&app, &url)
}

/// Working-tree-vs-`HEAD` diff for one file, powering the editor's change gutter
/// (added lines + a peek at the removed lines). Empty for clean/untracked files.
#[tauri::command]
pub async fn git_diff_head(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    target: Option<String>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::diff_head(&path, &file)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::DiffHead { path, file })
            .await
            .map_err(CommandError::from),
    }
}

// --- Git status, diffs & staging (Phase 3) ---------------------------------
//
// Each runs git in the worktree `path` on the machine `target` names: this one,
// or a host, whose engine runs the same git there (`machine_for`). Mutations
// carry `expect` and are fenced before anything is sent.

/// Everything the Changes panel draws about a worktree, in one answer — the
/// changed files, their line counts, the upstream distance and `HEAD`. A folder
/// that is not a repository answers `isRepo: false`.
#[tauri::command]
pub async fn git_review(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<git::Review, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::review(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Review { path })
            .await
            .map_err(CommandError::from),
    }
}

/// What a project's row shows about a worktree: its branch and its
/// changed/ahead/behind counts, `isRepo: false` for a plain folder.
#[tauri::command]
pub async fn git_repo_status(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<git::RepoStatus, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::repo_status(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Status { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Per-file added/deleted line counts vs `HEAD` for the changed-files list. The
/// same non-git rule as [`git_status`]: a plain folder has no counts, so it
/// answers an empty list. Without this guard the CLI fallback runs `git diff`
/// outside a repository, and git answers that with its whole usage text on
/// stderr — which became the review's error the moment the frontend started
/// awaiting all three status reads together.
#[tauri::command]
pub async fn git_numstat(path: String) -> Result<Vec<git::FileNumstat>, CommandError> {
    if !git::is_git_repo(&path).await {
        return Ok(Vec::new());
    }
    git::numstat(&path).await.map_err(CommandError::from)
}

/// Unified diff for one file. `staged` selects the index-vs-HEAD diff.
#[tauri::command]
pub async fn git_diff(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    staged: bool,
    target: Option<String>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::diff_file(&path, &file, staged)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Diff { path, file, staged })
            .await
            .map_err(CommandError::from),
    }
}

/// Before/after image versions for a changed **image** file, base64-encoded for
/// the visual diff viewer. `staged` selects HEAD→index vs index→working-tree,
/// mirroring `git_diff`. A missing side (added/deleted) comes back as `null`.
#[tauri::command]
pub async fn git_image_diff(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    staged: bool,
    target: Option<String>,
) -> Result<git::ImageDiff, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::image_diff(&path, &file, staged)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::ImageDiff { path, file, staged })
            .await
            .map_err(CommandError::from),
    }
}

/// Stage one file.
#[tauri::command]
pub async fn git_stage(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::stage_file(&path, &file)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Stage { path, file })
            .await
            .map_err(CommandError::from),
    }
}

/// Unstage one file.
#[tauri::command]
pub async fn git_unstage(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::unstage_file(&path, &file)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Unstage { path, file })
            .await
            .map_err(CommandError::from),
    }
}

/// Stage every change.
#[tauri::command]
pub async fn git_stage_all(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::stage_all(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::StageAll { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Unstage everything.
#[tauri::command]
pub async fn git_unstage_all(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::unstage_all(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::UnstageAll { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Discard a file's local changes (tracked → restore to HEAD; untracked → delete).
#[tauri::command]
pub async fn git_discard(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    file: String,
    untracked: bool,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::discard_file(&path, &file, untracked)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Discard {
                path,
                file,
                untracked,
            })
            .await
            .map_err(CommandError::from),
    }
}

/// Apply a unified-diff patch (a single hunk, from the frontend) to stage,
/// unstage, or discard it. `cached` targets the index; `reverse` reverses it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::apply_patch(&path, &patch, cached, reverse)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Apply {
                path,
                patch,
                cached,
                reverse,
            })
            .await
            .map_err(CommandError::from),
    }
}

/// Commit the staged changes with `message`. With `amend`, rewrites the current
/// `HEAD` commit instead of creating a new one. With `sign_off`, appends a
/// `Signed-off-by:` trailer using the configured git identity.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_commit(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    message: String,
    amend: bool,
    sign_off: bool,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "commit message is required".to_string(),
        )));
    }
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::commit(&path, &message, amend, sign_off)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Commit {
                path,
                message,
                amend,
                sign_off,
            })
            .await
            .map_err(CommandError::from),
    }
}

/// List the worktree's commit history (newest first), `limit` commits from
/// `skip`. Powers the right panel's "History" tab + branch graph.
#[tauri::command]
pub async fn git_log(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    limit: u32,
    skip: u32,
    target: Option<String>,
) -> Result<Vec<git::CommitInfo>, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::log(&path, limit as usize, skip as usize)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Log { path, limit, skip })
            .await
            .map_err(CommandError::from),
    }
}

/// Unified diff a single commit introduced (vs its first parent), for the
/// "History" tab's commit viewer.
#[tauri::command]
pub async fn git_show(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    hash: String,
    target: Option<String>,
) -> Result<String, CommandError> {
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => git::show(&path, &hash).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Show { path, hash })
            .await
            .map_err(CommandError::from),
    }
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
    /// Current HEAD commit. Changes even when a new local branch has no upstream
    /// and its working tree is clean, which is what keeps History live.
    pub head: Option<String>,
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
/// Errors (offline, no remote) surface to the caller. On a host it runs there,
/// with that machine's credentials and the agent this connection forwards.
#[tauri::command]
pub async fn git_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<git::WorktreeStatus, CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => {
            git::fetch_remote(&path).await.map_err(CommandError::from)?;
            git::worktree_status(&path)
                .await
                .map_err(CommandError::from)
        }
        Machine::Host(engine) => engine
            .git(GitCall::Fetch { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Push the current branch (`git push`). Not retried.
#[tauri::command]
pub async fn git_push(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::push(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Push { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Pull fast-forward-only (`git pull --ff-only`).
#[tauri::command]
pub async fn git_pull(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    match machine_for(&app, &state, target.as_deref(), Some(expect.as_ref())).await? {
        Machine::Here => git::pull(&path).await.map_err(CommandError::from),
        Machine::Host(engine) => engine
            .git(GitCall::Pull { path })
            .await
            .map_err(CommandError::from),
    }
}

/// Draft a commit message for `path`'s **staged** changes using the configured
/// AI agent (Settings → AI commit). Opt-in: errors when disabled/unconfigured,
/// when nothing is staged, or when the agent fails / times out. Returns the
/// message (subject on the first line, optional body after a blank line).
///
/// On a host the diff is read **there** and the agent runs **here**: the CLI
/// and its credentials are this machine's, and requiring one on every host
/// would put the feature behind an install nobody asked for. The agent then
/// stands in the user's home, since the project is not on this machine — the
/// whole diff is in the prompt (`aicommit::from_diff`).
#[tauri::command]
pub async fn git_generate_commit_message(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    target: Option<String>,
) -> Result<String, CommandError> {
    let cfg = state.data.read().await.settings.ai_commit.clone();
    match machine_for(&app, &state, target.as_deref(), None).await? {
        Machine::Here => crate::aicommit::generate(&path, &cfg)
            .await
            .map_err(CommandError::from),
        Machine::Host(engine) => {
            if !cfg.enabled {
                return Err(CommandError::from(AppError::Invalid(
                    "AI commit-message generation is disabled".to_string(),
                )));
            }
            let diff: String = engine
                .git(GitCall::StagedDiff { path })
                .await
                .map_err(CommandError::from)?;
            let home = crate::agent_hooks::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string());
            crate::aicommit::from_diff(&diff, &cfg, &home)
                .await
                .map_err(CommandError::from)
        }
    }
}

/// Name a conversation from what its terminal shows, using the session's own
/// agent CLI on that agent's cheapest model.
///
/// `transcript` is the session's visible text rather than a prompt/reply pair:
/// the hook payload carries neither for most agents (measured — only Claude
/// reports them), so anything shaped around it names two agents and silently
/// skips the rest.
///
/// **Best-effort by design.** The caller shows the generated name only if one
/// comes back; on any failure (no credit, the CLI missing, a timeout) the
/// session simply keeps the label it already had. Naming must never disturb a
/// session that is otherwise working.
#[tauri::command]
pub async fn generate_conversation_title(
    agent_id: String,
    transcript: String,
    cwd: String,
) -> Result<String, CommandError> {
    crate::convtitle::generate(&agent_id, &transcript, &cwd)
        .await
        .map_err(CommandError::from)
}

/// Which headlessly-drivable agents ([`crate::agentcli::SUPPORTED`]) are
/// installed in a runnable shape.
///
/// Callers use it to mark install state, not to decide what to offer: the AI
/// commit / PR-body pickers show their own **curated** list (the frontend's
/// `AI_COMMIT_AGENTS`) intersected with this, because being drivable is not the
/// same as being wired for that surface. The automations editor, which only
/// needs "can the backend run it", uses this list directly.
#[tauri::command]
pub async fn ai_commit_agents() -> Result<Vec<String>, CommandError> {
    Ok(crate::aicommit::available_agents())
}

/// The models offered by `agentId` for AI commit messages (static for
/// Claude, or a live CLI query for OpenCode/Pi/Codex/Antigravity/Grok). Best-effort: an empty
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
    // Opt-in auto-approve; absent means the safe default.
    autonomous: Option<bool>,
    // The caller's name for this run, so it can cancel it
    // (`agent_cancel_job`). The orchestration engine names every step it
    // dispatches; a caller that passes none simply cannot cancel.
    job_id: Option<String>,
) -> Result<crate::agentrun::HeadlessResult, CommandError> {
    // The app's steps count against the same budget every other process
    // shares, or "four at a time" would mean four *here* and four in each
    // automation running beside it. The slot is held for exactly as long as
    // the run (`_slot`), and a refusal is reported as busy — the engine puts
    // the step back and tries again, rather than failing work that was never
    // started.
    let dir = crate::automations::store::app_data_dir().map_err(CommandError::from)?;
    let limits = crate::automations::runner::limits();
    let _slot = crate::budget::acquire(&dir, limits.policy, &job_id.clone().unwrap_or_default())
        .await
        .map_err(|refused| CommandError::new("BUDGET_BUSY", refused.to_string()))?;
    crate::agentrun::run_headless(
        &agent,
        &model,
        &prompt,
        &cwd,
        timeout_ms,
        autonomous.unwrap_or(false),
        // An automation step runs the model as configured, effort included.
        &[],
        job_id.as_deref(),
        limits.memory_ceiling_mb,
    )
    .await
    .map_err(CommandError::from)
}

/// End a headless run the caller named, and the whole process tree under it.
///
/// This is what makes cancelling a run real: without it, stopping a run in the
/// console only stopped the *engine* — the agent it had already started kept
/// working, kept spending, and kept writing to the folder. Returns whether a
/// run by that name was in flight; a cancel that arrives after the run
/// finished is a race, not an error.
#[tauri::command]
pub async fn agent_cancel_job(job_id: String) -> Result<bool, CommandError> {
    Ok(crate::agentrun::cancel(&job_id))
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
    *state.agent_commands.write().await = commands.clone();
    // The host engines look for the same agents (`forward_host_agents`).
    for engine in state.ssh_engines.all().await {
        let _ = engine.watch_agents(commands.clone()).await;
    }
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
    /// The full `~/.codex/hooks.json` body (the `trusted_hash` in `config.toml` is
    /// auto-managed, so it isn't shown here).
    pub codex_json: String,
    /// The full `~/.grok/hooks/uxnan-status.json` body (a file we own outright).
    pub grok_json: String,
    /// The named entry the ADE adds to `~/.gemini/config/hooks.json`.
    pub antigravity_json: String,
    /// The per-event `curl` reporter Grok and Antigravity run (POSIX / Windows).
    pub event_hook_sh: String,
    pub event_hook_cmd: String,
    /// The in-process plugin source the ADE drops in OpenCode's `plugins/` dir.
    pub opencode_plugin_js: String,
    /// The in-process extension source the ADE drops in Pi's `extensions/` dir.
    pub pi_extension_js: String,
    /// The shell-agnostic relay used by Claude Code.
    pub status_relay_cjs: String,
    pub wrapper_bash: String,
    pub wrapper_powershell: String,
    pub wrapper_cmd: String,
    pub wrapper_fish: String,
}

/// Paths of the bundled hook scripts the ADE writes to the machine's shared
/// hooks directory (`agent_hooks::shared_hooks_dir`) on startup, plus the
/// resolved `~/.claude/settings.json` path. Settings →
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

/// Every agent the ADE can install a reporter for, with its install state and
/// whether the CLI itself looks present on this machine. One call instead of
/// three per agent: the panel lists whatever the backend registry holds, so
/// wiring a new agent never means touching the frontend's list.
#[tauri::command]
pub async fn list_agent_hooks() -> Result<Vec<agent_hooks::HookAgentEntry>, CommandError> {
    Ok(agent_hooks::read_all_agent_status(
        &crate::agentcli::command_installed,
    ))
}

/// Install (or refresh) one agent's managed reporter, merging it into that
/// agent's own configuration and preserving every hook the user wrote. Returns
/// the resulting state so the UI refreshes without a second round-trip.
#[tauri::command]
pub async fn install_agent_hooks(
    agent: String,
    state: State<'_, AppState>,
) -> Result<AgentHooksStatus, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_agent(&agent, &install).map_err(CommandError::from)
}

/// Remove one agent's managed reporter. Only ever strips what the ADE wrote —
/// the user's own hooks in the same file survive.
#[tauri::command]
pub async fn uninstall_agent_hooks(agent: String) -> Result<AgentHooksStatus, CommandError> {
    agent_hooks::uninstall_agent(&agent).map_err(CommandError::from)
}

/// Exactly what the ADE writes into one agent's config (Settings "Show
/// config"), rendered against the installed script paths so it can be copied
/// as-is. For OpenCode and Pi — whose reporter *is* a file — this is its source.
#[tauri::command]
pub async fn render_agent_hooks_config(
    agent: String,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::render_agent_config(&agent, &install).map_err(CommandError::from)
}

/// (Re)install the managed hooks for every supported agent. Used by the
/// Settings → Agents → Hooks "Install all" action and at startup.
#[tauri::command]
pub async fn install_all_hooks(state: State<'_, AppState>) -> Result<(), CommandError> {
    let install = state.hook_install.read().await.clone().ok_or_else(|| {
        CommandError::new("HOOK_SCRIPTS_MISSING", "hook scripts are not installed")
    })?;
    agent_hooks::install_all(
        &install,
        &crate::agentcli::command_installed,
        agent_hooks::Reach::EveryKnownAgent,
    );
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
    let codex_json = agent_hooks::render_codex_hooks_json(&install).map_err(CommandError::from)?;
    let grok_json = agent_hooks::render_grok_hooks_json().map_err(CommandError::from)?;
    let antigravity_json =
        agent_hooks::render_antigravity_hooks_json().map_err(CommandError::from)?;
    Ok(Some(HookScripts {
        claude_json,
        codex_json,
        grok_json,
        antigravity_json,
        event_hook_sh: agent_hooks::EVENT_HOOK_SH.to_string(),
        event_hook_cmd: agent_hooks::EVENT_HOOK_CMD.to_string(),
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

/// Determine whether a project-scoped number belongs to a PR or an issue.
#[tauri::command]
pub async fn github_work_item_kind(
    worktree_path: String,
    number: String,
) -> Result<crate::github::WorkItemKind, CommandError> {
    crate::github::work_item_kind(&worktree_path, &number)
        .await
        .map_err(CommandError::from)
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
    let resolved = resolve_worktree_location(&state, &repo_id, &repo_path, &branch).await?;
    worktreeloc::prepare(&resolved).await;
    let worktree_path = resolved.path;
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
/// as a **new worktree**. Repositories where the signed-in account cannot create
/// linked branches still get a local branch/worktree, so read access is enough to
/// begin isolated work. Returns the new entry.
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
    // Asked of git rather than guessed from a path, so a re-run finds the
    // existing checkout wherever it lives — including one created under the
    // previous sibling layout, or moved by hand.
    if let Ok(entries) = git::list_worktrees(&repo_path).await {
        if let Some(existing) = entries
            .into_iter()
            .find(|e| e.branch.as_deref() == Some(branch.as_str()))
        {
            return Ok(existing);
        }
    }
    let resolved = resolve_worktree_location(&state, &repo_id, &repo_path, &branch).await?;
    worktreeloc::prepare(&resolved).await;
    let worktree_path = resolved.path;
    // Prefer GitHub's linked branch. When the account can read the issue but may
    // not mutate the repository, fall back to a regular local branch rather than
    // making the issue launcher unusable. Authentication/network failures still
    // surface unchanged: only GitHub's explicit authorization failures qualify.
    let linked = match crate::github::issue_develop(&repo_path, &number, &branch).await {
        Ok(()) => true,
        Err(e) => {
            let message = e.to_string();
            if message.to_lowercase().contains("already") {
                true
            } else if issue_link_permission_denied(&message) {
                false
            } else {
                return Err(CommandError::from(e));
            }
        }
    };
    if linked {
        // Materialize the linked branch from origin. The explicit refspec creates
        // the local branch before the worktree checks it out.
        git::fetch(&repo_path, &format!("{branch}:{branch}"))
            .await
            .map_err(CommandError::from)?;
        git::add_worktree_existing(&repo_path, &branch, &worktree_path)
            .await
            .map_err(CommandError::from)?;
    } else {
        let base = git::default_base(&repo_path).await;
        git::add_worktree(&repo_path, &branch, &worktree_path, Some(&base))
            .await
            .map_err(CommandError::from)?;
    }
    Ok(WorktreeEntry {
        path: worktree_path,
        branch: Some(branch),
        head: None,
        is_main: false,
    })
}

fn issue_link_permission_denied(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("createlinkedbranch")
        || message.contains("correct permissions")
        || message.contains("resource not accessible")
        || message.contains("must have push access")
        || message.contains("permission denied")
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

/// What the app knows about its own diagnostics (see `diagnostics.rs`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    /// Absolute path of the live log file, so a bug report can point at it.
    /// `None` when the sink failed to initialize.
    pub log_path: Option<String>,
    /// Whether the previous session ended without reaching its clean exit path.
    pub previous_session_unclean: bool,
}

/// Record one line from the webview into the app's log.
///
/// This is how a frontend exception — the failure mode that leaves the window
/// blank while the process stays perfectly healthy, and which no OS crash
/// report ever captures — reaches the same timeline as the backend's own
/// events. Input is untrusted and sanitized by `diagnostics`; an unknown level
/// is recorded as an error rather than dropped.
#[tauri::command]
pub fn diagnostics_log(level: String, source: String, message: String) {
    crate::diagnostics::log(crate::diagnostics::Level::parse(&level), &source, &message);
}

/// Where the log lives, and whether the last session died without saying so.
///
/// Read once at boot by the frontend (`state/diagnostics.svelte.ts`), which
/// turns an unclean previous session into the startup notice and the
/// Settings → App → Diagnostics readout.
#[tauri::command]
pub fn diagnostics_report() -> DiagnosticsReport {
    match crate::diagnostics::sink() {
        Some(sink) => DiagnosticsReport {
            log_path: Some(sink.log_path().to_string_lossy().into_owned()),
            previous_session_unclean: sink.previous_session_unclean(),
        },
        None => DiagnosticsReport {
            log_path: None,
            previous_session_unclean: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::host_loopback_port;

    #[test]
    fn a_url_on_the_hosts_own_loopback_is_the_one_brought_here() {
        assert_eq!(
            host_loopback_port("http://localhost:5173/"),
            Some((5173, "/"))
        );
        assert_eq!(
            host_loopback_port("http://127.0.0.1:8069/web?db=x"),
            Some((8069, "/web?db=x"))
        );
        assert_eq!(host_loopback_port("http://0.0.0.0:3000"), Some((3000, "")));
        assert_eq!(
            host_loopback_port("http://[::1]:4000/a"),
            Some((4000, "/a"))
        );
        // Anything else is the same URL from here.
        assert_eq!(host_loopback_port("https://localhost:5173/"), None);
        assert_eq!(host_loopback_port("http://example.com:8080/"), None);
        assert_eq!(host_loopback_port("http://localhost/"), None);
    }
    use super::{
        bracketed_paste, ends_the_current_session, fs_path_exists, git_numstat,
        issue_link_permission_denied, missing_locally, preserve_backend_owned, pty_submit_payload,
        read_term_buffers, rect_on_any_monitor, redetect_git, reorder_by_ids, resting_corner,
        term_buffers_path, worth_retrying, TargetId,
    };
    use crate::model::{AppSettings, RepoData, SshHost, SshHostTombstone};

    /// A host's project is marked missing only on that host's own word: its
    /// filesystem refusing the folder. A dropped link or a slow engine is not a
    /// verdict, and marking on it would hide a working project behind a warning.
    #[test]
    fn a_hosts_folder_is_missing_only_when_its_filesystem_says_so() {
        use crate::error::AppError;
        let io = AppError::Io(std::io::Error::other("No such file or directory"));
        assert!(super::missing_on_host::<()>(Err(io)));
        assert!(super::missing_on_host::<()>(Err(AppError::NotFound(
            "x".into()
        ))));
        assert!(!super::missing_on_host(Ok(())));
        assert!(!super::missing_on_host::<()>(Err(AppError::NotConnected(
            "h1".into()
        ))));
        assert!(!super::missing_on_host::<()>(Err(AppError::Invalid(
            "the host engine did not answer in time".into()
        ))));
    }

    /// A file call goes where its target says, and nowhere else: this machine
    /// for none or `local`, and a host that is not connected is refused rather
    /// than answered from this disk at the same path.
    #[tokio::test]
    async fn a_project_call_is_served_on_the_machine_it_names() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = crate::state::AppState::new(
            crate::persistence::PersistenceManager::new(dir.path()),
            Default::default(),
            dir.path().to_path_buf(),
        );
        let handle = app.handle();
        for here in [None, Some(""), Some("local")] {
            assert!(matches!(
                super::machine_for(handle, &state, here, None).await,
                Ok(super::Machine::Here)
            ));
        }
        let Err(away) = super::machine_for(handle, &state, Some("ssh:gone"), None).await else {
            panic!("a host that is not connected has no files to serve");
        };
        assert_eq!(away.code, "NOT_CONNECTED", "{}", away.message);
        // A mutation is refused the same way before anything is checked.
        assert!(
            super::machine_for(handle, &state, Some("ssh:gone"), Some(None))
                .await
                .is_err()
        );
        let Err(bad) = super::machine_for(handle, &state, Some("ftp:box"), None).await else {
            panic!("an unknown kind of machine is refused");
        };
        assert_ne!(bad.code, "NOT_CONNECTED");
    }

    /// A watcher speaks only for its own incarnation.
    #[test]
    fn a_dead_session_never_removes_the_one_that_replaced_it() {
        // The connection that ended is still the one on file: clean it up.
        assert!(ends_the_current_session(Some(7), 7));
        // A reconnect already stored a newer one — taking it away here would
        // disconnect a host the user just reconnected.
        assert!(!ends_the_current_session(Some(8), 7));
        // Already gone (the user pressed Disconnect): nothing to clean.
        assert!(!ends_the_current_session(None, 7));
    }

    /// The ladder must not argue with the user, or dial forever.
    #[test]
    fn only_a_failure_that_could_clear_up_is_retried() {
        use super::SshConnectReport;
        let with = |status: &str, reason: Option<crate::ssh::conn::Unreachable>| {
            let mut r = SshConnectReport::of(status);
            r.reason = reason;
            r
        };

        // A machine that is asleep, still booting, or behind a link that blinked.
        assert!(worth_retrying(&with(
            "unreachable",
            Some(crate::ssh::conn::Unreachable::Timeout)
        )));
        assert!(worth_retrying(&with(
            "unreachable",
            Some(crate::ssh::conn::Unreachable::Refused)
        )));
        // A name that does not resolve resolves no better on the fourth attempt.
        assert!(!worth_retrying(&with(
            "unreachable",
            Some(crate::ssh::conn::Unreachable::UnknownAddress)
        )));

        // Anything that needs a person is never retried in the background: the
        // ladder exists to survive a blip, not to raise a password dialog at
        // someone who walked away.
        for status in [
            "needsPassword",
            "needsPassphrase",
            "hostUnknown",
            "hostChanged",
            "hostRevoked",
            "noUsableMethod",
        ] {
            assert!(!worth_retrying(&with(status, None)), "{status}");
        }
        // And a connected report ends the ladder rather than continuing it.
        assert!(!worth_retrying(&with("connected", None)));
    }

    fn host(id: &str) -> SshHost {
        SshHost {
            id: id.into(),
            label: id.into(),
            config_host: None,
            hostname: "10.0.0.5".into(),
            port: 22,
            user: "dev".into(),
            identity_files: vec![],
            identity_agent: None,
            identities_only: false,
            forward_agent: false,
            proxy_command: None,
            proxy_jump: None,
            source: Default::default(),
            needs_prompt: false,
        }
    }

    #[test]
    fn a_hosts_project_is_never_called_missing_from_here() {
        // Reported from the app: a healthy project on a host wore the "its
        // folder is gone" warning, because the check ran `is_dir` on *this*
        // machine against the other machine's path. The neighbour on a second
        // host escaped it only because that host was this same PC — so the
        // warning looked selective instead of simply wrong.
        let remote = TargetId::parse("ssh:h1").unwrap();
        assert!(
            !missing_locally(&remote, r"C:\Users\gamas\code\nothing-here"),
            "this filesystem cannot answer for another machine"
        );
        // Even a path that does exist here is not evidence about the host.
        let here = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(!missing_locally(&remote, &here));
    }

    #[test]
    fn a_local_project_that_is_gone_is_still_reported() {
        // The feature itself must keep working for the projects it is about.
        let local = TargetId::Local;
        let here = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(!missing_locally(&local, &here), "a folder that is there");
        assert!(missing_locally(
            &local,
            &format!("{here}/definitely-not-here-9f2")
        ));
    }

    #[test]
    fn a_project_on_a_host_reports_one_workspace_and_no_branch() {
        // Local git must not be run against a path that belongs to another
        // machine: at best it fails, and at worst a folder with the same
        // absolute path exists here and answers for the wrong repository.
        let entries = crate::control::services::worktree::worktrees_without_git(
            &TargetId::parse("ssh:h1").unwrap(),
            r"C:\Users\dev\code",
        )
        .expect("a remote project answers without git");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, r"C:\Users\dev\code");
        assert!(entries[0].is_main);
        assert!(entries[0].branch.is_none(), "no branch may be invented");
        assert!(entries[0].head.is_none());
    }

    #[test]
    fn a_local_project_is_still_asked_of_git() {
        // The guard must be exactly "not local", not "always synthetic" — every
        // local project depends on the real worktree list.
        assert!(crate::control::services::worktree::worktrees_without_git(
            &TargetId::Local,
            r"C:\code\uxnan"
        )
        .is_none());
    }

    #[test]
    fn a_settings_write_from_the_ui_cannot_delete_the_hosts() {
        // The bug this exists for: the UI sends the whole settings object, does
        // not model the host list, and so used to send an empty one — deleting
        // every host on any unrelated settings change.
        let mut stored = AppSettings {
            ssh_hosts: vec![host("h1"), host("h2")],
            removed_ssh_hosts: vec![SshHostTombstone {
                host_id: "gone".into(),
                config_host: None,
                hostname: "old".into(),
                port: 22,
                user: "dev".into(),
                label: "old".into(),
                removed_at: 1,
            }],
            ..AppSettings::default()
        };
        let from_ui = AppSettings {
            left_sidebar_width: 999,
            ..AppSettings::default()
        };

        let merged = preserve_backend_owned(&mut stored, from_ui);

        assert_eq!(merged.ssh_hosts.len(), 2, "the hosts must survive");
        assert_eq!(merged.removed_ssh_hosts.len(), 1, "and the tombstones");
        // Tombstones matter as much as the hosts: lose them and a re-added
        // machine gets a new id, stranding its projects and its live session.
        assert_eq!(merged.removed_ssh_hosts[0].host_id, "gone");
        // Everything the user *did* change still lands.
        assert_eq!(merged.left_sidebar_width, 999);
    }

    #[test]
    fn issue_link_falls_back_only_for_authorization_failures() {
        assert!(issue_link_permission_denied(
            "GraphQL: viewer does not have the correct permissions to execute CreateLinkedBranch"
        ));
        assert!(issue_link_permission_denied(
            "GraphQL: Resource not accessible by integration"
        ));
        assert!(!issue_link_permission_denied(
            "failed to connect to github.com"
        ));
        assert!(!issue_link_permission_denied("issue not found"));
    }

    #[test]
    fn a_pet_position_on_an_unplugged_monitor_is_rejected() {
        // One live 1920×1080 monitor at the origin; the saved spot belonged to a
        // second display that is gone. The placement must fall back rather than
        // strand the pet off-screen.
        let monitors = [((0, 0), (1920_u32, 1080_u32))];
        assert!(!rect_on_any_monitor((2200, 300), (200, 200), &monitors));
        // No monitors at all (headless race while displays reconfigure): reject.
        assert!(!rect_on_any_monitor((100, 100), (200, 200), &[]));
    }

    #[test]
    fn a_pet_position_partly_on_a_live_monitor_is_kept() {
        let monitors = [
            ((0, 0), (1920_u32, 1080_u32)),
            ((1920, 0), (1280_u32, 1024_u32)),
        ];
        assert!(rect_on_any_monitor((100, 100), (200, 200), &monitors));
        // Half off the left edge still counts — some of the pet is visible.
        assert!(rect_on_any_monitor((-100, 100), (200, 200), &monitors));
        // On the secondary monitor.
        assert!(rect_on_any_monitor((2000, 200), (200, 200), &monitors));
        // Fully past every edge does not.
        assert!(!rect_on_any_monitor((3300, 100), (200, 200), &monitors));
    }

    #[test]
    fn the_fallback_resting_corner_lands_on_the_monitor() {
        // The fallback must itself pass the visibility test, or the rescue path
        // would re-strand the pet it just rescued — including on a scaled display
        // and on a monitor that does not sit at the origin.
        for (mpos, msize, scale) in [
            ((0, 0), (1920_u32, 1080_u32), 1.0),
            ((1920, 240), (2560_u32, 1440_u32), 1.5),
        ] {
            let size = (160, 176);
            let corner = resting_corner(mpos, msize, scale, size);
            assert!(
                rect_on_any_monitor(corner, size, &[(mpos, msize)]),
                "resting corner {corner:?} is off the monitor at {mpos:?} {msize:?} (scale {scale})"
            );
        }
    }

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

    /// A plain folder that later runs `git init` must become a repository in
    /// the record too — and a record that is already right is not rewritten.
    #[test]
    fn a_project_record_follows_what_its_folder_became() {
        let mut repo = RepoData {
            id: "r".into(),
            name: "plain".into(),
            path: "/tmp/plain".into(),
            target: TargetId::Local,
            worktrees: Vec::new(),
            is_git: false,
            icon: None,
            branch_icons: std::collections::HashMap::new(),
            worktree_order: Vec::new(),
            worktree_root: None,
        };
        // Still a folder: nothing to write.
        assert!(!redetect_git(&mut repo, false));
        assert!(!repo.is_git);
        // `git init` happened: the record flips and says so.
        assert!(redetect_git(&mut repo, true));
        assert!(repo.is_git);
        // Asked again with the same answer: no write.
        assert!(!redetect_git(&mut repo, true));
        // `.git` removed: it follows the folder back.
        assert!(redetect_git(&mut repo, false));
        assert!(!repo.is_git);
    }

    /// A registered folder that is not a repository is a valid project with
    /// nothing to review. Every read the Changes panel and a row make must
    /// answer "not a repository" for it, not an error — one erroring is what
    /// put git's whole `diff` usage text in a toast.
    #[tokio::test]
    async fn the_review_reads_are_quiet_for_a_plain_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        tokio::fs::write(dir.path().join("notes.txt"), b"plain")
            .await
            .expect("write");
        let path = dir.path().to_string_lossy().into_owned();
        assert_eq!(git_numstat(path.clone()).await.unwrap(), Vec::new());
        assert_eq!(
            crate::git::review(&path).await.unwrap(),
            crate::git::Review::default()
        );
        assert!(!crate::git::repo_status(&path).await.unwrap().is_repo);
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

    /// The file panel's recovery, end to end against this machine's sshd.
    ///
    /// The reported failure was a host whose terminals worked while every folder
    /// answered `session closed`, so the test builds exactly that state — a live
    /// connection with a dead file session cached on it — and asks for a listing.
    ///
    /// It has to be live: what makes a session unusable is its channel ending,
    /// and no fake can produce the library's own behavior when it does.
    mod remote_files {
        use crate::persistence::PersistenceManager;
        use crate::ssh;
        use crate::state::AppState;
        use std::sync::Arc;

        const HOST: &str = "live-host";

        /// A connected host in an otherwise empty app.
        async fn state_with_a_live_host() -> (tempfile::TempDir, AppState) {
            use ssh::auth::{authenticate, AuthOutcome, Credential};
            use ssh::conn::{connect, Endpoint, Handshake};

            let user = std::env::var("UXNAN_SSH_TEST_USER")
                .or_else(|_| std::env::var("USERNAME"))
                .expect("a username");
            let endpoint = Endpoint::new("127.0.0.1", 22);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("expected an unknown host");
            };
            let trusted = ssh::hostkey::trust_line("127.0.0.1", 22, &key);
            let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
                panic!("the recorded key should verify");
            };
            match authenticate(&mut conn, &user, &[Credential::Agent])
                .await
                .unwrap()
            {
                AuthOutcome::Success { .. } => {}
                other => panic!("authenticate with the agent first: {other:?}"),
            }

            let dir = tempfile::tempdir().unwrap();
            let state = AppState::new(
                PersistenceManager::new(dir.path()),
                Default::default(),
                dir.path().to_path_buf(),
            );
            state
                .ssh_sessions
                .write()
                .await
                .insert(HOST.to_string(), Arc::new(*conn));
            (dir, state)
        }

        /// The freeze the user hit: adding a second host and connecting it left
        /// Settings spinning, and removing it spun too.
        ///
        /// The cause was not SSH being slow — it was `ssh_sessions` being held
        /// **across** the network. It is a fair lock, so the write a connect
        /// needs queues behind the reader that is mid-round-trip, and every
        /// later reader queues behind that write. This holds the invariant that
        /// makes that impossible: after a caller has its connection, the lock is
        /// free — including while it is actually talking to the host.
        #[tokio::test]
        #[ignore = "needs a local sshd that authorizes a key in the agent"]
        async fn talking_to_a_host_never_holds_the_session_lock() {
            let (_dir, state) = state_with_a_live_host().await;

            let conn = super::super::session_for(&state, HOST)
                .await
                .expect("a session");
            assert!(
                state.ssh_sessions.try_write().is_ok(),
                "the registry must be writable the moment a caller has its connection"
            );

            // And while a real command is in flight on that connection, a
            // connect (which needs the write) must not have to wait for it.
            let slow = tokio::spawn(async move {
                // Any command will do: what matters is that it is a round trip.
                let _ = conn.exec("cd .").await;
            });
            let start = std::time::Instant::now();
            {
                let mut sessions = state.ssh_sessions.write().await;
                sessions.remove("nobody");
            }
            let waited = start.elapsed();
            assert!(
                waited < std::time::Duration::from_millis(500),
                "a connect waited {waited:?} for an unrelated command to finish"
            );
            let _ = slow.await;
            println!("live: the write took {waited:?} with a command in flight");
        }
    }
}
