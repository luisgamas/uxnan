//! The browser host — the pages of the integrated browser.
//!
//! ## One page per workspace, inside the main window
//!
//! A **session** is a workspace's browser: its key is the workspace key the
//! terminal store uses (a worktree folder; `""` is the Global space). A session
//! holds at most one page, a **child webview of the main window**
//! (`Window::add_child`, Tauri's multi-webview API) — not a separate window.
//! That is what keeps the browser where it belongs: it moves, minimizes and
//! changes desktop with the app, never floats over other applications, and is
//! stacked above the app's own UI only inside the panel slot it is placed in.
//!
//! Only the session of the workspace on screen is ever visible; the frontend
//! (`BrowserPanel.svelte` + `state/browser.svelte.ts`) decides that and the
//! bounds. A session of another workspace keeps its page loaded but hidden, so
//! an agent working there can open and inspect its own dev server without
//! touching what the person is looking at. The frontend also caps how many
//! pages stay alive at once and closes the rest (their URL is kept).
//!
//! ## Why every entry point here is `async`
//!
//! Creating a webview from a **synchronous** command deadlocks on Windows: a
//! sync command runs on the main thread, inside the IPC callback of the main
//! webview, and WebView2 cannot finish creating a controller from there. That
//! is what froze the app the first time a child webview was tried. `async`
//! commands run on the async runtime, and `add_child` hops to the main thread
//! on its own.
//!
//! ## State
//!
//! The backend is the source of truth for what a page *is* (URL, title, load
//! state, history, zoom, which document); every change is pushed to the
//! frontend as a `browser:state` event carrying the whole [`SessionState`].
//! `generation` increments on every committed main-frame document, so anything
//! bound to one document (element refs, approvals) can tell it went stale.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};

use crate::error::CommandError;

/// Label of the window the pages live in.
const HOST_WINDOW: &str = "main";
/// The main window's own webview (the app UI), which gets the keyboard back
/// when a focused page is hidden.
const APP_WEBVIEW: &str = "main";
/// Zoom limits, as page scale factors.
const ZOOM_MIN: f64 = 0.25;
const ZOOM_MAX: f64 = 5.0;

/// A panel slot in CSS pixels, relative to the main window's content — the
/// same space as the webview's logical coordinates, since the app UI fills the
/// window.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    fn rect(self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: LogicalSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

/// What a session's page is, as the frontend and the control surface see it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    /// The workspace key the session belongs to (`""` = Global).
    pub workspace: String,
    /// Whether a live page exists (false once closed).
    pub live: bool,
    /// The page's URL.
    pub url: String,
    /// The document title, empty until the page sets one.
    pub title: String,
    /// Whether the main frame is loading.
    pub loading: bool,
    /// Whether history can go back / forward — `None` when the engine does not
    /// say (the buttons then stay enabled).
    pub can_go_back: Option<bool>,
    pub can_go_forward: Option<bool>,
    /// Page zoom factor (1.0 = 100 %).
    pub zoom: f64,
    /// Whether the page is shown in the panel right now.
    pub visible: bool,
    /// Committed main-frame documents so far — changes on every navigation,
    /// reload and history step.
    pub generation: u64,
}

struct Session {
    label: String,
    state: SessionState,
}

/// Every live page, by workspace key. Managed state (`app.manage`).
#[derive(Default)]
pub struct BrowserHost {
    sessions: Mutex<HashMap<String, Session>>,
    seq: AtomicU64,
}

impl BrowserHost {
    fn with<T>(&self, f: impl FnOnce(&mut HashMap<String, Session>) -> T) -> T {
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard)
    }

    /// The workspace a webview label belongs to.
    fn workspace_of(&self, label: &str) -> Option<String> {
        self.with(|s| {
            s.iter()
                .find(|(_, v)| v.label == label)
                .map(|(k, _)| k.clone())
        })
    }

    /// A session's state, if it has a live page.
    pub fn state(&self, workspace: &str) -> Option<SessionState> {
        self.with(|s| s.get(workspace).map(|v| v.state.clone()))
    }

    /// Every live session.
    pub fn states(&self) -> Vec<SessionState> {
        self.with(|s| s.values().map(|v| v.state.clone()).collect())
    }

    fn label(&self, workspace: &str) -> Option<String> {
        self.with(|s| s.get(workspace).map(|v| v.label.clone()))
    }
}

