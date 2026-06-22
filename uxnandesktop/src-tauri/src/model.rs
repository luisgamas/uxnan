//! Persisted data model for the ADE.
//!
//! These structs are the single source of truth for everything that survives a
//! restart: the list of repos/worktrees, user settings, and the last-known
//! agent states. They serialize to JSON via Serde with `camelCase` field names
//! so the TypeScript mirror in `src/lib/types.ts` matches one-to-one.
//!
//! The hierarchy mirrors §2 of `architecture/02a-system-architecture.md`:
//! `AppData` → `RepoData` → `WorktreeData`.

use serde::{Deserialize, Serialize};

/// Current persistence schema version. Bump this whenever [`AppData`]'s shape
/// changes in a backwards-incompatible way and add a migration arm in
/// [`crate::persistence::migrate`].
pub const SCHEMA_VERSION: u32 = 1;

/// Root persisted document. Written atomically to `state.json` in the app data
/// directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    /// Schema version, used to drive forward migrations on load.
    pub version: u32,
    pub repos: Vec<RepoData>,
    pub settings: AppSettings,
    /// Last-known agent states (TTL-pruned in a later phase).
    #[serde(default)]
    pub agent_cache: Vec<AgentStateEntry>,
    /// Opaque, frontend-owned serialization of the terminal region/tab layout
    /// (restored on startup; the backend never interprets it).
    #[serde(default)]
    pub terminal_layout: Option<serde_json::Value>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            repos: Vec::new(),
            settings: AppSettings::default(),
            agent_cache: Vec::new(),
            terminal_layout: None,
        }
    }
}

/// A git repository (or plain folder) registered in the ADE.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoData {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub worktrees: Vec<WorktreeData>,
    /// Whether the folder is a git repository. Non-git folders are valid projects
    /// too (terminal + file-tree workspace); their git-only panels stay empty.
    /// Defaults to `true` for state persisted before this field existed (every
    /// repo back then was a git repo).
    #[serde(default = "default_true")]
    pub is_git: bool,
}

/// An independent git worktree — the ADE's fundamental unit of isolation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeData {
    pub id: String,
    pub repo_id: String,
    pub name: String,
    pub branch: String,
    pub path: String,
    /// `true` if the ADE created this worktree, `false` if it pre-existed.
    pub created_by_ade: bool,
    pub created_at: i64,
    pub last_activity: i64,
    /// CLI agent launched in this worktree, if any.
    #[serde(default)]
    pub agent_id: Option<String>,
}

/// A user-configurable terminal/shell profile. Each new terminal is spawned from
/// one of these (its `command` + `args`), so users can distinguish e.g.
/// PowerShell, Command Prompt and WSL on Windows, or different shells on Unix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    /// Executable to launch (e.g. `powershell.exe`, `wsl.exe`, `/bin/bash`).
    pub command: String,
    /// Arguments passed to the command (e.g. `["-NoLogo"]`, `["-d", "Ubuntu"]`).
    #[serde(default)]
    pub args: Vec<String>,
}

/// A user-registered CLI coding agent (Claude Code, Codex, Aider, …). Launching
/// it spawns a terminal running its `command` + `args` in a worktree, so the
/// agent works inside that worktree's isolated checkout. Same shape as a
/// [`TerminalProfile`] but a distinct concept: a terminal is a shell, an agent
/// is a tool the user runs *inside* one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    /// Executable to launch (e.g. `claude`, `codex`, `aider`).
    pub command: String,
    /// Arguments passed to the command (e.g. `["--model", "opus"]`).
    #[serde(default)]
    pub args: Vec<String>,
    /// Terminal profile (shell) to launch the agent in. The agent runs *inside*
    /// this interactive shell so PATH/PATHEXT shims (`.cmd`/`.ps1`) resolve.
    /// `None` falls back to the default terminal profile.
    #[serde(default)]
    pub terminal_profile_id: Option<String>,
    /// Logo key for the UI (a catalog id, e.g. `claudecode`); `None` → generic.
    #[serde(default)]
    pub icon: Option<String>,
}

