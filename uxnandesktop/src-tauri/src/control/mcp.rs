//! The MCP transport of the catalog — how an agent the app launched discovers
//! and calls the control surface with nothing to install (spec `02d` §1.6).
//!
//! The ADE points each agent it launches at this endpoint (`mcpinject.rs`), so
//! the agent lists the tools with their descriptions like any native capability
//! and drives the browser, reads the app's state or reports to a run without
//! reading a doc first. The tool list **is** the catalog: a tool's name is the
//! entry's `tool`, its description the entry's `summary`, its input schema the
//! entry's `params`; a call is dispatched by the entry's RPC method. Nothing is
//! defined here twice.
//!
//! ## Transport
//! A minimal, spec-correct **Streamable HTTP** MCP endpoint at `/mcp` on the
//! app's local server. The surface is small and synchronous, so the JSON-RPC
//! handshake (`initialize` → `tools/list` → `tools/call`) is implemented
//! directly and answered with `application/json`; no SSE / streaming. This
//! avoids a heavyweight MCP SDK whose macro API churns between releases.
//!
//! A failed tool call is reported **in-band** (`isError: true` with the reason
//! as text), the way MCP wants tool failures surfaced, so the agent reads why.

use axum::{
    body::Bytes,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::catalog;

use super::Caller;

/// The MCP protocol revision we default to when a client doesn't pin one. We
/// echo the client's requested version when it sends one (forward-compatible).
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

/// The server's name as agents see it. Kept from the browser-only days so the
/// per-launch configs `mcpinject.rs` writes keep working unchanged.
pub const SERVER_NAME: &str = "uxnan-browser";

/// What the agent is told at `initialize`: the one paragraph that makes the
/// tools make sense together.
const INSTRUCTIONS: &str = "You are running inside Uxnan Desktop, which offers you tools to read and operate it. Call `uxnan_status` first to learn what is enabled. Use `worktree_*`, `terminal_*` and `agent_*` to see the projects, terminals and agents Uxnan holds (`current` names your own terminal and worktree); `file_open` / `file_diff` to show the person a file or a change; `browser_*` to preview and test web apps and dev servers you build (call `browser_status` first, `browser_reload` after code changes). If you are a step of a Uxnan orchestration run, report your final output with `orchestration_report_result` (agentId = your UXNAN_AGENT_ID) so the run captures it for the next step.";

/// The tool list advertised on `tools/list`: the catalog, in MCP's shape.
pub fn tool_catalog() -> Value {
    Value::Array(
        catalog::catalog()
            .into_iter()
            .map(|e| {
                json!({
                    "name": e.tool,
                    "description": e.summary,
                    "inputSchema": e.params,
                })
            })
            .collect(),
    )
}

fn ok_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Wrap a tool result in the MCP `content` shape.
fn text_result(text: String, is_error: bool) -> Value {
    json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": is_error
    })
}

/// Run one `tools/call` through the dispatcher.
async fn call_tool<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    name: &str,
    args: &Value,
) -> Value {
    let Some(entry) = catalog::by_tool(name) else {
        return text_result(format!("unknown tool: {name}"), true);
    };
    match super::dispatch(app, caller, entry.method, args).await {
        Ok(result) => {
            let text = serde_json::to_string(&result).unwrap_or_else(|_| "{}".into());
            text_result(text, false)
        }
        Err(e) => text_result(e.message, true),
    }
}

/// Handle one JSON-RPC message. Returns `Some(response)` for a request (something
/// with an `id`) and `None` for a notification (no `id` → no reply, per spec).
async fn handle_message<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    msg: &Value,
) -> Option<Value> {
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    // Notifications (e.g. `notifications/initialized`) carry no id and get no reply.
    let id = msg.get("id").cloned()?;

    let result = match method {
        "initialize" => {
            let protocol = msg
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_PROTOCOL_VERSION)
                .to_string();
            ok_response(
                id,
                json!({
                    "protocolVersion": protocol,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": env!("CARGO_PKG_VERSION"),
                        "title": "Uxnan Desktop"
                    },
                    "instructions": INSTRUCTIONS
                }),
            )
        }
        "ping" => ok_response(id, json!({})),
        "tools/list" => ok_response(id, json!({ "tools": tool_catalog() })),
        "tools/call" => {
            let params = msg.get("params");
            let name = params
                .and_then(|p| p.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if name.is_empty() {
                err_response(id, -32602, "missing tool name")
            } else {
                let empty = json!({});
                let args = params.and_then(|p| p.get("arguments")).unwrap_or(&empty);
                ok_response(id, call_tool(app, caller, name, args).await)
            }
        }
        "" => err_response(id, -32600, "invalid request: no method"),
        other => err_response(id, -32601, &format!("method not found: {other}")),
    };
    Some(result)
}

/// Handle one authorized `POST /mcp`: parse the JSON-RPC body (single message
/// or a batch array), dispatch each, and reply. A body with only notifications
/// gets a `202 Accepted` with no content; anything with a request replies
/// `200` with the JSON-RPC response(s).
pub async fn handle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: Caller,
    body: Bytes,
) -> Response {
    let Ok(parsed) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(err_response(Value::Null, -32700, "parse error")),
        )
            .into_response();
    };

    if let Some(batch) = parsed.as_array() {
        let mut out = Vec::new();
        for msg in batch {
            if let Some(resp) = handle_message(app, &caller, msg).await {
                out.push(resp);
            }
        }
        if out.is_empty() {
            return StatusCode::ACCEPTED.into_response();
        }
        return json_response(Value::Array(out));
    }

    match handle_message(app, &caller, &parsed).await {
        Some(resp) => json_response(resp),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

/// A `200 OK` JSON-RPC response with the MCP-friendly content type.
fn json_response(value: Value) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        serde_json::to_string(&value).unwrap_or_else(|_| "{}".into()),
    )
        .into_response()
}

/// A `GET /mcp` with no server-initiated stream to offer: MCP allows the server
/// to decline the optional SSE channel with `405`. We only serve request/response.
pub fn handle_get() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, "sse stream not supported").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tool list is the catalog, one for one, in MCP's shape.
    #[test]
    fn the_tool_list_is_the_catalog() {
        let tools = tool_catalog();
        let tools = tools.as_array().unwrap();
        let entries = catalog::catalog();
        assert_eq!(tools.len(), entries.len());
        for (t, e) in tools.iter().zip(entries.iter()) {
            assert_eq!(t["name"], e.tool);
            assert_eq!(t["description"], e.summary);
            assert_eq!(t["inputSchema"], e.params);
        }
    }

    /// The tools agents already rely on keep their names: a renamed tool is a
    /// broken agent config.
    #[test]
    fn the_original_tools_keep_their_names() {
        let names: Vec<String> = tool_catalog()
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        for n in [
            "browser_open",
            "browser_navigate",
            "browser_reload",
            "browser_back",
            "browser_forward",
            "browser_status",
            "orchestration_report_result",
            "orchestration_report_progress",
        ] {
            assert!(names.iter().any(|x| x == n), "{n} missing");
        }
    }

    #[test]
    fn text_result_marks_errors_in_band() {
        let ok = text_result("fine".into(), false);
        assert_eq!(ok["isError"], false);
        assert_eq!(ok["content"][0]["text"], "fine");
        let err = text_result("nope".into(), true);
        assert_eq!(err["isError"], true);
    }
}
