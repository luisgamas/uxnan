//! Tauri commands for the bridge client (`bridgeclient`). The mode itself is a
//! setting (`AppSettings::bridge`), applied by `update_settings`; these expose
//! the live status, a retry, and the one call path the chat UI uses.

use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
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

/// Restart the bridge on the version installed now (Settings → Bridge &
/// mobile, the chat tab's gate): stops the running one — the app's or the
/// user's — and starts a fresh one. Only ever on the user's request.
#[tauri::command]
pub async fn bridge_restart(state: State<'_, AppState>) -> Result<(), CommandError> {
    state
        .bridge
        .restart()
        .await
        .map_err(|why| CommandError::new("BRIDGE_RESTART_FAILED", why))
}

/// A pairing QR for the phone, drawn from the RUNNING bridge's own payload
/// (`bridge/generatePairingQr`: its LAN hosts, its session, the pairing window
/// armed) — the same one `uxnan-bridge start` prints.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingQr {
    /// The QR as an SVG document (generated here, never from outside input).
    pub svg: String,
    /// When the payload stops being accepted (epoch ms).
    pub expires_at: i64,
    /// The bridge's manual pairing code (`ABCD-EFGH`), for a phone that types
    /// it instead of scanning. `None` from a bridge older than
    /// `bridge/pairingCode`, which then shows the QR alone.
    pub code: Option<String>,
}

/// The code out of a `bridge/pairingCode` answer (`{ code, expiresInMs }`);
/// `None` for anything else.
pub fn pairing_code_of(answer: &Value) -> Option<String> {
    answer
        .get("code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_owned)
}

/// The QR's text: the payload JSON, base64 — `encodePairingQr` in `shared/`,
/// which the phone decodes.
pub fn pairing_qr_text(payload: &Value) -> String {
    base64::engine::general_purpose::STANDARD.encode(payload.to_string())
}

/// Render [text] as a QR SVG sized for the settings dialog.
pub fn pairing_qr_svg(text: &str) -> Result<String, CommandError> {
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M)
        .map_err(|err| CommandError::new("QR_FAILED", err.to_string()))?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .build())
}

/// Ask the running bridge for a pairing payload and draw it.
#[tauri::command]
pub async fn bridge_pairing_qr(state: State<'_, AppState>) -> Result<PairingQr, CommandError> {
    let payload = state
        .bridge
        .call(
            "bridge/generatePairingQr",
            Value::Null,
            Duration::from_secs(15),
        )
        .await
        .map_err(|err| CommandError::new("BRIDGE_ERROR", err.to_string()))?;
    let expires_at = payload
        .get("expiresAt")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    // The same bridge's manual code, so the dialog can offer it next to the
    // QR. An older bridge doesn't know the method: the QR still stands.
    let code = state
        .bridge
        .call("bridge/pairingCode", Value::Null, Duration::from_secs(5))
        .await
        .ok()
        .as_ref()
        .and_then(pairing_code_of);
    Ok(PairingQr {
        svg: pairing_qr_svg(&pairing_qr_text(&payload))?,
        expires_at,
        code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_code_is_read_from_the_bridge_answer() {
        let answer = serde_json::json!({ "code": "ABCD-EFGH", "expiresInMs": 60_000 });
        assert_eq!(pairing_code_of(&answer).as_deref(), Some("ABCD-EFGH"));
        assert_eq!(pairing_code_of(&serde_json::json!({ "code": "  " })), None);
        assert_eq!(pairing_code_of(&serde_json::json!({})), None);
        assert_eq!(pairing_code_of(&Value::Null), None);
    }

    #[test]
    fn the_qr_carries_the_payload_the_phone_decodes() {
        let payload = serde_json::json!({ "v": 2, "sessionId": "s", "expiresAt": 5 });
        let text = pairing_qr_text(&payload);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&text)
            .unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&decoded).unwrap(), payload);
        let svg = pairing_qr_svg(&text).unwrap();
        assert!(svg.starts_with("<?xml") || svg.starts_with("<svg"));
        assert!(svg.contains("<svg"));
    }
}
