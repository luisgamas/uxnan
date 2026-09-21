//! Finding the app and talking to it.
//!
//! Two ways in, tried in order. Inside a terminal the app spawned, the
//! environment already says where the server is and carries the per-launch
//! token (`UXNAN_HOOK_URL`, `UXNAN_HOOK_TOKEN`) and this terminal's id
//! (`UXNAN_AGENT_ID`), which makes `current` mean *this* terminal. Anywhere
//! else, the discovery file the app writes under its data directory says the
//! same for the control token — after this client has checked that the file is
//! private to the user, that the process it names is still that process, and
//! that the protocol versions agree.
//!
//! The transport is HTTP/1.1 over a loopback TCP socket, written here in a few
//! dozen lines rather than through an HTTP crate: one `POST` with a JSON body
//! and one JSON reply, to `127.0.0.1`, with no TLS, redirects, cookies or
//! keep-alive to get right. A crate would be more code than this.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;
use uxnan_control_protocol::discovery::{Discovery, FILE_NAME};
use uxnan_control_protocol::rpc::{ErrorCode, Request, Response, RpcError};
use uxnan_control_protocol::{datadir, env, PROTOCOL_VERSION, RPC_PATH};

/// Where the client found the app.
#[derive(Debug, Clone)]
pub struct Endpoint {
    /// `http://127.0.0.1:<port>`.
    pub origin: String,
    pub token: String,
    /// This terminal's id, when running inside one the app spawned.
    pub agent_id: Option<String>,
    /// How the app was found — shown by `status`.
    pub via: &'static str,
}

/// Why the app could not be reached — each one a different thing to tell the
/// person or the agent, and a different exit status.
#[derive(Debug)]
pub struct ClientError {
    pub code: ErrorCode,
    pub message: String,
    /// The error's `data`, when the app attached some (a wait's current state).
    pub data: Option<Value>,
}

impl ClientError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        ClientError {
            code,
            message: message.into(),
            data: None,
        }
    }
}

impl From<RpcError> for ClientError {
    fn from(e: RpcError) -> Self {
        ClientError {
            code: e.code,
            message: e.message,
            data: e.data,
        }
    }
}

/// Find the running app.
pub fn discover() -> Result<Endpoint, ClientError> {
    if let Some(endpoint) = from_environment() {
        return Ok(endpoint);
    }
    from_discovery_file()
}

/// Inside a terminal the app spawned: the hook URL's origin + the launch token.
fn from_environment() -> Option<Endpoint> {
    let url = std::env::var(env::HOOK_URL).ok()?;
    let token = std::env::var(env::HOOK_TOKEN).ok()?;
    if url.trim().is_empty() || token.trim().is_empty() {
        return None;
    }
    let origin = origin_of(&url)?;
    Some(Endpoint {
        origin,
        token,
        agent_id: std::env::var(env::AGENT_ID)
            .ok()
            .filter(|s| !s.trim().is_empty()),
        via: "environment",
    })
}

/// `http://127.0.0.1:51234/hook` → `http://127.0.0.1:51234`.
fn origin_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let authority = rest.split('/').next()?;
    if authority.is_empty() {
        return None;
    }
    Some(format!("http://{authority}"))
}

