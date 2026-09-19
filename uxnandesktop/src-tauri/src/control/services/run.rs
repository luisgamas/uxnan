//! Orchestration runs: the window's run engine owns them, so both reads are
//! forwarded to it as they are.

use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::bridge::Bridge;
use crate::control::Caller;

/// `run/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    Bridge::ask(app, "run/list", Value::Null).await
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
