//! The wire between Uxnan Desktop and the `uxnan-host` daemon.
//!
//! **One byte stream carries everything.** The desktop reaches the daemon
//! through a single SSH channel (an `exec` of `uxnan-host attach`, which joins
//! that channel to the daemon's local socket), so every terminal, every call
//! and every answer is multiplexed over it as length-prefixed [`Frame`]s. Nothing
//! here knows about SSH: the same frames run over a socket pair in tests and
//! over the system `ssh` client's pipes where the in-process client cannot go.
//!
//! **Versions meet in a window, not on an exact number.** The client says the
//! range it speaks (`PROTOCOL_MIN..=PROTOCOL`), the daemon answers with the
//! highest version both speak or refuses with a reason. An app update therefore
//! does not strand the terminals a daemon of the previous version is holding:
//! as long as the windows overlap, the new app talks to the old daemon.
//!
//! Control traffic is JSON (small, debuggable, versioned by field); terminal
//! bytes are raw [`Frame::Data`], never base64, because they are the bulk of
//! what crosses the link.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The newest version of this protocol.
///
/// - 1: terminals (open, attach, detach, resize, close, list).
/// - 2: folder watching (`Watch`, `Unwatch`, `Event::Changed`).
/// - 3: agent hooks (`WireHooks`, `Reply::HooksWired`, `Event::Hook`).
/// - 4: `Attach { history }` — the lines above the screen, for a viewer that
///   starts empty.
/// - 5: `StopAgent` — close the agent a terminal runs, and only it.
/// - 6: `TranscriptPreview` — the last turn of a transcript on this machine.
/// - 7: agent tools — `AgentTools`, and the control surface's MCP server and
///   the integrated browser reached from a terminal here (`Event::Mcp`,
///   `ClientMessage::McpAnswer`, `Event::OpenUrl`).
pub const PROTOCOL: u32 = 7;
/// The oldest version this build still speaks.
pub const PROTOCOL_MIN: u32 = 1;

/// Largest frame either side accepts. A terminal emits in small chunks; a
/// frame larger than this is a corrupted stream, not a big write.
pub const MAX_FRAME: usize = 1 << 20;

/// The line `uxnan-host attach` prints once it is joined to the daemon, before
/// the first frame. Login shells print banners and profile noise on the same
/// stream; the client skips everything up to this line.
pub const READY_LINE: &str = "UXNAN-HOST-READY";

/// One unit on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// A JSON [`ClientMessage`] or [`ServerMessage`].
    Control(Vec<u8>),
    /// Terminal bytes: input from the client, output (and the snapshot that
    /// repaints a returning viewer) from the daemon.
    Data {
        session: u32,
        bytes: Vec<u8>,
    },
    /// Liveness, either way. Answered with a [`Frame::Pong`] carrying the same
    /// number, so the asker measures the round trip too.
    Ping(u64),
    Pong(u64),
}

const KIND_CONTROL: u8 = 1;
const KIND_DATA: u8 = 2;
const KIND_PING: u8 = 3;
const KIND_PONG: u8 = 4;

