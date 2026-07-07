//! Codex hook trust — reproduce the `trusted_hash` Codex 0.129+ requires.
//!
//! Codex only runs a hook whose exact identity is trusted in
//! `~/.codex/config.toml` under `[hooks.state."<key>"]`. Without a matching
//! `trusted_hash` the hook sits in the "review required" pile and **never
//! fires**, so a status hook installed into `hooks.json` alone would silently
//! do nothing. Codex normally records this trust when the user runs `/hooks`
//! and approves; to make precise Codex states work out of the box, the ADE
//! reproduces the same hash and writes the trust entry itself.
//!
//! The hash is a SHA-256 over a **canonical JSON** "hook identity" object,
//! prefixed with `sha256:`. Canonical = every object key sorted ascending by
//! Unicode code unit, arrays in order, no whitespace — exactly what Codex's own
//! fingerprint routine produces. This is version-fragile by nature (it mirrors
//! Codex's internal format), so [`tests`] pins it to two known-good vectors; if
//! Codex ever changes the format those tests fail loudly rather than silently
//! shipping a hash Codex rejects.

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::AppError;

/// Codex's default hook timeout (seconds) when the `hooks.json` entry omits one.
/// We deliberately omit `timeout` from the entry and fold this default into the
/// hash, because our two known-good golden vectors were captured at the default —
/// hashing an explicit value we can't cross-check risks a mismatch that would make
/// Codex prompt for trust. The hook's own `curl` caps at 1.5 s, so this backstop
/// is never actually reached.
const CODEX_DEFAULT_TIMEOUT_SECS: u32 = 600;

/// The Codex events the ADE subscribes to, paired with their snake_case label
/// (Codex hashes/keys the label, not the PascalCase event name). Order matches
/// how they're written into `hooks.json`.
pub const CODEX_EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "session_start"),
    ("UserPromptSubmit", "user_prompt_submit"),
    ("PreToolUse", "pre_tool_use"),
    ("PermissionRequest", "permission_request"),
    ("PostToolUse", "post_tool_use"),
    ("Stop", "stop"),
];

/// Serialize a `&str` as a JSON string literal (with surrounding quotes and
/// JS-`JSON.stringify`-compatible escaping). `serde_json` matches that escaping
/// exactly, so the canonical bytes line up with Codex's.
fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

/// Build the canonical JSON for one hook identity, exactly as Codex fingerprints
/// it: a `{event_name, hooks:[handler], matcher?}` object with every key sorted.
///
/// Handler keys sort to `async, command, statusMessage?, timeout, type`; the
/// outer object to `event_name, hooks, matcher?`. `matcher`/`statusMessage` are
/// **omitted entirely** when absent (never serialized as `null`). Our managed
/// hooks always pass `async=false`, no `statusMessage` and no `matcher`.
fn canonical_identity(
    event_label: &str,
    command: &str,
    timeout_sec: u32,
    is_async: bool,
    status_message: Option<&str>,
    matcher: Option<&str>,
) -> String {
    let timeout = timeout_sec.max(1);
    let mut handler = format!(
        "{{\"async\":{},\"command\":{}",
        is_async,
        json_string(command)
    );
    if let Some(sm) = status_message {
        handler.push_str(&format!(",\"statusMessage\":{}", json_string(sm)));
    }
    handler.push_str(&format!(",\"timeout\":{},\"type\":\"command\"}}", timeout));

    let mut identity = format!(
        "{{\"event_name\":{},\"hooks\":[{}]",
        json_string(event_label),
        handler
    );
    if let Some(m) = matcher {
        identity.push_str(&format!(",\"matcher\":{}", json_string(m)));
    }
    identity.push('}');
    identity
}

