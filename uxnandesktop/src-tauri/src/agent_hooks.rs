//! Ready-made per-agent hook configs (spec `02d` §1.1, `docs/agent-hooks.md`).
//!
//! The Layer 1 HTTP hook server (`hooks.rs`) is up and the ADE injects
//! `UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` / `UXNAN_AGENT_ID` (+ a restart-stable
//! `UXNAN_ENDPOINT_FILE`) into every terminal; this module installs the actual
//! **reporters** into each agent's native config so precise states work out of
//! the box — no manual JSON editing, and robust across every shell the user
//! might launch the agent from (cmd, PowerShell, PowerShell 7, Git Bash, WSL,
//! bash, zsh, fish, …).
//!
//! The reporter differs per agent, chosen for maximum shell-robustness:
//!   * **Claude Code** and **Gemini CLI** are themselves Node programs, so `node`
//!     is guaranteed on their PATH. They run a tiny dependency-free relay
//!     (`uxnan-status-relay.cjs`) — Claude via *exec form* (`command:"node",
//!     args:[…]`), which bypasses the shell entirely, and Gemini via a
//!     `node "<relay>"` command. `node "<path>"` resolves identically under every
//!     shell, so this sidesteps "which shell runs the hook" completely.
//!   * **Codex** is a Rust binary (no Node guarantee), so it uses a small `curl`
//!     script (`uxnan-codex-hook.{sh,cmd}`) invoked by Codex's own hook runner
//!     (`/bin/sh` on POSIX, `cmd` on Windows). Codex 0.129+ additionally gates
//!     hooks on a per-hook `trusted_hash`; we reproduce it (`codex_trust`) so the
//!     hook actually fires.
//!   * **OpenCode** loads an in-process JS plugin; **Pi** loads an in-process
//!     extension. Both POST directly from inside the agent process.
//!
//! Every reporter reads the endpoint file when its injected coordinates are
//! stale (e.g. the terminal outlived an app restart) and fails open — a dead
//! server or missing coordinate is silently ignored, never breaking the agent.
//!
//! On startup the ADE writes the bundled scripts to `<app-data>/hooks/`
//! (idempotent) and, when auto-install is on, merges the managed reporter into
//! each agent's config — preserving every other user setting.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::codex_trust;
use crate::error::AppError;

// --- Bundled script sources (embedded at compile time) ---------------------

/// The Node relay shared by Claude Code and Gemini CLI (both guarantee `node`).
pub const STATUS_RELAY_SCRIPT: &str = include_str!("../../static/hooks/uxnan-status-relay.cjs");
/// Codex `curl` hook (POSIX) — invoked by Codex's `/bin/sh` hook runner.
pub const CODEX_HOOK_SH: &str = include_str!("../../static/hooks/uxnan-codex-hook.sh");
/// Codex `curl` hook (Windows) — invoked by Codex's `cmd` hook runner.
pub const CODEX_HOOK_CMD: &str = include_str!("../../static/hooks/uxnan-codex-hook.cmd");
/// OpenCode in-process status plugin (ES module).
pub const OPENCODE_STATUS_PLUGIN: &str =
    include_str!("../../static/hooks/uxnan-opencode-status-plugin.js");
/// Pi / OMP in-process status extension.
pub const PI_STATUS_EXTENSION: &str = include_str!("../../static/hooks/uxnan-pi-status.js");

/// The generic launcher wrappers (any CLI agent without a native hook surface).
pub const WRAPPER_BASH: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.sh");
pub const WRAPPER_POWERSHELL: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.ps1");
pub const WRAPPER_CMD: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.cmd");
pub const WRAPPER_FISH: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.fish");
/// The integrated-browser shims (`$BROWSER` points here).
pub const BROWSER_SHIM_BASH: &str = include_str!("../../static/hooks/uxnan-browser.sh");
pub const BROWSER_SHIM_CMD: &str = include_str!("../../static/hooks/uxnan-browser.cmd");

// --- Bundled script file names ---------------------------------------------

const STATUS_RELAY_FILENAME: &str = "uxnan-status-relay.cjs";
const CODEX_HOOK_SH_FILENAME: &str = "uxnan-codex-hook.sh";
const CODEX_HOOK_CMD_FILENAME: &str = "uxnan-codex-hook.cmd";
const OPENCODE_PLUGIN_SRC_FILENAME: &str = "uxnan-opencode-status.js";
const PI_EXTENSION_SRC_FILENAME: &str = "uxnan-pi-status.js";
const WRAPPER_BASH_FILENAME: &str = "uxnan-hook-wrapper.sh";
const WRAPPER_POWERSHELL_FILENAME: &str = "uxnan-hook-wrapper.ps1";
const WRAPPER_CMD_FILENAME: &str = "uxnan-hook-wrapper.cmd";
const WRAPPER_FISH_FILENAME: &str = "uxnan-hook-wrapper.fish";
const BROWSER_SHIM_BASH_FILENAME: &str = "uxnan-browser.sh";
const BROWSER_SHIM_CMD_FILENAME: &str = "uxnan-browser.cmd";

