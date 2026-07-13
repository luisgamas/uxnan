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
    /// User-chosen project icon: an inline `data:` URL (a file/URL/GitHub avatar
    /// rasterized to a small square PNG). `None` → the default folder glyph. The
    /// project's real folder name is never touched; `name` is display-only.
    #[serde(default)]
    pub icon: Option<String>,
    /// Per-branch custom icons, keyed by branch name (or the worktree path when
    /// detached). Same inline `data:` URL form as [`RepoData::icon`]. Absent
    /// branches fall back to the default branch glyph.
    #[serde(default)]
    pub branch_icons: std::collections::HashMap<String, String>,
    /// User's manual order for this project's child worktrees, as their absolute
    /// paths. Worktrees are read live from git (no stable id), so the order is
    /// keyed by path; the primary worktree is always listed first regardless.
    /// Paths no longer present are ignored, and freshly-seen ones fall to the end,
    /// so the list self-heals. Empty (the default) → the git listing order.
    #[serde(default)]
    pub worktree_order: Vec<String>,
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

/// A single environment variable a user can attach to an agent. Set on the
/// spawned shell (and thus inherited by the agent running inside it), e.g.
/// `ANTHROPIC_MODEL=claude-opus-4-8` or a proxy/host override. The ADE's own
/// `UXNAN_*` hook vars always win over a user-set key of the same name.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
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
    /// `None` falls back to the configured default agent shell
    /// ([`AppSettings::agent_shell_profile_id`]).
    #[serde(default)]
    pub terminal_profile_id: Option<String>,
    /// Environment variables set on the agent's shell at launch (inherited by the
    /// agent process). Empty by default; `UXNAN_*` hook vars take precedence over
    /// a user key of the same name.
    #[serde(default)]
    pub env: Vec<EnvVar>,
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
    /// Terminal profile used to launch agents that don't pin their own
    /// (`AgentProfile::terminal_profile_id == None`). `None` resolves to a smart
    /// default: Command Prompt (`cmd.exe`) on Windows — agent CLIs start faster
    /// and quote more predictably under cmd than PowerShell — else the default
    /// terminal profile. Frontend-resolved (see `app.svelte.ts`).
    #[serde(default)]
    pub agent_shell_profile_id: Option<String>,
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
    /// AI commit-message generation (opt-in; configured in Settings → AI commit).
    /// Spawns the chosen CLI agent non-interactively to draft a message from the
    /// staged diff. Disabled by default, so nothing ever runs unasked.
    #[serde(default)]
    pub ai_commit: AiCommitSettings,
    /// In-app auto-updater (Settings → Updates): release channel, whether to
    /// download new versions in the background, and how the install is applied
    /// (see `updater.rs`). All fields default, so older state loads unchanged.
    #[serde(default)]
    pub updater: UpdaterSettings,
    /// Integrated developer browser (Settings → Browser): whether links route to
    /// the in-app browser window vs the OS browser, and whether agents may drive it
    /// (see `BrowserSettings`). All fields default, so older state loads unchanged.
    #[serde(default)]
    pub browser: BrowserSettings,
    /// Width (px) of the integrated browser panel (the right-side "4th panel").
    #[serde(default = "default_browser_panel_width")]
    pub browser_panel_width: u32,
    /// AI providers whose usage stats the user activated (Settings → Providers).
    /// Frontend-owned shape (`UsageProviderConfig`), persisted opaquely. Only the
    /// providers listed here are ever polled by `usage_read`.
    #[serde(default)]
    pub usage_providers: Vec<serde_json::Value>,
    /// How often (minutes) activated providers refresh; a provider may override
    /// it in its own config. `0` = manual only. Default 5.
    #[serde(default = "default_usage_refresh_minutes")]
    pub usage_refresh_minutes: u32,
    /// Show the usage indicator + popover in the bottom status bar. Default on.
    #[serde(default = "default_true")]
    pub usage_status_bar_enabled: bool,
    /// Sort mode for the project cards in the left sidebar. Frontend-owned enum:
    /// `"manual" | "name-asc" | "name-desc" | "recent" | "attention"`. `"manual"`
    /// follows the persisted repo order (see `repo_reorder`); the rest are computed
    /// in the frontend. Unknown values fall back to manual there.
    #[serde(default = "default_sort_mode")]
    pub project_sort: String,
    /// Sort mode for the worktree rows within each project (same enum as
    /// [`AppSettings::project_sort`]). `"manual"` follows each repo's
    /// [`RepoData::worktree_order`]; the rest are computed in the frontend.
    #[serde(default = "default_sort_mode")]
    pub worktree_sort: String,
    /// Last-active timestamps (epoch ms) keyed by workspace path (a project's main
    /// worktree, or a child worktree), stamped when a workspace is opened. Feeds
    /// the "recent" sort mode. Unknown/stale paths are ignored, so it self-heals.
    #[serde(default)]
    pub workspace_last_active: std::collections::HashMap<String, i64>,
    /// Pinned projects (repo ids) — rendered first in the sidebar regardless of
    /// the active sort. Unknown ids are ignored (self-healing).
    #[serde(default)]
    pub pinned_projects: Vec<String>,
    /// Pinned worktrees (paths) — rendered first within their project regardless
    /// of the active sort. Unknown paths are ignored (self-healing).
    #[serde(default)]
    pub pinned_worktrees: Vec<String>,
    /// How the left sidebar groups its rows (frontend-owned enum):
    /// `"none"` = the project → worktree tree (default); `"status"` = every
    /// worktree flattened into lanes by agent attention. Unknown values fall back
    /// to `"none"` in the frontend.
    #[serde(default = "default_group_by")]
    pub sidebar_group_by: String,
    /// Attention lanes the user collapsed in the "group by status" view (the lane's
    /// attention class, 1–4). Persisted so the collapse survives a restart.
    #[serde(default)]
    pub sidebar_collapsed_lanes: Vec<u32>,
}

