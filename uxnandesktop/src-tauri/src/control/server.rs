//! The one local server of the app — every route a process on this machine can
//! reach, on an ephemeral loopback port, behind the same two gates.
//!
//! | Route | Who calls it | What it is |
//! |---|---|---|
//! | `POST /hook` | an agent's hook script | a state report (`hooks::handle_report`) |
//! | `POST /browser` | the `BROWSER` shim in an agent terminal | open a URL in-app |
//! | `POST /mcp` | an agent the app launched | the MCP transport of the catalog (`control::mcp`) |
//! | `POST /control/v1/rpc` | `uxnan-cli`, a script, an agent launched elsewhere | the RPC transport of the catalog (`control::rpc`) |
//! | `GET /health` | anyone local | liveness |
//!
//! **The two gates.** Every route first refuses a caller whose `Host` or
//! `Origin` is not loopback — the CSRF / DNS-rebinding vector a web page would
//! use — and then requires a token. Two tokens exist, and which one a request
//! presents decides what kind of [`Caller`] it is:
//!
//! - the **per-launch token**, injected into every terminal the app spawns as
//!   `UXNAN_HOOK_TOKEN` (and named to the agent's MCP config): it identifies a
//!   process the app itself started, and the request may carry that terminal's
//!   id so `current` resolves to it;
//! - the **control token**, written only to the discovery file
//!   (`control::discovery`) the user's own shell can read: it identifies the
//!   user, or a script or an agent they run outside the app.
//!
//! Both are minted fresh on every start; neither is ever logged or echoed.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use uxnan_control_protocol::headers as proto_headers;

use crate::state::HookServerInfo;

/// Max request body we read (1 MiB). A hook payload, an MCP call or an RPC
/// request is small; this caps a stray local process from pushing us to OOM.
/// Oversized → 413.
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// What the server knows about a request that passed both gates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Caller {
    /// A process the app launched, authorized by the per-launch token. `agent_id`
    /// is the terminal it runs in, when the request said so — the anchor of the
    /// `current` selector.
    Launch { agent_id: Option<String> },
    /// The user's own shell (or something they run in it), authorized by the
    /// control token.
    Control,
}

/// Shared context handed to the axum handlers.
pub(crate) struct ServerCtx<R: tauri::Runtime> {
    pub app: AppHandle<R>,
    /// The per-launch token (hooks, MCP, and RPC from inside a terminal).
    pub launch_token: String,
    /// The control token (RPC from outside). Behind a lock so it can be rotated
    /// from Settings without restarting the server.
    pub control_token: Arc<RwLock<String>>,
}

// By hand: a derive would demand `R: Clone`, which a runtime is not, while an
// `AppHandle<R>` clones for any `R`.
impl<R: tauri::Runtime> Clone for ServerCtx<R> {
    fn clone(&self) -> Self {
        ServerCtx {
            app: self.app.clone(),
            launch_token: self.launch_token.clone(),
            control_token: self.control_token.clone(),
        }
    }
}

impl<R: tauri::Runtime> ServerCtx<R> {
    /// Which caller a request is, or `None` when it presents no valid token.
    async fn caller(&self, headers: &HeaderMap) -> Option<Caller> {
        let presented = presented_token(headers)?;
        if token_eq(&presented, &self.launch_token) {
            return Some(Caller::Launch {
                agent_id: header_str(headers, proto_headers::AGENT_ID),
            });
        }
        if token_eq(&presented, &self.control_token.read().await) {
            return Some(Caller::Control);
        }
        None
    }
}

/// The token a request presents, from `Authorization: Bearer <token>` (what
/// every supported agent CLI sends for a remote MCP server) or the legacy
/// `x-uxnan-token` header (what the hook scripts send).
fn presented_token(headers: &HeaderMap) -> Option<String> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.strip_prefix("Bearer ")
                .or_else(|| v.strip_prefix("bearer "))
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    bearer.or_else(|| header_str(headers, proto_headers::TOKEN))
}

