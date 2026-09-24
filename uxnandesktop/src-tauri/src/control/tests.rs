//! The control surface end to end: a real server on a real loopback port, a
//! mock Tauri app behind it, and requests shaped exactly as `uxnan-cli` and an
//! MCP client send them. What these pin down is the contract a caller can rely
//! on — the two gates, the envelope, the error codes — not any one service.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{Listener, Manager};
use tokio::sync::RwLock;
use uxnan_control_protocol::rpc::ErrorCode;
use uxnan_control_protocol::{MCP_PATH, RPC_PATH};

use crate::model::{AppData, RepoData};
use crate::persistence::PersistenceManager;
use crate::state::AppState;
use crate::target::TargetId;

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

/// A real repository to create worktrees of, registered as a project.
async fn repo_in(dir: &std::path::Path) -> (String, RepoData) {
    let path = dir.join("repo");
    std::fs::create_dir_all(&path).unwrap();
    let run = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(&path)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    };
    run(&["init", "-q", "-b", "main"]);
    run(&["config", "user.email", "test@uxnan.dev"]);
    run(&["config", "user.name", "Uxnan Test"]);
    run(&["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "hi\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-q", "-m", "init"]);
    let path = crate::worktreeloc::canonical_temp(&path);
    (
        path.clone(),
        RepoData {
            id: "repo-1".into(),
            name: "repo".into(),
            path,
            target: TargetId::Local,
            worktrees: Vec::new(),
            is_git: true,
            icon: None,
            branch_icons: Default::default(),
            worktree_order: Vec::new(),
            worktree_root: Some(dir.join("wt").to_string_lossy().into_owned()),
        },
    )
}

/// `worktree/create` creates the worktree where the project's policy says, is
/// receipted, audited, and idempotent by key — and a window that is not there
/// to adopt it is reported, not a failure of the creation.
#[tokio::test]
async fn a_worktree_is_created_receipted_audited_and_not_created_twice() {
    let dir = tempfile::tempdir().unwrap();
    let (repo_path, repo) = repo_in(dir.path()).await;
    let mut data = AppData::default();
    data.repos.push(repo);
    let s = server(data).await;
    let auth = [("authorization", "Bearer control-token")];
    let params = json!({ "project": "name:repo", "branch": "feat/x", "idempotencyKey": "k-1" });
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("worktree/create", params.clone()),
    )
    .await;
    let receipt = &body["result"];
    assert!(receipt["requestId"].as_str().is_some(), "{body}");
    assert_eq!(receipt["idempotencyKey"], "k-1");
    assert_eq!(receipt["worktree"]["branch"], "feat/x");
    // No window in the mock app: created, adoption reported as not done.
    assert_eq!(receipt["adopted"], false);
    assert!(receipt["warning"]
        .as_str()
        .unwrap()
        .contains("did not adopt"));
    // No agent was asked for: the receipt has no `terminal`, rather than a null.
    assert!(receipt.get("terminal").is_none(), "{receipt}");
    let created = receipt["worktree"]["path"].as_str().unwrap().to_string();
    assert!(std::path::Path::new(&created).join("README.md").exists());

    // Same key: the same receipt, and still one worktree.
    let (_, again) = post(&s.origin, RPC_PATH, &auth, rpc("worktree/create", params)).await;
    assert_eq!(again["result"], *receipt);
    let list = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .unwrap();
    let worktrees = String::from_utf8_lossy(&list.stdout)
        .lines()
        .filter(|l| l.starts_with("worktree "))
        .count();
    assert_eq!(worktrees, 2, "main + the one created");

    // The audit log has the line, with the caller and the receipt id.
    let data_dir = s._app.state::<AppState>().data_dir.clone();
    let log = std::fs::read_to_string(data_dir.join(super::audit::FILE_NAME)).unwrap();
    let lines: Vec<Value> = log
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        lines.len(),
        1,
        "the idempotent replay is not a second attempt"
    );
    assert_eq!(lines[0]["method"], "worktree/create");
    assert_eq!(lines[0]["ok"], true);
    assert_eq!(lines[0]["caller"]["kind"], "control");
    assert_eq!(lines[0]["requestId"], receipt["requestId"]);

    // A refusal is audited too, as a refusal.
    let (_, refused) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc(
            "worktree/create",
            json!({ "project": "name:repo", "branch": "feat/x" }),
        ),
    )
    .await;
    assert_eq!(refused["error"]["code"], ErrorCode::InvalidParams.code());
    let log = std::fs::read_to_string(data_dir.join(super::audit::FILE_NAME)).unwrap();
    let last: Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
    assert_eq!(last["ok"], false);
    assert!(!last["error"].as_str().unwrap().is_empty());
}

