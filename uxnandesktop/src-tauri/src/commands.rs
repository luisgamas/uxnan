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
    Ok(data.clone())
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
    if let Some(win) = app.get_webview_window("main") {
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
        let shell = {
            let known = state.ssh_shells.read().await.get(&host_id).copied();
            match known {
                Some(kind) => kind,
                None => {
                    let kind = crate::ssh::shellkind::classify(&conn).await;
                    state.ssh_shells.write().await.insert(host_id.clone(), kind);
                    kind
                }
            }
        };

        let out_app = app.clone();
        let out_id = id.clone();
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
                {
                    // A dev server on the host announces its address the moment
                    // it is ready, and that line is already on its way to the
                    // terminal — so reading it costs nothing and needs nothing
                    // installed there (`crate::portscan`). Only remote terminals
                    // are scanned: a local server is already reachable, so
                    // announcing it would be noise about nothing.
                    let announce_app = app.clone();
                    let announce_host = host_id.clone();
                    let announce_id = id.clone();
                    let tail = std::sync::Mutex::new(crate::portscan::Tail::default());
                    move |bytes: &[u8]| {
                        let _ = out_app.emit(&format!("pty:output:{out_id}"), bytes.to_vec());
                        let text = String::from_utf8_lossy(bytes);
                        // A poisoned lock would mean a panic in this closure,
                        // which cannot happen here; either way the terminal's
                        // output must not stop because a scan did.
                        let found = match tail.lock() {
                            Ok(mut tail) => tail.scan(&text),
                            Err(_) => Vec::new(),
                        };
                        for announced in found {
                            let _ = announce_app.emit(
                                "ports:announced",
                                AnnouncedPort {
                                    host_id: announce_host.clone(),
                                    terminal_id: announce_id.clone(),
                                    port: announced.port,
                                    path: announced.path,
                                },
                            );
                        }
                    }
                },
                move || {
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

    // Browser-control MCP (spec `02d` §1.6): expose the `/mcp` endpoint + token so
    // this terminal's agents can reach it, and register the server **for this
    // launch only** (see `mcpinject.rs`) — nothing is written to any config the
    // user keeps, so an agent started outside uxnan never sees the server at all.
    // Env-registered agents (OpenCode) are covered right here; the flag-registered
    // ones (Claude, Codex) get their arguments appended to the command the
    // frontend types (`$lib/mcpLaunch`), which reads the same two switches — so
    // both halves are gated identically: the browser master switch, then the MCP one.
    if browser_enabled && mcp_enabled {
        if let Some(h) = &hook {
            let endpoint = crate::mcpinject::mcp_endpoint(&h.url);
            env.push(("UXNAN_MCP_URL".to_string(), endpoint.clone()));
            env.push((crate::mcpinject::TOKEN_ENV.to_string(), h.token.clone()));
            let disabled: std::collections::HashSet<&str> =
                mcp_disabled.iter().map(String::as_str).collect();
            env.extend(crate::mcpinject::launch_env_all(&endpoint, &disabled));
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
    pub agents: Vec<crate::mcpinject::AgentInfo>,
}

/// Return the browser MCP server coordinates + per-launch agent catalog. Used by
/// the Settings panel (per-agent toggles + snippet) **and** by the launch path,
/// which appends each agent's `args` to the command it types. The token is the
/// app's own local loopback secret, surfaced only so the user can copy a
/// ready-to-paste config for an agent the ADE doesn't auto-configure.
#[tauri::command]
pub async fn mcp_info(app: AppHandle, state: State<'_, AppState>) -> Result<McpInfo, CommandError> {
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
        agents: crate::mcpinject::agent_infos(endpoint.as_deref(), claude_config.as_deref()),
    })
}

/// Send user input to a PTY's stdin.
#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), CommandError> {
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
// coding TUI — Claude Code, Codex, OpenCode, Pi, Antigravity — does). A multi-line
// submit into an agent with a *long* post-paste Enter guard may still not fire; if
// one is found, add a per-agent submit strategy (delay / key) here. See FOR-DEV.md.
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
    if state.ssh_pty.owns(&id).await {
        // No local process tree to account for: this terminal never had one.
        return state.ssh_pty.close(&id).await.map_err(CommandError::from);
    }
    state
        .resources
        .terminal_closed(&id, crate::resources::now_ms());
    state.pty.close(&id).map_err(CommandError::from)
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

/// What reaching a host said about its identity, before any credential.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostProbe {
    /// `trusted` | `unknown` | `changed` | `revoked`.
    pub status: String,
    /// The fingerprint to show the user, in OpenSSH's own format.
    pub fingerprint: Option<String>,
    pub algorithm: Option<String>,
    /// For `changed`: what `known_hosts` has on file instead.
    pub stored_fingerprint: Option<String>,
}

