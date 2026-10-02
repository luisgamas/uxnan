//! Per-launch MCP registration — makes the browser MCP server (`mcp.rs`)
//! **discoverable** to the CLI agents the ADE launches, so they get the
//! `browser_*` (and orchestration) tools with zero setup and zero documentation,
//! **and only inside uxnan**.
//!
//! ## The rule this module exists to keep
//! The server is registered **in the process uxnan spawns, for that launch
//! only** — never in a config file the user keeps. Nothing is written to
//! `~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`
//! or any other CLI config, so an agent started anywhere else (another terminal,
//! another IDE, a CI box) has no idea the server exists: it cannot discover it,
//! cannot try to reach it, and cannot warn the user about it.
//!
//! That is the bug this replaced. The previous design wrote the server into each
//! CLI's **user-global** config and relied on the token living in the
//! environment to make it useless elsewhere. "Useless" turned out to be loud:
//! Codex validates `bearer_token_env_var` at startup and aborts the whole MCP
//! phase with *"Environment variable UXNAN_MCP_TOKEN for MCP server
//! 'uxnan-browser' is not set"* — on every run outside uxnan. And because the
//! entry carried one instance's port, a **second** uxnan window overwrote it and
//! broke the first window's agents from the inside.
//!
//! ## How each CLI is pointed at the server (all measured, not assumed)
//!
//! | Agent | Mechanism | Shape |
//! |-------|-----------|-------|
//! | Claude Code | launch flag | `--mcp-config <uxnan-owned file>` (`${UXNAN_MCP_TOKEN}` expanded from the env at load) |
//! | Codex | launch flags | `-c mcp_servers.<n>.url=<endpoint> -c mcp_servers.<n>.bearer_token_env_var=UXNAN_MCP_TOKEN` |
//! | OpenCode | launch env | `OPENCODE_CONFIG_CONTENT` (merged over the user's config; `{env:UXNAN_MCP_TOKEN}` expanded at load) |
//!
//! The token is still never written to a file: Claude's file names the
//! environment variable, Codex reads it by name, OpenCode expands it at load.
//! `commands.rs` injects `UXNAN_MCP_TOKEN` into the terminal it spawns, so the
//! credential only ever exists in a process uxnan started.
//!
//! Codex's flag values are deliberately quote-free (`key=value` with a bare URL):
//! Codex parses the value as TOML and falls back to the raw string when that
//! fails, so the arguments survive `cmd.exe`, PowerShell and POSIX quoting
//! untouched.
//!
//! ## OpenCode 2: one server per tab, and its variable only where it launches
//! OpenCode 2 no longer runs its agent in the TUI: a bare `opencode` is a client
//! of a **shared background service** (`opencode serve --service`) that
//! outlives it, and the service runs the plugins and the MCP servers with the
//! environment of whichever terminal started it first. Pointed at through the
//! environment, that would be the old bug again — a registration that outlives
//! the launch (a stale port and token once uxnan restarts), carrying one tab's
//! identity into every OpenCode client on the machine, uxnan's or not. So for
//! OpenCode 2 ([`crate::agentcli::opencode_major_version`]):
//!
//! - uxnan launches it with **`--standalone`** ([`required_args`]): a private
//!   server, child of the TUI in the tab, which dies with it and has the tab's
//!   own environment — the per-launch contract, kept. OpenCode 1 has no such
//!   flag (it rejects it), and needs none: its server always lived in the TUI.
//! - its variable goes **only on a terminal uxnan opens to launch OpenCode**
//!   ([`launch_env_all`]), never on every terminal, so a hand-typed `opencode`
//!   cannot hand it to the shared service. With OpenCode 1 every terminal keeps
//!   it, as before — there is no daemon to leak into.
//!
//! ## Why the other wired CLIs are not on that list
//! An agent is auto-configured only when a **per-launch** mechanism exists and
//! has been verified against the real CLI:
//!
//! - **Grok** — `grok -h` has no MCP-config flag, and its only external config
//!   channel (`GROK_MANAGED_CONFIG`) is a signed enterprise envelope, not a
//!   per-launch override.
//! - **Qwen Code**, **Droid**, **MiMo Code** — no verified per-launch flag or
//!   env; each is a config-file-only integration today.
//! - **Cursor**, **GitHub Copilot**, **Antigravity**, **Goose**, **Kilo Code** —
//!   same, plus the transport/expansion limits recorded in `docs/browser.md`.
//!
//! Any of them can still be wired by hand from the copy-paste snippet in
//! Settings → Browser (that config is the user's own, so it is their call), and
//! every agent keeps the `$BROWSER` shim + `/browser` route regardless.
//!
//! ## Upgrade cleanup
//! [`sweep_legacy`] runs once at startup and removes the `uxnan-browser` entry a
//! previous version may have left in any of those seven user-global configs. It
//! is removal-only: it never adds anything, never rewrites a file that doesn't
//! name our server, and leaves everything else in the file untouched.
//!
//! See `FOR-DEV.md` → *Integrated developer browser* and `docs/browser.md` →
//! *Agent browser MCP*.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub use uxnan_workspace_engine::mcp_launch::*;

