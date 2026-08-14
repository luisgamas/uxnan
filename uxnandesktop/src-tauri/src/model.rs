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
    /// User-programmed quick commands, runnable from the top-bar launcher. A flat
    /// list: each command carries its own [`QuickCommandScope`] + binding
    /// (`project_id` / `worktree_path`). Pruned by the frontend when the project
    /// or worktree it belongs to is removed. `#[serde(default)]` so older state
    /// loads with an empty list and no schema bump.
    #[serde(default)]
    pub quick_commands: Vec<QuickCommand>,
    /// Opaque, frontend-owned serialization of the orchestration engine's runs
    /// (the `Run` graph, step states + captured outputs — spec `02d` §3).
    /// Persisted so a run survives a restart and the engine re-attaches on load;
    /// the backend never interprets it (same pattern as `terminal_layout`).
    #[serde(default)]
    pub orchestration_runs: Option<serde_json::Value>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            repos: Vec::new(),
            settings: AppSettings::default(),
            agent_cache: Vec::new(),
            terminal_layout: None,
            quick_commands: Vec::new(),
            orchestration_runs: None,
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
    /// Per-project override of the managed worktree root, for a repository that
    /// belongs somewhere else than the rest (another volume, a path short enough
    /// for a deep dependency tree on Windows). `None` (the default) → the global
    /// setting. Ignored in `sibling` mode, which has no root.
    #[serde(default)]
    pub worktree_root: Option<String>,
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

/// Where a [`QuickCommand`] applies. A flat list of commands is scoped by this:
/// `Global` is always available; `Project` is bound to a repo id and shows for
/// every worktree of that project; `Worktree` is bound to a single worktree's
/// absolute path (worktrees have no stable id — see [`RepoData::worktree_order`]).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuickCommandScope {
    Global,
    Project,
    Worktree,
}

/// Where a [`QuickCommand`] runs. `NewTab` spawns a fresh integrated terminal;
/// `Active` types into the currently-focused integrated terminal.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuickCommandTarget {
    NewTab,
    Active,
}

/// Whether a [`QuickCommand`] auto-runs (`Execute`, typed with a trailing Enter)
/// or is only pre-typed into the shell for the user to run (`TypeOnly`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuickCommandRunMode {
    Execute,
    TypeOnly,
}

/// Working directory a [`QuickCommand`] runs in (only meaningful for
/// [`QuickCommandTarget::NewTab`]; the `Active` target inherits the focused
/// terminal's cwd).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuickCommandCwd {
    /// The active worktree/workspace folder.
    ActiveWorktree,
    /// The active project's root folder.
    ProjectRoot,
    /// A fixed custom path ([`QuickCommand::custom_cwd`]).
    Custom,
}

