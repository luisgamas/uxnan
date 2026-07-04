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
//! - **Workspace** (default): write a project-scoped config into the terminal's
//!   working directory (auto-discovered by the CLI there), so both app-launched and
//!   hand-typed agents in that folder get the tools. Files we *create* are hidden
//!   from Git (added to the repo's `info/exclude`) and removed on exit.
//! - **Global**: write into each CLI's global user config, so the tools are
//!   available in every project (covers agents without a project-scoped config).
//! - **Off**: inject nothing (the user can wire it by hand — the Settings panel
//!   shows a copy-paste snippet).
//!
//! ## Per-agent config (this is the extension point)
//! Each supported agent is one [`McpAgent`] row in [`AGENTS`]. To support a **new**
//! agent (e.g. `agy`/Antigravity, Cursor, Grok, amp), add a row and a match arm in
//! [`config_path`] + [`write_entry`] describing where its MCP config lives and its
//! shape — nothing else changes. Current rows:
//!
//! | Agent | Project file (workspace) | Global file | Shape |
//! |-------|--------------------------|-------------|-------|
//! | Claude Code | `.mcp.json` | `~/.claude.json` | `mcpServers.<n> {type:http,url,headers}` |
//! | Codex | `.codex/config.toml` | `~/.codex/config.toml` | `[mcp_servers.<n>] url + bearer_token_env_var` |
//! | Gemini CLI | `.gemini/settings.json` | `~/.gemini/settings.json` | `mcpServers.<n> {httpUrl,headers}` |
//! | OpenCode | `opencode.json` | `~/.config/opencode/opencode.json` | `mcp.<n> {type:remote,url,headers,enabled}` |

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
    McpAgent { id: "claude", label: "Claude Code" },
    McpAgent { id: "codex", label: "Codex" },
    McpAgent { id: "gemini", label: "Gemini CLI" },
    McpAgent { id: "opencode", label: "OpenCode" },
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
}

/// Turn the hook server's `…/hook` URL into its `…/mcp` sibling (the MCP endpoint).
pub fn mcp_endpoint(hook_url: &str) -> String {
    hook_url.replacen("/hook", "/mcp", 1)
}

/// The config file path for `agent` under `mode`, given the terminal `cwd` and the
/// user's `home`. `None` for an unknown agent.
fn config_path(agent: &str, mode: McpInjection, cwd: &Path, home: &Path) -> Option<PathBuf> {
    let project = matches!(mode, McpInjection::Workspace);
    match agent {
        "claude" => Some(if project {
            cwd.join(".mcp.json")
        } else {
            home.join(".claude.json")
        }),
        "codex" => Some(if project {
            cwd.join(".codex").join("config.toml")
        } else {
            home.join(".codex").join("config.toml")
        }),
        "gemini" => Some(if project {
            cwd.join(".gemini").join("settings.json")
        } else {
            home.join(".gemini").join("settings.json")
        }),
        "opencode" => Some(if project {
            cwd.join("opencode.json")
        } else {
            home.join(".config").join("opencode").join("opencode.json")
        }),
        _ => None,
    }
}