/// A prompt without an agent, and a prompt over the cap, are refused before
/// anything is created — and the refusal names the rule.
#[tokio::test]
async fn a_prompt_is_checked_before_the_worktree_exists() {
    let dir = tempfile::tempdir().unwrap();
    let (_, repo) = repo_in(dir.path()).await;
    let mut data = AppData::default();
    data.repos.push(repo);
    let s = server(data).await;
    let auth = [("authorization", "Bearer control-token")];
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc(
            "worktree/create",
            json!({ "project": "name:repo", "branch": "feat/p", "prompt": "hi" }),
        ),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::InvalidParams.code());
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("needs `agent`"));
    let big = "x".repeat(super::services::terminal::PROMPT_MAX_BYTES + 1);
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc(
            "worktree/create",
            json!({ "project": "name:repo", "branch": "feat/p", "agent": "claude", "prompt": big }),
        ),
    )
    .await;
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("the most a message to an agent may be"));
    // The folder that would have been created is not there.
    assert!(
        !dir.path().join("wt").exists()
            || std::fs::read_dir(dir.path().join("wt"))
                .map(|d| d.count() == 0)
                .unwrap_or(true)
    );
}

/// `automation/run` refuses an id nobody saved; `run/start` needs the window.
#[tokio::test]
async fn saved_things_only() {
    let s = server(AppData::default()).await;
    let auth = [("authorization", "Bearer control-token")];
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("automation/run", json!({ "automation": "not-saved" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::NotFound.code());
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("run/start", json!({ "run": "r1" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::Unavailable.code());
}

/// The `converse` entries: a message over the cap is refused before the window
/// is asked; `for` is validated; the audit records a send attempt — and never
/// the message itself.
#[tokio::test]
async fn converse_entries_validate_before_asking_the_window_and_audit_sends() {
    let s = server(AppData::default()).await;
    let auth = [("authorization", "Bearer control-token")];
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc(
            "agent/wait",
            json!({ "terminal": "id:t1", "for": "sleepy" }),
        ),
    )
    .await;
    // The selector is resolved first, and there is no window to list tabs.
    assert!(
        body["error"]["code"] == ErrorCode::Unavailable.code()
            || body["error"]["code"] == ErrorCode::InvalidParams.code(),
        "{body}"
    );
    let big = "x".repeat(super::services::terminal::PROMPT_MAX_BYTES + 1);
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &auth,
        rpc("agent/send", json!({ "terminal": "id:t1", "message": big })),
    )
    .await;
    // No window either way; what matters is the audit line and its redaction.
    assert!(body["error"].is_object());
    let data_dir = s._app.state::<AppState>().data_dir.clone();
    let log = std::fs::read_to_string(data_dir.join(super::audit::FILE_NAME)).unwrap();
    let last: Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
    assert_eq!(last["method"], "agent/send");
    assert_eq!(last["ok"], false);
    assert_eq!(
        last["params"]["message"]["bytes"],
        super::services::terminal::PROMPT_MAX_BYTES + 1
    );
    assert!(
        !log.contains("xxxxxxxx"),
        "the message text must never be logged"
    );
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

/// A linked worktree lives outside the project's folder (the app cuts them
/// under the worktree root), and it is still the project's: a worker launched
/// there is in the project's scope — `current` resolves to its worktree and
/// project — and the coordinator back in the checkout sees the worker's
/// terminal. Before this, both sides asked the persisted record, which knows
/// nothing of linked worktrees: the coordinator was blind to the worker it had
/// just started, and the worker had no scope at all.
#[tokio::test]
async fn a_linked_worktree_outside_the_project_folder_is_in_its_scope() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let (path, repo) = repo_in(dir.path()).await;
    let linked = elsewhere.path().join("feat-x");
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-q", "-b", "feat-x"])
        .arg(&linked)
        .current_dir(&path)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let linked = crate::worktreeloc::canonical_temp(&linked);
    assert!(
        !linked.starts_with(&path),
        "the linked worktree must sit outside the checkout for this test to mean anything"
    );
    let mut data = AppData::default();
    data.repos.push(repo);
    let s = server(data).await;
    let handle = s._app.handle().clone();
    for (id, cwd) in [("coordinator", path.clone()), ("worker", linked.clone())] {
        handle
            .state::<AppState>()
            .pty
            .create(
                crate::pty::PtySpec {
                    id: id.into(),
                    cwd: Some(cwd),
                    shell: None,
                    args: Vec::new(),
                    env: Vec::new(),
                    cols: 80,
                    rows: 24,
                },
                |_| {},
                || {},
            )
            .unwrap();
    }
    let tabs = json!({ "tabs": [
        { "id": "coordinator", "title": "c", "workspace": path },
        { "id": "worker", "title": "w", "workspace": linked },
    ] });
    let answerer = handle.clone();
    handle.listen_any(super::bridge::REQUEST_EVENT, move |event| {
        let req: super::bridge::BridgeRequest = serde_json::from_str(event.payload()).unwrap();
        let answer = match req.method.as_str() {
            "terminal/list" => tabs.clone(),
            _ => Value::Null,
        };
        answerer
            .state::<AppState>()
            .control_bridge
            .answer(&req.id, Ok(answer));
    });
    let call = |agent: &str, method: &str, params: Value| {
        let origin = s.origin.clone();
        let agent = agent.to_string();
        let method = method.to_string();
        async move {
            post(
                &origin,
                RPC_PATH,
                &[("x-uxnan-token", LAUNCH), ("x-uxnan-agent-id", &agent)],
                rpc(&method, params),
            )
            .await
            .1
        }
    };

    // The worker: its project and worktree resolve from `current`.
    let body = call("worker", "project/show", json!({ "project": "current" })).await;
    assert_eq!(body["result"]["name"], "repo", "{body}");
    let body = call("worker", "worktree/show", json!({ "worktree": "current" })).await;
    assert_eq!(body["result"]["path"], linked, "{body}");
    assert_eq!(body["result"]["branch"], "feat-x", "{body}");
    let body = call("worker", "terminal/list", json!({})).await;
    assert_eq!(
        body["result"]["terminals"].as_array().unwrap().len(),
        2,
        "{body}"
    );

    // The coordinator: the worker's terminal is in its scope, by id and by list.
    let body = call(
        "coordinator",
        "terminal/show",
        json!({ "terminal": "id:worker" }),
    )
    .await;
    assert_eq!(body["result"]["id"], "worker", "{body}");
    let body = call("coordinator", "terminal/list", json!({})).await;
    assert_eq!(
        body["result"]["terminals"].as_array().unwrap().len(),
        2,
        "{body}"
    );
    let body = call(
        "coordinator",
        "worktree/show",
        json!({ "worktree": "branch:feat-x" }),
    )
    .await;
    assert_eq!(body["result"]["path"], linked, "{body}");
    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(&linked)
        .current_dir(&path)
        .output();
}

/// `terminal/close` refuses a tab whose agent the hooks report as working —
/// busy, before the window is even asked — and otherwise hands the window
/// the id, mapping its `invalid` refusal (a person's live shell) to invalid
/// params and its success to `{closed}`.
#[tokio::test]
async fn terminal_close_refuses_a_working_agent_and_relays_the_window() {
    let dir = tempfile::tempdir().unwrap();
    let (path, repo) = repo_in(dir.path()).await;
    let mut data = AppData::default();
    data.repos.push(repo);
    let s = server(data).await;
    let handle = s._app.handle().clone();
    for id in ["coordinator", "worker", "theirs"] {
        handle
            .state::<AppState>()
            .pty
            .create(
                crate::pty::PtySpec {
                    id: id.into(),
                    cwd: Some(path.clone()),
                    shell: None,
                    args: Vec::new(),
                    env: Vec::new(),
                    cols: 80,
                    rows: 24,
                },
                |_| {},
                || {},
            )
            .unwrap();
    }
    let tabs = json!({ "tabs": [
        { "id": "coordinator", "title": "c", "workspace": path },
        { "id": "worker", "title": "w", "workspace": path },
        { "id": "theirs", "title": "t", "workspace": path },
    ] });
    let answerer = handle.clone();
    handle.listen_any(super::bridge::REQUEST_EVENT, move |event| {
        let req: super::bridge::BridgeRequest = serde_json::from_str(event.payload()).unwrap();
        let answer = match req.method.as_str() {
            "terminal/list" => tabs.clone(),
            // The window's ownership rule: the worker is the surface's, the
            // other tab a person's with a live shell.
            "terminal/close" => match req.params["terminal"].as_str() {
                Some("worker") => json!({ "closed": "worker" }),
                Some(other) => json!({
                    "error": format!("terminal `{other}` was opened by a person and its shell is alive; only they close it"),
                    "invalid": true,
                }),
                None => Value::Null,
            },
            _ => Value::Null,
        };
        answerer
            .state::<AppState>()
            .control_bridge
            .answer(&req.id, Ok(answer));
    });
    let call = |method: &str, params: Value| {
        let origin = s.origin.clone();
        let method = method.to_string();
        async move {
            post(
                &origin,
                RPC_PATH,
                &[
                    ("x-uxnan-token", LAUNCH),
                    ("x-uxnan-agent-id", "coordinator"),
                ],
                rpc(&method, params),
            )
            .await
            .1
        }
    };
    let report = |status: &'static str| {
        let origin = s.origin.clone();
        async move {
            post(
                &origin,
                "/hook",
                &[
                    ("x-uxnan-token", LAUNCH),
                    ("x-uxnan-agent-id", "worker"),
                    ("x-uxnan-status", status),
                ],
                json!({}),
            )
            .await
            .0
        }
    };

    // Working: refused as busy, without asking the window.
    assert_eq!(report("working").await, 204);
    let body = call("terminal/close", json!({ "terminal": "id:worker" })).await;
    assert_eq!(body["error"]["code"], ErrorCode::Busy.code(), "{body}");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("working"));

    // Done: the window closes it.
    assert_eq!(report("done").await, 204);
    let body = call("terminal/close", json!({ "terminal": "id:worker" })).await;
    assert_eq!(body["result"]["closed"], "worker", "{body}");

    // A person's live shell: the window's refusal comes back as invalid params.
    let body = call("terminal/close", json!({ "terminal": "id:theirs" })).await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::InvalidParams.code(),
        "{body}"
    );
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("opened by a person"));
}

