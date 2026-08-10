//! MCP config injection — makes the browser MCP server (`mcp.rs`) **discoverable**
//! to the CLI agents the ADE launches, so they get the `browser_*` tools with zero
//! setup and zero documentation.
//!
//! ## The idea
//! `mcp.rs` serves the tools; this module writes each agent CLI's own native MCP
//! config so the agent finds that server on startup. The endpoint is the local
//! hook server's `/mcp` route; the **token is never written to a file** — every
//! config references the `UXNAN_MCP_TOKEN` environment variable (injected into the
//! agent's terminal in `commands.rs`), so the secret stays in the process env.
//!
//! ## Modes (see [`crate::model::McpInjection`])
//! - **Managed** (default): write into each CLI's **user-global** config only —
//!   never the project working directory. User-global config is not
//!   project-approval-gated, so there's no "approve this MCP server?" prompt and
//!   nothing lands in the user's project folder. Hand-typed agents in any folder
//!   still discover the server (every CLI reads its user config). When
//!   [`crate::model::BrowserSettings::friction_free`] is on, app-launched agents
//!   also get first-party trust-skip flags/seeds (see [`launch_args`] and the Codex
//!   per-folder trust seed in [`prepare`]).
//! - **Global**: identical user-global config write, but the frictionless
//!   trust-skip is not applied (the CLIs' own trust prompts stay intact).
//! - **Off**: inject nothing (the user can wire it by hand — the Settings panel
//!   shows a copy-paste snippet).
//!
//! The legacy **Workspace** mode (a project-scoped config in the working directory)
//! was removed: it was the sole source of both the project-dir files and the
//! project-approval prompts.
//!
//! ## Per-agent config (this is the extension point)
//! Each supported agent is one [`McpAgent`] row in [`AGENTS`]. To support a **new**
//! agent (e.g. Cursor, amp), add a row and a match arm in [`config_path`] +
//! [`write_entry`] describing where its user-global MCP config lives and its
//! shape — nothing else changes. Current rows:
//!
//! | Agent | User-global file | Shape |
//! |-------|------------------|-------|
//! | Claude Code | `~/.claude.json` | `mcpServers.<n> {type:http,url,headers}` |
//! | Codex | `~/.codex/config.toml` | `[mcp_servers.<n>] url + bearer_token_env_var` |
//! | OpenCode | `~/.config/opencode/opencode.json` | `mcp.<n> {type:remote,url,headers,enabled}` |
//! | Grok | `~/.grok/config.toml` | `[mcp_servers.<n>] url + headers` (`${VAR}` expanded) |
//! | Qwen Code | `~/.qwen/settings.json` | `mcpServers.<n> {httpUrl,trust,headers}` (Gemini's shape, which it forked) |
//! | Droid | `~/.factory/mcp.json` | `mcpServers.<n> {type:http,url,headers}` (`${VAR}` expanded) |
//! | MiMo Code | `~/.config/mimocode/mimocode.json` | `mcp.<n> {type:remote,url,headers,enabled}` (OpenCode's shape, which it forked) |
//!
//! ## Why some agents are not offered
//! **The bearer token is never written to a file.** Every row above references
//! `UXNAN_MCP_TOKEN` in the agent's own expansion syntax, which is also what makes
//! the server useless outside uxnan: no variable, no credential, no connection —
//! and the config itself is removed on exit. An agent that cannot express that
//! reference cannot be supported without leaving a live secret in a file the user
//! keeps, so it is left out and said so:
//!
//! - **Cursor** — `~/.cursor/mcp.json` takes remote servers with headers, but
//!   `${env:VAR}` is **not expanded in headers for remote servers** (it is for
//!   stdio ones), so the literal string would be sent as the credential.
//! - **GitHub Copilot** — `~/.copilot/mcp-config.json` documents header values as
//!   literal strings; no environment reference is specified for the CLI.
//! - **Antigravity** — its remote MCP transport is SSE with only a `serverUrl`
//!   (no header field), and our endpoint is Streamable HTTP rather than SSE.
//! - **Goose** — keeps extensions in YAML (`~/.config/goose/config.yaml`), and no
//!   YAML writer is vendored; merging into a user's YAML by hand is how comments
//!   and formatting get destroyed.
//! - **Kilo Code** — its config is JSONC; parsing it with a JSON reader would
//!   throw away the user's comments on write.
//!
//! See `FOR-DEV.md` → *Integrated developer browser*.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::model::McpInjection;
use crate::state::AppState;

