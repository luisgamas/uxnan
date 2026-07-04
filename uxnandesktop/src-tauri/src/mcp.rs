//! Browser-control MCP server — makes the integrated developer browser
//! **discoverable** to CLI agents (spec `02d` §1.6).
//!
//! The problem this solves: an agent could already open a URL in the in-app
//! browser by POSTing to the `/browser` hook route (see `hooks.rs`), but only if
//! it *knew* that convention — it had to read the docs first. This module instead
//! exposes the browser as a set of **Model Context Protocol** tools
//! (`browser_open`, `browser_navigate`, `browser_reload`, `browser_back`,
//! `browser_forward`, `browser_status`). When the ADE injects this server into an
//! agent's MCP config (see `mcpinject.rs`), the agent discovers the tools with
//! their descriptions automatically — they show up in its tool list like any
//! native capability — so it drives the browser without any documentation.
//!
//! ## Transport
//! A minimal, spec-correct **Streamable HTTP** MCP endpoint mounted at `/mcp` on
//! the same local `axum` server as the hook routes, reusing its per-launch token
//! (accepted as `Authorization: Bearer <token>` — the header every supported CLI
//! can send — or the legacy `x-uxnan-token`). The tool surface is tiny and
//! synchronous, so we implement the JSON-RPC handshake directly (`initialize` →
//! `tools/list` → `tools/call`) and respond with `application/json`; no SSE /
//! streaming is needed. This avoids pulling in a heavyweight MCP SDK whose macro
//! API churns between releases.
//!
//! ## Control-only surface
//! The tools map to the existing browser paths in [`crate::browser`]: `open` /
//! `navigate` go through [`crate::browser::route_url`] (honoring the user's link
//! policy and driving the frontend panel, exactly like a clicked link), while
//! `reload` / `back` / `forward` act on the already-open window.
//!
//! FOR-DEV: page inspection + interaction tools (`browser_snapshot`,
//! `browser_evaluate`, `browser_click`, `browser_type`) are intentionally out of
//! scope for this pass. They need a JS return-channel from the docked
//! `WebviewWindow` (Tauri's `.eval()` is fire-and-forget) — an injected
//! init-script that posts results back, mindful of page CSP. See `FOR-DEV.md`.

use axum::{
    body::Bytes,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};

use tauri::AppHandle;

/// The MCP protocol revision we default to when a client doesn't pin one. We echo
/// the client's requested version when it sends one (forward-compatible).
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

/// Header carrying the shared secret (mirrors `hooks.rs`), accepted in addition to
/// the standard `Authorization: Bearer <token>`.
const TOKEN_HEADER: &str = "x-uxnan-token";

/// True if the request presents the shared secret, via `Authorization: Bearer
/// <token>` (what every supported CLI sends for a remote MCP server) or the
/// legacy `x-uxnan-token` header.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.strip_prefix("Bearer ")
                .or_else(|| v.strip_prefix("bearer "))
        })
        .map(|v| v.trim() == token)
        .unwrap_or(false);
    let legacy = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == token)
        .unwrap_or(false);
    bearer || legacy
}

/// The static tool catalog advertised on `tools/list`. Descriptions are written
/// for the *agent*: they say when to reach for the tool, so it discovers the
/// browser without docs.
fn tool_catalog() -> Value {
    json!([
        {
            "name": "browser_open",
            "description": "Open the uxnan integrated in-app browser and load a URL. Use this to preview or test a web app, page, or dev server you are building or running (for example http://localhost:5173). The page shows up in a panel next to the terminal so the user sees it too. Routed through the user's browser settings (it may open the system browser instead if they chose that).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Absolute URL to open, e.g. http://localhost:3000 or https://example.com." }
                },
                "required": ["url"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_navigate",
            "description": "Navigate the integrated browser to a new URL (opening the panel first if it is not already open). Same routing as browser_open.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Absolute URL to navigate to." }
                },
                "required": ["url"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_reload",
            "description": "Reload the current page in the integrated browser. Use after you change code and want to see the updated result. Errors if no browser page is open.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "browser_back",
            "description": "Go back one entry in the integrated browser's history. Errors if no browser page is open.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "browser_forward",
            "description": "Go forward one entry in the integrated browser's history. Errors if no browser page is open.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "browser_status",
            "description": "Report the integrated browser's state: whether a page is open, the current URL, whether the in-app browser is enabled, and how opens are routed (internal in-app / external system browser / ask). Call this first to decide whether to open or just navigate.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

/// Build a JSON-RPC success envelope for `id`.
fn ok_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// Build a JSON-RPC error envelope for `id`.
fn err_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Wrap a plain-text tool result in the MCP `content` shape.
fn text_result(text: String, is_error: bool) -> Value {
    json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": is_error
    })
}