/// The discovery file the app wrote for the user's own shell.
fn from_discovery_file() -> Result<Endpoint, ClientError> {
    let dir = data_dir().ok_or_else(|| {
        ClientError::new(
            ErrorCode::Unavailable,
            "could not tell where Uxnan keeps its data (no home directory in the environment)",
        )
    })?;
    let path = dir.join(FILE_NAME);
    let bytes = std::fs::read(&path).map_err(|_| {
        ClientError::new(
            ErrorCode::Unavailable,
            format!(
                "Uxnan Desktop is not running (no {} at {})",
                FILE_NAME,
                dir.display()
            ),
        )
    })?;
    check_private(&path)?;
    let record: Discovery = serde_json::from_slice(&bytes).map_err(|e| {
        ClientError::new(
            ErrorCode::Unavailable,
            format!("{} is not readable: {e}", path.display()),
        )
    })?;
    if record.protocol_version != PROTOCOL_VERSION {
        return Err(ClientError::new(
            ErrorCode::ProtocolMismatch,
            format!(
                "Uxnan Desktop {} speaks control protocol {}; this uxnan-cli speaks {}. Update the one that is behind.",
                record.app_version, record.protocol_version, PROTOCOL_VERSION
            ),
        ));
    }
    if !process_matches(record.pid, record.process_start) {
        return Err(ClientError::new(
            ErrorCode::Unavailable,
            format!(
                "Uxnan Desktop is not running ({} names process {} which is gone)",
                FILE_NAME, record.pid
            ),
        ));
    }
    Ok(Endpoint {
        origin: record.endpoint,
        token: record.token,
        agent_id: None,
        via: "discovery file",
    })
}

/// The data directory this build of the client looks in — the same rules the
/// app applies, including the `-dev` profile of a debug build.
pub fn data_dir() -> Option<PathBuf> {
    datadir::resolve(cfg!(debug_assertions))
}

/// Refuse a discovery file another user could read: the token in it would be
/// theirs too. The mode on Unix, the DACL on Windows — the same test the app
/// applies when it writes the file (`uxnan_control_protocol::private`).
fn check_private(path: &std::path::Path) -> Result<(), ClientError> {
    uxnan_control_protocol::private::check(path).map_err(|why| {
        ClientError::new(
            ErrorCode::ScopeDenied,
            format!(
                "{} is {why}; refusing to use its token — fix the permissions or restart Uxnan",
                path.display()
            ),
        )
    })
}

/// Whether `pid` is alive and started when the file says it did. A pid that
/// the OS has since given to another process fails the start-time check.
fn process_matches(pid: u32, start: u64) -> bool {
    match process_start_time(pid) {
        Some(actual) => actual.abs_diff(start) <= 2,
        None => false,
    }
}

/// When `pid` started, as epoch seconds, from the OS process table — the same
/// source the app read its own start from when it wrote the file.
fn process_start_time(pid: u32) -> Option<u64> {
    let pid = sysinfo::Pid::from_u32(pid);
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system
        .process(pid)
        .map(|p| p.start_time())
        .filter(|s| *s > 0)
}

/// One RPC call.
pub fn call(
    endpoint: &Endpoint,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, ClientError> {
    let request = Request::new(1, method, params);
    let body = serde_json::to_vec(&request)
        .map_err(|e| ClientError::new(ErrorCode::Internal, e.to_string()))?;
    let mut headers = format!(
        "POST {RPC_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nAuthorization: Bearer {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        endpoint.token,
        body.len()
    );
    if let Some(id) = &endpoint.agent_id {
        headers.push_str(&format!("X-Uxnan-Agent-Id: {id}\r\n"));
    }
    headers.push_str("\r\n");
    let (status, reply) = http_post(&endpoint.origin, headers.as_bytes(), &body, timeout)?;
    if status == 401 || status == 403 {
        return Err(ClientError::new(
            ErrorCode::ScopeDenied,
            "Uxnan Desktop refused the token; it was restarted — run the command again",
        ));
    }
    // An app from before the control surface has the hook server but not this
    // route — the one case a 404 means here, since the route is fixed.
    if status == 404 {
        return Err(ClientError::new(
            ErrorCode::ProtocolMismatch,
            format!(
                "the Uxnan Desktop found via the {} does not have a control surface (it predates uxnan-cli); update it",
                endpoint.via
            ),
        ));
    }
    let response: Response = serde_json::from_slice(&reply).map_err(|e| {
        ClientError::new(
            ErrorCode::Internal,
            format!("Uxnan Desktop answered with something that is not a response ({e})"),
        )
    })?;
    if let Some(error) = response.error {
        return Err(error.into());
    }
    Ok(response.result.unwrap_or(Value::Null))
}

/// A `POST` over one short-lived TCP connection. Returns the status code and
/// the body.
fn http_post(
    origin: &str,
    headers: &[u8],
    body: &[u8],
    timeout: Duration,
) -> Result<(u16, Vec<u8>), ClientError> {
    let authority = origin.strip_prefix("http://").unwrap_or(origin);
    let addr = authority
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .ok_or_else(|| {
            ClientError::new(ErrorCode::Unavailable, format!("bad endpoint {origin}"))
        })?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|_| {
        ClientError::new(
            ErrorCode::Unavailable,
            "Uxnan Desktop is not answering on its port (it was closed, or is still starting)",
        )
    })?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    stream
        .write_all(headers)
        .and_then(|_| stream.write_all(body))
        .map_err(|e| ClientError::new(ErrorCode::Unavailable, e.to_string()))?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| {
        if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut {
            ClientError::new(ErrorCode::Timeout, "timed out waiting for Uxnan Desktop")
        } else {
            ClientError::new(ErrorCode::Unavailable, e.to_string())
        }
    })?;
    parse_http(&raw)
}