/// Compute the `sha256:<hex>` trust hash for a hook identity.
fn compute_hash(
    event_label: &str,
    command: &str,
    timeout_sec: u32,
    is_async: bool,
    status_message: Option<&str>,
    matcher: Option<&str>,
) -> String {
    let serialized = canonical_identity(
        event_label,
        command,
        timeout_sec,
        is_async,
        status_message,
        matcher,
    );
    let digest = Sha256::digest(serialized.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

/// The trust hash for one of the ADE's managed Codex hooks (async=false, no
/// matcher, no statusMessage, and the default 600 s timeout — see
/// [`CODEX_DEFAULT_TIMEOUT_SECS`]; the `hooks.json` entry omits `timeout`).
pub fn managed_hash(event_label: &str, command: &str) -> String {
    compute_hash(
        event_label,
        command,
        CODEX_DEFAULT_TIMEOUT_SECS,
        false,
        None,
        None,
    )
}

/// Normalize a `hooks.json` path to the string Codex uses as the trust-key path
/// component: its native realpath form. On Windows that means backslashes and
/// **no** `\\?\` verbatim prefix (Codex stores the plain `C:\…` form). Falls
/// back to the input (lightly normalized) when the path can't be canonicalized.
fn canonical_trust_path(hooks_json: &Path) -> String {
    match std::fs::canonicalize(hooks_json) {
        Ok(p) => {
            let s = p.to_string_lossy().to_string();
            strip_verbatim_prefix(&s)
        }
        Err(_) => hooks_json.to_string_lossy().to_string(),
    }
}

/// Drop Windows' `\\?\` (and `\\?\UNC\`) verbatim-path prefix that
/// `fs::canonicalize` adds, which Codex never stores.
fn strip_verbatim_prefix(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    }
}

/// One trust key + hash the ADE must register in `config.toml`.
struct TrustEntry {
    key: String,
    hash: String,
}

/// Build every trust entry for the managed hooks in `hooks_json`, given the
/// command string written for each event. On Windows this emits **both**
/// separator variants of each key (backslash and forward-slash), because Codex
/// may expose the key with either depending on how it resolved the path.
fn trust_entries(hooks_json: &Path, event_commands: &[(&str, &str, String)]) -> Vec<TrustEntry> {
    let base_path = canonical_trust_path(hooks_json);
    let mut variants = vec![base_path.clone()];
    if cfg!(windows) {
        let fwd = base_path.replace('\\', "/");
        if fwd != base_path {
            variants.push(fwd);
        }
    }
    let mut out = Vec::new();
    for (_event, label, command) in event_commands {
        let hash = managed_hash(label, command);
        for path_variant in &variants {
            out.push(TrustEntry {
                key: format!("{path_variant}:{label}:0:0"),
                hash: hash.clone(),
            });
        }
    }
    out
}

/// Ensure `config.toml` trusts every managed hook declared for `hooks_json`.
///
/// `event_commands` is `(event_name, snake_label, command_string)` for each
/// managed hook, where `command_string` is the exact `command` written into
/// `hooks.json` (the hash covers it verbatim). Idempotent and format-preserving
/// (via `toml_edit`): existing unrelated keys, comments and layout are kept; a
/// user's explicit `enabled = false` for one of our keys is respected (left
/// untouched). Returns `Ok(())` even when nothing changed.
pub fn ensure_trust(
    config_path: &Path,
    hooks_json: &Path,
    event_commands: &[(&str, &str, String)],
) -> Result<(), AppError> {
    use toml_edit::{value, DocumentMut, Item, Table};

    let entries = trust_entries(hooks_json, event_commands);
    if entries.is_empty() {
        return Ok(());
    }

    let mut doc: DocumentMut = match std::fs::read_to_string(config_path) {
        Ok(s) => s.parse().unwrap_or_else(|_| DocumentMut::new()),
        Err(_) => DocumentMut::new(),
    };

    // Ensure `[hooks]` and `[hooks.state]` exist as tables.
    if !doc.contains_key("hooks") || !doc["hooks"].is_table() {
        doc["hooks"] = Item::Table(Table::new());
    }
    let hooks = doc["hooks"].as_table_mut().expect("hooks is a table");
    if !hooks.contains_key("state") || !hooks["state"].is_table() {
        hooks["state"] = Item::Table(Table::new());
    }
    let state = hooks["state"].as_table_mut().expect("state is a table");

    for entry in &entries {
        // Respect a user who explicitly disabled our hook.
        let user_disabled = state
            .get(&entry.key)
            .and_then(Item::as_table)
            .and_then(|t| t.get("enabled"))
            .and_then(|v| v.as_bool())
            .map(|enabled| !enabled)
            .unwrap_or(false);
        if user_disabled {
            continue;
        }
        let mut tbl = Table::new();
        tbl["enabled"] = value(true);
        tbl["trusted_hash"] = value(entry.hash.clone());
        state[&entry.key] = Item::Table(tbl);
    }

    let serialized = doc.to_string();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(config_path, serialized).map_err(AppError::Io)?;
    Ok(())
}

/// Remove every managed trust entry for `hooks_json` from `config.toml` (used on
/// uninstall). Best-effort and format-preserving; leaves the rest intact.
pub fn remove_trust(config_path: &Path, hooks_json: &Path) -> Result<(), AppError> {
    use toml_edit::DocumentMut;

    let text = match std::fs::read_to_string(config_path) {
        Ok(t) => t,
        Err(_) => return Ok(()),
    };
    let mut doc: DocumentMut = match text.parse() {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    let base_path = canonical_trust_path(hooks_json);
    let mut prefixes = vec![base_path.clone()];
    if cfg!(windows) {
        prefixes.push(base_path.replace('\\', "/"));
    }
    let Some(state) = doc
        .get_mut("hooks")
        .and_then(|h| h.get_mut("state"))
        .and_then(|s| s.as_table_mut())
    else {
        return Ok(());
    };
    let to_remove: Vec<String> = state
        .iter()
        .map(|(k, _)| k.to_string())
        .filter(|k| prefixes.iter().any(|p| k.starts_with(&format!("{p}:"))))
        .collect();
    for key in to_remove {
        state.remove(&key);
    }
    std::fs::write(config_path, doc.to_string()).map_err(AppError::Io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two vectors captured from real Codex approvals — if either fails, Codex's
    // fingerprint format changed and our trust writes would be silently ignored.
    #[test]
    fn canonical_identity_matches_known_serialization() {
        let a = canonical_identity(
            "pre_tool_use",
            "/bin/sh \"/tmp/orca-case-b-mCmCe6/agent-hooks/codex-hook.sh\"",
            600,
            false,
            None,
            None,
        );
        assert_eq!(
            a,
            r#"{"event_name":"pre_tool_use","hooks":[{"async":false,"command":"/bin/sh \"/tmp/orca-case-b-mCmCe6/agent-hooks/codex-hook.sh\"","timeout":600,"type":"command"}]}"#
        );
    }

    #[test]
    fn trusted_hash_matches_golden_vectors() {
        let a = compute_hash(
            "pre_tool_use",
            "/bin/sh \"/tmp/orca-case-b-mCmCe6/agent-hooks/codex-hook.sh\"",
            600,
            false,
            None,
            None,
        );
        assert_eq!(
            a,
            "sha256:bc013489dba495431d3790fda62ee5a7d907a7c491e29ad26238c3a5d6d2b163"
        );

        let b = compute_hash(
            "stop",
            "/home/user/.tma1/hooks/agent-hook.sh",
            600,
            false,
            None,
            None,
        );
        assert_eq!(
            b,
            "sha256:f8b48c31eabfba63f117b8570b839a5f6efc1d67867512d661775b5312df946f"
        );
    }

    #[test]
    fn key_sorting_places_matcher_and_status_correctly() {
        // With a matcher + statusMessage present, key order must stay canonical.
        let s = canonical_identity("pre_tool_use", "cmd", 10, true, Some("hi"), Some("*"));
        assert_eq!(
            s,
            r#"{"event_name":"pre_tool_use","hooks":[{"async":true,"command":"cmd","statusMessage":"hi","timeout":10,"type":"command"}],"matcher":"*"}"#
        );
    }

    #[test]
    fn strip_verbatim_prefix_handles_windows_forms() {
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\a\b"), r"C:\a\b");
        assert_eq!(strip_verbatim_prefix(r"\\?\UNC\srv\share"), r"\\srv\share");
        assert_eq!(strip_verbatim_prefix("/home/u/x"), "/home/u/x");
    }

    #[test]
    fn ensure_trust_writes_block_and_preserves_user_content() {
        let tmp = std::env::temp_dir().join(format!("uxnan-codextrust-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cfg = tmp.join("config.toml");
        let hooks = tmp.join("hooks.json");
        // hooks.json must exist so the trust-key path can be canonicalized.
        std::fs::write(&hooks, "{}").unwrap();
        std::fs::write(&cfg, "model = \"gpt-5-codex\"\n# keep my comment\n").unwrap();
        let cmd = "/bin/sh '/x/uxnan-codex-hook.sh'".to_string();
        let events: Vec<(&str, &str, String)> = CODEX_EVENTS
            .iter()
            .map(|(e, l)| (*e, *l, cmd.clone()))
            .collect();
        ensure_trust(&cfg, &hooks, &events).unwrap();
        let out = std::fs::read_to_string(&cfg).unwrap();
        assert!(out.contains("[hooks.state"), "trust table written");
        assert!(out.contains("trusted_hash = \"sha256:"), "hash written");
        assert!(out.contains("enabled = true"));
        assert!(
            out.contains("session_start:0:0"),
            "event label + indices in key"
        );
        assert!(
            out.contains("model = \"gpt-5-codex\""),
            "user content preserved"
        );
        // Second call must not error (idempotent write).
        ensure_trust(&cfg, &hooks, &events).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
