//! Ask the window a question and wait for its answer.
//!
//! The terminal tabs, the open files and the orchestration runs are owned by
//! the webview: they are its state, and what the backend persists of them is a
//! serialization it has always treated as opaque. A control request about them
//! is therefore forwarded to the window as an event, and the window answers
//! through one Tauri command. The request is a plain `{ id, method, params }`;
//! the answer is either a result or an error message, and a window that does
//! not answer in time yields [`ErrorCode::Unavailable`] — the caller learns the
//! app is up but its window is not, which is a different thing from "no".
//!
//! Only the control dispatcher creates requests, and only for the methods that
//! need the window; a service that the backend can answer alone never comes
//! here.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::state::AppState;

/// The event the window listens to.
pub const REQUEST_EVENT: &str = "control:request";

/// How long the window gets to answer. A tab listing is synchronous work on
/// the webview's side; anything longer means the window is not there.
const TIMEOUT: Duration = Duration::from_secs(5);

/// What the window receives (deserialized only by the tests' stand-in window).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
}

/// The pending questions, keyed by request id.
#[derive(Default)]
pub struct Bridge {
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

impl Bridge {
    /// Send `method` + `params` to the window and wait for its answer.
    pub async fn ask<R: tauri::Runtime>(
        app: &AppHandle<R>,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let state = app.state::<AppState>();
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        state
            .control_bridge
            .pending
            .lock()
            .unwrap()
            .insert(id.clone(), tx);
        let request = BridgeRequest {
            id: id.clone(),
            method: method.to_string(),
            params,
        };
        if app.emit(REQUEST_EVENT, &request).is_err() {
            state.control_bridge.pending.lock().unwrap().remove(&id);
            return Err(RpcError::new(
                ErrorCode::Unavailable,
                "the app window is not reachable",
            ));
        }
        match tokio::time::timeout(TIMEOUT, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(message))) => Err(RpcError::new(ErrorCode::Internal, message)),
            // The sender was dropped without answering: the window went away.
            Ok(Err(_)) => Err(RpcError::new(
                ErrorCode::Unavailable,
                "the app window did not answer",
            )),
            Err(_) => {
                state.control_bridge.pending.lock().unwrap().remove(&id);
                Err(RpcError::new(
                    ErrorCode::Unavailable,
                    "the app window did not answer in time",
                ))
            }
        }
    }

    /// Deliver the window's answer to the waiting request. Unknown ids (an
    /// answer to a request that already timed out) are dropped silently.
    pub fn answer(&self, id: &str, outcome: Result<Value, String>) {
        if let Some(tx) = self.pending.lock().unwrap().remove(id) {
            let _ = tx.send(outcome);
        }
    }
}

/// The window's reply to a [`REQUEST_EVENT`].
#[tauri::command]
pub fn control_respond(
    state: tauri::State<'_, AppState>,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) {
    let outcome = match error {
        Some(message) => Err(message),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    state.control_bridge.answer(&id, outcome);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An answer for a request nobody is waiting on must not panic or leak.
    #[test]
    fn a_late_answer_is_dropped() {
        let bridge = Bridge::default();
        bridge.answer("nope", Ok(Value::Null));
        assert!(bridge.pending.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_answer_reaches_the_waiting_request() {
        let bridge = Bridge::default();
        let (tx, rx) = oneshot::channel();
        bridge.pending.lock().unwrap().insert("r1".into(), tx);
        bridge.answer("r1", Ok(serde_json::json!({ "tabs": [] })));
        assert_eq!(rx.await.unwrap().unwrap()["tabs"], serde_json::json!([]));
        assert!(bridge.pending.lock().unwrap().is_empty());
    }
}