/// The MCP server name every agent config registers us under (its tools appear
/// prefixed with this, e.g. `mcp__uxnan-browser__browser_open`).
pub const SERVER_NAME: &str = "uxnan-browser";
/// Environment variable the injected configs read the bearer token from, so the
/// token itself is never written to a config file.
pub const TOKEN_ENV: &str = "UXNAN_MCP_TOKEN";

/// One agent the ADE can auto-configure to reach the browser MCP server.
#[derive(Debug, Clone, Copy)]
pub struct McpAgent {
    /// Stable id used in `mcpDisabledAgents` + the Settings toggles.
    pub id: &'static str,
    /// Human-readable name for the UI.
    pub label: &'static str,
}

/// Serializable view of a supported agent for the Settings → Browser panel (the
/// per-agent injection toggles + the "which agents" list in the copy-paste help).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub label: String,
}

/// The supported-agent catalog for the frontend (Settings panel + docs).
pub fn agent_infos() -> Vec<AgentInfo> {
    AGENTS
        .iter()
        .map(|a| AgentInfo {
            id: a.id.to_string(),
            label: a.label.to_string(),
        })
        .collect()
}

/// The agents we currently know how to configure. Add a row here (plus a match arm
/// in [`config_path`] and [`write_entry`]) to support a new agent.
pub const AGENTS: &[McpAgent] = &[
    McpAgent {
        id: "claude",
        label: "Claude Code",
    },
    McpAgent {
        id: "codex",
        label: "Codex",
    },
    McpAgent {
        id: "opencode",
        label: "OpenCode",
    },
    McpAgent {
        id: "grok",
        label: "Grok",
    },
    McpAgent {
        id: "qwen",
        label: "Qwen Code",
    },
    McpAgent {
        id: "droid",
        label: "Droid",
    },
    McpAgent {
        id: "mimo",
        label: "MiMo Code",
    },
];

/// A config file we wrote, recorded so it can be undone on exit.
#[derive(Debug, Clone)]
pub struct Written {
    /// Absolute path of the config file.
    pub path: PathBuf,
    /// Agent id (selects the cleanup format).
    pub agent: String,
    /// True if we created the file (so cleanup may delete it when left empty).
    pub created: bool,
    /// The endpoint we wrote. Cleanup checks the file still names it before
    /// removing anything: a SECOND uxnan window overwrites the same entry with
    /// its own port, and the first one exiting must not take the live window's
    /// config with it.
    pub endpoint: String,
}

/// Turn the hook server's `…/hook` URL into its `…/mcp` sibling (the MCP endpoint).
pub fn mcp_endpoint(hook_url: &str) -> String {
    hook_url.replacen("/hook", "/mcp", 1)
}

/// The user-global MCP config file path for `agent`, given the user's `home`.
/// `None` for an unknown agent. (Project-scoped paths were removed with the
/// `Workspace` mode — see the module docs.)
fn config_path(agent: &str, home: &Path) -> Option<PathBuf> {
    match agent {
        "claude" => Some(home.join(".claude.json")),
        "codex" => Some(home.join(".codex").join("config.toml")),
        "opencode" => Some(home.join(".config").join("opencode").join("opencode.json")),
        "grok" => Some(home.join(".grok").join("config.toml")),
        // Qwen Code descends from the Gemini CLI and kept its settings file.
        "qwen" => Some(home.join(".qwen").join("settings.json")),
        // Droid keeps MCP in a file of its own, beside its settings.
        "droid" => Some(home.join(".factory").join("mcp.json")),
        // MiMo Code is a fork of OpenCode with its own config name.
        "mimo" => Some(home.join(".config").join("mimocode").join("mimocode.json")),
        _ => None,
    }
}