/// The plugin filename OpenCode loads it under (in its `plugins/` dir).
const OPENCODE_PLUGIN_FILENAME: &str = "uxnan-status.js";
/// The extension filename Pi/OMP loads it under (in their `extensions/` dir).
const PI_EXTENSION_FILENAME: &str = "uxnan-agent-status.js";
/// Marker line that identifies our OpenCode plugin / Pi extension as managed.
const OPENCODE_PLUGIN_MARKER: &str = "Uxnan Desktop - OpenCode status plugin";
const PI_EXTENSION_MARKER: &str = "Uxnan Desktop - Pi status extension";

/// Per-hook timeout (seconds) for the node-relay agents; short because the
/// report is fire-and-forget.
const RELAY_TIMEOUT_SECS: u32 = 10;
/// Gemini's hook timeout is expressed in **milliseconds** (unlike Claude/Codex).
const GEMINI_TIMEOUT_MS: u32 = 10_000;

/// The agent kinds whose reporter lives in a JSON `hooks` block (so a managed
/// entry can be matched + swept). OpenCode (a plugin) and Pi (an extension)
/// don't live in a `hooks` block, so they aren't `AgentKind`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
}

/// Claude Code hook events → `hooks` block. `true` = attach an all-tools matcher
/// (`""`). The server maps each event to a precise state (`hooks::normalize_event`).
const CLAUDE_EVENTS: &[(&str, bool)] = &[
    ("UserPromptSubmit", false),
    ("PreToolUse", true),
    ("PostToolUse", true),
    ("PostToolUseFailure", true),
    ("PermissionRequest", true),
    ("Notification", false),
    ("Stop", false),
    ("SessionEnd", false),
    // Sub-agent (Task-tool child) lifecycle → the parent's roster (nested rows in
    // the agent view). Lifecycle events, so no all-tools matcher.
    ("SubagentStart", false),
    ("SubagentStop", false),
];

/// Gemini CLI turn events. Gemini has no permission hook, so no `waiting`.
const GEMINI_EVENTS: &[&str] = &["BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool"];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE")?
            .to_string_lossy()
            .into_owned()
    } else {
        std::env::var_os("HOME")?.to_string_lossy().into_owned()
    };
    Some(PathBuf::from(home))
}

pub fn claude_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".claude").join("settings.json"))
}

fn codex_hooks_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".codex").join("hooks.json"))
}

fn codex_config_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".codex").join("config.toml"))
}

fn gemini_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".gemini").join("settings.json"))
}

fn opencode_plugin_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".config")
            .join("opencode")
            .join("plugins")
            .join(OPENCODE_PLUGIN_FILENAME),
    )
}

fn opencode_config_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".config")
            .join("opencode")
            .join("opencode.json"),
    )
}

fn pi_extension_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".pi")
            .join("agent")
            .join("extensions")
            .join(PI_EXTENSION_FILENAME),
    )
}

/// Absolute paths of everything the ADE wrote/knows about, for the Settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInstall {
    /// The directory the ADE writes scripts to.
    pub dir: String,
    /// The Node relay (Claude Code + Gemini CLI).
    pub status_relay_script: String,
    /// Codex `curl` hook (POSIX).
    pub codex_hook_sh: String,
    /// Codex `curl` hook (Windows).
    pub codex_hook_cmd: String,
    /// OpenCode plugin source (in the hooks dir; installed into OpenCode's dir).
    pub opencode_plugin_script: String,
    /// Pi/OMP extension source (in the hooks dir; installed into Pi's dir).
    pub pi_extension_script: String,
    pub wrapper_bash: String,
    pub wrapper_powershell: String,
    pub wrapper_cmd: String,
    pub wrapper_fish: String,
    pub browser_shim_bash: String,
    pub browser_shim_cmd: String,
    /// Where each agent's managed config lives (shown in the UI).
    pub claude_settings_path: String,
    pub codex_hooks_path: String,
    pub gemini_settings_path: String,
    pub opencode_plugin_path: String,
    pub pi_extension_path: String,
}

/// The current install state of one agent's managed hook.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHooksStatus {
    /// `true` if our managed reporter is present.
    pub installed: bool,
    /// `true` if the config file exists (whether we manage it or not).
    pub file_exists: bool,
    /// `true` if we tried to read/write it and the OS denied us.
    pub unavailable: bool,
    /// Human-readable detail; the path on success, the error otherwise.
    pub detail: String,
}

// ---------------------------------------------------------------------------
// Script installation to <app-data>/hooks/
// ---------------------------------------------------------------------------