/// A user-programmed quick command, runnable from the top-bar launcher. The
/// `command` line may contain `{worktree}` / `{branch}` / `{repo}` /
/// `{repoName}` / `{path}` tokens, substituted with the active context at run
/// time. Same `camelCase` serialization as the rest of the model, mirrored in
/// `src/lib/types.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommand {
    pub id: String,
    pub name: String,
    /// The shell command line (may contain substitution tokens).
    pub command: String,
    /// Optional helper text shown in the menu/settings.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional icon: a builtin glyph key or an inline `data:` URL (same form as
    /// [`RepoData::icon`]); `None` → the default launcher glyph.
    #[serde(default)]
    pub icon: Option<String>,
    pub scope: QuickCommandScope,
    /// Bound repo id when `scope == Project`.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Bound worktree absolute path when `scope == Worktree`.
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default = "default_run_mode")]
    pub run_mode: QuickCommandRunMode,
    #[serde(default = "default_command_target")]
    pub target: QuickCommandTarget,
    #[serde(default = "default_command_cwd")]
    pub cwd: QuickCommandCwd,
    /// Fixed working directory when `cwd == Custom`.
    #[serde(default)]
    pub custom_cwd: Option<String>,
    /// Terminal profile (shell) to run in; `None` → the default terminal shell.
    #[serde(default)]
    pub shell_profile_id: Option<String>,
    /// Ask the user to confirm before running (for destructive commands).
    #[serde(default)]
    pub confirm: bool,
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
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Shell".to_string());
        vec![
            TerminalProfile {
                id: "login".to_string(),
                name: format!("{name} (login shell)"),
                command: shell,
                // A real login shell (`-l`) so it sources the user's login files
                // (Homebrew `PATH`, aliases) — matching Terminal.app and the
                // profile's own name.
                args: vec!["-l".to_string()],
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
    /// Name each agent session at launch, for the CLIs that accept a
    /// caller-chosen id (`claude`/`grok`/`pi --session-id`, `agy --conversation`).
    /// The tab is then resumable from the moment the agent starts instead of only
    /// once a hook has reported — which is what makes a conversation you never
    /// started come back too. Adds one flag to the launched command line, so it
    /// can be turned off. Default on; frontend-applied (`agentSessionId.ts`).
    #[serde(default = "default_true")]
    pub pin_agent_sessions: bool,
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
    /// Per-action override for which side wins a chord while a terminal is focused:
    /// `"app"` (uxnan) or `"terminal"` (the TUI/agent). Missing actions use their
    /// default policy (defined in the frontend). Persisted opaquely.
    #[serde(default)]
    pub terminal_key_policy: std::collections::HashMap<String, String>,
    /// Leader chord (tmux-style) that, in a focused terminal, routes the next
    /// shortcut to uxnan. Empty = off. Persisted opaquely.
    #[serde(default)]
    pub leader_key: String,
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
    /// Sprite-animated companions that mirror agent state (Settings → Pets, and
    /// the sidebar profile menu's toggle). Off by default, so nothing ever
    /// appears unasked. All fields default, so older state loads unchanged.
    #[serde(default)]
    pub pets: PetSettings,
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
    /// GitHub integration (the GitHub section + the right-panel GitHub tab). All
    /// fields default, so older state loads unchanged; the token itself is never
    /// stored here — `gh` owns it (see `github.rs`).
    #[serde(default)]
    pub github: GithubSettings,
    /// "Open with" external editors/IDEs (the project-card / worktree /
    /// file-tree menus). Holds the user's custom editors and which auto-detected
    /// ones they hid; the detected set itself is a live PATH probe (`editors.rs`),
    /// not persisted. Default empty.
    #[serde(default)]
    pub open_with: OpenWithSettings,
    /// Left-sidebar footer profile card (avatar, name, description); clicking it
    /// opens the Settings / GitHub sections. Frontend-owned shape
    /// (`SidebarProfile`), persisted opaquely. Absent by default.
    #[serde(default)]
    pub profile: Option<serde_json::Value>,
    /// Local resource observability (`resources.rs`): the backend-popover summary
    /// and Settings → Resources. All fields default, so older state loads
    /// unchanged (the additive-field migration path every settings struct uses).
    #[serde(default)]
    pub resources: ResourceSettings,
    /// Resource mode (Settings → Resources → Resource mode): the explicit
    /// efficiency/degradation profile plus per-capability overrides. All fields
    /// default (profile `balanced` = the pre-mode behavior), so older state
    /// loads unchanged. Semantic validation lives in the frontend policy engine
    /// (`src/lib/resources/policy.ts`); this struct only keeps the shape.
    #[serde(default)]
    pub resource_mode: ResourceModeSettings,
    /// Where new worktrees are created (Settings → Git → Worktree location).
    /// All fields default, so state written before this existed loads unchanged
    /// — and lands on the managed root, which only affects worktrees created
    /// from then on: the ones already on disk are read from `git worktree list`
    /// and keep working wherever they are.
    #[serde(default)]
    pub worktrees: WorktreeSettings,
}

/// Where the ADE puts a new worktree (spec `02c` §2.1). The layout itself lives
/// in `worktreeloc.rs`; this is only the user's choice of it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeLocationMode {
    /// `<root>/<repo>/<branch>` under a root the app manages — by default
    /// `<home>/uxnan/worktrees`, beside the folder the clone flow already writes
    /// to. Groups a repository's checkouts instead of scattering them, and is
    /// the same layout the bridge gives the phone.
    #[default]
    Managed,
    /// `<parent>/<repo>--<branch>`, the layout the app used before the managed
    /// root existed. Kept for anyone whose tooling expects the sibling folders.
    Sibling,
    /// `<custom-root>/<repo>/<branch>` — the managed layout under a root the
    /// user names (another drive, a shorter path, a folder outside a synced
    /// home).
    Custom,
}

/// Worktree placement settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSettings {
    /// Which layout new worktrees use.
    #[serde(default)]
    pub location: WorktreeLocationMode,
    /// Root for [`WorktreeLocationMode::Custom`]; ignored by the other modes.
    /// `None`/empty falls back to the default managed root rather than failing,
    /// so a half-configured setting never blocks creating a worktree.
    #[serde(default)]
    pub root: Option<String>,
    /// The user dismissed the status-bar nudge about the managed folder filling
    /// up. Set once and kept: a reminder that comes back after being waved away
    /// is nagging, and the cleanup section is always there to open on purpose.
    #[serde(default)]
    pub cleanup_notice_dismissed: bool,
}

/// Local resource observability (CPU / memory / process attribution for uxnan,
/// its terminals and agents — `resources.rs`).
///
/// The collector is demand-driven: with `enabled` on it still samples **only**
/// while a surface consumes it (the backend popover being open), so the default
/// configuration costs nothing at rest. The only background sampling is the
/// opt-in orphan sweep.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSettings {
    /// Master switch for the whole feature (popover section + Settings pane
    /// data). With no consumer the collector stays parked either way; off also
    /// hides the surfaces. Default on — a parked collector is free.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Background sweep that keeps sampling slowly with no UI open, so orphaned
    /// processes (a subtree that outlived its closed terminal) are noticed
    /// without the popover. Off by default: it is the one mode that costs
    /// anything unasked.
    #[serde(default)]
    pub orphan_sweep: bool,
    /// Sweep interval in seconds. Clamped to 15–30 when applied — below that the
    /// sweep would compete with the popover cadence, above it an orphan would
    /// linger unnoticed.
    #[serde(default = "default_orphan_sweep_seconds")]
    pub orphan_sweep_seconds: u32,
}

/// Default orphan-sweep interval (seconds), the middle of the allowed 15–30 band.
fn default_orphan_sweep_seconds() -> u32 {
    20
}

impl Default for ResourceSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            orphan_sweep: false,
            orphan_sweep_seconds: default_orphan_sweep_seconds(),
        }
    }
}

