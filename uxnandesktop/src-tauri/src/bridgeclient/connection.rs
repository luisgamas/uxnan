//! One live connection to the bridge's local control channel: a JSON-RPC client
//! over a loopback WebSocket (architecture/02a §5.8.15).
//!
//! - **Requests** get monotonic numeric ids and a pending-map entry resolved by
//!   the matching response; every call has a timeout, and a closed connection
//!   fails every pending call at once with a stable error (never a hang).
//! - **Notifications** carry the `seq` the bridge assigned; the connection
//!   records the highest one it delivered, so the next connection can ask the
//!   bridge to replay only what was missed (`resume`).
//! - **Frames are untrusted.** Anything that is not a well-formed frame is
//!   dropped; the size cap is enforced by the WebSocket layer.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use super::discovery::Discovery;

/// Largest frame accepted either way (`LOCAL_CONTROL_MAX_FRAME_BYTES`).
const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

/// How long the bridge has to send its `hello` after the upgrade.
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);

/// Where a reconnecting client stands, so the bridge replays only what it
/// missed. `None` on a fresh start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resume {
    pub seq: u64,
    pub instance_id: String,
}

/// The bridge's first frame on a connection.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
    pub bridge_version: String,
    pub instance_id: String,
    pub client_id: String,
    pub replayed: u64,
    /// True when some notifications the client missed are gone: it must resync.
    pub gap: bool,
}

/// A frame from the bridge (`LocalControlFrame` in `shared/`).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Frame {
    Hello(Hello),
    Message {
        #[serde(default)]
        seq: Option<u64>,
        message: Value,
    },
}

/// What went wrong with a call. Messages are safe to show: they never carry the
/// token or a raw frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallError {
    /// The connection closed before the response arrived.
    Closed,
    /// No response within the call's timeout.
    Timeout,
    /// The bridge answered with a JSON-RPC error.
    Rpc { code: i64, message: String },
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CallError::Closed => write!(f, "the bridge connection closed"),
            CallError::Timeout => write!(f, "the bridge did not answer in time"),
            CallError::Rpc { code, message } => write!(f, "{message} ({code})"),
        }
    }
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, CallError>>>>>;

/// A live connection. Cheap to share (`Arc`); dropping the last handle closes
/// the socket.
pub struct Connection {
    outbound: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: AtomicU64,
    last_seq: Arc<AtomicU64>,
    hello: Hello,
}

/// Something the bridge pushed.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A `stream/*` (or other) JSON-RPC notification, with its `seq`.
    Notification { seq: u64, message: Value },
    /// The connection ended; no further events follow.
    Closed,
}

/// Why a connection attempt failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectError {
    /// Nothing accepted the socket (bridge not running, stale file).
    Refused(String),
    /// The bridge refused the upgrade (wrong token, another user's bridge).
    Rejected(u16),
    /// The bridge accepted but never said hello, or said something else.
    Handshake(String),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::Refused(why) => write!(f, "could not reach the bridge: {why}"),
            ConnectError::Rejected(status) => {
                write!(f, "the bridge refused the connection (HTTP {status})")
            }
            ConnectError::Handshake(why) => write!(f, "unexpected bridge handshake: {why}"),
        }
    }
}

impl Connection {
    /// Opens the channel described by `discovery` as client `client_id`,
    /// resuming from `resume` when given. Returns once the bridge said hello;
    /// every later push goes to `events`.
    pub async fn open(
        discovery: &Discovery,
        client_id: &str,
        resume: Option<&Resume>,
        events: mpsc::UnboundedSender<Event>,
    ) -> Result<Arc<Connection>, ConnectError> {
        let mut url = format!(
            "ws://127.0.0.1:{}/control?client={}",
            discovery.port, client_id
        );
        if let Some(resume) = resume {
            url.push_str(&format!(
                "&resume={}&instance={}",
                resume.seq,
                percent_encode(&resume.instance_id)
            ));
        }
        let mut request = url
            .into_client_request()
            .map_err(|err| ConnectError::Refused(err.to_string()))?;
        let auth = HeaderValue::from_str(&format!("Bearer {}", discovery.token))
            .map_err(|_| ConnectError::Refused("unusable token".into()))?;
        request.headers_mut().insert("authorization", auth);

        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(MAX_FRAME_BYTES);
        config.max_frame_size = Some(MAX_FRAME_BYTES);
        let (socket, _) = match tokio_tungstenite::connect_async_with_config(
            request,
            Some(config),
            false,
        )
        .await
        {
            Ok(pair) => pair,
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                return Err(ConnectError::Rejected(response.status().as_u16()))
            }
            Err(err) => return Err(ConnectError::Refused(err.to_string())),
        };
        let (mut sink, mut stream) = socket.split();

        // The first frame must be the hello.
        let hello = match tokio::time::timeout(HELLO_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<Frame>(&text) {
                Ok(Frame::Hello(hello)) => hello,
                _ => {
                    return Err(ConnectError::Handshake(
                        "first frame was not a hello".into(),
                    ))
                }
            },
            Ok(_) => return Err(ConnectError::Handshake("closed before hello".into())),
            Err(_) => return Err(ConnectError::Handshake("no hello".into())),
        };

        let (outbound, mut outbound_rx) = mpsc::unbounded_channel::<Message>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let last_seq = Arc::new(AtomicU64::new(match resume {
            Some(resume) if resume.instance_id == hello.instance_id && !hello.gap => resume.seq,
            _ => 0,
        }));

        // Writer: everything the client sends goes through one task.
        tokio::spawn(async move {
            while let Some(message) = outbound_rx.recv().await {
                if sink.send(message).await.is_err() {
                    break;
                }
            }
            let _ = sink.close().await;
        });