/// Starter profiles seeded on a fresh install: the shells guaranteed to be
/// present on the platform, ready to use. On Windows, PowerShell launches with
/// `-ExecutionPolicy Bypass` so npm-installed agent shims (`.ps1`) run without
/// tripping the default Restricted policy. Optional shells (PowerShell 7, Git
/// Bash, WSL, zsh, fish) are added by the user from the detection-aware template
/// picker in Settings → Terminal.
pub fn default_terminal_profiles() -> Vec<TerminalProfile> {
    if cfg!(windows) {
        vec![
            TerminalProfile {
                id: "powershell".to_string(),
                name: "Windows PowerShell".to_string(),
                command: "powershell.exe".to_string(),
                args: vec![
                    "-NoLogo".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                ],
            },
            TerminalProfile {
                id: "cmd".to_string(),
                name: "Command Prompt".to_string(),
                command: "cmd.exe".to_string(),
                args: Vec::new(),
            },
        ]
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Shell".to_string());
        vec![
            TerminalProfile {
                id: "login".to_string(),
                name: format!("{name} (login shell)"),
                command: shell,
                args: Vec::new(),
            },
            TerminalProfile {
                id: "bash".to_string(),
                name: "bash".to_string(),
                command: "/bin/bash".to_string(),
                args: Vec::new(),
            },
        ]
    }
}

/// The single empty-starter profile a previous version seeded. Kept only so
/// [`AppSettings::ensure_terminal_profiles`] can recognise an untouched install
/// and upgrade it to the real [`default_terminal_profiles`] seed.
fn empty_starter_profiles() -> Vec<TerminalProfile> {
    vec![TerminalProfile {
        id: "default".to_string(),
        name: String::new(),
        command: String::new(),
        args: Vec::new(),
    }]
}

/// User-facing application settings (UI layout, theme, terminal profiles).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: Theme,
    pub left_sidebar_width: u32,
    pub right_sidebar_width: u32,
    pub left_sidebar_open: bool,
    pub right_sidebar_open: bool,
    /// Configurable terminal/shell profiles (seeded with platform defaults).
    #[serde(default)]
    pub terminal_profiles: Vec<TerminalProfile>,
    /// Id of the profile used for new terminals unless one is picked explicitly.
    #[serde(default)]
    pub default_profile_id: Option<String>,
    /// Registered CLI coding agents, launchable into any worktree. Empty by
    /// default; the user adds them from the templates in Settings → Agents.
    #[serde(default)]
    pub agent_profiles: Vec<AgentProfile>,
    /// Agent auto-launched in a worktree right after it is created. `None` = off
    /// (the default), so creating a worktree never spawns an agent unasked.
    #[serde(default)]
    pub default_agent_id: Option<String>,
    /// Whether to fire native notifications when an agent goes idle while you're
    /// looking at another space. Default on.
    #[serde(default = "default_true")]
    pub agent_notifications: bool,
    /// Keep the system awake while an agent is actively working (opt-in; the
    /// backend auto-releases after 2 h as a safety cap). Default off.
    #[serde(default)]
    pub prevent_sleep: bool,
    /// Auto-install the ADE-managed Claude Code hooks block on startup (so precise
    /// agent states work out of the box). Set false when the user uninstalls, so
    /// it isn't re-added on the next launch. Default on.
    #[serde(default = "default_true")]
    pub auto_install_hooks: bool,
    /// UI language: "system" (follow the device) or a locale code (e.g. "en", "es").
    #[serde(default = "default_language")]
    pub language: String,
    /// Custom keyboard-shortcut overrides, keyed by action id (e.g. `closeCenter`)
    /// → chord string (e.g. `Ctrl+W`). Missing actions fall back to their default
    /// binding; an empty string disables the action. Defaults are in the frontend.
    #[serde(default)]
    pub keybindings: std::collections::HashMap<String, String>,
    /// Active theme id (built-in "system"/"light"/"dark"/… or a custom id).
    #[serde(default = "default_theme_id")]
    pub active_theme_id: String,
    /// User-created themes (frontend-owned shape, persisted opaquely).
    #[serde(default)]
    pub custom_themes: Vec<serde_json::Value>,
    /// Global font override (frontend-owned shape).
    #[serde(default)]
    pub fonts: Option<serde_json::Value>,
    /// Global terminal typography override (frontend-owned shape).
    #[serde(default)]
    pub terminal_fonts: Option<serde_json::Value>,
    /// Saved terminal themes (frontend-owned shape, persisted opaquely).
    #[serde(default)]
    pub terminal_themes: Vec<serde_json::Value>,
    /// How the terminal theme is chosen: "single" or "scheme" (per light/dark).
    #[serde(default = "default_terminal_mode")]
    pub terminal_theme_mode: String,
    /// Active terminal theme id ("single" mode; "inherit" = no override).
    #[serde(default = "default_terminal_theme_id")]
    pub active_terminal_theme_id: String,
    /// Terminal theme for a light app theme ("scheme" mode).
    #[serde(default = "default_terminal_theme_id")]
    pub terminal_theme_light_id: String,
    /// Terminal theme for a dark app theme ("scheme" mode).
    #[serde(default = "default_terminal_theme_id")]
    pub terminal_theme_dark_id: String,
}