/// Apply `f` to a session's state and push the result to the frontend when it
/// changed. Returns the new state.
fn update<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    f: impl FnOnce(&mut SessionState),
) -> Option<SessionState> {
    let host = app.state::<BrowserHost>();
    let changed = host.with(|s| {
        let session = s.get_mut(workspace)?;
        let before = session.state.clone();
        f(&mut session.state);
        (session.state != before).then(|| session.state.clone())
    });
    if let Some(state) = &changed {
        let _ = app.emit("browser:state", state);
    }
    changed.or_else(|| host.state(workspace))
}

/// The live page of a workspace.
pub fn webview<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
) -> Result<Webview<R>, CommandError> {
    app.state::<BrowserHost>()
        .label(workspace)
        .and_then(|label| app.get_webview(&label))
        .ok_or_else(|| {
            CommandError::new(
                "BROWSER_NO_PAGE",
                "no browser page is open in this workspace",
            )
        })
}

/// Evaluate `js` in a page and return its result, JSON-decoded. The page is
/// untrusted: the result is data to validate, never something to act on
/// blindly, and a page that never answers is abandoned after `timeout`.
pub async fn eval_json<R: tauri::Runtime>(
    webview: &Webview<R>,
    js: &str,
    timeout: Duration,
) -> Result<Value, CommandError> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    webview
        .eval_with_callback(js, move |raw| {
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(raw);
            }
        })
        .map_err(|e| CommandError::new("BROWSER_EVAL_FAILED", e.to_string()))?;
    let raw = tokio::time::timeout(timeout, rx)
        .await
        .map_err(|_| CommandError::new("BROWSER_TIMEOUT", "the page did not answer in time"))?
        .map_err(|_| CommandError::new("BROWSER_EVAL_FAILED", "the page went away"))?;
    Ok(serde_json::from_str(&raw).unwrap_or(Value::Null))
}

/// Ask the page whether its history can move, through the Navigation API
/// where the engine has it.
const HISTORY_JS: &str = "(()=>{try{const n=window.navigation;return n?[!!n.canGoBack,!!n.canGoForward]:null}catch(e){return null}})()";

/// Refresh what the engine does not push by itself — the URL after an in-page
/// (`pushState`) navigation, and the history state — and emit it.
pub async fn refresh<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
) -> Result<SessionState, CommandError> {
    let wv = webview(app, workspace)?;
    let url = wv.url().ok().map(|u| u.to_string());
    let history = eval_json(&wv, HISTORY_JS, Duration::from_secs(1))
        .await
        .ok()
        .and_then(|v| v.as_array().cloned());
    update(app, workspace, |s| {
        if let Some(url) = url {
            s.url = url;
        }
        match history.as_deref() {
            Some([Value::Bool(back), Value::Bool(fwd)]) => {
                s.can_go_back = Some(*back);
                s.can_go_forward = Some(*fwd);
            }
            _ => {
                s.can_go_back = None;
                s.can_go_forward = None;
            }
        }
    })
    .ok_or_else(|| {
        CommandError::new(
            "BROWSER_NO_PAGE",
            "no browser page is open in this workspace",
        )
    })
}

/// A free file name in `dir` for a download called `name`: `name`, then
/// `name (2).ext`, `name (3).ext`, … Pure but for the existence probe.
fn free_download_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '\0') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    let clean = if clean.is_empty() {
        "download".to_string()
    } else {
        clean
    };
    let first = dir.join(&clean);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (clean.clone(), String::new()),
    };
    for n in 2..1000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !exists(&candidate) {
            return candidate;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}

/// A finished download, for the frontend's notice.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadedEvent {
    workspace: String,
    path: Option<String>,
    success: bool,
}

