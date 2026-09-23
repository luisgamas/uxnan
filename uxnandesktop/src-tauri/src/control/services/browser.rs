//! The integrated browser, as the control surface offers it.
//!
//! **Whose browser.** Every workspace has its own page (`crate::browser::host`).
//! An agent's calls act on the workspace its own terminal belongs to — so an
//! agent working in a background worktree opens and drives *its* dev server
//! there without touching the page the person is looking at. A caller with no
//! terminal (the control token, a script outside the app) acts on the workspace
//! on screen.
//!
//! **Waiting.** A call that loads something answers once the page has loaded
//! (or a bounded wait ran out, with `loading: true`), so an agent can open a URL
//! and read the result in its next call without guessing a delay.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::browser::host::{self, BrowserHost, SessionState};
use crate::browser::LinkTarget;
use crate::control::bridge::Bridge;
use crate::control::resolve::Resolver;
use crate::control::Caller;
use crate::error::CommandError;

/// How long an open or a reload may take to finish loading before the call
/// answers anyway (with `loading: true`).
const LOAD_WAIT: Duration = Duration::from_secs(15);
/// How long a history step is given to land.
const STEP_WAIT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(100);

fn url_of(params: &Value) -> Result<String, RpcError> {
    params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "missing required argument `url`"))
}

/// A backend error, as the caller should read it.
fn rpc(e: CommandError) -> RpcError {
    let code = match e.code.as_str() {
        "BROWSER_BAD_URL" => ErrorCode::InvalidParams,
        "BROWSER_NO_PAGE" | "BROWSER_NO_HOST" => ErrorCode::Unavailable,
        "BROWSER_TIMEOUT" => ErrorCode::Timeout,
        _ => ErrorCode::Internal,
    };
    RpcError::new(code, e.message)
}

/// The workspace a caller's browser calls act on: an agent's own terminal's
/// workspace, else the one on screen.
pub async fn workspace_of<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
) -> Result<String, RpcError> {
    if let Caller::Launch { agent_id: Some(_) } = caller {
        let tab = Resolver::new(app, caller).current_terminal().await?;
        return Ok(tab.workspace);
    }
    let active = Bridge::ask(app, "browser/active", Value::Null).await?;
    Ok(active
        .get("workspace")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string())
}

/// A page as the catalog describes it.
fn page_view(s: &SessionState) -> Value {
    json!({
        "workspace": s.workspace,
        "url": s.url,
        "title": s.title,
        "loading": s.loading,
        "visible": s.visible,
        "canGoBack": s.can_go_back,
        "canGoForward": s.can_go_forward,
    })
}

fn state_of<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) -> Option<SessionState> {
    app.state::<BrowserHost>().state(workspace)
}

/// Wait until `workspace`'s page satisfies `done`, or `limit` passes. Returns
/// the last state seen.
async fn wait_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    limit: Duration,
    done: impl Fn(&SessionState) -> bool,
) -> Option<SessionState> {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        let state = state_of(app, workspace);
        if state.as_ref().is_some_and(&done) || tokio::time::Instant::now() >= deadline {
            return state;
        }
        tokio::time::sleep(POLL).await;
    }
}

/// Wait for a document newer than `generation` to finish loading.
async fn wait_loaded<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    generation: u64,
    limit: Duration,
) -> Option<SessionState> {
    let state = wait_for(app, workspace, limit, |s| {
        s.generation > generation && !s.loading
    })
    .await;
    // The URL of an in-page navigation and the history state are not pushed.
    match host::refresh(app, workspace).await {
        Ok(fresh) => Some(fresh),
        Err(_) => state,
    }
}

fn no_page() -> RpcError {
    RpcError::new(
        ErrorCode::Unavailable,
        "no browser page is open in this workspace — call browser_open first",
    )
}

/// `browser/status`.
pub async fn status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let workspace = workspace_of(app, caller).await?;
    let (enabled, policy) = {
        let state = app.state::<crate::state::AppState>();
        let data = state.data.read().await;
        (
            data.settings.browser.enabled,
            data.settings.browser.link_policy,
        )
    };
    let page = match state_of(app, &workspace) {
        Some(_) => host::refresh(app, &workspace).await.ok(),
        None => None,
    };
    Ok(json!({
        "enabled": enabled,
        "policy": policy,
        "workspace": workspace,
        "open": page.is_some(),
        "page": page.as_ref().map(page_view),
    }))
}

/// `browser/open` and `browser/navigate` (one path: the page opens if needed).
pub async fn open<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let url = url_of(params)?;
    crate::browser::parse_url(app, &url).map_err(rpc)?;
    let workspace = workspace_of(app, caller).await?;
    let routed = match crate::browser::link_target(app).await {
        LinkTarget::External => {
            crate::browser::open_external(app, &url).map_err(rpc)?;
            "external"
        }
        LinkTarget::Ask => {
            crate::browser::route_url(app, url.clone(), Some(workspace.clone()))
                .await
                .map_err(rpc)?;
            "ask"
        }
        LinkTarget::Internal => "browser",
    };
    if routed != "browser" {
        return Ok(json!({ "requested": url, "routed": routed, "page": null }));
    }
    let before = state_of(app, &workspace).map_or(0, |s| s.generation);
    // The window owns the panel and the slot the page is placed in; it opens
    // the session (and the panel, in that workspace) and creates the page.
    Bridge::ask(
        app,
        "browser/open",
        json!({ "url": url, "workspace": workspace }),
    )
    .await?;
    let page = wait_loaded(app, &workspace, before, LOAD_WAIT).await;
    Ok(json!({
        "requested": url,
        "routed": routed,
        "page": page.as_ref().map(page_view),
    }))
}

/// `browser/reload`.
pub async fn reload<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let workspace = workspace_of(app, caller).await?;
    let before = state_of(app, &workspace).ok_or_else(no_page)?.generation;
    host::reload(app, &workspace, false).map_err(rpc)?;
    let page = wait_loaded(app, &workspace, before, LOAD_WAIT).await;
    Ok(json!({ "reloaded": true, "page": page.as_ref().map(page_view) }))
}

/// A history step: `back` or `forward`. An in-page (`pushState`) history entry
/// commits no new document, so the step is given a moment and then read back.
async fn step<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    direction: &'static str,
) -> Result<Value, RpcError> {
    let workspace = workspace_of(app, caller).await?;
    let before = state_of(app, &workspace).ok_or_else(no_page)?;
    if direction == "back" {
        host::back(app, &workspace)
    } else {
        host::forward(app, &workspace)
    }
    .map_err(rpc)?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _ = wait_for(app, &workspace, STEP_WAIT, |s| !s.loading).await;
    let page = host::refresh(app, &workspace).await.ok();
    let moved = page
        .as_ref()
        .is_some_and(|p| p.url != before.url || p.generation != before.generation);
    Ok(json!({
        "navigated": direction,
        "moved": moved,
        "page": page.as_ref().map(page_view),
    }))
}

/// `browser/back`.
pub async fn back<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    step(app, caller, "back").await
}

/// `browser/forward`.
pub async fn forward<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    step(app, caller, "forward").await
}