/// Default terminal-theme selection mode: a single theme for both schemes.
fn default_terminal_mode() -> String {
    "single".to_string()
}

/// Default active theme: follow the system light/dark preference.
fn default_theme_id() -> String {
    "system".to_string()
}

/// Default terminal theme: inherit the app theme (no override).
fn default_terminal_theme_id() -> String {
    "inherit".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        let terminal_profiles = default_terminal_profiles();
        let default_profile_id = terminal_profiles.first().map(|p| p.id.clone());
        Self {
            theme: Theme::System,
            left_sidebar_width: 280,
            right_sidebar_width: 350,
            left_sidebar_open: true,
            right_sidebar_open: true,
            terminal_profiles,
            default_profile_id,
            agent_profiles: Vec::new(),
            default_agent_id: None,
            agent_notifications: true,
            prevent_sleep: false,
            auto_install_hooks: true,
            language: default_language(),
            keybindings: std::collections::HashMap::new(),
            active_theme_id: default_theme_id(),
            custom_themes: Vec::new(),
            fonts: None,
            terminal_fonts: None,
            terminal_themes: Vec::new(),
            terminal_theme_mode: default_terminal_mode(),
            active_terminal_theme_id: default_terminal_theme_id(),
            terminal_theme_light_id: default_terminal_theme_id(),
            terminal_theme_dark_id: default_terminal_theme_id(),
        }
    }
}

/// Default UI language: follow the device.
fn default_language() -> String {
    "system".to_string()
}

/// Serde default for boolean settings that should default to `true`.
fn default_true() -> bool {
    true
}

impl AppSettings {
    /// Seed the platform's default profiles when none are stored (fresh install
    /// or state persisted before profiles existed), upgrade an untouched
    /// empty-starter install to them, and make sure `default_profile_id` points
    /// at a real profile.
    pub fn ensure_terminal_profiles(&mut self) {
        if self.terminal_profiles.is_empty() || self.terminal_profiles == empty_starter_profiles() {
            self.terminal_profiles = default_terminal_profiles();
        }
        let valid_default = self
            .default_profile_id
            .as_ref()
            .is_some_and(|id| self.terminal_profiles.iter().any(|p| &p.id == id));
        if !valid_default {
            self.default_profile_id = self.terminal_profiles.first().map(|p| p.id.clone());
        }
    }
}

/// Color theme preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

/// How long a cached agent state survives without an update before it is pruned
/// from disk (spec `02d` §1.5): 7 days. (The 30-minute "stale" threshold is a
/// UI-only concern, applied in the frontend `agentStatus` store.)
pub const AGENT_CACHE_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// A single agent state report — the mutable fields of an [`AgentStateEntry`],
/// as received from the hook server before it is stamped and cached.
#[derive(Debug, Clone)]
pub struct AgentReport {
    pub agent_id: String,
    pub status: AgentStatus,
    pub agent_type: Option<String>,
    pub prompt: Option<String>,
    pub tool: Option<String>,
    pub interrupted: bool,
}

/// Last-known state reported by an agent via the local hook server (spec `02d`
/// §1.1). Keyed by `agent_id` — the value the ADE injects as `UXNAN_AGENT_ID`
/// into each terminal (the PTY id), echoed back by the agent's hook so the
/// frontend can map a report to the terminal/worktree that produced it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEntry {
    /// Agent instance id (the `UXNAN_AGENT_ID` we injected = the PTY id).
    pub agent_id: String,
    pub status: AgentStatus,
    /// Agent kind reported by the hook (`claude`, `codex`, …), if any.
    #[serde(default)]
    pub agent_type: Option<String>,
    /// User prompt the agent is processing, if reported.
    #[serde(default)]
    pub prompt: Option<String>,
    /// Tool in use (`file_edit`, `bash`, `web_search`, …), if reported.
    #[serde(default)]
    pub tool: Option<String>,
    /// Whether the agent reported being interrupted.
    #[serde(default)]
    pub interrupted: bool,
    pub first_seen: i64,
    pub last_update: i64,
}