/// Files older than this in `<app-data>/mcp/` are pruned at startup. They are
/// only ever Claude launch configs from an instance that no longer exists; the
/// live one rewrites its own on every terminal it spawns, so pruning can never
/// leave a running window without a config.
const STALE_CONFIG_SECS: u64 = 7 * 24 * 60 * 60;

/// The MCP config file Claude Code is launched with, for the window that owns
/// `endpoint`. Named after the loopback port so two uxnan windows can never
/// hand each other's agents the wrong endpoint (the failure the old user-global
/// entry had). Lives in this instance's own profile ([`config_dir`]).
pub fn claude_config_path(app: &AppHandle, endpoint: &str) -> Option<PathBuf> {
    Some(config_dir(app)?.join(format!("claude-{}.json", endpoint_port(endpoint))))
}

/// `<profile>/mcp`: the resolved profile ([`crate::datadir::resolve`]), not
/// the platform directory, so a development build or a disposable profile
/// never writes — or prunes — inside the installed app's.
fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    let state = app.try_state::<AppState>()?;
    Some(state.data_dir.join("mcp"))
}

/// The contents of that file: a standard `mcpServers` entry naming the token's
/// environment variable (Claude expands `${VAR}` when it loads the config), so
/// the file itself holds no secret — and the terminal's id the same way, so one
/// file per window serves every terminal and each agent still says which it is.
fn claude_config_json(endpoint: &str) -> String {
    let doc = json!({
        "mcpServers": {
            SERVER_NAME: {
                "type": "http",
                "url": endpoint,
                "headers": {
                    "Authorization": format!("Bearer ${{{TOKEN_ENV}}}"),
                    AGENT_ID_HEADER: format!("${{{AGENT_ID_ENV}}}")
                }
            }
        }
    });
    format!(
        "{}\n",
        serde_json::to_string_pretty(&doc).unwrap_or_else(|_| doc.to_string())
    )
}

/// Write (or refresh) the Claude launch config and return its path as a string.
/// Idempotent and best-effort: identical content is left alone, and a failure
/// just means Claude launches without the browser tools this time.
pub fn ensure_claude_config(app: &AppHandle, endpoint: &str) -> Option<String> {
    let path = claude_config_path(app, endpoint)?;
    let wanted = claude_config_json(endpoint);
    let fresh = std::fs::read_to_string(&path)
        .map(|current| current == wanted)
        .unwrap_or(false);
    if !fresh {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        crate::agent_hooks::write_json_atomic(&path, &wanted).ok()?;
    }
    Some(path.to_string_lossy().to_string())
}