/// Whether `agent` keeps its MCP config in TOML (Codex, Grok) rather than JSON —
/// the two branches differ in how a file is parsed, merged and undone.
fn is_toml_agent(agent: &str) -> bool {
    matches!(agent, "codex" | "grok")
}

/// The JSON entry (server definition) for a JSON-config agent. `None` for the
/// TOML agents (handled separately).
fn json_entry(agent: &str, endpoint: &str) -> Option<(Vec<&'static str>, Value)> {
    // Token is referenced by env, never inlined — each CLI's own expansion syntax.
    let bearer_dollar = format!("Bearer ${{{TOKEN_ENV}}}"); // ${UXNAN_MCP_TOKEN}
    let bearer_brace = format!("Bearer {{env:{TOKEN_ENV}}}"); // {env:UXNAN_MCP_TOKEN}
    match agent {
        "claude" => Some((
            vec!["mcpServers", SERVER_NAME],
            json!({ "type": "http", "url": endpoint, "headers": { "Authorization": bearer_dollar } }),
        )),
        // MiMo Code is a fork of OpenCode, config shape included.
        "opencode" | "mimo" => Some((
            vec!["mcp", SERVER_NAME],
            json!({ "type": "remote", "url": endpoint, "enabled": true, "headers": { "Authorization": bearer_brace } }),
        )),
        // Qwen Code inherited Gemini's settings shape, `trust` included.
        "qwen" => Some((
            vec!["mcpServers", SERVER_NAME],
            json!({ "httpUrl": endpoint, "trust": true, "headers": { "Authorization": bearer_dollar } }),
        )),
        // Droid expands `${VAR}` in header values and, when the variable is
        // unset, fails the connection naming it — which is exactly the behavior
        // we want outside uxnan: no token in the file, and no silent attempt.
        "droid" => Some((
            vec!["mcpServers", SERVER_NAME],
            json!({ "type": "http", "url": endpoint, "headers": { "Authorization": bearer_dollar } }),
        )),
        _ => None,
    }
}

// --- File format helpers (pure, unit-tested) -------------------------------

/// Set a nested key in a JSON document (creating intermediate objects), returning
/// the updated document. Overwrites only the leaf at `pointer` — the user's other
/// keys are preserved.
fn json_set(mut doc: Value, pointer: &[&str], entry: Value) -> Value {
    if !doc.is_object() {
        doc = json!({});
    }
    fn set(node: &mut Value, pointer: &[&str], entry: Value) {
        match pointer {
            [] => {}
            [last] => {
                node[*last] = entry;
            }
            [head, rest @ ..] => {
                if !node[*head].is_object() {
                    node[*head] = json!({});
                }
                set(&mut node[*head], rest, entry);
            }
        }
    }
    set(&mut doc, pointer, entry);
    doc
}

/// Remove a nested key from a JSON document, pruning now-empty parent objects.
/// Returns the updated document (which may be an empty object).
fn json_remove(mut doc: Value, pointer: &[&str]) -> Value {
    fn remove(node: &mut Value, pointer: &[&str]) {
        match pointer {
            [] => {}
            [last] => {
                if let Some(obj) = node.as_object_mut() {
                    obj.remove(*last);
                }
            }
            [head, rest @ ..] => {
                if node.get(*head).is_some() {
                    remove(&mut node[*head], rest);
                    // Prune an emptied parent object.
                    if node[*head]
                        .as_object()
                        .map(|o| o.is_empty())
                        .unwrap_or(false)
                    {
                        if let Some(obj) = node.as_object_mut() {
                            obj.remove(*head);
                        }
                    }
                }
            }
        }
    }
    remove(&mut doc, pointer);
    doc
}

