//! The control surface end to end: a real server on a real loopback port, a
//! mock Tauri app behind it, and requests shaped exactly as `uxnan-cli` and an
//! MCP client send them. What these pin down is the contract a caller can rely
//! on — the two gates, the envelope, the error codes — not any one service.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::Manager;
use tokio::sync::RwLock;
use uxnan_control_protocol::rpc::ErrorCode;
use uxnan_control_protocol::{MCP_PATH, RPC_PATH};

use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::state::AppState;

const LAUNCH: &str = "launch-token";
const CONTROL: &str = "control-token";

struct Server {
    origin: String,
    _app: tauri::App<tauri::test::MockRuntime>,
    _dir: tempfile::TempDir,
}

/// A running server over a fresh, empty app state.
async fn server(data: AppData) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = AppState::new(
        PersistenceManager::new(dir.path()),
        data,
        dir.path().to_path_buf(),
    );
    let control_token = state.control_token.clone();
    *control_token.write().await = CONTROL.to_string();
    app.manage(state);
    let started = super::server::start(
        app.handle().clone(),
        LAUNCH.to_string(),
        control_token,
        dir.path().join("hooks"),
    )
    .await
    .unwrap();
    Server {
        origin: started.origin,
        _app: app,
        _dir: dir,
    }
}

