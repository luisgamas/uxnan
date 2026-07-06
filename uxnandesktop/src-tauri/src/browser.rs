//! Integrated developer browser — link routing + the docked browser window.
//!
//! The browser is a separate **`WebviewWindow`** (a real system webview —
//! Chromium/WebView2 on Windows — so it loads any site and has real DevTools),
//! owned by the main window and frameless, positioned by the frontend so it sits
//! over uxnan's right-side browser panel and looks like a 4th panel. The toolbar
//! (address bar, back/forward, …) lives in the main window's DOM; this window holds
//! only the page (a single webview can't show both our chrome and an external
//! top-level site).
//!
//! This module also owns the one decision every link funnels through: open in the
//! browser window, hand to the OS browser, or prompt — per the user's
//! [`crate::model::BrowserSettings`]. Shared by the `open_url` command and the agent
//! `/browser` hook route (`hooks.rs`).

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::error::CommandError;
use crate::model::BrowserLinkPolicy;
use crate::state::AppState;

/// Label of the main (host) window the browser window is owned by + positioned over.
const HOST_WINDOW: &str = "main";
/// Label of the docked browser window.
const BROWSER_WINDOW: &str = "uxnan-browser";

// --- Link routing ----------------------------------------------------------

/// Where a link should open, resolved from [`BrowserLinkPolicy`] and the master
/// switch. Pure decision (see [`resolve_link_target`]) so it can be unit-tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkTarget {
    /// Open in the integrated browser window.
    Internal,
    /// Hand off to the OS default browser.
    External,
    /// Let the user choose per link (the frontend prompts).
    Ask,
}

/// Resolve where a link opens. The master switch wins: a disabled browser always
/// routes to the OS browser, regardless of the policy.
pub fn resolve_link_target(enabled: bool, policy: BrowserLinkPolicy) -> LinkTarget {
    if !enabled {
        return LinkTarget::External;
    }
    match policy {
        BrowserLinkPolicy::Internal => LinkTarget::Internal,
        BrowserLinkPolicy::External => LinkTarget::External,
        BrowserLinkPolicy::Ask => LinkTarget::Ask,
    }
}

/// Event telling the frontend to open `url` in the integrated browser. The `ask`
/// flag asks it to prompt internal-vs-external (the `Ask` policy).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenUrlEvent {
    url: String,
    ask: bool,
}

fn emit_open_url(app: &AppHandle, url: &str, ask: bool) -> Result<(), CommandError> {
    app.emit(
        "browser:open-url",
        OpenUrlEvent {
            url: url.to_string(),
            ask,
        },
    )
    .map_err(|e| CommandError::new("EMIT_FAILED", e.to_string()))
}

/// Open `url` per the user's [`crate::model::BrowserSettings`]: the in-app browser
/// window, the OS default browser, or a per-link prompt. The single decision point
/// shared by the `open_url` command and the agent `/browser` hook route; a disabled
/// browser always goes external.
pub async fn route_url(app: &AppHandle, url: String) -> Result<(), CommandError> {
    let (enabled, policy) = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        (
            data.settings.browser.enabled,
            data.settings.browser.link_policy,
        )
    };
    match resolve_link_target(enabled, policy) {
        LinkTarget::External => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| CommandError::new("OPEN_URL_FAILED", e.to_string()))
        }
        LinkTarget::Internal => emit_open_url(app, &url, false),
        LinkTarget::Ask => emit_open_url(app, &url, true),
    }
}

// --- Docked browser window -------------------------------------------------

/// Navigation event pushed to the frontend so the address bar tracks the live URL.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigatedEvent {
    url: String,
}

fn parse_url(raw: &str) -> Result<tauri::Url, CommandError> {
    tauri::Url::parse(raw).map_err(|e| CommandError::new("BROWSER_BAD_URL", e.to_string()))
}

/// Record the browser's live URL in shared state so the browser MCP server's
/// `browser_status` tool can report the current page to an agent (see
/// [`AppState::browser_url`]). Best-effort: a poisoned lock is ignored.
fn track_url(app: &AppHandle, url: &str) {
    let slot = app.state::<AppState>().browser_url.clone();
    let mut guard = match slot.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    *guard = Some(url.to_string());
}

