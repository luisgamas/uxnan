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

use crate::browser::approval::{self, Answer, ApprovalRequest, Approvals};
use crate::browser::host::{self, BrowserHost, SessionState};
use crate::browser::policy::{self, Action, Decision, Origin, Risk, Target};
use crate::browser::{capture, page, LinkTarget};
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

// --- Reading and acting on the page ---------------------------------------
//
// Every one of these goes through the policy (`crate::browser::policy`): where
// the page is and how risky the request is decide whether it runs, is refused,
// or waits for the person (`crate::browser::approval`). An action names an
// element only by a reference a snapshot of the *current* document handed out;
// the page script refuses any other.

/// How long an action is given to start a navigation, and a started one to
/// finish loading, before the call answers.
const SETTLE: Duration = Duration::from_millis(350);
const ACTION_LOAD_WAIT: Duration = Duration::from_secs(10);
/// The longest `browser/wait` may wait.
const MAX_WAIT: Duration = Duration::from_secs(30);

fn refused(message: impl Into<String>) -> RpcError {
    RpcError::new(ErrorCode::Refused, message)
}

/// A page-script error, as the caller should read it.
fn page_rpc(e: CommandError) -> RpcError {
    let code = match e.code.as_str() {
        "BROWSER_PAGE_STALE"
        | "BROWSER_PAGE_HIDDEN"
        | "BROWSER_PAGE_DISABLED"
        | "BROWSER_PAGE_OBSCURED"
        | "BROWSER_PAGE_KEY"
        | "BROWSER_PAGE_NO_OPTION"
        | "BROWSER_PAGE_NOT_EDITABLE"
        | "BROWSER_PAGE_READONLY" => ErrorCode::InvalidParams,
        "BROWSER_PAGE_REFUSED" => ErrorCode::Refused,
        "BROWSER_NOT_READY" | "BROWSER_NO_PAGE" => ErrorCode::Unavailable,
        "BROWSER_TIMEOUT" => ErrorCode::Timeout,
        "BROWSER_UNSUPPORTED" => ErrorCode::Unavailable,
        _ => ErrorCode::Internal,
    };
    RpcError::new(code, e.message)
}

/// Who is asking, as the person should read it in an approval.
async fn asker<R: tauri::Runtime>(app: &AppHandle<R>, caller: &Caller) -> String {
    match caller {
        Caller::Launch { agent_id: Some(_) } => Resolver::new(app, caller)
            .current_terminal()
            .await
            .map(|t| t.agent_name.unwrap_or(t.title))
            .unwrap_or_else(|_| "An agent".into()),
        _ => "uxnan-cli".into(),
    }
}

/// Whether the person allowed agents on sites outside this machine.
async fn external_allowed<R: tauri::Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<crate::state::AppState>();
    let data = state.data.read().await;
    data.settings.browser.agent_external_sites
}

/// The host an approval names.
fn host_label(origin: &Origin, url: &str) -> String {
    match origin {
        Origin::External(host) => host.clone(),
        Origin::Local => tauri::Url::parse(url)
            .ok()
            .and_then(|u| {
                u.host_str().map(|h| {
                    format!(
                        "{h}{}",
                        u.port().map(|p| format!(":{p}")).unwrap_or_default()
                    )
                })
            })
            .unwrap_or_else(|| "this machine".into()),
    }
}

/// A request for the person, filled in by the caller.
struct Ask<'a> {
    action: &'a str,
    risk: Option<Risk>,
    target: Option<String>,
    detail: Option<String>,
    highlight: Option<&'a str>,
}

