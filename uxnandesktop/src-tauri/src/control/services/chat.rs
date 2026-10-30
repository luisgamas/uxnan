//! Chats: the conversations the Uxnan bridge drives (the chat tabs, and the
//! ones started on the phone), reached through the app's bridge client — the
//! same connection the window uses. Scoped like everything else: a caller sees
//! and drives only the conversations whose folder is in its scope.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::bridgeclient::connection::CallError;
use crate::bridgeclient::BridgeCallError;
use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::redact::redact;
use crate::control::resolve::{path_key, Resolver};
use crate::control::Caller;
use crate::state::AppState;

/// A `turn/send` returns once the agent was started; `thread/list` is quick.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// The most a message may weigh (the same bound as `agent/send`).
const MESSAGE_MAX: usize = 64 * 1024;
/// How many turns `chat/read` returns at most.
const READ_TURNS_MAX: u64 = 20;
/// How much of one answer `chat/read` returns (its end is kept).
const ANSWER_MAX: usize = 16 * 1024;
/// How many steps `chat/read` lists for one turn: its newest ones.
const STEPS_MAX: usize = 100;
/// The longest one `chat/wait` call waits (the same bound as `agent/wait`).
const WAIT_MAX: Duration = Duration::from_secs(15);
/// How often `chat/wait` asks the bridge.
const WAIT_POLL: Duration = Duration::from_millis(400);

/// Calls the bridge, turning "no bridge" into *unavailable* with the fix.
async fn call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: Value,
) -> Result<Value, RpcError> {
    app.state::<AppState>()
        .bridge
        .call(method, params, CALL_TIMEOUT)
        .await
        .map_err(|err| match err {
            BridgeCallError::NotConnected => RpcError::new(
                ErrorCode::Unavailable,
                "Uxnan is not connected to the bridge: turn it on in Settings → Bridge & mobile",
            ),
            // The bridge's own refusals keep their meaning: a bad argument it
            // checked (an unknown agent, a short query) and a conversation it
            // does not have.
            BridgeCallError::Call(CallError::Rpc { code, message })
                if code == BRIDGE_INVALID_PARAMS =>
            {
                RpcError::new(ErrorCode::InvalidParams, message)
            }
            BridgeCallError::Call(CallError::Rpc { code, message }) if code == BRIDGE_NOT_FOUND => {
                RpcError::new(ErrorCode::NotFound, message)
            }
            other => RpcError::new(ErrorCode::Internal, other.to_string()),
        })
}

/// The bridge's JSON-RPC code for invalid params (`JsonRpcErrorCode.InvalidParams`).
const BRIDGE_INVALID_PARAMS: i64 = -32602;
/// The bridge's code for an unknown thread or turn (`JsonRpcErrorCode.ResourceNotFound`).
const BRIDGE_NOT_FOUND: i64 = -32008;
/// The longest idempotency key the bridge keeps as a `clientTransferId`.
const TRANSFER_KEY_MAX: usize = 128;

/// The thread id a `chat` selector names (`id:<threadId>`, or the bare id).
fn thread_id(params: &Value) -> Result<String, RpcError> {
    let raw = params
        .get("chat")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let id = raw.strip_prefix("id:").unwrap_or(raw);
    if id.is_empty() {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "`chat` is required: `id:<conversationId>` from `chat/list`",
        ));
    }
    Ok(id.to_string())
}

/// One conversation as the catalog describes it.
fn view(thread: &Value) -> Value {
    let running = thread.get("activeTurnId").and_then(Value::as_str).is_some();
    json!({
        "id": thread.get("id").cloned().unwrap_or(Value::Null),
        "title": thread.get("title").cloned().unwrap_or(Value::Null),
        "agent": thread.get("agentId").cloned().unwrap_or(Value::Null),
        "model": thread.get("model").cloned().unwrap_or(Value::Null),
        "folder": thread.get("cwd").cloned().unwrap_or(Value::Null),
        "state": if running { "working" } else { "idle" },
        "archived": thread.get("status").and_then(Value::as_str) == Some("archived"),
        "updatedAt": thread.get("updatedAt").cloned().unwrap_or(Value::Null),
    })
}

/// A thread the caller may name, or the error that says why not.
async fn admitted<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    id: &str,
) -> Result<Value, RpcError> {
    let thread = call(app, "thread/read", json!({ "threadId": id }))
        .await
        .map_err(|e| {
            if e.code == ErrorCode::Internal {
                RpcError::new(ErrorCode::NotFound, format!("no conversation `id:{id}`"))
            } else {
                e
            }
        })?;
    let folder = thread.get("cwd").and_then(Value::as_str);
    let resolver = Resolver::new(app, caller);
    if !resolver.scope().await.admits_folder(folder) {
        return Err(RpcError::new(
            ErrorCode::ScopeDenied,
            format!("`id:{id}` names a conversation outside your scope"),
        ));
    }
    Ok(thread)
}

/// `chat/list`: the conversations in the caller's scope (one worktree's when
/// `worktree` names it), newest first. Archived ones only with `archived`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let resolver = Resolver::new(app, caller);
    let folder = match params.get("worktree").and_then(Value::as_str) {
        Some(sel) => Some(resolver.worktree(sel).await?.1.path),
        None => None,
    };
    let with_archived = params.get("archived").and_then(Value::as_bool) == Some(true);
    let list = call(app, "thread/list", json!({})).await?;
    let scope = resolver.scope().await;
    let mut chats: Vec<Value> = list
        .get("threads")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|t| {
            let cwd = t.get("cwd").and_then(Value::as_str);
            scope.admits_folder(cwd)
                && folder
                    .as_deref()
                    .is_none_or(|f| cwd.is_some_and(|c| path_key(c) == path_key(f)))
                && (with_archived || t.get("status").and_then(Value::as_str) != Some("archived"))
        })
        .map(view)
        .collect();
    chats.sort_by_key(|c| std::cmp::Reverse(c["updatedAt"].as_i64().unwrap_or(0)));
    Ok(json!({ "chats": chats }))
}

