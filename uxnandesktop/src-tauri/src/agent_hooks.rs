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
//!   * **Claude Code** runs a tiny dependency-free Node relay
//!     (`uxnan-status-relay.cjs`) via *exec form* (`command:"node", args:[…]`),
//!     which bypasses the shell entirely.
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

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::codex_trust;
use crate::error::AppError;

// --- Bundled script sources (embedded at compile time) ---------------------

/// The Node relay used by Claude Code.
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
/// Amp in-process status plugin (its plugin API is its own, not OpenCode's).
pub const AMP_STATUS_PLUGIN: &str = include_str!("../../static/hooks/uxnan-amp-status.js");

/// The generic launcher wrappers (any CLI agent without a native hook surface).
/// Per-event `curl` reporter with the agent kind passed as an argument — Grok and
/// Antigravity are single native binaries (Rust / Go) with no Node guarantee, so
/// they use this rather than Claude's Node relay.
pub const EVENT_HOOK_SH: &str = include_str!("../../static/hooks/uxnan-event-hook.sh");
pub const EVENT_HOOK_CMD: &str = include_str!("../../static/hooks/uxnan-event-hook.cmd");

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
const AMP_PLUGIN_SRC_FILENAME: &str = "uxnan-amp-status.js";
const EVENT_HOOK_SH_FILENAME: &str = "uxnan-event-hook.sh";
const EVENT_HOOK_CMD_FILENAME: &str = "uxnan-event-hook.cmd";

/// Prefix every script we write into the hooks dir carries. The dir is ours, so
/// a `uxnan-*` file we did NOT just write is by definition from an older build:
/// [`sweep_foreign_scripts`] deletes those without needing a list to maintain.
/// (Non-prefixed files we own — the `endpoint.*` coordinates file — are left
/// alone by the same rule.)
const SCRIPT_PREFIX: &str = "uxnan-";

/// Filename stems of reporters earlier builds installed, matched inside an agent
/// **config** entry. Deleting the script is not enough: the entry that invokes it
/// lives in the agent's own config, which we can only match by name — so unlike
/// the dir sweep this list has to be maintained, and **renaming a reporter means
/// adding its old stem here**. Stem-only so any path spelling or extension hits.
///
/// This is not hygiene for its own sake. The pre-relay `uxnan-agent-status-hook`
/// read its agent type from a `UXNAN_AGENT_TYPE` env var we stopped injecting, so
/// it reported the literal `"agent"` — mislabelling the tab's captured session
/// (which then has no resume entry) and dropping the state (no `normalize_event`
/// arm matches). It stayed registered in `~/.codex/hooks.json` long after the
/// script stopped shipping, and being a Node program it outran the current curl
/// hook, so its report usually won.
const LEGACY_REPORTER_STEMS: &[&str] = &[
    "uxnan-agent-status-hook",
    "uxnan-claude-hook",
    "uxnan-opencode-hook",
];
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
const AMP_PLUGIN_MARKER: &str = "Uxnan Desktop - Amp status plugin";

/// Per-hook timeout (seconds) for the node-relay agents; short because the
/// report is fire-and-forget.
const RELAY_TIMEOUT_SECS: u32 = 10;
const RELAY_TIMEOUT_MS: u32 = 10_000;

/// The agent kinds whose reporter lives in a JSON `hooks` block (so a managed
/// entry can be matched + swept). OpenCode (a plugin) and Pi (an extension)
/// don't live in a `hooks` block, so they aren't `AgentKind`s. Antigravity keys
/// its config by hook *name* rather than by event, so it doesn't share this
/// merge machinery either (see the Antigravity section).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Claude,
    Codex,
    /// Upgrade-only matcher for reporter entries written by older releases.
    RetiredGemini,
    Grok,
    /// Any agent whose managed entry is the shared per-event reporter carrying
    /// its own kind as an argument (`uxnan-event-hook.cmd cursor`). One variant
    /// serves them all because the tag in the command is what identifies the
    /// entry as ours *and* whose it is — see [`TABLE_AGENTS`].
    Tagged(&'static str),
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

/// Grok hook events → `hooks` block, same grouped shape as Claude's (Grok loads a
/// Claude settings file unchanged, so its vocabulary *is* Claude's). `true` =
/// attach an all-tools matcher. `StopFailure` is Grok's own: a turn that died on
/// an API error, which is a real `blocked` rather than an inferred one.
const GROK_EVENTS: &[(&str, bool)] = &[
    ("SessionStart", false),
    ("UserPromptSubmit", false),
    ("PreToolUse", true),
    ("PostToolUse", true),
    ("PostToolUseFailure", true),
    ("Notification", false),
    ("Stop", false),
    ("StopFailure", false),
    ("SessionEnd", false),
    ("SubagentStart", false),
    ("SubagentStop", false),
];

/// Antigravity's tool events, which take the grouped `matcher` + `hooks` shape.
const ANTIGRAVITY_TOOL_EVENTS: &[&str] = &["PreToolUse", "PostToolUse"];

/// Antigravity's loop events, which take a **flat** list of handler objects (no
/// `matcher`/`hooks` wrapper) — its config format differs per event, verified
/// against the CLI's own bundled `agy-customizations` guide.
///
/// There is deliberately no `waiting` source here: Antigravity exposes only
/// execution-loop events — no prompt, permission or notification hook — so it can
/// report `working` and `done` precisely and can never claim to need the user.
const ANTIGRAVITY_LOOP_EVENTS: &[&str] = &["PreInvocation", "PostInvocation", "Stop"];

/// The name our managed Antigravity hook is filed under in its `hooks.json`
/// (which is keyed by hook name, not by event). Owning one key means install and
/// uninstall are a single insert/remove that can't disturb anyone else's hooks.
const ANTIGRAVITY_HOOK_NAME: &str = "uxnan-status";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// The current user's home directory (`%USERPROFILE%` on Windows, `$HOME`
/// elsewhere). `pub(crate)` so the hook server can resolve the `~/.claude`
/// transcript base from the same source of truth.
pub(crate) fn home_dir() -> Option<PathBuf> {
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

/// Grok merges every `*.json` under this directory, so our reporter gets a file
/// of its own — install writes it, uninstall deletes it, and a user's own hooks
/// are never read, rewritten or risked. Global hooks need no folder-trust grant.
fn grok_hooks_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".grok")
            .join("hooks")
            .join("uxnan-status.json"),
    )
}

/// Antigravity's machine-global customization directory. Its `hooks.json` lives
/// here, and so does our reporter script — see [`antigravity_hook_command`] for
/// why the script has to sit next to the config rather than in our own hooks dir.
fn antigravity_config_dir() -> Option<PathBuf> {
    Some(home_dir()?.join(".gemini").join("config"))
}

fn antigravity_hooks_path() -> Option<PathBuf> {
    Some(antigravity_config_dir()?.join("hooks.json"))
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
    /// The Node relay used by Claude Code.
    pub status_relay_script: String,
    /// Codex `curl` hook (POSIX).
    pub codex_hook_sh: String,
    /// Codex `curl` hook (Windows).
    pub codex_hook_cmd: String,
    /// OpenCode plugin source (in the hooks dir; installed into OpenCode's dir).
    pub opencode_plugin_script: String,
    /// Pi/OMP extension source (in the hooks dir; installed into Pi's dir).
    pub pi_extension_script: String,
    /// Generic per-event `curl` reporter (POSIX) — Grok + Antigravity.
    pub event_hook_sh: String,
    /// Generic per-event `curl` reporter (Windows) — Grok + Antigravity.
    pub event_hook_cmd: String,
    pub wrapper_bash: String,
    pub wrapper_powershell: String,
    pub wrapper_cmd: String,
    pub wrapper_fish: String,
    pub browser_shim_bash: String,
    pub browser_shim_cmd: String,
    /// Where each agent's managed config lives (shown in the UI).
    pub claude_settings_path: String,
    pub codex_hooks_path: String,
    pub opencode_plugin_path: String,
    pub pi_extension_path: String,
    pub grok_hooks_path: String,
    pub antigravity_hooks_path: String,
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
    // Amp's plugin ships here like the others so it is inspectable on disk and
    // survives the sweep below; it is installed into Amp's own plugin dir from
    // the embedded copy, so no path of it needs to be reported to the UI.
    let amp = write(AMP_PLUGIN_SRC_FILENAME, AMP_STATUS_PLUGIN)?;
    let bash = write(WRAPPER_BASH_FILENAME, WRAPPER_BASH)?;
    let ps = write(WRAPPER_POWERSHELL_FILENAME, WRAPPER_POWERSHELL)?;
    let cmd = write(WRAPPER_CMD_FILENAME, WRAPPER_CMD)?;
    let fish = write(WRAPPER_FISH_FILENAME, WRAPPER_FISH)?;
    let browser_bash = write(BROWSER_SHIM_BASH_FILENAME, BROWSER_SHIM_BASH)?;
    let browser_cmd = write(BROWSER_SHIM_CMD_FILENAME, BROWSER_SHIM_CMD)?;
    let event_sh = write(EVENT_HOOK_SH_FILENAME, EVENT_HOOK_SH)?;
    let event_cmd = write(EVENT_HOOK_CMD_FILENAME, EVENT_HOOK_CMD)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for f in [&codex_sh, &bash, &fish, &browser_bash, &event_sh] {
            let _ = std::fs::set_permissions(f, std::fs::Permissions::from_mode(0o755));
        }
    }
    // Everything this build ships is now on disk, so anything else of ours in
    // here came from an older one — drop it. Done AFTER the writes so the keep
    // list is derived from what we actually wrote rather than restated (a
    // restated list is what drifts), which makes a future rename self-cleaning:
    // the old name simply stops being written and is swept on the next launch.
    sweep_foreign_scripts(
        &dir,
        &[
            &relay,
            &codex_sh,
            &codex_cmd,
            &opencode,
            &pi,
            &amp,
            &bash,
            &ps,
            &cmd,
            &fish,
            &browser_bash,
            &browser_cmd,
            &event_sh,
            &event_cmd,
        ],
    );
    let path_str = |p: &Path| p.to_string_lossy().into_owned();
    let opt = |p: Option<PathBuf>| p.map(|p| path_str(&p)).unwrap_or_default();
    Ok(HookInstall {
        dir: path_str(&dir),
        status_relay_script: path_str(&relay),
        codex_hook_sh: path_str(&codex_sh),
        codex_hook_cmd: path_str(&codex_cmd),
        opencode_plugin_script: path_str(&opencode),
        pi_extension_script: path_str(&pi),
        event_hook_sh: path_str(&event_sh),
        event_hook_cmd: path_str(&event_cmd),
        wrapper_bash: path_str(&bash),
        wrapper_powershell: path_str(&ps),
        wrapper_cmd: path_str(&cmd),
        wrapper_fish: path_str(&fish),
        browser_shim_bash: path_str(&browser_bash),
        browser_shim_cmd: path_str(&browser_cmd),
        claude_settings_path: opt(claude_settings_path()),
        codex_hooks_path: opt(codex_hooks_path()),
        opencode_plugin_path: opt(opencode_plugin_path()),
        pi_extension_path: opt(pi_extension_path()),
        grok_hooks_path: opt(grok_hooks_path()),
        antigravity_hooks_path: opt(antigravity_hooks_path()),
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

/// POSIX single-quote a string for safe interpolation into an `sh` command: wrap
/// in `'…'` and replace every embedded `'` with `'\''` (close quote, escaped
/// quote, reopen quote). For a string with no `'` this is exactly `'<s>'`, so the
/// common Codex hook path is byte-identical to the previous hand-written quoting
/// (the golden `trusted_hash` vectors stay valid). A stray `'` in the path — a
/// POSIX home-dir edge case — can no longer break out of the quoting.
fn sh_squote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
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

/// Windows' 8.3 short form of `path` (`C:\Users\JOHNSM~1\…`), or `None` when the
/// OS can't produce one (8.3 generation is disabled on the volume, or the path
/// doesn't exist yet).
///
/// Needed because Grok parses its hook `command` as a literal executable path
/// followed by whitespace-separated arguments — it does **not** honour quoting,
/// so a path containing a space cannot be expressed at all. Verified against the
/// real CLI: quoted, `call`-wrapped and doubly-quoted forms are all skipped
/// silently, while the 8.3 form runs. Users whose account name has no space never
/// reach this.
#[cfg(windows)]
fn short_path(path: &str) -> Option<String> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // First call sizes the buffer (0 = the call failed, e.g. no 8.3 on this volume).
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if len == 0 {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    let written = unsafe { GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), len) };
    if written == 0 || written as usize > buf.len() {
        return None;
    }
    buf.truncate(written as usize);
    Some(
        std::ffi::OsString::from_wide(&buf)
            .to_string_lossy()
            .into_owned(),
    )
}