/// Run the policy for a request on `workspace`'s page; `Ok` means go ahead.
async fn permit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    workspace: &str,
    page: &SessionState,
    ask: Ask<'_>,
) -> Result<(), RpcError> {
    let origin = policy::origin_of(&page.url);
    let host = host_label(&origin, &page.url);
    let approvals = app.state::<Approvals>();
    let decision = policy::decide(
        &origin,
        ask.risk,
        external_allowed(app).await,
        approvals.site_approved(workspace, &host),
    );
    let scope = match decision {
        Decision::Allow => return Ok(()),
        Decision::Refuse(why) => return Err(refused(why)),
        Decision::AskOnce => "once",
        Decision::AskSite => "site",
    };
    if let Some(r) = ask.highlight {
        let _ = page::call(
            app,
            workspace,
            json!({ "op": "highlight", "ref": r, "ms": 125_000 }),
        )
        .await;
    }
    let answer = approval::ask(
        app,
        ApprovalRequest {
            id: String::new(),
            workspace: workspace.to_string(),
            agent: asker(app, caller).await,
            action: ask.action.to_string(),
            risk: ask.risk,
            host,
            url: page.url.clone(),
            scope,
            target: ask.target,
            detail: ask.detail,
        },
    )
    .await;
    if ask.highlight.is_some() {
        let _ = page::call(app, workspace, json!({ "op": "unhighlight" })).await;
    }
    match answer {
        Answer::Deny => Err(refused(format!(
            "the person declined, or did not answer within {} s — if they did not see it, say what you want to do and call again",
            approval::TIMEOUT.as_secs()
        ))),
        Answer::Once | Answer::Site => Ok(()),
    }
}

/// The caller's workspace and its page, or the error that there is none.
async fn current_page<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
) -> Result<(String, SessionState), RpcError> {
    let workspace = workspace_of(app, caller).await?;
    let page = state_of(app, &workspace).ok_or_else(no_page)?;
    Ok((workspace, page))
}

/// The page's outline (what `browser/snapshot` answers).
async fn outline<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
) -> Result<Value, RpcError> {
    let snap = page::call(app, workspace, json!({ "op": "snapshot" }))
        .await
        .map_err(page_rpc)?;
    let text = |k: &str| {
        snap.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let num = |k: &str| snap.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
    let viewport = snap.get("viewport").cloned().unwrap_or(Value::Null);
    let int = |k: &str| viewport.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    Ok(json!({
        "url": text("url"),
        "title": text("title"),
        "outline": text("outline"),
        "nodes": num("nodes"),
        "interactive": num("interactive"),
        "truncated": snap.get("truncated").and_then(|v| v.as_bool()).unwrap_or(false),
        "consoleErrors": num("consoleErrors"),
        "viewport": {
            "width": int("width"),
            "height": int("height"),
            "scrollX": int("scrollX"),
            "scrollY": int("scrollY"),
            "scrollHeight": int("scrollHeight"),
        },
    }))
}

/// `browser/snapshot`.
pub async fn snapshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let (workspace, page) = current_page(app, caller).await?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "read",
            risk: None,
            target: None,
            detail: None,
            highlight: None,
        },
    )
    .await?;
    outline(app, &workspace).await
}

/// `browser/screenshot`.
pub async fn screenshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    use base64::Engine;
    if !capture::supported() {
        return Err(RpcError::new(
            ErrorCode::Unavailable,
            "page screenshots are not available on this platform yet — use browser_snapshot",
        ));
    }
    let (workspace, page) = current_page(app, caller).await?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "screenshot",
            risk: None,
            target: None,
            detail: None,
            highlight: None,
        },
    )
    .await?;
    let webview = host::webview(app, &workspace).map_err(rpc)?;
    let shot = capture::png(&webview).await.map_err(page_rpc)?;
    Ok(json!({
        "url": page.url,
        "visible": page.visible,
        "image": {
            "mimeType": "image/png",
            "width": shot.width,
            "height": shot.height,
            "data": base64::engine::general_purpose::STANDARD.encode(&shot.png),
        },
    }))
}

/// `browser/console`.
pub async fn console<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let (workspace, page) = current_page(app, caller).await?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "console",
            risk: None,
            target: None,
            detail: None,
            highlight: None,
        },
    )
    .await?;
    let since = params.get("since").and_then(|v| v.as_u64()).unwrap_or(0);
    let level = params
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("all");
    let out = page::call(app, &workspace, json!({ "op": "console", "since": since }))
        .await
        .map_err(page_rpc)?;
    let keep = |l: &str| match level {
        "error" => l == "error",
        "warn" => l == "error" || l == "warn",
        _ => true,
    };
    let entries: Vec<Value> = out
        .get("entries")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter(|e| keep(e.get("level").and_then(|v| v.as_str()).unwrap_or("")))
        .map(|e| {
            json!({
                "seq": e.get("seq").and_then(|v| v.as_u64()).unwrap_or(0),
                "level": e.get("level").and_then(|v| v.as_str()).unwrap_or("info"),
                "text": e.get("text").and_then(|v| v.as_str()).unwrap_or_default(),
                "at": e.get("at").and_then(|v| v.as_u64()).unwrap_or(0),
            })
        })
        .collect();
    Ok(json!({
        "entries": entries,
        "dropped": out.get("dropped").and_then(|v| v.as_u64()).unwrap_or(0),
        "last": out.get("last").and_then(|v| v.as_u64()).unwrap_or(0),
    }))
}