/// `chat/open`: show a conversation in its chat tab (or the tab already
/// showing it).
pub async fn open<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = thread_id(params)?;
    let thread = admitted(app, caller, &id).await?;
    let answer = Bridge::ask(
        app,
        "chat/open",
        json!({ "threadId": id, "cwd": thread.get("cwd").cloned().unwrap_or(Value::Null) }),
    )
    .await?;
    Ok(json!({ "chat": id, "tab": answer.get("tab").cloned().unwrap_or(Value::Null) }))
}

/// `chat/send`: send a whole message to a conversation. The bridge queues it
/// behind a running turn (or hands it to the turn, on agents that take input
/// mid-turn), exactly as for a message typed in the chat or on the phone.
pub async fn send<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = thread_id(params)?;
    let message = params
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if message.is_empty() {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "`message` is empty",
        ));
    }
    if message.len() > MESSAGE_MAX {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "`message` is larger than 64 KiB",
        ));
    }
    admitted(app, caller, &id).await?;
    let sent = call(app, "turn/send", json!({ "threadId": id, "text": message })).await?;
    Ok(json!({
        "chat": id,
        "turnId": sent.get("turnId").cloned().unwrap_or(Value::Null),
        "queued": sent.get("queued").and_then(Value::as_bool).unwrap_or(false),
    }))
}

/// The bridge's id for the agent a caller names: its own ids, and the names
/// people use for them (`claude`, `pi`, `agy`, …).
fn bridge_agent(raw: &str) -> Result<&'static str, RpcError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "claude-code" | "claudecode" | "claude" => Ok("claude-code"),
        "codex" => Ok("codex"),
        "opencode" => Ok("opencode"),
        "pi-agent" | "pi" => Ok("pi-agent"),
        "antigravity-cli" | "antigravity" | "agy" => Ok("antigravity-cli"),
        "zero" => Ok("zero"),
        "grok" => Ok("grok"),
        "" => Err(RpcError::new(
            ErrorCode::InvalidParams,
            "`agent` is required: claude-code, codex, opencode, pi-agent, antigravity-cli, zero or grok",
        )),
        other => Err(RpcError::new(
            ErrorCode::InvalidParams,
            format!(
                "unknown agent `{other}`: claude-code, codex, opencode, pi-agent, antigravity-cli, zero or grok"
            ),
        )),
    }
}

/// A message a caller sends, checked: not empty, at most 64 KiB.
fn message_of(params: &Value, key: &str) -> Result<Option<String>, RpcError> {
    let Some(raw) = params.get(key).and_then(Value::as_str) else {
        return Ok(None);
    };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if text.len() > MESSAGE_MAX {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            format!("`{key}` is larger than 64 KiB"),
        ));
    }
    Ok(Some(text.to_string()))
}

/// `chat/start`: start a chat with an agent in a worktree — the same as the
/// chat tab's own start: the bridge registers the folder, the agent is fixed
/// for the chat's life, and it may act without asking (the posture a chat
/// started on the phone or in the tab has). An optional first message is sent
/// at once; the chat is shown in a tab unless `open` is false. Every client
/// of the bridge sees it, the phone included.
pub async fn start<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let selector = params.get("worktree").and_then(Value::as_str).unwrap_or("");
    let folder = Resolver::new(app, caller).worktree(selector).await?.1.path;
    let agent = bridge_agent(params.get("agent").and_then(Value::as_str).unwrap_or(""))?;
    let message = message_of(params, "message")?;
    let mut start = json!({ "agentId": agent, "cwd": folder });
    // Continuing another chat: the bridge prepares its context and the first
    // message carries it (architecture/02a §5.8.21). The source must be one
    // the caller may name.
    let source = match params.get("continueFrom").and_then(Value::as_str) {
        Some(raw) if !raw.trim().is_empty() => {
            let id = thread_id(&json!({ "chat": raw }))?;
            admitted(app, caller, &id).await?;
            start["continueFrom"] = continue_from(&id, params)?;
            Some(id)
        }
        _ => {
            if params.get("strategy").and_then(Value::as_str).is_some() {
                return Err(RpcError::new(
                    ErrorCode::InvalidParams,
                    "`strategy` goes with `continueFrom`",
                ));
            }
            None
        }
    };
    for key in ["model", "title"] {
        if let Some(v) = params.get(key).and_then(Value::as_str).map(str::trim) {
            if !v.is_empty() {
                start[key] = json!(v);
            }
        }
    }
    let thread = call(app, "thread/start", start).await?;
    let id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(ErrorCode::Internal, "the bridge started no conversation"))?
        .to_string();
    // Best-effort, as in the tab: a chat keeps working without it.
    let _ = call(
        app,
        "thread/setAccessMode",
        json!({ "threadId": id, "mode": "fullAccess" }),
    )
    .await;
    let mut turn = Value::Null;
    if let Some(text) = message {
        let sent = call(app, "turn/send", json!({ "threadId": id, "text": text })).await?;
        turn = sent.get("turnId").cloned().unwrap_or(Value::Null);
    }
    let open = params.get("open").and_then(Value::as_bool) != Some(false);
    if open {
        // The tab is a view: a window that cannot show it now still has the chat.
        let _ = Bridge::ask(app, "chat/open", json!({ "threadId": id, "cwd": folder })).await;
    }
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({
            "chat": id,
            "agent": agent,
            "folder": folder,
            "turnId": turn,
            "opened": open,
            "continuedFrom": source,
        }),
    ))
}

/// The strategy a caller asked for: `selection`, `reference` or `fork`; absent
/// → none (the bridge's default, `selection`).
fn strategy_of(params: &Value) -> Result<Option<&'static str>, RpcError> {
    match params
        .get("strategy")
        .and_then(Value::as_str)
        .map(str::trim)
    {
        None | Some("") => Ok(None),
        Some("selection") => Ok(Some("selection")),
        Some("reference") => Ok(Some("reference")),
        Some("fork") => Ok(Some("fork")),
        Some(other) => Err(RpcError::new(
            ErrorCode::InvalidParams,
            format!("unknown strategy `{other}`: selection, reference or fork"),
        )),
    }
}