#[cfg(not(windows))]
fn short_path(_path: &str) -> Option<String> {
    None
}

/// A script path in a form a CLI that can't parse quotes will accept: the path
/// itself when it has no space, else its 8.3 short form. `None` when the path
/// contains a space and the OS won't shorten it — the caller then reports the
/// agent as unavailable instead of writing a hook that would silently never run.
fn unquotable_path(path: &str) -> Option<String> {
    let slashed = fwd(path);
    if !slashed.contains(' ') {
        return Some(slashed);
    }
    short_path(path)
        .map(|s| fwd(&s))
        .filter(|s| !s.contains(' '))
}

/// The Grok hook command: our per-event reporter plus the agent kind as its
/// argument. Grok is a Rust binary with no Node guarantee, so this is the `curl`
/// reporter rather than the Node relay.
fn grok_hook_command(install: &HookInstall) -> Option<String> {
    let script = if cfg!(windows) {
        &install.event_hook_cmd
    } else {
        &install.event_hook_sh
    };
    Some(format!("{} grok", unquotable_path(script)?))
}

fn grok_hook_entry(command: &str) -> Value {
    json!({
        "type": "command",
        "command": command,
        "timeout": RELAY_TIMEOUT_SECS
    })
}

/// The Antigravity hook command. Antigravity has the same no-quoting limitation
/// as Grok, but its own docs pin the hook's working directory to the folder
/// holding `hooks.json` — so the reporter is copied next to that config and
/// invoked **dot-relative**. The command string then contains no path at all,
/// which is what makes it survive a home directory with a space in it (verified
/// against the real CLI both ways).
///
/// The event name rides along as a **second argument** because Antigravity's
/// payload does not carry one: measured against the real CLI, its bodies hold
/// `invocationNum` / `fullyIdle` / `terminationReason` and no event field at
/// all, so every report arrived with nothing to say which event fired and was
/// dropped — which is why Antigravity never reached `done`, and therefore never
/// got a generated name. Registration is already per event, so the name is known
/// here and travels to the server as `X-Uxnan-Event`.
fn antigravity_hook_command(event: &str) -> String {
    if cfg!(windows) {
        format!(".\\{EVENT_HOOK_CMD_FILENAME} antigravity {event}")
    } else {
        format!("./{EVENT_HOOK_SH_FILENAME} antigravity {event}")
    }
}

