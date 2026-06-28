//! Ready-made per-agent hook configs (Phase 4 follow-up, see
//! `architecture/02d-agent-monitoring.md` §1.1 and `docs/agent-hooks.md`).
//!
//! The Layer 1 HTTP hook server is up and the ADE injects
//! `UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` / `UXNAN_AGENT_ID` into every
//! terminal; this module ships the actual **scripts** that turn those env
//! vars into precise state reports, so the user does not have to write them
//! by hand.
//!
//! On startup the ADE writes the bundled scripts to `<app-data>/hooks/`
//! (idempotent, overwriting if changed — matches the bridge's pattern at
//! `bridge/src/hooks/claude-approval-hook.ts`). The Settings → Agents →
//! Hooks pane surfaces the absolute paths and the Claude `settings.json`
//! install/uninstall commands so precise states work "out of the box".
//!
//! The bundled scripts are embedded at compile time via `include_str!` so
//! the running app never needs the `static/hooks/` directory on disk at
//! runtime. The `static/hooks/` files are the development / git source of
//! truth; keep them in sync.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

/// Marker we leave inside the Claude `settings.json` so we can recognise
/// (and cleanly remove) a `hooks` block that *we* installed. If a user
/// already has their own `hooks`, we leave it alone.
const MANAGED_MARKER: &str = "__uxnan_managed_hooks__";

/// The script Claude Code invokes on every event. Cross-platform Node CJS,
/// no deps (only `node:http`).
const CLAUDE_HOOK_SCRIPT: &str = include_str!("../../static/hooks/uxnan-claude-hook.cjs");

/// The `hooks` block to merge into `~/.claude/settings.json`. Contains
/// `{{HOOK_SCRIPT}}` which we replace with the absolute path of the
/// installed `CLAUDE_HOOK_SCRIPT` at install time.
const CLAUDE_SETTINGS_TEMPLATE: &str =
    include_str!("../../static/hooks/claude-settings.template.json");

/// The generic wrapper for any CLI agent (Bash).
pub const WRAPPER_BASH: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.sh");
/// The generic wrapper for any CLI agent (PowerShell).
pub const WRAPPER_POWERSHELL: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.ps1");
/// The generic wrapper for any CLI agent (cmd / batch — the no-PowerShell fallback).
pub const WRAPPER_CMD: &str = include_str!("../../static/hooks/uxnan-hook-wrapper.cmd");
/// The integrated-browser shim (Unix / Git Bash / WSL) — `$BROWSER` points here so
/// a URL an agent opens lands in the in-app browser (see `commands.rs` pty env).
pub const BROWSER_SHIM_BASH: &str = include_str!("../../static/hooks/uxnan-browser.sh");
/// The integrated-browser shim (Windows / cmd) — `%BROWSER%` points here.
pub const BROWSER_SHIM_CMD: &str = include_str!("../../static/hooks/uxnan-browser.cmd");

/// File names of the bundled scripts (used when writing them to disk).
const CLAUDE_HOOK_FILENAME: &str = "uxnan-claude-hook.cjs";
const WRAPPER_BASH_FILENAME: &str = "uxnan-hook-wrapper.sh";
const WRAPPER_POWERSHELL_FILENAME: &str = "uxnan-hook-wrapper.ps1";
const WRAPPER_CMD_FILENAME: &str = "uxnan-hook-wrapper.cmd";
const BROWSER_SHIM_BASH_FILENAME: &str = "uxnan-browser.sh";
const BROWSER_SHIM_CMD_FILENAME: &str = "uxnan-browser.cmd";

/// A platform-aware absolute path of every script the ADE writes under
/// `<app-data>/hooks/`, plus the resolved Claude `settings.json` path and
/// whether it currently looks like we manage it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInstall {
    /// The directory the ADE writes scripts to.
    pub dir: String,
    /// Absolute path of the Claude Code hook script.
    pub claude_hook_script: String,
    /// Absolute path of the Bash wrapper (Unix + Git Bash + WSL).
    pub wrapper_bash: String,
    /// Absolute path of the PowerShell wrapper.
    pub wrapper_powershell: String,
    /// Absolute path of the cmd / batch wrapper.
    pub wrapper_cmd: String,
    /// Absolute path of the integrated-browser shim (Bash).
    pub browser_shim_bash: String,
    /// Absolute path of the integrated-browser shim (cmd / batch).
    pub browser_shim_cmd: String,
    /// The resolved Claude `settings.json` path (`%USERPROFILE%\.claude\settings.json`
    /// on Windows, `~/.claude/settings.json` elsewhere).
    pub claude_settings_path: String,
}