/// Reach a host and report what `known_hosts` says about the key it presents.
///
/// Nothing is written and no credential is offered. On `unknown` the key is held
/// in memory so [`ssh_host_trust`] can record *exactly what the server
/// presented* once the user confirms — the blob never travels through the UI.
#[tauri::command]
pub async fn ssh_host_probe(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<SshHostProbe, CommandError> {
    let host = find_ssh_host(&state, &host_id).await?;
    let known = ssh::hostkey::read_known_hosts(&known_hosts_path()?).map_err(CommandError::from)?;
    let endpoint = ssh::conn::Endpoint::new(host.hostname.clone(), host.port);

    match ssh::conn::connect(endpoint, &known)
        .await
        .map_err(CommandError::from)?
    {
        ssh::conn::Handshake::Ready(_) => Ok(SshHostProbe {
            status: "trusted".into(),
            fingerprint: None,
            algorithm: None,
            stored_fingerprint: None,
        }),
        // Not a verdict about the key: nothing was presented, because nothing
        // answered. Reported as its own status rather than folded into
        // "unknown", which would invite the user to trust a machine we never
        // spoke to.
        ssh::conn::Handshake::Unreachable { detail, .. } => Ok(SshHostProbe {
            status: "unreachable".into(),
            fingerprint: Some(detail),
            algorithm: None,
            stored_fingerprint: None,
        }),
        ssh::conn::Handshake::Unknown { fingerprint, key } => {
            let algorithm = key.algorithm.clone();
            state.ssh_pending_keys.write().await.insert(host_id, key);
            Ok(SshHostProbe {
                status: "unknown".into(),
                fingerprint: Some(fingerprint),
                algorithm: Some(algorithm),
                stored_fingerprint: None,
            })
        }
        ssh::conn::Handshake::Changed {
            presented_fingerprint,
            stored_fingerprint,
        } => Ok(SshHostProbe {
            status: "changed".into(),
            fingerprint: Some(presented_fingerprint),
            algorithm: None,
            stored_fingerprint: Some(stored_fingerprint),
        }),
        ssh::conn::Handshake::Revoked { fingerprint } => Ok(SshHostProbe {
            status: "revoked".into(),
            fingerprint: Some(fingerprint),
            algorithm: None,
            stored_fingerprint: None,
        }),
    }
}

/// Record the key a probe just saw, after the user confirmed the fingerprint.
///
/// Only ever appends the key **this app watched the server present**, and only
/// for a host whose probe came back `unknown`. There is deliberately no way to
/// trust a *changed* key from here: that path exists to be refused.
#[tauri::command]
pub async fn ssh_host_trust(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<bool, CommandError> {
    let host = find_ssh_host(&state, &host_id).await?;
    let Some(key) = state.ssh_pending_keys.write().await.remove(&host_id) else {
        return Err(CommandError::from(AppError::Invalid(
            "no host key is awaiting confirmation for this host".to_string(),
        )));
    };
    let line = ssh::hostkey::trust_line(&host.hostname, host.port, &key);
    append_known_host(&line).map_err(CommandError::from)?;
    Ok(true)
}

/// The result of trying to open a working session on a host.
///
/// One shape for every outcome, because each one sends the user somewhere
/// different and "it failed" sends them nowhere.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectReport {
    /// `connected` | `hostUnknown` | `hostChanged` | `hostRevoked` |
    /// `needsPassword` | `needsPassphrase` | `failed` | `noUsableMethod` |
    /// `unreachable`.
    pub status: String,
    /// For `unreachable`: which kind of not-reachable it was (`timeout` |
    /// `unknownAddress` | `refused` | `handshake`). They lead to different
    /// actions — a machine that is asleep is worth another try, a name that does
    /// not resolve is not — and one failure string made them look alike.
    pub reason: Option<ssh::conn::Unreachable>,
    /// A sentence naming the host and what happened, for `unreachable`.
    pub detail: Option<String>,
    /// The connection incarnation, for `connected`. Travels with every mutation
    /// prepared against this session (`target::TargetExpectation`).
    pub generation: Option<u64>,
    /// Which credential worked, so the UI can say how you got in.
    pub method: Option<String>,
    /// For the host-key outcomes.
    pub fingerprint: Option<String>,
    pub stored_fingerprint: Option<String>,
    /// For `needsPassphrase`: which key file needs one.
    pub path: Option<String>,
    /// What was offered and refused, in order, so the message can name it.
    pub attempted: Vec<String>,
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
            path: None,
            attempted: Vec::new(),
        }
    }
}

/// Open an authenticated session on a host and keep it.
///
/// Idempotent: a host that already has a live session reports it rather than
/// opening a second one. Everything that runs on the host — terminal, inventory,
/// git — shares this connection, which is the point of an in-process client.
///
/// `password` is supplied only on a retry, after the app has asked for it. It is
/// used for this attempt and never stored.
#[tauri::command]
pub async fn ssh_host_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    password: Option<String>,
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
    connect_fresh(app, state, host_id, password).await
}

