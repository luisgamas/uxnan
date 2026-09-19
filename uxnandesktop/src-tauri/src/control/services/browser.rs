//! The integrated browser. The entries map to the paths in `crate::browser`:
//! `open` / `navigate` go through `route_url` (honoring the user's link policy
//! and driving the frontend panel, exactly like a clicked link), while `reload`
//! / `back` / `forward` act on the already-open window.
//!
//! FOR-DEV: page inspection + interaction (`browser/snapshot`, `browser/evaluate`,
//! `browser/click`, `browser/type`) are deliberately absent. They need a JS
//! return-channel from the docked `WebviewWindow` (Tauri's `.eval()` is
//! fire-and-forget) — an injected init-script that posts results back, mindful
//! of page CSP — and would be new catalog entries in the `ui` group. See
//! `FOR-DEV.md` → *Integrated developer browser*.

use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::Caller;

fn url_of(params: &Value) -> Result<String, RpcError> {
    params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "missing required argument `url`"))
}

/// `browser/open` and `browser/navigate` (one path: the panel opens if needed).
pub async fn open<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let url = url_of(params)?;
    crate::browser::route_url(app, url.clone())
        .await
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    Ok(json!({ "requested": url }))
}

/// `browser/reload`.
pub async fn reload<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    crate::browser::browser_window_reload(app.clone())
        .map_err(|e| RpcError::new(ErrorCode::Unavailable, e.message))?;
    Ok(json!({ "reloaded": true }))
}

/// `browser/back`.
pub async fn back<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    crate::browser::browser_window_back(app.clone())
        .map_err(|e| RpcError::new(ErrorCode::Unavailable, e.message))?;
    Ok(json!({ "navigated": "back" }))
}

/// `browser/forward`.
pub async fn forward<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    crate::browser::browser_window_forward(app.clone())
        .map_err(|e| RpcError::new(ErrorCode::Unavailable, e.message))?;
    Ok(json!({ "navigated": "forward" }))
}

/// `browser/status`.
pub async fn status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    serde_json::to_value(crate::browser::status(app).await)
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.to_string()))
}