/// Create a workspace's page at `url`, placed at `bounds`.
async fn create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    url: tauri::Url,
    bounds: Bounds,
    visible: bool,
) -> Result<SessionState, CommandError> {
    let window = app
        .get_window(HOST_WINDOW)
        .ok_or_else(|| CommandError::new("BROWSER_NO_HOST", "host window not found"))?;
    let host = app.state::<BrowserHost>();
    let label = format!("browser-{}", host.seq.fetch_add(1, Ordering::Relaxed) + 1);
    let dev = super::dev_origin(app);

    let load_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();
    let download_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()))
        // A click on an unfocused app should reach the page, not just focus it.
        .accept_first_mouse(true)
        .focused(false)
        // The app owns zoom (per session, in the toolbar), not the engine's
        // own hotkeys, which would leave the toolbar's number wrong.
        .zoom_hotkeys_enabled(false)
        // Files dropped on the page go to the page, not to the app.
        .disable_drag_drop_handler()
        // The agent tools' page side (`page.js`), in every main-frame document
        // before the page's own scripts.
        .initialization_script(super::page::SCRIPT)
        .on_navigation(move |u| super::nav_allowed(u, dev.as_ref()))
        .on_page_load(move |wv, payload| {
            let app = load_app.clone();
            let Some(ws) = app.state::<BrowserHost>().workspace_of(wv.label()) else {
                return;
            };
            let url = payload.url().to_string();
            match payload.event() {
                PageLoadEvent::Started => {
                    update(&app, &ws, |s| {
                        s.url = url;
                        s.loading = true;
                        s.generation += 1;
                    });
                }
                PageLoadEvent::Finished => {
                    update(&app, &ws, |s| {
                        s.url = url;
                        s.loading = false;
                    });
                    tauri::async_runtime::spawn(async move {
                        let _ = refresh(&app, &ws).await;
                    });
                }
            }
        })
        .on_document_title_changed(move |wv, title| {
            if let Some(ws) = title_app.state::<BrowserHost>().workspace_of(wv.label()) {
                update(&title_app, &ws, |s| s.title = title);
            }
        })
        // A developer browser has no tabs: `target=_blank` and `window.open`
        // load in the same page, through the same gate as any other open.
        .on_new_window(move |u, _features| {
            let app = popup_app.clone();
            let label = popup_label.clone();
            let dev = super::dev_origin(&app);
            if super::open_allowed(&u, dev.as_ref()) {
                tauri::async_runtime::spawn(async move {
                    if let Some(wv) = app.get_webview(&label) {
                        let _ = wv.navigate(u);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_download(move |wv, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let Ok(dir) = download_app.path().download_dir() else {
                    return false;
                };
                let name = url
                    .path_segments()
                    .and_then(|mut s| s.next_back())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("download")
                    .to_string();
                *destination = free_download_path(&dir, &name, Path::exists);
                true
            }
            DownloadEvent::Finished { path, success, .. } => {
                if let Some(ws) = download_app.state::<BrowserHost>().workspace_of(wv.label()) {
                    let _ = download_app.emit(
                        "browser:downloaded",
                        DownloadedEvent {
                            workspace: ws,
                            path: path.map(|p| p.display().to_string()),
                            success,
                        },
                    );
                }
                true
            }
            _ => true,
        });

    let state = SessionState {
        workspace: workspace.to_string(),
        live: true,
        url: url.to_string(),
        title: String::new(),
        loading: true,
        can_go_back: None,
        can_go_forward: None,
        zoom: 1.0,
        visible,
        generation: 0,
    };
    // Registered before the page exists, so its first load event finds it.
    host.with(|s| {
        s.insert(
            workspace.to_string(),
            Session {
                label: label.clone(),
                state: state.clone(),
            },
        )
    });
    let created = window.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
    );
    let webview = match created {
        Ok(w) => w,
        Err(e) => {
            host.with(|s| s.remove(workspace));
            return Err(CommandError::new("BROWSER_CREATE_FAILED", e.to_string()));
        }
    };
    // The app's global shortcuts still work with the page focused.
    crate::keyboard::watch_page(&webview);
    if !visible {
        let _ = webview.hide();
    }
    let _ = app.emit("browser:state", &state);
    Ok(state)
}

/// Give the keyboard back to the app UI when a page that may hold it is
/// hidden or closed — a hidden page must never keep eating keystrokes.
fn reclaim_keyboard<R: tauri::Runtime>(app: &AppHandle<R>) {
    let focused = app
        .get_window(HOST_WINDOW)
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if focused {
        if let Some(ui) = app.get_webview(APP_WEBVIEW) {
            let _ = ui.set_focus();
        }
    }
}

/// Show or hide a session's page.
fn set_visible<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    visible: bool,
) -> Result<SessionState, CommandError> {
    let wv = webview(app, workspace)?;
    let was = app
        .state::<BrowserHost>()
        .state(workspace)
        .is_some_and(|s| s.visible);
    if visible { wv.show() } else { wv.hide() }
        .map_err(|e| CommandError::new("BROWSER_SHOW_FAILED", e.to_string()))?;
    if was && !visible {
        reclaim_keyboard(app);
    }
    update(app, workspace, |s| s.visible = visible).ok_or_else(|| {
        CommandError::new(
            "BROWSER_NO_PAGE",
            "no browser page is open in this workspace",
        )
    })
}

/// Close a session's page. The session is forgotten; opening it again starts
/// a new page.
pub fn close<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) {
    let host = app.state::<BrowserHost>();
    super::approval::forget(app, workspace);
    let Some(session) = host.with(|s| s.remove(workspace)) else {
        return;
    };
    if let Some(wv) = app.get_webview(&session.label) {
        let _ = wv.close();
    }
    if session.state.visible {
        reclaim_keyboard(app);
    }
    let _ = app.emit(
        "browser:state",
        SessionState {
            live: false,
            visible: false,
            loading: false,
            ..session.state
        },
    );
}