/// Write `content` to `path` only if it differs (atomic via a sibling temp).
fn write_if_changed(path: &Path, content: &str) -> Result<(), AppError> {
    let need_write = match std::fs::read_to_string(path) {
        Ok(existing) => existing != content,
        Err(_) => true,
    };
    if !need_write {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Atomic JSON write (sibling temp + rename, single rolling `.bak`).
///
/// `pub(crate)` so the MCP config injector (`mcpinject.rs`) can route its
/// foreign-config writes through the same safe envelope — never a bare
/// `std::fs::write` that could truncate a user's CLI config mid-write.
pub(crate) fn write_json_atomic(path: &Path, text: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("json.bak"));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Atomic text write (sibling temp + rename, single rolling `.bak`) for
/// non-JSON config files (e.g. Codex's `~/.codex/config.toml`). Mirrors
/// [`write_json_atomic`] but leaves format-agnostic `.tmp`/`.bak` siblings.
pub(crate) fn write_text_atomic(path: &Path, text: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text)?;
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("bak"));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Write the bundled scripts to `<dir>` (idempotent) and resolve every path the
/// Settings UI needs. `+x` is set on the POSIX scripts a shell runs directly.
pub fn install_scripts_to(dir: &Path) -> Result<HookInstall, AppError> {
    std::fs::create_dir_all(dir)?;
    let dir = dir.to_path_buf();
    let write = |name: &str, content: &str| -> Result<PathBuf, AppError> {
        let path = dir.join(name);
        write_if_changed(&path, content)?;
        Ok(path)
    };
    let relay = write(STATUS_RELAY_FILENAME, STATUS_RELAY_SCRIPT)?;
    let codex_sh = write(CODEX_HOOK_SH_FILENAME, CODEX_HOOK_SH)?;
    let codex_cmd = write(CODEX_HOOK_CMD_FILENAME, CODEX_HOOK_CMD)?;
    let opencode = write(OPENCODE_PLUGIN_SRC_FILENAME, OPENCODE_STATUS_PLUGIN)?;
    let pi = write(PI_EXTENSION_SRC_FILENAME, PI_STATUS_EXTENSION)?;
    let bash = write(WRAPPER_BASH_FILENAME, WRAPPER_BASH)?;
    let ps = write(WRAPPER_POWERSHELL_FILENAME, WRAPPER_POWERSHELL)?;
    let cmd = write(WRAPPER_CMD_FILENAME, WRAPPER_CMD)?;
    let fish = write(WRAPPER_FISH_FILENAME, WRAPPER_FISH)?;
    let browser_bash = write(BROWSER_SHIM_BASH_FILENAME, BROWSER_SHIM_BASH)?;
    let browser_cmd = write(BROWSER_SHIM_CMD_FILENAME, BROWSER_SHIM_CMD)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for f in [&codex_sh, &bash, &fish, &browser_bash] {
            let _ = std::fs::set_permissions(f, std::fs::Permissions::from_mode(0o755));
        }
    }
    let path_str = |p: &Path| p.to_string_lossy().into_owned();
    let opt = |p: Option<PathBuf>| p.map(|p| path_str(&p)).unwrap_or_default();
    Ok(HookInstall {
        dir: path_str(&dir),
        status_relay_script: path_str(&relay),
        codex_hook_sh: path_str(&codex_sh),
        codex_hook_cmd: path_str(&codex_cmd),
        opencode_plugin_script: path_str(&opencode),
        pi_extension_script: path_str(&pi),
        wrapper_bash: path_str(&bash),
        wrapper_powershell: path_str(&ps),
        wrapper_cmd: path_str(&cmd),
        wrapper_fish: path_str(&fish),
        browser_shim_bash: path_str(&browser_bash),
        browser_shim_cmd: path_str(&browser_cmd),
        claude_settings_path: opt(claude_settings_path()),
        codex_hooks_path: opt(codex_hooks_path()),
        gemini_settings_path: opt(gemini_settings_path()),
        opencode_plugin_path: opt(opencode_plugin_path()),
        pi_extension_path: opt(pi_extension_path()),
    })
}

// ---------------------------------------------------------------------------
// Managed-hook command builders + matcher
// ---------------------------------------------------------------------------

/// Normalize a script path to forward slashes (works for `node`/`sh`/`curl`
/// under every shell on every platform, and avoids Git-Bash backslash mangling).
fn fwd(path: &str) -> String {
    path.replace('\\', "/")
}

/// The relay command entry for Claude Code — **exec form**: `node` is spawned
/// directly with args, bypassing the shell so it works from any terminal
/// (cmd / PowerShell / Git Bash / WSL / …) without depending on one being present.
fn claude_hook_entry(relay: &str) -> Value {
    json!({
        "type": "command",
        "command": "node",
        "args": [fwd(relay), "--agent", "claude"],
        "timeout": RELAY_TIMEOUT_SECS
    })
}

/// The relay command entry for Gemini CLI — a `node "<relay>"` command string
/// (Gemini guarantees `node`, so this resolves under any shell). Timeout is in
/// milliseconds for Gemini.
fn gemini_hook_entry(relay: &str) -> Value {
    json!({
        "type": "command",
        "command": format!("node \"{}\" --agent gemini", fwd(relay)),
        "timeout": GEMINI_TIMEOUT_MS
    })
}

/// The Codex hook command string (the exact bytes folded into the trust hash).
/// POSIX wraps `/bin/sh` behind an `[ -x ]` guard (a missing script is a silent
/// no-op, never a `127`); Windows invokes the `.cmd` directly via Codex's `cmd`
/// hook runner.
fn codex_command(install: &HookInstall) -> String {
    if cfg!(windows) {
        install.codex_hook_cmd.clone()
    } else {
        let sh = &install.codex_hook_sh;
        format!("if [ -x '{sh}' ]; then /bin/sh '{sh}'; fi")
    }
}