/// A per-launch token reaches only the project its terminal was opened in:
/// listings are narrowed to it, a selector naming another project is *scope
/// denied* (not *not found*), and a launch request that did not say which
/// terminal it is reaches no project at all. The control token sees everything.
#[tokio::test]
async fn a_launch_token_reaches_only_its_terminals_project() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let (path_a, repo_a) = repo_in(dir_a.path()).await;
    let (path_b, mut repo_b) = repo_in(dir_b.path()).await;
    repo_b.id = "repo-2".into();
    repo_b.name = "other".into();
    let mut data = AppData::default();
    data.repos.push(repo_a);
    data.repos.push(repo_b);
    let s = server(data).await;
    let handle = s._app.handle().clone();

    // The caller's terminal: a real PTY whose folder is project A. Backend
    // state, so the scope needs no window and cannot be claimed by the request.
    handle
        .state::<AppState>()
        .pty
        .create(
            crate::pty::PtySpec {
                id: "agent-a".into(),
                cwd: Some(path_a.clone()),
                shell: None,
                args: Vec::new(),
                env: Vec::new(),
                cols: 80,
                rows: 24,
            },
            |_| {},
            || {},
        )
        .unwrap();

    // A stand-in window: answers the tab list with a tab in each project and
    // one in the Global space.
    let tabs = json!({ "tabs": [
        { "id": "agent-a", "title": "a", "workspace": path_a },
        { "id": "t-b", "title": "b", "workspace": path_b },
        { "id": "t-g", "title": "g", "workspace": "" },
    ] });
    let answerer = handle.clone();
    handle.listen_any(super::bridge::REQUEST_EVENT, move |event| {
        let req: super::bridge::BridgeRequest = serde_json::from_str(event.payload()).unwrap();
        let answer = match req.method.as_str() {
            "terminal/list" => tabs.clone(),
            _ => Value::Null,
        };
        answerer
            .state::<AppState>()
            .control_bridge
            .answer(&req.id, Ok(answer));
    });

    let launch: [(&str, &str); 2] = [("x-uxnan-token", LAUNCH), ("x-uxnan-agent-id", "agent-a")];
    let anonymous: [(&str, &str); 1] = [("x-uxnan-token", LAUNCH)];
    let control: [(&str, &str); 1] = [("authorization", "Bearer control-token")];
    let call = |headers: &[(&str, &str)], method: &str, params: Value| {
        let origin = s.origin.clone();
        let headers: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let method = method.to_string();
        async move {
            let borrowed: Vec<(&str, &str)> = headers
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            post(&origin, RPC_PATH, &borrowed, rpc(&method, params))
                .await
                .1
        }
    };

    // Listings are the caller's project only.
    let body = call(&launch, "project/list", json!({})).await;
    let names: Vec<&str> = body["result"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["repo"]);
    let body = call(&launch, "terminal/list", json!({})).await;
    let ids: Vec<&str> = body["result"]["terminals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["agent-a"], "{body}");
    let body = call(&launch, "status", json!({})).await;
    assert_eq!(body["result"]["counts"]["projects"], 1);
    assert_eq!(body["result"]["counts"]["terminals"], 1);

    // Its own project resolves; the other is scope denied, not not-found.
    let body = call(&launch, "project/show", json!({ "project": "name:repo" })).await;
    assert_eq!(body["result"]["name"], "repo", "{body}");
    let body = call(&launch, "project/show", json!({ "project": "name:other" })).await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::ScopeDenied.code(),
        "{body}"
    );
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("outside your scope"));
    let body = call(&launch, "project/show", json!({ "project": "name:nobody" })).await;
    assert_eq!(body["error"]["code"], ErrorCode::NotFound.code());
    let body = call(
        &launch,
        "worktree/show",
        json!({ "worktree": format!("path:{path_b}") }),
    )
    .await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::ScopeDenied.code(),
        "{body}"
    );
    let body = call(&launch, "terminal/show", json!({ "terminal": "id:t-b" })).await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::ScopeDenied.code(),
        "{body}"
    );
    let body = call(&launch, "terminal/show", json!({ "terminal": "id:t-g" })).await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::ScopeDenied.code(),
        "{body}"
    );
    let body = call(&launch, "terminal/show", json!({ "terminal": "current" })).await;
    assert_eq!(body["result"]["id"], "agent-a", "{body}");

    // A launch request that named no terminal reaches no project.
    let body = call(&anonymous, "project/list", json!({})).await;
    assert_eq!(body["result"]["projects"].as_array().unwrap().len(), 0);
    let body = call(
        &anonymous,
        "project/show",
        json!({ "project": "name:repo" }),
    )
    .await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::ScopeDenied.code(),
        "{body}"
    );
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("agent-id header"));

    // The control token sees both projects and every tab.
    let body = call(&control, "project/list", json!({})).await;
    assert_eq!(body["result"]["projects"].as_array().unwrap().len(), 2);
    let body = call(&control, "terminal/list", json!({})).await;
    assert_eq!(body["result"]["terminals"].as_array().unwrap().len(), 3);
    let body = call(&control, "project/show", json!({ "project": "name:other" })).await;
    assert_eq!(body["result"]["name"], "other");
}