/// Drop Claude launch configs left by instances that are long gone. Safe by
/// construction: every live window rewrites its own file on every terminal it
/// spawns, so a pruned file is recreated before it could ever be read.
fn prune_stale_configs(app: &AppHandle) {
    let Some(dir) = config_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with("claude-") && name.ends_with(".json")) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| {
                t.elapsed()
                    .map(|age| age.as_secs() > STALE_CONFIG_SECS)
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Prepare everything a terminal needs before an agent starts in it: the Claude
/// launch config for this window, and — when the user asked for a frictionless
/// launch — Codex's per-folder trust seed for `cwd`.
///
/// The trust seed is the one thing here that still touches the user's own config
/// (`~/.codex/config.toml`): it records a decision *about their folder* that
/// outlives the launch by design, it is silent, and it is opt-out in Settings →
/// Browser. It is deduplicated per `cwd`. Called from `pty_create`.
pub async fn prepare(app: &AppHandle, cwd: &str) {
    let (enabled, friction_free, disabled) = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        let b = &data.settings.browser;
        (
            b.mcp_enabled,
            b.friction_free,
            b.mcp_disabled_agents.clone(),
        )
    };
    if !enabled {
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
    let disabled: HashSet<&str> = disabled.iter().map(String::as_str).collect();

    // Claude's launch config — refreshed per terminal so it is always there when
    // the command is typed, whatever else pruned or replaced it.
    if !disabled.contains("claude") {
        ensure_claude_config(app, &endpoint);
    }

    // Frictionless: pre-seed Codex per-folder trust so Codex doesn't prompt to
    // trust this working directory when launched here. Best-effort: a
    // path-format mismatch just leaves Codex's normal prompt.
    if friction_free && !disabled.contains("codex") && !cwd.trim().is_empty() {
        let seed = {
            let state = app.state::<AppState>();
            let mut prepared = state.mcp_prepared.lock().unwrap();
            prepared.insert(format!("codextrust:{cwd}"))
        };
        if seed {
            let Ok(home) = app.path().home_dir() else {
                return;
            };
            let cfg = home.join(".codex").join("config.toml");
            let _ = crate::codex_trust::ensure_project_trust(&cfg, Path::new(cwd));
        }
    }
}

// --- Upgrade cleanup: user-global entries written by older versions ---------

/// A user-global config an older uxnan may have written our server into, and the
/// format it is written in.
struct LegacyConfig {
    path: PathBuf,
    format: LegacyFormat,
}

enum LegacyFormat {
    /// JSON, our entry at `<pointer>.<SERVER_NAME>`.
    Json(&'static [&'static str]),
    /// TOML, our entry at `[mcp_servers.<SERVER_NAME>]`.
    Toml,
}