/// The searchable text of a hook entry: its `command` string plus any `args`.
fn hook_text(hook: &Value) -> String {
    let cmd = hook.get("command").and_then(Value::as_str).unwrap_or("");
    let args = hook
        .get("args")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    format!("{cmd} {args}")
}

/// Whether a hook entry is one the ADE manages for `kind` (matched by the script
/// it references + the agent tag, so a platform switch or moved path still
/// sweeps the stale entry without touching user-authored hooks).
fn is_managed_hook(hook: &Value, kind: AgentKind) -> bool {
    let text = fwd(&hook_text(hook));
    match kind {
        // `uxnan-claude-hook` is the legacy dedicated cjs (pre-relay); match it too
        // so an upgrade sweeps the stale entry that now points at a deleted script.
        AgentKind::Claude => {
            text.contains("uxnan-claude-hook")
                || (text.contains(STATUS_RELAY_FILENAME) && text.contains("claude"))
        }
        AgentKind::Gemini => text.contains(STATUS_RELAY_FILENAME) && text.contains("gemini"),
        // `uxnan-codex-hook` is the current curl hook; the relay match sweeps the
        // legacy node-relay entry a prior build wrote for Codex.
        AgentKind::Codex => {
            text.contains("uxnan-codex-hook")
                || (text.contains(STATUS_RELAY_FILENAME) && text.contains("codex"))
        }
    }
}

/// Legacy top-level marker the pre-relay Claude installer wrote into the `hooks`
/// object. It isn't a valid Claude hook event, so current Claude Code warns about
/// it on startup — remove it whenever we touch the config.
const LEGACY_CLAUDE_MARKER: &str = "__uxnan_managed_hooks__";

// ---------------------------------------------------------------------------
// Shared JSON `hooks` block merge (Claude / Codex / Gemini)
// ---------------------------------------------------------------------------

/// Merge one managed group into `doc.hooks[event]`, first stripping any prior
/// managed group for `kind` (idempotent + user-hook-preserving).
fn merge_event(
    doc: &mut Value,
    event: &str,
    matcher: Option<&str>,
    entry: &Value,
    kind: AgentKind,
) {
    if !doc["hooks"]
        .get(event)
        .map(Value::is_array)
        .unwrap_or(false)
    {
        doc["hooks"][event] = json!([]);
    }
    if let Some(arr) = doc["hooks"][event].as_array_mut() {
        arr.retain(|group| {
            !group
                .get("hooks")
                .and_then(Value::as_array)
                .map(|hooks| hooks.iter().any(|h| is_managed_hook(h, kind)))
                .unwrap_or(false)
        });
        let mut group = json!({ "hooks": [entry.clone()] });
        if let Some(m) = matcher {
            group["matcher"] = json!(m);
        }
        arr.push(group);
    }
}

/// Strip every managed group for `kind` from a `hooks` document, dropping now-empty
/// event buckets and an empty top-level `hooks`.
fn strip_managed(doc: &mut Value, kind: AgentKind) {
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    // Drop the legacy pre-relay marker that Claude Code warns about.
    hooks.remove(LEGACY_CLAUDE_MARKER);
    for groups in hooks.values_mut() {
        if let Some(arr) = groups.as_array_mut() {
            arr.retain(|group| {
                !group
                    .get("hooks")
                    .and_then(Value::as_array)
                    .map(|hs| hs.iter().any(|h| is_managed_hook(h, kind)))
                    .unwrap_or(false)
            });
        }
    }
    // Drop event buckets that are now empty arrays (keep non-array values — e.g. a
    // user's own object-shaped key — untouched).
    hooks.retain(|_, groups| groups.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    if hooks.is_empty() {
        if let Some(obj) = doc.as_object_mut() {
            obj.remove("hooks");
        }
    }
}

/// Ensure `doc.hooks` is an object again after a strip may have removed it, so a
/// following merge can index into it.
fn ensure_hooks_object(doc: &mut Value) {
    if !doc.get("hooks").map(Value::is_object).unwrap_or(false) {
        doc["hooks"] = json!({});
    }
}

/// Parse a config file into a JSON object (empty/absent/invalid → `{}`), ensuring
/// a `hooks` object exists.
fn read_hooks_doc(text: &str) -> Value {
    let mut doc: Value = serde_json::from_str(text).unwrap_or_else(|_| json!({}));
    if !doc.is_object() {
        doc = json!({});
    }
    if !doc.get("hooks").map(Value::is_object).unwrap_or(false) {
        doc["hooks"] = json!({});
    }
    doc
}

fn to_pretty(doc: &Value) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(doc).unwrap_or_else(|_| "{}".to_string())
    )
}