/// The coordinator's entries over the real server, against a stand-in window
/// that keeps a tiny run: a wait on the inbox wakes on the app's change
/// notifier the moment a message lands (no polling), a question times out
/// with its id and is then answered, and the moves are audited.
#[tokio::test]
async fn a_coordinator_waits_on_the_inbox_and_a_worker_on_its_question() {
    let s = server(AppData::default()).await;
    let handle = s._app.handle().clone();

    // The stand-in window: one run, an inbox, one question.
    #[derive(Default)]
    struct Window {
        inbox: Vec<Value>,
        answered: Option<String>,
    }
    let window = Arc::new(std::sync::Mutex::new(Window::default()));
    let answerer = handle.clone();
    let w = window.clone();
    handle.listen_any(super::bridge::REQUEST_EVENT, move |event| {
        let req: super::bridge::BridgeRequest = serde_json::from_str(event.payload()).unwrap();
        let mut win = w.lock().unwrap();
        let answer = match req.method.as_str() {
            "run/create" => json!({ "id": "run-1", "status": "running" }),
            "inbox/check" => {
                let acked: Vec<String> = req.params["ack"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let before = win.inbox.len();
                win.inbox
                    .retain(|m| !acked.contains(&m["deliveryId"].as_str().unwrap().to_string()));
                json!({ "run": "run-1", "messages": win.inbox, "acked": before - win.inbox.len() })
            }
            "question/ask" => json!({ "run": "run-1", "questionId": "s2" }),
            "question/status" => json!({
                "run": "run-1",
                "answered": win.answered.is_some(),
                "answer": win.answered,
                "decision": win.answered.as_ref().map(|_| "approve"),
            }),
            "question/answer" => {
                win.answered = req.params["answer"].as_str().map(String::from);
                json!({ "resolved": true })
            }
            _ => Value::Null,
        };
        answerer
            .state::<AppState>()
            .control_bridge
            .answer(&req.id, Ok(answer));
    });

    let control = [("authorization", "Bearer control-token")];
    let worker = [("x-uxnan-token", LAUNCH), ("x-uxnan-agent-id", "w-1")];
    let call = |headers: &[(&str, &str)], method: &str, params: Value| {
        let origin = s.origin.clone();
        let headers: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let method = method.to_string();
        async move {
            let borrowed: Vec<(&str, &str)> = headers
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            post(&origin, RPC_PATH, &borrowed, rpc(&method, params))
                .await
                .1
        }
    };

    // A run, receipted.
    let body = call(
        &control,
        "run/create",
        json!({ "title": "T", "idempotencyKey": "k1" }),
    )
    .await;
    assert_eq!(body["result"]["run"]["id"], "run-1", "{body}");
    assert!(body["result"]["requestId"].is_string());

    // An empty inbox answers at once without `wait`.
    let started = std::time::Instant::now();
    let body = call(&control, "inbox/check", json!({ "run": "run-1" })).await;
    assert_eq!(
        body["result"]["messages"].as_array().unwrap().len(),
        0,
        "{body}"
    );
    assert!(started.elapsed() < Duration::from_secs(2));

    // With `wait`, the call sleeps until a message lands and the window
    // notifies — well inside the budget.
    let poster = handle.clone();
    let w = window.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        w.lock().unwrap().inbox.push(json!({
            "deliveryId": "m1", "type": "worker_done", "stepId": "s1", "text": "done", "at": 1
        }));
        poster.state::<AppState>().agent_changes.notify_waiters();
    });
    let started = std::time::Instant::now();
    let body = call(
        &control,
        "inbox/check",
        json!({ "run": "run-1", "wait": true, "timeoutMs": 10_000 }),
    )
    .await;
    let waited = started.elapsed();
    assert_eq!(body["result"]["messages"][0]["deliveryId"], "m1", "{body}");
    assert!(
        waited >= Duration::from_millis(300) && waited < Duration::from_secs(5),
        "{waited:?}"
    );
    // Acknowledged, it is gone.
    let body = call(
        &control,
        "inbox/check",
        json!({ "run": "run-1", "ack": ["m1"] }),
    )
    .await;
    assert_eq!(body["result"]["acked"], 1);
    assert_eq!(body["result"]["messages"].as_array().unwrap().len(), 0);

    // A worker asks: unanswered within a short budget → timeout carrying the
    // question id; from the user's shell the entry is refused outright.
    let body = call(&control, "question/ask", json!({ "question": "?" })).await;
    assert_eq!(
        body["error"]["code"],
        ErrorCode::InvalidParams.code(),
        "{body}"
    );
    let body = call(
        &worker,
        "question/ask",
        json!({ "question": "Drop the table?", "options": ["yes", "no"], "timeoutMs": 300 }),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::Timeout.code(), "{body}");
    assert_eq!(body["error"]["data"]["questionId"], "s2");
    // The coordinator answers; the worker's next wait returns it at once.
    let body = call(
        &control,
        "question/answer",
        json!({ "run": "run-1", "question": "s2", "answer": "no" }),
    )
    .await;
    assert_eq!(body["result"]["resolved"], true, "{body}");
    let body = call(&worker, "question/ask", json!({ "questionId": "s2" })).await;
    assert_eq!(body["result"]["answered"], true, "{body}");
    assert_eq!(body["result"]["answer"], "no");

    // Audited: the moves, not the reads or the waits.
    let log = std::fs::read_to_string(s._dir.path().join("control-audit.log")).unwrap();
    assert!(log.contains("\"method\":\"run/create\""));
    assert!(log.contains("\"method\":\"question/answer\""));
    assert!(log.contains("\"method\":\"question/ask\""));
    assert!(!log.contains("\"method\":\"inbox/check\""));
}