/// Merge (or remove) our Codex server in a `config.toml`, preserving the user's
/// other settings and formatting. `endpoint = Some` inserts; `None` removes.
fn toml_mcp(agent: &str, existing: &str, endpoint: Option<&str>) -> String {
    let mut doc = existing
        .parse::<toml_edit::DocumentMut>()
        .unwrap_or_default();
    match endpoint {
        Some(url) => {
            // Ensure `mcp_servers` is a real (header) table, then add our server as
            // a `[mcp_servers.<name>]` sub-table. Existing servers/keys are kept.
            if !doc
                .get("mcp_servers")
                .map(|i| i.is_table())
                .unwrap_or(false)
            {
                doc["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
            }
            let mut entry = toml_edit::Table::new();
            entry["url"] = toml_edit::value(url);
            if agent == "grok" {
                // Grok has no `bearer_token_env_var`, but it *does* expand `${VAR}`
                // in `url`, `headers` and `env` at load time — so the header can
                // name the variable and the token still never lands in the file.
                let mut headers = toml_edit::InlineTable::new();
                headers.insert(
                    "Authorization",
                    toml_edit::Value::from(format!("Bearer ${{{TOKEN_ENV}}}")),
                );
                entry["headers"] = toml_edit::value(headers);
            } else {
                entry["bearer_token_env_var"] = toml_edit::value(TOKEN_ENV);
            }
            if let Some(servers) = doc["mcp_servers"].as_table_mut() {
                servers.insert(SERVER_NAME, toml_edit::Item::Table(entry));
            }
        }
        None => {
            // Remove our entry whether `mcp_servers` is a header table or an inline
            // table, pruning it if it becomes empty.
            let emptied = if let Some(t) = doc.get_mut("mcp_servers").and_then(|i| i.as_table_mut())
            {
                t.remove(SERVER_NAME);
                t.is_empty()
            } else if let Some(t) = doc
                .get_mut("mcp_servers")
                .and_then(|i| i.as_inline_table_mut())
            {
                t.remove(SERVER_NAME);
                t.is_empty()
            } else {
                false
            };
            if emptied {
                doc.as_table_mut().remove("mcp_servers");
            }
        }
    }
    doc.to_string()
}

/// True if `text` parses as valid TOML, so [`toml_mcp`] can merge into it
/// without discarding the user's content. Gates the TOML config writes (Codex
/// and Grok) on parse success: a malformed `config.toml` is left untouched rather
/// than rebuilt from an empty document (which would clobber the user's settings).
/// Mirrors the JSON branch's parse-failure skip semantics.
fn toml_parses(text: &str) -> bool {
    text.parse::<toml_edit::DocumentMut>().is_ok()
}

// --- Injection + cleanup ---------------------------------------------------

/// Write `agent`'s user-global config so it points at the browser MCP server,
/// recording the write for later cleanup. Merges into an existing file (never
/// clobbers other keys). Writes are atomic (sibling temp + rename + rolling
/// `.bak`). If an existing config can't be read or parsed, the agent is
/// skipped — the file is never overwritten with a stub. Best-effort: I/O errors
/// are ignored (a failed injection just means that agent won't see the tools).
fn write_entry(agent: &str, path: &Path, endpoint: &str) -> Option<Written> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let existed = path.exists();

    if is_toml_agent(agent) {
        // File missing → start from an empty document. File present but
        // unreadable or unparseable → skip (never rebuild from an empty doc,
        // which would discard the user's TOML).
        let existing = if !existed {
            String::new()
        } else {
            match std::fs::read_to_string(path) {
                Ok(s) if toml_parses(&s) => s,
                _ => return None,
            }
        };
        let merged = toml_mcp(agent, &existing, Some(endpoint));
        crate::agent_hooks::write_text_atomic(path, &merged).ok()?;
    } else {
        let (pointer, entry) = json_entry(agent, endpoint)?;
        // File missing → start from `{}`. File present but unreadable or
        // unparseable → skip (never overwrite with a one-key stub).
        let current: Value = if !existed {
            json!({})
        } else {
            match std::fs::read_to_string(path) {
                Ok(s) => match serde_json::from_str(&s) {
                    Ok(v) => v,
                    Err(_) => return None,
                },
                Err(_) => return None,
            }
        };
        let merged = json_set(current, &pointer, entry);
        let text = format!("{}\n", serde_json::to_string_pretty(&merged).ok()?);
        crate::agent_hooks::write_json_atomic(path, &text).ok()?;
    }

    Some(Written {
        path: path.to_path_buf(),
        agent: agent.to_string(),
        created: !existed,
        endpoint: endpoint.to_string(),
    })
}

