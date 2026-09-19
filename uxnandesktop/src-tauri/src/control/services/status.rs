//! `status`: what a caller learns first.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::catalog::Group;
use uxnan_control_protocol::rpc::RpcError;
use uxnan_control_protocol::PROTOCOL_VERSION;

use crate::control::dispatch::enabled_groups;
use crate::control::Caller;
use crate::state::AppState;

pub async fn status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let state = app.state::<AppState>();
    let terminals = state.pty.live_sessions().len();
    let agents = super::agent::all(app).await.len();
    let projects = state.data.read().await.repos.len();
    let groups = enabled_groups(app).await;
    let caller_kind = match caller {
        Caller::Launch { agent_id } => json!({ "kind": "launch", "terminalId": agent_id }),
        Caller::Control => json!({ "kind": "control" }),
    };
    Ok(json!({
        "app": "uxnan-desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "protocolVersion": PROTOCOL_VERSION,
        "pid": std::process::id(),
        "groups": Group::ALL.iter().map(|g| json!({
            "name": g.name(),
            "version": g.version(),
            "enabled": groups.contains(g),
        })).collect::<Vec<_>>(),
        "caller": caller_kind,
        "counts": { "projects": projects, "terminals": terminals, "agents": agents },
    }))
}
