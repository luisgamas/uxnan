//! Actions on the window: focus it, reveal a terminal, open a file or a diff.
//! None of them touch the disk or a process.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::bridge::Bridge;
use crate::control::resolve::{path_key, path_within, Resolver};
use crate::control::Caller;

/// `app/focus`: bring the main window to the front. Done here — the window is a
/// backend object — and unminimized first, which `set_focus` alone does not do.
/// Looked up as a `Window`: once a browser page is open the main window holds
/// more than one webview, and `get_webview_window` no longer finds it.
pub async fn focus<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let Some(window) = app.get_window("main") else {
        return Err(RpcError::new(ErrorCode::Unavailable, "no main window"));
    };
    let _ = window.unminimize();
    let _ = window.show();
    window
        .set_focus()
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.to_string()))?;
    Ok(json!({ "focused": true }))
}

/// `terminal/reveal`: show the tab's workspace and make it active.
pub async fn reveal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("terminal")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tab = Resolver::new(app, caller).terminal(sel).await?;
    Bridge::ask(
        app,
        "terminal/reveal",
        json!({ "terminal": tab.id, "workspace": tab.workspace }),
    )
    .await?;
    Ok(json!({ "revealed": tab.id }))
}

/// Resolve the `path` + `worktree` arguments of `file/open` and `file/diff` to
/// an absolute file path inside a registered worktree, and that worktree. A
/// relative path needs a worktree (`current` when the caller has one); an
/// absolute path outside every registered worktree is refused, because the
/// editor is for the projects the app holds, not the whole disk.
async fn locate<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<(String, String), RpcError> {
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let sel = params.get("worktree").and_then(|v| v.as_str());
    let resolver = Resolver::new(app, caller);
    let is_abs = uxnan_control_protocol::selector::Selector::parse(path)
        .map(|s| matches!(s, uxnan_control_protocol::selector::Selector::Path(_)))
        .unwrap_or(false);
    if is_abs {
        let (_, entry) = match sel {
            Some(sel) => resolver.worktree(sel).await?,
            None => resolver
                .worktree(&format!("path:{path}"))
                .await
                .map_err(|_| {
                    RpcError::new(
                        ErrorCode::NotFound,
                        format!("{path} is not inside a registered worktree"),
                    )
                })?,
        };
        if !path_within(path, &entry.path) {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("{path} is not inside the worktree {}", entry.path),
            ));
        }
        return Ok((path.replace('\\', "/"), entry.path));
    }
    let (_, entry) = resolver.worktree(sel.unwrap_or("current")).await?;
    let rel = path.trim_start_matches(['/', '\\']);
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "a relative path may not climb out of the worktree",
        ));
    }
    let abs = format!(
        "{}/{}",
        path_key(&entry.path).trim_end_matches('/'),
        rel.replace('\\', "/")
    );
    Ok((abs, entry.path))
}

/// `file/open`.
pub async fn open_file<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let (abs, worktree) = locate(app, caller, params).await?;
    if !std::path::Path::new(&abs).is_file() {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("{abs} is not a file"),
        ));
    }
    Bridge::ask(
        app,
        "file/open",
        json!({ "path": abs, "worktree": worktree }),
    )
    .await?;
    Ok(json!({ "opened": abs }))
}

/// `file/diff`.
pub async fn open_diff<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let (abs, worktree) = locate(app, caller, params).await?;
    let staged = params
        .get("staged")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rel = abs
        .strip_prefix(&format!("{}/", path_key(&worktree)))
        .map(str::to_string)
        .unwrap_or_else(|| abs.clone());
    Bridge::ask(
        app,
        "file/diff",
        json!({ "path": rel, "worktree": worktree, "staged": staged }),
    )
    .await?;
    Ok(json!({ "opened": abs, "staged": staged }))
}