fn contains_managed(text: &str, kind: AgentKind) -> bool {
    let Ok(doc) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let Some(hooks) = doc.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    hooks.values().any(|groups| {
        groups
            .as_array()
            .map(|arr| {
                arr.iter().any(|group| {
                    group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .map(|hs| hs.iter().any(|h| is_managed_hook(h, kind)))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

fn status_from_config(path: Option<PathBuf>, kind: AgentKind, label: &str) -> AgentHooksStatus {
    let Some(path) = path else {
        return AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: "home directory not resolvable".to_string(),
        };
    };
    let path_str = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => AgentHooksStatus {
            installed: contains_managed(&text, kind),
            file_exists: true,
            unavailable: false,
            detail: format!("{label} at {path_str}"),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: false,
            detail: format!("file not present at {path_str}"),
        },
        Err(err) => AgentHooksStatus {
            installed: false,
            file_exists: true,
            unavailable: true,
            detail: err.to_string(),
        },
    }
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

pub fn read_claude_status() -> AgentHooksStatus {
    status_from_config(claude_settings_path(), AgentKind::Claude, "settings.json")
}

pub fn install_claude_hooks(relay: &str) -> Result<AgentHooksStatus, AppError> {
    let path = claude_settings_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.claude/settings.json".into()))?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = read_hooks_doc(&existing);
    // Sweep any prior managed hooks (incl. the legacy dedicated cjs on events we no
    // longer subscribe to) and the legacy marker, then merge the current relay in.
    strip_managed(&mut doc, AgentKind::Claude);
    ensure_hooks_object(&mut doc);
    let entry = claude_hook_entry(relay);
    for (event, has_matcher) in CLAUDE_EVENTS {
        let matcher = if *has_matcher { Some("") } else { None };
        merge_event(&mut doc, event, matcher, &entry, AgentKind::Claude);
    }
    write_json_atomic(&path, &to_pretty(&doc))?;
    Ok(read_claude_status())
}

pub fn uninstall_claude_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = claude_settings_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.claude/settings.json".into()))?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        let mut doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
        let before = doc.clone();
        strip_managed(&mut doc, AgentKind::Claude);
        // Write only when something actually changed (also removes the legacy
        // marker even if no hook groups were ours).
        if doc != before {
            write_json_atomic(&path, &to_pretty(&doc))?;
        }
    }
    Ok(read_claude_status())
}

/// Render the Claude `hooks` block the ADE installs (for the Settings "Show JSON"
/// affordance), against the given relay path.
pub fn render_claude_settings_json(relay: &str) -> Result<String, AppError> {
    let mut doc = json!({ "hooks": {} });
    let entry = claude_hook_entry(relay);
    for (event, has_matcher) in CLAUDE_EVENTS {
        let matcher = if *has_matcher { Some("") } else { None };
        merge_event(&mut doc, event, matcher, &entry, AgentKind::Claude);
    }
    serde_json::to_string_pretty(&doc["hooks"]).map_err(AppError::Serde)
}

// ---------------------------------------------------------------------------
// Gemini CLI
// ---------------------------------------------------------------------------

pub fn read_gemini_hooks_status() -> AgentHooksStatus {
    status_from_config(gemini_settings_path(), AgentKind::Gemini, "settings.json")
}

pub fn install_gemini_hooks(relay: &str) -> Result<AgentHooksStatus, AppError> {
    let path = gemini_settings_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.gemini/settings.json".into()))?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = read_hooks_doc(&existing);
    strip_managed(&mut doc, AgentKind::Gemini);
    ensure_hooks_object(&mut doc);
    let entry = gemini_hook_entry(relay);
    for event in GEMINI_EVENTS {
        merge_event(&mut doc, event, None, &entry, AgentKind::Gemini);
    }
    write_json_atomic(&path, &to_pretty(&doc))?;
    Ok(read_gemini_hooks_status())
}

pub fn uninstall_gemini_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = gemini_settings_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.gemini/settings.json".into()))?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        if contains_managed(&text, AgentKind::Gemini) {
            let mut doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
            strip_managed(&mut doc, AgentKind::Gemini);
            write_json_atomic(&path, &to_pretty(&doc))?;
        }
    }
    Ok(read_gemini_hooks_status())
}

/// Render the Gemini `hooks` block the ADE installs (for the Settings "Show config"
/// affordance), against the given relay path. Mirrors the merge used at install so
/// what's shown equals what's written into `~/.gemini/settings.json`.
pub fn render_gemini_settings_json(relay: &str) -> Result<String, AppError> {
    let mut doc = json!({ "hooks": {} });
    let entry = gemini_hook_entry(relay);
    for event in GEMINI_EVENTS {
        merge_event(&mut doc, event, None, &entry, AgentKind::Gemini);
    }
    serde_json::to_string_pretty(&doc["hooks"]).map_err(AppError::Serde)
}

// ---------------------------------------------------------------------------
// Codex (hooks.json + config.toml trust)
// ---------------------------------------------------------------------------

/// Render the full `~/.codex/hooks.json` body the ADE installs (for the Settings
/// "Show config" affordance). The matching `trusted_hash` in `config.toml` is
/// written automatically by the ADE (`codex_trust`), so it isn't shown here.
pub fn render_codex_hooks_json(install: &HookInstall) -> Result<String, AppError> {
    let command = codex_command(install);
    let entry = json!({ "type": "command", "command": command });
    let mut doc = json!({ "hooks": {} });
    for (event, _label) in codex_trust::CODEX_EVENTS {
        merge_event(&mut doc, event, None, &entry, AgentKind::Codex);
    }
    serde_json::to_string_pretty(&doc).map_err(AppError::Serde)
}

pub fn read_codex_hooks_status() -> AgentHooksStatus {
    status_from_config(codex_hooks_path(), AgentKind::Codex, "hooks.json")
}

pub fn install_codex_hooks(install: &HookInstall) -> Result<AgentHooksStatus, AppError> {
    let path = codex_hooks_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.codex/hooks.json".into()))?;
    let command = codex_command(install);
    // No `timeout`: Codex applies its 600 s default, which is the exact identity
    // our trust hash is golden-verified against (the hook's own curl caps at
    // 1.5 s, so the backstop is never reached). See `codex_trust`.
    let entry = json!({
        "type": "command",
        "command": command,
    });
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = read_hooks_doc(&existing);
    strip_managed(&mut doc, AgentKind::Codex);
    ensure_hooks_object(&mut doc);
    for (event, _label) in codex_trust::CODEX_EVENTS {
        merge_event(&mut doc, event, None, &entry, AgentKind::Codex);
    }
    write_json_atomic(&path, &to_pretty(&doc))?;

    // Codex 0.129+ only runs a hook whose exact identity is trusted in
    // config.toml; register the trust so the hook actually fires.
    if let Some(cfg) = codex_config_path() {
        let event_commands: Vec<(&str, &str, String)> = codex_trust::CODEX_EVENTS
            .iter()
            .map(|(event, label)| (*event, *label, command.clone()))
            .collect();
        codex_trust::ensure_trust(&cfg, &path, &event_commands)?;
    }
    Ok(read_codex_hooks_status())
}

pub fn uninstall_codex_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = codex_hooks_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.codex/hooks.json".into()))?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        if contains_managed(&text, AgentKind::Codex) {
            let mut doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
            strip_managed(&mut doc, AgentKind::Codex);
            let empty = doc
                .get("hooks")
                .and_then(Value::as_object)
                .map(|o| o.is_empty())
                .unwrap_or(true)
                && doc.as_object().map(|o| o.len() <= 1).unwrap_or(false);
            if empty {
                let _ = std::fs::remove_file(&path);
            } else {
                write_json_atomic(&path, &to_pretty(&doc))?;
            }
        }
    }
    if let Some(cfg) = codex_config_path() {
        let _ = codex_trust::remove_trust(&cfg, &path);
    }
    Ok(read_codex_hooks_status())
}

