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
        }),
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
        _ => return None,
    };
    Some(format!("{line}{suffix}"))
}

/// A turn as `chat/read` shows it: what was asked, what the agent answered,
/// the steps it took — secrets redacted, a long answer cut to its end.
fn turn_view(turn: &Value) -> Value {
    let messages = turn.get("messages").and_then(Value::as_array);
    let by_role = |role: &str| {
        messages
            .into_iter()
            .flatten()
            .find(|m| m.get("role").and_then(Value::as_str) == Some(role))
    };
    let prompt = by_role("user").map(text_of).unwrap_or_default();
    let assistant = by_role("assistant");
    let mut answer = assistant.map(text_of).unwrap_or_default();
    if answer.len() > ANSWER_MAX {
        let mut cut = answer.len() - ANSWER_MAX;
        while !answer.is_char_boundary(cut) {
            cut += 1;
        }
        answer = format!("… {}", &answer[cut..]);
    }
    let steps: Vec<String> = assistant
        .and_then(|m| m.get("blocks"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(step_line)
        .map(|l| redact(&l))
        .collect();
    json!({
        "id": turn.get("id").cloned().unwrap_or(Value::Null),
        "status": turn.get("status").cloned().unwrap_or(Value::Null),
        "prompt": redact(&prompt),
        "answer": redact(&answer),
        "steps": steps,
    })
}

/// Where a chat is: `working` while a turn runs, `waiting` when that turn
/// stopped on an approval or a question (its last step asks), else `idle`.
fn chat_state(active: bool, last_turn: Option<&Value>) -> &'static str {
    if !active {
        return "idle";
    }
    let last_step = last_turn
        .and_then(|t| t.get("messages"))
        .and_then(Value::as_array)
        .and_then(|m| {
            m.iter()
                .find(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
        })
        .and_then(|a| a.get("segments").or_else(|| a.get("blocks")))
        .and_then(Value::as_array)
        .and_then(|s| s.last())
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
    let (turns, active) = recent(app, &id, n).await?;
    Ok(json!({
        "chat": id,
        "state": chat_state(active, turns.last()),
        "turns": turns.iter().map(turn_view).collect::<Vec<_>>(),
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

    #[test]
    fn a_turn_reads_as_its_prompt_answer_and_steps_with_secrets_redacted() {
        let turn = json!({
            "id": "t1", "status": "completed",
            "messages": [
                { "role": "user", "content": "run the tests" },
                { "role": "assistant", "content": "All green. token=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
                  "blocks": [
                    { "type": "command_execution", "command": "npm test", "exitCode": 1 },
                    { "type": "diff", "filename": "src/a.ts", "additions": 3, "deletions": 1 },
                    { "type": "tool", "toolName": "view_file", "kind": "read", "target": "notes.txt" },
                    { "type": "tool", "toolName": "Grep", "kind": "search", "target": "alpha", "status": "running" },
                    { "type": "subagent", "state": { "name": "Audit", "status": "completed" } },
                    { "type": "assistant_response_boundary" }
                  ] }
            ]
        });
        let v = turn_view(&turn);
        assert_eq!(v["prompt"], "run the tests");
        assert!(!v["answer"]
            .as_str()
            .unwrap()
            .contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert_eq!(
            v["steps"],
            json!([
                "ran npm test (failed)",
                "edited src/a.ts +3 −1",
                "read notes.txt",
                "searched alpha (running)",
                "subagent: Audit (completed)"
            ])
        );
        let long = json!({ "messages": [{ "role": "assistant", "content": "x".repeat(ANSWER_MAX + 10) }] });
        assert!(turn_view(&long)["answer"]
            .as_str()
            .unwrap()
            .starts_with("… "));
    }

    #[test]
    fn a_chat_waits_when_its_running_turn_last_asked_something() {
        let asking = json!({ "messages": [{ "role": "assistant",
            "segments": [{ "type": "text", "text": "Need approval" }, { "type": "approval", "approvalId": "a" }] }] });
        assert_eq!(chat_state(true, Some(&asking)), "waiting");
        let working = json!({ "messages": [{ "role": "assistant",
            "segments": [{ "type": "command_execution", "command": "ls", "status": "running" }] }] });
        assert_eq!(chat_state(true, Some(&working)), "working");
        assert_eq!(chat_state(false, Some(&asking)), "idle");
        assert_eq!(chat_state(true, None), "working");
    }
}