/// Read a header as an owned, trimmed, non-empty string.
fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Constant-time equality for a shared token. Comparing the SHA-256 digests of
/// both sides (rather than the raw strings) removes the short-circuit timing side
/// channel a plain `==` on a secret leaks — the count of matching leading bytes —
/// because the comparison runs over fixed-length, unpredictable digest bytes an
/// attacker cannot steer toward the target. `sha2` is already a dependency
/// (Codex trust hashing), so this adds no crate.
pub(crate) fn token_eq(a: &str, b: &str) -> bool {
    let da = Sha256::digest(a.as_bytes());
    let db = Sha256::digest(b.as_bytes());
    // Data-independent fold over the two fixed-length (32-byte) digests.
    let mut diff = 0u8;
    for (x, y) in da.iter().zip(db.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Whether an HTTP authority (`host[:port]`, or a bracketed IPv6 literal) points
/// at loopback: `127.0.0.1`, `localhost`, or `::1`. Any other host — a real
/// name a DNS-rebinding/CSRF attacker would use — is rejected. A present but
/// empty authority is treated as suspicious (rejected).
fn host_is_loopback(authority: &str) -> bool {
    let authority = authority.trim();
    if authority.is_empty() {
        return false;
    }
    let host = if let Some(rest) = authority.strip_prefix('[') {
        // Bracketed IPv6 literal: `[::1]` or `[::1]:port` → take up to `]`.
        match rest.split_once(']') {
            Some((inner, _)) => inner,
            None => return false,
        }
    } else if authority == "::1" {
        // Bare IPv6 loopback (no brackets, no port).
        "::1"
    } else {
        // `host` or `host:port` → the part before the first `:`.
        authority.split(':').next().unwrap_or(authority)
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Whether an `Origin` header value is a loopback `http`/`https` origin. A real
/// web page (the CSRF / DNS-rebinding vector) always sends its true,
/// non-loopback `Origin`, so only a loopback one is accepted.
fn origin_is_loopback(origin: &str) -> bool {
    origin
        .trim()
        .strip_prefix("http://")
        .or_else(|| origin.trim().strip_prefix("https://"))
        .map(host_is_loopback)
        .unwrap_or(false)
}

/// Reject non-loopback callers by header — an explicit gate against
/// browser-driven CSRF / DNS-rebinding that does not depend on the token or on
/// CORS-preflight behavior. `Host` must be absent or loopback; `Origin` must be
/// absent or a loopback `http(s)` origin. The reporters send a loopback `Host`
/// and no `Origin`; a browser page always sends its real `Origin`. Every route
/// runs this before the token check.
pub(crate) fn loopback_caller(headers: &HeaderMap) -> bool {
    if let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        if !host_is_loopback(host) {
            return false;
        }
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if !origin_is_loopback(origin) {
            return false;
        }
    }
    true
}

/// Write the "endpoint file" the hook scripts source to recover live
/// coordinates after an app restart. POSIX writes `endpoint.env` (sourced with
/// `.`), Windows writes `endpoint.cmd` (sourced with `call`, so each line is
/// `set KEY=VALUE`). Values are validated shell-safe before writing (the file is
/// sourced as shell); an unsafe value aborts the write and the caller falls back
/// to PTY-env-only injection. Atomic (temp + rename). Returns the file path.
fn write_endpoint_file(dir: &Path, url: &str, token: &str) -> Option<PathBuf> {
    fn shell_safe(v: &str) -> bool {
        !v.is_empty()
            && v.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
    }
    if !shell_safe(url) || !shell_safe(token) {
        return None;
    }
    let (name, prefix, eol) = if cfg!(windows) {
        ("endpoint.cmd", "set ", "\r\n")
    } else {
        ("endpoint.env", "", "\n")
    };
    let body = format!("{prefix}UXNAN_HOOK_URL={url}{eol}{prefix}UXNAN_HOOK_TOKEN={token}{eol}");
    if std::fs::create_dir_all(dir).is_err() {
        return None;
    }
    let path = dir.join(name);
    let tmp = dir.join(format!(".endpoint-{}.tmp", std::process::id()));
    if std::fs::write(&tmp, body.as_bytes()).is_err() {
        return None;
    }
    // Best-effort 0600 so a co-tenant can't read the token off disk.
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

/// What [`start`] hands back: the hook coordinates the terminals are injected
/// with, plus the server's origin for the discovery file.
pub struct Started {
    pub hook: HookServerInfo,
    /// `http://127.0.0.1:<port>`, no path.
    pub origin: String,
}

/// Bind the server to an ephemeral `127.0.0.1` port and spawn its serve loop on
/// the Tokio runtime. `hooks_dir` is where the endpoint file is written. Errors
/// if the port can't be bound (the app still runs — without hook reporting, MCP
/// or control).
pub async fn start<R: tauri::Runtime>(
    app: AppHandle<R>,
    launch_token: String,
    control_token: Arc<RwLock<String>>,
    hooks_dir: PathBuf,
) -> std::io::Result<Started> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let origin = format!("http://127.0.0.1:{port}");
    let url = format!("{origin}/hook");
    let endpoint_file = write_endpoint_file(&hooks_dir, &url, &launch_token)
        .map(|p| p.to_string_lossy().into_owned());
    let ctx = ServerCtx {
        app,
        launch_token: launch_token.clone(),
        control_token,
    };
    let router = Router::new()
        .route("/hook", post(route_hook::<R>))
        .route("/browser", post(route_browser::<R>))
        .route(
            uxnan_control_protocol::MCP_PATH,
            post(route_mcp::<R>).get(route_mcp_get),
        )
        .route(uxnan_control_protocol::RPC_PATH, post(route_rpc::<R>))
        .route("/health", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(ctx);
    tauri::async_runtime::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            eprintln!("[uxnan-desktop] local server stopped: {err}");
        }
    });
    Ok(Started {
        hook: HookServerInfo {
            url,
            token: launch_token,
            endpoint_file,
        },
        origin,
    })
}

/// `POST /hook`: only a launched process reports a state.
async fn route_hook<R: tauri::Runtime>(
    AxumState(ctx): AxumState<ServerCtx<R>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !loopback_caller(&headers) {
        return StatusCode::FORBIDDEN;
    }
    if !matches!(ctx.caller(&headers).await, Some(Caller::Launch { .. })) {
        return StatusCode::UNAUTHORIZED;
    }
    crate::hooks::handle_report(&ctx.app, headers, body).await
}

/// The JSON body the agent `BROWSER` shim POSTs to open a URL in-app: `{"url": …}`.
#[derive(Debug, Clone, serde::Deserialize)]
struct BrowserRequest {
    url: String,
}

/// `POST /browser`: route a URL through the user's browser policy (in-app / OS
/// browser / prompt). Lets an agent open a link in the integrated browser via
/// `UXNAN_BROWSER_URL` + `UXNAN_BROWSER_TOKEN`; it lands in the browser of the
/// agent's own workspace when the request names its terminal, else in the one
/// on screen.
async fn route_browser<R: tauri::Runtime>(
    AxumState(ctx): AxumState<ServerCtx<R>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !loopback_caller(&headers) {
        return StatusCode::FORBIDDEN;
    }
    let Some(caller) = ctx.caller(&headers).await else {
        return StatusCode::UNAUTHORIZED;
    };
    let Ok(payload) = serde_json::from_slice::<BrowserRequest>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    if payload.url.trim().is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    let workspace = match caller {
        Caller::Launch { agent_id: Some(_) } => {
            super::services::browser::workspace_of(&ctx.app, &caller)
                .await
                .ok()
        }
        _ => None,
    };
    match crate::browser::route_url(&ctx.app, payload.url, workspace).await {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::BAD_REQUEST,
    }
}

/// `POST /mcp`: the MCP transport of the catalog.
async fn route_mcp<R: tauri::Runtime>(
    AxumState(ctx): AxumState<ServerCtx<R>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !loopback_caller(&headers) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let Some(caller) = ctx.caller(&headers).await else {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    };
    super::mcp::handle(&ctx.app, caller, body).await
}

/// `GET /mcp`: we don't offer the optional server→client SSE stream.
async fn route_mcp_get() -> Response {
    super::mcp::handle_get()
}

/// `POST /control/v1/rpc`: the RPC transport of the catalog.
async fn route_rpc<R: tauri::Runtime>(
    AxumState(ctx): AxumState<ServerCtx<R>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !loopback_caller(&headers) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let Some(caller) = ctx.caller(&headers).await else {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    };
    super::rpc::handle(&ctx.app, caller, body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderName, HeaderValue};

    fn with(pairs: &[(HeaderName, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (name, value) in pairs {
            h.insert(name.clone(), HeaderValue::from_str(value).unwrap());
        }
        h
    }

    #[test]
    fn token_eq_matches_only_equal_strings() {
        assert!(token_eq("s3cret-token", "s3cret-token"));
        assert!(token_eq("", ""));
        // Same length, one differing byte.
        assert!(!token_eq("s3cret-token", "s3cret-tokeN"));
        // Prefix of the real token must not pass.
        assert!(!token_eq("s3cret", "s3cret-token"));
        assert!(!token_eq("", "x"));
    }

    #[test]
    fn loopback_caller_gates_by_host_and_origin() {
        // No Host/Origin at all → allowed (programmatic clients may omit both).
        assert!(loopback_caller(&HeaderMap::new()));
        // Loopback Host, no Origin → allowed (the reporters' request shape).
        assert!(loopback_caller(&with(&[(header::HOST, "127.0.0.1:5123")])));
        assert!(loopback_caller(&with(&[(header::HOST, "localhost")])));
        assert!(loopback_caller(&with(&[(header::HOST, "[::1]:80")])));
        assert!(loopback_caller(&with(&[(header::HOST, "::1")])));
        // A loopback http(s) Origin (a dev page served from localhost) → allowed.
        assert!(loopback_caller(&with(&[(
            header::ORIGIN,
            "http://localhost:1420"
        )])));
        // A real, non-loopback Host or Origin → rejected (CSRF / DNS-rebinding).
        assert!(!loopback_caller(&with(&[(header::HOST, "evil.example")])));
        assert!(!loopback_caller(&with(&[(
            header::ORIGIN,
            "https://evil.example"
        )])));
        // A loopback Host paired with a hostile Origin → still rejected.
        assert!(!loopback_caller(&with(&[
            (header::HOST, "127.0.0.1:5123"),
            (header::ORIGIN, "https://evil.example"),
        ])));
    }

    #[test]
    fn a_token_is_read_from_bearer_or_the_legacy_header() {
        let bearer = with(&[(header::AUTHORIZATION, "Bearer abc")]);
        assert_eq!(presented_token(&bearer).as_deref(), Some("abc"));
        let lower = with(&[(header::AUTHORIZATION, "bearer abc")]);
        assert_eq!(presented_token(&lower).as_deref(), Some("abc"));
        let legacy = with(&[(HeaderName::from_static("x-uxnan-token"), " abc ")]);
        assert_eq!(presented_token(&legacy).as_deref(), Some("abc"));
        // A `Basic` scheme is not a token; an empty bearer is none.
        assert!(presented_token(&with(&[(header::AUTHORIZATION, "Basic abc")])).is_none());
        assert!(presented_token(&with(&[(header::AUTHORIZATION, "Bearer ")])).is_none());
        assert!(presented_token(&HeaderMap::new()).is_none());
    }

    /// The endpoint file is sourced as shell, so a value that could break out of
    /// an assignment is refused rather than written.
    #[test]
    fn endpoint_file_refuses_shell_unsafe_values() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            write_endpoint_file(dir.path(), "http://127.0.0.1:1/hook", "tok; rm -rf /").is_none()
        );
        assert!(write_endpoint_file(dir.path(), "http://127.0.0.1:1/hook", "").is_none());
        let path = write_endpoint_file(dir.path(), "http://127.0.0.1:1/hook", "tok-1.2").unwrap();
        let body = std::fs::read_to_string(path).unwrap();
        assert!(body.contains("UXNAN_HOOK_URL=http://127.0.0.1:1/hook"));
        assert!(body.contains("UXNAN_HOOK_TOKEN=tok-1.2"));
    }
}
