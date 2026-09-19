//! Orchestration reporting: the cooperative agent → run-engine channel (spec
//! `02d` §3). The backend stays dumb — it emits an `agent:orchestration` event
//! the window's run engine attributes to the running step whose target tab is
//! `agentId` (the agent's own `UXNAN_AGENT_ID`).

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::Caller;

fn field<'a>(params: &'a Value, name: &str) -> Result<&'a str, RpcError> {
    params
        .get(name)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            RpcError::new(
                ErrorCode::InvalidParams,
                format!("missing required argument `{name}`"),
            )
        })
}

/// `orchestration/reportResult`.
pub async fn report_result<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let agent_id = field(params, "agentId")?;
    let result = field(params, "result")?;
    let summary = params.get("summary").and_then(|v| v.as_str());
    app.emit(
        "agent:orchestration",
        json!({ "agentId": agent_id, "type": "result", "text": result, "summary": summary }),
    )
    .map_err(|e| RpcError::new(ErrorCode::Unavailable, e.to_string()))?;
    Ok(json!({ "reported": "result" }))
}

/// `orchestration/reportProgress`.
pub async fn report_progress<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let agent_id = field(params, "agentId")?;
    let message = field(params, "message")?;
    app.emit(
        "agent:orchestration",
        json!({ "agentId": agent_id, "type": "progress", "text": message }),
    )
    .map_err(|e| RpcError::new(ErrorCode::Unavailable, e.to_string()))?;
    Ok(json!({ "reported": "progress" }))
}
