//! Chats: the conversations the Uxnan bridge drives (the chat tabs, and the
//! ones started on the phone), reached through the app's bridge client — the
//! same connection the window uses. Scoped like everything else: a caller sees
//! and drives only the conversations whose folder is in its scope.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::bridgeclient::BridgeCallError;
use crate::control::bridge::Bridge;
use crate::control::resolve::{path_key, Resolver};
use crate::control::Caller;
use crate::state::AppState;

/// A `turn/send` returns once the agent was started; `thread/list` is quick.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// The most a message may weigh (the same bound as `agent/send`).
const MESSAGE_MAX: usize = 64 * 1024;

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
            other => RpcError::new(ErrorCode::Internal, other.to_string()),
        })
}

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
}