/// Snapshot of the integrated browser, returned by the browser MCP server's
/// `browser_status` tool so an agent can see whether a page is open, which URL
/// it's on, and how its opens will be routed (in-app vs OS browser).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    /// Whether the docked browser window currently exists (a panel is open).
    pub open: bool,
    /// Last URL the browser navigated to, if any (`None` = never opened).
    pub url: Option<String>,
    /// Master switch — when off, an agent's opens go to the OS default browser.
    pub enabled: bool,
    /// Link routing policy in effect (`internal`/`external`/`ask`).
    pub policy: BrowserLinkPolicy,
}

/// Read the live integrated-browser status (window open? current URL? settings?)
/// for the browser MCP server's `browser_status` tool.
pub async fn status(app: &AppHandle) -> BrowserStatus {
    let open = app.get_webview_window(BROWSER_WINDOW).is_some();
    let state = app.state::<AppState>();
    let url = state
        .browser_url
        .clone()
        .lock()
        .ok()
        .and_then(|s| s.clone());
    let (enabled, policy) = {
        let data = state.data.read().await;
        (
            data.settings.browser.enabled,
            data.settings.browser.link_policy,
        )
    };
    BrowserStatus {
        open,
        url,
        enabled,
        policy,
    }
}

/// Fetch the docked browser window, or a clean "not open" error.
fn window(app: &AppHandle) -> Result<tauri::WebviewWindow, CommandError> {
    app.get_webview_window(BROWSER_WINDOW)
        .ok_or_else(|| CommandError::new("BROWSER_NO_WINDOW", "browser window not open"))
}

/// Position the browser window so it overlays the panel rect the frontend measured.
/// `x`/`y`/`width`/`height` are CSS (logical) px relative to the main window's
/// content area; we convert to absolute physical screen coords via the main
/// window's content origin + scale factor, so the window glues to the panel slot.
fn place(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), CommandError> {
    let main = app
        .get_webview_window(HOST_WINDOW)
        .ok_or_else(|| CommandError::new("BROWSER_NO_HOST", "host window not found"))?;
    let win = window(app)?;
    let scale = main
        .scale_factor()
        .map_err(|e| CommandError::new("BROWSER_SCALE_FAILED", e.to_string()))?;
    let origin = main
        .inner_position()
        .map_err(|e| CommandError::new("BROWSER_POS_FAILED", e.to_string()))?;
    let px = origin.x + (x * scale).round() as i32;
    let py = origin.y + (y * scale).round() as i32;
    let pw = ((width.max(1.0)) * scale).round() as u32;
    let ph = ((height.max(1.0)) * scale).round() as u32;
    win.set_position(PhysicalPosition::new(px, py))
        .map_err(|e| CommandError::new("BROWSER_MOVE_FAILED", e.to_string()))?;
    win.set_size(PhysicalSize::new(pw.max(1), ph.max(1)))
        .map_err(|e| CommandError::new("BROWSER_SIZE_FAILED", e.to_string()))
}

/// Open (or focus + navigate) the docked browser window at `url`, glued to the
/// panel rect. Creates the window on first use: frameless, owned by the main window
/// (so it minimizes/closes with it and stays above it), off the taskbar.
#[tauri::command]
pub async fn browser_window_open(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), CommandError> {
    let target = parse_url(&url)?;
    track_url(&app, &url);

    if app.get_webview_window(BROWSER_WINDOW).is_some() {
        place(&app, x, y, width, height)?;
        let win = window(&app)?;
        win.navigate(target)
            .map_err(|e| CommandError::new("BROWSER_NAV_FAILED", e.to_string()))?;
        win.show()
            .map_err(|e| CommandError::new("BROWSER_SHOW_FAILED", e.to_string()))?;
        return Ok(());
    }

    let main = app
        .get_webview_window(HOST_WINDOW)
        .ok_or_else(|| CommandError::new("BROWSER_NO_HOST", "host window not found"))?;

    let nav_app = app.clone();
    let builder = WebviewWindowBuilder::new(&app, BROWSER_WINDOW, WebviewUrl::External(target))
        .decorations(false)
        // Not user-resizable: its size is owned entirely by the 4th panel (the
        // panel's resize handle drives it via `place`). Without this a frameless
        // window still has drag-resize edges, letting it desync from the panel.
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .on_navigation(move |u| {
            let url = u.to_string();
            track_url(&nav_app, &url);
            let _ = nav_app.emit("browser:navigated", NavigatedEvent { url });
            true
        });
    // Own the browser window to the main window: it stays above it and
    // minimizes/closes with it.
    builder
        .parent(&main)
        .map_err(|e| CommandError::new("BROWSER_PARENT_FAILED", e.to_string()))?
        .inner_size(width.max(1.0), height.max(1.0))
        .build()
        .map_err(|e| CommandError::new("BROWSER_CREATE_FAILED", e.to_string()))?;

    place(&app, x, y, width, height)?;
    window(&app)?
        .show()
        .map_err(|e| CommandError::new("BROWSER_SHOW_FAILED", e.to_string()))
}