/// Load `url` in a workspace's page, creating the page if there is none.
pub async fn open<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    url: tauri::Url,
    bounds: Bounds,
    visible: bool,
) -> Result<SessionState, CommandError> {
    if app.state::<BrowserHost>().label(workspace).is_none() {
        return create(app, workspace, url, bounds, visible).await;
    }
    let wv = webview(app, workspace)?;
    wv.set_bounds(bounds.rect())
        .map_err(|e| CommandError::new("BROWSER_MOVE_FAILED", e.to_string()))?;
    wv.navigate(url)
        .map_err(|e| CommandError::new("BROWSER_NAV_FAILED", e.to_string()))?;
    set_visible(app, workspace, visible)
}

/// Run a small, fixed script in a page (history steps, stop).
fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    js: &str,
) -> Result<(), CommandError> {
    webview(app, workspace)?
        .eval(js)
        .map_err(|e| CommandError::new("BROWSER_EVAL_FAILED", e.to_string()))
}

/// History step (`back`/`forward`), reload (`hard` bypasses the cache) and stop.
pub fn back<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) -> Result<(), CommandError> {
    run(app, workspace, "window.history.back()")
}

pub fn forward<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) -> Result<(), CommandError> {
    run(app, workspace, "window.history.forward()")
}

pub fn reload<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    hard: bool,
) -> Result<(), CommandError> {
    if hard {
        // No engine-neutral "reload from origin"; a cache-busting reload of
        // the same URL is the closest every engine honours.
        return run(app, workspace, "window.location.reload()");
    }
    webview(app, workspace)?
        .reload()
        .map_err(|e| CommandError::new("BROWSER_RELOAD_FAILED", e.to_string()))
}

pub fn stop<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) -> Result<(), CommandError> {
    run(app, workspace, "window.stop()")?;
    update(app, workspace, |s| s.loading = false);
    Ok(())
}

/// Clamp a zoom factor to what the toolbar offers.
fn clamp_zoom(zoom: f64) -> f64 {
    if zoom.is_finite() {
        zoom.clamp(ZOOM_MIN, ZOOM_MAX)
    } else {
        1.0
    }
}

// --- Commands --------------------------------------------------------------

/// Open (or navigate) a workspace's page at `url`, placed at `bounds`, shown
/// or kept hidden. Creates the page on first use.
#[tauri::command]
pub async fn browser_open<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    url: String,
    bounds: Bounds,
    visible: bool,
) -> Result<SessionState, CommandError> {
    let target = super::parse_url(&app, &url)?;
    open(&app, &workspace, target, bounds, visible).await
}

/// Navigate a workspace's page.
#[tauri::command]
pub async fn browser_navigate<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    url: String,
) -> Result<(), CommandError> {
    let target = super::parse_url(&app, &url)?;
    webview(&app, &workspace)?
        .navigate(target)
        .map_err(|e| CommandError::new("BROWSER_NAV_FAILED", e.to_string()))
}

/// Place a workspace's page over its panel slot.
#[tauri::command]
pub async fn browser_set_bounds<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    bounds: Bounds,
) -> Result<(), CommandError> {
    webview(&app, &workspace)?
        .set_bounds(bounds.rect())
        .map_err(|e| CommandError::new("BROWSER_MOVE_FAILED", e.to_string()))
}