// ---------------------------------------------------------------------------
// OpenCode (in-process plugin, registered in opencode.json)
// ---------------------------------------------------------------------------

pub fn read_opencode_hooks_status() -> AgentHooksStatus {
    let Some(path) = opencode_plugin_path() else {
        return AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: "home directory not resolvable".to_string(),
        };
    };
    let path_str = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => AgentHooksStatus {
            installed: text.contains(OPENCODE_PLUGIN_MARKER),
            file_exists: true,
            unavailable: false,
            detail: format!("plugin at {path_str}"),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: false,
            detail: format!("file not present at {path_str}"),
        },
        Err(err) => AgentHooksStatus {
            installed: false,
            file_exists: true,
            unavailable: true,
            detail: err.to_string(),
        },
    }
}

pub fn install_opencode_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = opencode_plugin_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve OpenCode plugins dir".into()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // OpenCode auto-discovers any file in its `plugins/` dir — dropping the file is
    // all it takes. We deliberately do NOT touch `opencode.json`: it has no
    // `plugins` key in its schema (writing one makes OpenCode reject the whole
    // config). Repair a bad `plugins` key a previous build may have written.
    write_if_changed(&path, OPENCODE_STATUS_PLUGIN)?;
    if let Some(cfg) = opencode_config_path() {
        let _ = repair_opencode_config(&cfg, &path);
    }
    Ok(read_opencode_hooks_status())
}

pub fn uninstall_opencode_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = opencode_plugin_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve OpenCode plugins dir".into()))?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        if text.contains(OPENCODE_PLUGIN_MARKER) {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Some(cfg) = opencode_config_path() {
        let _ = repair_opencode_config(&cfg, &path);
    }
    Ok(read_opencode_hooks_status())
}