/// `browser/wait`: until the page shows `text`, or the time runs out.
pub async fn wait<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "missing required argument `text`"))?
        .to_string();
    let limit = params
        .get("timeout")
        .and_then(|v| v.as_f64())
        .map(|s| Duration::from_secs_f64(s.clamp(0.0, MAX_WAIT.as_secs_f64())))
        .unwrap_or(Duration::from_secs(10));
    let (workspace, page) = current_page(app, caller).await?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "read",
            risk: None,
            target: None,
            detail: None,
            highlight: None,
        },
    )
    .await?;
    let started = tokio::time::Instant::now();
    loop {
        // A page mid-navigation has no script for a moment; keep looking.
        let found = page::call(app, &workspace, json!({ "op": "hasText", "text": text }))
            .await
            .ok()
            .and_then(|v| v.get("found").and_then(|f| f.as_bool()))
            .unwrap_or(false);
        let waited = started.elapsed();
        if found || waited >= limit {
            let page = state_of(app, &workspace);
            return Ok(json!({
                "found": found,
                "waitedMs": waited.as_millis() as u64,
                "page": page.as_ref().map(page_view),
            }));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// The element a reference names, as the page describes it.
async fn describe<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    reference: &str,
) -> Result<Value, RpcError> {
    page::call(
        app,
        workspace,
        json!({ "op": "describe", "ref": reference }),
    )
    .await
    .map_err(page_rpc)
}

fn target_label(d: &Value) -> Option<String> {
    let role = d.get("role").and_then(|v| v.as_str()).unwrap_or_default();
    let name = d.get("name").and_then(|v| v.as_str()).unwrap_or_default();
    match (role.is_empty(), name.is_empty()) {
        (true, true) => None,
        (false, true) => Some(role.to_string()),
        (_, false) => Some(format!("{role} “{name}”").trim().to_string()),
    }
}

fn ref_of(params: &Value) -> Result<String, RpcError> {
    params
        .get("ref")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            RpcError::new(
                ErrorCode::InvalidParams,
                "missing required argument `ref` (from browser_snapshot)",
            )
        })
}

/// Let an action's effect land: a navigation it started is waited for, and
/// the page read back. Returns the page and whether a new document loaded.
async fn settle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    generation: u64,
) -> (Option<SessionState>, bool) {
    tokio::time::sleep(SETTLE).await;
    let moved = state_of(app, workspace).is_some_and(|s| s.generation != generation || s.loading);
    if moved {
        let _ = wait_for(app, workspace, ACTION_LOAD_WAIT, |s| {
            s.generation != generation && !s.loading
        })
        .await;
    }
    let page = host::refresh(app, workspace)
        .await
        .ok()
        .or_else(|| state_of(app, workspace));
    let navigated = page.as_ref().is_some_and(|p| p.generation != generation);
    (page, navigated)
}

/// Carry out an action the policy allowed, then answer with its effect.
async fn run_action<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    generation: u64,
    kind: &str,
    request: Value,
    with_snapshot: bool,
) -> Result<Value, RpcError> {
    // The page the agent looked at must be the one still loaded: an approval
    // is for that document, never for whatever replaced it.
    if state_of(app, workspace).map(|s| s.generation) != Some(generation) {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "the page navigated before the action could run — take a new snapshot",
        ));
    }
    let done = page::call(app, workspace, request)
        .await
        .map_err(page_rpc)?;
    let (page, navigated) = settle(app, workspace, generation).await;
    let mut out = json!({
        "done": kind,
        "navigated": navigated,
        "page": page.as_ref().map(page_view),
    });
    for key in ["effect", "chosen", "scrollX", "scrollY"] {
        if let Some(v) = done.get(key) {
            out[key] = v.clone();
        }
    }
    if with_snapshot {
        out["snapshot"] = outline(app, workspace).await.unwrap_or(Value::Null);
    }
    Ok(out)
}