/// Reposition / resize the window to track the panel rect (frontend layout sync).
#[tauri::command]
pub fn browser_window_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), CommandError> {
    place(&app, x, y, width, height)
}

/// Navigate the browser window to a new URL.
#[tauri::command]
pub fn browser_window_navigate(app: AppHandle, url: String) -> Result<(), CommandError> {
    let target = parse_url(&url)?;
    track_url(&app, &url);
    window(&app)?
        .navigate(target)
        .map_err(|e| CommandError::new("BROWSER_NAV_FAILED", e.to_string()))
}

/// Reload the current page.
#[tauri::command]
pub fn browser_window_reload(app: AppHandle) -> Result<(), CommandError> {
    window(&app)?
        .eval("window.location.reload()")
        .map_err(|e| CommandError::new("BROWSER_RELOAD_FAILED", e.to_string()))
}

/// Go back in the page's history.
#[tauri::command]
pub fn browser_window_back(app: AppHandle) -> Result<(), CommandError> {
    window(&app)?
        .eval("window.history.back()")
        .map_err(|e| CommandError::new("BROWSER_BACK_FAILED", e.to_string()))
}

/// Go forward in the page's history.
#[tauri::command]
pub fn browser_window_forward(app: AppHandle) -> Result<(), CommandError> {
    window(&app)?
        .eval("window.history.forward()")
        .map_err(|e| CommandError::new("BROWSER_FORWARD_FAILED", e.to_string()))
}

/// Show the window (its panel became visible again).
#[tauri::command]
pub fn browser_window_show(app: AppHandle) -> Result<(), CommandError> {
    window(&app)?
        .show()
        .map_err(|e| CommandError::new("BROWSER_SHOW_FAILED", e.to_string()))
}

/// Hide the window without destroying it (panel hidden, an overlay opened, or the
/// app minimized). An owned window paints above the main one, so it must be hidden
/// whenever something else should be in front.
#[tauri::command]
pub fn browser_window_hide(app: AppHandle) -> Result<(), CommandError> {
    if let Some(win) = app.get_webview_window(BROWSER_WINDOW) {
        win.hide()
            .map_err(|e| CommandError::new("BROWSER_HIDE_FAILED", e.to_string()))?;
    }
    Ok(())
}

/// Destroy the window (the panel closed). No-op if it was never opened.
#[tauri::command]
pub fn browser_window_close(app: AppHandle) -> Result<(), CommandError> {
    if let Some(win) = app.get_webview_window(BROWSER_WINDOW) {
        win.close()
            .map_err(|e| CommandError::new("BROWSER_CLOSE_FAILED", e.to_string()))?;
    }
    Ok(())
}

/// Open the browser window's DevTools (available in release too — the `devtools`
/// Cargo feature is on — since this is a developer browser).
#[tauri::command]
pub fn browser_window_devtools(app: AppHandle) -> Result<(), CommandError> {
    window(&app)?.open_devtools();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_always_routes_external() {
        assert_eq!(
            resolve_link_target(false, BrowserLinkPolicy::Internal),
            LinkTarget::External
        );
        assert_eq!(
            resolve_link_target(false, BrowserLinkPolicy::Ask),
            LinkTarget::External
        );
    }

    #[test]
    fn enabled_follows_policy() {
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::Internal),
            LinkTarget::Internal
        );
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::External),
            LinkTarget::External
        );
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::Ask),
            LinkTarget::Ask
        );
    }

    #[test]
    fn parse_url_rejects_garbage() {
        assert!(parse_url("not a url").is_err());
        assert!(parse_url("https://example.com").is_ok());
    }
}