/// Reach a host that has no live session, from the host key to the shell it
/// starts. Split out of [`ssh_host_connect`] so both the first connection and a
/// replacement for one that ended take exactly the same path.
async fn connect_fresh(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    password: Option<String>,
) -> Result<SshConnectReport, CommandError> {
    let host = find_ssh_host(&state, &host_id).await?;
    let known = ssh::hostkey::read_known_hosts(&known_hosts_path()?).map_err(CommandError::from)?;
    let endpoint = ssh::conn::Endpoint::new(host.hostname.clone(), host.port);

    let mut connection = match ssh::conn::connect(endpoint, &known)
        .await
        .map_err(CommandError::from)?
    {
        ssh::conn::Handshake::Ready(conn) => conn,
        ssh::conn::Handshake::Unreachable { why, detail } => {
            let mut report = SshConnectReport::of("unreachable");
            report.reason = Some(why);
            report.detail = Some(detail);
            return Ok(report);
        }
        ssh::conn::Handshake::Unknown { fingerprint, key } => {
            let mut report = SshConnectReport::of("hostUnknown");
            report.fingerprint = Some(fingerprint);
            state
                .ssh_pending_keys
                .write()
                .await
                .insert(host_id.clone(), key);
            return Ok(report);
        }
        ssh::conn::Handshake::Changed {
            presented_fingerprint,
            stored_fingerprint,
        } => {
            let mut report = SshConnectReport::of("hostChanged");
            report.fingerprint = Some(presented_fingerprint);
            report.stored_fingerprint = Some(stored_fingerprint);
            return Ok(report);
        }
        ssh::conn::Handshake::Revoked { fingerprint } => {
            let mut report = SshConnectReport::of("hostRevoked");
            report.fingerprint = Some(fingerprint);
            return Ok(report);
        }
    };

    // The agent first, then the key files this host's config points at, then a
    // password if the user has already been asked for one.
    let mut credentials = ssh::auth::credentials_for(true, &host.identity_files);
    if let Some(password) = password {
        credentials.push(ssh::auth::Credential::Password(password));
    }

    let outcome = ssh::auth::authenticate(&mut connection, &host.user, &credentials)
        .await
        .map_err(CommandError::from)?;

    match outcome {
        ssh::auth::AuthOutcome::Success { method } => {
            let mut report = SshConnectReport::of("connected");
            report.generation = Some(connection.generation());
            report.method = Some(method);
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
            watch_session(app, host_id.clone(), generation, session);
            // Remember that this host let us in without asking, so startup can
            // reconnect the silent ones and leave the rest until the user is here.
            set_needs_prompt(&state, &host_id, false).await?;
            Ok(report)
        }
        ssh::auth::AuthOutcome::NeedsPassword { attempted } => {
            let mut report = SshConnectReport::of("needsPassword");
            report.attempted = attempted;
            set_needs_prompt(&state, &host_id, true).await?;
            Ok(report)
        }
        ssh::auth::AuthOutcome::NeedsPassphrase { path } => {
            let mut report = SshConnectReport::of("needsPassphrase");
            report.path = Some(path);
            set_needs_prompt(&state, &host_id, true).await?;
            Ok(report)
        }
        ssh::auth::AuthOutcome::Failed { attempted } => {
            let mut report = SshConnectReport::of("failed");
            report.attempted = attempted;
            Ok(report)
        }
        ssh::auth::AuthOutcome::NoUsableMethod => Ok(SshConnectReport::of("noUsableMethod")),
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
fn watch_session(
    app: AppHandle,
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
async fn reconnect_ladder(app: AppHandle, host_id: String) {
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

        match connect_fresh(app.clone(), state, host_id.clone(), None).await {
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

/// Whether this host is one the app may bring back without asking anything —
/// the same rule `ssh_hosts_resumable` applies at startup.
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
    if host.needs_prompt {
        return false;
    }
    let Ok(path) = known_hosts_path() else {
        return false;
    };
    let known = ssh::hostkey::read_known_hosts(&path).unwrap_or_default();
    ssh::hostkey::is_known(&known, &host.hostname, host.port)
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
/// adds a project living there. An empty `path` starts at that machine's home.
#[tauri::command]
pub async fn ssh_browse_dirs(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<ssh::browse::RemoteListing, CommandError> {
    let dir = path.as_str();
    with_sftp(&state, &host_id, |session| async move {
        ssh::browse::list_dirs(&session, dir).await
    })
    .await
}

/// Register a folder that lives on a host as a project.
///
/// The path is the host's, so it is stored exactly as that machine spells it;
/// the identity is the pair `(target, path)`, which is why the same absolute
/// path on two machines is two projects rather than one.
#[tauri::command]
pub async fn ssh_repo_add(
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
    let is_git = {
        let folder = path.as_str();
        // Never a reason to refuse the project: `is_git_repo` answers `false`
        // when it could not look, and a session that is not there is the same
        // kind of "could not look".
        with_sftp(&state, &host_id, |session| async move {
            Ok(ssh::browse::is_git_repo(&session, folder).await)
        })
        .await
        .unwrap_or(false)
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

/// A worktree's git state **on a host**: branch plus changed/ahead/behind.
///
/// Reached through `exec`, so it goes through that machine's shell — the one
/// place remote git differs from remote files, which use a subsystem. The shell
/// is the one the host reported when it connected, and every argument is quoted
/// for it; an unnamed shell, a missing git or a plain folder all answer
/// `isRepo: false`, which the UI must render as "not read" rather than "clean".
#[tauri::command]
pub async fn ssh_git_status(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<ssh::git::RemoteGitStatus, CommandError> {
    let shell = state
        .ssh_shells
        .read()
        .await
        .get(&host_id)
        .copied()
        .unwrap_or_default();
    let Some(conn) = session_for(&state, &host_id).await else {
        return Err(CommandError::from(AppError::Invalid(
            "connect to this host before reading its git state".to_string(),
        )));
    };
    Ok(ssh::git::status(&conn, shell, &path).await)
}

/// What the remote git layer needs on every call: the connection, and the shell
/// the host reported when it connected.
///
/// Both together, because either alone is useless — a connection with no shell
/// cannot be sent a quoted argument safely, and the shell of a host that is not
/// connected describes nothing.
async fn remote_git(
    state: &AppState,
    host_id: &str,
) -> Result<
    (
        std::sync::Arc<ssh::conn::Connection>,
        ssh::shellkind::ShellKind,
    ),
    CommandError,
> {
    let shell = state
        .ssh_shells
        .read()
        .await
        .get(host_id)
        .copied()
        .unwrap_or_default();
    let Some(conn) = session_for(state, host_id).await else {
        return Err(CommandError::from(AppError::NotConnected(
            host_id.to_string(),
        )));
    };
    Ok((conn, shell))
}

/// Same, for a mutation: refuses unless the caller is still looking at the host
/// and connection it thought it was.
///
/// The check runs **before** anything is sent, for the reason `ssh_fs_write`
/// gives — a stage or a discard cannot be taken back once the host has run it,
/// so a late check would only be able to report the damage.
async fn remote_git_fenced(
    state: &AppState,
    host_id: &str,
    expect: Option<TargetExpectation>,
) -> Result<
    (
        std::sync::Arc<ssh::conn::Connection>,
        ssh::shellkind::ShellKind,
    ),
    CommandError,
> {
    let (conn, shell) = remote_git(state, host_id).await?;
    target::check(
        expect.as_ref(),
        &TargetId::Ssh(host_id.to_string()),
        conn.generation(),
    )
    .map_err(CommandError::from)?;
    Ok((conn, shell))
}

/// Everything the Changes panel needs about a worktree on a host, in one round
/// trip: HEAD, ahead/behind, the changed files and their line counts.
///
/// One command rather than the local layer's four, because each of those is a
/// round trip to another machine and the panel asks for all of them at once —
/// on a link with 60 ms of latency, four separate reads is a quarter of a second
/// of nothing happening. See `ssh::git::review`.
#[tauri::command]
pub async fn ssh_git_review(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<ssh::git::RemoteReview, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    Ok(ssh::git::review(&conn, shell, &path).await)
}

/// A file's diff on a host, staged or unstaged.
#[tauri::command]
pub async fn ssh_git_diff(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
    staged: bool,
) -> Result<String, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::git::diff(&conn, shell, &path, &file, staged)
        .await
        .map_err(CommandError::from)
}

/// A file's diff against `HEAD` on a host — the editor's change gutter.
#[tauri::command]
pub async fn ssh_git_diff_head(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
) -> Result<String, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::git::diff_head(&conn, shell, &path, &file)
        .await
        .map_err(CommandError::from)
}

/// Draft a commit message for a project on a host.
///
/// The diff is read **there** and the agent runs **here**: the CLI and its
/// credentials are this machine's, and requiring one on every host would put
/// the feature behind an install nobody asked for. The agent is started in the
/// user's home rather than the project, which does not exist on this machine —
/// the whole diff is in the prompt, so the directory is only where the process
/// stands (`aicommit::from_diff`).
#[tauri::command]
pub async fn ssh_git_generate_commit_message(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<String, CommandError> {
    let cfg = state.data.read().await.settings.ai_commit.clone();
    if !cfg.enabled {
        return Err(CommandError::from(AppError::Invalid(
            "AI commit-message generation is disabled".to_string(),
        )));
    }
    let (conn, shell) = remote_git(&state, &host_id).await?;
    // Everything staged, in one command — the same diff the local path feeds the
    // agent, read from the machine the project is on.
    let diff = ssh::git::diff(&conn, shell, &path, ".", true)
        .await
        .map_err(CommandError::from)?;
    let home = crate::agent_hooks::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    crate::aicommit::from_diff(&diff, &cfg, &home)
        .await
        .map_err(CommandError::from)
}

/// Before/after versions of an image on a host, for the visual diff viewer.
///
/// The committed side comes from `git show` with its bytes kept as bytes; the
/// working-tree side over SFTP. Nothing is base64-ed by the host, so no tool has
/// to exist there (`ssh::git::image_diff`).
#[tauri::command]
pub async fn ssh_git_image_diff(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
    staged: bool,
) -> Result<git::ImageDiff, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    let session = sftp_for(&state, &host_id).await?;
    ssh::git::image_diff(&conn, &session, shell, &path, &file, staged)
        .await
        .map_err(CommandError::from)
}

/// A host worktree's history, newest first.
#[tauri::command]
pub async fn ssh_git_log(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    limit: u32,
    skip: u32,
) -> Result<Vec<git::CommitInfo>, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::git::log(&conn, shell, &path, limit, skip)
        .await
        .map_err(CommandError::from)
}

/// One commit's patch, on a host.
#[tauri::command]
pub async fn ssh_git_show(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    hash: String,
) -> Result<String, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::git::show(&conn, shell, &path, &hash)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn ssh_git_stage(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::stage(&conn, shell, &path, &file)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn ssh_git_unstage(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::unstage(&conn, shell, &path, &file)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn ssh_git_stage_all(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::stage_all(&conn, shell, &path)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn ssh_git_unstage_all(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::unstage_all(&conn, shell, &path)
        .await
        .map_err(CommandError::from)
}

/// Throw a file's changes away on a host. Fenced like every other mutation, and
/// the one where being wrong about *which* machine is unrecoverable.
#[tauri::command]
pub async fn ssh_git_discard(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    file: String,
    untracked: bool,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::discard(&conn, shell, &path, &file, untracked)
        .await
        .map_err(CommandError::from)
}

/// Apply a patch on a host — the per-hunk actions. The patch travels over SFTP,
/// not through the shell (`ssh::git::apply_patch`).
#[tauri::command]
pub async fn ssh_git_apply(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    let session = sftp_for(&state, &host_id).await?;
    ssh::git::apply_patch(&conn, &session, shell, &path, &patch, cached, reverse)
        .await
        .map_err(CommandError::from)
}

/// Commit on a host. The message travels over SFTP for the same reason
/// (`ssh::git::commit`).
#[tauri::command]
pub async fn ssh_git_commit(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    message: String,
    amend: bool,
    sign_off: bool,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    let session = sftp_for(&state, &host_id).await?;
    ssh::git::commit(
        &conn,
        &session,
        shell,
        &path,
        message.trim(),
        amend,
        sign_off,
    )
    .await
    .map_err(CommandError::from)
}

/// Fetch, push or pull on a host, then read the worktree back so the panel's
/// ahead/behind bar reflects what just happened without a second round trip.
#[tauri::command]
pub async fn ssh_git_sync(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    action: ssh::git::SyncAction,
    expect: Option<TargetExpectation>,
) -> Result<git::WorktreeStatus, CommandError> {
    let (conn, shell) = remote_git_fenced(&state, &host_id, expect).await?;
    ssh::git::sync(&conn, shell, &path, action)
        .await
        .map_err(CommandError::from)?;
    Ok(ssh::git::review(&conn, shell, &path).await.status)
}

/// Filename search in a host's project.
///
/// Asks git on that machine rather than walking it over SFTP: a walk would be
/// one request per folder across a network, and the local search already means
/// "the files git would list" (`ssh::search`). A folder that is not a repository
/// there is refused with that as the reason, rather than answering an empty list
/// nobody can tell from "no matches".
#[tauri::command]
pub async fn ssh_fs_search_files(
    state: State<'_, AppState>,
    host_id: String,
    root: String,
    query: String,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
) -> Result<crate::fs::FileSearch, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::search::files(&conn, shell, &root, &query, include_hidden, &filters, limit)
        .await
        .map_err(CommandError::from)
}

/// Content search in a host's project, through `git grep` — the lines come back,
/// the files never do.
#[tauri::command]
pub async fn ssh_fs_search_content(
    state: State<'_, AppState>,
    host_id: String,
    root: String,
    query: crate::fs::ContentQuery,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
) -> Result<crate::fs::ContentSearch, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::search::content(&conn, shell, &root, &query, include_hidden, &filters, limit)
        .await
        .map_err(CommandError::from)
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

/// Run one file operation on a host, on a session that is allowed to have died.
///
/// The cached session is a channel, and a channel ends on its own schedule — the
/// host's `sftp-server` exits, or it is closed under us — while the connection
/// carries on. That is not hypothetical: it left the file panel reading
/// `session closed` on every folder, permanently, next to terminals on the same
/// host that were perfectly happy, because each terminal opens its own channel
/// and this one was cached forever.
///
/// So a session that turns out to be gone is dropped and the work is done once
/// more on a fresh one. Only that failure is retried ([`ssh::sftp::SftpFailure`]):
/// what the *host* answered — no such path, no permission — is the user's to
/// see, and asking a second time would only make them wait for the same no.
///
/// The retry covers the gap [`sftp_for`] cannot: a session that was fine when it
/// was handed out and ended while the request was in the air.
async fn with_sftp<T, F, Fut>(
    state: &AppState,
    host_id: &str,
    operation: F,
) -> Result<T, CommandError>
where
    F: Fn(std::sync::Arc<ssh::sftp::RemoteFiles>) -> Fut,
    Fut: std::future::Future<Output = Result<T, ssh::sftp::SftpFailure>>,
{
    let session = sftp_for(state, host_id).await?;
    match operation(std::sync::Arc::clone(&session)).await {
        Ok(value) => return Ok(value),
        Err(ssh::sftp::SftpFailure::Refused(error)) => return Err(CommandError::from(error)),
        Err(ssh::sftp::SftpFailure::Gone(message)) => {
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh-files",
                &format!("the file session on {host_id} had ended ({message}); opening another"),
            );
        }
    }

    // Drop *this* session, not whatever is cached now: another call may already
    // have replaced it, and evicting that one would send both of us round again.
    {
        let mut cached = state.ssh_sftp.lock().await;
        if cached
            .get(host_id)
            .is_some_and(|current| std::sync::Arc::ptr_eq(current, &session))
        {
            cached.remove(host_id);
        }
    }
    drop(session);

    let fresh = sftp_for(state, host_id).await?;
    operation(fresh)
        .await
        .map_err(|failure| CommandError::from(AppError::from(failure)))
}

/// List a directory on a host, for the file tree.
///
/// Over SFTP rather than a shell command, deliberately: it is a subsystem, so it
/// behaves the same whatever shell that machine starts and needs nothing
/// installed there (`ssh::sftp`).
#[tauri::command]
pub async fn ssh_fs_list(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<Vec<crate::fs::FsEntry>, CommandError> {
    let dir = path.as_str();
    with_sftp(&state, &host_id, |session| async move {
        session.list_dir(dir).await
    })
    .await
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

/// Save a text file on a host, for the editor.
///
/// **Fenced** (`02a` §2.9), because this is a mutation: the expectation the
/// caller prepared has to name the machine the write would actually land on. A
/// save is the one operation where being pointed at the wrong host is silent —
/// the same absolute path very often exists on both machines, and the editor
/// would report success either way.
///
/// The **connection generation** is checked too, but note what it does and does
/// not buy here: for a process or a worktree, a reconnect invalidates the world
/// the caller saw. For an absolute path on a host, it does not — the file is the
/// same file. It is checked because the contract says a stale expectation is
/// stale; the value that matters in this command is the target id.
#[tauri::command]
pub async fn ssh_fs_write(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    content: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    // Refuse before anything is opened: `write_file` truncates to open, so a
    // check that ran afterwards would have already destroyed the file.
    let generation = {
        let sessions = state.ssh_sessions.read().await;
        let Some(conn) = sessions.get(&host_id) else {
            return Err(CommandError::from(AppError::NotConnected(host_id.clone())));
        };
        conn.generation()
    };
    target::check(expect.as_ref(), &TargetId::Ssh(host_id.clone()), generation)
        .map_err(CommandError::from)?;

    let file = path.as_str();
    let text = content.as_str();
    with_sftp(&state, &host_id, |session| async move {
        session.write_file(file, text).await
    })
    .await
}

/// Everything the file tree can do to a host's disk, fenced.
///
/// One entry point rather than five, because they share the only part that
/// matters: the check that this is still the machine, and the connection, the
/// user was looking at. The same absolute path usually exists on both machines,
/// so a misrouted create is confusing and a misrouted **delete** is the one that
/// cannot be taken back.
async fn fenced_files(
    state: &AppState,
    host_id: &str,
    expect: Option<TargetExpectation>,
) -> Result<std::sync::Arc<ssh::sftp::RemoteFiles>, CommandError> {
    let generation = {
        let sessions = state.ssh_sessions.read().await;
        let Some(conn) = sessions.get(host_id) else {
            return Err(CommandError::from(AppError::NotConnected(
                host_id.to_string(),
            )));
        };
        conn.generation()
    };
    target::check(
        expect.as_ref(),
        &TargetId::Ssh(host_id.to_string()),
        generation,
    )
    .map_err(CommandError::from)?;
    sftp_for(state, host_id).await
}

/// Create an empty file on a host (the tree's "New File"). `path` is a bare name
/// or an intercalated relative path, validated by the same rules as locally.
#[tauri::command]
pub async fn ssh_fs_create_file(
    state: State<'_, AppState>,
    host_id: String,
    dir: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    let files = fenced_files(&state, &host_id, expect).await?;
    files
        .create_file(&dir, &path)
        .await
        .map_err(|e| CommandError::from(AppError::from(e)))
}

/// Create a folder on a host (the tree's "New Folder").
#[tauri::command]
pub async fn ssh_fs_create_dir(
    state: State<'_, AppState>,
    host_id: String,
    dir: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    let files = fenced_files(&state, &host_id, expect).await?;
    files
        .create_dir(&dir, &path)
        .await
        .map_err(|e| CommandError::from(AppError::from(e)))
}

/// Rename an entry on a host, within its folder.
#[tauri::command]
pub async fn ssh_fs_rename(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    new_name: String,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    let files = fenced_files(&state, &host_id, expect).await?;
    files
        .rename(&path, &new_name)
        .await
        .map_err(|e| CommandError::from(AppError::from(e)))
}

/// Delete a file or folder on a host. **Permanent** — a host has no trash, and
/// the caller is expected to have said so (see `ssh::sftp::RemoteFiles::delete`).
#[tauri::command]
pub async fn ssh_fs_delete(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<(), CommandError> {
    let files = fenced_files(&state, &host_id, expect).await?;
    files
        .delete(&path)
        .await
        .map_err(|e| CommandError::from(AppError::from(e)))
}

/// Copy a file next to itself on a host under a free "… copy" name.
#[tauri::command]
pub async fn ssh_fs_duplicate(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
    expect: Option<TargetExpectation>,
) -> Result<String, CommandError> {
    let files = fenced_files(&state, &host_id, expect).await?;
    files
        .duplicate(&path)
        .await
        .map_err(|e| CommandError::from(AppError::from(e)))
}

/// Read a text file on a host, for the editor. Same guards as the local reader:
/// binary and over-cap files come back flagged rather than mangled.
#[tauri::command]
pub async fn ssh_fs_read(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<crate::fs::FileContent, CommandError> {
    let file = path.as_str();
    with_sftp(&state, &host_id, |session| async move {
        session.read_file(file).await
    })
    .await
}

/// Read an image or PDF on a host as an inline `data:` URL, for the preview
/// pane. Same guards as the local reader: over-cap and unrecognized files are
/// refused, and the size is asked before the bytes cross the link
/// (`ssh::sftp::RemoteFiles::read_data_url`).
#[tauri::command]
pub async fn ssh_fs_read_data_url(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<String, CommandError> {
    let file = path.as_str();
    with_sftp(&state, &host_id, |session| async move {
        session.read_data_url(file).await
    })
    .await
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

/// Ask a host what it is listening on, right now.
///
/// The deliberate second way in, next to what terminals announce: a command
/// costs a shell start on that machine (`02g` §5.3), so it runs when the user
/// asks and never on a timer.
#[tauri::command]
pub async fn ssh_ports_listening(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<Vec<ssh::ports::ListeningPort>, CommandError> {
    let (conn, shell) = remote_git(&state, &host_id).await?;
    ssh::ports::listening(&conn, shell)
        .await
        .map_err(CommandError::from)
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
    // Its forwards go with it: a socket here that carries connections over a
    // connection that no longer exists would accept them into nothing.
    state.ssh_forwards.close_host(&host_id).await;
    // A reconnect may find the machine configured differently, so the shell is
    // learned again rather than remembered across sessions.
    state.ssh_shells.write().await.remove(&host_id);
    state.ssh_sftp.lock().await.remove(&host_id);
    Ok(state.ssh_sessions.write().await.remove(&host_id).is_some())
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
/// - **its host key is not on file**, which can only end in the trust prompt.
///
/// Neither belongs on screen unprompted while the app is still opening. A host
/// left out of this list is not refused — it connects the moment the user asks.
#[tauri::command]
pub async fn ssh_hosts_resumable(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    let hosts = state.data.read().await.settings.ssh_hosts.clone();
    // Read the file once: this runs at startup, for every host at once.
    let known = ssh::hostkey::read_known_hosts(&known_hosts_path()?).unwrap_or_default();
    Ok(hosts
        .into_iter()
        .filter(|h| !h.needs_prompt && ssh::hostkey::is_known(&known, &h.hostname, h.port))
        .map(|h| h.id)
        .collect())
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
    Ok(state
        .ssh_sessions
        .read()
        .await
        .iter()
        .filter(|(_, conn)| !conn.handle().is_closed())
        .map(|(host_id, conn)| SshHostSession {
            host_id: host_id.clone(),
            generation: conn.generation(),
        })
        .collect())
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

fn known_hosts_path() -> Result<std::path::PathBuf, CommandError> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| {
            CommandError::from(AppError::Invalid("no home directory to read".to_string()))
        })?;
    Ok(std::path::PathBuf::from(home)
        .join(".ssh")
        .join("known_hosts"))
}

/// Append one line to `known_hosts`, creating `~/.ssh` if this is the first
/// host ever trusted. Appends — never rewrites — so entries the user or their
/// own `ssh` put there are untouched.
fn append_known_host(line: &str) -> Result<(), AppError> {
    use std::io::Write;
    let path = known_hosts_path().map_err(|e| AppError::Invalid(e.message))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    // A file that does not end in a newline would otherwise glue our entry onto
    // the last one and corrupt both.
    let needs_newline = std::fs::metadata(&path)
        .map(|m| m.len() > 0)
        .unwrap_or(false)
        && !std::fs::read_to_string(&path)
            .map(|s| s.ends_with('\n'))
            .unwrap_or(true);
    if needs_newline {
        file.write_all(b"\n")?;
    }
    writeln!(file, "{line}")?;
    Ok(())
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

/// Resolve a repo for a **mutating** command, refusing the call when the target
/// the caller prepared for is no longer the target the work would run on.
///
/// Every destructive repo-bound command goes through here rather than
/// [`repo_path_of`], so "which machine does this run on" is answered once, in
/// one place, instead of being re-derived (and eventually forgotten) per command.
/// See `target::check` for why a missing expectation only ever authorizes local.
async fn repo_path_for_mutation(
    state: &AppState,
    repo_id: &str,
    expect: Option<&TargetExpectation>,
) -> Result<String, CommandError> {
    let (path, actual) = repo_location_of(state, repo_id).await?;
    // Only local targets exist today, so the live generation is the local
    // constant; the SSH connection registry supplies the real one in phase 1.
    target::check(expect, &actual, LOCAL_GENERATION).map_err(CommandError::from)?;
    Ok(path)
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

/// Resolve where a worktree for `branch` goes, from the settings that apply to
/// this project: the global layout, plus the effective root — the project's own
/// override first, then the global custom root (which only a `custom` layout
/// uses; a leftover value must not silently move a `managed` project).
async fn resolve_worktree_location(
    state: &AppState,
    repo_id: &str,
    repo_path: &str,
    branch: &str,
) -> Result<Resolved, CommandError> {
    let (mode, root) = {
        let data = state.data.read().await;
        let settings = data.settings.worktrees.clone();
        let project_root = data
            .repos
            .iter()
            .find(|r| r.id == repo_id)
            .and_then(|r| r.worktree_root.clone());
        let global_root = match settings.location {
            WorktreeLocationMode::Custom => settings.root.clone(),
            _ => None,
        };
        (settings.location, project_root.or(global_root))
    };
    worktreeloc::resolve(repo_path, branch, mode, root.as_deref())
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
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<String, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Ok(String::new());
    }
    let repo_path = repo_path_of(&state, &repo_id).await?;
    Ok(
        resolve_worktree_location(&state, &repo_id, &repo_path, &branch)
            .await?
            .path,
    )
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
        let overrides: Vec<String> = data
            .repos
            .iter()
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
/// **A project on a host is never reported here.** This asks *this* machine's
/// filesystem, and a host's absolute path is not a question it can answer: the
/// folder is on the other machine. Asked anyway, it marked a perfectly healthy
/// remote project as missing — and marked its neighbour as fine only because
/// that host happened to be this same machine, which is worse, because the
/// warning then looks selective rather than broken. Reporting a host's folder
/// as gone needs asking the host (`FOR-DEV.md`).
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
    Ok(repos
        .into_iter()
        .filter(|(_, target, path)| missing_locally(target, path))
        .map(|(id, _, _)| id)
        .collect())
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

/// The paths of the repositories currently registered as projects. A worktree
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
        .map(|r| r.path.clone())
        .collect()
}

/// Worktrees inside the managed folder that can be cleaned up, plus the ones
/// blocked by uncommitted work (listed, never removable). Read-only.
#[tauri::command]
pub async fn worktree_cleanup_scan(
    state: State<'_, AppState>,
) -> Result<Vec<worktreeclean::CleanupCandidate>, CommandError> {
    let roots = managed_roots(&state).await;
    let projects = project_paths(&state).await;
    let busy = state.pty.live_cwds();
    let mut found = worktreeclean::scan(&roots, &projects, &busy).await;
    found.extend(worktreeclean::scan_clones(&repos_root(), &projects, &busy).await);
    Ok(found)
}

/// Size on disk of each given worktree, in bytes, in the order asked.
///
/// Separate from the scan on purpose: walking a checkout's `node_modules` costs
/// far more than every git query in the scan combined, so the list appears
/// immediately and the sizes fill in.
#[tauri::command]
pub async fn worktree_cleanup_sizes(paths: Vec<String>) -> Result<Vec<u64>, CommandError> {
    let mut sizes = Vec::with_capacity(paths.len());
    for path in paths {
        sizes.push(worktreeclean::dir_size(path).await);
    }
    Ok(sizes)
}

/// Remove the given worktrees. Every path is re-verified against a fresh scan —
/// inside a managed root, still disposable, still clean — so a stale list can
/// never delete the wrong folder.
#[tauri::command]
pub async fn worktree_cleanup_remove(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<worktreeclean::CleanupOutcome, CommandError> {
    let roots = managed_roots(&state).await;
    let projects = project_paths(&state).await;
    let busy = state.pty.live_cwds();
    Ok(worktreeclean::remove(&roots, &repos_root(), &projects, &busy, &paths).await)
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
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: Option<String>,
    from_existing: Option<bool>,
    path: Option<String>,
    expect: Option<TargetExpectation>,
) -> Result<WorktreeEntry, CommandError> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(CommandError::from(AppError::Invalid(
            "branch name is required".to_string(),
        )));
    }
    let repo_path = repo_path_for_mutation(&state, &repo_id, expect.as_ref()).await?;
    let from_existing = from_existing.unwrap_or(false);

    // Resolve the worktree location: a custom absolute path for this creation,
    // or the configured layout. A custom path is normalized to forward slashes
    // (matching git's own spelling) and must be absolute and not already exist.
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
        None => {
            let resolved = resolve_worktree_location(&state, &repo_id, &repo_path, &branch).await?;
            worktreeloc::prepare(&resolved).await;
            resolved.path
        }
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
///
/// `expect` fences the call (see `target::check`). This is the single most
/// dangerous command to run on the wrong machine — it deletes a working tree and
/// can delete branches — so an expectation that no longer matches aborts before
/// any git process starts.
#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: Option<String>,
    force: bool,
    cleanup: Option<git::BranchCleanup>,
    expect: Option<TargetExpectation>,
) -> Result<git::RemoveOutcome, CommandError> {
    let repo_path = repo_path_for_mutation(&state, &repo_id, expect.as_ref()).await?;
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
    repo_id: String,
) -> Result<Vec<WorktreeEntry>, CommandError> {
    let (repo_path, target) = repo_location_of(&state, &repo_id).await?;
    if let Some(host_id) = target.ssh_host_id() {
        // Ask the host. Its shell was identified when it connected, so the
        // arguments are quoted for the shell that will receive them; a host that
        // could not be named, has no git, or holds a plain folder answers "not a
        // repository" and the row says the branch was not read — never a branch
        // this machine made up.
        let shell = state
            .ssh_shells
            .read()
            .await
            .get(host_id)
            .copied()
            .unwrap_or_default();
        let conn = session_for(&state, host_id).await;
        let branch = match conn {
            Some(conn) => ssh::git::status(&conn, shell, &repo_path).await.branch,
            None => None,
        };
        return Ok(vec![WorktreeEntry {
            path: repo_path,
            branch,
            head: None,
            is_main: true,
        }]);
    }
    if let Some(entries) = worktrees_without_git(&target, &repo_path) {
        return Ok(entries);
    }
    git::list_worktrees(&repo_path)
        .await
        .map_err(CommandError::from)
}

/// The worktree list for a project this machine's git cannot answer for: one
/// entry, the project's own folder, and **no branch**. `None` means "local — go
/// ask git".
///
/// Split out so the decision is testable on its own, because the invariant is
/// easy to break and expensive when broken: a project on a host must never
/// report a branch, or the sidebar would put this machine's answer on another
/// machine's repository.
fn worktrees_without_git(target: &TargetId, repo_path: &str) -> Option<Vec<WorktreeEntry>> {
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
pub async fn branch_integrated(path: String, branch: String) -> Result<bool, CommandError> {
    if branch.trim().is_empty() || !git::is_git_repo(&path).await {
        return Ok(false);
    }
    Ok(git::branch_integrated(&path, branch.trim()).await)
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

/// Read a local previewable file as an inline `data:<mime>;base64,…` URL for
/// the multimodal viewer. Refuses anything except known images/PDFs and anything
/// over the preview size cap (see [`crate::fs::read_data_url`]).
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
/// [`crate::fs::search_files`]). `include_hidden` surfaces dotfiles, `filters`
/// narrows by include/exclude globs, and `limit` caps the results. Runs the
/// blocking walk on the blocking pool.
#[tauri::command]
pub async fn fs_search_files(
    root: String,
    query: String,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
) -> Result<crate::fs::FileSearch, CommandError> {
    tokio::task::spawn_blocking(move || {
        crate::fs::search_files(&root, &query, include_hidden, &filters, limit)
    })
    .await
    .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string()))
}

/// Project-wide **content** search for the file tree: find the lines under `root`
/// matching `query` — the text plus its case / whole-word / regex modes (see
/// [`crate::fs::search_content`]). `include_hidden` and `filters` narrow the walk
/// the same way the filename search does; `limit` caps total matches. Runs the
/// multi-threaded walk on the blocking pool. An unparsable pattern comes back as
/// `SEARCH_INVALID` so the UI can show it under the input.
#[tauri::command]
pub async fn fs_search_content(
    root: String,
    query: crate::fs::ContentQuery,
    include_hidden: bool,
    filters: crate::fs::SearchFilters,
    limit: usize,
) -> Result<crate::fs::ContentSearch, CommandError> {
    tokio::task::spawn_blocking(move || {
        crate::fs::search_content(&root, &query, include_hidden, &filters, limit)
    })
    .await
    .map_err(|e| CommandError::new("SEARCH_FAILED", e.to_string()))?
    .map_err(|e| CommandError::new("SEARCH_INVALID", e.to_string()))
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
) -> Result<crate::agentrun::HeadlessResult, CommandError> {
    crate::agentrun::run_headless(
        &agent,
        &model,
        &prompt,
        &cwd,
        timeout_ms,
        autonomous.unwrap_or(false),
        // An automation step runs the model as configured, effort included.
        &[],
    )
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

/// Every agent the ADE can install a reporter for, with its install state and
/// whether the CLI itself looks present on this machine. One call instead of
/// three per agent: the panel lists whatever the backend registry holds, so
/// wiring a new agent never means touching the frontend's list.
#[tauri::command]
pub async fn list_agent_hooks() -> Result<Vec<agent_hooks::HookAgentEntry>, CommandError> {
    Ok(agent_hooks::read_all_agent_status())
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
    use super::{
        bracketed_paste, ends_the_current_session, fs_path_exists, issue_link_permission_denied,
        missing_locally, preserve_backend_owned, pty_submit_payload, read_term_buffers,
        rect_on_any_monitor, reorder_by_ids, resting_corner, term_buffers_path,
        worktrees_without_git, worth_retrying, TargetId,
    };
    use crate::model::{AppSettings, SshHost, SshHostTombstone};

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
        let entries =
            worktrees_without_git(&TargetId::parse("ssh:h1").unwrap(), r"C:\Users\dev\code")
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
        assert!(worktrees_without_git(&TargetId::Local, r"C:\code\uxnan").is_none());
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
        use super::super::with_sftp;
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
            let state = AppState::new(PersistenceManager::new(dir.path()), Default::default());
            state
                .ssh_sessions
                .write()
                .await
                .insert(HOST.to_string(), Arc::new(conn));
            (dir, state)
        }

        fn here() -> String {
            std::env::current_dir()
                .expect("cwd")
                .to_string_lossy()
                .replace('\\', "/")
        }

        /// Cache a session that has ended, and list a folder on it.
        async fn cache_a_dead_session(state: &AppState) -> Arc<ssh::sftp::RemoteFiles> {
            let dead = {
                let sessions = state.ssh_sessions.read().await;
                Arc::new(
                    ssh::sftp::open(sessions.get(HOST).unwrap())
                        .await
                        .expect("an SFTP session"),
                )
            };
            dead.close().await;
            state
                .ssh_sftp
                .lock()
                .await
                .insert(HOST.to_string(), Arc::clone(&dead));
            dead
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

        #[tokio::test]
        #[ignore = "needs a local sshd that authorizes a key in the agent"]
        async fn a_dead_file_session_is_replaced_rather_than_reported() {
            let (_dir, state) = state_with_a_live_host().await;
            let listed = here();
            // Borrowed, not moved: the operation is run twice, so it has to be
            // callable twice — the same reason the commands pass a `&str`.
            let dir = listed.as_str();

            let dead = cache_a_dead_session(&state).await;

            let entries = with_sftp(&state, HOST, |session| async move {
                session.list_dir(dir).await
            })
            .await
            .expect("the listing recovers on a new session");
            assert!(!entries.is_empty(), "a source directory is not empty");

            // And the dead one is gone from the cache, or the next call would
            // pay for the same discovery all over again.
            let cached = state.ssh_sftp.lock().await;
            let current = cached.get(HOST).expect("a session is cached again");
            assert!(
                !Arc::ptr_eq(current, &dead),
                "the replacement must be cached, not the corpse"
            );
        }

        /// The same recovery, one step later: a session that still *claims* to be
        /// usable and is not — which is what a host leaves behind when it ends a
        /// channel between two clicks, and the only case the check in `sftp_for`
        /// cannot catch before the request goes out.
        #[tokio::test]
        #[ignore = "needs a local sshd that authorizes a key in the agent"]
        async fn a_session_that_dies_unnoticed_is_retried_not_reported() {
            let (_dir, state) = state_with_a_live_host().await;
            let listed = here();
            let dir = listed.as_str();

            let dead = cache_a_dead_session(&state).await;
            dead.pretend_usable();

            let entries = with_sftp(&state, HOST, |session| async move {
                session.list_dir(dir).await
            })
            .await
            .expect("the retry lists it");
            assert!(!entries.is_empty(), "a source directory is not empty");
        }

        #[tokio::test]
        #[ignore = "needs a local sshd that authorizes a key in the agent"]
        async fn what_the_host_refuses_is_reported_on_the_first_ask() {
            let (_dir, state) = state_with_a_live_host().await;
            let absent = format!("{}/no-such-folder-9d2f", here());
            let missing = absent.as_str();

            let error = with_sftp(&state, HOST, |session| async move {
                session.list_dir(missing).await
            })
            .await
            .expect_err("a folder that is not there cannot be listed");
            println!("live: refused with {}", error.message);

            // The session it used is still cached: the host answered, so there
            // was nothing wrong with the channel and nothing to open again.
            let cached = state.ssh_sftp.lock().await;
            assert!(
                cached.contains_key(HOST),
                "a refusal must not throw away a working session"
            );
        }
    }
}