/// A host is the person's business: their own shell sees every registered
/// machine, and a token scoped to a project on *this* machine is told why it
/// sees none — an empty list would read as "no hosts", which is a different
/// fact. `host/show` also answers the projects and terminals on the machine.
#[tokio::test]
async fn hosts_answer_the_person_and_tell_a_scoped_token_why_it_sees_none() {
    let dir = tempfile::tempdir().unwrap();
    let (repo_path, repo) = repo_in(dir.path()).await;
    let mut data = AppData::default();
    data.repos.push(repo);
    data.settings.ssh_hosts = vec![host("h-a", "build-box"), host("h-b", "gpu-box")];
    let s = server(data).await;
    let handle = s._app.handle().clone();
    handle
        .state::<AppState>()
        .pty
        .create(
            crate::pty::PtySpec {
                id: "agent-a".into(),
                cwd: Some(repo_path.clone()),
                shell: None,
                args: Vec::new(),
                env: Vec::new(),
                cols: 80,
                rows: 24,
            },
            |_| {},
            || {},
        )
        .unwrap();
    // A stand-in window with one tab, in the local project.
    let tabs = json!({ "tabs": [{ "id": "agent-a", "title": "a", "workspace": repo_path }] });
    let answerer = handle.clone();
    handle.listen_any(super::bridge::REQUEST_EVENT, move |event| {
        let req: super::bridge::BridgeRequest = serde_json::from_str(event.payload()).unwrap();
        let answer = match req.method.as_str() {
            "terminal/list" => tabs.clone(),
            _ => Value::Null,
        };
        answerer
            .state::<AppState>()
            .control_bridge
            .answer(&req.id, Ok(answer));
    });
    let control = [("authorization", "Bearer control-token")];
    let launch: [(&str, &str); 2] = [("x-uxnan-token", LAUNCH), ("x-uxnan-agent-id", "agent-a")];

    // The person's shell: both machines, described from the live session —
    // which there is none of, so no generation and no channel count.
    let (_, body) = post(&s.origin, RPC_PATH, &control, rpc("host/list", json!({}))).await;
    let hosts = body["result"]["hosts"].as_array().unwrap();
    assert_eq!(hosts.len(), 2, "{body}");
    assert_eq!(hosts[0]["id"], "h-a");
    assert_eq!(hosts[0]["label"], "build-box");
    assert_eq!(hosts[0]["connected"], false);
    assert_eq!(hosts[0]["source"], "manual");
    assert!(hosts[0].get("generation").is_none(), "{body}");
    assert!(hosts[0].get("channels").is_none(), "{body}");

    // One host, with what is on it. The local project is not.
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &control,
        rpc("host/show", json!({ "host": "h-b" })),
    )
    .await;
    assert_eq!(body["result"]["id"], "h-b", "{body}");
    assert_eq!(body["result"]["projects"], json!([]));
    assert_eq!(body["result"]["terminals"], json!([]));

    // An id nobody has.
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &control,
        rpc("host/show", json!({ "host": "h-z" })),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::NotFound.code(), "{body}");

    // The agent's token: refused, and told what its scope is.
    for method in ["host/list", "host/show", "host/connect"] {
        let params = if method == "host/list" {
            json!({})
        } else {
            json!({ "host": "h-a" })
        };
        let (_, body) = post(&s.origin, RPC_PATH, &launch, rpc(method, params)).await;
        assert_eq!(
            body["error"]["code"],
            ErrorCode::ScopeDenied.code(),
            "{method}: {body}"
        );
        let message = body["error"]["message"].as_str().unwrap();
        assert!(message.contains("repo"), "{method}: {message}");
    }
}