/// The Codex hook command string (the exact bytes folded into the trust hash).
/// POSIX wraps `/bin/sh` behind an `[ -x ]` guard (a missing script is a silent
/// no-op, never a `127`); Windows invokes the `.cmd` directly via Codex's `cmd`
/// hook runner.
fn codex_command(install: &HookInstall) -> String {
    if cfg!(windows) {
        install.codex_hook_cmd.clone()
    } else {
        // Single-quote the path so a `'` in it can't break out of the quoting.
        // For a quote-free path this is byte-identical to the previous `'{sh}'`,
        // keeping the golden `trusted_hash` vectors valid.
        let sh = sh_squote(&install.codex_hook_sh);
        format!("if [ -x {sh} ]; then /bin/sh {sh}; fi")
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
    // A reporter from an earlier build is ours whatever config it sits in, so it
    // is swept regardless of `kind` — the pre-relay one actively breaks the
    // current install (see `LEGACY_REPORTER_STEMS`), and older integrations shared it,
    // so it carries no agent tag to match on.
    if is_legacy_reporter(&text) {
        return true;
    }
    match kind {
        // `uxnan-claude-hook` is the legacy dedicated cjs (pre-relay); match it too
        // so an upgrade sweeps the stale entry that now points at a deleted script.
        AgentKind::Claude => {
            text.contains("uxnan-claude-hook")
                || (text.contains(STATUS_RELAY_FILENAME) && text.contains("claude"))
        }
        AgentKind::RetiredGemini => text.contains(STATUS_RELAY_FILENAME) && text.contains("gemini"),
        // Matched on the reporter + the agent tag, so a moved hooks dir or a
        // switch to/from the 8.3 short form still sweeps the stale entry.
        AgentKind::Grok => {
            (text.contains(EVENT_HOOK_SH_FILENAME) || text.contains(EVENT_HOOK_CMD_FILENAME))
                && text.contains("grok")
        }
        // `uxnan-codex-hook` is the current curl hook; the relay match sweeps the
        // legacy node-relay entry a prior build wrote for Codex.
        AgentKind::Codex => {
            text.contains("uxnan-codex-hook")
                || (text.contains(STATUS_RELAY_FILENAME) && text.contains("codex"))
        }
        // Same rule as Grok's, with the tag supplied by the table: the reporter
        // filename proves the entry is ours, the tag proves it is this agent's.
        // Requiring both is what stops one agent's uninstall from stripping
        // another's entry out of a shared config file.
        AgentKind::Tagged(tag) => {
            (text.contains(EVENT_HOOK_SH_FILENAME) || text.contains(EVENT_HOOK_CMD_FILENAME))
                && text.contains(tag)
        }
    }
}

/// Whether a hook entry's text references a reporter script an earlier build
/// installed and we no longer ship. `text` must already be forward-slashed
/// ([`fwd`]) and is matched case-insensitively — Windows configs hold the path in
/// whatever spelling the writing build used.
fn is_legacy_reporter(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    LEGACY_REPORTER_STEMS.iter().any(|s| lower.contains(s))
}

/// Delete every `uxnan-*` script in our hooks dir that this build did not just
/// write — by definition a leftover from an older one. `keep` is the set of files
/// [`install_scripts_to`] produced this run.
///
/// Scoped three ways so it can only ever remove our own leavings: the dir is
/// app-data we own, only files carrying [`SCRIPT_PREFIX`] are considered (so the
/// `endpoint.*` coordinates file and anything a user dropped in survive), and
/// only regular files are touched. Best-effort throughout — this runs on every
/// startup and must never be able to fail a launch.
fn sweep_foreign_scripts(dir: &Path, keep: &[&Path]) {
    // Windows paths are case-insensitive; compare on the lowercased file name.
    let keep: HashSet<String> = keep
        .iter()
        .filter_map(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .collect();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.starts_with(SCRIPT_PREFIX) || keep.contains(&name) {
            continue;
        }
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Legacy top-level marker the pre-relay Claude installer wrote into the `hooks`
/// object. It isn't a valid Claude hook event, so current Claude Code warns about
/// it on startup — remove it whenever we touch the config.
const LEGACY_CLAUDE_MARKER: &str = "__uxnan_managed_hooks__";

// ---------------------------------------------------------------------------
// Shared JSON `hooks` block merge (Claude / Codex and compatible agents)
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

/// Merge one managed entry into `doc.hooks[event]` for a CLI that puts the
/// command **directly on the definition** instead of nesting it under a `hooks`
/// array (Cursor's schema). Same contract as [`merge_event`]: any prior managed
/// entry of ours is stripped first, so re-installing converges on one.
fn merge_event_flat(doc: &mut Value, event: &str, entry: &Value, kind: AgentKind) {
    if !doc["hooks"]
        .get(event)
        .map(Value::is_array)
        .unwrap_or(false)
    {
        doc["hooks"][event] = json!([]);
    }
    if let Some(arr) = doc["hooks"][event].as_array_mut() {
        arr.retain(|definition| !is_managed_hook(definition, kind));
        arr.push(entry.clone());
    }
}

/// Strip every managed group for `kind` from a `hooks` document, dropping now-empty
/// event buckets and an empty top-level `hooks`.
///
/// Both shapes are swept in one pass — the grouped one (a managed command nested
/// under `hooks`) and the flat one (the command on the definition itself) —
/// because an agent can be re-registered under either and a half-swept config
/// leaves a second entry firing for every event.
fn strip_managed(doc: &mut Value, kind: AgentKind) {
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    // Drop the legacy pre-relay marker that Claude Code warns about.
    hooks.remove(LEGACY_CLAUDE_MARKER);
    for groups in hooks.values_mut() {
        if let Some(arr) = groups.as_array_mut() {
            arr.retain(|group| {
                let grouped = group
                    .get("hooks")
                    .and_then(Value::as_array)
                    .map(|hs| hs.iter().any(|h| is_managed_hook(h, kind)))
                    .unwrap_or(false);
                !(grouped || is_managed_hook(group, kind))
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
                    is_managed_hook(group, kind)
                        || group
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

/// Upgrade-only cleanup for Uxnan-managed Gemini reporter entries. It recognizes
/// only Uxnan's relay marker and preserves every user-authored hook and setting.
fn cleanup_retired_gemini_hooks() -> Result<(), AppError> {
    let Some(path) = gemini_settings_path() else {
        return Ok(());
    };
    if let Ok(text) = std::fs::read_to_string(&path) {
        if contains_managed(&text, AgentKind::RetiredGemini) {
            let mut doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
            strip_managed(&mut doc, AgentKind::RetiredGemini);
            write_json_atomic(&path, &to_pretty(&doc))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Grok (its own file under ~/.grok/hooks/)
// ---------------------------------------------------------------------------

/// The document written to `~/.grok/hooks/uxnan-status.json`.
fn grok_hooks_doc(command: &str) -> Value {
    let entry = grok_hook_entry(command);
    let mut doc = json!({ "hooks": {} });
    for (event, has_matcher) in GROK_EVENTS {
        let matcher = if *has_matcher { Some("") } else { None };
        merge_event(&mut doc, event, matcher, &entry, AgentKind::Grok);
    }
    doc
}

pub fn read_grok_hooks_status() -> AgentHooksStatus {
    status_from_config(grok_hooks_path(), AgentKind::Grok, "uxnan-status.json")
}

pub fn install_grok_hooks(install: &HookInstall) -> Result<AgentHooksStatus, AppError> {
    let path = grok_hooks_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.grok/hooks/".into()))?;
    let Some(command) = grok_hook_command(install) else {
        return Err(AppError::Invalid(format!(
            "the hooks folder path contains a space and Windows won't shorten it \
             ({}). Grok runs a hook command as a literal path and cannot quote it, \
             so no hook can be installed from here.",
            install.dir
        )));
    };
    write_json_atomic(&path, &to_pretty(&grok_hooks_doc(&command)))?;
    Ok(read_grok_hooks_status())
}

pub fn uninstall_grok_hooks() -> Result<AgentHooksStatus, AppError> {
    let path = grok_hooks_path()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.grok/hooks/".into()))?;
    // The file is entirely ours, so removing it is the whole uninstall — no
    // user-authored hook can be sitting in it to preserve.
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(read_grok_hooks_status())
}

/// Render the file the ADE writes into `~/.grok/hooks/` (Settings "Show config").
pub fn render_grok_hooks_json(install: &HookInstall) -> Result<String, AppError> {
    let command = grok_hook_command(install).unwrap_or_else(|| "<unavailable>".to_string());
    serde_json::to_string_pretty(&grok_hooks_doc(&command)).map_err(AppError::Serde)
}

// ---------------------------------------------------------------------------
// Antigravity (a named entry in ~/.gemini/config/hooks.json)
// ---------------------------------------------------------------------------

/// Our named hook's value: one handler per event, in the shape each event wants
/// (grouped with a `matcher` for the tool events, a flat list for the loop ones).
fn antigravity_hook_value() -> Value {
    let handler = |event: &str| {
        json!({
            "type": "command",
            "command": antigravity_hook_command(event),
            "timeout": RELAY_TIMEOUT_SECS
        })
    };
    let mut named = serde_json::Map::new();
    for event in ANTIGRAVITY_LOOP_EVENTS {
        named.insert((*event).to_string(), json!([handler(event)]));
    }
    for event in ANTIGRAVITY_TOOL_EVENTS {
        named.insert(
            (*event).to_string(),
            json!([{ "matcher": "*", "hooks": [handler(event)] }]),
        );
    }
    Value::Object(named)
}

/// `hooks.json` is a map of hook *name* → events, so our whole footprint is one
/// key. Read it back rather than scanning text: a name is an exact match, unlike
/// the substring sniffing the shared `hooks` block needs.
fn antigravity_installed(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|doc| doc.get(ANTIGRAVITY_HOOK_NAME).cloned())
        .is_some()
}

pub fn read_antigravity_hooks_status() -> AgentHooksStatus {
    let Some(path) = antigravity_hooks_path() else {
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
            installed: antigravity_installed(&text),
            file_exists: true,
            unavailable: false,
            detail: format!("hooks.json at {path_str}"),
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

pub fn install_antigravity_hooks() -> Result<AgentHooksStatus, AppError> {
    let dir = antigravity_config_dir()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.gemini/config/".into()))?;
    let path = dir.join("hooks.json");

    // The reporter lives beside the config because the command is dot-relative —
    // see `antigravity_hook_command`. Same pattern as OpenCode's plugin and Pi's
    // extension, which are also installed into the agent's own directory.
    std::fs::create_dir_all(&dir)?;
    let script = dir.join(if cfg!(windows) {
        EVENT_HOOK_CMD_FILENAME
    } else {
        EVENT_HOOK_SH_FILENAME
    });
    write_if_changed(
        &script,
        if cfg!(windows) {
            EVENT_HOOK_CMD
        } else {
            EVENT_HOOK_SH
        },
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: Value = serde_json::from_str(&existing).unwrap_or_else(|_| json!({}));
    if !doc.is_object() {
        doc = json!({});
    }
    doc[ANTIGRAVITY_HOOK_NAME] = antigravity_hook_value();
    write_json_atomic(&path, &to_pretty(&doc))?;
    Ok(read_antigravity_hooks_status())
}

pub fn uninstall_antigravity_hooks() -> Result<AgentHooksStatus, AppError> {
    let dir = antigravity_config_dir()
        .ok_or_else(|| AppError::Invalid("cannot resolve ~/.gemini/config/".into()))?;
    let path = dir.join("hooks.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(mut doc) = serde_json::from_str::<Value>(&text) {
            if let Some(obj) = doc.as_object_mut() {
                if obj.remove(ANTIGRAVITY_HOOK_NAME).is_some() {
                    write_json_atomic(&path, &to_pretty(&doc))?;
                }
            }
        }
    }
    // Our reporter copy goes too; anything else in that folder is not ours.
    let script = dir.join(if cfg!(windows) {
        EVENT_HOOK_CMD_FILENAME
    } else {
        EVENT_HOOK_SH_FILENAME
    });
    let _ = std::fs::remove_file(script);
    Ok(read_antigravity_hooks_status())
}

/// Render the named hook the ADE writes (Settings "Show config").
pub fn render_antigravity_hooks_json() -> Result<String, AppError> {
    serde_json::to_string_pretty(&json!({ ANTIGRAVITY_HOOK_NAME: antigravity_hook_value() }))
        .map_err(AppError::Serde)
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
// Declarative agents — one table row per CLI
// ---------------------------------------------------------------------------
//
// Everything below is driven by [`TABLE_AGENTS`]. The six agents above each
// needed their own installer because each is genuinely different (a Node relay,
// a trust-hashed command, an in-process plugin, a dot-relative reporter). The
// rest are not: they all run a command per event and pipe it their raw event
// JSON, so they share one reporter (`uxnan-event-hook`) and differ only in
// *where* the entry goes and *how* it is spelled. Encoding that as data instead
// of code is what keeps the eighteenth agent a table row rather than another
// 200 lines — and what makes "which agents do we support" answerable by reading
// one list.

/// Where the per-hook timeout goes and in what unit — the one thing every CLI
/// spells differently (seconds, milliseconds, or its own key).
#[derive(Debug, Clone, Copy)]
struct HookTimeout {
    key: &'static str,
    value: u32,
}

const TIMEOUT_SECS: HookTimeout = HookTimeout {
    key: "timeout",
    value: RELAY_TIMEOUT_SECS,
};
const TIMEOUT_MILLIS: HookTimeout = HookTimeout {
    key: "timeout",
    value: RELAY_TIMEOUT_MS,
};
/// GitHub Copilot's own spelling (`timeoutSec`), per its hooks reference.
const TIMEOUT_SEC_KEY: HookTimeout = HookTimeout {
    key: "timeoutSec",
    value: RELAY_TIMEOUT_SECS,
};

/// One event to register, and the matcher its CLI wants (if any).
#[derive(Debug, Clone, Copy)]
struct HookEvent {
    name: &'static str,
    /// `None` writes no `matcher` key. `Some(m)` writes it verbatim — the value
    /// is not cosmetic: Claude-family CLIs read `""`/`"*"` as "every tool" while
    /// the ones that treat a matcher as a **regex** (Command Code, Devin) reject
    /// `*` outright, so each agent states its own.
    matcher: Option<&'static str>,
}

const fn ev(name: &'static str) -> HookEvent {
    HookEvent {
        name,
        matcher: None,
    }
}

const fn ev_all(name: &'static str, matcher: &'static str) -> HookEvent {
    HookEvent {
        name,
        matcher: Some(matcher),
    }
}

/// How our reporter is written into the agent's configuration.
#[derive(Debug, Clone, Copy)]
enum HookLayout {
    /// Merged into the user's config under `hooks[event]`, in Claude's grouped
    /// shape: `[{ matcher?, hooks: [{ type, command, timeout }] }]`.
    Grouped(HookTimeout),
    /// Merged into the user's config under `hooks[event]`, as a flat list of
    /// command objects: `[{ command, timeout }]`. Cursor's shape.
    Flat(HookTimeout),
    /// A file that is entirely ours, holding a `hooks` object of flat command
    /// lists plus the `version` its CLI requires. Nothing of the user's is in
    /// it, so install writes it whole and uninstall deletes it.
    OwnFile(HookTimeout),
    /// A file that is entirely ours, holding a `hooks` object in Claude's
    /// **grouped** shape (`[{ matcher?, hooks: [...] }]`) and no `version` —
    /// the Open Plugins layout Goose reads.
    OwnGrouped(HookTimeout),
    /// A file that is entirely ours, holding a **list** of named hook objects
    /// (`{ name, trigger, action: { type, command } }`). Kiro's shape.
    OwnList,
    /// A marker-delimited block appended to the user's TOML config, because the
    /// CLI keeps its settings in TOML and we vendor no TOML writer: everything
    /// outside our markers is left byte-for-byte alone.
    TomlBlock,
    /// An in-process plugin dropped into the CLI's own plugin directory, which
    /// it auto-discovers — no config entry at all. The reporter runs *inside*
    /// the agent, so it reads the agent's own event bus rather than being handed
    /// one event per process, and posts straight to the hook server.
    ///
    /// The body is built per agent by [`plugin_body`], because these CLIs share
    /// one plugin API but not one identity: the same source has to declare which
    /// agent it speaks for, and Kilo wants a different export shape.
    Plugin,
}

/// A CLI whose managed reporter is fully described by data.
struct TableAgent {
    /// The hook agent type — posted as `X-Uxnan-Agent-Type`, matched by
    /// `hooks::normalize_event`, and the tag that identifies our entry in the
    /// agent's config. Must equal the arm name in the server's event table.
    id: &'static str,
    /// What the config file is called, for the status line shown in Settings.
    label: &'static str,
    /// The executable name this CLI puts on `PATH` — how we tell "the user has
    /// this agent" from "the user has never heard of it".
    command: &'static str,
    /// The config file this agent reads its hooks from.
    path: fn() -> Option<PathBuf>,
    layout: HookLayout,
    events: &'static [HookEvent],
}

/// Whether this CLI looks present on the machine: its executable is on `PATH`,
/// or it already has the config file we would be writing into.
///
/// The startup auto-install is gated on this. Writing `~/.factory/settings.json`
/// on a machine that has never had Droid would be creating another product's
/// config folder behind the user's back — harmless to the ADE, but not ours to
/// create. An explicit **Install** in Settings is not gated: asking for it is
/// answer enough.
fn table_agent_present(agent: &TableAgent) -> bool {
    if crate::which::resolve(agent.command).is_some() {
        return true;
    }
    let Some(path) = (agent.path)() else {
        return false;
    };
    if path.exists() {
        return true;
    }
    // For a plugin agent the file is what WE write, so its absence proves
    // nothing; the CLI's own plugin directory is the evidence. It also covers
    // the CLIs that install themselves outside `PATH` — OMP ships its binary
    // into a private dir, so nothing else here would ever find it.
    matches!(agent.layout, HookLayout::Plugin) && path.parent().map(|d| d.is_dir()).unwrap_or(false)
}

/// Claude's own event vocabulary, shared by every CLI that reimplements it.
/// `""` is its all-tools matcher.
const CLAUDE_SHAPED_EVENTS: &[HookEvent] = &[
    ev("UserPromptSubmit"),
    ev_all("PreToolUse", ""),
    ev_all("PostToolUse", ""),
    ev_all("PostToolUseFailure", ""),
    ev_all("PermissionRequest", ""),
    ev("Notification"),
    ev("Stop"),
    // A turn that died on an API/model error skips `Stop` entirely; without this
    // the card spins forever (the same gap Grok's `StopFailure` closes).
    ev("StopFailure"),
    ev("SessionStart"),
    ev("SessionEnd"),
    ev("SubagentStart"),
    ev("SubagentStop"),
];

/// The declaratively-wired agents, in the order Settings lists them.
const TABLE_AGENTS: &[TableAgent] = &[
    // Claude Code fork: same settings shape, same vocabulary, its own home.
    TableAgent {
        id: "openclaude",
        label: "settings.json",
        command: "openclaude",
        path: openclaude_settings_path,
        layout: HookLayout::Grouped(TIMEOUT_SECS),
        events: CLAUDE_SHAPED_EVENTS,
    },
    // Qwen Code speaks Claude's vocabulary but times out in MILLISECONDS, like
    // the Gemini CLI it descends from.
    TableAgent {
        id: "qwen",
        label: "settings.json",
        command: "qwen",
        path: qwen_settings_path,
        layout: HookLayout::Grouped(TIMEOUT_MILLIS),
        events: CLAUDE_SHAPED_EVENTS,
    },
    TableAgent {
        id: "droid",
        label: "settings.json",
        command: "droid",
        path: droid_settings_path,
        layout: HookLayout::Grouped(TIMEOUT_SECS),
        events: &[
            ev("UserPromptSubmit"),
            ev_all("PreToolUse", "*"),
            ev_all("PostToolUse", "*"),
            ev_all("PermissionRequest", "*"),
            ev("Stop"),
            ev("SessionStart"),
            ev("SubagentStop"),
        ],
    },
    // Devin reads a matcher as a REGEX and documents an absent one as "all", so
    // Claude's literal `*` (an invalid regex) must not be written here.
    TableAgent {
        id: "devin",
        label: "config.json",
        command: "devin",
        path: devin_config_path,
        layout: HookLayout::Grouped(TIMEOUT_SECS),
        events: &[
            ev("UserPromptSubmit"),
            ev("PreToolUse"),
            ev("PostToolUse"),
            ev("PermissionRequest"),
            ev("Stop"),
            ev("SessionStart"),
            ev("SessionEnd"),
            ev("PostCompaction"),
        ],
    },
    // Command Code exposes only the tool loop and the end of a turn — no prompt,
    // permission or session event — so it reports `working` and `done` and can
    // never claim to need the user.
    TableAgent {
        id: "commandcode",
        label: "settings.json",
        command: "command-code",
        path: commandcode_settings_path,
        layout: HookLayout::Grouped(TIMEOUT_SECS),
        events: &[
            ev_all("PreToolUse", ".*"),
            ev_all("PostToolUse", ".*"),
            ev("Stop"),
        ],
    },
    TableAgent {
        id: "auggie",
        label: "settings.json",
        command: "auggie",
        path: auggie_settings_path,
        layout: HookLayout::Grouped(TIMEOUT_SECS),
        events: &[
            ev_all("PreToolUse", "*"),
            ev_all("PostToolUse", "*"),
            ev("Stop"),
            ev("SessionStart"),
            ev("SessionEnd"),
        ],
    },
    // Cursor keeps the command ON the definition (Claude nests it under `hooks`)
    // and names its events in camelCase.
    TableAgent {
        id: "cursor",
        label: "hooks.json",
        command: "cursor-agent",
        path: cursor_hooks_path,
        layout: HookLayout::Flat(TIMEOUT_SECS),
        events: &[
            ev("beforeSubmitPrompt"),
            ev("preToolUse"),
            ev("postToolUse"),
            ev("postToolUseFailure"),
            ev("stop"),
            ev("sessionStart"),
            ev("sessionEnd"),
            ev("subagentStart"),
            ev("subagentStop"),
        ],
    },
    // Copilot loads every `*.json` in its hooks dir, so ours is a file of its
    // own — nothing of the user's is read or rewritten.
    TableAgent {
        id: "copilot",
        label: "uxnan-status.json",
        command: "copilot",
        path: copilot_hooks_path,
        layout: HookLayout::OwnFile(TIMEOUT_SEC_KEY),
        events: &[
            ev("userPromptSubmitted"),
            ev("preToolUse"),
            ev("postToolUse"),
            ev("postToolUseFailure"),
            ev("permissionRequest"),
            ev("agentStop"),
            ev("errorOccurred"),
            ev("sessionStart"),
            ev("sessionEnd"),
            ev("subagentStart"),
            ev("subagentStop"),
        ],
    },
    // Kiro merges every `*.json` under its global hooks dir, one file per hook
    // set, keyed by `trigger` rather than by event.
    TableAgent {
        id: "kiro",
        label: "uxnan-status.json",
        command: "kiro-cli",
        path: kiro_hooks_path,
        layout: HookLayout::OwnList,
        events: &[
            ev("UserPromptSubmit"),
            ev("PreToolUse"),
            ev("PostToolUse"),
            ev("Stop"),
            ev("SessionStart"),
        ],
    },
    // MiMo Code is a fork of OpenCode that renamed the packages and kept the
    // plugin API, so it runs OpenCode's reporter verbatim — only the agent kind
    // it declares differs (its own plugin dir, its own identity on the card).
    TableAgent {
        id: "mimo",
        label: "uxnan-status.js",
        command: "mimo",
        path: mimo_plugin_path,
        layout: HookLayout::Plugin,
        events: &[],
    },
    // OMP ships Pi's agent runtime under its own home, so it loads the very same
    // extension — only the kind it declares differs. Its own extensions dir:
    // installing into Pi's would leave OMP with nothing (the reason its reports
    // never appeared even though the server already understood its vocabulary).
    TableAgent {
        id: "omp",
        label: "uxnan-agent-status.js",
        command: "omp",
        path: omp_extension_path,
        layout: HookLayout::Plugin,
        events: &[],
    },
    // Kilo's plugin API is the same event bus with a different export shape.
    TableAgent {
        id: "kilocode",
        label: "uxnan-status.js",
        command: "kilo",
        path: kilo_plugin_path,
        layout: HookLayout::Plugin,
        events: &[],
    },
    // Amp has a plugin API of its own (`amp.on(...)`), so its reporter is its
    // own source rather than a variant of the shared one.
    TableAgent {
        id: "amp",
        label: "uxnan-status.js",
        command: "amp",
        path: amp_plugin_path,
        layout: HookLayout::Plugin,
        events: &[],
    },
    // Goose follows the Open Plugins hook spec: a plugin directory of our own
    // under `~/.agents/plugins/`, holding a Claude-shaped `hooks.json`. Nothing
    // of the user's is in it, so install writes it whole.
    TableAgent {
        id: "goose",
        label: "hooks.json",
        command: "goose",
        path: goose_hooks_path,
        layout: HookLayout::OwnGrouped(TIMEOUT_SECS),
        events: &[
            ev("UserPromptSubmit"),
            ev("PreToolUse"),
            ev("PostToolUse"),
            ev("PostToolUseFailure"),
            ev("Stop"),
            ev("SessionStart"),
            ev("SessionEnd"),
        ],
    },
    // Kimi Code keeps everything in TOML; ours is a marker-delimited block.
    TableAgent {
        id: "kimi",
        label: "config.toml",
        command: "kimi",
        path: kimi_config_path,
        layout: HookLayout::TomlBlock,
        events: &[
            ev("UserPromptSubmit"),
            ev("PreToolUse"),
            ev("PostToolUse"),
            ev("PostToolUseFailure"),
            ev("PermissionRequest"),
            ev("Stop"),
            ev("StopFailure"),
        ],
    },
];

fn table_agent(id: &str) -> Option<&'static TableAgent> {
    TABLE_AGENTS.iter().find(|a| a.id == id)
}

fn openclaude_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".openclaude").join("settings.json"))
}

fn qwen_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".qwen").join("settings.json"))
}

fn droid_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".factory").join("settings.json"))
}

/// Devin is the one that isn't under the home dir on Windows: it keeps its
/// config in `%APPDATA%`, and only falls back to `~/.config` elsewhere.
fn devin_config_path() -> Option<PathBuf> {
    if cfg!(windows) {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| Some(home_dir()?.join("AppData").join("Roaming")))?;
        return Some(base.join("devin").join("config.json"));
    }
    Some(
        home_dir()?
            .join(".config")
            .join("devin")
            .join("config.json"),
    )
}

fn commandcode_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".commandcode").join("settings.json"))
}

