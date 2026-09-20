//! The RPC transport: one JSON-RPC 2.0 request per `POST`, answered in kind.
//!
//! A batch is not accepted — a client that wants several answers sends several
//! requests, which keeps every request's error its own. A notification (no id)
//! is not accepted either: every entry answers, and a caller that does not
//! want the answer can ignore it.

use axum::{
    body::Bytes,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::Value;
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, Request, Response as RpcResponse, RpcError};

use super::Caller;

/// Handle one authorized `POST /control/v1/rpc`.
pub async fn handle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: Caller,
    body: Bytes,
) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return reply(
                StatusCode::BAD_REQUEST,
                RpcResponse::err(
                    Value::Null,
                    RpcError::new(ErrorCode::ParseError, format!("parse error: {e}")),
                ),
            )
        }
    };
    let request: Request = match serde_json::from_value::<Request>(parsed.clone()) {
        Ok(r) if r.jsonrpc == "2.0" => r,
        _ => {
            let id = parsed.get("id").cloned().unwrap_or(Value::Null);
            return reply(
                StatusCode::BAD_REQUEST,
                RpcResponse::err(
                    id,
                    RpcError::new(
                        ErrorCode::InvalidRequest,
                        "expected a JSON-RPC 2.0 request with an id and a method",
                    ),
                ),
            );
        }
    };
    let response = match super::dispatch(app, &caller, &request.method, &request.params).await {
        Ok(result) => RpcResponse::ok(request.id, result),
        Err(error) => RpcResponse::err(request.id, error),
    };
    reply(StatusCode::OK, response)
}

fn reply(status: StatusCode, response: RpcResponse) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        serde_json::to_string(&response).unwrap_or_else(|_| "{}".into()),
    )
        .into_response()
}