/// The current state of the Claude hooks installation. `installed = true`
/// only if the `settings.json` exists, parses, and carries a `hooks` block
/// with our [`MANAGED_MARKER`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHooksStatus {
    /// `true` if our `hooks` block is present and well-formed.
    pub installed: bool,
    /// `true` if the file exists (whether we manage it or not).
    pub file_exists: bool,
    /// `true` if we tried to read/write it and the OS denied us.
    pub unavailable: bool,
    /// Human-readable detail; the path on success, the error otherwise.
    pub detail: String,
}

/// Return the absolute path of the Claude `settings.json` for the current
/// user (`%USERPROFILE%\.claude\settings.json` on Windows, `~/.claude/...`
/// elsewhere). Returns `None` if the home directory cannot be resolved.
pub fn claude_settings_path() -> Option<PathBuf> {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE")?
            .to_string_lossy()
            .into_owned()
    } else {
        std::env::var_os("HOME")?.to_string_lossy().into_owned()
    };
    Some(PathBuf::from(home).join(".claude").join("settings.json"))
}

/// Write the bundled scripts to `<dir>`, creating `dir` if needed. Each
/// write is **idempotent**: we only touch a file if its current content
/// differs (mtime-stable, so repeated launches don't churn the FS).
///
/// Returns the [`HookInstall`] describing the on-disk layout.
pub fn install_scripts_to(dir: &Path) -> Result<HookInstall, AppError> {
    std::fs::create_dir_all(dir)?;
    let dir = dir.to_path_buf();
    let write = |name: &str, content: &str| -> Result<PathBuf, AppError> {
        let path = dir.join(name);
        write_if_changed(&path, content)?;
        Ok(path)
    };
    let claude = write(CLAUDE_HOOK_FILENAME, CLAUDE_HOOK_SCRIPT)?;
    let bash = write(WRAPPER_BASH_FILENAME, WRAPPER_BASH)?;
    let ps = write(WRAPPER_POWERSHELL_FILENAME, WRAPPER_POWERSHELL)?;
    let cmd = write(WRAPPER_CMD_FILENAME, WRAPPER_CMD)?;
    let browser_bash = write(BROWSER_SHIM_BASH_FILENAME, BROWSER_SHIM_BASH)?;
    let browser_cmd = write(BROWSER_SHIM_CMD_FILENAME, BROWSER_SHIM_CMD)?;
    // The Bash shim is invoked directly as `$BROWSER <url>`, so it needs +x on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&browser_bash, std::fs::Permissions::from_mode(0o755));
    }
    let settings = claude_settings_path().ok_or_else(|| {
        AppError::Invalid("cannot resolve home directory for Claude settings path".into())
    })?;
    Ok(HookInstall {
        dir: dir.to_string_lossy().into_owned(),
        claude_hook_script: claude.to_string_lossy().into_owned(),
        wrapper_bash: bash.to_string_lossy().into_owned(),
        wrapper_powershell: ps.to_string_lossy().into_owned(),
        wrapper_cmd: cmd.to_string_lossy().into_owned(),
        browser_shim_bash: browser_bash.to_string_lossy().into_owned(),
        browser_shim_cmd: browser_cmd.to_string_lossy().into_owned(),
        claude_settings_path: settings.to_string_lossy().into_owned(),
    })
}

/// Write `content` to `path` only if the existing content differs (atomic
/// via a sibling temp file). Keeps the FS calm on every launch.
fn write_if_changed(path: &Path, content: &str) -> Result<(), AppError> {
    let need_write = match std::fs::read_to_string(path) {
        Ok(existing) => existing != content,
        Err(_) => true,
    };
    if !need_write {
        return Ok(());
    }
    // Write to a sibling temp file then rename — survives a crash mid-write.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Inspect the Claude `settings.json` and report whether our managed
/// `hooks` block is present. Distinguishes "file missing" (install will
/// create it), "installed" (we own the `hooks` block), and "unavailable"
/// (the OS refused the read).
pub fn read_claude_status() -> ClaudeHooksStatus {
    let Some(path) = claude_settings_path() else {
        return ClaudeHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: true,
            detail: "home directory not resolvable".to_string(),
        };
    };
    let path_str = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let managed = is_managed(&text);
            ClaudeHooksStatus {
                installed: managed,
                file_exists: true,
                unavailable: false,
                detail: if managed {
                    format!("managed hooks at {path_str}")
                } else {
                    format!("file at {path_str}")
                },
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ClaudeHooksStatus {
            installed: false,
            file_exists: false,
            unavailable: false,
            detail: format!("file not present at {path_str}"),
        },
        Err(err) => ClaudeHooksStatus {
            installed: false,
            file_exists: true,
            unavailable: true,
            detail: err.to_string(),
        },
    }
}

