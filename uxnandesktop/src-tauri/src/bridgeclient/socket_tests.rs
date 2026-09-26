//! Connection tests over real sockets: an in-process fixture that speaks the
//! local control protocol, and — when the monorepo's bridge is built and `node`
//! is on PATH — the real Node bridge, started against a throwaway state dir.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

use super::connection::{CallError, ConnectError, Connection, Event, Resume};
use super::discovery::Discovery;

const TOKEN: &str = "fixture-token_123";

fn discovery(port: u16, token: &str) -> Discovery {
    Discovery {
        protocol: 1,
        port,
        token: token.into(),
        pid: 1,
        bridge_version: "fixture".into(),
        instance_id: "run-1".into(),
    }
}

/// What the fixture saw on the upgrade, for assertions.
#[derive(Debug, Default, Clone)]
struct Seen {
    query: String,
}

/// A one-connection bridge stand-in: checks the bearer token, says hello,
/// answers `ping` with `pong`, never answers `hang`, pushes a notification on
/// `notify`, and drops the socket on `drop`.
// The upgrade callback's `Result<Response, ErrorResponse>` shape is dictated by
// tungstenite's `accept_hdr_async`; its error type is not ours to box.
#[allow(clippy::result_large_err)]
async fn fixture() -> (u16, mpsc::UnboundedReceiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (seen_tx, seen_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let seen_tx = seen_tx.clone();
            tokio::spawn(async move {
                let mut seen = Seen::default();
                let callback = |req: &Request, res: Response| -> Result<Response, ErrorResponse> {
                    seen.query = req.uri().query().unwrap_or_default().to_string();
                    let auth = req
                        .headers()
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or_default();
                    if auth != format!("Bearer {TOKEN}") {
                        let mut refused = ErrorResponse::new(None);
                        *refused.status_mut() = StatusCode::UNAUTHORIZED;
                        return Err(refused);
                    }
                    Ok(res)
                };
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, callback).await else {
                    return;
                };
                let _ = seen_tx.send(seen);
                let hello = json!({
                    "type": "hello", "protocol": 1, "bridgeVersion": "fixture",
                    "instanceId": "run-1", "clientId": "desktop", "replayed": 0, "gap": false
                });
                let _ = ws.send(Message::Text(hello.to_string().into())).await;
                while let Some(Ok(Message::Text(text))) = ws.next().await {
                    let request: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    let id = request["id"].clone();
                    match request["method"].as_str() {
                        Some("ping") => {
                            let reply = json!({ "type": "message", "message": { "jsonrpc": "2.0", "id": id, "result": "pong" } });
                            let _ = ws.send(Message::Text(reply.to_string().into())).await;
                        }
                        Some("notify") => {
                            let note = json!({ "type": "message", "seq": 7, "message": { "jsonrpc": "2.0", "method": "stream/turn/started", "params": { "threadId": "t" } } });
                            let _ = ws.send(Message::Text(note.to_string().into())).await;
                            // Garbage in between must be ignored, not fatal.
                            let _ = ws.send(Message::Text("{not json".into())).await;
                            let reply = json!({ "type": "message", "message": { "jsonrpc": "2.0", "id": id, "result": null } });
                            let _ = ws.send(Message::Text(reply.to_string().into())).await;
                        }
                        Some("drop") => return,
                        _ => {}
                    }
                }
            });
        }
    });
    (port, seen_rx)
}

#[tokio::test]
async fn calls_notifications_and_resume_point_over_a_real_socket() {
    let (port, mut seen) = fixture().await;
    let (tx, mut events) = mpsc::unbounded_channel();
    let connection = Connection::open(&discovery(port, TOKEN), "desktop", None, tx)
        .await
        .unwrap();
    assert_eq!(connection.hello().instance_id, "run-1");
    assert_eq!(seen.recv().await.unwrap().query, "client=desktop");

    let pong = connection
        .call("ping", Value::Null, Duration::from_secs(5))
        .await;
    assert_eq!(pong, Ok(json!("pong")));

    connection
        .call("notify", json!({}), Duration::from_secs(5))
        .await
        .unwrap();
    match events.recv().await.unwrap() {
        Event::Notification { seq, message } => {
            assert_eq!(seq, 7);
            assert_eq!(message["method"], "stream/turn/started");
        }
        other => panic!("expected a notification, got {other:?}"),
    }
    assert_eq!(
        connection.resume_point(),
        Resume {
            seq: 7,
            instance_id: "run-1".into()
        }
    );
}

#[tokio::test]
async fn a_dropped_socket_fails_the_pending_call_and_reports_closed() {
    let (port, _seen) = fixture().await;
    let (tx, mut events) = mpsc::unbounded_channel();
    let connection = Connection::open(&discovery(port, TOKEN), "desktop", None, tx)
        .await
        .unwrap();
    let result = connection
        .call("drop", Value::Null, Duration::from_secs(5))
        .await;
    assert_eq!(result, Err(CallError::Closed));
    assert_eq!(events.recv().await, Some(Event::Closed));
}