/// The JSON entry (server definition) for a JSON-config agent. `None` for Codex
/// (TOML, handled separately).
fn json_entry(agent: &str, endpoint: &str) -> Option<(Vec<&'static str>, Value)> {
    // Token is referenced by env, never inlined — each CLI's own expansion syntax.
    let bearer_dollar = format!("Bearer ${{{TOKEN_ENV}}}"); // ${UXNAN_MCP_TOKEN}
    let bearer_brace = format!("Bearer {{env:{TOKEN_ENV}}}"); // {env:UXNAN_MCP_TOKEN}
    match agent {
        "claude" => Some((
            vec!["mcpServers", SERVER_NAME],
            json!({ "type": "http", "url": endpoint, "headers": { "Authorization": bearer_dollar } }),
        )),
        "gemini" => Some((
            vec!["mcpServers", SERVER_NAME],
            json!({ "httpUrl": endpoint, "headers": { "Authorization": bearer_dollar } }),
        )),
        "opencode" => Some((
            vec!["mcp", SERVER_NAME],
            json!({ "type": "remote", "url": endpoint, "enabled": true, "headers": { "Authorization": bearer_brace } }),
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
                    if node[*head].as_object().map(|o| o.is_empty()).unwrap_or(false) {
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
fn toml_codex(existing: &str, endpoint: Option<&str>) -> String {
    let mut doc = existing.parse::<toml_edit::DocumentMut>().unwrap_or_default();
    match endpoint {
        Some(url) => {
            // Ensure `mcp_servers` is a real (header) table, then add our server as
            // a `[mcp_servers.<name>]` sub-table. Existing servers/keys are kept.
            if !doc.get("mcp_servers").map(|i| i.is_table()).unwrap_or(false) {
                doc["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
            }
            let mut entry = toml_edit::Table::new();
            entry["url"] = toml_edit::value(url);
            entry["bearer_token_env_var"] = toml_edit::value(TOKEN_ENV);
            if let Some(servers) = doc["mcp_servers"].as_table_mut() {
                servers.insert(SERVER_NAME, toml_edit::Item::Table(entry));
            }
        }
        None => {
            // Remove our entry whether `mcp_servers` is a header table or an inline
            // table, pruning it if it becomes empty.
            let emptied = if let Some(t) = doc.get_mut("mcp_servers").and_then(|i| i.as_table_mut()) {
                t.remove(SERVER_NAME);
                t.is_empty()
            } else if let Some(t) = doc.get_mut("mcp_servers").and_then(|i| i.as_inline_table_mut()) {
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

// --- Injection + cleanup ---------------------------------------------------

/// Write `agent`'s config so it points at the browser MCP server, recording the
/// write for later cleanup. Merges into an existing file (never clobbers other
/// keys) and hides a file we create from Git. Best-effort: I/O errors are ignored
/// (a failed injection just means that agent won't see the tools).
fn write_entry(agent: &str, path: &Path, endpoint: &str) -> Option<Written> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let existed = path.exists();

    if agent == "codex" {
        let existing = std::fs::read_to_string(path).unwrap_or_default();
        let merged = toml_codex(&existing, Some(endpoint));
        std::fs::write(path, merged).ok()?;
    } else {
        let (pointer, entry) = json_entry(agent, endpoint)?;
        let current: Value = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| json!({}));
        let merged = json_set(current, &pointer, entry);
        std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&merged).ok()?)).ok()?;
    }

    if !existed {
        hide_from_git(path);
    }
    Some(Written { path: path.to_path_buf(), agent: agent.to_string(), created: !existed })
}

/// Undo one injected config: remove our server entry, deleting the file only if we
/// created it and it's now empty. Best-effort.
fn undo_entry(w: &Written) {
    let Ok(text) = std::fs::read_to_string(&w.path) else {
        return;
    };
    if w.agent == "codex" {
        let stripped = toml_codex(&text, None);
        if w.created && stripped.trim().is_empty() {
            let _ = std::fs::remove_file(&w.path);
        } else {
            let _ = std::fs::write(&w.path, stripped);
        }
        return;
    }
    let Some((pointer, _)) = json_entry(&w.agent, "") else {
        return;
    };
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
    let stripped = json_remove(doc, &pointer);
    let empty = stripped.as_object().map(|o| o.is_empty()).unwrap_or(false);
    if w.created && empty {
        let _ = std::fs::remove_file(&w.path);
    } else if let Ok(s) = serde_json::to_string_pretty(&stripped) {
        let _ = std::fs::write(&w.path, format!("{s}\n"));
    }
}

/// Add a created config file to its repo's `info/exclude` so it doesn't show up in
/// `git status` (works for both normal repos and linked worktrees via the common
/// git dir). Best-effort; no-op outside a repo.
fn hide_from_git(path: &Path) {
    let Some(dir) = path.parent() else { return };
    let Ok(repo) = git2::Repository::discover(dir) else {
        return;
    };
    let exclude = repo.commondir().join("info").join("exclude");
    // Store the path relative to the repo workdir when possible, else the file name.
    let entry = repo
        .workdir()
        .and_then(|wd| path.strip_prefix(wd).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| path.file_name().unwrap_or_default().to_string_lossy().into());
    let existing = std::fs::read_to_string(&exclude).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == entry) {
        return;
    }
    if let Some(parent) = exclude.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let sep = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
    let _ = std::fs::write(&exclude, format!("{existing}{sep}{entry}\n"));
}

/// Ensure every enabled agent's config points at the browser MCP server for this
/// `cwd` under the current settings. Deduplicated per (mode, cwd) so it runs once
/// per workspace per session. Called from `pty_create` before an agent starts.
pub async fn prepare(app: &AppHandle, cwd: &str) {
    let (enabled, mode, disabled) = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (b.mcp_enabled, b.mcp_injection, b.mcp_disabled_agents.clone())
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

    let cwd_path = PathBuf::from(cwd);
    // Workspace mode targets the project dir; only inject into an existing dir.
    if mode == McpInjection::Workspace && !cwd_path.is_dir() {
        return;
    }
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(_) => return,
    };

    // Dedup key: workspace configs vary by cwd; global configs are written once.
    let dedup_key = match mode {
        McpInjection::Global => "global".to_string(),
        _ => format!("ws:{cwd}"),
    };
    {
        let state = app.state::<AppState>();
        let mut prepared = state.mcp_prepared.lock().unwrap();
        if !prepared.insert(dedup_key) {
            return; // already done this session
        }
    }

    let disabled: HashSet<&str> = disabled.iter().map(String::as_str).collect();
    let mut writes = Vec::new();
    for agent in AGENTS {
        if disabled.contains(agent.id) {
            continue;
        }
        if let Some(path) = config_path(agent.id, mode, &cwd_path, &home) {
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
        for agent in ["claude", "gemini", "opencode"] {
            let (_, entry) = json_entry(agent, "http://x/mcp").unwrap();
            let s = entry.to_string();
            assert!(s.contains("Authorization"));
            // The literal token env var name is referenced, never a raw secret.
            assert!(s.contains("UXNAN_MCP_TOKEN"));
        }
    }

    #[test]
    fn toml_codex_inserts_and_removes_without_clobbering() {
        let existing = "model = \"o3\"\n\n[some.other]\nk = 1\n";
        let with = toml_codex(existing, Some("http://127.0.0.1:9/mcp"));
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

        let without = toml_codex(&with, None);
        assert!(!without.contains("uxnan-browser"));
        assert!(without.contains("model = \"o3\"")); // still preserved
    }

    #[test]
    fn config_path_maps_each_agent() {
        let cwd = Path::new("/work/repo");
        let home = Path::new("/home/u");
        // Workspace (project) paths.
        assert_eq!(
            config_path("claude", McpInjection::Workspace, cwd, home).unwrap(),
            cwd.join(".mcp.json")
        );
        assert_eq!(
            config_path("codex", McpInjection::Workspace, cwd, home).unwrap(),
            cwd.join(".codex").join("config.toml")
        );
        // Global paths.
        assert_eq!(
            config_path("gemini", McpInjection::Global, cwd, home).unwrap(),
            home.join(".gemini").join("settings.json")
        );
    }
}