/// Reported lifecycle state of a CLI agent (§2.8 of the system architecture).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Working,
    Blocked,
    Waiting,
    Done,
}

impl AppData {
    /// Insert or update the cached state for an agent from a [`AgentReport`],
    /// stamping `now` (epoch seconds) as the last update. An existing entry keeps
    /// its `first_seen`. Returns the resulting entry (cloned).
    pub fn upsert_agent_state(&mut self, report: AgentReport, now: i64) -> AgentStateEntry {
        if let Some(entry) = self
            .agent_cache
            .iter_mut()
            .find(|e| e.agent_id == report.agent_id)
        {
            entry.status = report.status;
            entry.agent_type = report.agent_type;
            entry.prompt = report.prompt;
            entry.tool = report.tool;
            entry.interrupted = report.interrupted;
            entry.last_update = now;
            entry.clone()
        } else {
            let entry = AgentStateEntry {
                agent_id: report.agent_id,
                status: report.status,
                agent_type: report.agent_type,
                prompt: report.prompt,
                tool: report.tool,
                interrupted: report.interrupted,
                first_seen: now,
                last_update: now,
            };
            self.agent_cache.push(entry.clone());
            entry
        }
    }

    /// Drop cached agent states not updated within [`AGENT_CACHE_TTL_SECS`].
    /// Returns the number of entries removed.
    pub fn prune_agent_cache(&mut self, now: i64) -> usize {
        let before = self.agent_cache.len();
        self.agent_cache
            .retain(|e| now - e.last_update < AGENT_CACHE_TTL_SECS);
        before - self.agent_cache.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_app_data_uses_current_schema_version() {
        let data = AppData::default();
        assert_eq!(data.version, SCHEMA_VERSION);
        assert!(data.repos.is_empty());
        assert!(data.agent_cache.is_empty());
    }

    #[test]
    fn settings_serialize_with_camel_case_keys() {
        let json = serde_json::to_string(&AppSettings::default()).unwrap();
        assert!(json.contains("leftSidebarWidth"));
        assert!(json.contains("rightSidebarOpen"));
        // snake_case keys must NOT leak to the frontend.
        assert!(!json.contains("left_sidebar_width"));
    }

    #[test]
    fn agent_profiles_default_empty_and_serialize_camel_case() {
        let settings = AppSettings::default();
        assert!(settings.agent_profiles.is_empty());
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("agentProfiles"));
        assert!(!json.contains("agent_profiles"));
    }