impl Frame {
    /// `u32` big-endian length of what follows, a kind byte, the body.
    pub fn encode(&self) -> Vec<u8> {
        let mut body = Vec::new();
        match self {
            Frame::Control(json) => {
                body.push(KIND_CONTROL);
                body.extend_from_slice(json);
            }
            Frame::Data { session, bytes } => {
                body.push(KIND_DATA);
                body.extend_from_slice(&session.to_be_bytes());
                body.extend_from_slice(bytes);
            }
            Frame::Ping(n) => {
                body.push(KIND_PING);
                body.extend_from_slice(&n.to_be_bytes());
            }
            Frame::Pong(n) => {
                body.push(KIND_PONG);
                body.extend_from_slice(&n.to_be_bytes());
            }
        }
        let mut out = Vec::with_capacity(4 + body.len());
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);
        out
    }

    fn decode(body: Vec<u8>) -> std::io::Result<Frame> {
        let bad =
            |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, what.to_string());
        let (&kind, rest) = body.split_first().ok_or_else(|| bad("empty frame"))?;
        match kind {
            KIND_CONTROL => Ok(Frame::Control(rest.to_vec())),
            KIND_DATA => {
                if rest.len() < 4 {
                    return Err(bad("short data frame"));
                }
                let session = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]);
                Ok(Frame::Data {
                    session,
                    bytes: rest[4..].to_vec(),
                })
            }
            KIND_PING | KIND_PONG => {
                let n: [u8; 8] = rest.try_into().map_err(|_| bad("bad ping frame"))?;
                let n = u64::from_be_bytes(n);
                Ok(if kind == KIND_PING {
                    Frame::Ping(n)
                } else {
                    Frame::Pong(n)
                })
            }
            _ => Err(bad("unknown frame kind")),
        }
    }

    pub fn control<T: Serialize>(message: &T) -> Frame {
        Frame::Control(serde_json::to_vec(message).expect("protocol messages serialize"))
    }
}

/// Read one frame. `Ok(None)` is a clean end of stream between frames.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<Option<Frame>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len) as usize;
    if len == 0 || len > MAX_FRAME + 16 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("frame of {len} bytes"),
        ));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Frame::decode(body).map(Some)
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &Frame,
) -> std::io::Result<()> {
    writer.write_all(&frame.encode()).await?;
    writer.flush().await
}

/// What the client sends in a [`Frame::Control`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    /// The first frame of every connection.
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol_min: u32,
        protocol: u32,
        /// Who is asking, for the daemon's log (`uxnan-desktop 0.0.72`).
        client: String,
    },
    Request {
        id: u64,
        call: Call,
    },
    /// The answer to an [`Event::Mcp`]: the HTTP status and the body the
    /// client's own MCP server gave.
    McpAnswer {
        ticket: u64,
        status: u16,
        body: String,
    },
}

/// What the daemon sends in a [`Frame::Control`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Welcome(Welcome),
    /// The hello could not be accepted; the daemon closes after this.
    Refused {
        reason: String,
    },
    Response {
        id: u64,
        outcome: Outcome,
    },
    Event(Event),
}

/// The daemon's answer to a hello it accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Welcome {
    /// The version both sides will speak.
    pub protocol: u32,
    /// The daemon build (`0.0.72`).
    pub version: String,
    /// Changes every time a daemon starts. A client that remembers sessions by
    /// `(epoch, session)` knows a different epoch means they are gone — the
    /// numbers alone would be reused.
    pub epoch: String,
    pub pid: u32,
    pub os: String,
    pub arch: String,
}

/// What a client can ask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum Call {
    /// Start a terminal and attach this connection to it.
    #[serde(rename_all = "camelCase")]
    Open {
        cols: u16,
        rows: u16,
        /// Working directory; `None` is the user's home.
        cwd: Option<String>,
        /// Program and arguments; `None` is the user's login shell.
        command: Option<Vec<String>>,
        /// Extra environment for the program.
        #[serde(default)]
        env: Vec<(String, String)>,
        /// What the client calls it, kept for `list`.
        label: String,
    },
    /// Watch a terminal that is already running: the daemon answers, then sends
    /// one `Data` frame that repaints its current screen, then live output.
    Attach {
        session: u32,
        cols: u16,
        rows: u16,
        /// Send the lines above the screen first: the viewer starts empty (the
        /// app restarted). A viewer that kept its own — it only lost the
        /// connection — leaves it off, or they would be printed twice.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        history: bool,
    },
    /// Stop watching. The terminal keeps running.
    Detach {
        session: u32,
    },
    Resize {
        session: u32,
        cols: u16,
        rows: u16,
    },
    /// End the terminal and everything it started.
    Close {
        session: u32,
    },
    List,
    /// Watch a folder for changes (recursively, `.git` excluded) and report
    /// them as [`Event::Changed`]. One folder per connection: a new watch
    /// replaces the previous one, and the watch ends with the connection.
    Watch {
        root: String,
    },
    Unwatch,
    /// Wire the agents' reporters on this machine: write the scripts to its
    /// `~/.uxnan/hooks/` and register them in the config of every agent the
    /// machine shows signs of — the same installer the desktop runs on its
    /// own. Idempotent; the reports then arrive as [`Event::Hook`].
    WireHooks,
    /// Close the agent running in a terminal — one of `commands`, the agent
    /// CLIs the client knows — and only it: the shell, and the terminal, stay.
    /// Answered once it is gone (it is asked to end, then its tree is ended if
    /// it does not in a few seconds).
    StopAgent {
        session: u32,
        commands: Vec<String>,
    },
    /// The last turn's prompt and reply from the transcript an agent's report
    /// named — read here, where the file is, and only if it is a transcript of
    /// that agent's own.
    #[serde(rename_all = "camelCase")]
    TranscriptPreview {
        agent_type: String,
        path: String,
    },
    /// What a launch on this machine needs to reach the client's tools: this
    /// daemon's endpoint for them, the Claude config file it wrote here, and
    /// the version of OpenCode installed here. The client builds the launch
    /// catalog from these with the same code it uses for its own machine.
    AgentTools,
}