/// Undo one injected config: remove our server entry, deleting the file only if we
/// created it and it's now empty. Writes are atomic (sibling temp + rename +
/// rolling `.bak`). If the file can't be read or parsed, it is left untouched
/// (never overwritten). Best-effort.
fn undo_entry(w: &Written) {
    let Ok(text) = std::fs::read_to_string(&w.path) else {
        return; // unreadable → do nothing
    };
    // Only undo an entry that is still OURS. With two uxnan windows open, the
    // second one rewrites this same entry with its own port; the first one
    // exiting would otherwise delete the live window's config and leave its
    // agents with no browser tools. The endpoint carries the port, so it
    // identifies the writer.
    if !w.endpoint.is_empty() && !text.contains(&w.endpoint) {
        return;
    }
    if is_toml_agent(&w.agent) {
        if !toml_parses(&text) {
            return; // unparseable → leave untouched
        }
        let stripped = toml_mcp(&w.agent, &text, None);
        if w.created && stripped.trim().is_empty() {
            let _ = std::fs::remove_file(&w.path);
        } else {
            let _ = crate::agent_hooks::write_text_atomic(&w.path, &stripped);
        }
        return;
    }
    let Some((pointer, _)) = json_entry(&w.agent, "") else {
        return;
    };
    let doc: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return, // unparseable → leave untouched
    };
    let stripped = json_remove(doc, &pointer);
    let empty = stripped.as_object().map(|o| o.is_empty()).unwrap_or(false);
    if w.created && empty {
        let _ = std::fs::remove_file(&w.path);
    } else if let Ok(s) = serde_json::to_string_pretty(&stripped) {
        let _ = crate::agent_hooks::write_json_atomic(&w.path, &format!("{s}\n"));
    }
}

/// Ensure every enabled agent's **user-global** config points at the browser MCP
/// server. The config write is deduplicated on `"global"` so it runs once per
/// session; the frictionless Codex per-folder trust seed is deduplicated per `cwd`
/// (it varies by working directory). Called from `pty_create` before an agent
/// starts.
pub async fn prepare(app: &AppHandle, cwd: &str) {
    let (enabled, mode, friction_free, disabled) = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (
            b.mcp_enabled,
            b.mcp_injection,
            b.friction_free,
            b.mcp_disabled_agents.clone(),
        )
    };
    if !enabled || mode == McpInjection::Off {
        return;
    }
    let endpoint = {
        let state = app.state::<AppState>();
        let hook = state.hook.read().await.clone();
        match hook {
            Some(h) => mcp_endpoint(&h.url),
            None => return,
        }
    };
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(_) => return,
    };
    let disabled: HashSet<&str> = disabled.iter().map(String::as_str).collect();

    // Frictionless (managed mode only): pre-seed Codex per-folder trust so Codex
    // doesn't prompt to trust this working directory when launched here. Per-cwd,
    // so it's deduped on the cwd — independent of the once-per-session config write
    // below. Best-effort: a path-format mismatch just leaves Codex's normal prompt.
    if mode == McpInjection::Managed
        && friction_free
        && !disabled.contains("codex")
        && !cwd.trim().is_empty()
    {
        let seed = {
            let state = app.state::<AppState>();
            let mut prepared = state.mcp_prepared.lock().unwrap();
            prepared.insert(format!("codextrust:{cwd}"))
        };
        if seed {
            let cfg = home.join(".codex").join("config.toml");
            let _ = crate::codex_trust::ensure_project_trust(&cfg, Path::new(cwd));
        }
    }

    // User-global MCP config write — once per session.
    {
        let state = app.state::<AppState>();
        let mut prepared = state.mcp_prepared.lock().unwrap();
        if !prepared.insert("global".to_string()) {
            return; // already written this session
        }
    }
    let mut writes = Vec::new();
    for agent in AGENTS {
        if disabled.contains(agent.id) {
            continue;
        }
        if let Some(path) = config_path(agent.id, &home) {
            if let Some(w) = write_entry(agent.id, &path, &endpoint) {
                writes.push(w);
            }
        }
    }
    if !writes.is_empty() {
        let state = app.state::<AppState>();
        state.mcp_written.lock().unwrap().extend(writes);
    }
}

