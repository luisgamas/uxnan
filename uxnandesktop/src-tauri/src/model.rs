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
}

/// The single, empty starter profile shown to new users. Its placeholder fields
/// teach how a profile is configured; concrete shells are added from the
/// OS-grouped template picker in the frontend. A blank `command` falls back to
/// the platform default shell when a terminal is spawned.
pub fn default_terminal_profiles() -> Vec<TerminalProfile> {
    vec![TerminalProfile {
        id: "default".to_string(),
        name: String::new(),
        command: String::new(),
        args: Vec::new(),
    }]
}

/// The profiles a previous version auto-seeded (PowerShell / CMD / WSL on
/// Windows; login shell + bash elsewhere). Kept only so [`AppSettings::
/// ensure_terminal_profiles`] can recognise an untouched legacy seed and replace
/// it with the new single empty profile.
fn legacy_default_profiles() -> Vec<TerminalProfile> {
    if cfg!(windows) {
        vec![
            TerminalProfile {
                id: "powershell".to_string(),
                name: "PowerShell".to_string(),
                command: "powershell.exe".to_string(),
                args: vec!["-NoLogo".to_string()],
            },
            TerminalProfile {
                id: "cmd".to_string(),
                name: "Command Prompt".to_string(),
                command: "cmd.exe".to_string(),
                args: Vec::new(),
            },
            TerminalProfile {
                id: "wsl".to_string(),
                name: "WSL".to_string(),
                command: "wsl.exe".to_string(),
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
                id: "default".to_string(),
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
            language: default_language(),
        }
    }
}

/// Default UI language: follow the device.
fn default_language() -> String {
    "system".to_string()
}

impl AppSettings {
    /// Seed the starter profile when none are stored (fresh install or state
    /// persisted before profiles existed), replace an untouched legacy auto-seed
    /// with it, and make sure `default_profile_id` points at a real profile.
    pub fn ensure_terminal_profiles(&mut self) {
        if self.terminal_profiles.is_empty() || self.terminal_profiles == legacy_default_profiles()
        {
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
        };
        let json = serde_json::to_string(&agent).unwrap();
        let back: AgentProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(agent, back);
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
    fn ensure_replaces_untouched_legacy_seed_with_empty_starter() {
        let mut settings = AppSettings {
            terminal_profiles: legacy_default_profiles(),
            ..AppSettings::default()
        };
        settings.ensure_terminal_profiles();
        // The legacy auto-seed (>1 profile) collapses to the single empty starter.
        assert_eq!(settings.terminal_profiles, default_terminal_profiles());
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
