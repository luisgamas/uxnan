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
    /// UI language: "system" (follow the device) or a locale code (e.g. "en", "es").
    #[serde(default = "default_language")]
    pub language: String,
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
            language: default_language(),
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

/// Last-known state reported by an agent in a worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEntry {
    pub worktree_id: String,
    pub status: AgentStatus,
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