fn wants_snapshot(params: &Value) -> bool {
    params
        .get("snapshot")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// `browser/click`.
pub async fn click<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let reference = ref_of(params)?;
    let (workspace, page) = current_page(app, caller).await?;
    let d = describe(app, &workspace, &reference).await?;
    let risk = policy::classify(&Action::Click(Target::from_describe(&d))).map_err(refused)?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "click",
            risk: Some(risk),
            target: target_label(&d),
            detail: None,
            highlight: Some(&reference),
        },
    )
    .await?;
    run_action(
        app,
        &workspace,
        page.generation,
        "click",
        json!({ "op": "click", "ref": reference }),
        wants_snapshot(params),
    )
    .await
}

/// `browser/type`.
pub async fn type_text<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let reference = ref_of(params)?;
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "missing required argument `text`"))?
        .to_string();
    let clear = params
        .get("clear")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let (workspace, page) = current_page(app, caller).await?;
    let d = describe(app, &workspace, &reference).await?;
    let risk = policy::classify(&Action::Type(Target::from_describe(&d))).map_err(refused)?;
    // The person sees how much is typed, never what: the text is the agent's.
    let detail = Some(format!("{} characters", text.chars().count()));
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "type",
            risk: Some(risk),
            target: target_label(&d),
            detail,
            highlight: Some(&reference),
        },
    )
    .await?;
    run_action(
        app,
        &workspace,
        page.generation,
        "type",
        json!({ "op": "type", "ref": reference, "text": text, "clear": clear }),
        wants_snapshot(params),
    )
    .await
}

/// `browser/press`.
pub async fn press<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let key = params
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "missing required argument `key`"))?
        .to_string();
    let shift = params
        .get("shift")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let (workspace, page) = current_page(app, caller).await?;
    let intent = page::call(app, &workspace, json!({ "op": "pressIntent", "key": key }))
        .await
        .map_err(page_rpc)?;
    let submits = intent
        .get("submits")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let activates = intent
        .get("activates")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let focused = intent
        .get("target")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let focused_desc = match (&focused, activates) {
        (Some(r), true) => describe(app, &workspace, r).await.ok(),
        _ => None,
    };
    let risk = policy::classify(&Action::Press {
        key: key.clone(),
        submits,
        activates: focused_desc.as_ref().map(Target::from_describe),
    })
    .map_err(refused)?;
    let detail = Some(if submits {
        format!("{key} (submits the form)")
    } else {
        key.clone()
    });
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "press",
            risk: Some(risk),
            target: focused_desc.as_ref().and_then(target_label),
            detail,
            highlight: focused.as_deref(),
        },
    )
    .await?;
    run_action(
        app,
        &workspace,
        page.generation,
        "press",
        json!({ "op": "press", "key": key, "shift": shift }),
        wants_snapshot(params),
    )
    .await
}

/// `browser/scroll`.
pub async fn scroll<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let amount = params
        .get("amount")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.8)
        .clamp(0.05, 5.0);
    let (dx, dy) = match params
        .get("direction")
        .and_then(|v| v.as_str())
        .unwrap_or("down")
    {
        "up" => (0.0, -amount),
        "left" => (-amount, 0.0),
        "right" => (amount, 0.0),
        _ => (0.0, amount),
    };
    let reference = params
        .get("ref")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let (workspace, page) = current_page(app, caller).await?;
    let risk = policy::classify(&Action::Scroll).map_err(refused)?;
    permit(
        app,
        caller,
        &workspace,
        &page,
        Ask {
            action: "scroll",
            risk: Some(risk),
            target: None,
            detail: None,
            highlight: None,
        },
    )
    .await?;
    run_action(
        app,
        &workspace,
        page.generation,
        "scroll",
        json!({ "op": "scroll", "ref": reference, "dx": dx, "dy": dy }),
        wants_snapshot(params),
    )
    .await
}
