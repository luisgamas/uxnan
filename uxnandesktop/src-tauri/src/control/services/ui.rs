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

/// The editors this machine offers, in the order the "Open with" menus show
/// them: the ones detected on the PATH and in the install locations, minus the
/// ones the person hid, plus the ones they added by hand.
///
/// This list is the whole of what `file/open --with` can launch. A caller names
/// an entry; it never names a command, so the control surface cannot be talked
/// into running an arbitrary program through the editor door.
async fn editors<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<(String, String, Vec<String>)> {
    let (hidden, custom) = {
        let state = app.state::<crate::state::AppState>();
        let data = state.data.read().await;
        (
            data.settings.open_with.hidden_detected.clone(),
            data.settings.open_with.custom_editors.clone(),
        )
    };
    let mut out: Vec<(String, String, Vec<String>)> = crate::editors::detect()
        .into_iter()
        .filter(|d| !hidden.iter().any(|h| h == &d.id))
        .map(|d| (d.name, d.command, d.args))
        .collect();
    out.extend(
        custom
            .into_iter()
            .filter(|e| !e.command.trim().is_empty())
            .map(|e| (e.name, e.command, e.args)),
    );
    out
}

/// Match the `with` argument against an editor's name, or the command it is
/// launched by (`vscode`, `zed`), ignoring case. Returns what to launch.
fn choose(
    editors: &[(String, String, Vec<String>)],
    with: &str,
) -> Option<(String, String, Vec<String>)> {
    let want = with.trim().to_lowercase();
    editors
        .iter()
        .find(|(name, command, _)| {
            name.to_lowercase() == want
                || command.to_lowercase() == want
                || std::path::Path::new(command)
                    .file_stem()
                    .is_some_and(|stem| stem.to_string_lossy().to_lowercase() == want)
        })
        .cloned()
}

/// `file/open`. Without `with`, the window opens it in Uxnan's editor tab; with
/// it, the file goes to one of the person's external editors and the window is
/// not involved at all.
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
    if let Some(with) = params.get("with").and_then(|v| v.as_str()) {
        let available = editors(app).await;
        let Some((name, command, args)) = choose(&available, with) else {
            let known: Vec<&str> = available.iter().map(|(n, _, _)| n.as_str()).collect();
            return Err(RpcError::new(
                ErrorCode::NotFound,
                format!(
                    "no editor on this machine matches `{with}`; available: {}",
                    if known.is_empty() {
                        "none".to_string()
                    } else {
                        known.join(", ")
                    }
                ),
            ));
        };
        crate::editors::open_in_editor(&command, &args, &abs).map_err(|e| {
            RpcError::new(
                ErrorCode::Internal,
                format!("{name} could not be launched: {e}"),
            )
        })?;
        return Ok(json!({ "opened": abs, "openedWith": name }));
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

#[cfg(test)]
mod tests {
    use super::choose;

    fn editors() -> Vec<(String, String, Vec<String>)> {
        vec![
            ("Visual Studio Code".into(), "code".into(), vec![]),
            ("Zed".into(), "/usr/local/bin/zed".into(), vec![]),
            (
                "Sublime".into(),
                "open".into(),
                vec!["-a".into(), "Sublime Text.app".into()],
            ),
        ]
    }

    /// A caller names an editor the way a person would: by its name, by the
    /// command it is launched with, or by the file name of an absolute one.
    #[test]
    fn an_editor_is_found_by_name_command_or_file_name() {
        for (asked, expected) in [
            ("Visual Studio Code", "code"),
            ("visual studio code", "code"),
            ("code", "code"),
            ("zed", "/usr/local/bin/zed"),
            ("  Zed ", "/usr/local/bin/zed"),
            ("sublime", "open"),
        ] {
            let found = choose(&editors(), asked).unwrap_or_else(|| panic!("{asked}"));
            assert_eq!(found.1, expected, "{asked}");
        }
        // The arguments travel with it: an editor launched through `open`
        // without its `-a <App>` opens in the wrong application.
        assert_eq!(choose(&editors(), "sublime").unwrap().2.len(), 2);
    }

    /// What a caller may not do: name a command instead of an editor. Nothing
    /// outside the person's list is launchable, so the control surface has no
    /// door to an arbitrary program.
    #[test]
    fn a_command_that_is_not_one_of_the_persons_editors_is_not_found() {
        for asked in ["/bin/sh", "sh", "bash -c 'rm -rf .'", "cod", "codex", ""] {
            assert!(choose(&editors(), asked).is_none(), "{asked}");
        }
    }
}