fn auggie_settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".augment").join("settings.json"))
}

fn cursor_hooks_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".cursor").join("hooks.json"))
}

/// Copilot's hooks dir, honouring `COPILOT_HOME` the way the CLI does.
fn copilot_hooks_path() -> Option<PathBuf> {
    let home = std::env::var_os("COPILOT_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| Some(home_dir()?.join(".copilot")))?;
    Some(home.join("hooks").join("uxnan-status.json"))
}

/// MiMo Code's plugin dir — its own, not OpenCode's (its loader only scans
/// `.mimocode`, which is exactly the mix-up its own docs had).
fn mimo_plugin_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".config")
            .join("mimocode")
            .join("plugins")
            .join(OPENCODE_PLUGIN_FILENAME),
    )
}

/// Kilo's global plugin dir (singular `plugin`, per its docs).
fn kilo_plugin_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".config")
            .join("kilo")
            .join("plugin")
            .join(OPENCODE_PLUGIN_FILENAME),
    )
}

fn omp_extension_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".omp")
            .join("agent")
            .join("extensions")
            .join(PI_EXTENSION_FILENAME),
    )
}

fn amp_plugin_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".config")
            .join("amp")
            .join("plugins")
            .join(OPENCODE_PLUGIN_FILENAME),
    )
}