/// How a call ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome {
    Ok { reply: Reply },
    Error { code: ErrorCode, message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// No such terminal — it ended, or belongs to another daemon epoch.
    NotFound,
    /// The operating system would not start it.
    SpawnFailed,
    /// The call was malformed or not valid now.
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Reply {
    Opened {
        session: u32,
        pid: Option<u32>,
    },
    Attached {
        session: u32,
        alive: bool,
    },
    Sessions {
        sessions: Vec<SessionInfo>,
    },
    /// The agents whose reporter is registered now.
    HooksWired {
        agents: Vec<String>,
    },
    AgentStopped {
        outcome: AgentStop,
    },
    Transcript {
        prompt: Option<String>,
        summary: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    AgentTools {
        /// The MCP endpoint a terminal here reaches (`…/mcp`).
        mcp_url: String,
        /// The browser endpoint the `$BROWSER` shim posts to (`…/browser`).
        browser_url: String,
        /// The token both take.
        token: String,
        /// The `$BROWSER` shim on this machine, if it is there.
        browser_shim: Option<String>,
        /// Claude Code's launch config on this machine, naming `mcp_url`.
        claude_config: Option<String>,
        /// The major version of the OpenCode installed here, if one is.
        opencode_major: Option<u32>,
    },
    Done,
}

/// How closing a terminal's agent went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStop {
    /// No agent was running there.
    NotRunning,
    /// It exited when asked.
    Exited,
    /// It did not, and its process tree was ended.
    Killed,
}

/// One terminal the daemon holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session: u32,
    pub label: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub alive: bool,
    /// How long ago it started — an age, never a timestamp: the two machines'
    /// clocks do not agree.
    pub started_ago_ms: u64,
    /// How many connections are watching it now.
    pub viewers: u32,
}

/// Something that happened without being asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Event {
    /// A terminal's program ended. Its last screen can still be attached to.
    Exited { session: u32, code: Option<i32> },
    /// Something changed under the watched folder: each changed path and its
    /// parent folder (`.git` internals never listed). `overflow` says there were
    /// too many to list, and the whole folder is worth reloading; `git` that
    /// something under `.git` changed — a commit, a stage, a checkout — which
    /// the file tree ignores and the git panel does not.
    Changed {
        root: String,
        paths: Vec<String>,
        #[serde(default)]
        overflow: bool,
        #[serde(default)]
        git: bool,
    },
    /// An agent in one of this connection's terminals reported its state.
    /// Exactly what its reporter posted — the `x-uxnan-*` headers (never the
    /// token) and the body — so the desktop reads it with the same code that
    /// reads a report from an agent on its own machine. Sent to the
    /// connections watching that terminal; held while nobody is, and sent
    /// after the screen when one attaches.
    Hook {
        session: u32,
        headers: Vec<(String, String)>,
        body: String,
    },
    /// An agent in one of this connection's terminals called the client's MCP
    /// server: answer with [`ClientMessage::McpAnswer`] and the same ticket.
    /// The request waits for it on this machine.
    Mcp {
        ticket: u64,
        session: u32,
        body: String,
    },
    /// Something in one of this connection's terminals asked to open a URL
    /// (the `$BROWSER` shim). The URL is as it was given — a `localhost` one
    /// names this machine.
    OpenUrl { session: u32, url: String },
}