/// The caller's idempotency key as the bridge's `clientTransferId`, when it
/// fits: the bridge then makes one continuation per key even across restarts
/// of this app, which keeps its receipts in memory only.
fn transfer_key(params: &Value) -> Option<String> {
    receipts::key_of(params).filter(|k| k.len() <= TRANSFER_KEY_MAX)
}

/// `thread/start`'s `continueFrom` for a source chat.
fn continue_from(source: &str, params: &Value) -> Result<Value, RpcError> {
    let mut from = json!({ "threadId": source, "createdBy": "agent" });
    if let Some(strategy) = strategy_of(params)? {
        from["strategy"] = json!(strategy);
    }
    if let Some(key) = transfer_key(params) {
        from["clientTransferId"] = json!(key);
    }
    Ok(from)
}

/// What a continuation is, as `chat/fork` and `chat/forward` report it: the
/// new chat and what it carries from its source. `status` is the bridge's,
/// proven against the real turn: `pending` until a message runs, `sent` while
/// it does, `delivered` once the agent answered it.
fn continuation_view(thread: &Value, source: &str, turn: Value, opened: bool) -> Value {
    let transfer = thread.get("transfer");
    let at = |pointer: &str| {
        transfer
            .and_then(|t| t.pointer(pointer))
            .cloned()
            .unwrap_or(Value::Null)
    };
    json!({
        "chat": thread.get("id").cloned().unwrap_or(Value::Null),
        "agent": thread.get("agentId").cloned().unwrap_or(Value::Null),
        "folder": thread.get("cwd").cloned().unwrap_or(Value::Null),
        "sourceChat": source,
        "strategy": at("/strategy"),
        "status": at("/status"),
        "contextTokens": at("/context/approxTokens"),
        "turns": thread.get("turnCount").cloned().unwrap_or(json!(0)),
        "turnId": turn,
        "opened": opened,
    })
}

/// The new conversation's id in a bridge answer.
fn new_id(thread: &Value) -> Result<String, RpcError> {
    thread
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| RpcError::new(ErrorCode::Internal, "the bridge made no conversation"))
}

/// What a continuation does after the bridge made it, the same as `chat/start`:
/// it may act without asking (best-effort), sends the first message when one
/// was given — the context goes with it — and is shown unless `open` is
/// false. Answers the turn started and the conversation as it now stands.
async fn settle_continuation<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread: Value,
    created: bool,
    message: Option<String>,
    open: bool,
) -> Result<(Value, Value), RpcError> {
    let id = new_id(&thread)?;
    let mut turn = Value::Null;
    let mut thread = thread;
    // A retry the bridge recognised made nothing new, so it sends nothing.
    if created {
        let _ = call(
            app,
            "thread/setAccessMode",
            json!({ "threadId": id, "mode": "fullAccess" }),
        )
        .await;
        if let Some(text) = message {
            let sent = call(app, "turn/send", json!({ "threadId": id, "text": text })).await?;
            turn = sent.get("turnId").cloned().unwrap_or(Value::Null);
            // Its status moved with the turn (`sent`): report the real one.
            if let Ok(now) = call(app, "thread/read", json!({ "threadId": id })).await {
                thread = now;
            }
        }
    }
    if open {
        let cwd = thread.get("cwd").cloned().unwrap_or(Value::Null);
        let _ = Bridge::ask(app, "chat/open", json!({ "threadId": id, "cwd": cwd })).await;
    }
    Ok((thread, turn))
}

/// `chat/fork`: a copy of a chat with the same agent — its history copied, and
/// its first message carrying a selection of it, since the copy's agent
/// session starts empty. The source stays as it is.
pub async fn fork<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let source = thread_id(params)?;
    admitted(app, caller, &source).await?;
    let mut ask = json!({ "threadId": source, "createdBy": "agent" });
    if let Some(key) = transfer_key(params) {
        ask["clientTransferId"] = json!(key);
    }
    let thread = call(app, "thread/fork", ask).await?;
    let open = params.get("open").and_then(Value::as_bool) != Some(false);
    let (thread, turn) = settle_continuation(app, thread, true, None, open).await?;
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        continuation_view(&thread, &source, turn, open),
    ))
}

/// `chat/forward`: continue a chat with another agent, as a new chat in the
/// same folder. No agent can continue another CLI's own session, so the new
/// chat's first message carries the context the bridge prepared from the
/// source; the source stays as it is and names its continuation.
pub async fn forward<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let source = thread_id(params)?;
    let agent = bridge_agent(params.get("agent").and_then(Value::as_str).unwrap_or(""))?;
    let strategy = strategy_of(params)?;
    let message = message_of(params, "message")?;
    admitted(app, caller, &source).await?;
    let mut ask = json!({ "sourceThreadId": source, "agentId": agent, "createdBy": "agent" });
    for key in ["model", "title"] {
        if let Some(v) = params.get(key).and_then(Value::as_str).map(str::trim) {
            if !v.is_empty() {
                ask[key] = json!(v);
            }
        }
    }
    if let Some(strategy) = strategy {
        ask["strategy"] = json!(strategy);
    }
    if let Some(key) = transfer_key(params) {
        ask["clientTransferId"] = json!(key);
    }
    // The message is sent here, not by `thread/transfer`, so the chat takes
    // its access mode first — the order `chat/start` keeps.
    let made = call(app, "thread/transfer", ask).await?;
    let created = made.get("created").and_then(Value::as_bool) != Some(false);
    let thread = made.get("thread").cloned().unwrap_or(Value::Null);
    let open = params.get("open").and_then(Value::as_bool) != Some(false);
    let (thread, turn) = settle_continuation(app, thread, created, message, open).await?;
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        continuation_view(&thread, &source, turn, open),
    ))
}