/// Run one `tools/call`: dispatch the named browser tool and return an MCP
/// tool-result value (with `isError` set on failure — MCP surfaces tool failures
/// in-band, not as JSON-RPC errors, so the agent can read the reason).
async fn call_tool(app: &AppHandle, name: &str, args: &Value) -> Value {
    let url_arg = || args.get("url").and_then(|v| v.as_str()).map(str::to_string);
    match name {
        "browser_open" | "browser_navigate" => {
            let Some(url) = url_arg() else {
                return text_result("missing required \"url\" argument".into(), true);
            };
            match crate::browser::route_url(app, url.clone()).await {
                Ok(()) => text_result(format!("Requested to open {url} in the browser."), false),
                Err(e) => text_result(format!("Failed to open {url}: {}", e.message), true),
            }
        }
        "browser_reload" => match crate::browser::browser_window_reload(app.clone()) {
            Ok(()) => text_result("Reloaded the current page.".into(), false),
            Err(e) => text_result(e.message, true),
        },
        "browser_back" => match crate::browser::browser_window_back(app.clone()) {
            Ok(()) => text_result("Navigated back.".into(), false),
            Err(e) => text_result(e.message, true),
        },
        "browser_forward" => match crate::browser::browser_window_forward(app.clone()) {
            Ok(()) => text_result("Navigated forward.".into(), false),
            Err(e) => text_result(e.message, true),
        },
        "browser_status" => {
            let status = crate::browser::status(app).await;
            let text = serde_json::to_string(&status).unwrap_or_else(|_| "{\"open\":false}".into());
            text_result(text, false)
        }
        other => text_result(format!("unknown tool: {other}"), true),
    }
}

/// Handle one JSON-RPC message. Returns `Some(response)` for a request (something
/// with an `id`) and `None` for a notification (no `id` → no reply, per spec).
async fn handle_message(app: &AppHandle, msg: &Value) -> Option<Value> {
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
                        "name": "uxnan-browser",
                        "version": env!("CARGO_PKG_VERSION"),
                        "title": "uxnan integrated browser"
                    },
                    "instructions": "Drive uxnan's integrated in-app browser to preview and test web apps and dev servers you build. Call browser_status first, then browser_open/browser_navigate; browser_reload after code changes."
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
                ok_response(id, call_tool(app, name, args).await)
            }
        }
        "" => err_response(id, -32600, "invalid request: no method"),
        other => err_response(id, -32601, &format!("method not found: {other}")),
    };
    Some(result)
}

/// Handle a `POST /mcp`: authorize, parse the JSON-RPC body (single message or a
/// batch array), dispatch each, and reply. A body with only notifications gets a
/// `202 Accepted` with no content; anything with a request replies `200` with the
/// JSON-RPC response(s). Called from the thin route wrapper in `hooks.rs`.
pub async fn handle(app: AppHandle, token: String, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers, &token) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let Ok(parsed) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(err_response(Value::Null, -32700, "parse error")),
        )
            .into_response();
    };

    // Batch (array) or single message.
    if let Some(batch) = parsed.as_array() {
        let mut out = Vec::new();
        for msg in batch {
            if let Some(resp) = handle_message(&app, msg).await {
                out.push(resp);
            }
        }
        if out.is_empty() {
            return StatusCode::ACCEPTED.into_response();
        }
        return json_response(Value::Array(out));
    }

    match handle_message(&app, &parsed).await {
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

/// A `GET /mcp` with no server-initiated stream to offer: MCP allows the server to
/// decline the optional SSE channel with `405`. We only serve request/response.
pub async fn handle_get() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, "sse stream not supported").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers_with(name: &str, value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value).unwrap(),
        );
        h
    }

    #[test]
    fn authorizes_bearer_and_legacy_header() {
        assert!(authorized(
            &headers_with("authorization", "Bearer secret"),
            "secret"
        ));
        assert!(authorized(
            &headers_with("x-uxnan-token", "secret"),
            "secret"
        ));
        assert!(!authorized(
            &headers_with("authorization", "Bearer wrong"),
            "secret"
        ));
        assert!(!authorized(&HeaderMap::new(), "secret"));
    }

    #[test]
    fn tool_catalog_lists_the_control_tools() {
        let cat = tool_catalog();
        let names: Vec<&str> = cat
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                "browser_open",
                "browser_navigate",
                "browser_reload",
                "browser_back",
                "browser_forward",
                "browser_status",
            ]
        );
        // Every tool carries a non-empty description + object input schema so the
        // agent can discover it without docs.
        for t in cat.as_array().unwrap() {
            assert!(!t["description"].as_str().unwrap_or("").is_empty());
            assert_eq!(t["inputSchema"]["type"], "object");
        }
    }

    #[test]
    fn envelopes_are_well_formed_json_rpc() {
        let ok = ok_response(json!(1), json!({"a": true}));
        assert_eq!(ok["jsonrpc"], "2.0");
        assert_eq!(ok["id"], 1);
        assert_eq!(ok["result"]["a"], true);

        let err = err_response(json!("x"), -32601, "nope");
        assert_eq!(err["error"]["code"], -32601);
        assert_eq!(err["error"]["message"], "nope");
    }

    #[test]
    fn text_result_shapes_content_and_error_flag() {
        let r = text_result("hi".into(), true);
        assert_eq!(r["content"][0]["type"], "text");
        assert_eq!(r["content"][0]["text"], "hi");
        assert_eq!(r["isError"], true);
    }
}
