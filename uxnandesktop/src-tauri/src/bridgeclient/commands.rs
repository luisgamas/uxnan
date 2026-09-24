//! Tauri commands for the bridge client (`bridgeclient`). The mode itself is a
//! setting (`AppSettings::bridge`), applied by `update_settings`; these expose
//! the live status, a retry, and the one call path the chat UI uses.

use std::time::Duration;

use serde_json::Value;
use tauri::State;

use super::install::{self, InstallInfo};
use super::{BridgeCallError, InstallResult, Status};
use crate::error::CommandError;
use crate::state::AppState;

/// Generous: `turn/send` returns once the agent was started, `agent/models`
/// may spawn a CLI to enumerate them, and git operations can be slow.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// The current connection status.
#[tauri::command]
pub async fn bridge_client_status(state: State<'_, AppState>) -> Result<Status, CommandError> {
    Ok(state.bridge.status().await)
}

/// Try to (re)connect now instead of waiting out the backoff.
#[tauri::command]
pub fn bridge_client_retry(state: State<'_, AppState>) {
    state.bridge.retry_now();
}

/// Call a bridge JSON-RPC method (`thread/list`, `turn/send`, …) and return its
/// result. The bridge's registry is the allowlist; its errors come back as the
/// command error message.
#[tauri::command]
pub async fn bridge_call(
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, CommandError> {
    state
        .bridge
        .call(&method, params.unwrap_or(Value::Null), CALL_TIMEOUT)
        .await
        .map_err(|err| {
            let code = match &err {
                BridgeCallError::NotConnected => "BRIDGE_NOT_CONNECTED",
                BridgeCallError::InvalidMethod => "INVALID_INPUT",
                BridgeCallError::Call(_) => "BRIDGE_ERROR",
            };
            CommandError::new(code, err.to_string())
        })
}

/// What is installed: the bridge (and its version), npm, Node.js — plus the
/// command to copy for a user who would rather run it themselves.
#[tauri::command]
pub async fn bridge_install_probe() -> Result<InstallInfo, CommandError> {
    Ok(install::probe().await)
}

/// Install or update the bridge with npm, streaming its output as
/// `bridge:install-log`. Only ever run on the user's request (or with automatic
/// updates turned on in Settings → Bridge & mobile).
#[tauri::command]
pub async fn bridge_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<InstallResult, CommandError> {
    Ok(state.bridge.install_or_update(&app).await)
}