/// One `thread/search` answer as `chat/search` returns it: only the chats the
/// caller may name (and, with `folder`, only that worktree's), each with its
/// title, agent and folder from `threads`, and every snippet redacted.
fn search_view(
    found: &Value,
    threads: &std::collections::HashMap<String, Value>,
    admits: impl Fn(Option<&str>) -> bool,
    folder: Option<&str>,
) -> Value {
    let hits: Vec<Value> = found
        .get("hits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|hit| {
            let id = hit.get("threadId").and_then(Value::as_str)?;
            let thread = threads.get(id)?;
            let cwd = thread.get("cwd").and_then(Value::as_str);
            if !admits(cwd) {
                return None;
            }
            if let Some(f) = folder {
                if !cwd.is_some_and(|c| path_key(c) == path_key(f)) {
                    return None;
                }
            }
            let matches: Vec<Value> = hit
                .get("matches")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|m| {
                    json!({
                        "turnId": m.get("turnId").cloned().unwrap_or(Value::Null),
                        "role": m.get("role").cloned().unwrap_or(Value::Null),
                        "snippet": redact(m.get("snippet").and_then(Value::as_str).unwrap_or("")),
                    })
                })
                .collect();
            Some(json!({
                "chat": id,
                "title": thread.get("title").cloned().unwrap_or(Value::Null),
                "agent": thread.get("agentId").cloned().unwrap_or(Value::Null),
                "folder": cwd,
                "archived": thread.get("status").and_then(Value::as_str) == Some("archived"),
                "titleMatch": hit.get("titleMatch").and_then(Value::as_bool).unwrap_or(false),
                "matchCount": hit.get("matchCount").cloned().unwrap_or(json!(0)),
                "matches": matches,
            }))
        })
        .collect();
    json!({
        "hits": hits,
        "nextCursor": found.get("nextCursor").cloned().unwrap_or(Value::Null),
        "searched": found.get("searched").cloned().unwrap_or(json!(0)),
        "total": found.get("total").cloned().unwrap_or(json!(0)),
    })
}

/// `chat/search`: the chats whose title or words match `query` — what the
/// person and the agents said, searched by the bridge, which holds every
/// conversation's history. `worktree` narrows it to one worktree's chats.
pub async fn search<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let resolver = Resolver::new(app, caller);
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let mut ask = json!({ "query": query });
    let folder = match params.get("worktree").and_then(Value::as_str) {
        Some(sel) => {
            let path = resolver.worktree(sel).await?.1.path;
            // The bridge searches only that folder's project.
            let project = call(app, "project/resolve", json!({ "cwd": path })).await?;
            if let Some(id) = project.get("id").and_then(Value::as_str) {
                ask["projectId"] = json!(id);
            }
            Some(path)
        }
        None => None,
    };
    if params.get("archived").and_then(Value::as_bool) == Some(true) {
        ask["includeArchived"] = json!(true);
    }
    for key in ["limit", "cursor"] {
        if let Some(v) = params.get(key).filter(|v| !v.is_null()) {
            ask[key] = match key {
                "cursor" => json!(v.as_str().unwrap_or_default()),
                _ => v.clone(),
            };
        }
    }
    let found = call(app, "thread/search", ask).await?;
    let list = call(app, "thread/list", json!({})).await?;
    let threads: std::collections::HashMap<String, Value> = list
        .get("threads")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| Some((t.get("id")?.as_str()?.to_string(), t.clone())))
        .collect();
    let scope = resolver.scope().await;
    Ok(search_view(
        &found,
        &threads,
        |cwd| scope.admits_folder(cwd),
        folder.as_deref(),
    ))
}

