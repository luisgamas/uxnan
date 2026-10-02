//! Where the agents in this host's terminals reach the app: their state
//! reports, the integrated browser and the control surface's MCP server.
//!
//! On the desktop these are routes of the app's own local server; here they are
//! this listener, on the host's loopback, with a token of the daemon's own, and
//! each terminal is started with its coordinates. What arrives is handed to the
//! daemon, which carries it over the engine's channel to the app watching the
//! terminal it came from:
//!
//! - `POST /hook` — a reporter's state report. Answered at once: no reporter
//!   reads the answer, and none may be kept waiting by a slow link.
//! - `POST /browser` — the `$BROWSER` shim asking to open a URL. Answered at
//!   once, the same way.
//! - `POST /mcp` — a JSON-RPC call to the control surface. Answered with what
//!   the app's own MCP server answered, once it has (the server speaks plain
//!   request/response, never a stream; a `GET` is refused as it is there).
//!
//! Deliberately small: those routes, `Content-Length` bodies (every reporter and
//! MCP client sends one), `Expect: 100-continue` honoured (curl asks before a
//! large body), and hard caps on size and on the time a request may take to
//! arrive, so a stray client cannot hold anything.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::paths;

/// The header block, at most.
const MAX_HEAD: usize = 16 * 1024;
/// A request's body, at most. Claude's largest events carry a prompt or a tool
/// input, and an MCP call its arguments; past this it is neither.
const MAX_BODY: usize = 4 * 1024 * 1024;
/// How long a request may take to arrive, from connect to its last byte.
const ARRIVAL: Duration = Duration::from_secs(5);

/// Where a terminal's agent reaches the app, as injected into its
/// environment.
#[derive(Debug, Clone)]
pub struct Endpoint {
    /// `http://127.0.0.1:<port>`.
    pub base: String,
    pub token: String,
    /// The hook coordinates on disk, for a reporter whose environment went
    /// stale (an agent under a `tmux` that outlived a daemon).
    pub file: Option<PathBuf>,
}

impl Endpoint {
    pub fn hook_url(&self) -> String {
        format!("{}/hook", self.base)
    }

    pub fn browser_url(&self) -> String {
        format!("{}/browser", self.base)
    }

    pub fn mcp_url(&self) -> String {
        format!("{}/mcp", self.base)
    }

    /// The hook variables every terminal is started with, after the client's
    /// own. (The browser's and the MCP server's are the client's to give, per
    /// its settings — `AgentTools`.)
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![
            ("UXNAN_HOOK_URL".to_string(), self.hook_url()),
            ("UXNAN_HOOK_TOKEN".to_string(), self.token.clone()),
        ];
        if let Some(file) = &self.file {
            env.push((
                "UXNAN_ENDPOINT_FILE".to_string(),
                file.to_string_lossy().into_owned(),
            ));
        }
        env
    }
}

/// Which route a request came in on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Hook,
    Browser,
    Mcp,
}

/// A request as it arrived: its route, its `x-uxnan-*` headers (lowercased,
/// never the token) and its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Incoming {
    pub route: Route,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Incoming {
    /// The terminal it came from: the header the shell reporters, the shim and
    /// the MCP clients send, or the envelope the JS reporters post.
    pub fn agent_id(&self) -> Option<String> {
        let from_header = self
            .headers
            .iter()
            .find(|(k, _)| k == "x-uxnan-agent-id")
            .map(|(_, v)| v.clone());
        from_header
            .or_else(|| {
                let body: serde_json::Value = serde_json::from_str(&self.body).ok()?;
                Some(body.get("agentId")?.as_str()?.to_string())
            })
            .filter(|v| !v.trim().is_empty())
    }
}

/// What a request is answered with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub status: u16,
    /// A JSON body, or empty.
    pub body: String,
}

impl Answer {
    pub fn empty(status: u16) -> Self {
        Self {
            status,
            body: String::new(),
        }
    }
}

/// What handles an accepted request — the daemon.
pub type Handler =
    Arc<dyn Fn(Incoming) -> Pin<Box<dyn Future<Output = Answer> + Send>> + Send + Sync>;

/// A token nobody else can guess, from the operating system's random source.
fn new_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Write the hook coordinates where a reporter can re-read them, readable by
/// the user alone. The format is the one the reporters already parse.
fn write_endpoint_file(url: &str, token: &str) -> Option<PathBuf> {
    let dir = paths::run_dir();
    paths::ensure_private_dir(&dir).ok()?;
    // The format each platform's reporters read: sourced by `sh` on Unix,
    // `call`ed by the `.cmd` reporters on Windows.
    let (name, prefix, eol) = if cfg!(windows) {
        (
            uxnan_workspace_engine::agent_hooks::ENDPOINT_FILENAMES[1],
            "set ",
            "\r\n",
        )
    } else {
        (
            uxnan_workspace_engine::agent_hooks::ENDPOINT_FILENAMES[0],
            "",
            "\n",
        )
    };
    let path = dir.join(name);
    let tmp = dir.join(format!(".endpoint-{}.tmp", std::process::id()));
    std::fs::write(
        &tmp,
        format!("{prefix}UXNAN_HOOK_URL={url}{eol}{prefix}UXNAN_HOOK_TOKEN={token}{eol}"),
    )
    .ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    Some(path)
}