/// Read `~/.claude/settings.json` (creating it if missing), parse it,
/// replace its `hooks` block with ours (marked with [`MANAGED_MARKER`]),
/// and write it back. **Preserves every other top-level key** the user
/// already has, so existing Claude Code settings are untouched.
///
/// Errors with `AppError::Io` if the file isn't writable.
pub fn install_claude_hooks(script_path: &Path) -> Result<ClaudeHooksStatus, AppError> {
    let path = claude_settings_path().ok_or_else(|| {
        AppError::Invalid("cannot resolve home directory for Claude settings path".into())
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut root: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => serde_json::json!({}),
        Ok(text) => serde_json::from_str(&text).map_err(|err| {
            AppError::Invalid(format!("claude settings.json is not valid JSON: {err}"))
        })?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(err) => return Err(err.into()),
    };
    if !root.is_object() {
        return Err(AppError::Invalid(
            "claude settings.json root is not an object".into(),
        ));
    }
    let hooks_value = build_managed_hooks_value(script_path);
    let obj = root.as_object_mut().expect("object checked above");
    obj.insert("hooks".to_string(), hooks_value);
    // Preserve key order: existing keys first (in order), then any new ones.
    let serialized = serde_json::to_string_pretty(&root).map_err(AppError::Serde)?;
    // Atomic write: sibling temp + rename.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialized)?;
    std::fs::rename(&tmp, &path)?;
    Ok(read_claude_status())
}

/// Remove the `hooks` block from `~/.claude/settings.json` if (and only if)
/// it carries our [`MANAGED_MARKER`]. Preserves any user-installed `hooks`.
/// Idempotent: succeeds even if the file is missing.
pub fn uninstall_claude_hooks() -> Result<ClaudeHooksStatus, AppError> {
    let path = claude_settings_path().ok_or_else(|| {
        AppError::Invalid("cannot resolve home directory for Claude settings path".into())
    })?;
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(read_claude_status());
        }
        Err(err) => return Err(err.into()),
    };
    if !is_managed(&text) {
        return Ok(read_claude_status());
    }
    let mut root: serde_json::Value = serde_json::from_str(&text).map_err(|err| {
        AppError::Invalid(format!("claude settings.json is not valid JSON: {err}"))
    })?;
    if let Some(obj) = root.as_object_mut() {
        obj.remove("hooks");
    }
    let serialized = serde_json::to_string_pretty(&root).map_err(AppError::Serde)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialized)?;
    std::fs::rename(&tmp, &path)?;
    Ok(read_claude_status())
}

/// Render [`CLAUDE_SETTINGS_TEMPLATE`] with `{{HOOK_SCRIPT}}` substituted
/// for the absolute path of the installed `CLAUDE_HOOK_SCRIPT`, wrapped in
/// an object that also carries [`MANAGED_MARKER`] (so we can recognise /
/// remove it later).
fn build_managed_hooks_value(script_path: &Path) -> serde_json::Value {
    // Normalize to forward slashes so a Windows path works in JSON on every OS.
    let path = script_path.to_string_lossy().replace('\\', "/");
    let rendered = CLAUDE_SETTINGS_TEMPLATE.replace("{{HOOK_SCRIPT}}", &path);
    let mut hooks: serde_json::Value =
        serde_json::from_str(&rendered).expect("claude-settings.template.json is valid");
    let obj = hooks
        .as_object_mut()
        .expect("template renders to a JSON object");
    obj.insert(MANAGED_MARKER.to_string(), serde_json::Value::Bool(true));
    hooks
}

/// Render the `hooks` block the user would paste into
/// `~/.claude/settings.json` (pretty-printed, with our marker included so a
/// later `uninstall` knows it's ours). Used by `get_hook_scripts` so the
/// Settings UI can preview the exact JSON before installing.
pub fn render_claude_settings_json(script_path: &Path) -> Result<String, AppError> {
    let value = build_managed_hooks_value(script_path);
    serde_json::to_string_pretty(&value).map_err(AppError::Serde)
}