/// Remove an invalid `plugins` key from `opencode.json` if it references our
/// plugin (an earlier build wrote it there, which OpenCode rejects with
/// "Unrecognized key: plugins"). Only rewrites when it actually changed something,
/// and never touches a `plugins` key that doesn't mention our plugin.
fn repair_opencode_config(config_path: &Path, plugin: &Path) -> Result<(), AppError> {
    let text = match std::fs::read_to_string(config_path) {
        Ok(t) => t,
        Err(_) => return Ok(()),
    };
    let Ok(mut doc) = serde_json::from_str::<Value>(&text) else {
        return Ok(());
    };
    let plugin_str = fwd(&plugin.to_string_lossy());
    let ours = doc
        .get("plugins")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter().any(|v| {
                v.as_str()
                    .map(|s| fwd(s).contains(OPENCODE_PLUGIN_FILENAME) || fwd(s) == plugin_str)
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if ours {
        if let Some(obj) = doc.as_object_mut() {
            obj.remove("plugins");
        }
        write_json_atomic(config_path, &to_pretty(&doc))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Pi / OMP (in-process extension)
// ---------------------------------------------------------------------------

pub fn read_pi_hooks_status() -> AgentHooksStatus {
    let Some(path) = pi_extension_path() else {
        return AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: "home directory not resolvable".to_string(),
        };
    };
    let path_str = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => AgentHooksStatus {
            installed: text.contains(PI_EXTENSION_MARKER),
            file_exists: true,
            unavailable: false,
            detail: format!("extension at {path_str}"),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: false,
            detail: format!("file not present at {path_str}"),
        },
        Err(err) => AgentHooksStatus {
            installed: false,
            file_exists: true,
            unavailable: true,
            detail: err.to_string(),
        },
    }
}

pub fn install_pi_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = pi_extension_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.pi/agent/extensions".into()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Never clobber a user-authored file of the same name: only (re)write our own.
    match std::fs::read_to_string(&path) {
        Ok(text) if !text.contains(PI_EXTENSION_MARKER) => {
            return Ok(AgentHooksStatus {
                installed: false,
                file_exists: true,
                unavailable: true,
                detail: format!(
                    "a non-managed file already exists at {}",
                    path.to_string_lossy()
                ),
            });
        }
        _ => {}
    }
    write_if_changed(&path, PI_STATUS_EXTENSION)?;
    Ok(read_pi_hooks_status())
}

pub fn uninstall_pi_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = pi_extension_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.pi/agent/extensions".into()))?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        if text.contains(PI_EXTENSION_MARKER) {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(read_pi_hooks_status())
}

// ---------------------------------------------------------------------------
// Aggregate install used at startup ("out of the box")
// ---------------------------------------------------------------------------