/// The plugin source installed for `id`.
///
/// OpenCode, MiMo and Kilo share one reporter because they share one plugin API
/// (MiMo is a fork of OpenCode; Kilo reimplemented the same event bus). What
/// differs is the identity it declares — the agent kind is what the server maps
/// and what names the tab — and, for Kilo, the export shape its loader requires:
/// a default `{ id, server }` rather than a bare named factory. Rewriting those
/// two lines at install beats keeping three near-identical copies of a reporter
/// whose behavior was validated once.
/// The marker line that proves a plugin file on disk is ours to rewrite or
/// remove — the only thing standing between an install and a user's own file of
/// the same name.
fn plugin_marker(id: &str) -> &'static str {
    match id {
        "amp" => AMP_PLUGIN_MARKER,
        "omp" => PI_EXTENSION_MARKER,
        _ => OPENCODE_PLUGIN_MARKER,
    }
}

fn plugin_body(id: &str) -> String {
    if id == "amp" {
        return AMP_STATUS_PLUGIN.to_string();
    }
    if id == "omp" {
        // Pi's extension verbatim, speaking for OMP.
        return PI_STATUS_EXTENSION
            .replace("const AGENT_TYPE = \"pi\";", "const AGENT_TYPE = \"omp\";");
    }
    let body = OPENCODE_STATUS_PLUGIN.replace(
        "const AGENT_TYPE = \"opencode\";",
        &format!("const AGENT_TYPE = \"{id}\";"),
    );
    if id != "kilocode" {
        return body;
    }
    // Kilo's loader takes a default-exported descriptor, not a bare named
    // factory. Anchored on the single `export` line and with the descriptor
    // appended at the end — a multi-line anchor would silently stop matching the
    // day the file's line endings or spacing change, and the plugin would load
    // as nothing at all.
    let demoted = body.replace(
        "export const UxnanStatusPlugin = async () => ({",
        "const UxnanStatusPlugin = async () => ({",
    );
    format!(
        "{}\n// Kilo's loader takes a default-exported descriptor, not a bare factory.\n\
         export default {{ id: \"{MANAGED_HOOK_NAME}\", server: UxnanStatusPlugin }};\n",
        demoted.trim_end()
    )
}

/// Goose reads hooks from a plugin directory (the Open Plugins layout), so ours
/// gets its own plugin name rather than sharing a file with anyone.
fn goose_hooks_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".agents")
            .join("plugins")
            .join(MANAGED_HOOK_NAME)
            .join("hooks")
            .join("hooks.json"),
    )
}

fn kiro_hooks_path() -> Option<PathBuf> {
    Some(
        home_dir()?
            .join(".kiro")
            .join("hooks")
            .join("uxnan-status.json"),
    )
}

/// Kimi Code's config, honouring `KIMI_CODE_HOME` the way the CLI does.
fn kimi_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("KIMI_CODE_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| Some(home_dir()?.join(".kimi-code")))?;
    Some(home.join("config.toml"))
}

/// The command a table agent's config invokes: our shared per-event reporter,
/// told which agent it is speaking for.
///
/// **On Windows the path keeps its backslashes.** Grok's command is
/// forward-slashed (it runs the file directly, so either spelling resolves), and
/// reusing that spelling here looked harmless until it was run: a CLI that hands
/// the command to `cmd.exe` — measured against the real Cursor CLI — splits
/// `C:/Users/…/Roaming/…` at the first `/` and reports *"…oaming is not
/// recognized as an internal or external command"*. The native spelling is the
/// one every launcher understands: `CreateProcess`, `cmd.exe` and PowerShell all
/// take it, and no CLI on Windows hands a hook to a POSIX shell that would read
/// the backslashes as escapes.
///
/// Quoting is still not an option — several of these CLIs parse a hook command
/// as a literal path — so a space in the path falls back to the 8.3 short form,
/// and `None` (no short form available) makes the caller report the agent
/// unavailable rather than install a hook that could never run.
fn table_agent_command(id: &str, install: &HookInstall) -> Option<String> {
    let script = if cfg!(windows) {
        &install.event_hook_cmd
    } else {
        &install.event_hook_sh
    };
    Some(format!("{} {id}", native_unquotable_path(script)?))
}

/// [`unquotable_path`] in the platform's own path spelling: forward slashes on
/// POSIX, backslashes on Windows. See [`table_agent_command`] for why the
/// difference is load-bearing.
fn native_unquotable_path(path: &str) -> Option<String> {
    if !cfg!(windows) {
        return unquotable_path(path);
    }
    let native = path.replace('/', "\\");
    if !native.contains(' ') {
        return Some(native);
    }
    short_path(path).filter(|s| !s.contains(' '))
}

/// The entry our reporter takes inside one event, in this agent's shape.
fn table_hook_entry(layout: HookLayout, command: &str) -> Value {
    match layout {
        HookLayout::Grouped(t) | HookLayout::OwnFile(t) | HookLayout::OwnGrouped(t) => {
            json!({ "type": "command", "command": command, t.key: t.value })
        }
        HookLayout::Flat(t) => json!({ "command": command, t.key: t.value }),
        // Not entry-shaped: these build their whole artifact at once (a list of
        // named hooks, a TOML block, or a plugin source with no command at all).
        HookLayout::OwnList | HookLayout::TomlBlock | HookLayout::Plugin => {
            json!({ "command": command })
        }
    }
}

/// The `hooks` object for an agent whose file is entirely ours, in whichever of
/// the two shapes it reads: a flat list of command entries, or Claude's grouped
/// one (a `hooks` array per matcher).
fn table_own_hooks_object(agent: &TableAgent, command: &str) -> Value {
    let mut hooks = serde_json::Map::new();
    for event in agent.events {
        let entry = table_hook_entry(agent.layout, command);
        let value = match agent.layout {
            HookLayout::OwnGrouped(_) => match event.matcher {
                Some(m) => json!([{ "matcher": m, "hooks": [entry] }]),
                None => json!([{ "hooks": [entry] }]),
            },
            _ => json!([entry]),
        };
        hooks.insert(event.name.to_string(), value);
    }
    Value::Object(hooks)
}

/// The full document written for an `OwnFile` / `OwnList` agent.
fn table_own_document(agent: &TableAgent, command: &str) -> Value {
    match agent.layout {
        HookLayout::OwnList => {
            // Kiro keys a hook by its `trigger` and wants each one named, so a
            // re-install replaces our entries by name and leaves other files in
            // its hooks dir alone.
            let hooks: Vec<Value> = agent
                .events
                .iter()
                .map(|event| {
                    json!({
                        "name": format!("{}-{}", MANAGED_HOOK_NAME, event.name.to_lowercase()),
                        "description": "Reports agent status to Uxnan Desktop.",
                        "trigger": event.name,
                        "action": { "type": "command", "command": command }
                    })
                })
                .collect();
            json!({ "version": "v1", "hooks": hooks })
        }
        // Goose's spec has no `version` key; the others require one.
        HookLayout::OwnGrouped(_) => json!({ "hooks": table_own_hooks_object(agent, command) }),
        _ => json!({ "version": 1, "hooks": table_own_hooks_object(agent, command) }),
    }
}

/// Name our managed hook carries where a config keys hooks by name.
const MANAGED_HOOK_NAME: &str = "uxnan-status";

/// TOML markers delimiting the block we own inside a user's config. Everything
/// outside them is never parsed, rewritten or reformatted.
const TOML_BLOCK_START: &str =
    "# >>> uxnan-managed-hooks (managed by Uxnan Desktop; do not edit) >>>";
const TOML_BLOCK_END: &str = "# <<< uxnan-managed-hooks <<<";

/// A TOML basic (double-quoted) string. Windows commands carry backslashes and
/// a path could carry a quote, so both are escaped rather than assumed absent —
/// an unescaped one would make the CLI reject its whole config file.
fn toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
}

/// Our `[[hooks]]` block for a TOML-configured agent.
fn table_toml_block(agent: &TableAgent, command: &str) -> String {
    let mut out = String::from(TOML_BLOCK_START);
    for event in agent.events {
        out.push_str(&format!(
            "\n[[hooks]]\nevent = \"{}\"\ncommand = {}\ntimeout = {}\n",
            event.name,
            toml_string(command),
            RELAY_TIMEOUT_SECS
        ));
    }
    out.push_str(TOML_BLOCK_END);
    out
}

/// Strip our TOML block (and the blank lines that led into it) from `text`.
fn strip_toml_block(text: &str) -> String {
    let Some(start) = text.find(TOML_BLOCK_START) else {
        return text.to_string();
    };
    let head = text[..start].trim_end().to_string();
    // A hand-edit can delete the end marker; without this fallback the orphaned
    // block would survive every re-install and accumulate.
    let tail = match text[start..].find(TOML_BLOCK_END) {
        Some(end) => text[start + end + TOML_BLOCK_END.len()..].to_string(),
        None => String::new(),
    };
    let tail = tail.trim_start_matches(['\r', '\n']).to_string();
    if tail.is_empty() {
        head
    } else if head.is_empty() {
        tail
    } else {
        format!("{head}\n\n{tail}")
    }
}