/// Remove every injected config (called on app exit). Best-effort so shutdown is
/// never blocked; leftover entries are harmless (a stale local endpoint just fails
/// to connect) and are overwritten with the live one next launch.
pub fn cleanup(app: &AppHandle) {
    let state = app.state::<AppState>();
    let written = {
        let mut guard = state.mcp_written.lock().unwrap();
        std::mem::take(&mut *guard)
    };
    for w in &written {
        undo_entry(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_rewrites_hook_to_mcp() {
        assert_eq!(
            mcp_endpoint("http://127.0.0.1:5123/hook"),
            "http://127.0.0.1:5123/mcp"
        );
    }

    #[test]
    fn json_set_creates_nested_and_preserves_siblings() {
        let doc = json!({ "existing": { "keep": true } });
        let out = json_set(doc, &["mcpServers", "uxnan-browser"], json!({ "url": "x" }));
        assert_eq!(out["existing"]["keep"], true);
        assert_eq!(out["mcpServers"]["uxnan-browser"]["url"], "x");
    }

    #[test]
    fn json_remove_prunes_empty_parents_but_keeps_others() {
        let doc = json!({ "mcpServers": { "uxnan-browser": { "url": "x" } }, "other": 1 });
        let out = json_remove(doc, &["mcpServers", "uxnan-browser"]);
        assert!(out.get("mcpServers").is_none()); // pruned (was only child)
        assert_eq!(out["other"], 1);

        let doc2 = json!({ "mcpServers": { "uxnan-browser": {}, "keep": {} } });
        let out2 = json_remove(doc2, &["mcpServers", "uxnan-browser"]);
        assert!(out2["mcpServers"].get("uxnan-browser").is_none());
        assert!(out2["mcpServers"].get("keep").is_some()); // sibling stays
    }

    #[test]
    fn json_entry_never_inlines_the_token() {
        // Every offered agent, so a newly added row cannot skip the rule: the
        // token is referenced through the environment, never written to a file
        // the user keeps. It is also what makes the server useless outside
        // uxnan — no variable, no credential, no connection.
        for agent in AGENTS.iter().filter(|a| !is_toml_agent(a.id)) {
            let (_, entry) = json_entry(agent.id, "http://x/mcp")
                .unwrap_or_else(|| panic!("{} is offered but has no JSON entry", agent.id));
            let s = entry.to_string();
            assert!(s.contains("Authorization"), "{} sends no auth", agent.id);
            assert!(
                s.contains("UXNAN_MCP_TOKEN"),
                "{} does not reference the token env var",
                agent.id
            );
            assert!(
                !s.contains("Bearer secret"),
                "{} looks like it inlines a secret",
                agent.id
            );
        }
    }

    #[test]
    fn every_offered_agent_has_a_user_global_config_path() {
        // An agent in the list with no path would be offered in Settings and
        // then silently do nothing.
        let home = Path::new("/home/u");
        for agent in AGENTS {
            let path = config_path(agent.id, home)
                .unwrap_or_else(|| panic!("{} is offered but has no config path", agent.id));
            assert!(
                path.starts_with(home),
                "{} writes outside the user's home: {}",
                agent.id,
                path.display()
            );
        }
    }

    #[test]
    fn toml_codex_inserts_and_removes_without_clobbering() {
        let existing = "model = \"o3\"\n\n[some.other]\nk = 1\n";
        let with = toml_mcp("codex", existing, Some("http://127.0.0.1:9/mcp"));
        // Verify the structure by re-parsing (robust to header formatting).
        let doc = with.parse::<toml_edit::DocumentMut>().unwrap();
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["url"].as_str(),
            Some("http://127.0.0.1:9/mcp")
        );
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["bearer_token_env_var"].as_str(),
            Some("UXNAN_MCP_TOKEN")
        );
        assert!(with.contains("model = \"o3\"")); // user's settings preserved
        assert!(with.contains("[some.other]"));

        let without = toml_mcp("codex", &with, None);
        assert!(!without.contains("uxnan-browser"));
        assert!(without.contains("model = \"o3\"")); // still preserved
    }

    #[test]
    fn config_path_maps_each_agent_to_user_global() {
        let home = Path::new("/home/u");
        assert_eq!(
            config_path("claude", home).unwrap(),
            home.join(".claude.json")
        );
        assert_eq!(
            config_path("codex", home).unwrap(),
            home.join(".codex").join("config.toml")
        );
        assert_eq!(
            config_path("opencode", home).unwrap(),
            home.join(".config").join("opencode").join("opencode.json")
        );
        assert!(config_path("unknown", home).is_none());
    }

    // --- Regression tests: atomic + never-clobber writes --------------------
    //
    // Injecting our MCP entry rewrites a config file the *agent* owns, so the
    // bar is that nothing else in it can be lost: unrelated top-level keys and
    // sibling servers survive, and a failed write never leaves a truncated file
    // behind.

    #[test]
    fn write_entry_preserves_unrelated_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        let seed = r#"{
  "topLevel": "keep-me",
  "mcpServers": {
    "existing": { "url": "http://x" }
  }
}"#;
        std::fs::write(&path, seed).unwrap();

        let w = write_entry("claude", &path, "http://127.0.0.1:9/mcp");
        let w = w.expect("valid existing config should be merged");
        assert!(!w.created); // file already existed

        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(doc["topLevel"], "keep-me"); // unrelated top-level key kept
        assert_eq!(doc["mcpServers"]["existing"]["url"], "http://x"); // sibling server kept
        assert_eq!(
            doc["mcpServers"][SERVER_NAME]["url"],
            "http://127.0.0.1:9/mcp"
        ); // injected
    }

    #[test]
    fn write_entry_skips_unparseable_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        let broken = "{ \"unterminated\":"; // truncated object → invalid JSON
        std::fs::write(&path, broken).unwrap();

        let w = write_entry("claude", &path, "http://127.0.0.1:9/mcp");
        assert!(
            w.is_none(),
            "unparseable config must be skipped, not stubbed"
        );

        // File bytes left untouched (never overwritten).
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
    }

    #[test]
    fn write_entry_skips_unreadable_existing() {
        // Cross-platform stand-in for "file exists but read fails": a directory
        // at the path makes `read_to_string` error while `exists()` is true.
        // (Permission-based unreadability is POSIX-flaky; this avoids it.)
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        std::fs::create_dir(&path).unwrap();

        let w = write_entry("claude", &path, "http://127.0.0.1:9/mcp");
        assert!(w.is_none(), "exists-but-unreadable config must be skipped");
        assert!(path.is_dir(), "no file should be written over the entry");
    }

    #[test]
    fn undo_entry_leaves_another_windows_config_alone() {
        // Two uxnan windows write this same entry; the second one's port is what
        // the file holds. The first window exiting must not delete the live
        // window's config — that would leave its agents with no browser tools
        // and no way back until the next launch.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        let live = json!({
            "mcpServers": {
                SERVER_NAME: { "type": "http", "url": "http://127.0.0.1:2222/mcp" },
                "someone-elses": { "url": "http://example/mcp" }
            }
        });
        std::fs::write(&path, live.to_string()).unwrap();

        undo_entry(&Written {
            path: path.clone(),
            agent: "claude".to_string(),
            created: false,
            // The FIRST window's endpoint — no longer what the file names.
            endpoint: "http://127.0.0.1:1111/mcp".to_string(),
        });

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            after["mcpServers"][SERVER_NAME]["url"],
            json!("http://127.0.0.1:2222/mcp"),
            "the live window's entry was removed by another window's cleanup"
        );

        // …and the window that DID write it still cleans up after itself.
        undo_entry(&Written {
            path: path.clone(),
            agent: "claude".to_string(),
            created: false,
            endpoint: "http://127.0.0.1:2222/mcp".to_string(),
        });
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(after["mcpServers"].get(SERVER_NAME).is_none());
        assert!(after["mcpServers"].get("someone-elses").is_some());
    }

    #[test]
    fn undo_entry_leaves_unparseable_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        let broken = "{ \"unterminated\":"; // invalid JSON
        std::fs::write(&path, broken).unwrap();

        let w = Written {
            path: path.clone(),
            agent: "claude".to_string(),
            created: false,
            endpoint: String::new(),
        };
        undo_entry(&w);

        // Bytes unchanged — never overwritten with a stub.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
    }

    #[test]
    fn write_entry_creates_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        assert!(!path.exists());

        let w = write_entry("claude", &path, "http://127.0.0.1:9/mcp")
            .expect("a missing config should be created");
        assert!(w.created); // we created it
        assert!(path.exists());

        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            doc["mcpServers"][SERVER_NAME]["url"],
            "http://127.0.0.1:9/mcp"
        );
    }

    #[test]
    fn write_entry_codex_preserves_unrelated_tables_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let seed = "model = \"o3\"\n\n[some.other]\nk = 1\n";
        std::fs::write(&path, seed).unwrap();

        let w = write_entry("codex", &path, "http://127.0.0.1:9/mcp")
            .expect("valid codex config should be merged");
        assert!(!w.created);

        let after = std::fs::read_to_string(&path).unwrap();
        let doc = after.parse::<toml_edit::DocumentMut>().unwrap();
        assert_eq!(doc["model"].as_str(), Some("o3")); // user's settings preserved
        assert_eq!(doc["some"]["other"]["k"].as_integer(), Some(1)); // unrelated table kept
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["url"].as_str(),
            Some("http://127.0.0.1:9/mcp")
        ); // injected

        // Cleanup removes only our entry; user's settings survive.
        undo_entry(&w);
        let cleaned = std::fs::read_to_string(&path).unwrap();
        let cdoc = cleaned.parse::<toml_edit::DocumentMut>().unwrap();
        let mcp_gone = cdoc
            .get("mcp_servers")
            .and_then(|m| m.as_table())
            .map(|t| t.is_empty())
            .unwrap_or(true);
        assert!(mcp_gone, "our mcp_servers entry must be removed");
        assert_eq!(cdoc["model"].as_str(), Some("o3"));
        assert_eq!(cdoc["some"]["other"]["k"].as_integer(), Some(1));
    }

    #[test]
    fn write_entry_codex_skips_unparseable_toml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let broken = "model = \"unterminated\n"; // invalid TOML (unterminated string)
        std::fs::write(&path, broken).unwrap();

        let w = write_entry("codex", &path, "http://127.0.0.1:9/mcp");
        assert!(w.is_none(), "unparseable codex config must be skipped");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken); // bytes unchanged
    }
}
