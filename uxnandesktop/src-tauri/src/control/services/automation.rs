//! Automations: the saved, unattended recurring runs. Listing reads the same
//! store the Settings pane reads; running one starts the same headless runner
//! its schedule starts, tagged as a manual run.

use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::automations::commands::{automations_list, automations_run_now};
use crate::control::receipts;
use crate::control::Caller;

/// `automation/list`.
pub async fn list<R: tauri::Runtime>(
    _app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let all = automations_list().map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    let items: Vec<Value> = all
        .iter()
        .map(|a| {
            let v = serde_json::to_value(a).unwrap_or(Value::Null);
            json!({
                "id": v.get("id").cloned().unwrap_or(Value::Null),
                "name": v.get("name").cloned().unwrap_or(Value::Null),
                "enabled": v.get("enabled").cloned().unwrap_or(Value::Null),
                "schedule": v.get("schedule").cloned().unwrap_or(Value::Null),
                "cwd": v.get("cwd").cloned().unwrap_or(Value::Null),
                "agent": v.get("agent").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    Ok(json!({ "automations": items }))
}

/// `automation/run`.
pub async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = params
        .get("automation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let all = automations_list().map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    let known = all.iter().any(|a| {
        serde_json::to_value(a)
            .ok()
            .and_then(|v| v.get("id").and_then(|i| i.as_str()).map(|i| i == id))
            .unwrap_or(false)
    });
    if !known {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("no automation matches `{id}`"),
        ));
    }
    automations_run_now(app.clone(), id.clone())
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "automation": { "id": id, "started": true } }),
    ))
}