/// The version two windows agree on, if they overlap.
pub fn negotiate(client_min: u32, client_max: u32) -> Option<u32> {
    let high = client_max.min(PROTOCOL);
    let low = client_min.max(PROTOCOL_MIN);
    (low <= high).then_some(high)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_round_trip_through_a_stream() {
        let frames = vec![
            Frame::control(&ClientMessage::Hello {
                protocol_min: 1,
                protocol: 1,
                client: "test".into(),
            }),
            Frame::Data {
                session: 7,
                bytes: b"\x1b[31mhi\x00\xff".to_vec(),
            },
            Frame::Data {
                session: 0,
                bytes: Vec::new(),
            },
            Frame::Ping(42),
            Frame::Pong(42),
        ];
        let mut wire = Vec::new();
        for f in &frames {
            wire.extend_from_slice(&f.encode());
        }
        let mut reader = wire.as_slice();
        let mut back = Vec::new();
        while let Some(f) = read_frame(&mut reader).await.unwrap() {
            back.push(f);
        }
        assert_eq!(back, frames);
    }

    #[tokio::test]
    async fn a_corrupt_stream_is_an_error_not_a_huge_allocation() {
        let mut wire: &[u8] = &[0xff, 0xff, 0xff, 0xff, 1];
        assert!(read_frame(&mut wire).await.is_err());
        let mut unknown: &[u8] = &[0, 0, 0, 1, 99];
        assert!(read_frame(&mut unknown).await.is_err());
    }

    #[test]
    fn versions_meet_in_the_overlap_of_two_windows() {
        assert_eq!(negotiate(1, 1), Some(1));
        // A newer client still talks to this daemon at the version both know.
        assert_eq!(negotiate(1, 9), Some(PROTOCOL));
        // One that has dropped everything this daemon speaks is refused.
        assert_eq!(negotiate(PROTOCOL + 1, PROTOCOL + 3), None);
    }

    #[test]
    fn a_hook_report_has_a_stable_shape() {
        let event = ServerMessage::Event(Event::Hook {
            session: 4,
            headers: vec![("x-uxnan-agent-id".into(), "tab-1".into())],
            body: r#"{"hook_event_name":"Stop"}"#.into(),
        });
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(
            json,
            r#"{"type":"event","event":"hook","session":4,"headers":[["x-uxnan-agent-id","tab-1"]],"body":"{\"hook_event_name\":\"Stop\"}"}"#
        );
        let wire = ClientMessage::Request {
            id: 2,
            call: Call::WireHooks,
        };
        assert_eq!(
            serde_json::to_string(&wire).unwrap(),
            r#"{"type":"request","id":2,"call":{"method":"wireHooks"}}"#
        );
    }

    #[test]
    fn control_messages_have_a_stable_shape() {
        let call = Call::Attach {
            session: 3,
            cols: 80,
            rows: 24,
            history: false,
        };
        let json = serde_json::to_string(&ClientMessage::Request { id: 9, call }).unwrap();
        assert_eq!(
            json,
            r#"{"type":"request","id":9,"call":{"method":"attach","session":3,"cols":80,"rows":24}}"#
        );
        let reply = ServerMessage::Response {
            id: 9,
            outcome: Outcome::Ok {
                reply: Reply::Attached {
                    session: 3,
                    alive: true,
                },
            },
        };
        let json = serde_json::to_string(&reply).unwrap();
        assert_eq!(
            json,
            r#"{"type":"response","id":9,"outcome":{"status":"ok","reply":{"kind":"attached","session":3,"alive":true}}}"#
        );
    }
}