/// Resource mode: the explicit `efficient` / `balanced` / `performance`
/// profile governing background work (git sweeps, GitHub/provider polling,
/// orchestration concurrency, the resource monitor's history, the pet's idle
/// motion, workspace auto-sleep), with per-capability `overrides`.
///
/// Deliberately loose here: `profile` is a plain string and override values
/// are opaque JSON, because the **frontend policy engine**
/// (`src/lib/resources/policy.ts`) is the single validator — an unknown
/// profile resolves to `balanced` and an invalid override to "inherit" there,
/// so the backend never re-derives (and never disagrees about) the semantics.
/// The one backend consumer (the resource monitor's history budget) receives
/// its already-resolved parameter over `resources_set_policy`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceModeSettings {
    /// Selected profile. Default `balanced` — the pre-mode behavior.
    #[serde(default = "default_resource_profile")]
    pub profile: String,
    /// Per-capability overrides; `null` (or absence) = inherit from the
    /// preset. Unknown keys are dropped by the frontend on read, so stale keys
    /// self-heal instead of accumulating.
    #[serde(default)]
    pub overrides: std::collections::HashMap<String, serde_json::Value>,
    /// Feature flag for workspace auto-sleep. Off by default; the profile's
    /// auto-sleep capability only applies while this is on, so turning it off
    /// kills the behavior whatever the profile says (the rollback lever).
    #[serde(default)]
    pub auto_sleep: bool,
    /// Schema version of this block. The frontend treats a version newer than
    /// it knows as `balanced` with no overrides (rollback safety).
    #[serde(default = "default_resource_mode_schema_version")]
    pub schema_version: u32,
}

fn default_resource_profile() -> String {
    "balanced".to_string()
}

fn default_resource_mode_schema_version() -> u32 {
    1
}

impl Default for ResourceModeSettings {
    fn default() -> Self {
        Self {
            profile: default_resource_profile(),
            overrides: std::collections::HashMap::new(),
            auto_sleep: false,
            schema_version: default_resource_mode_schema_version(),
        }
    }
}

/// "Open with" configuration: user-added editors + hidden auto-detected ones.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithSettings {
    /// Editors the user added by hand (name + launch command + optional args).
    /// Shown alongside the auto-detected ones in every "Open with" menu.
    #[serde(default)]
    pub custom_editors: Vec<ExternalEditor>,
    /// Auto-detected editor ids (`editors::DetectedEditor::id`) the user hid from
    /// the menus. Unknown ids are ignored, so it self-heals.
    #[serde(default)]
    pub hidden_detected: Vec<String>,
    /// Per-detected-editor icon overrides, keyed by `editors::DetectedEditor::id`.
    /// A builtin-glyph key or an inline `data:` URL (same shape as a project icon).
    /// Absent → the auto-fetched favicon, else a generic glyph. Self-healing.
    #[serde(default)]
    pub detected_icons: std::collections::HashMap<String, String>,
}

/// One user-configured external editor (mirror of the frontend `ExternalEditor`).
/// Launched via the same path as a detected editor: `command` + `args` + the
/// target path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditor {
    /// Stable id (a UUID minted in the UI).
    pub id: String,
    /// Display name shown in the menu.
    pub name: String,
    /// Executable to launch (a PATH command or an absolute path).
    pub command: String,
    /// Extra arguments inserted before the target path.
    #[serde(default)]
    pub args: Vec<String>,
    /// Menu icon: a builtin-glyph key or an inline `data:` URL (same shape as a
    /// project icon). Absent → an auto-fetched favicon, else a generic glyph.
    #[serde(default)]
    pub icon: Option<String>,
}

/// GitHub integration settings (Settings live in the GitHub section → Settings).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSettings {
    /// Show the contextual GitHub tab in the right panel (per-worktree PR/CI). When
    /// `true` it appears only for GitHub repos; `false` hides it everywhere.
    #[serde(default = "default_true")]
    pub right_panel_tab: bool,
    /// Show the GitHub status/quota button in the bottom status bar. Default on.
    #[serde(default = "default_true")]
    pub status_bar_enabled: bool,
    /// How often (seconds) the active worktree's PR/CI context refreshes while the
    /// window is focused. `0` = manual only. Default 45.
    #[serde(default = "default_github_poll_seconds")]
    pub poll_seconds: u32,
    /// Poll the GitHub notifications count for the status-bar badge. Default off (an
    /// extra request; opt-in).
    #[serde(default)]
    pub notifications_enabled: bool,
    /// Ask for confirmation before creating or merging a pull request (from both the
    /// GitHub section and the right-panel tab). Default on.
    #[serde(default = "default_true")]
    pub confirm_pr: bool,
    /// Agent id used to draft PR bodies / review summaries from a diff (same catalog
    /// as AI commit). `None` = the feature's AI button is hidden.
    #[serde(default)]
    pub ai_agent_id: Option<String>,
    /// Model for the AI-authoring agent (`None` = the CLI's default).
    #[serde(default)]
    pub ai_model: Option<String>,
    /// Master switch for AI PR authoring, mirroring [`AiCommitSettings::enabled`]:
    /// keeping a configured agent while the feature is off is a state the
    /// agent-only `ai_agent_id` couldn't express. Off by default, so nothing ever
    /// runs unasked.
    #[serde(default)]
    pub ai_enabled: bool,
    /// Preferred language for the drafted body: `auto` (let the agent decide) or a
    /// language **name** stated verbatim in the prompt (e.g. `English`).
    #[serde(default = "default_ai_commit_language")]
    pub ai_language: String,
    /// Extra free-form instructions appended to the PR-body prompt.
    #[serde(default)]
    pub ai_instructions: String,
}

