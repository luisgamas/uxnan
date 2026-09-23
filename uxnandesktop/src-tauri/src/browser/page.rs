//! The channel to a page's agent script (`page.js`).
//!
//! The script is injected into every main-frame document before the page's own
//! code runs, and exposes one frozen function taking a small request (`op` +
//! arguments) and returning one JSON string. The backend reaches it only
//! through the engine's own script evaluation, so the page has no way to call
//! the app: nothing is exposed to it, and nothing it returns is trusted beyond
//! being size-capped, parsed and read field by field.

use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

use super::host;
use crate::error::CommandError;

/// The script injected into every page.
pub const SCRIPT: &str = include_str!("page.js");

/// The largest answer a page may give (a snapshot is capped well below this
/// by the script itself; a page that returns more is refused, not truncated).
const MAX_ANSWER: usize = 512 * 1024;

/// How long a page may take to answer a request.
pub const TIMEOUT: Duration = Duration::from_secs(5);

/// The JavaScript that runs `request` through the page script.
fn program(request: &Value) -> String {
    // `request` is serialized JSON, which is a valid JavaScript expression:
    // nothing the caller sent can escape the argument position.
    format!(
        "(()=>{{const p=window.__uxnanPage;return p?p.call({request}):null}})()",
        request = request
    )
}

/// Read a page's answer: the JSON string the script returned. A page whose
/// script is missing (still on its first empty document, or navigating) and a
/// page that says `error` both come back as errors.
fn answer(raw: Value) -> Result<Value, CommandError> {
    let text = match raw {
        Value::String(s) => s,
        Value::Null => {
            return Err(CommandError::new(
                "BROWSER_NOT_READY",
                "the page is not ready yet (still loading, or navigating) — try again",
            ))
        }
        _ => {
            return Err(CommandError::new(
                "BROWSER_BAD_ANSWER",
                "the page answered in an unexpected shape",
            ))
        }
    };
    if text.len() > MAX_ANSWER {
        return Err(CommandError::new(
            "BROWSER_BAD_ANSWER",
            "the page answered with more than the allowed size",
        ));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        CommandError::new("BROWSER_BAD_ANSWER", "the page answered with invalid JSON")
    })?;
    if let Some(code) = value.get("error").and_then(|v| v.as_str()) {
        let message = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("the page refused the request")
            .chars()
            .take(300)
            .collect::<String>();
        let code: String = code
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(24)
            .collect::<String>()
            .replace('-', "_")
            .to_ascii_uppercase();
        return Err(CommandError::new(format!("BROWSER_PAGE_{code}"), message));
    }
    Ok(value)
}

/// Send `request` to the page of `workspace` and return its answer.
pub async fn call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace: &str,
    request: Value,
) -> Result<Value, CommandError> {
    let webview = host::webview(app, workspace)?;
    let raw = host::eval_json(&webview, &program(&request), TIMEOUT).await?;
    answer(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_request_stays_a_literal() {
        let js = program(&json!({ "op": "type", "text": "\"});alert(1);({\"" }));
        assert!(js.starts_with("(()=>{const p=window.__uxnanPage;return p?p.call({"));
        assert!(js.contains(r#""text":"\"});alert(1);({\"""#));
    }

    #[test]
    fn a_missing_script_is_not_ready() {
        assert_eq!(answer(Value::Null).unwrap_err().code, "BROWSER_NOT_READY");
    }

    #[test]
    fn a_page_error_keeps_a_safe_code() {
        let e = answer(json!(
            r#"{"error":"stale","message":"take a new snapshot"}"#
        ))
        .unwrap_err();
        assert_eq!(e.code, "BROWSER_PAGE_STALE");
        let e = answer(json!(r#"{"error":"<script>x</script>","message":"m"}"#)).unwrap_err();
        assert_eq!(e.code, "BROWSER_PAGE_SCRIPTXSCRIPT");
    }

    #[test]
    fn oversized_and_malformed_answers_are_refused() {
        let big = format!("\"{}\"", "x".repeat(MAX_ANSWER + 1));
        assert_eq!(answer(json!(big)).unwrap_err().code, "BROWSER_BAD_ANSWER");
        assert_eq!(
            answer(json!("{not json")).unwrap_err().code,
            "BROWSER_BAD_ANSWER"
        );
        assert_eq!(answer(json!(42)).unwrap_err().code, "BROWSER_BAD_ANSWER");
    }

    #[test]
    fn a_good_answer_is_parsed() {
        let v = answer(json!(r#"{"ok":true,"effect":"none"}"#)).unwrap();
        assert_eq!(v["effect"], "none");
    }

    #[test]
    fn the_script_exposes_one_frozen_entry_point() {
        assert!(SCRIPT.contains("O.defineProperty(W, KEY"));
        assert!(SCRIPT.contains("configurable: false"));
        assert!(!SCRIPT.contains("eval("));
        assert!(!SCRIPT.contains("Function("));
    }
}