    #[test]
    fn agent_profile_round_trips() {
        let agent = AgentProfile {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args: vec!["--model".to_string(), "opus".to_string()],
            terminal_profile_id: Some("pwsh7".to_string()),
            icon: Some("claudecode".to_string()),
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("terminalProfileId"));
        let back: AgentProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(agent, back);
        // Older agents (pre-shell/icon) still deserialize.
        let legacy: AgentProfile =
            serde_json::from_str(r#"{"id":"x","name":"X","command":"x"}"#).unwrap();
        assert!(legacy.terminal_profile_id.is_none() && legacy.icon.is_none());
    }

    #[test]
    fn settings_deserialize_without_agent_profiles_defaults_empty() {
        // State persisted before agents existed must still load.
        let json = r#"{"theme":"system","leftSidebarWidth":280,"rightSidebarWidth":350,
            "leftSidebarOpen":true,"rightSidebarOpen":true}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.agent_profiles.is_empty());
    }

    #[test]
    fn theme_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Theme::System).unwrap(), "\"system\"");
    }

    #[test]
    fn default_settings_seed_terminal_profiles() {
        let settings = AppSettings::default();
        assert!(!settings.terminal_profiles.is_empty());
        let default_id = settings.default_profile_id.as_ref().unwrap();
        assert!(settings
            .terminal_profiles
            .iter()
            .any(|p| &p.id == default_id));
    }

    #[test]
    fn ensure_seeds_when_empty_and_fixes_dangling_default() {
        let mut settings = AppSettings {
            terminal_profiles: Vec::new(),
            default_profile_id: Some("ghost".to_string()),
            ..AppSettings::default()
        };
        settings.ensure_terminal_profiles();
        assert!(!settings.terminal_profiles.is_empty());
        // The dangling default was repointed at a real profile.
        let default_id = settings.default_profile_id.as_ref().unwrap();
        assert!(settings
            .terminal_profiles
            .iter()
            .any(|p| &p.id == default_id));
    }

    #[test]
    fn ensure_upgrades_untouched_empty_starter_to_real_seed() {
        let mut settings = AppSettings {
            terminal_profiles: empty_starter_profiles(),
            ..AppSettings::default()
        };
        settings.ensure_terminal_profiles();
        // The old single empty starter is upgraded to the real platform seed.
        assert_eq!(settings.terminal_profiles, default_terminal_profiles());
    }

    #[test]
    fn windows_seed_powershell_bypasses_execution_policy() {
        // The seeded PowerShell profile must carry -ExecutionPolicy Bypass so npm
        // .ps1 agent shims run under the default Restricted policy.
        if cfg!(windows) {
            let ps = default_terminal_profiles()
                .into_iter()
                .find(|p| p.command == "powershell.exe")
                .expect("seed includes Windows PowerShell");
            assert!(ps.args.iter().any(|a| a == "Bypass"));
        }
    }

    fn report(agent_id: &str, status: AgentStatus) -> AgentReport {
        AgentReport {
            agent_id: agent_id.into(),
            status,
            agent_type: None,
            prompt: None,
            tool: None,
            interrupted: false,
        }
    }

    #[test]
    fn upsert_agent_state_inserts_then_updates_in_place() {
        let mut data = AppData::default();
        let first = data.upsert_agent_state(
            AgentReport {
                prompt: Some("do a thing".into()),
                tool: Some("bash".into()),
                agent_type: Some("claude".into()),
                ..report("pty1", AgentStatus::Working)
            },
            100,
        );
        assert_eq!(data.agent_cache.len(), 1);
        assert_eq!(first.first_seen, 100);
        // Same agent_id updates the existing entry (no duplicate), keeps first_seen.
        let second = data.upsert_agent_state(report("pty1", AgentStatus::Done), 250);
        assert_eq!(data.agent_cache.len(), 1);
        assert_eq!(second.status, AgentStatus::Done);
        assert_eq!(second.first_seen, 100);
        assert_eq!(second.last_update, 250);
    }

    #[test]
    fn prune_agent_cache_drops_only_expired_entries() {
        let mut data = AppData::default();
        data.upsert_agent_state(report("fresh", AgentStatus::Waiting), 0);
        let now = AGENT_CACHE_TTL_SECS + 10;
        // `fresh` is now older than the TTL; a just-updated one survives.
        data.upsert_agent_state(report("recent", AgentStatus::Working), now);
        let removed = data.prune_agent_cache(now);
        assert_eq!(removed, 1);
        assert_eq!(data.agent_cache.len(), 1);
        assert_eq!(data.agent_cache[0].agent_id, "recent");
    }

    #[test]
    fn agent_state_entry_round_trips_camel_case() {
        let entry = AgentStateEntry {
            agent_id: "pty1".into(),
            status: AgentStatus::Blocked,
            agent_type: Some("codex".into()),
            prompt: Some("p".into()),
            tool: Some("web_search".into()),
            interrupted: true,
            first_seen: 1,
            last_update: 2,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("agentId"));
        assert!(json.contains("agentType"));
        assert!(json.contains("lastUpdate"));
        let back: AgentStateEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry, back);
    }

    #[test]
    fn ensure_keeps_user_customized_profiles() {
        let custom = vec![TerminalProfile {
            id: "mine".to_string(),
            name: "My shell".to_string(),
            command: "fish".to_string(),
            args: Vec::new(),
        }];
        let mut settings = AppSettings {
            terminal_profiles: custom.clone(),
            default_profile_id: Some("mine".to_string()),
            ..AppSettings::default()
        };
        settings.ensure_terminal_profiles();
        assert_eq!(settings.terminal_profiles, custom);
    }
}