/// Show or hide a workspace's page.
#[tauri::command]
pub async fn browser_set_visible<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    visible: bool,
) -> Result<SessionState, CommandError> {
    set_visible(&app, &workspace, visible)
}

#[tauri::command]
pub async fn browser_back<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<(), CommandError> {
    back(&app, &workspace)
}

#[tauri::command]
pub async fn browser_forward<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<(), CommandError> {
    forward(&app, &workspace)
}

#[tauri::command]
pub async fn browser_reload<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    hard: bool,
) -> Result<(), CommandError> {
    reload(&app, &workspace, hard)
}

#[tauri::command]
pub async fn browser_stop<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<(), CommandError> {
    stop(&app, &workspace)
}

/// Set a page's zoom factor (clamped to 25 %–500 %).
#[tauri::command]
pub async fn browser_zoom<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
    zoom: f64,
) -> Result<SessionState, CommandError> {
    let zoom = clamp_zoom(zoom);
    webview(&app, &workspace)?
        .set_zoom(zoom)
        .map_err(|e| CommandError::new("BROWSER_ZOOM_FAILED", e.to_string()))?;
    update(&app, &workspace, |s| s.zoom = zoom).ok_or_else(|| {
        CommandError::new(
            "BROWSER_NO_PAGE",
            "no browser page is open in this workspace",
        )
    })
}

/// Toggle a page's web DevTools (available in release builds too — this is a
/// developer browser).
#[tauri::command]
pub async fn browser_devtools<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<(), CommandError> {
    let wv = webview(&app, &workspace)?;
    if wv.is_devtools_open() {
        wv.close_devtools();
    } else {
        wv.open_devtools();
    }
    Ok(())
}

/// Re-read what the engine does not push (in-page URL changes, history).
#[tauri::command]
pub async fn browser_refresh<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<SessionState, CommandError> {
    refresh(&app, &workspace).await
}

/// Close a workspace's page. No-op when it has none.
#[tauri::command]
pub async fn browser_close<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<(), CommandError> {
    close(&app, &workspace);
    Ok(())
}

/// A still image of what a page shows now, as a `data:` URL — drawn in the
/// panel slot while something of the app covers it and the page itself has to
/// hide (a native view cannot sit under a dialog). `BROWSER_UNSUPPORTED` where
/// the platform cannot capture; the panel then shows an empty slot.
#[tauri::command]
pub async fn browser_capture<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: String,
) -> Result<String, CommandError> {
    use base64::Engine;
    let wv = webview(&app, &workspace)?;
    let shot = super::capture::png(&wv).await?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&shot.png)
    ))
}

/// Every live page — the frontend re-syncs from this after a reload.
#[tauri::command]
pub async fn browser_sessions<R: tauri::Runtime>(app: AppHandle<R>) -> Vec<SessionState> {
    app.state::<BrowserHost>().states()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_is_clamped() {
        assert_eq!(clamp_zoom(1.25), 1.25);
        assert_eq!(clamp_zoom(0.01), ZOOM_MIN);
        assert_eq!(clamp_zoom(99.0), ZOOM_MAX);
        assert_eq!(clamp_zoom(f64::NAN), 1.0);
    }

    #[test]
    fn download_names_never_collide_or_escape() {
        let dir = Path::new("/dl");
        let taken =
            |p: &Path| p == Path::new("/dl/report.pdf") || p == Path::new("/dl/report (2).pdf");
        assert_eq!(
            free_download_path(dir, "report.pdf", taken),
            PathBuf::from("/dl/report (3).pdf")
        );
        assert_eq!(
            free_download_path(dir, "../../etc/passwd", |_| false),
            PathBuf::from("/dl/_.._etc_passwd")
        );
        assert_eq!(
            free_download_path(dir, "  ", |_| false),
            PathBuf::from("/dl/download")
        );
        assert_eq!(
            free_download_path(dir, "archive", |p| p == Path::new("/dl/archive")),
            PathBuf::from("/dl/archive (2)")
        );
    }

    #[test]
    fn bounds_never_collapse_to_zero() {
        let r = Bounds {
            x: 10.0,
            y: 20.0,
            width: 0.0,
            height: -5.0,
        }
        .rect();
        let size: LogicalSize<f64> = match r.size {
            tauri::Size::Logical(s) => s,
            tauri::Size::Physical(_) => unreachable!(),
        };
        assert_eq!((size.width, size.height), (1.0, 1.0));
    }
}