/// `true` if the file content carries a top-level `hooks` object stamped
/// with our [`MANAGED_MARKER`].
fn is_managed(text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    value
        .get("hooks")
        .and_then(|h| h.get(MANAGED_MARKER))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Build a [`HookInstall`] with paths under `dir`, without touching the
    /// filesystem — for unit tests that only check serialization.
    fn fake_install(dir: &Path) -> HookInstall {
        let home = if cfg!(windows) {
            "C:/Users/test"
        } else {
            "/home/test"
        };
        let settings = PathBuf::from(home).join(".claude").join("settings.json");
        HookInstall {
            dir: dir.to_string_lossy().into_owned(),
            claude_hook_script: dir
                .join(CLAUDE_HOOK_FILENAME)
                .to_string_lossy()
                .into_owned(),
            wrapper_bash: dir
                .join(WRAPPER_BASH_FILENAME)
                .to_string_lossy()
                .into_owned(),
            wrapper_powershell: dir
                .join(WRAPPER_POWERSHELL_FILENAME)
                .to_string_lossy()
                .into_owned(),
            wrapper_cmd: dir
                .join(WRAPPER_CMD_FILENAME)
                .to_string_lossy()
                .into_owned(),
            browser_shim_bash: dir
                .join(BROWSER_SHIM_BASH_FILENAME)
                .to_string_lossy()
                .into_owned(),
            browser_shim_cmd: dir
                .join(BROWSER_SHIM_CMD_FILENAME)
                .to_string_lossy()
                .into_owned(),
            claude_settings_path: settings.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn hook_install_serializes_camel_case() {
        let tmp = std::env::temp_dir().join("uxnan-test-hooks");
        let install = fake_install(&tmp);
        let json = serde_json::to_string(&install).unwrap();
        assert!(json.contains("claudeHookScript"));
        assert!(json.contains("wrapperBash"));
        assert!(json.contains("claudeSettingsPath"));
        assert!(!json.contains("claude_hook_script"));
    }

    #[test]
    fn claude_status_serializes_camel_case() {
        let status = ClaudeHooksStatus {
            installed: true,
            file_exists: true,
            unavailable: false,
            detail: "ok".into(),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("fileExists"));
        assert!(json.contains("\"installed\":true"));
    }

    #[test]
    fn build_managed_hooks_substitutes_script_path() {
        let path = Path::new("/tmp/uxnan-claude-hook.cjs");
        let value = build_managed_hooks_value(path);
        // The output IS the hooks block (it gets inserted as `root["hooks"]`).
        // The marker travels inside the same object.
        assert_eq!(
            value.get(MANAGED_MARKER),
            Some(&serde_json::Value::Bool(true)),
            "marker missing"
        );
        // Every command references the script.
        let mut found: HashMap<String, usize> = HashMap::new();
        for (event, list) in value.as_object().unwrap() {
            if event == MANAGED_MARKER {
                continue;
            }
            let arr = list.as_array().expect("event list is an array");
            for entry in arr {
                for h in entry.get("hooks").unwrap().as_array().unwrap() {
                    let cmd = h.get("command").unwrap().as_str().unwrap();
                    assert!(cmd.contains("uxnan-claude-hook.cjs"), "command was {cmd}");
                    *found.entry(event.clone()).or_insert(0) += 1;
                }
            }
        }
        // UserPromptSubmit, PreToolUse, PreCompact, Notification, PermissionRequest,
        // Stop, SessionEnd — 7 distinct events.
        assert!(found.len() >= 7, "only {} events", found.len());
    }

    #[test]
    fn is_managed_detects_marker_and_ignores_user_hooks() {
        assert!(is_managed(
            r#"{"hooks":{"__uxnan_managed_hooks__":true,"UserPromptSubmit":[]}}"#,
        ));
        assert!(!is_managed(r#"{"hooks":{"UserPromptSubmit":[]}}"#));
        assert!(!is_managed(r#"{"theme":"dark"}"#));
    }

    #[test]
    fn install_scripts_writes_all_files_idempotently() {
        let tmp = tempdir();
        let info = install_scripts_to(&tmp).expect("install succeeds");
        assert!(Path::new(&info.claude_hook_script).is_file());
        assert!(Path::new(&info.wrapper_bash).is_file());
        assert!(Path::new(&info.wrapper_powershell).is_file());
        assert!(Path::new(&info.wrapper_cmd).is_file());
        assert!(Path::new(&info.browser_shim_bash).is_file());
        assert!(Path::new(&info.browser_shim_cmd).is_file());
        // Re-running is a no-op (mtime + content-stable).
        let first_mtime = std::fs::metadata(&info.claude_hook_script)
            .unwrap()
            .modified()
            .unwrap();
        install_scripts_to(&tmp).expect("re-install succeeds");
        let second_mtime = std::fs::metadata(&info.claude_hook_script)
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(first_mtime, second_mtime, "script re-write churned mtime");
    }

    fn tempdir() -> PathBuf {
        let base = std::env::temp_dir().join(format!("uxnan-hooks-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        base
    }
}