async fn post(origin: &str, path: &str, headers: &[(&str, &str)], body: Value) -> (u16, Value) {
    let client = reqwest::Client::new();
    let mut req = client.post(format!("{origin}{path}")).json(&body);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = req.send().await.unwrap();
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

fn rpc(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
}

#[tokio::test]
async fn both_gates_stand_before_the_rpc_route() {
    let s = server(AppData::default()).await;
    // No token → 401.
    let (status, _) = post(&s.origin, RPC_PATH, &[], rpc("status", json!({}))).await;
    assert_eq!(status, 401);
    // Wrong token → 401.
    let (status, _) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer nope")],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(status, 401);
    // A hostile Origin → 403, before the token is even looked at.
    let (status, _) = post(
        &s.origin,
        RPC_PATH,
        &[
            ("authorization", "Bearer control-token"),
            ("origin", "https://evil.example"),
        ],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(status, 403);
}

#[tokio::test]
async fn status_answers_either_token_and_says_which_caller_it_saw() {
    let s = server(AppData::default()).await;
    let (status, body) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer control-token")],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(
        body["result"]["protocolVersion"],
        uxnan_control_protocol::PROTOCOL_VERSION
    );
    assert_eq!(body["result"]["caller"]["kind"], "control");
    assert_eq!(body["result"]["counts"]["projects"], 0);
    assert!(body["result"]["groups"]
        .as_array()
        .unwrap()
        .iter()
        .all(|g| g["enabled"] == true));

    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &[("x-uxnan-token", LAUNCH), ("x-uxnan-agent-id", "pty-7")],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(body["result"]["caller"]["kind"], "launch");
    assert_eq!(body["result"]["caller"]["terminalId"], "pty-7");
}

#[tokio::test]
async fn the_envelope_errors_carry_the_protocol_codes() {
    let s = server(AppData::default()).await;
    let auth = [("authorization", "Bearer control-token")];
    // Unknown method.
    let (_, body) = post(&s.origin, RPC_PATH, &auth, rpc("shell/exec", json!({}))).await;
    assert_eq!(body["error"]["code"], ErrorCode::MethodNotFound.code());
    // A misspelled argument.
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("project/show", json!({ "projekt": "x" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::InvalidParams.code());
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("`projekt`"));
    // A selector that names nothing.
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("project/show", json!({ "project": "name:nothing" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::NotFound.code());
    // `current` from the user's shell.
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("project/show", json!({ "project": "current" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::InvalidParams.code());
    // Not JSON-RPC at all.
    let (status, body) = post(&s.origin, RPC_PATH, &auth, json!({ "hello": 1 })).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"]["code"], ErrorCode::InvalidRequest.code());
}

#[tokio::test]
async fn a_switched_off_group_refuses_its_entries_only() {
    let mut data = AppData::default();
    data.settings.control.disabled_groups = vec!["ui".into()];
    let s = server(data).await;
    let auth = [("authorization", "Bearer control-token")];
    let (_, body) = post(&s.origin, RPC_PATH, &auth, rpc("app/focus", json!({}))).await;
    assert_eq!(body["error"]["code"], ErrorCode::GroupDisabled.code());
    let (_, body) = post(&s.origin, RPC_PATH, &auth, rpc("project/list", json!({}))).await;
    assert_eq!(body["result"]["projects"], json!([]));
    let (_, body) = post(&s.origin, RPC_PATH, &auth, rpc("status", json!({}))).await;
    let ui = body["result"]["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["name"] == "ui")
        .unwrap();
    assert_eq!(ui["enabled"], false);
}

#[tokio::test]
async fn the_mcp_route_lists_the_catalog_and_calls_through_the_same_dispatcher() {
    let s = server(AppData::default()).await;
    let auth = [("authorization", "Bearer launch-token")];
    let (status, body) = post(
        &s.origin,
        MCP_PATH,
        &auth,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
    )
    .await;
    assert_eq!(status, 200);
    let tools = body["result"]["tools"].as_array().unwrap();
    assert_eq!(
        tools.len(),
        uxnan_control_protocol::catalog::catalog().len()
    );
    assert!(tools.iter().any(|t| t["name"] == "uxnan_status"));

    let (_, body) = post(
        &s.origin,
        MCP_PATH,
        &auth,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": { "name": "uxnan_status", "arguments": {} } }),
    )
    .await;
    assert_eq!(body["result"]["isError"], false);
    let text = body["result"]["content"][0]["text"].as_str().unwrap();
    let parsed: Value = serde_json::from_str(text).unwrap();
    assert_eq!(parsed["caller"]["kind"], "launch");

    // A failure is in-band, with the dispatcher's reason.
    let (_, body) = post(
        &s.origin,
        MCP_PATH,
        &auth,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "project_show", "arguments": { "project": "name:none" } } }),
    )
    .await;
    assert_eq!(body["result"]["isError"], true);
    assert!(body["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("no project"));

    // The control token is not accepted for MCP-only? It is: same catalog, same
    // gates — a script may speak MCP too.
    let (status, _) = post(
        &s.origin,
        MCP_PATH,
        &[("authorization", "Bearer control-token")],
        json!({ "jsonrpc": "2.0", "id": 4, "method": "ping" }),
    )
    .await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn a_hook_report_needs_the_launch_token() {
    let s = server(AppData::default()).await;
    let (status, _) = post(
        &s.origin,
        "/hook",
        &[
            ("x-uxnan-token", CONTROL),
            ("x-uxnan-agent-id", "a1"),
            ("x-uxnan-status", "working"),
        ],
        json!({}),
    )
    .await;
    assert_eq!(status, 401);
    let (status, _) = post(
        &s.origin,
        "/hook",
        &[
            ("x-uxnan-token", LAUNCH),
            ("x-uxnan-agent-id", "a1"),
            ("x-uxnan-status", "working"),
        ],
        json!({}),
    )
    .await;
    assert_eq!(status, 204);
    let state = s._app.state::<AppState>();
    let data = state.data.read().await;
    assert_eq!(data.agent_cache.len(), 1);
    assert_eq!(data.agent_cache[0].agent_id, "a1");
}

/// The control token can change while the server runs, and the old one stops
/// working the moment it does.
#[tokio::test]
async fn the_control_token_rotates_live() {
    let s = server(AppData::default()).await;
    let state = s._app.state::<AppState>();
    let slot: Arc<RwLock<String>> = state.control_token.clone();
    *slot.write().await = "rotated".to_string();
    let (status, _) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer control-token")],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(status, 401);
    let (status, _) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer rotated")],
        rpc("status", json!({})),
    )
    .await;
    assert_eq!(status, 200);
}