/// The text of a message's `content` (a string, or text blocks).
fn text_of(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// One step of an answer in a line: `ran npm test (exit 1)`, `edited src/a.ts +3 −1`.
/// A thought (the agent's reasoning, a step of its own) is not listed: what
/// `chat/read` reports is what the agent did and said.
fn step_line(block: &Value) -> Option<String> {
    let str_of = |k: &str| block.get(k).and_then(Value::as_str).unwrap_or("");
    let running = str_of("status") == "running"
        || block.pointer("/state/status").and_then(Value::as_str) == Some("running");
    let suffix = if running { " (running)" } else { "" };
    let line = match str_of("type") {
        "command_execution" => {
            let failed = str_of("status") == "error"
                || block
                    .get("exitCode")
                    .and_then(Value::as_i64)
                    .is_some_and(|c| c != 0);
            format!(
                "ran {}{}",
                str_of("command"),
                if failed { " (failed)" } else { "" }
            )
        }
        "diff" => format!(
            "edited {} +{} −{}",
            str_of("filename"),
            block.get("additions").and_then(Value::as_i64).unwrap_or(0),
            block.get("deletions").and_then(Value::as_i64).unwrap_or(0)
        ),
        "tool" => {
            let what = match str_of("kind") {
                "read" => "read",
                "search" => "searched",
                "list" => "listed",
                "fetch" => "fetched",
                "web_search" => "searched the web for",
                _ => str_of("toolName"),
            };
            format!("{what} {}", str_of("target")).trim().to_string()
        }
        "subagent" => format!(
            "subagent: {} ({})",
            block
                .pointer("/state/name")
                .and_then(Value::as_str)
                .unwrap_or(""),
            block
                .pointer("/state/status")
                .and_then(Value::as_str)
                .unwrap_or("")
        ),
        "approval" => format!(
            "asked to approve: {}",
            block
                .pointer("/request/action")
                .or_else(|| block.get("action"))
                .and_then(Value::as_str)
                .unwrap_or("")
        ),
        "question" => "asked a question".to_string(),
        "view" => format!("showed the view {}", str_of("title")),
        _ => return None,
    };
    Some(format!("{line}{suffix}"))
}

/// The assistant message of a turn, when it has one.
fn assistant_of(turn: &Value) -> Option<&Value> {
    turn.get("messages")
        .and_then(Value::as_array)?
        .iter()
        .find(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
}

/// The ordered parts of an answer (`segments`, as a page serves them).
fn segments_of(assistant: Option<&Value>) -> &[Value] {
    assistant
        .and_then(|m| m.get("segments"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// A page's summary of a run of steps (`type: "work"`,
/// shared/src/models/history.ts): its stored index range and its size.
fn work_run(segment: &Value) -> Option<(u64, u64, usize)> {
    if segment.get("type").and_then(Value::as_str) != Some("work") {
        return None;
    }
    let from = segment.get("from").and_then(Value::as_u64)?;
    let to = segment.get("to").and_then(Value::as_u64)?;
    (to >= from).then(|| {
        (
            from,
            to,
            usize::try_from(to - from + 1).unwrap_or(usize::MAX),
        )
    })
}

/// One part of the steps `chat/read` lists for a turn, before the bridge is
/// asked for anything: a step line read off the page, or a stored range of
/// steps to read with `turn/steps`.
#[derive(Debug, PartialEq)]
enum StepPiece {
    Line(String),
    Range { from: u64, to: u64 },
}

/// Which steps of an answer `chat/read` lists: its newest [`STEPS_MAX`], in
/// order — a page folds each run of steps into one summary, so the newest
/// part of a run becomes a range to read — and how many earlier ones it
/// leaves out.
fn plan_steps(segments: &[Value], max: usize) -> (Vec<StepPiece>, usize) {
    let mut left = max;
    let mut skipped = 0;
    let mut pieces = Vec::new();
    for segment in segments.iter().rev() {
        if let Some((_, to, size)) = work_run(segment) {
            let take = size.min(left);
            left -= take;
            skipped += size - take;
            if take > 0 {
                pieces.push(StepPiece::Range {
                    from: to + 1 - take as u64,
                    to,
                });
            }
        } else if let Some(line) = step_line(segment) {
            if left == 0 {
                skipped += 1;
            } else {
                left -= 1;
                pieces.push(StepPiece::Line(line));
            }
        }
    }
    pieces.reverse();
    (pieces, skipped)
}

/// What a run of steps amounts to, when its steps could not be read:
/// `ran 12 commands, 3 edits, 1 tool call (1 failed)`.
fn run_line(segment: &Value) -> String {
    let count = |k: &str| segment.get(k).and_then(Value::as_u64).unwrap_or(0);
    let plural = |n: u64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    let mut parts = Vec::new();
    for (key, one, many) in [
        ("commands", "command", "commands"),
        ("edits", "edit", "edits"),
        ("tools", "tool call", "tool calls"),
    ] {
        if count(key) > 0 {
            parts.push(plural(count(key), one, many));
        }
    }
    let failed = count("failed");
    format!(
        "ran {}{}",
        parts.join(", "),
        if failed > 0 {
            format!(" ({failed} failed)")
        } else {
            String::new()
        }
    )
}

/// The step lines of a turn's answer: its newest [`STEPS_MAX`] steps, the
/// ones a page summarized read with `turn/steps` (previews: a command is its
/// first 400 characters), after a `… N earlier steps` line when there were
/// more. A range the bridge cannot serve reads as its run's counts.
async fn step_lines<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread: &str,
    turn: &Value,
) -> Vec<String> {
    let segments = segments_of(assistant_of(turn));
    let (pieces, skipped) = plan_steps(segments, STEPS_MAX);
    let turn_id = turn.get("id").and_then(Value::as_str).unwrap_or("");
    let mut lines = Vec::new();
    if skipped > 0 {
        lines.push(format!(
            "… {skipped} earlier step{}",
            if skipped == 1 { "" } else { "s" }
        ));
    }
    for piece in pieces {
        match piece {
            StepPiece::Line(line) => lines.push(line),
            StepPiece::Range { from, to } => match read_range(app, thread, turn_id, from, to).await
            {
                Ok(steps) => lines.extend(steps.iter().filter_map(step_line)),
                Err(_) => {
                    let run = segments
                        .iter()
                        .find(|s| work_run(s).is_some_and(|(f, t, _)| f <= from && to <= t));
                    if let Some(run) = run {
                        lines.push(run_line(run));
                    }
                }
            },
        }
    }
    lines.iter().map(|l| redact(l)).collect()
}

/// The step previews stored at `from..=to` of a turn's answer, following
/// `turn/steps`' `next` until the range is read.
async fn read_range<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread: &str,
    turn: &str,
    from: u64,
    to: u64,
) -> Result<Vec<Value>, RpcError> {
    let mut steps = Vec::new();
    let mut at = from;
    loop {
        let page = call(
            app,
            "turn/steps",
            json!({ "threadId": thread, "turnId": turn, "from": at, "to": to }),
        )
        .await?;
        steps.extend(
            page.get("steps")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned(),
        );
        match page.get("next").and_then(Value::as_u64) {
            Some(next) if next > at && next <= to => at = next,
            _ => return Ok(steps),
        }
    }
}

/// A turn as `chat/read` shows it: what was asked, what the agent answered,
/// the steps it took ([`step_lines`]) and why it failed, if it did — secrets
/// redacted. An answer longer than [`ANSWER_MAX`] keeps its end, unless
/// `answer_from` asks for the part that starts at that byte; `answerLength`
/// lets a caller page through the whole of it.
fn turn_view(turn: &Value, answer_from: Option<usize>, steps: Vec<String>) -> Value {
    let messages = turn.get("messages").and_then(Value::as_array);
    let by_role = |role: &str| {
        messages
            .into_iter()
            .flatten()
            .find(|m| m.get("role").and_then(Value::as_str) == Some(role))
    };
    let prompt = by_role("user").map(text_of).unwrap_or_default();
    let assistant = by_role("assistant");
    let full = assistant.map(text_of).unwrap_or_default();
    let length = full.len();
    let (answer, from) = answer_window(&full, answer_from);
    let errors: Vec<String> = segments_of(assistant)
        .iter()
        .filter(|b| {
            b.get("type").and_then(Value::as_str) == Some("system")
                && b.get("kind").and_then(Value::as_str) == Some("error")
        })
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .map(redact)
        .collect();
    let mut view = json!({
        "id": turn.get("id").cloned().unwrap_or(Value::Null),
        "status": turn.get("status").cloned().unwrap_or(Value::Null),
        "prompt": redact(&prompt),
        "answer": redact(&answer),
        "answerFrom": from,
        "answerLength": length,
        "steps": steps,
    });
    if !errors.is_empty() {
        view["error"] = Value::String(errors.join("\n"));
    }
    view
}

/// The part of an answer `chat/read` returns, and the byte it starts at: at
/// most [`ANSWER_MAX`] bytes from `from` (snapped to a character boundary),
/// or its end when no `from` is given. A cut side is marked with `…`.
fn answer_window(full: &str, from: Option<usize>) -> (String, usize) {
    let len = full.len();
    let mut start = match from {
        Some(f) => f.min(len),
        None => len.saturating_sub(ANSWER_MAX),
    };
    while !full.is_char_boundary(start) {
        start += 1;
    }
    let mut end = (start + ANSWER_MAX).min(len);
    while !full.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = String::new();
    if start > 0 {
        out.push_str("… ");
    }
    out.push_str(&full[start..end]);
    if end < len {
        out.push_str(" …");
    }
    (out, start)
}

/// Where a chat is: `working` while a turn runs, `waiting` when that turn
/// stopped on an approval or a question (its last step asks), else `idle`.
fn chat_state(active: bool, last_turn: Option<&Value>) -> &'static str {
    if !active {
        return "idle";
    }
    let last_step = last_turn
        .and_then(|t| segments_of(assistant_of(t)).last())
        .and_then(|b| b.get("type"))
        .and_then(Value::as_str);
    match last_step {
        Some("approval") | Some("question") => "waiting",
        _ => "working",
    }
}

/// The newest `n` turns of a chat and whether one runs.
async fn recent<R: tauri::Runtime>(
    app: &AppHandle<R>,
    id: &str,
    n: u64,
) -> Result<(Vec<Value>, bool), RpcError> {
    let list = call(
        app,
        "turn/list",
        json!({ "threadId": id, "limit": n, "fromEnd": true }),
    )
    .await?;
    let turns = list
        .get("turns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let active = list.get("activeTurnId").and_then(Value::as_str).is_some();
    Ok((turns, active))
}

/// `chat/read`: what a chat has said — its newest turns (1 by default, at
/// most 20), each with the prompt, the answer and the steps taken, and where
/// the chat is now. Secrets are redacted as in `terminal/read`.
pub async fn read<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = thread_id(params)?;
    admitted(app, caller, &id).await?;
    let n = params
        .get("turns")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, READ_TURNS_MAX);
    let answer_from = params
        .get("answerFrom")
        .and_then(Value::as_u64)
        .map(|f| usize::try_from(f).unwrap_or(usize::MAX));
    let (turns, active) = recent(app, &id, n).await?;
    let mut views = Vec::with_capacity(turns.len());
    for turn in &turns {
        let steps = step_lines(app, &id, turn).await;
        views.push(turn_view(turn, answer_from, steps));
    }
    Ok(json!({
        "chat": id,
        "state": chat_state(active, turns.last()),
        "turns": views,
    }))
}

/// `chat/wait`: wait until a chat is `idle` (its turn finished — the state to
/// wait for after `chat/send`) or `waiting` (it stopped on an approval or a
/// question). One call waits at most 15 seconds; call again to keep waiting.
pub async fn wait<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = thread_id(params)?;
    let want = match params.get("for").and_then(Value::as_str).unwrap_or("idle") {
        "idle" => "idle",
        "waiting" => "waiting",
        other => {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("`for` must be `idle` or `waiting`, not `{other}`"),
            ))
        }
    };
    admitted(app, caller, &id).await?;
    let budget = params
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .map(Duration::from_millis)
        .unwrap_or(WAIT_MAX)
        .min(WAIT_MAX);
    let started = std::time::Instant::now();
    loop {
        let (turns, active) = recent(app, &id, 1).await?;
        let state = chat_state(active, turns.last());
        // Waiting for `waiting` also ends when the turn is over: nothing will ask.
        if state == want || (want == "waiting" && state == "idle") {
            return Ok(json!({
                "chat": id,
                "reached": state,
                "waitedMs": started.elapsed().as_millis() as u64,
            }));
        }
        if started.elapsed() >= budget {
            return Err(RpcError::new(
                ErrorCode::Timeout,
                format!(
                    "chat id:{id} did not reach `{want}` within {} ms (it is `{state}`); call again to keep waiting",
                    budget.as_millis()
                ),
            )
            .with_data(json!({ "current": state, "waitedMs": started.elapsed().as_millis() as u64 })));
        }
        tokio::time::sleep(WAIT_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chat_is_named_by_its_id_with_or_without_the_prefix() {
        assert_eq!(thread_id(&json!({ "chat": "id:th-1" })).unwrap(), "th-1");
        assert_eq!(thread_id(&json!({ "chat": "th-2" })).unwrap(), "th-2");
        assert_eq!(
            thread_id(&json!({ "chat": "id:" })).unwrap_err().code,
            ErrorCode::InvalidParams
        );
        assert_eq!(
            thread_id(&json!({})).unwrap_err().code,
            ErrorCode::InvalidParams
        );
    }

    #[test]
    fn a_chat_is_working_only_while_the_bridge_says_a_turn_runs() {
        let running = view(&json!({
            "id": "th-1", "title": "Fix it", "agentId": "claude-code", "model": "opus",
            "cwd": "/repo", "status": "active", "updatedAt": 5, "activeTurnId": "t-9"
        }));
        assert_eq!(running["state"], "working");
        assert_eq!(running["folder"], "/repo");
        assert_eq!(running["agent"], "claude-code");
        assert_eq!(running["archived"], false);
        let idle =
            view(&json!({ "id": "th-2", "title": "Old", "status": "archived", "updatedAt": 1 }));
        assert_eq!(idle["state"], "idle");
        assert_eq!(idle["archived"], true);
        assert_eq!(idle["model"], Value::Null);
    }

    #[test]
    fn an_agent_is_named_the_way_people_name_it() {
        assert_eq!(bridge_agent("claude").unwrap(), "claude-code");
        assert_eq!(bridge_agent("Claude-Code").unwrap(), "claude-code");
        assert_eq!(bridge_agent("pi").unwrap(), "pi-agent");
        assert_eq!(bridge_agent("agy").unwrap(), "antigravity-cli");
        assert_eq!(bridge_agent("grok").unwrap(), "grok");
        assert_eq!(
            bridge_agent("gemini").unwrap_err().code,
            ErrorCode::InvalidParams
        );
        assert_eq!(
            bridge_agent(" ").unwrap_err().code,
            ErrorCode::InvalidParams
        );
    }

    /// The pieces' lines, for a plan with no range to read.
    fn lines(pieces: &[StepPiece]) -> Vec<&str> {
        pieces
            .iter()
            .map(|p| match p {
                StepPiece::Line(l) => l.as_str(),
                StepPiece::Range { .. } => "<range>",
            })
            .collect()
    }

    #[test]
    fn a_turn_reads_as_its_prompt_answer_and_steps_with_secrets_redacted() {
        // A live turn: its steps arrive as previews, in its segments.
        let turn = json!({
            "id": "t1", "status": "completed",
            "messages": [
                { "role": "user", "content": "run the tests" },
                { "role": "assistant", "content": "All green. token=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
                  "segments": [
                    { "type": "thinking", "text": "Run the tests first." },
                    { "type": "command_execution", "index": 1, "command": "npm test", "exitCode": 1 },
                    { "type": "diff", "index": 1, "filename": "src/a.ts", "additions": 3, "deletions": 1 },
                    { "type": "tool", "index": 2, "toolName": "view_file", "kind": "read", "target": "notes.txt" },
                    { "type": "tool", "index": 3, "toolName": "Grep", "kind": "search", "target": "alpha", "status": "running" },
                    { "type": "subagent", "state": { "name": "Audit", "status": "completed" } },
                    { "type": "text", "text": "All green." },
                    { "type": "assistant_response_boundary" }
                  ] }
            ]
        });
        let (pieces, skipped) = plan_steps(segments_of(assistant_of(&turn)), STEPS_MAX);
        assert_eq!(skipped, 0);
        assert_eq!(
            lines(&pieces),
            [
                "ran npm test (failed)",
                "edited src/a.ts +3 −1",
                "read notes.txt",
                "searched alpha (running)",
                "subagent: Audit (completed)"
            ]
        );
        let v = turn_view(&turn, None, vec!["ran npm test (failed)".into()]);
        assert_eq!(v["prompt"], "run the tests");
        assert!(!v["answer"]
            .as_str()
            .unwrap()
            .contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert_eq!(v["steps"], json!(["ran npm test (failed)"]));
        let long = json!({ "messages": [{ "role": "assistant", "content": "x".repeat(ANSWER_MAX + 10) }] });
        let end = turn_view(&long, None, Vec::new());
        assert!(end["answer"].as_str().unwrap().starts_with("… "));
        assert_eq!(end["answerFrom"], 10);
        assert_eq!(end["answerLength"], ANSWER_MAX + 10);
        let head = turn_view(&long, Some(0), Vec::new());
        assert!(head["answer"].as_str().unwrap().ends_with(" …"));
        assert_eq!(head["answerFrom"], 0);
    }

    #[test]
    fn a_summarized_run_is_read_for_its_newest_steps_and_the_rest_counted() {
        // A page: a step before a run of 150 (indexes 1..=150), then an
        // approval. The newest 100 steps: the approval and the run's last 99.
        let segments = vec![
            json!({ "type": "command_execution", "index": 0, "command": "ls" }),
            json!({ "type": "work", "from": 1, "to": 150, "commands": 150, "edits": 0, "tools": 0,
                    "failed": 0, "running": 0, "files": [], "last": { "type": "command_execution", "index": 150, "command": "make" } }),
            json!({ "type": "text", "text": "Need to install." }),
            json!({ "type": "approval", "approvalId": "a", "action": "Bash: npm i" }),
        ];
        let (pieces, skipped) = plan_steps(&segments, STEPS_MAX);
        assert_eq!(
            pieces,
            vec![
                StepPiece::Range { from: 52, to: 150 },
                StepPiece::Line("asked to approve: Bash: npm i".into()),
            ]
        );
        // The first step and the run's first 51.
        assert_eq!(skipped, 52);
        // Room for everything: the whole run, and the step before it.
        let (all, none) = plan_steps(&segments, 1000);
        assert_eq!(none, 0);
        assert_eq!(all[1], StepPiece::Range { from: 1, to: 150 });
        assert_eq!(lines(&all)[0], "ran ls");
    }

    #[test]
    fn a_run_the_bridge_cannot_serve_reads_as_its_counts() {
        let run = json!({ "type": "work", "from": 0, "to": 15, "commands": 12, "edits": 3, "tools": 1, "failed": 1 });
        assert_eq!(
            run_line(&run),
            "ran 12 commands, 3 edits, 1 tool call (1 failed)"
        );
        assert_eq!(work_run(&run), Some((0, 15, 16)));
        assert_eq!(
            work_run(&json!({ "type": "work", "from": 3, "to": 1 })),
            None
        );
        assert_eq!(work_run(&json!({ "type": "text" })), None);
    }

    #[test]
    fn a_long_answer_pages_on_character_boundaries() {
        let full = format!("{}é{}", "a".repeat(ANSWER_MAX - 1), "b".repeat(20));
        let (head, from) = answer_window(&full, Some(0));
        assert_eq!(from, 0);
        assert_eq!(head.len(), ANSWER_MAX - 1 + " …".len());
        let (rest, from) = answer_window(&full, Some(ANSWER_MAX));
        assert_eq!(from, ANSWER_MAX + 1);
        assert_eq!(rest, format!("… {}", "b".repeat(20)));
        let (short, from) = answer_window("hello", None);
        assert_eq!((short.as_str(), from), ("hello", 0));
        assert_eq!(answer_window("hello", Some(99)), ("… ".to_string(), 5));
    }

    #[test]
    fn a_failed_turn_says_why_and_a_view_is_a_step() {
        let failed = json!({ "messages": [{ "role": "assistant", "content": "",
            "segments": [
                { "type": "system", "kind": "error", "text": "failed to start codex app-server" },
                { "type": "system", "kind": "warning", "text": "slow" },
                { "type": "view", "viewId": "0123456789abcdef0123456789abcdef", "title": "Usage" }
            ] }] });
        let v = turn_view(&failed, None, Vec::new());
        assert_eq!(v["error"], "failed to start codex app-server");
        let (pieces, _) = plan_steps(segments_of(assistant_of(&failed)), STEPS_MAX);
        assert_eq!(lines(&pieces), ["showed the view Usage"]);
        let fine = json!({ "messages": [{ "role": "assistant", "content": "ok" }] });
        assert!(turn_view(&fine, None, Vec::new()).get("error").is_none());
    }

    #[test]
    fn a_chat_waits_when_its_running_turn_last_asked_something() {
        let asking = json!({ "messages": [{ "role": "assistant",
            "segments": [{ "type": "text", "text": "Need approval" }, { "type": "approval", "approvalId": "a" }] }] });
        assert_eq!(chat_state(true, Some(&asking)), "waiting");
        let working = json!({ "messages": [{ "role": "assistant",
            "segments": [{ "type": "command_execution", "command": "ls", "status": "running" }] }] });
        assert_eq!(chat_state(true, Some(&working)), "working");
        // A page folds the running steps into a run: still working.
        let folded = json!({ "messages": [{ "role": "assistant",
            "segments": [{ "type": "work", "from": 0, "to": 4, "running": 1 }] }] });
        assert_eq!(chat_state(true, Some(&folded)), "working");
        assert_eq!(chat_state(false, Some(&asking)), "idle");
        assert_eq!(chat_state(true, None), "working");
    }

    #[test]
    fn a_strategy_is_one_of_three_and_absent_is_the_bridges_default() {
        assert_eq!(strategy_of(&json!({})).unwrap(), None);
        assert_eq!(strategy_of(&json!({ "strategy": " " })).unwrap(), None);
        for s in ["selection", "reference", "fork"] {
            assert_eq!(strategy_of(&json!({ "strategy": s })).unwrap(), Some(s));
        }
        let err = strategy_of(&json!({ "strategy": "summary" })).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams);
    }

    /// The caller's key becomes the bridge's `clientTransferId` when it fits,
    /// so a retry finds the continuation already made even after a restart.
    #[test]
    fn continue_from_carries_the_source_strategy_and_key() {
        let from = continue_from(
            "th-1",
            &json!({ "strategy": "reference", "idempotencyKey": " k1 " }),
        )
        .unwrap();
        assert_eq!(
            from,
            json!({ "threadId": "th-1", "createdBy": "agent", "strategy": "reference", "clientTransferId": "k1" })
        );
        let long = "k".repeat(TRANSFER_KEY_MAX + 1);
        let from = continue_from("th-1", &json!({ "idempotencyKey": long })).unwrap();
        assert!(from.get("clientTransferId").is_none());
        assert!(from.get("strategy").is_none());
    }

    /// The receipt reads the bridge's `Thread` as `shared/` shapes it
    /// (`Thread.transfer: ConversationTransfer`).
    #[test]
    fn a_continuation_reports_what_it_carries_and_its_real_status() {
        let thread = json!({
            "id": "th-2", "projectId": "p", "title": "T", "status": "active",
            "turnCount": 0, "createdAt": 1, "updatedAt": 1,
            "agentId": "codex", "cwd": "/w/app",
            "transfer": {
                "id": "tr-1", "strategy": "selection", "sourceThreadId": "th-1",
                "sourceTitle": "T", "sourceAgentId": "claude-code", "createdBy": "agent",
                "status": "sent", "turnId": "tu-1",
                "context": { "turns": 3, "omittedTurns": 0, "bytes": 4000, "approxTokens": 1000 }
            }
        });
        let v = continuation_view(&thread, "th-1", json!("tu-1"), true);
        assert_eq!(
            v,
            json!({
                "chat": "th-2", "agent": "codex", "folder": "/w/app", "sourceChat": "th-1",
                "strategy": "selection", "status": "sent", "contextTokens": 1000,
                "turns": 0, "turnId": "tu-1", "opened": true
            })
        );
        assert_eq!(new_id(&thread).unwrap(), "th-2");
        assert_eq!(new_id(&json!({})).unwrap_err().code, ErrorCode::Internal);
    }

    /// Hits outside the caller's scope (or the worktree asked for) are dropped,
    /// and a snippet is redacted like everything else read through the surface.
    #[test]
    fn a_search_answers_only_the_chats_in_scope_with_redacted_snippets() {
        let found = json!({
            "hits": [
                { "threadId": "a", "titleMatch": false, "matchCount": 2, "matches": [
                    { "turnId": "t1", "seq": 1, "role": "user",
                      "snippet": "use token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 here",
                      "matchStart": 4, "matchLength": 5 }
                ] },
                { "threadId": "b", "titleMatch": true, "matchCount": 0, "matches": [] },
                { "threadId": "gone", "titleMatch": true, "matchCount": 0, "matches": [] }
            ],
            "nextCursor": "7", "searched": 7, "total": 9
        });
        let threads: std::collections::HashMap<String, Value> = [
            ("a".to_string(), json!({ "id": "a", "title": "Deploy", "agentId": "codex", "cwd": "/w/app", "status": "active" })),
            ("b".to_string(), json!({ "id": "b", "title": "Other", "agentId": "zero", "cwd": "/w/secret", "status": "archived" })),
        ]
        .into_iter()
        .collect();
        let v = search_view(&found, &threads, |cwd| cwd == Some("/w/app"), None);
        assert_eq!(v["hits"].as_array().unwrap().len(), 1);
        let hit = &v["hits"][0];
        assert_eq!(hit["chat"], "a");
        assert_eq!(hit["title"], "Deploy");
        assert_eq!(hit["matchCount"], 2);
        assert_eq!(hit["matches"][0]["role"], "user");
        assert!(!hit["matches"][0]["snippet"]
            .as_str()
            .unwrap()
            .contains("ghp_abc"));
        assert_eq!(v["nextCursor"], "7");
        assert_eq!(v["total"], 9);
        let all = search_view(&found, &threads, |_| true, Some("/w/secret"));
        assert_eq!(all["hits"][0]["chat"], "b");
        assert_eq!(all["hits"][0]["archived"], true);
        assert_eq!(all["hits"].as_array().unwrap().len(), 1);
        let done = search_view(
            &json!({ "hits": [], "searched": 0, "total": 0 }),
            &threads,
            |_| true,
            None,
        );
        assert_eq!(done["nextCursor"], Value::Null);
    }
}
