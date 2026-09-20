//! Orchestration runs: the window's run engine owns them, so both reads are
//! forwarded to it as they are.

use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::Caller;

/// `run/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    Bridge::ask(app, "run/list", Value::Null).await
}

/// `run/start`: the window's run engine validates and starts it; validation
/// errors come back as one refusal that lists them.
pub async fn start<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = params.get("run").and_then(|v| v.as_str()).unwrap_or("");
    let answer = Bridge::ask(app, "run/start", json!({ "run": id })).await?;
    if answer.is_null() {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("no run matches `{id}`"),
        ));
    }
    if let Some(errors) = answer.get("errors").and_then(|v| v.as_array()) {
        if !errors.is_empty() {
            let list: Vec<&str> = errors.iter().filter_map(|e| e.as_str()).collect();
            return Err(RpcError::new(
                ErrorCode::Busy,
                format!("the run cannot start: {}", list.join("; ")),
            )
            .with_data(json!({ "errors": errors })));
        }
    }
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "run": { "id": id, "status": answer.get("status").cloned().unwrap_or(json!("running")) } }),
    ))
}

/// `run/show`.
pub async fn show<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = params.get("run").and_then(|v| v.as_str()).unwrap_or("");
    let value = Bridge::ask(app, "run/show", json!({ "run": id })).await?;
    if value.is_null() {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("no run matches `{id}`"),
        ));
    }
    Ok(value)
}
