//! Where the agents in this host's terminals report their state.
//!
//! The reporters are the desktop's own (`uxnan_workspace_engine::agent_hooks`),
//! and they POST to whatever `UXNAN_HOOK_URL` their terminal was given. On the
//! desktop that is the app's server; here it is this listener, on the host's
//! loopback, with a token of the daemon's own. A report is answered at once —
//! no reporter reads the answer, and none may be kept waiting by a slow link —
//! and handed to the daemon, which routes it to the terminal it came from.
//!
//! Deliberately small: one route, `Content-Length` bodies (every reporter sends
//! one), `Expect: 100-continue` honoured (curl asks before a large body), and
//! hard caps on size and time so a stray client cannot hold anything.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::paths;

/// The header block, at most. A report's headers are a handful of short lines.
const MAX_HEAD: usize = 16 * 1024;
/// A report's body, at most. Claude's largest events carry a prompt or a tool
/// input; past this it is not a report.
const MAX_BODY: usize = 512 * 1024;
/// How long one request may take, from connect to the last byte.
const DEADLINE: Duration = Duration::from_secs(5);

/// Where a terminal's agent reports, as injected into its environment.
#[derive(Debug, Clone)]
pub struct Endpoint {
    pub url: String,
    pub token: String,
    /// The same coordinates on disk, for a reporter whose environment went
    /// stale (an agent under a `tmux` that outlived a daemon).
    pub file: Option<PathBuf>,
}

impl Endpoint {
    /// The variables a terminal is started with, after the client's own.
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![
            ("UXNAN_HOOK_URL".to_string(), self.url.clone()),
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

/// A report as the reporter sent it: its `x-uxnan-*` headers (lowercased,
/// never the token) and its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Report {
    /// The terminal it came from: the header the shell reporters send, or the
    /// envelope the JS reporters post.
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

/// A token nobody else can guess, from the system's random source.
fn new_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 24];
    std::io::Read::read_exact(&mut std::fs::File::open("/dev/urandom")?, &mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Write the coordinates where a reporter can re-read them, readable by the
/// user alone. The format is the one the reporters already parse.
fn write_endpoint_file(url: &str, token: &str) -> Option<PathBuf> {
    let dir = paths::run_dir();
    paths::ensure_private_dir(&dir).ok()?;
    let path = dir.join(uxnan_workspace_engine::agent_hooks::ENDPOINT_FILENAMES[0]);
    let tmp = dir.join(format!(".endpoint-{}.tmp", std::process::id()));
    std::fs::write(
        &tmp,
        format!("UXNAN_HOOK_URL={url}\nUXNAN_HOOK_TOKEN={token}\n"),
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

/// Listen on the host's loopback and hand every accepted report to `deliver`.
pub async fn start<F>(deliver: F) -> std::io::Result<Endpoint>
where
    F: Fn(Report) + Send + Sync + 'static,
{
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let url = format!("http://{}/hook", listener.local_addr()?);
    let token = new_token()?;
    let file = write_endpoint_file(&url, &token);
    let deliver = Arc::new(deliver);
    let expected = token.clone();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let deliver = Arc::clone(&deliver);
            let expected = expected.clone();
            tokio::spawn(async move {
                let handled = tokio::time::timeout(DEADLINE, serve(stream, &expected)).await;
                if let Ok(Some(report)) = handled {
                    deliver(report);
                }
            });
        }
    });
    Ok(Endpoint { url, token, file })
}

/// Read one request, answer it, and give back the report if it is one.
async fn serve(mut stream: TcpStream, token: &str) -> Option<Report> {
    let mut buf = Vec::with_capacity(2048);
    let head_end = loop {
        let mut chunk = [0u8; 2048];
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = find(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            reply(&mut stream, "431 Request Header Fields Too Large").await;
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let request = lines.next().unwrap_or_default();
    let mut parts = request.split(' ');
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "POST" || target != "/hook" {
        reply(&mut stream, "404 Not Found").await;
        return None;
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
            n if n.starts_with("x-uxnan-") => headers.push((name, value)),
            _ => {}
        }
    }
    if presented.as_deref() != Some(token) {
        reply(&mut stream, "401 Unauthorized").await;
        return None;
    }
    if chunked {
        reply(&mut stream, "411 Length Required").await;
        return None;
    }
    let length = length.unwrap_or(0);
    if length > MAX_BODY {
        reply(&mut stream, "413 Payload Too Large").await;
        return None;
    }
    if expect_continue {
        stream
            .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
            .await
            .ok()?;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let mut chunk = vec![0u8; (length - body.len()).min(16 * 1024)];
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    reply(&mut stream, "204 No Content").await;
    Some(Report {
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

async fn reply(stream: &mut TcpStream, status: &str) {
    let _ = stream
        .write_all(
            format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await;
    let _ = stream.shutdown().await;
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(headers: &[(&str, &str)], body: &str) -> Report {
        Report {
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: body.to_string(),
        }
    }

    #[test]
    fn a_report_names_its_terminal_by_header_or_by_envelope() {
        assert_eq!(
            report(&[("x-uxnan-agent-id", "tab-1")], "{}").agent_id(),
            Some("tab-1".to_string())
        );
        assert_eq!(
            report(&[], r#"{"agentId": "tab-2", "event":"Stop"}"#).agent_id(),
            Some("tab-2".to_string())
        );
        assert_eq!(report(&[("x-uxnan-agent-id", " ")], "{}").agent_id(), None);
        assert_eq!(report(&[], r#"{"event":"Stop"}"#).agent_id(), None);
    }

    #[test]
    fn a_terminal_is_given_the_coordinates_and_the_file() {
        let endpoint = Endpoint {
            url: "http://127.0.0.1:9/hook".into(),
            token: "t".into(),
            file: Some(PathBuf::from("/h/run/endpoint.env")),
        };
        let keys: Vec<String> = endpoint.env().into_iter().map(|(k, _)| k).collect();
        assert_eq!(
            keys,
            vec!["UXNAN_HOOK_URL", "UXNAN_HOOK_TOKEN", "UXNAN_ENDPOINT_FILE"]
        );
    }

    #[test]
    fn tokens_are_long_and_never_repeat() {
        let (a, b) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