/// Install (or refresh) one table agent's managed reporter.
pub fn install_table_agent(id: &str, install: &HookInstall) -> Result<AgentHooksStatus, AppError> {
    let agent =
        table_agent(id).ok_or_else(|| AppError::Invalid(format!("unknown hook agent: {id}")))?;
    let path = (agent.path)()
        .ok_or_else(|| AppError::Invalid(format!("cannot resolve the {id} config path")))?;
    // A plugin posts to the hook server itself, so it needs no command; the
    // unavailable-path check below only applies to the CLIs that run one.
    let command = if matches!(agent.layout, HookLayout::Plugin) {
        Some(String::new())
    } else {
        table_agent_command(agent.id, install)
    };
    let Some(command) = command else {
        return Err(AppError::Invalid(format!(
            "the hooks folder path contains a space and Windows won't shorten it ({}). \
             A hook command is a literal path to these CLIs, so none can be installed from here.",
            install.dir
        )));
    };
    let kind = AgentKind::Tagged(agent.id);
    match agent.layout {
        HookLayout::Grouped(_) | HookLayout::Flat(_) => {
            let existing = std::fs::read_to_string(&path).unwrap_or_default();
            let mut doc = read_hooks_doc(&existing);
            // Sweep our own prior entries first (including from events we no
            // longer subscribe to), so a re-install converges on one entry per
            // event instead of stacking a new one every time.
            strip_managed(&mut doc, kind);
            ensure_hooks_object(&mut doc);
            let entry = table_hook_entry(agent.layout, &command);
            for event in agent.events {
                match agent.layout {
                    HookLayout::Flat(_) => merge_event_flat(&mut doc, event.name, &entry, kind),
                    _ => merge_event(&mut doc, event.name, event.matcher, &entry, kind),
                }
            }
            // Cursor validates a `version` and rejects a file without one; a
            // value the user pinned themselves is left as they set it.
            if matches!(agent.layout, HookLayout::Flat(_)) && doc.get("version").is_none() {
                doc["version"] = json!(1);
            }
            write_json_atomic(&path, &to_pretty(&doc))?;
        }
        HookLayout::OwnFile(_) | HookLayout::OwnGrouped(_) | HookLayout::OwnList => {
            write_json_atomic(&path, &to_pretty(&table_own_document(agent, &command)))?;
        }
        HookLayout::Plugin => {
            // Never clobber a user-authored file of the same name: only ever
            // (re)write one carrying our marker.
            if let Ok(text) = std::fs::read_to_string(&path) {
                if !text.contains(plugin_marker(agent.id)) {
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
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            write_if_changed(&path, &plugin_body(agent.id))?;
        }
        HookLayout::TomlBlock => {
            let existing = std::fs::read_to_string(&path).unwrap_or_default();
            let base = strip_toml_block(&existing);
            let block = table_toml_block(agent, &command);
            let next = if base.trim().is_empty() {
                format!("{block}\n")
            } else {
                format!("{base}\n\n{block}\n")
            };
            write_text_atomic(&path, &next)?;
        }
    }
    Ok(read_table_agent_status(id))
}

/// Remove one table agent's managed reporter, leaving the user's own hooks — and
/// for the TOML agents every byte outside our markers — untouched.
pub fn uninstall_table_agent(id: &str) -> Result<AgentHooksStatus, AppError> {
    let agent =
        table_agent(id).ok_or_else(|| AppError::Invalid(format!("unknown hook agent: {id}")))?;
    let path = (agent.path)()
        .ok_or_else(|| AppError::Invalid(format!("cannot resolve the {id} config path")))?;
    match agent.layout {
        HookLayout::Grouped(_) | HookLayout::Flat(_) => {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let mut doc: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
                let before = doc.clone();
                strip_managed(&mut doc, AgentKind::Tagged(agent.id));
                if doc != before {
                    write_json_atomic(&path, &to_pretty(&doc))?;
                }
            }
        }
        // The file is entirely ours — removing it is the whole uninstall.
        HookLayout::OwnFile(_) | HookLayout::OwnGrouped(_) | HookLayout::OwnList => {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
        }
        // Ours only: a file of the same name that we did not write stays.
        HookLayout::Plugin => {
            if let Ok(text) = std::fs::read_to_string(&path) {
                if text.contains(plugin_marker(agent.id)) {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        HookLayout::TomlBlock => {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let stripped = strip_toml_block(&text);
                if stripped != text {
                    let next = if stripped.trim().is_empty() {
                        String::new()
                    } else {
                        format!("{}\n", stripped.trim_end())
                    };
                    write_text_atomic(&path, &next)?;
                }
            }
        }
    }
    Ok(read_table_agent_status(id))
}

/// Whether one table agent's managed reporter is currently installed.
pub fn read_table_agent_status(id: &str) -> AgentHooksStatus {
    let Some(agent) = table_agent(id) else {
        return AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: format!("unknown hook agent: {id}"),
        };
    };
    let Some(path) = (agent.path)() else {
        return AgentHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: "home directory not resolvable".to_string(),
        };
    };
    match agent.layout {
        HookLayout::Grouped(_) | HookLayout::Flat(_) => {
            status_from_config(Some(path), AgentKind::Tagged(agent.id), agent.label)
        }
        // Ours whole: its presence IS the install state, and the tag guards
        // against reading someone else's file of the same name.
        HookLayout::OwnFile(_)
        | HookLayout::OwnGrouped(_)
        | HookLayout::OwnList
        | HookLayout::TomlBlock
        | HookLayout::Plugin => {
            let path_str = path.to_string_lossy().into_owned();
            let marker = match agent.layout {
                HookLayout::TomlBlock => TOML_BLOCK_START,
                HookLayout::Plugin => plugin_marker(agent.id),
                _ => MANAGED_HOOK_NAME,
            };
            match std::fs::read_to_string(&path) {
                Ok(text) => AgentHooksStatus {
                    installed: text.contains(marker)
                        || text.contains(EVENT_HOOK_SH_FILENAME)
                        || text.contains(EVENT_HOOK_CMD_FILENAME),
                    file_exists: true,
                    unavailable: false,
                    detail: format!("{} at {path_str}", agent.label),
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
    }
}

/// Render exactly what the ADE writes for one table agent (Settings "Show
/// config"), so what's shown is what lands on disk — not a prettified sketch.
pub fn render_table_agent_config(id: &str, install: &HookInstall) -> Result<String, AppError> {
    let agent =
        table_agent(id).ok_or_else(|| AppError::Invalid(format!("unknown hook agent: {id}")))?;
    let command =
        table_agent_command(agent.id, install).unwrap_or_else(|| "<unavailable>".to_string());
    match agent.layout {
        HookLayout::Plugin => Ok(plugin_body(agent.id)),
        HookLayout::TomlBlock => Ok(table_toml_block(agent, &command)),
        HookLayout::OwnFile(_) | HookLayout::OwnGrouped(_) | HookLayout::OwnList => {
            serde_json::to_string_pretty(&table_own_document(agent, &command))
                .map_err(AppError::Serde)
        }
        HookLayout::Grouped(_) | HookLayout::Flat(_) => {
            let mut doc = json!({ "hooks": {} });
            let entry = table_hook_entry(agent.layout, &command);
            let kind = AgentKind::Tagged(agent.id);
            for event in agent.events {
                match agent.layout {
                    HookLayout::Flat(_) => merge_event_flat(&mut doc, event.name, &entry, kind),
                    _ => merge_event(&mut doc, event.name, event.matcher, &entry, kind),
                }
            }
            if matches!(agent.layout, HookLayout::Flat(_)) {
                doc["version"] = json!(1);
            }
            serde_json::to_string_pretty(&doc).map_err(AppError::Serde)
        }
    }
}

// ---------------------------------------------------------------------------
// One entry point for every agent
// ---------------------------------------------------------------------------

/// Every agent the ADE can install a reporter for, in the order Settings lists
/// them: the hand-written ones first (each needs machinery of its own — a
/// Node relay, a trust hash, an in-process plugin), then the table.
pub fn hook_agent_ids() -> Vec<&'static str> {
    let mut ids = vec!["claude", "codex", "opencode", "pi", "grok", "antigravity"];
    ids.extend(TABLE_AGENTS.iter().map(|a| a.id));
    ids
}

/// One agent's row for the Settings panel: what it is, where its config lives
/// and whether our reporter is in it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookAgentEntry {
    pub id: String,
    /// Whether this CLI looks present on the machine (on `PATH`, or its config
    /// already exists) — the panel leads with the agents you actually use.
    pub present: bool,
    /// The file our reporter is written into, shown under the agent's name.
    pub config_path: String,
    pub status: AgentHooksStatus,
}

/// The install state of every agent, resolved in one pass so the panel makes a
/// single call instead of one per agent.
pub fn read_all_agent_status() -> Vec<HookAgentEntry> {
    hook_agent_ids()
        .into_iter()
        .map(|id| HookAgentEntry {
            id: id.to_string(),
            present: agent_present(id),
            config_path: agent_config_path(id),
            status: read_agent_status(id),
        })
        .collect()
}

/// Where an agent's reporter is written, as an absolute path (empty when the
/// home directory can't be resolved).
fn agent_config_path(id: &str) -> String {
    let path = match id {
        "claude" => claude_settings_path(),
        "codex" => codex_hooks_path(),
        "opencode" => opencode_plugin_path(),
        "pi" => pi_extension_path(),
        "grok" => grok_hooks_path(),
        "antigravity" => antigravity_hooks_path(),
        _ => table_agent(id).and_then(|a| (a.path)()),
    };
    path.map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Whether an agent looks present on this machine (see `table_agent_present`).
fn agent_present(id: &str) -> bool {
    if let Some(agent) = table_agent(id) {
        return table_agent_present(agent);
    }
    // The hand-written six: their executable names, which differ from the hook
    // kind for Antigravity (`agy`) — the same split `agentStatus.titleAgentId`
    // handles on the frontend.
    let command = match id {
        "claude" => "claude",
        "codex" => "codex",
        "opencode" => "opencode",
        "pi" => "pi",
        "grok" => "grok",
        "antigravity" => "agy",
        _ => return false,
    };
    crate::which::resolve(command).is_some()
}

/// Read one agent's install state, whichever machinery owns it.
pub fn read_agent_status(id: &str) -> AgentHooksStatus {
    match id {
        "claude" => read_claude_status(),
        "codex" => read_codex_hooks_status(),
        "opencode" => read_opencode_hooks_status(),
        "pi" => read_pi_hooks_status(),
        "grok" => read_grok_hooks_status(),
        "antigravity" => read_antigravity_hooks_status(),
        _ => read_table_agent_status(id),
    }
}

/// Install one agent's reporter, whichever machinery owns it.
pub fn install_agent(id: &str, install: &HookInstall) -> Result<AgentHooksStatus, AppError> {
    match id {
        "claude" => install_claude_hooks(&install.status_relay_script),
        "codex" => install_codex_hooks(install),
        "opencode" => install_opencode_hooks(),
        "pi" => install_pi_hooks(),
        "grok" => install_grok_hooks(install),
        "antigravity" => install_antigravity_hooks(),
        _ => install_table_agent(id, install),
    }
}

/// Remove one agent's reporter, whichever machinery owns it.
pub fn uninstall_agent(id: &str) -> Result<AgentHooksStatus, AppError> {
    match id {
        "claude" => uninstall_claude_hooks(),
        "codex" => uninstall_codex_hooks(),
        "opencode" => uninstall_opencode_hooks(),
        "pi" => uninstall_pi_hooks(),
        "grok" => uninstall_grok_hooks(),
        "antigravity" => uninstall_antigravity_hooks(),
        _ => uninstall_table_agent(id),
    }
}

/// Render exactly what the ADE writes for one agent (Settings "Show config").
/// OpenCode and Pi have no config entry — their reporter *is* the file — so the
/// panel shows their source instead and never asks for this.
pub fn render_agent_config(id: &str, install: &HookInstall) -> Result<String, AppError> {
    match id {
        "claude" => render_claude_settings_json(&install.status_relay_script),
        "codex" => render_codex_hooks_json(install),
        "grok" => render_grok_hooks_json(install),
        "antigravity" => render_antigravity_hooks_json(),
        "opencode" => Ok(OPENCODE_STATUS_PLUGIN.to_string()),
        "pi" => Ok(PI_STATUS_EXTENSION.to_string()),
        _ => render_table_agent_config(id, install),
    }
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
    log("codex", install_codex_hooks(install));
    log("opencode", install_opencode_hooks());
    log("pi", install_pi_hooks());
    log("grok", install_grok_hooks(install));
    log("antigravity", install_antigravity_hooks());
    if let Err(e) = cleanup_retired_gemini_hooks() {
        eprintln!("[uxnan-desktop] retired Gemini hook cleanup failed: {e}");
    }
    // The declaratively-wired CLIs, but only the ones this machine actually has:
    // see `table_agent_present`. An agent installed later is picked up on the
    // next launch, and its Settings card installs it on demand meanwhile.
    for agent in TABLE_AGENTS.iter().filter(|a| table_agent_present(a)) {
        log(agent.id, install_table_agent(agent.id, install));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `HookInstall` pointing at plausible script paths, for rendering tests
    /// that never touch the disk.
    fn fake_install() -> HookInstall {
        let mut install = HookInstall {
            dir: "/tmp/uxnan/hooks".into(),
            status_relay_script: "/tmp/uxnan/hooks/uxnan-status-relay.cjs".into(),
            codex_hook_sh: "/tmp/uxnan/hooks/uxnan-codex-hook.sh".into(),
            codex_hook_cmd: "/tmp/uxnan/hooks/uxnan-codex-hook.cmd".into(),
            opencode_plugin_script: String::new(),
            pi_extension_script: String::new(),
            event_hook_sh: "/tmp/uxnan/hooks/uxnan-event-hook.sh".into(),
            event_hook_cmd: "/tmp/uxnan/hooks/uxnan-event-hook.cmd".into(),
            wrapper_bash: String::new(),
            wrapper_powershell: String::new(),
            wrapper_cmd: String::new(),
            wrapper_fish: String::new(),
            browser_shim_bash: String::new(),
            browser_shim_cmd: String::new(),
            claude_settings_path: String::new(),
            codex_hooks_path: String::new(),
            opencode_plugin_path: String::new(),
            pi_extension_path: String::new(),
            grok_hooks_path: String::new(),
            antigravity_hooks_path: String::new(),
        };
        // Keep the platform's own script the one under test.
        if cfg!(windows) {
            install.event_hook_sh = String::new();
        } else {
            install.event_hook_cmd = String::new();
        }
        install
    }

    #[test]
    fn every_table_agent_renders_a_config_naming_itself() {
        let install = fake_install();
        for agent in TABLE_AGENTS {
            let rendered = render_table_agent_config(agent.id, &install)
                .unwrap_or_else(|e| panic!("{} failed to render: {e}", agent.id));
            // A plugin carries no command: it runs inside the agent and posts
            // for itself, so what has to be true is that it declares the right
            // identity and stays recognisable as ours on disk.
            if matches!(agent.layout, HookLayout::Plugin) {
                assert!(
                    rendered.contains(&format!("const AGENT_TYPE = \"{}\";", agent.id)),
                    "{} plugin does not declare its own agent kind",
                    agent.id
                );
                assert!(
                    rendered.contains(plugin_marker(agent.id)),
                    "{} plugin has no managed marker, so install could clobber a user file",
                    agent.id
                );
                continue;
            }
            // The reporter is shared, so the tag is the ONLY thing that says
            // which agent a report came from: without it the server has no arm
            // to match and the report is dropped.
            assert!(
                rendered.contains(&format!(" {}", agent.id)),
                "{} does not pass its own kind to the reporter: {rendered}",
                agent.id
            );
            assert!(
                rendered.contains("uxnan-event-hook"),
                "{} does not invoke the shared reporter",
                agent.id
            );
            // Every event we said we'd register has to be in there.
            for event in agent.events {
                assert!(
                    rendered.contains(event.name),
                    "{} is missing event {}",
                    agent.id,
                    event.name
                );
            }
            if !matches!(agent.layout, HookLayout::TomlBlock) {
                serde_json::from_str::<Value>(&rendered)
                    .unwrap_or_else(|e| panic!("{} rendered invalid JSON: {e}", agent.id));
            }
        }
    }

    #[test]
    fn the_shared_plugin_declares_the_agent_it_speaks_for() {
        // MiMo runs OpenCode's reporter verbatim — it is a fork of it — so the
        // one thing that must change is the kind it reports: leaving it as
        // "opencode" would file every MiMo session under OpenCode's identity
        // and give the tab the wrong brand.
        let mimo = plugin_body("mimo");
        assert!(mimo.contains("const AGENT_TYPE = \"mimo\";"));
        assert!(!mimo.contains("const AGENT_TYPE = \"opencode\";"));
        // …and nothing else about a validated reporter is rewritten.
        assert!(mimo.contains("SubagentStart"));
        assert!(mimo.contains(OPENCODE_PLUGIN_MARKER));

        // Kilo's loader takes a default-exported descriptor; a bare named
        // factory is simply never registered, so the export has to change too.
        let kilo = plugin_body("kilocode");
        assert!(kilo.contains("const AGENT_TYPE = \"kilocode\";"));
        assert!(
            kilo.contains("export default { id: \"uxnan-status\", server: UxnanStatusPlugin };")
        );
        assert!(
            !kilo.contains("export const UxnanStatusPlugin"),
            "the named export must not survive, or the plugin loads twice"
        );

        // OpenCode's own copy is untouched by all of this.
        assert_eq!(plugin_body("opencode"), OPENCODE_STATUS_PLUGIN);

        // Amp's API is its own, so it gets its own source — not a rewrite.
        let amp = plugin_body("amp");
        assert!(amp.contains("const AGENT_TYPE = \"amp\";"));
        assert!(amp.contains("amp.on(\"agent.end\""));
        // A gating hook that answers nothing would BLOCK the tool it observes.
        assert!(amp.contains("action: \"allow\""));
    }

    #[test]
    fn table_agent_ids_match_the_servers_event_table() {
        // The id is posted as the agent type and matched by `normalize_event`.
        // A typo here means a perfectly installed hook whose every report is
        // silently discarded, which is exactly the failure that is hardest to
        // notice: the card just never moves.
        for agent in TABLE_AGENTS {
            // Each agent's own spelling for "I am working on it".
            let event = match agent.id {
                "cursor" | "copilot" => "preToolUse",
                // The in-process plugins report their reporter's own vocabulary,
                // not the CLI's bus event names.
                "mimo" | "kilocode" => "SessionBusy",
                "amp" => "tool.call",
                // OMP runs Pi's extension, so it speaks Pi's snake_case events.
                "omp" => "tool_call",
                _ => "PreToolUse",
            };
            assert_eq!(
                crate::hooks::normalize_event(agent.id, event, None),
                Some(crate::model::AgentStatus::Working),
                "{} has no working arm in the server's event table",
                agent.id
            );
        }
    }

    #[test]
    fn grouped_merge_keeps_other_peoples_hooks() {
        // A user's own hook, and another tool's, must survive our install and
        // our uninstall. This is the whole contract of writing into a config
        // file we do not own.
        let foreign = json!({
            "hooks": {
                "PreToolUse": [
                    { "matcher": "*", "hooks": [{ "type": "command", "command": "my-linter" }] }
                ],
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "/opt/other-tool/report.sh" }] }
                ]
            },
            "model": "some-model"
        });
        let mut doc = read_hooks_doc(&foreign.to_string());
        let kind = AgentKind::Tagged("droid");
        let entry = json!({ "type": "command", "command": "/h/uxnan-event-hook.sh droid" });
        merge_event(&mut doc, "PreToolUse", Some("*"), &entry, kind);
        merge_event(&mut doc, "Stop", None, &entry, kind);

        let rendered = doc.to_string();
        assert!(rendered.contains("my-linter"));
        assert!(rendered.contains("/opt/other-tool/report.sh"));
        assert!(rendered.contains("uxnan-event-hook.sh droid"));
        // Unrelated top-level keys are not ours to touch.
        assert_eq!(doc["model"], json!("some-model"));

        strip_managed(&mut doc, kind);
        let rendered = doc.to_string();
        assert!(!rendered.contains("uxnan-event-hook"));
        assert!(rendered.contains("my-linter"));
        assert!(rendered.contains("/opt/other-tool/report.sh"));
    }

    #[test]
    fn flat_merge_sweeps_only_our_own_entry() {
        // Cursor's shape: the command sits ON the definition. A prior install of
        // ours is replaced; a hook belonging to anything else is not.
        let existing = json!({
            "version": 1,
            "hooks": {
                "stop": [
                    { "command": "someone-elses-hook.sh", "timeout": 10 },
                    { "command": "/old/uxnan-event-hook.sh cursor", "timeout": 10 }
                ]
            }
        });
        let mut doc = read_hooks_doc(&existing.to_string());
        let kind = AgentKind::Tagged("cursor");
        let entry = json!({ "command": "/new/uxnan-event-hook.sh cursor", "timeout": 10 });
        merge_event_flat(&mut doc, "stop", &entry, kind);

        let stop = doc["hooks"]["stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "the stale entry of ours was not replaced");
        assert!(stop
            .iter()
            .any(|h| h["command"] == json!("someone-elses-hook.sh")));
        assert!(stop
            .iter()
            .any(|h| h["command"] == json!("/new/uxnan-event-hook.sh cursor")));
    }

    #[test]
    fn one_agents_uninstall_leaves_another_agents_entry_alone() {
        // Two of our own reporters can share a config file only if each is
        // matched by its tag; matching just the script name would make removing
        // one silently remove the other.
        let mut doc = read_hooks_doc("{}");
        let entry_of = |id: &str| json!({ "type": "command", "command": format!("/h/uxnan-event-hook.sh {id}") });
        merge_event(
            &mut doc,
            "Stop",
            None,
            &entry_of("droid"),
            AgentKind::Tagged("droid"),
        );
        merge_event(
            &mut doc,
            "Stop",
            None,
            &entry_of("qwen"),
            AgentKind::Tagged("qwen"),
        );

        strip_managed(&mut doc, AgentKind::Tagged("droid"));
        let rendered = doc.to_string();
        assert!(!rendered.contains("uxnan-event-hook.sh droid"));
        assert!(rendered.contains("uxnan-event-hook.sh qwen"));
    }

    #[test]
    fn toml_block_is_replaceable_and_leaves_user_config_intact() {
        let agent = table_agent("kimi").expect("kimi is wired");
        let user = "[model]\nname = \"k2\"\n\n[ui]\ntheme = \"dark\"";
        let block = table_toml_block(agent, "/h/uxnan-event-hook.sh kimi");
        let installed = format!("{user}\n\n{block}\n");

        // Every event is registered, and the command is a valid TOML string.
        for event in agent.events {
            assert!(installed.contains(&format!("event = \"{}\"", event.name)));
        }
        // Re-installing must not stack a second block.
        let stripped = strip_toml_block(&installed);
        assert_eq!(stripped.trim(), user);
        assert!(!stripped.contains("uxnan-event-hook"));
        // An orphaned block (its end marker hand-deleted) is still recovered,
        // or every re-install would append another one forever.
        let orphaned = format!("{user}\n\n{TOML_BLOCK_START}\n[[hooks]]\nevent = \"Stop\"\n");
        assert_eq!(strip_toml_block(&orphaned).trim(), user);
    }

    #[test]
    fn windows_paths_survive_toml_escaping() {
        // A Windows command is full of backslashes; unescaped, they are TOML
        // escape sequences and the CLI rejects its whole config file.
        let escaped = toml_string("C:\\Users\\a b\\uxnan-event-hook.cmd kimi");
        assert_eq!(
            escaped,
            "\"C:\\\\Users\\\\a b\\\\uxnan-event-hook.cmd kimi\""
        );
    }

    #[test]
    fn antigravity_hook_uses_a_path_free_command() {
        // The whole point of the dot-relative form: the command carries no path,
        // so a home directory with a space in it can't break it. Antigravity
        // parses the command itself and honours no quoting — verified against the
        // real CLI, where every quoted absolute form was skipped silently.
        let cmd = antigravity_hook_command("Stop");
        assert!(cmd.starts_with("./") || cmd.starts_with(".\\"));
        // kind THEN event: the payload carries no event name of its own, so the
        // command is the only thing that can say which one fired.
        assert!(cmd.ends_with(" antigravity Stop"));
    }

    #[test]
    fn every_antigravity_event_names_itself_in_its_command() {
        // Antigravity's payload carries no event name (verified against the real
        // CLI: `invocationNum` / `fullyIdle` / `terminationReason`, nothing to
        // identify the event), so each registration must say which one it is or
        // the report is dropped and the session never reaches `done`.
        let v = antigravity_hook_value();
        for event in ANTIGRAVITY_LOOP_EVENTS {
            let cmd = v[*event][0]["command"].as_str().expect("a command");
            assert!(cmd.ends_with(&format!(" antigravity {event}")), "{cmd}");
        }
        for event in ANTIGRAVITY_TOOL_EVENTS {
            let cmd = v[*event][0]["hooks"][0]["command"]
                .as_str()
                .expect("a command");
            assert!(cmd.ends_with(&format!(" antigravity {event}")), "{cmd}");
        }
    }

    #[test]
    fn antigravity_value_shapes_each_event_group() {
        let v = antigravity_hook_value();
        // Tool events take the grouped `matcher` + `hooks` wrapper…
        assert!(v["PreToolUse"][0]["matcher"].is_string());
        assert!(v["PreToolUse"][0]["hooks"].is_array());
        // …while the loop events take a flat list of handlers.
        assert_eq!(v["Stop"][0]["type"], json!("command"));
        assert!(v["PreInvocation"][0]["command"].is_string());
        // No prompt/permission event exists to subscribe to.
        assert!(v.get("Notification").is_none());
    }

    #[test]
    fn antigravity_install_key_is_detected_and_scoped() {
        let doc = json!({ "someone-elses-hook": { "Stop": [] } });
        assert!(!antigravity_installed(&doc.to_string()));
        let mut doc = doc;
        doc[ANTIGRAVITY_HOOK_NAME] = antigravity_hook_value();
        let text = doc.to_string();
        assert!(antigravity_installed(&text));
        // Uninstall must leave the other hook alone.
        let mut parsed: Value = serde_json::from_str(&text).unwrap();
        parsed
            .as_object_mut()
            .unwrap()
            .remove(ANTIGRAVITY_HOOK_NAME);
        assert!(parsed.get("someone-elses-hook").is_some());
        assert!(!antigravity_installed(&parsed.to_string()));
    }

    #[test]
    fn grok_doc_subscribes_every_event_and_is_sweepable() {
        let doc = grok_hooks_doc("C:/hooks/uxnan-event-hook.cmd grok");
        for (event, _) in GROK_EVENTS {
            assert!(doc["hooks"].get(event).is_some(), "missing {event}");
        }
        // The managed matcher has to recognise our own entry, or uninstall and
        // re-install would stack duplicates.
        let entry = &doc["hooks"]["Stop"][0]["hooks"][0];
        assert!(is_managed_hook(entry, AgentKind::Grok));
        assert!(!is_managed_hook(entry, AgentKind::Claude));
    }

    #[test]
    fn unquotable_path_rejects_a_space_it_cannot_shorten() {
        assert_eq!(
            unquotable_path("C:\\hooks\\uxnan-event-hook.cmd").as_deref(),
            Some("C:/hooks/uxnan-event-hook.cmd")
        );
        // A path that doesn't exist can't be shortened, so a spaced one yields
        // `None` — the caller then reports the agent unavailable rather than
        // writing a hook that would never fire.
        assert_eq!(unquotable_path("/nope/a b/uxnan-event-hook.sh"), None);
    }

    #[test]
    fn scripts_install_and_report_paths() {
        let tmp = std::env::temp_dir().join(format!("uxnan-hooks-{}", uuid::Uuid::new_v4()));
        let install = install_scripts_to(&tmp).expect("install succeeds");
        assert!(Path::new(&install.status_relay_script).is_file());
        assert!(Path::new(&install.codex_hook_sh).is_file());
        assert!(Path::new(&install.codex_hook_cmd).is_file());
        assert!(Path::new(&install.pi_extension_script).is_file());
        assert!(Path::new(&install.event_hook_sh).is_file());
        assert!(Path::new(&install.event_hook_cmd).is_file());
        assert!(install.codex_hooks_path.contains("hooks.json"));
        assert!(install.grok_hooks_path.contains("uxnan-status.json"));
        assert!(install.antigravity_hooks_path.contains("hooks.json"));
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
    fn is_managed_hook_identifies_claude_and_retired_gemini_entries() {
        let claude = claude_hook_entry("/x/uxnan-status-relay.cjs");
        let retired = json!({
            "type": "command",
            "command": "node /x/uxnan-status-relay.cjs --agent gemini"
        });
        assert!(is_managed_hook(&claude, AgentKind::Claude));
        assert!(!is_managed_hook(&claude, AgentKind::RetiredGemini));
        assert!(is_managed_hook(&retired, AgentKind::RetiredGemini));
        assert!(!is_managed_hook(&retired, AgentKind::Claude));
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
    fn codex_sweeps_the_pre_relay_native_bridge() {
        // The pre-relay bridge Codex and Gemini shared. It read its agent type
        // from a `UXNAN_AGENT_TYPE` env var we no longer inject, so it reported
        // the literal "agent": the tab's captured session was stamped with a type
        // that has no resume entry (silently disabling resume for Codex), and the
        // state was dropped for want of a matching `normalize_event` arm. Left
        // registered it also outraces the current curl hook — node starts slower,
        // so its POST lands last and wins.
        let legacy = json!({
            "type": "command",
            "command": "node \"C:\\\\Users\\\\x\\\\hooks\\\\uxnan-agent-status-hook.cjs\"",
            "statusMessage": "Reporting status to Uxnan"
        });
        // Swept whatever config it sits in: it carries no agent tag of its own.
        assert!(is_managed_hook(&legacy, AgentKind::Codex));
        assert!(is_managed_hook(&legacy, AgentKind::RetiredGemini));
        let mut doc = json!({
            "hooks": {
                "PostToolUse": [
                    { "hooks": [legacy.clone()], "matcher": ".*" },
                    // A user's own hook in the same bucket must survive.
                    { "hooks": [{ "type": "command", "command": "mine.sh" }] }
                ]
            }
        });
        strip_managed(&mut doc, AgentKind::Codex);
        let out = to_pretty(&doc);
        assert!(
            !out.contains("uxnan-agent-status-hook"),
            "legacy bridge swept"
        );
        assert!(out.contains("mine.sh"), "user hook preserved");
    }

    #[test]
    fn scripts_from_an_older_build_are_swept_without_a_list_to_maintain() {
        let dir = std::env::temp_dir().join(format!("uxnan-sweep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let current = dir.join(STATUS_RELAY_FILENAME);
        // A reporter we shipped once and don't any more…
        let legacy = dir.join("uxnan-agent-status-hook.cjs");
        // …and one under a name nobody has thought of yet: the whole point is that
        // a future rename cleans itself up, with no list to remember to update.
        let renamed_someday = dir.join("uxnan-whatever-we-rename-it-to.cjs");
        // Ours by prefix, but NOT ours by ownership: the endpoint file the hook
        // server writes, and a file the user dropped in.
        let endpoint = dir.join("endpoint.cmd");
        let user_file = dir.join("my-notes.txt");
        for f in [&current, &legacy, &renamed_someday, &endpoint, &user_file] {
            std::fs::write(f, "x").unwrap();
        }
        sweep_foreign_scripts(&dir, &[&current]);
        assert!(current.exists(), "the script we just wrote is kept");
        assert!(!legacy.exists(), "a retired reporter is swept");
        assert!(
            !renamed_someday.exists(),
            "an unknown uxnan- script is swept"
        );
        assert!(endpoint.exists(), "the endpoint file is not ours to sweep");
        assert!(user_file.exists(), "a user's own file is never touched");
        // Idempotent: a second pass over a clean dir is a no-op, not an error.
        sweep_foreign_scripts(&dir, &[&current]);
        assert!(current.exists());
        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn sh_squote_wraps_plain_and_escapes_quote() {
        // A quote-free path is just wrapped in single quotes — byte-identical to
        // the previous hand-written `'{sh}'`, so the Codex trust hash is unchanged.
        assert_eq!(
            sh_squote("/tmp/uxnan/codex-hook.sh"),
            "'/tmp/uxnan/codex-hook.sh'"
        );
        // A single quote is escaped as '\'' (close quote, escaped quote, reopen).
        assert_eq!(
            sh_squote("/home/o'brien/hook.sh"),
            r"'/home/o'\''brien/hook.sh'"
        );
        assert_eq!(sh_squote(""), "''");
    }
}