impl Default for GithubSettings {
    fn default() -> Self {
        Self {
            right_panel_tab: true,
            status_bar_enabled: true,
            poll_seconds: default_github_poll_seconds(),
            notifications_enabled: false,
            confirm_pr: true,
            ai_agent_id: None,
            ai_model: None,
            ai_enabled: false,
            ai_language: default_ai_commit_language(),
            ai_instructions: String::new(),
        }
    }
}

/// Default GitHub context poll interval (seconds).
fn default_github_poll_seconds() -> u32 {
    45
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
    /// Expose the browser-control MCP server (spec `02d` §1.6) to the agents the
    /// ADE launches, so they discover the `browser_*` tools automatically. The
    /// server is registered **per launch** — in the process uxnan spawns, never
    /// in a config file the user keeps (see `mcpinject.rs`). When off, nothing is
    /// registered (the `/mcp` endpoint still exists for manual wiring). Default on.
    #[serde(default = "default_true")]
    pub mcp_enabled: bool,
    /// Frictionless agent setup. When on (default), app-launched agents skip the
    /// CLI's folder-trust prompt where the CLI supports being told so ahead of
    /// time (today Codex, via a per-folder `projects."<cwd>".trust_level` seed).
    /// Turn off to keep the CLIs' native trust prompts.
    #[serde(default = "default_true")]
    pub friction_free: bool,
    /// Agent ids (`claude`, `codex`, `opencode`) to skip when registering the MCP
    /// server at launch. Empty = every supported agent gets it. Default empty.
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
            friction_free: true,
            mcp_disabled_agents: Vec::new(),
        }
    }
}

/// Sprite-animated companions that mirror agent state (`pets.rs`).
///
/// Deliberately opt-in: `enabled` is false by default, so a user who never asks
/// for a pet never gets one. The bundled pets are uxnan's own; every other pet
/// is imported by the user from a folder they already have (typically
/// `~/.codex/pets`), and its artwork stays its author's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSettings {
    /// Master switch, also toggled from the sidebar profile menu. Default off.
    #[serde(default)]
    pub enabled: bool,
    /// Show the pet in its own borderless, transparent, always-on-top desktop
    /// window (visible over other apps and while uxnan is minimized), like the
    /// Codex desktop pet. **On by default** — turning it off keeps the pet as a
    /// layer inside the uxnan window instead.
    #[serde(default = "default_true")]
    pub overlay: bool,
    /// When the desktop pet is clicked, also bring the uxnan window to the
    /// front before revealing the agent's terminal. Off by default: a pet click
    /// should not yank the app over whatever the user is doing unless they ask.
    #[serde(default)]
    pub raise_on_click: bool,
    /// Last position of the desktop pet window (physical px, top-left corner).
    /// `None` until first dragged; the window then rests near the primary
    /// monitor's bottom-right corner. A saved spot on a monitor that is no
    /// longer attached is ignored at creation (see `pet_window_show`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_y: Option<i32>,
    /// Id of the active pet. Empty = the bundled default.
    #[serde(default)]
    pub active_pet_id: String,
    /// Rendered pet height in px (the sprite scales to it). Default 144 — the
    /// middle of the ladder offered in Settings; see `PET_SIZES` in
    /// `src/lib/pets/manifest.ts`.
    #[serde(default = "default_pet_size")]
    pub size: u32,
    /// Which screen corner the pet rests in: `"bottom-right"`, `"bottom-left"`,
    /// `"top-right"`, `"top-left"`. Frontend-owned enum; unknown values fall back
    /// to bottom-right there.
    #[serde(default = "default_pet_corner")]
    pub corner: String,
    /// Manual offset (px) from that corner, set by dragging the pet. Persisted so
    /// it stays where the user parked it.
    #[serde(default)]
    pub offset_x: i32,
    #[serde(default)]
    pub offset_y: i32,
    /// Play animations. Off renders a single still frame — the same escape hatch
    /// the OS "reduce motion" preference triggers automatically. Default on.
    #[serde(default = "default_true")]
    pub animate: bool,
    /// Clicking the pet focuses the agent whose state it is showing. Default on.
    #[serde(default = "default_true")]
    pub click_to_focus: bool,
    /// Provenance notices the user dismissed in the import UI (by key), so a
    /// one-time explanation doesn't nag on every visit.
    #[serde(default)]
    pub dismissed_notices: Vec<String>,
}

fn default_pet_size() -> u32 {
    144
}