/// Listen on the host's loopback and hand every accepted request to `handler`.
pub async fn start(handler: Handler) -> std::io::Result<Endpoint> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let base = format!("http://{}", listener.local_addr()?);
    let token = new_token()?;
    let file = write_endpoint_file(&format!("{base}/hook"), &token);
    let expected = token.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                continue;
            };
            let handler = Arc::clone(&handler);
            let expected = expected.clone();
            tokio::spawn(async move {
                let arrived = tokio::time::timeout(ARRIVAL, read(&mut stream, &expected)).await;
                let answer = match arrived {
                    Ok(Ok(incoming)) => handler(incoming).await,
                    Ok(Err(refusal)) => refusal,
                    Err(_) => Answer::empty(408),
                };
                reply(&mut stream, &answer).await;
            });
        }
    });
    Ok(Endpoint { base, token, file })
}

/// Read one request, or the answer that refuses it.
async fn read(stream: &mut TcpStream, token: &str) -> Result<Incoming, Answer> {
    let gone = || Answer::empty(400);
    let mut buf = Vec::with_capacity(2048);
    let head_end = loop {
        let mut chunk = [0u8; 2048];
        let n = stream.read(&mut chunk).await.map_err(|_| gone())?;
        if n == 0 {
            return Err(gone());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = find(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err(Answer::empty(431));
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let request = lines.next().unwrap_or_default();
    let mut parts = request.split(' ');
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let route = match target {
        "/hook" => Route::Hook,
        "/browser" => Route::Browser,
        "/mcp" => Route::Mcp,
        _ => return Err(Answer::empty(404)),
    };
    if method != "POST" {
        return Err(Answer::empty(405));
    }

    let mut length: Option<usize> = None;
    let mut expect_continue = false;
    let mut chunked = false;
    let mut presented: Option<String> = None;
    let mut headers = Vec::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        match name.as_str() {
            "content-length" => length = value.parse().ok(),
            "expect" => expect_continue = value.eq_ignore_ascii_case("100-continue"),
            "transfer-encoding" => chunked = value.to_ascii_lowercase().contains("chunked"),
            "x-uxnan-token" => presented = Some(value),
            // The MCP clients carry the token as a bearer credential.
            "authorization" => {
                if let Some(bearer) = value.strip_prefix("Bearer ") {
                    presented = Some(bearer.trim().to_string());
                }
            }
            n if n.starts_with("x-uxnan-") => headers.push((name, value)),
            _ => {}
        }
    }
    if presented.as_deref() != Some(token) {
        return Err(Answer::empty(401));
    }
    if chunked {
        return Err(Answer::empty(411));
    }
    let length = length.unwrap_or(0);
    if length > MAX_BODY {
        return Err(Answer::empty(413));
    }
    if expect_continue {
        stream
            .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
            .await
            .map_err(|_| gone())?;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let mut chunk = vec![0u8; (length - body.len()).min(64 * 1024)];
        let n = stream.read(&mut chunk).await.map_err(|_| gone())?;
        if n == 0 {
            return Err(gone());
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok(Incoming {
        route,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "",
    }
}

async fn reply(stream: &mut TcpStream, answer: &Answer) {
    let kind = if answer.body.is_empty() {
        String::new()
    } else {
        "Content-Type: application/json\r\n".to_string()
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\n{kind}Content-Length: {}\r\nConnection: close\r\n\r\n",
        answer.status,
        reason(answer.status),
        answer.body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(answer.body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn incoming(headers: &[(&str, &str)], body: &str) -> Incoming {
        Incoming {
            route: Route::Hook,
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: body.to_string(),
        }
    }

    #[test]
    fn a_request_names_its_terminal_by_header_or_by_envelope() {
        assert_eq!(
            incoming(&[("x-uxnan-agent-id", "tab-1")], "{}").agent_id(),
            Some("tab-1".to_string())
        );
        assert_eq!(
            incoming(&[], r#"{"agentId": "tab-2", "event":"Stop"}"#).agent_id(),
            Some("tab-2".to_string())
        );
        assert_eq!(
            incoming(&[("x-uxnan-agent-id", " ")], "{}").agent_id(),
            None
        );
        assert_eq!(incoming(&[], r#"{"event":"Stop"}"#).agent_id(), None);
    }

    #[test]
    fn a_terminal_is_given_the_hook_coordinates_and_the_file() {
        let endpoint = Endpoint {
            base: "http://127.0.0.1:9".into(),
            token: "t".into(),
            file: Some(PathBuf::from("/h/run/endpoint.env")),
        };
        let env = endpoint.env();
        assert_eq!(
            env[0],
            ("UXNAN_HOOK_URL".into(), "http://127.0.0.1:9/hook".into())
        );
        let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            keys,
            vec!["UXNAN_HOOK_URL", "UXNAN_HOOK_TOKEN", "UXNAN_ENDPOINT_FILE"]
        );
        assert_eq!(endpoint.mcp_url(), "http://127.0.0.1:9/mcp");
        assert_eq!(endpoint.browser_url(), "http://127.0.0.1:9/browser");
    }

    #[test]
    fn tokens_are_long_and_never_repeat() {
        let (a, b) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