        // Reader: responses resolve pending calls, notifications go out.
        let reader_pending = pending.clone();
        let reader_seq = last_seq.clone();
        tokio::spawn(async move {
            while let Some(frame) = stream.next().await {
                let text = match frame {
                    Ok(Message::Text(text)) => text,
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(_) => continue,
                };
                match serde_json::from_str::<Frame>(&text) {
                    Ok(Frame::Message {
                        seq: Some(seq),
                        message,
                    }) => {
                        reader_seq.fetch_max(seq, Ordering::SeqCst);
                        let _ = events.send(Event::Notification { seq, message });
                    }
                    Ok(Frame::Message { seq: None, message }) => {
                        resolve_response(&reader_pending, message);
                    }
                    // A second hello or garbage: ignore it.
                    _ => {}
                }
            }
            fail_all(&reader_pending);
            let _ = events.send(Event::Closed);
        });

        Ok(Arc::new(Connection {
            outbound,
            pending,
            next_id: AtomicU64::new(1),
            last_seq,
            hello,
        }))
    }

    /// The bridge's hello for this connection.
    pub fn hello(&self) -> &Hello {
        &self.hello
    }

    /// Where to resume from next time.
    pub fn resume_point(&self) -> Resume {
        Resume {
            seq: self.last_seq.load(Ordering::SeqCst),
            instance_id: self.hello.instance_id.clone(),
        }
    }

    /// Calls `method` with `params` and waits up to `timeout` for the result.
    pub async fn call(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CallError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending map poisoned")
            .insert(id, tx);
        let mut request = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if !params.is_null() {
            request["params"] = params;
        }
        if self
            .outbound
            .send(Message::Text(request.to_string().into()))
            .is_err()
        {
            self.pending
                .lock()
                .expect("pending map poisoned")
                .remove(&id);
            return Err(CallError::Closed);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(CallError::Closed),
            Err(_) => {
                self.pending
                    .lock()
                    .expect("pending map poisoned")
                    .remove(&id);
                Err(CallError::Timeout)
            }
        }
    }

    /// Asks the socket to close. Pending calls fail with [`CallError::Closed`].
    pub fn close(&self) {
        let _ = self.outbound.send(Message::Close(None));
    }
}

/// Routes a JSON-RPC response to the call waiting for its id. Anything that
/// is not a response to a pending numeric id is dropped.
fn resolve_response(pending: &Pending, message: Value) {
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(tx) = pending.lock().expect("pending map poisoned").remove(&id) else {
        return;
    };
    let outcome = if let Some(error) = message.get("error") {
        Err(CallError::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-32603),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("bridge error")
                .chars()
                .take(500)
                .collect(),
        })
    } else {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    };
    let _ = tx.send(outcome);
}

fn fail_all(pending: &Pending) {
    for (_, tx) in pending.lock().expect("pending map poisoned").drain() {
        let _ = tx.send(Err(CallError::Closed));
    }
}

/// Minimal query-value encoding for an instance id (a UUID in practice).
fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_with(id: u64) -> (Pending, oneshot::Receiver<Result<Value, CallError>>) {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(id, tx);
        (pending, rx)
    }

    #[tokio::test]
    async fn a_result_resolves_its_pending_call() {
        let (pending, rx) = pending_with(7);
        resolve_response(
            &pending,
            json!({ "jsonrpc": "2.0", "id": 7, "result": { "ok": true } }),
        );
        assert_eq!(rx.await.unwrap(), Ok(json!({ "ok": true })));
    }

    #[tokio::test]
    async fn an_error_becomes_a_call_error() {
        let (pending, rx) = pending_with(3);
        resolve_response(
            &pending,
            json!({ "jsonrpc": "2.0", "id": 3, "error": { "code": -32001, "message": "busy" } }),
        );
        assert_eq!(
            rx.await.unwrap(),
            Err(CallError::Rpc {
                code: -32001,
                message: "busy".into()
            })
        );
    }

    #[tokio::test]
    async fn unknown_ids_and_garbage_are_dropped() {
        let (pending, mut rx) = pending_with(1);
        resolve_response(&pending, json!({ "id": 99, "result": 1 }));
        resolve_response(&pending, json!({ "id": "1", "result": 1 }));
        resolve_response(&pending, json!(null));
        assert!(rx.try_recv().is_err());
        assert_eq!(pending.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn closing_fails_every_pending_call() {
        let (pending, rx) = pending_with(5);
        fail_all(&pending);
        assert_eq!(rx.await.unwrap(), Err(CallError::Closed));
    }

    #[test]
    fn frames_parse_by_type() {
        let hello: Frame = serde_json::from_str(
            r#"{"type":"hello","protocol":1,"bridgeVersion":"1","instanceId":"i","clientId":"desktop","replayed":0,"gap":false}"#,
        )
        .unwrap();
        assert!(matches!(hello, Frame::Hello(_)));
        let note: Frame =
            serde_json::from_str(r#"{"type":"message","seq":4,"message":{"method":"x"}}"#).unwrap();
        assert!(matches!(note, Frame::Message { seq: Some(4), .. }));
        let reply: Frame =
            serde_json::from_str(r#"{"type":"message","message":{"id":1}}"#).unwrap();
        assert!(matches!(reply, Frame::Message { seq: None, .. }));
        assert!(serde_json::from_str::<Frame>(r#"{"type":"other"}"#).is_err());
    }

    #[test]
    fn instance_ids_are_query_safe() {
        assert_eq!(percent_encode("a-b_c.1"), "a-b_c.1");
        assert_eq!(percent_encode("a&b=c"), "a%26b%3Dc");
    }
}