fn default_pet_corner() -> String {
    "bottom-right".into()
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            overlay: true,
            raise_on_click: false,
            screen_x: None,
            screen_y: None,
            active_pet_id: String::new(),
            size: default_pet_size(),
            corner: default_pet_corner(),
            offset_x: 0,
            offset_y: 0,
            animate: true,
            click_to_focus: true,
            dismissed_notices: Vec::new(),
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
    /// Selected agent id: one of `claude`/`codex`/`opencode`/`pi`/`agy`/`grok`, or
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
            pin_agent_sessions: true,
            auto_install_hooks: true,
            language: default_language(),
            keybindings: std::collections::HashMap::new(),
            terminal_key_policy: std::collections::HashMap::new(),
            leader_key: String::new(),
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
            pets: PetSettings::default(),
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
            github: GithubSettings::default(),
            open_with: OpenWithSettings::default(),
            profile: None,
            resources: ResourceSettings::default(),
            resource_mode: ResourceModeSettings::default(),
            worktrees: WorktreeSettings::default(),
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

/// Serde default for [`QuickCommand::run_mode`] — auto-run.
fn default_run_mode() -> QuickCommandRunMode {
    QuickCommandRunMode::Execute
}

/// Serde default for [`QuickCommand::target`] — a fresh terminal tab.
fn default_command_target() -> QuickCommandTarget {
    QuickCommandTarget::NewTab
}

/// Serde default for [`QuickCommand::cwd`] — the active worktree.
fn default_command_cwd() -> QuickCommandCwd {
    QuickCommandCwd::ActiveWorktree
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

/// The provider's own conversation/session identity for a running agent, as
/// captured from its hook payload (spec `02d` §1.1). This is what the CLI's
/// resume entry point addresses — PTY/tab ids are useless as resume targets.
/// The id is sanitized at ingestion (`hooks::extract_session`): it later
/// reaches a command line, so it is treated as hostile input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    /// The provider session id (`claude --resume <id>`, `codex resume <id>`, …).
    pub id: String,
    /// A session/transcript file path, when the provider reports one (Pi
    /// resumes by file; Claude names its transcript separately from the id).
    #[serde(default)]
    pub file: Option<String>,
    pub captured_at: i64,
}

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
    /// Provider session identity, when this event's payload carried one. `None`
    /// never clears a previously captured session (see `upsert_agent_state`).
    pub session: Option<AgentSession>,
}

/// Max sub-agents tracked per parent session — a safety cap so a runaway
/// spawn loop can't grow the roster unbounded (oldest finished child is dropped
/// first when exceeded).
pub const MAX_SUBAGENTS: usize = 32;

