//! The audit line every mutation of the `create` group (and, later, `converse`)
//! leaves behind: who asked for what, and whether it happened.
//!
//! `control-audit.log` under the app's data directory, one JSON object per
//! line, appended, rotated once to `control-audit.log.1` past 1 MiB. It is what
//! makes it defensible that an agent can create worktrees and launch agents:
//! the person can read afterwards what was done in their name. No prompt text
//! is written — only its length — and never a token.

use std::io::Write;
use std::path::Path;

use serde_json::{json, Value};

use super::Caller;

pub const FILE_NAME: &str = "control-audit.log";
const ROTATE_AT: u64 = 1024 * 1024;

/// A copy of `params` with the fields that may carry free text reduced to
/// their length, so the log records *that* something was sent (or typed into a
/// browser page), not what.
pub fn redact(params: &Value) -> Value {
    let mut out = params.clone();
    if let Some(obj) = out.as_object_mut() {
        for field in ["prompt", "message", "text"] {
            if let Some(v) = obj.get(field).and_then(|v| v.as_str()) {
                let n = v.len();
                obj.insert(field.to_string(), json!({ "bytes": n }));
            }
        }
    }
    out
}

/// One line, built by the dispatcher after the service answered.
pub fn line(
    caller: &Caller,
    method: &str,
    params: &Value,
    outcome: &Result<Value, String>,
) -> Value {
    let caller = match caller {
        Caller::Launch { agent_id } => json!({ "kind": "launch", "terminalId": agent_id }),
        Caller::Control => json!({ "kind": "control" }),
        Caller::Bridge { cwd } => json!({ "kind": "bridge", "cwd": cwd }),
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut v = json!({
        "ts": ts,
        "caller": caller,
        "method": method,
        "params": redact(params),
    });
    match outcome {
        Ok(result) => {
            v["ok"] = json!(true);
            if let Some(id) = result.get("requestId") {
                v["requestId"] = id.clone();
            }
        }
        Err(message) => {
            v["ok"] = json!(false);
            v["error"] = json!(message);
        }
    }
    v
}

/// Append `entry` to the log under `data_dir`, rotating first when it is past
/// the cap. Best-effort: a log that cannot be written must not fail the call
/// it records (the person would then lose the action *and* the record).
pub fn append(data_dir: &Path, entry: &Value) {
    let path = data_dir.join(FILE_NAME);
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > ROTATE_AT {
            let _ = std::fs::rename(&path, data_dir.join(format!("{FILE_NAME}.1")));
        }
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    else {
        return;
    };
    if let Ok(text) = serde_json::to_string(entry) {
        let _ = writeln!(file, "{text}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_text_is_reduced_to_its_length() {
        let p = json!({ "branch": "feat/x", "prompt": "do the thing", "idempotencyKey": "k" });
        let r = redact(&p);
        assert_eq!(r["branch"], "feat/x");
        assert_eq!(r["prompt"], json!({ "bytes": 12 }));
        assert_eq!(r["idempotencyKey"], "k");
    }

    #[test]
    fn a_line_records_the_caller_the_outcome_and_the_receipt_id() {
        let ok = line(
            &Caller::Launch {
                agent_id: Some("t1".into()),
            },
            "worktree/create",
            &json!({ "branch": "b" }),
            &Ok(json!({ "requestId": "r1" })),
        );
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["requestId"], "r1");
        assert_eq!(ok["caller"]["terminalId"], "t1");
        assert!(ok["ts"].as_u64().unwrap() > 0);
        let err = line(
            &Caller::Control,
            "run/start",
            &json!({}),
            &Err("nope".into()),
        );
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"], "nope");
        assert_eq!(err["caller"]["kind"], "control");
    }

    #[test]
    fn appends_lines_and_rotates_once_past_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), &json!({ "n": 1 }));
        append(dir.path(), &json!({ "n": 2 }));
        let text = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert_eq!(text.lines().count(), 2);
        // Push it past the cap and append again: the old log moves aside.
        let big = "x".repeat((ROTATE_AT + 1) as usize);
        std::fs::write(dir.path().join(FILE_NAME), big).unwrap();
        append(dir.path(), &json!({ "n": 3 }));
        assert!(dir.path().join(format!("{FILE_NAME}.1")).exists());
        let fresh = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert_eq!(fresh.lines().count(), 1);
    }
}