/// Default left-sidebar grouping: `"none"` (the project → worktree tree).
fn default_group_by() -> String {
    "none".to_string()
}

/// Default left-sidebar sort mode: `"manual"` (the user's own order), matching the
/// pre-existing behavior where cards followed their insertion order.
fn default_sort_mode() -> String {
    "manual".to_string()
}

/// Default width of the integrated browser panel.
fn default_browser_panel_width() -> u32 {
    520
}

/// Default usage-stats refresh interval, in minutes.
fn default_usage_refresh_minutes() -> u32 {
    5
}

/// Release channel the updater follows. Mapped to GitHub's only release
/// distinction — the `prerelease` flag — not to the tag's contents: a normal
/// Release feeds `Stable`; a Release marked *pre-release* feeds `Nightly`
/// (earlier, less-stable builds). So the tag can say anything (e.g.
/// `…-alpha.YYYYMMDD`) and still ship to Stable as long as the Release isn't
/// flagged pre-release. `Stable` is the default; `Nightly` is opt-in for testers
/// (see `docs/updates.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Nightly,
}

impl UpdateChannel {
    /// The channel's slug, used in the rolling per-channel manifest release tag
    /// (`desktop-updater-<slug>`).
    pub fn slug(self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Nightly => "nightly",
        }
    }
}

/// How a downloaded update is applied. The download itself is governed by
/// [`UpdaterSettings::auto_download`]; this only controls the install step, which
/// restarts the app (and therefore stops running agents — see `updater.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum InstallPolicy {
    /// Show the banner and wait for the user to choose (never installs unasked).
    #[default]
    Ask,
    /// Install automatically as soon as no agent is working (the safe window).
    WhenIdle,
    /// Never prompt to install; the user triggers it from the banner/Settings.
    Manual,
}

/// Auto-updater preferences (Settings → Updates). The check for a newer version
/// is always available; these govern the channel and how/when an update lands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSettings {
    /// Whether the app checks for updates automatically (on launch + periodically).
    /// The manual "Check now" button works regardless. Default on.
    #[serde(default = "default_true")]
    pub auto_check: bool,
    /// Release channel to follow. Default `stable`.
    #[serde(default)]
    pub channel: UpdateChannel,
    /// Download a found update in the background without asking. Disjoint from the
    /// install step. Default on (downloading never interrupts agents).
    #[serde(default = "default_true")]
    pub auto_download: bool,
    /// How a downloaded update is applied. Default `ask` (never installs unasked).
    #[serde(default)]
    pub install_policy: InstallPolicy,
}

impl Default for UpdaterSettings {
    fn default() -> Self {
        Self {
            auto_check: true,
            channel: UpdateChannel::Stable,
            auto_download: true,
            install_policy: InstallPolicy::Ask,
        }
    }
}

/// Where a link opens when the integrated browser is enabled. Governs both links
/// the user clicks inside the ADE and URLs agents try to open (via the injected
/// `BROWSER` shim — see `hooks.rs`). `Internal` uses the in-app browser tab;
/// `External` always hands off to the OS default browser; `Ask` defers the choice
/// to the user per link (frontend-resolved).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum BrowserLinkPolicy {
    #[default]
    Internal,
    External,
    Ask,
}