/// A sub-agent (child a parent agent spawned, e.g. a Claude Task-tool subagent)
/// tracked *within* a parent PTY session. A child runs inside the parent's CLI
/// process, so its hook reports carry the same outer `agent_id` (PTY id) as the
/// parent; the child is distinguished by an id pulled from the raw hook payload.
/// Children only ever reach `working` / `done`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentEntry {
    /// Stable id of the child within the parent session (from the raw payload).
    pub id: String,
    /// The child's declared kind (a Claude `subagent_type`, e.g. `code-reviewer`),
    /// if the payload carried one.
    #[serde(default)]
    pub agent_type: Option<String>,
    /// Short description of the child's task, if reported.
    #[serde(default)]
    pub description: Option<String>,
    /// The tool the child is running right now, when the CLI reports its
    /// children's activity separately from the parent's. Only the agents whose
    /// children own a **session of their own** can fill this (Grok, OpenCode):
    /// for Claude and Codex a child's tool events carry the parent's session id,
    /// so they are the parent's activity and are shown on the parent's line.
    #[serde(default)]
    pub tool: Option<String>,
    pub status: AgentStatus,
    pub started_at: i64,
    pub last_update: i64,
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
    /// Sub-agents (children this session spawned, e.g. Claude Task-tool
    /// subagents). Empty for agents that don't spawn children.
    #[serde(default)]
    pub subagents: Vec<SubagentEntry>,
    /// The provider's own session identity (latest captured), for resume.
    #[serde(default)]
    pub session: Option<AgentSession>,
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
            // A report naming a (different) agent re-identifies the terminal — the
            // same tab can host a new agent. One naming NONE never blanks an
            // identity we already have: a reporter that omits the type (or whose
            // type was rejected at ingestion) would otherwise strip the tab's
            // agent, and with it the resume command its captured session maps to.
            // Same rule as `session` below.
            if report.agent_type.is_some() {
                entry.agent_type = report.agent_type;
            }
            entry.prompt = report.prompt;
            entry.tool = report.tool;
            entry.interrupted = report.interrupted;
            entry.summary = report.summary;
            // Latest capture wins, but an event without a session (most hook
            // events don't repeat it) never clears one already captured.
            if report.session.is_some() {
                entry.session = report.session;
            }
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
                subagents: Vec::new(),
                session: report.session,
                first_seen: now,
                last_update: now,
            };
            self.agent_cache.push(entry.clone());
            entry
        }
    }

    /// Drop an agent's cached state — the hook reported a **session boundary**
    /// (its TUI opened, resumed or was cleared), so the turn the cache holds
    /// belongs to a session that no longer exists: its prompt, tool, reply,
    /// interrupt flag and sub-agent roster all describe the previous one.
    ///
    /// Removing the entry rather than rewriting it is what keeps a fresh session
    /// honest: the four reported states all claim something (working, blocked,
    /// waiting, done) and none of them is true of an agent sitting at an empty
    /// prompt, so the tab falls back to the neutral idle the display derives when
    /// no hook state exists. Returns whether anything was cached.
    pub fn clear_agent_state(&mut self, agent_id: &str) -> bool {
        let before = self.agent_cache.len();
        self.agent_cache.retain(|e| e.agent_id != agent_id);
        self.agent_cache.len() != before
    }

    /// Record a sub-agent (child) lifecycle event under its parent PTY entry,
    /// **without touching the parent's own status** (a child spawn/finish must
    /// not flip the parent to working/done). Upserts the child by id; the parent
    /// entry is seeded as `working` if the child reports before the parent's first
    /// status. `parent.last_update` is bumped so an active child keeps the parent
    /// fresh. Returns the resulting parent entry (cloned) for broadcast.
    pub fn upsert_subagent(
        &mut self,
        parent_agent_id: String,
        child: SubagentEntry,
        now: i64,
    ) -> AgentStateEntry {
        let idx = match self
            .agent_cache
            .iter()
            .position(|e| e.agent_id == parent_agent_id)
        {
            Some(i) => i,
            None => {
                self.agent_cache.push(AgentStateEntry {
                    agent_id: parent_agent_id,
                    status: AgentStatus::Working,
                    agent_type: None,
                    prompt: None,
                    tool: None,
                    interrupted: false,
                    summary: None,
                    subagents: Vec::new(),
                    session: None,
                    first_seen: now,
                    last_update: now,
                });
                self.agent_cache.len() - 1
            }
        };
        let parent = &mut self.agent_cache[idx];
        if let Some(existing) = parent.subagents.iter_mut().find(|s| s.id == child.id) {
            existing.status = child.status;
            if child.agent_type.is_some() {
                existing.agent_type = child.agent_type;
            }
            if child.description.is_some() {
                existing.description = child.description;
            }
            // A finished child is not running anything: clearing the tool keeps
            // its row from freezing on whatever it happened to be doing last.
            if child.status == AgentStatus::Done {
                existing.tool = None;
            }
            existing.last_update = now;
        } else {
            // Cap the roster: when full, drop the oldest finished child (or the
            // oldest overall) so a spawn storm can't grow it without bound.
            if parent.subagents.len() >= MAX_SUBAGENTS {
                let drop_at = parent
                    .subagents
                    .iter()
                    .position(|s| s.status == AgentStatus::Done)
                    .unwrap_or(0);
                parent.subagents.remove(drop_at);
            }
            parent.subagents.push(child);
        }
        parent.last_update = now;
        parent.clone()
    }

    /// Whether `session_id` names a **child** of `parent_agent_id` — a sub-agent
    /// already on the roster whose id is the session it runs under.
    ///
    /// This is how a report is told apart from its parent's on the CLIs that run
    /// a child in a session of its own. Measured on Grok: a child emits its own
    /// `user_prompt_submit` and `session_end` under the *parent's* PTY, carrying
    /// the child's `sessionId` — and `session_end` maps to `done`, so the parent's
    /// card read "Done" while it was still working. Claude and Codex are
    /// unaffected: their children's events carry the parent's session id, which
    /// never matches a roster entry, so nothing here fires.
    pub fn is_subagent_session(&self, parent_agent_id: &str, session_id: &str) -> bool {
        if session_id.is_empty() {
            return false;
        }
        self.agent_cache
            .iter()
            .find(|e| e.agent_id == parent_agent_id)
            .is_some_and(|e| e.subagents.iter().any(|s| s.id == session_id))
    }

    /// Record what a **child** is doing right now, from an event that belongs to
    /// the child's own session. Never touches the parent's status, prompt, reply
    /// or captured session — the whole point is that a child's activity is the
    /// child's. `tool` is `None` for an event that isn't a tool step, which
    /// leaves whatever the child was already doing in place.
    ///
    /// Returns the parent entry for broadcast, or `None` when the child is
    /// unknown (nothing to attribute it to, and inventing a row is worse).
    pub fn touch_subagent_activity(
        &mut self,
        parent_agent_id: &str,
        child_id: &str,
        tool: Option<String>,
        now: i64,
    ) -> Option<AgentStateEntry> {
        let parent = self
            .agent_cache
            .iter_mut()
            .find(|e| e.agent_id == parent_agent_id)?;
        let child = parent.subagents.iter_mut().find(|s| s.id == child_id)?;
        if tool.is_some() {
            child.tool = tool;
        }
        child.last_update = now;
        // The parent stays fresh while a child of its own is working, so the
        // staleness dimming doesn't kick in mid-task.
        parent.last_update = now;
        Some(parent.clone())
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
        assert!(data.orchestration_runs.is_none());
    }

    #[test]
    fn orchestration_runs_default_absent_and_round_trip() {
        // State persisted before orchestration runs existed must still load.
        let legacy: AppData = serde_json::from_str(
            r#"{"version":1,"repos":[],"settings":{"theme":"system","leftSidebarWidth":280,
                "rightSidebarWidth":350,"leftSidebarOpen":true,"rightSidebarOpen":true}}"#,
        )
        .unwrap();
        assert!(legacy.orchestration_runs.is_none());
        // The opaque runs blob round-trips under the camelCase key, untouched.
        let data = AppData {
            orchestration_runs: Some(serde_json::json!([{ "id": "r1", "steps": [] }])),
            ..Default::default()
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("orchestrationRuns"));
        let back: AppData = serde_json::from_str(&json).unwrap();
        assert_eq!(back.orchestration_runs, data.orchestration_runs);
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
    fn github_ai_defaults_off_and_back_compat() {
        let cfg = GithubSettings::default();
        assert!(!cfg.ai_enabled);
        assert!(cfg.ai_agent_id.is_none());
        assert_eq!(cfg.ai_language, "auto");
        assert!(cfg.ai_instructions.is_empty());
        // Settings persisted before the AI-PR knobs existed still load: the new
        // fields default rather than failing the whole settings read.
        let cfg: GithubSettings = serde_json::from_str(
            r#"{"rightPanelTab":true,"statusBarEnabled":true,"pollSeconds":45,
                "confirmPr":true,"aiAgentId":"claude"}"#,
        )
        .unwrap();
        assert_eq!(cfg.ai_agent_id.as_deref(), Some("claude"));
        assert!(!cfg.ai_enabled);
        assert_eq!(cfg.ai_language, "auto");
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
    fn open_with_round_trips_camel_case() {
        let cfg = OpenWithSettings {
            custom_editors: vec![ExternalEditor {
                id: "abc".into(),
                name: "My Editor".into(),
                command: r"C:\Apps\ed.exe".into(),
                args: vec!["--flag".into()],
                icon: Some("data:image/png;base64,AAAA".into()),
            }],
            hidden_detected: vec!["vscode".into()],
            detected_icons: std::collections::HashMap::from([(
                "cursor".to_string(),
                "builtin:code".to_string(),
            )]),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("customEditors"));
        assert!(json.contains("hiddenDetected"));
        assert!(json.contains("detectedIcons"));
        let back: OpenWithSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn app_settings_with_open_with_round_trips() {
        // `update_settings` deserializes the whole `AppSettings` the frontend
        // sends; make sure the new `open_with` field never breaks that path
        // (a broken deserialize would stall the debounced-persist-on-close write).
        let mut settings = AppSettings::default();
        settings.open_with.custom_editors.push(ExternalEditor {
            id: "id".into(),
            name: "n".into(),
            command: "code".into(),
            args: Vec::new(),
            icon: None,
        });
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("openWith"));
        let back: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.open_with, settings.open_with);
    }

    #[test]
    fn resource_mode_defaults_to_balanced_with_no_overrides() {
        let settings = AppSettings::default();
        assert_eq!(settings.resource_mode.profile, "balanced");
        assert!(settings.resource_mode.overrides.is_empty());
        assert!(!settings.resource_mode.auto_sleep);
        assert_eq!(settings.resource_mode.schema_version, 1);
    }

    #[test]
    fn settings_deserialize_without_resource_mode_defaults_balanced() {
        // State persisted before the resource mode existed must still load and
        // land on the profile that changes nothing.
        let json = r#"{"theme":"system","leftSidebarWidth":280,"rightSidebarWidth":350,
            "leftSidebarOpen":true,"rightSidebarOpen":true}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.resource_mode, ResourceModeSettings::default());
    }

    #[test]
    fn resource_mode_round_trips_camel_case_with_opaque_overrides() {
        let mut cfg = ResourceModeSettings {
            profile: "efficient".into(),
            auto_sleep: true,
            ..Default::default()
        };
        // Overrides are opaque JSON here (the frontend policy engine validates
        // them); the backend must round-trip them byte-for-byte, nulls included.
        cfg.overrides
            .insert("orchestrationConcurrency".into(), serde_json::json!(2));
        cfg.overrides
            .insert("gitSweepIntervalMs".into(), serde_json::Value::Null);
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("autoSleep"));
        assert!(json.contains("schemaVersion"));
        assert!(!json.contains("auto_sleep"));
        let back: ResourceModeSettings = serde_json::from_str(&json).unwrap();
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
            session: None,
        }
    }

    #[test]
    fn upsert_agent_state_keeps_session_unless_replaced() {
        let mut data = AppData::default();
        let with_session = AgentReport {
            session: Some(AgentSession {
                id: "abc-123".into(),
                file: None,
                captured_at: 10,
            }),
            ..report("a1", AgentStatus::Working)
        };
        assert_eq!(
            data.upsert_agent_state(with_session, 10)
                .session
                .as_ref()
                .map(|s| s.id.as_str()),
            Some("abc-123")
        );
        // A later event WITHOUT a session must not clear the captured one.
        let kept = data.upsert_agent_state(report("a1", AgentStatus::Done), 20);
        assert_eq!(
            kept.session.as_ref().map(|s| s.id.as_str()),
            Some("abc-123")
        );
        // A later event WITH a session replaces it.
        let replaced = data.upsert_agent_state(
            AgentReport {
                session: Some(AgentSession {
                    id: "def-456".into(),
                    file: Some("/tmp/t.jsonl".into()),
                    captured_at: 30,
                }),
                ..report("a1", AgentStatus::Working)
            },
            30,
        );
        assert_eq!(
            replaced.session.as_ref().map(|s| s.id.as_str()),
            Some("def-456")
        );
    }

    #[test]
    fn upsert_agent_state_keeps_the_agent_type_unless_renamed() {
        let mut data = AppData::default();
        let typed = AgentReport {
            agent_type: Some("codex".into()),
            session: Some(AgentSession {
                id: "019f-abc".into(),
                file: None,
                captured_at: 10,
            }),
            ..report("pty-1", AgentStatus::Working)
        };
        assert_eq!(
            data.upsert_agent_state(typed, 10).agent_type.as_deref(),
            Some("codex")
        );
        // A report with NO type must not blank the identity: the captured session
        // is only resumable while we still know which CLI owns it.
        let kept = data.upsert_agent_state(report("pty-1", AgentStatus::Done), 20);
        assert_eq!(kept.agent_type.as_deref(), Some("codex"));
        assert_eq!(
            kept.session.as_ref().map(|s| s.id.as_str()),
            Some("019f-abc")
        );
        // A report naming a different agent DOES re-identify the tab (the same
        // terminal can host a new agent).
        let renamed = data.upsert_agent_state(
            AgentReport {
                agent_type: Some("claude".into()),
                ..report("pty-1", AgentStatus::Working)
            },
            30,
        );
        assert_eq!(renamed.agent_type.as_deref(), Some("claude"));
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
    fn upsert_subagent_tracks_children_without_touching_parent() {
        let mut data = AppData::default();
        // Parent reports working first.
        data.upsert_agent_state(report("pty1", AgentStatus::Working), 100);
        // A child spawns (SubagentStart → working). Parent status must not change.
        let child = |status| SubagentEntry {
            id: "child-a".into(),
            agent_type: Some("code-reviewer".into()),
            description: Some("review the diff".into()),
            tool: None,
            status,
            started_at: 110,
            last_update: 110,
        };
        let parent = data.upsert_subagent("pty1".into(), child(AgentStatus::Working), 110);
        assert_eq!(parent.status, AgentStatus::Working);
        assert_eq!(parent.subagents.len(), 1);
        assert_eq!(parent.subagents[0].status, AgentStatus::Working);
        assert_eq!(parent.last_update, 110);
        // Same child finishes (SubagentStop → done) → updated in place, not duplicated.
        let parent = data.upsert_subagent("pty1".into(), child(AgentStatus::Done), 120);
        assert_eq!(parent.subagents.len(), 1);
        assert_eq!(parent.subagents[0].status, AgentStatus::Done);
        // Parent's own status is still whatever it last reported.
        assert_eq!(parent.status, AgentStatus::Working);
    }

    #[test]
    fn upsert_subagent_seeds_parent_when_child_reports_first() {
        let mut data = AppData::default();
        let parent = data.upsert_subagent(
            "pty2".into(),
            SubagentEntry {
                id: "c1".into(),
                agent_type: None,
                description: None,
                tool: None,
                status: AgentStatus::Working,
                started_at: 5,
                last_update: 5,
            },
            5,
        );
        assert_eq!(parent.status, AgentStatus::Working);
        assert_eq!(data.agent_cache.len(), 1);
        assert_eq!(data.agent_cache[0].subagents.len(), 1);
    }

    /// A child that runs in a session of its own (Grok, OpenCode) is recognized
    /// by that session id, so its own events can be kept off the parent.
    #[test]
    fn subagent_session_is_recognized_only_for_known_children() {
        let mut data = AppData::default();
        data.upsert_agent_state(report("pty1", AgentStatus::Working), 100);
        data.upsert_subagent(
            "pty1".into(),
            SubagentEntry {
                id: "sess-child".into(),
                agent_type: Some("general-purpose".into()),
                description: Some("say hello".into()),
                tool: None,
                status: AgentStatus::Working,
                started_at: 110,
                last_update: 110,
            },
            110,
        );
        assert!(data.is_subagent_session("pty1", "sess-child"));
        // The parent's own session, an unknown id and an empty one are not children.
        assert!(!data.is_subagent_session("pty1", "sess-parent"));
        assert!(!data.is_subagent_session("pty1", ""));
        // Another tab's roster must never answer for this one.
        assert!(!data.is_subagent_session("pty2", "sess-child"));
    }

    #[test]
    fn touch_subagent_activity_updates_child_and_leaves_parent_alone() {
        let mut data = AppData::default();
        data.upsert_agent_state(
            AgentReport {
                prompt: Some("the user's question".into()),
                ..report("pty1", AgentStatus::Working)
            },
            100,
        );
        data.upsert_subagent(
            "pty1".into(),
            SubagentEntry {
                id: "sess-child".into(),
                agent_type: None,
                description: Some("say hello".into()),
                tool: None,
                status: AgentStatus::Working,
                started_at: 110,
                last_update: 110,
            },
            110,
        );
        let parent = data
            .touch_subagent_activity("pty1", "sess-child", Some("bash".into()), 130)
            .expect("known child");
        assert_eq!(parent.subagents[0].tool.as_deref(), Some("bash"));
        assert_eq!(parent.subagents[0].last_update, 130);
        // Nothing of the parent's own turn moved.
        assert_eq!(parent.status, AgentStatus::Working);
        assert_eq!(parent.prompt.as_deref(), Some("the user's question"));
        // An event with no tool keeps the child's current one rather than blanking it.
        let parent = data
            .touch_subagent_activity("pty1", "sess-child", None, 140)
            .expect("known child");
        assert_eq!(parent.subagents[0].tool.as_deref(), Some("bash"));
        // An unknown child is not invented.
        assert!(data
            .touch_subagent_activity("pty1", "nope", Some("bash".into()), 150)
            .is_none());
    }

    /// A finished child is not running anything — its tool must be cleared so the
    /// row doesn't freeze on the last thing it happened to do.
    #[test]
    fn finished_child_clears_its_tool() {
        let mut data = AppData::default();
        let child = |status, tool: Option<&str>| SubagentEntry {
            id: "c".into(),
            agent_type: None,
            description: None,
            tool: tool.map(String::from),
            status,
            started_at: 10,
            last_update: 10,
        };
        data.upsert_subagent("pty1".into(), child(AgentStatus::Working, None), 10);
        data.touch_subagent_activity("pty1", "c", Some("web_search".into()), 20);
        let parent = data.upsert_subagent("pty1".into(), child(AgentStatus::Done, None), 30);
        assert_eq!(parent.subagents[0].status, AgentStatus::Done);
        assert_eq!(parent.subagents[0].tool, None);
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
            subagents: Vec::new(),
            session: Some(AgentSession {
                id: "s-1".into(),
                file: None,
                captured_at: 1,
            }),
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
