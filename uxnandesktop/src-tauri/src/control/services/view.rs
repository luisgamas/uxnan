//! Render a prepared agent view in a disposable, isolated child webview.

use std::time::{Duration, Instant};

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::browser::capture;
use crate::control::Caller;
use crate::views::{self, ViewStore};

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const RENDER_WAIT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(100);
const MAX_CONTENT_HEIGHT: u64 = 10_000_000;
const MAX_REPORT_FRAGMENT_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderReport {
    content_height: u64,
    console: Vec<ConsoleEntry>,
}

#[derive(Debug, Deserialize)]
struct ConsoleEntry {
    level: String,
    text: String,
}

fn parse_report(fragment: &str) -> Option<RenderReport> {
    if fragment.len() > MAX_REPORT_FRAGMENT_BYTES {
        return None;
    }
    let encoded = fragment.strip_prefix("uxnan-render=")?;
    let decoded = percent_decode(encoded)?;
    let mut report: RenderReport = serde_json::from_str(&decoded).ok()?;
    if report.content_height > MAX_CONTENT_HEIGHT || report.console.len() > 50 {
        return None;
    }
    report.console.retain_mut(|entry| {
        if !matches!(entry.level.as_str(), "error" | "warning" | "log") {
            return false;
        }
        entry.text = entry.text.chars().take(500).collect();
        true
    });
    Some(report)
}

fn html_fits_limit(html: &str) -> bool {
    html.len() <= MAX_HTML_BYTES
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = hex(bytes.get(i + 1).copied()?)?;
            let lo = hex(bytes.get(i + 2).copied()?)?;
            decoded.push((hi << 4) | lo);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

async fn report_from_url<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
) -> (Option<RenderReport>, bool) {
    let deadline = Instant::now() + RENDER_WAIT;
    loop {
        if let Ok(url) = webview.url() {
            if let Some(report) = url.fragment().and_then(parse_report) {
                return (Some(report), false);
            }
        }
        if Instant::now() >= deadline {
            return (None, true);
        }
        tokio::time::sleep(POLL).await;
    }
}

fn allowed_view_navigation(url: &tauri::Url, key: &str) -> bool {
    #[cfg(target_os = "windows")]
    let origin_ok = url.scheme() == "http" && url.host_str() == Some("uxnan-view.localhost");
    #[cfg(not(target_os = "windows"))]
    let origin_ok = url.scheme() == "uxnan-view" && url.host_str() == Some("localhost");
    origin_ok
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == format!("/render/{key}") || url.path() == format!("/{key}"))
}

/// `view/render`.
pub async fn render<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    if !capture::supported() {
        return Err(RpcError::new(
            ErrorCode::Unavailable,
            "page screenshots are not available on this platform",
        ));
    }
    let html = params.get("html").and_then(Value::as_str).ok_or_else(|| {
        RpcError::new(ErrorCode::InvalidParams, "missing required argument `html`")
    })?;
    if !html_fits_limit(html) {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            "argument `html` must be at most 2 MiB",
        ));
    }
    let width = params.get("width").and_then(Value::as_u64).unwrap_or(720) as u32;

    let store = app.state::<ViewStore>();
    let _serial = store.serialize_render().await;
    let window = app
        .get_window("main")
        .ok_or_else(|| RpcError::new(ErrorCode::Unavailable, "main window is unavailable"))?;
    let key = views::render_key();
    let staged = views::stage_render(&key, html.to_owned(), &store)
        .map_err(|e| RpcError::new(ErrorCode::Internal, e))?;
    let url = match tauri::Url::parse(&staged) {
        Ok(url) => url,
        Err(error) => {
            store.remove(&key);
            return Err(RpcError::new(ErrorCode::Internal, error.to_string()));
        }
    };
    let label = format!("view-render-{key}");
    let navigation_key = key.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url| allowed_view_navigation(url, &navigation_key));
    // Keep the child outside the window even during its initial visibility;
    // capture::png temporarily moves hidden WebView2 pages on-screen off-window.
    let child = window
        .add_child(
            builder,
            LogicalPosition::new(-(width as f64) - 64.0, 0.0),
            LogicalSize::new(width as f64, 900.0),
        )
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.to_string()));
    let outcome = match child {
        Ok(webview) => {
            let _ = webview.hide();
            let (report, timed_out) = report_from_url(&webview).await;
            let capture = capture::png(&webview)
                .await
                .map_err(|e| RpcError::new(ErrorCode::Internal, e.message));
            let _ = webview.close();
            capture.map(|shot| {
                let entries = report
                    .as_ref()
                    .map(|report| {
                        report
                            .console
                            .iter()
                            .map(|entry| json!({"level": entry.level, "text": entry.text}))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                json!({
                    "image": {
                        "mimeType": "image/png",
                        "width": shot.width,
                        "height": shot.height,
                        "data": base64::engine::general_purpose::STANDARD.encode(shot.png),
                    },
                    "contentHeight": report.map_or(0, |report| report.content_height),
                    "console": entries,
                    "timedOut": timed_out,
                })
            })
        }
        Err(error) => Err(error),
    };
    store.remove(&key);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_report_and_bounds_console_entries() {
        let json = json!({
            "contentHeight": 1234,
            "console": [
                {"level": "warning", "text": "a".repeat(600)},
                {"level": "trace", "text": "ignored"}
            ]
        });
        let encoded = url_encode(&json.to_string());
        let report = parse_report(&format!("uxnan-render={encoded}")).unwrap();
        assert_eq!(report.content_height, 1234);
        assert_eq!(report.console.len(), 1);
        assert_eq!(report.console[0].text.chars().count(), 500);
    }

    #[test]
    fn rejects_malformed_oversized_and_unknown_reports() {
        assert!(parse_report("other=x").is_none());
        assert!(parse_report("uxnan-render=%GG").is_none());
        assert!(parse_report(&format!(
            "uxnan-render={}",
            "x".repeat(MAX_REPORT_FRAGMENT_BYTES)
        ))
        .is_none());
        let too_high = json!({"contentHeight": MAX_CONTENT_HEIGHT + 1, "console": []});
        assert!(parse_report(&format!(
            "uxnan-render={}",
            url_encode(&too_high.to_string())
        ))
        .is_none());
        let too_many = json!({
            "contentHeight": 10,
            "console": (0..=50).map(|_| json!({"level": "log", "text": "x"})).collect::<Vec<_>>()
        });
        assert!(parse_report(&format!(
            "uxnan-render={}",
            url_encode(&too_many.to_string())
        ))
        .is_none());
    }

    #[test]
    fn params_require_html_and_bound_width_and_utf8_size() {
        let schema = &uxnan_control_protocol::catalog::by_method("view/render")
            .expect("catalog entry")
            .params;
        assert!(crate::control::params::validate(schema, &json!({})).is_err());
        assert!(crate::control::params::validate(
            schema,
            &json!({ "html": "<p>ok</p>", "width": 240 })
        )
        .is_ok());
        assert!(crate::control::params::validate(
            schema,
            &json!({ "html": "<p>ok</p>", "width": 1601 })
        )
        .is_err());
        assert!(!html_fits_limit(&"界".repeat(MAX_HTML_BYTES / 2 + 1)));
    }

    fn url_encode(value: &str) -> String {
        value
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                    (byte as char).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect()
    }
}