/// Split a raw HTTP/1.1 response into status and body. Only what the app's
/// server sends is handled: a status line, headers, a `Content-Length` body
/// (or everything after the headers when the connection closed).
fn parse_http(raw: &[u8]) -> Result<(u16, Vec<u8>), ClientError> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| ClientError::new(ErrorCode::Internal, "malformed HTTP response"))?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or("");
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ClientError::new(ErrorCode::Internal, "malformed HTTP status line"))?;
    let content_length: Option<usize> = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok());
    let body_start = split + 4;
    let body = match content_length {
        Some(n) => raw[body_start..raw.len().min(body_start + n)].to_vec(),
        None => raw[body_start..].to_vec(),
    };
    Ok((status, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_is_the_hook_url_without_its_path() {
        assert_eq!(
            origin_of("http://127.0.0.1:51234/hook").as_deref(),
            Some("http://127.0.0.1:51234")
        );
        assert_eq!(origin_of("https://x/hook"), None);
        assert_eq!(origin_of("http:///hook"), None);
    }

    #[test]
    fn parses_a_response_with_and_without_a_content_length() {
        let (status, body) =
            parse_http(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}extra")
                .unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, b"{}");
        let (status, body) = parse_http(b"HTTP/1.1 401 Unauthorized\r\n\r\nunauthorized").unwrap();
        assert_eq!(status, 401);
        assert_eq!(body, b"unauthorized");
        assert!(parse_http(b"garbage").is_err());
    }

    /// A whole round trip against a stand-in server that answers the way the
    /// app's server does: status line, lowercase headers, a content-length body,
    /// then close.
    #[test]
    fn a_post_round_trip_reads_the_whole_body() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            // Read the whole request: headers, then the body its Content-Length
            // announces (the client may send them in two writes).
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = sock.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
                if let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..split]).to_string();
                    let len: usize = head
                        .lines()
                        .find_map(|l| l.strip_prefix("Content-Length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if raw.len() >= split + 4 + len {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&raw).to_string();
            let body = br#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
            let reply = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            sock.write_all(reply.as_bytes()).unwrap();
            sock.write_all(body).unwrap();
            request
        });
        let endpoint = Endpoint {
            origin,
            token: "tok".into(),
            agent_id: Some("pty-1".into()),
            via: "test",
        };
        let result = call(
            &endpoint,
            "status",
            serde_json::json!({}),
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /control/v1/rpc HTTP/1.1\r\n"));
        assert!(request.contains("Authorization: Bearer tok\r\n"));
        assert!(request.contains("X-Uxnan-Agent-Id: pty-1\r\n"));
        assert!(request.ends_with(r#""method":"status","params":{}}"#));
    }

    #[test]
    fn this_process_matches_its_own_start_time() {
        let me = std::process::id();
        let start = process_start_time(me).expect("own start time");
        assert!(process_matches(me, start));
        assert!(!process_matches(me, start + 3600));
    }
}