/// Install the managed hooks for every supported agent (idempotent). Each agent
/// is independent: a failure installing one does not abort the others.
pub fn install_all(install: &HookInstall) {
    fn log(name: &str, result: Result<AgentHooksStatus, AppError>) {
        if let Err(e) = result {
            eprintln!("[uxnan-desktop] auto-install of {name} hooks failed: {e}");
        }
    }
    let relay = &install.status_relay_script;
    log("claude", install_claude_hooks(relay));
    log("gemini", install_gemini_hooks(relay));
    log("codex", install_codex_hooks(install));
    log("opencode", install_opencode_hooks());
    log("pi", install_pi_hooks());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_install_and_report_paths() {
        let tmp = std::env::temp_dir().join(format!("uxnan-hooks-{}", uuid::Uuid::new_v4()));
        let install = install_scripts_to(&tmp).expect("install succeeds");
        assert!(Path::new(&install.status_relay_script).is_file());
        assert!(Path::new(&install.codex_hook_sh).is_file());
        assert!(Path::new(&install.codex_hook_cmd).is_file());
        assert!(Path::new(&install.pi_extension_script).is_file());
        assert!(install.codex_hooks_path.contains("hooks.json"));
        assert!(install.pi_extension_path.contains(PI_EXTENSION_FILENAME));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn claude_merge_is_idempotent_and_reversible() {
        let relay = "/tmp/uxnan-status-relay.cjs";
        let mut doc = read_hooks_doc("{}");
        let entry = claude_hook_entry(relay);
        for (event, has_matcher) in CLAUDE_EVENTS {
            let m = if *has_matcher { Some("") } else { None };
            merge_event(&mut doc, event, m, &entry, AgentKind::Claude);
        }
        let text = to_pretty(&doc);
        assert!(contains_managed(&text, AgentKind::Claude));
        // Re-merge: still exactly one managed group under UserPromptSubmit.
        let mut doc2 = read_hooks_doc(&text);
        for (event, has_matcher) in CLAUDE_EVENTS {
            let m = if *has_matcher { Some("") } else { None };
            merge_event(&mut doc2, event, m, &entry, AgentKind::Claude);
        }
        assert_eq!(
            doc2["hooks"]["UserPromptSubmit"].as_array().unwrap().len(),
            1
        );
        strip_managed(&mut doc2, AgentKind::Claude);
        assert!(!contains_managed(&to_pretty(&doc2), AgentKind::Claude));
    }

    #[test]
    fn merge_preserves_user_hooks() {
        let user = r#"{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}"#;
        let relay = "/tmp/uxnan-status-relay.cjs";
        let mut doc = read_hooks_doc(user);
        let entry = claude_hook_entry(relay);
        merge_event(
            &mut doc,
            "UserPromptSubmit",
            None,
            &entry,
            AgentKind::Claude,
        );
        let arr = doc["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "user hook + our hook coexist");
        strip_managed(&mut doc, AgentKind::Claude);
        // The user's hook survives an uninstall.
        assert_eq!(
            doc["hooks"]["UserPromptSubmit"].as_array().unwrap().len(),
            1
        );
        assert!(to_pretty(&doc).contains("echo hi"));
    }

    #[test]
    fn is_managed_hook_distinguishes_agents() {
        let claude = claude_hook_entry("/x/uxnan-status-relay.cjs");
        let gemini = gemini_hook_entry("/x/uxnan-status-relay.cjs");
        assert!(is_managed_hook(&claude, AgentKind::Claude));
        assert!(!is_managed_hook(&claude, AgentKind::Gemini));
        assert!(is_managed_hook(&gemini, AgentKind::Gemini));
        assert!(!is_managed_hook(&gemini, AgentKind::Claude));
    }

    #[test]
    fn gemini_entry_uses_ms_timeout() {
        let g = gemini_hook_entry("/x/uxnan-status-relay.cjs");
        assert_eq!(g["timeout"], json!(GEMINI_TIMEOUT_MS));
    }

    #[test]
    fn strip_removes_legacy_claude_marker_and_dedicated_cjs() {
        // A pre-relay Claude config: the invalid top-level marker Claude warns
        // about + a dedicated-cjs hook that now points at a deleted script.
        let legacy = r#"{
          "hooks": {
            "__uxnan_managed_hooks__": true,
            "PreCompact": [{"hooks":[{"type":"command","command":"node \"/x/uxnan-claude-hook.cjs\""}]}],
            "UserPromptSubmit": [{"hooks":[{"type":"command","command":"node \"/x/uxnan-claude-hook.cjs\""}]}]
          }
        }"#;
        // The legacy cjs is recognised as managed so it gets swept…
        let hook = json!({ "type": "command", "command": "node \"/x/uxnan-claude-hook.cjs\"" });
        assert!(is_managed_hook(&hook, AgentKind::Claude));
        let mut doc: Value = serde_json::from_str(legacy).unwrap();
        strip_managed(&mut doc, AgentKind::Claude);
        let out = to_pretty(&doc);
        assert!(!out.contains("__uxnan_managed_hooks__"), "marker removed");
        assert!(!out.contains("uxnan-claude-hook.cjs"), "legacy cjs swept");
        // Re-install then puts the current relay in, cleanly.
        ensure_hooks_object(&mut doc);
        let entry = claude_hook_entry("/x/uxnan-status-relay.cjs");
        for (event, has_matcher) in CLAUDE_EVENTS {
            let m = if *has_matcher { Some("") } else { None };
            merge_event(&mut doc, event, m, &entry, AgentKind::Claude);
        }
        assert!(contains_managed(&to_pretty(&doc), AgentKind::Claude));
    }

    #[test]
    fn codex_sweeps_legacy_node_relay_entry() {
        // A prior build wired Codex through the node relay; the current curl hook
        // install must sweep it so they don't double-report.
        let legacy = json!({
            "type": "command",
            "command": "node \"/x/uxnan-status-relay.cjs\" --agent codex"
        });
        assert!(is_managed_hook(&legacy, AgentKind::Codex));
        let mut doc = json!({ "hooks": { "PreToolUse": [ { "hooks": [ legacy ] } ] } });
        strip_managed(&mut doc, AgentKind::Codex);
        assert!(!contains_managed(&to_pretty(&doc), AgentKind::Codex));
    }

    #[test]
    fn opencode_repair_removes_only_our_invalid_plugins_key() {
        let tmp = std::env::temp_dir().join(format!("uxnan-oc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cfg = tmp.join("opencode.json");
        let plugin = tmp.join("plugins").join(OPENCODE_PLUGIN_FILENAME);
        // opencode.json with the invalid `plugins` key a prior build wrote.
        std::fs::write(
            &cfg,
            format!(
                "{{\"theme\":\"dark\",\"plugins\":[\"{}\"]}}",
                fwd(&plugin.to_string_lossy())
            ),
        )
        .unwrap();
        repair_opencode_config(&cfg, &plugin).unwrap();
        let out = std::fs::read_to_string(&cfg).unwrap();
        assert!(!out.contains("plugins"), "invalid key removed");
        assert!(out.contains("theme"), "user config preserved");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn render_gemini_json_is_valid_and_references_the_relay() {
        let json = render_gemini_settings_json("/x/uxnan-status-relay.cjs").unwrap();
        // Valid JSON, carries our relay + a Gemini turn event, tagged gemini.
        let _: Value = serde_json::from_str(&json).unwrap();
        assert!(json.contains("uxnan-status-relay.cjs"));
        assert!(json.contains("gemini"));
        assert!(json.contains("BeforeAgent"));
    }

    #[test]
    fn render_codex_json_is_valid_and_has_hooks_and_command() {
        let tmp = std::env::temp_dir().join(format!("uxnan-codexrender-{}", uuid::Uuid::new_v4()));
        let install = install_scripts_to(&tmp).expect("install succeeds");
        let json = render_codex_hooks_json(&install).unwrap();
        let doc: Value = serde_json::from_str(&json).unwrap();
        assert!(doc.get("hooks").is_some(), "hooks.json body");
        assert!(
            json.contains("uxnan-codex-hook"),
            "references the curl hook"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