/// Every user-global config a previous version could have written, relative to
/// `home`. Kept complete on purpose: the sweep must reach machines that ran the
/// old build with any of these CLIs installed, even the ones no longer
/// auto-configured.
fn legacy_configs(home: &Path) -> Vec<LegacyConfig> {
    vec![
        LegacyConfig {
            path: home.join(".claude.json"),
            format: LegacyFormat::Json(&["mcpServers"]),
        },
        LegacyConfig {
            path: home.join(".codex").join("config.toml"),
            format: LegacyFormat::Toml,
        },
        LegacyConfig {
            path: home.join(".config").join("opencode").join("opencode.json"),
            format: LegacyFormat::Json(&["mcp"]),
        },
        LegacyConfig {
            path: home.join(".grok").join("config.toml"),
            format: LegacyFormat::Toml,
        },
        LegacyConfig {
            path: home.join(".qwen").join("settings.json"),
            format: LegacyFormat::Json(&["mcpServers"]),
        },
        LegacyConfig {
            path: home.join(".factory").join("mcp.json"),
            format: LegacyFormat::Json(&["mcpServers"]),
        },
        LegacyConfig {
            path: home.join(".config").join("mimocode").join("mimocode.json"),
            format: LegacyFormat::Json(&["mcp"]),
        },
    ]
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

/// Strip our `[mcp_servers.<SERVER_NAME>]` entry from a `config.toml`, keeping
/// the user's other settings, servers, comments and formatting.
fn toml_without_entry(existing: &str) -> Option<String> {
    let mut doc = existing.parse::<toml_edit::DocumentMut>().ok()?;
    let emptied = if let Some(t) = doc.get_mut("mcp_servers").and_then(|i| i.as_table_mut()) {
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
    Some(doc.to_string())
}

/// Remove our server entry from one legacy config. Returns true when the file
/// was actually rewritten. Never creates a file, never touches one that doesn't
/// name our server, and leaves an unreadable or unparseable file exactly as it
/// is (rewriting it from a stub is how a user loses their settings).
fn sweep_one(cfg: &LegacyConfig) -> bool {
    let Ok(text) = std::fs::read_to_string(&cfg.path) else {
        return false;
    };
    if !text.contains(SERVER_NAME) {
        return false; // fast path: nothing of ours in here
    }
    match cfg.format {
        LegacyFormat::Toml => {
            let Some(stripped) = toml_without_entry(&text) else {
                return false; // unparseable → leave untouched
            };
            if stripped == text {
                return false;
            }
            crate::agent_hooks::write_text_atomic(&cfg.path, &stripped).is_ok()
        }
        LegacyFormat::Json(parent) => {
            let Ok(doc) = serde_json::from_str::<Value>(&text) else {
                return false; // unparseable → leave untouched
            };
            let mut pointer: Vec<&str> = parent.to_vec();
            pointer.push(SERVER_NAME);
            let stripped = json_remove(doc.clone(), &pointer);
            if stripped == doc {
                return false; // our name appeared elsewhere; nothing to remove
            }
            let Ok(s) = serde_json::to_string_pretty(&stripped) else {
                return false;
            };
            crate::agent_hooks::write_json_atomic(&cfg.path, &format!("{s}\n")).is_ok()
        }
    }
}

/// Remove every user-global `uxnan-browser` entry an older version wrote under
/// `home`, returning how many files were cleaned. Pure filesystem work, so it is
/// unit-tested against a temporary home.
pub fn sweep_legacy_at(home: &Path) -> usize {
    legacy_configs(home).iter().filter(|c| sweep_one(c)).count()
}

/// Startup cleanup: drop the user-global entries older versions left behind and
/// prune stale per-window launch configs. Best-effort and silent when there is
/// nothing to do.
pub fn sweep_legacy(app: &AppHandle) {
    prune_stale_configs(app);
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let cleaned = sweep_legacy_at(&home);
    if cleaned > 0 {
        crate::diagnostics::log(
            crate::diagnostics::Level::Info,
            "mcp",
            &format!("removed a stale {SERVER_NAME} entry from {cleaned} agent config file(s)"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Upgrade cleanup ----------------------------------------------------

    #[test]
    fn sweep_removes_our_entry_and_keeps_everything_else() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();

        // Claude: our entry beside the user's own server and unrelated keys.
        std::fs::write(
            home.join(".claude.json"),
            json!({
                "topLevel": "keep-me",
                "mcpServers": {
                    SERVER_NAME: { "type": "http", "url": "http://127.0.0.1:1/mcp" },
                    "someone-elses": { "url": "http://example/mcp" }
                }
            })
            .to_string(),
        )
        .unwrap();

        // Codex: our table beside the user's settings.
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(
            home.join(".codex").join("config.toml"),
            "model = \"o3\"\n\n[mcp_servers.uxnan-browser]\nurl = \"http://127.0.0.1:1/mcp\"\nbearer_token_env_var = \"UXNAN_MCP_TOKEN\"\n\n[some.other]\nk = 1\n",
        )
        .unwrap();

        assert_eq!(sweep_legacy_at(home), 2);

        let claude: Value =
            serde_json::from_str(&std::fs::read_to_string(home.join(".claude.json")).unwrap())
                .unwrap();
        assert!(claude["mcpServers"].get(SERVER_NAME).is_none());
        assert!(claude["mcpServers"].get("someone-elses").is_some());
        assert_eq!(claude["topLevel"], "keep-me");

        let codex = std::fs::read_to_string(home.join(".codex").join("config.toml")).unwrap();
        assert!(!codex.contains(SERVER_NAME));
        assert!(codex.contains("model = \"o3\""));
        assert!(codex.contains("[some.other]"));

        // Idempotent: a second pass finds nothing left to clean.
        assert_eq!(sweep_legacy_at(home), 0);
    }

    #[test]
    fn sweep_leaves_unparseable_and_unrelated_files_alone() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();

        let broken = "{ \"unterminated\": \"uxnan-browser\"";
        std::fs::write(home.join(".claude.json"), broken).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        let sane = "model = \"o3\"\n";
        std::fs::write(home.join(".codex").join("config.toml"), sane).unwrap();

        assert_eq!(sweep_legacy_at(home), 0);
        assert_eq!(
            std::fs::read_to_string(home.join(".claude.json")).unwrap(),
            broken
        );
        assert_eq!(
            std::fs::read_to_string(home.join(".codex").join("config.toml")).unwrap(),
            sane
        );
    }

    #[test]
    fn sweep_covers_the_agents_we_no_longer_configure() {
        // Grok/Qwen/Droid/MiMo are not auto-configured any more, so the only way
        // their old entry ever disappears is this sweep.
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        std::fs::create_dir_all(home.join(".grok")).unwrap();
        std::fs::write(
            home.join(".grok").join("config.toml"),
            "[mcp_servers.uxnan-browser]\nurl = \"http://127.0.0.1:1/mcp\"\n",
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".factory")).unwrap();
        std::fs::write(
            home.join(".factory").join("mcp.json"),
            json!({ "mcpServers": { SERVER_NAME: { "url": "http://127.0.0.1:1/mcp" } } })
                .to_string(),
        )
        .unwrap();

        assert_eq!(sweep_legacy_at(home), 2);
        let grok = std::fs::read_to_string(home.join(".grok").join("config.toml")).unwrap();
        assert!(!grok.contains(SERVER_NAME));
        let droid: Value = serde_json::from_str(
            &std::fs::read_to_string(home.join(".factory").join("mcp.json")).unwrap(),
        )
        .unwrap();
        assert!(droid.get("mcpServers").is_none()); // emptied parent pruned
    }
}