/// A registered machine with nothing interesting about it.
fn host(id: &str, label: &str) -> crate::model::SshHost {
    crate::model::SshHost {
        id: id.into(),
        label: label.into(),
        config_host: None,
        hostname: format!("{label}.example"),
        port: 22,
        user: "dev".into(),
        identity_files: Vec::new(),
        identity_agent: None,
        identities_only: false,
        forward_agent: false,
        proxy_command: None,
        proxy_jump: None,
        source: crate::model::SshHostSource::Manual,
        needs_prompt: false,
    }
}

/// `status` reports the budget a new agent would be admitted under, from the
/// same place the gates read it — a coordinator that does not know the
/// concurrency starts workers that queue behind each other.
#[tokio::test]
async fn status_reports_the_budget_a_new_agent_faces() {
    let s = server(AppData::default()).await;
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer control-token")],
        rpc("status", json!({})),
    )
    .await;
    let budget = &body["result"]["budget"];
    assert!(budget["concurrency"].as_u64().unwrap() >= 1, "{body}");
    assert!(budget["live"].is_u64(), "{body}");
    assert!(budget["minFreeMemoryMb"].is_u64(), "{body}");
    assert!(budget["freeMemoryMb"].as_u64().unwrap() > 0, "{body}");
    assert!(budget["maxAgentMemoryMb"].is_u64(), "{body}");
}

/// `file/open --with` launches one of the person's editors, named. An editor
/// this machine does not have is refused **before** anything is spawned, and
/// the error says what there is — a caller cannot turn this into "run this
/// command", which is the whole point of naming editors instead of commands.
#[tokio::test]
async fn opening_with_an_unknown_editor_is_refused_and_lists_what_there_is() {
    let dir = tempfile::tempdir().unwrap();
    let (repo_path, repo) = repo_in(dir.path()).await;
    let mut data = AppData::default();
    data.repos.push(repo);
    let s = server(data).await;
    let (_, body) = post(
        &s.origin,
        RPC_PATH,
        &[("authorization", "Bearer control-token")],
        rpc(
            "file/open",
            json!({ "path": "README.md", "worktree": format!("path:{repo_path}"), "with": "/bin/sh" }),
        ),
    )
    .await;
    assert_eq!(body["error"]["code"], ErrorCode::NotFound.code(), "{body}");
    let message = body["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("no editor on this machine matches"),
        "{message}"
    );
    assert!(message.contains("available:"), "{message}");
}
