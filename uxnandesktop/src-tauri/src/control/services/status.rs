//! `status`: what a caller learns first.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::catalog::Group;
use uxnan_control_protocol::rpc::RpcError;
use uxnan_control_protocol::PROTOCOL_VERSION;

use crate::control::dispatch::enabled_groups;
use crate::control::resolve::Resolver;
use crate::control::Caller;
use crate::state::AppState;

pub async fn status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    // Counts are the caller's view: a launch caller counts its own project.
    let resolver = Resolver::new(app, caller);
    let scope = resolver.scope().await;
    let state = app.state::<AppState>();
    let terminals = state
        .pty
        .live_sessions()
        .iter()
        .filter(|(id, cwd)| {
            matches!(caller, Caller::Launch { agent_id: Some(own) } if own == id)
                || scope.admits_folder(Some(cwd))
        })
        .count();
    let agents = super::agent::visible(app, caller).await.len();
    let projects = resolver.projects().await.len();
    let groups = enabled_groups(app).await;
    // The same rule the gates apply — `runner::limits_from` is what
    // `agent_run_headless` and every automations runner are admitted under —
    // over the settings this process already holds, so answering `status` does
    // not re-read the state file. `budget::live` counts the slots all of those
    // processes share, which is the one thing that cannot be known from here.
    let limits = crate::automations::runner::limits_from(
        state
            .data
            .read()
            .await
            .settings
            .resource_mode
            .resolved_budget,
    );
    let live = crate::automations::store::app_data_dir()
        .map(|dir| crate::budget::live(&dir))
        .unwrap_or(0);
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
        "budget": {
            "concurrency": limits.policy.capacity,
            "live": live,
            "minFreeMemoryMb": limits.policy.min_free_mb,
            "freeMemoryMb": crate::budget::free_memory_mb(),
            "maxAgentMemoryMb": limits.memory_ceiling_mb,
        },
        "cli": {
            "bundled": crate::control::cli::bundled().map(|p| p.to_string_lossy().into_owned()),
            "shim": crate::control::cli::shim().map(|p| p.to_string_lossy().into_owned()),
        },
    }))
}