/// How the browser-control MCP server (spec `02d` §1.6) is made discoverable to the
/// CLI agents the ADE launches (see `mcpinject.rs`). `Managed` is the default: it
/// registers the server in each CLI's **user-global** config only — never the
/// project working directory. User-global config is not project-approval-gated for
/// any supported CLI, so there is no "approve this MCP server?" prompt and nothing
/// lands in the user's project folder (which they'd notice and delete). Hand-typed
/// agents in any folder still pick the server up, because every CLI reads its
/// user-global config too. With the frictionless setting on
/// ([`BrowserSettings::friction_free`]), app-launched agents additionally receive
/// first-party trust-skip flags so the CLI never prompts to trust the folder (see
/// `mcpinject.rs`). `Global` writes the same user-global config but leaves the CLIs'
/// own trust prompts intact. `Off` injects nothing — the user can wire it manually
/// from the copy-paste snippet in Settings → Browser.
///
/// The legacy `Workspace` mode (a project-scoped config in the working directory)
/// was **removed**: it was the sole source of both the project-dir files and the
/// project-approval prompts, and user-global config covers hand-typed agents just as
/// well. A persisted `"workspace"` value deserializes to `Managed` via the alias.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum McpInjection {
    Off,
    #[default]
    #[serde(alias = "workspace")]
    Managed,
    Global,
}

/// Integrated **developer** browser (Settings → Browser). A lightweight in-app
/// webview tab for previewing/debugging the systems agents build and opening the
/// links agents produce — deliberately not a general-purpose browser. The webview
/// is created lazily (only when a browser tab opens) and torn down when closed, so
/// it costs nothing until used. All fields default, so older state loads unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSettings {
    /// Master switch. When off, every link goes to the OS default browser and no
    /// `BROWSER` shim is injected into agents. Default on.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Where links open by default (see [`BrowserLinkPolicy`]). Default `internal`.
    #[serde(default)]
    pub link_policy: BrowserLinkPolicy,
    /// Let agents open URLs in the integrated browser by injecting a `BROWSER`
    /// shim into their environment (see `hooks.rs`). Default on.
    #[serde(default = "default_true")]
    pub allow_agents: bool,
    /// Make URLs printed in the terminal clickable (routed through `link_policy`).
    /// Default on.
    #[serde(default = "default_true")]
    pub terminal_links: bool,
    /// Page opened when a fresh browser tab has no target URL. Empty = blank tab.
    #[serde(default)]
    pub homepage: String,
    /// Expose the browser-control MCP server (spec `02d` §1.6) to agents, so they
    /// discover the `browser_*` tools automatically. When off, no MCP config is
    /// injected (the `/mcp` endpoint still exists for manual wiring). Default on.
    #[serde(default = "default_true")]
    pub mcp_enabled: bool,
    /// How the MCP server is injected into agents (see [`McpInjection`]). Default
    /// `managed`.
    #[serde(default)]
    pub mcp_injection: McpInjection,
    /// Frictionless agent setup. When on (default) and injection mode is `managed`,
    /// app-launched agents receive first-party trust-skip flags so the CLI never
    /// prompts to trust the workspace/folder on launch (e.g. Gemini `--skip-trust`),
    /// and per-folder trust is pre-seeded where the CLI supports it (e.g. Codex
    /// `projects."<cwd>".trust_level`). Turn off to keep the CLIs' native trust
    /// prompts. Applies only in `managed` mode.
    #[serde(default = "default_true")]
    pub friction_free: bool,
    /// Agent ids (`claude`, `codex`, `gemini`, `opencode`, `pi`) to skip when
    /// injecting the MCP config. Empty = every supported agent gets it. Default
    /// empty.
    #[serde(default)]
    pub mcp_disabled_agents: Vec<String>,
}

impl Default for BrowserSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            link_policy: BrowserLinkPolicy::Internal,
            allow_agents: true,
            terminal_links: true,
            homepage: String::new(),
            mcp_enabled: true,
            mcp_injection: McpInjection::default(),
            friction_free: true,
            mcp_disabled_agents: Vec::new(),
        }
    }
}

/// Configuration for the optional AI commit-message generator (spec `02c` §4.5).
/// The user picks a known **agent** and a **model**; the backend resolves the CLI
/// (`crate::agentcli`) and runs it one-shot with the built prompt. All fields
/// have back-compat defaults so older persisted state loads unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiCommitSettings {
    /// Master switch. Off by default — the "Generate" button is hidden and the
    /// command refuses while this is false.
    #[serde(default)]
    pub enabled: bool,
    /// Selected agent id: one of `claude`/`codex`/`gemini`/`opencode`/`pi`, or
    /// empty when none is chosen yet.
    #[serde(default)]
    pub agent_id: String,
    /// Selected model id (as the CLI's model flag expects it), or empty to let
    /// the CLI use its own default model.
    #[serde(default)]
    pub model: String,
    /// Preferred message language: `auto` (let the agent decide) or a language
    /// **name** the prompt states verbatim (e.g. `English`, `Spanish`).
    #[serde(default = "default_ai_commit_language")]
    pub language: String,
    /// Ask for a Conventional Commits style subject line. Default on.
    #[serde(default = "default_true")]
    pub conventional: bool,
    /// Also generate an extended body (vs. a subject line only). Default on.
    #[serde(default = "default_true")]
    pub include_body: bool,
    /// Extra free-form instructions appended to the prompt (e.g. "mention the
    /// ticket id"). Optional.
    #[serde(default)]
    pub instructions: String,
}