#[tokio::test]
async fn an_unanswered_call_times_out() {
    let (port, _seen) = fixture().await;
    let (tx, _events) = mpsc::unbounded_channel();
    let connection = Connection::open(&discovery(port, TOKEN), "desktop", None, tx)
        .await
        .unwrap();
    let result = connection
        .call("hang", Value::Null, Duration::from_millis(100))
        .await;
    assert_eq!(result, Err(CallError::Timeout));
}

#[tokio::test]
async fn the_resume_point_travels_on_the_upgrade() {
    let (port, mut seen) = fixture().await;
    let (tx, _events) = mpsc::unbounded_channel();
    let resume = Resume {
        seq: 42,
        instance_id: "run-1".into(),
    };
    let _connection = Connection::open(&discovery(port, TOKEN), "desktop", Some(&resume), tx)
        .await
        .unwrap();
    assert_eq!(
        seen.recv().await.unwrap().query,
        "client=desktop&resume=42&instance=run-1"
    );
}

#[tokio::test]
async fn a_wrong_token_is_rejected_not_retried_forever() {
    let (port, _seen) = fixture().await;
    let (tx, _events) = mpsc::unbounded_channel();
    let result = Connection::open(&discovery(port, "wrong-token"), "desktop", None, tx).await;
    assert!(matches!(result, Err(ConnectError::Rejected(401))));
}

#[tokio::test]
async fn nothing_listening_is_refused() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let (tx, _events) = mpsc::unbounded_channel();
    let result = Connection::open(&discovery(port, TOKEN), "desktop", None, tx).await;
    assert!(matches!(result, Err(ConnectError::Refused(_))));
}

/// The real bridge: the monorepo's built `bridge/dist` started through its
/// public API against a throwaway state directory and an in-memory secret
/// store (so it touches neither `~/.uxnan` nor the OS keychain), serving only
/// the loopback control channel. Skipped when the bridge is not built or `node`
/// is missing — it is a contract check between the two apps, not a unit test.
#[tokio::test]
async fn talks_to_the_real_bridge_when_it_is_built() {
    let entry =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bridge/dist/src/index.js");
    let Some(node) = crate::which::resolve("node") else {
        eprintln!("skipped: node not on PATH");
        return;
    };
    if !entry.exists() {
        eprintln!("skipped: bridge not built ({})", entry.display());
        return;
    }
    let state = std::env::temp_dir().join(format!("uxnan-bridge-it-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&state).unwrap();
    let entry_url = format!(
        "file://{}",
        entry
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/")
    );
    let script = format!(
        "const {{ startBridge, InMemorySecretStore }} = await import({entry:?});\n\
         const bridge = await startBridge({{ baseDir: {state:?}, secretStore: new InMemorySecretStore(), logLevel: 'error' }});\n\
         await bridge.startLocalControl();\n\
         setInterval(() => {{}}, 1 << 30);",
        entry = entry_url,
        state = state.to_string_lossy(),
    );
    let mut child = tokio::process::Command::new(node)
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .current_dir(&state)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();

    let file = state.join(super::discovery::FILE_NAME);
    let mut record = None;
    for _ in 0..200 {
        if let Ok(found) = super::discovery::read(&file) {
            record = Some(found);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let record = record.expect("the bridge never published its discovery file");

    let (tx, mut events) = mpsc::unbounded_channel();
    let connection: Arc<Connection> = Connection::open(&record, "desktop", None, tx)
        .await
        .expect("connect to the real bridge");
    let status = connection
        .call("bridge/status", Value::Null, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(status["features"]["localControl"], json!(true));

    // Start a thread in a folder: the bridge registers its project, and every
    // client — this one included — is told about both, with revisions.
    let thread = connection
        .call(
            "thread/start",
            json!({ "cwd": state.to_string_lossy(), "agentId": "echo" }),
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    let mut announced = None;
    for _ in 0..10 {
        let event = tokio::time::timeout(Duration::from_secs(10), events.recv())
            .await
            .unwrap()
            .unwrap();
        match event {
            Event::Notification { seq, message } => {
                assert!(seq >= 1);
                // Presence and the project announcement may come first.
                if message["method"] == "stream/thread/updated" {
                    announced = Some(message);
                    break;
                }
            }
            other => panic!("expected notifications, got {other:?}"),
        }
    }
    let announced = announced.expect("the thread was announced");
    assert_eq!(announced["params"]["thread"]["id"], thread["id"]);
    assert!(announced["params"]["thread"]["rev"].as_u64().unwrap() >= 1);
    assert_eq!(announced["params"]["thread"]["origin"]["kind"], "desktop");

    // The replica catches up from nothing: the thread and its project are there.
    let changes = connection
        .call("sync/changes", json!({}), Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(changes["reset"], json!(true));
    assert!(changes["threads"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == thread["id"]));
    assert_eq!(changes["projects"].as_array().unwrap().len(), 1);
    assert_eq!(changes["projects"][0]["id"], thread["projectId"]);

    // A method the bridge does not know comes back as an RPC error.
    let unknown = connection
        .call("nope/nothing", Value::Null, Duration::from_secs(10))
        .await;
    assert!(matches!(unknown, Err(CallError::Rpc { code: -32601, .. })));

    connection.close();
    let _ = child.start_kill();
    let _ = child.wait().await;
    let _ = std::fs::remove_dir_all(&state);
}