/// Default AI-commit language: let the agent decide.
fn default_ai_commit_language() -> String {
    "auto".to_string()
}

impl Default for AiCommitSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            agent_id: String::new(),
            model: String::new(),
            language: default_ai_commit_language(),
            conventional: true,
            include_body: true,
            instructions: String::new(),
        }
    }
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
            agent_shell_profile_id: None,
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
            ai_commit: AiCommitSettings::default(),
            updater: UpdaterSettings::default(),
            browser: BrowserSettings::default(),
            browser_panel_width: default_browser_panel_width(),
            usage_providers: Vec::new(),
            usage_refresh_minutes: default_usage_refresh_minutes(),
            usage_status_bar_enabled: true,
            project_sort: default_sort_mode(),
            worktree_sort: default_sort_mode(),
            workspace_last_active: std::collections::HashMap::new(),
            pinned_projects: Vec::new(),
            pinned_worktrees: Vec::new(),
            sidebar_group_by: default_group_by(),
            sidebar_collapsed_lanes: Vec::new(),
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
    /// Short preview of the agent's latest response (for `done` notifications).
    pub summary: Option<String>,
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
    /// Short preview of the agent's latest response (for `done` notifications).
    #[serde(default)]
    pub summary: Option<String>,
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
            entry.summary = report.summary;
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
                summary: report.summary,
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
            env: vec![EnvVar {
                key: "ANTHROPIC_MODEL".to_string(),
                value: "claude-opus-4-8".to_string(),
            }],
            icon: Some("claudecode".to_string()),
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("terminalProfileId"));
        assert!(json.contains("ANTHROPIC_MODEL"));
        let back: AgentProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(agent, back);
        // Older agents (pre-shell/env/icon) still deserialize.
        let legacy: AgentProfile =
            serde_json::from_str(r#"{"id":"x","name":"X","command":"x"}"#).unwrap();
        assert!(legacy.terminal_profile_id.is_none() && legacy.icon.is_none());
        assert!(legacy.env.is_empty());
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
    fn browser_settings_default_on_and_serialize_camel_case() {
        let settings = AppSettings::default();
        assert!(settings.browser.enabled);
        assert!(settings.browser.allow_agents);
        assert_eq!(settings.browser.link_policy, BrowserLinkPolicy::Internal);
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("linkPolicy"));
        assert!(json.contains("\"internal\""));
        assert!(!json.contains("link_policy"));
    }

    #[test]
    fn settings_deserialize_without_browser_defaults_on() {
        // State persisted before the integrated browser existed must still load,
        // and pick up the default-on browser settings.
        let json = r#"{"theme":"system","leftSidebarWidth":280,"rightSidebarWidth":350,
            "leftSidebarOpen":true,"rightSidebarOpen":true}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.browser.enabled);
        assert_eq!(settings.browser.link_policy, BrowserLinkPolicy::Internal);
    }

    #[test]
    fn ai_commit_defaults_off_and_back_compat() {
        // Fresh default: disabled, no agent, language auto, conventional+body on.
        let cfg = AiCommitSettings::default();
        assert!(!cfg.enabled);
        assert!(cfg.agent_id.is_empty());
        assert!(cfg.model.is_empty());
        assert_eq!(cfg.language, "auto");
        assert!(cfg.conventional && cfg.include_body);
        // Settings persisted before AI commit existed still load (field absent).
        let settings: AppSettings = serde_json::from_str(
            r#"{"theme":"system","leftSidebarWidth":280,"rightSidebarWidth":350,
                "leftSidebarOpen":true,"rightSidebarOpen":true}"#,
        )
        .unwrap();
        assert_eq!(settings.ai_commit, AiCommitSettings::default());
    }

    #[test]
    fn ai_commit_round_trips_camel_case() {
        let cfg = AiCommitSettings {
            enabled: true,
            agent_id: "claude".into(),
            model: "opus".into(),
            language: "Spanish".into(),
            conventional: true,
            include_body: false,
            instructions: "mention the ticket".into(),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("agentId"));
        assert!(json.contains("includeBody"));
        let back: AiCommitSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
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
            summary: None,
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
            summary: None,
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
