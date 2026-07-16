// TypeScript mirror of the Rust persisted model (`src-tauri/src/model.rs`).
// Serde emits camelCase, so these fields match the Rust structs one-to-one.
// Keep this file in sync whenever the Rust model changes.

import type {
  Theme as CustomTheme,
  TerminalTheme,
  TerminalThemePreset,
  ThemeFonts,
} from "$lib/theme";

export type Theme = "light" | "dark" | "system";

export type AgentStatus = "working" | "blocked" | "waiting" | "done";

/** A configurable terminal/shell profile (mirror of the Rust `TerminalProfile`). */
export interface TerminalProfile {
  id: string;
  name: string;
  /** Executable to launch (e.g. `powershell.exe`, `wsl.exe`, `/bin/bash`). */
  command: string;
  /** Arguments passed to the command (e.g. `["-NoLogo"]`, `["-d", "Ubuntu"]`). */
  args: string[];
}

/** An environment variable attached to an agent (mirror of the Rust `EnvVar`).
 *  Set on the agent's shell at launch and inherited by the agent process. */
export interface EnvVar {
  key: string;
  value: string;
}

/** A registered CLI coding agent (mirror of the Rust `AgentProfile`). Launching
 *  it spawns a terminal running `command` + `args` in a worktree. */
export interface AgentProfile {
  id: string;
  name: string;
  /** Executable to launch (e.g. `claude`, `codex`, `aider`). */
  command: string;
  /** Arguments passed to the command (e.g. `["--model", "opus"]`). */
  args: string[];
  /** Terminal profile (shell) to launch the agent in; null → the configured
   *  default agent shell (`agentShellProfileId`). */
  terminalProfileId?: string | null;
  /** Environment variables set on the agent's shell at launch (inherited by the
   *  agent). `UXNAN_*` hook vars win over a user key of the same name. */
  env?: EnvVar[];
  /** Logo key for the UI (a catalog id, e.g. `claudecode`); null → generic. */
  icon?: string | null;
}

// --- AI-provider usage statistics (Settings → Providers) --------------------
// Mirror of `shared/src/models/usage.ts` (the bridge serves the same shape to
// the phone later). Read natively in Rust here via the `usage_read` command.

/** A coding CLI whose usage we read from its own stored token. */
export type UsageProvider = "codex" | "claude" | "copilot" | "gemini";

/** Outcome of reading one provider's usage. */
export type UsageStatus = "ok" | "authRequired" | "notInstalled" | "error";

/** How the data was obtained, for the provenance label. */
export type UsageSource = "token";

/** A single quota/rate window, expressed as a used-percentage with a reset. */
export interface UsageWindow {
  id: string;
  label: string;
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
}

/** A monetary / credit balance, separate from the percentage windows. */
export interface CreditBalance {
  used: number;
  limit?: number;
  currency: string;
  period: string;
  resetsAt?: number;
}

/** One provider's usage snapshot (result of `usage_read`). */
export interface ProviderUsage {
  provider: UsageProvider;
  status: UsageStatus;
  source?: UsageSource;
  account?: { email?: string; organization?: string; plan?: string };
  windows: UsageWindow[];
  credit?: CreditBalance;
  updatedAt: number;
  message?: string;
}

/** What of a provider surfaces in the bottom status-bar popover. `windows` are
 *  the window ids to show; the primary %-bar is opted-in by default when a
 *  provider first activates (see `defaultStatusBarPick`). */
export interface UsageStatusBarPick {
  show: boolean;
  windows: string[];
  showCredit?: boolean;
  showPlan?: boolean;
}

/** A provider the user activated in Settings → Providers. Only activated
 *  providers are ever polled — inactive ones cost nothing. */
export interface UsageProviderConfig {
  provider: UsageProvider;
  /** Per-provider refresh override in minutes; null/absent = the global value. */
  refreshMinutes?: number | null;
  statusBar: UsageStatusBarPick;
}

export interface AppSettings {
  theme: Theme;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  /** Configurable terminal/shell profiles (seeded with platform defaults). */
  terminalProfiles: TerminalProfile[];
  /** Id of the profile used for new terminals unless one is picked explicitly. */
  defaultProfileId: string | null;
  /** Registered CLI coding agents, launchable into any worktree. */
  agentProfiles: AgentProfile[];
  /** Agent auto-launched when a worktree is created; null = off (default). */
  defaultAgentId?: string | null;
  /** Terminal profile agents launch in when they don't pin their own. null
   *  resolves to a smart default: Command Prompt on Windows, else the default
   *  terminal profile. */
  agentShellProfileId?: string | null;
  /** Notify when an agent goes idle while you're in another space. Default on. */
  agentNotifications?: boolean;
  /** Keep the system awake while an agent is working (opt-in). Default off. */
  preventSleep?: boolean;
  /** Auto-install the ADE-managed Claude Code hooks block on startup. Set false
   *  when the user uninstalls so it isn't re-added next launch. Default on. */
  autoInstallHooks?: boolean;
  /** UI language: "system" (follow the device) or a locale code ("en", "es"). */
  language: string;
  /** Custom keyboard-shortcut overrides, keyed by action id → chord string
   *  (e.g. `closeCenter` → `Ctrl+W`). Missing = default binding; "" = disabled. */
  keybindings?: Record<string, string>;
  /** Active theme id: a built-in ("system"/"light"/"dark"/…) or a custom id. */
  activeThemeId?: string;
  /** User-created themes (exportable / importable). */
  customThemes?: CustomTheme[];
  /** Global font override (applied on top of the active theme's fonts). */
  fonts?: ThemeFonts;
  /** Global terminal typography override (wins over each terminal theme's fonts). */
  terminalFonts?: TerminalTheme;
  /** Saved terminal themes (the per-terminal override layer; import/exportable). */
  terminalThemes?: TerminalThemePreset[];
  /** How the active terminal theme is chosen: one for both schemes, or a
   *  separate one per light/dark app theme. */
  terminalThemeMode?: "single" | "scheme";
  /** Active terminal theme id in "single" mode ("inherit" = no override). */
  activeTerminalThemeId?: string;
  /** Terminal theme when the app theme is light ("scheme" mode; "inherit" ok). */
  terminalThemeLightId?: string;
  /** Terminal theme when the app theme is dark ("scheme" mode; "inherit" ok). */
  terminalThemeDarkId?: string;
  /** AI commit-message generation (opt-in; configured in Settings → AI commit). */
  aiCommit?: AiCommitSettings;
  /** In-app auto-updater (Settings → Updates). */
  updater?: UpdaterSettings;
  /** Integrated developer browser (Settings → Browser). */
  browser?: BrowserSettings;
  /** Width (px) of the integrated browser panel (the right-side "4th panel"). */
  browserPanelWidth?: number;
  /** AI providers whose usage stats the user activated (Settings → Providers).
   *  Only these are polled. Empty/absent = the feature is idle. */
  usageProviders?: UsageProviderConfig[];
  /** How often (minutes) activated providers refresh; a provider may override
   *  it. 0 = manual only. Default 5. */
  usageRefreshMinutes?: number;
  /** Show the usage indicator + popover in the bottom status bar. Default true
   *  once at least one provider is activated. */
  usageStatusBarEnabled?: boolean;
  /** Sort mode for the project cards in the left sidebar. "manual" follows the
   *  persisted repo order (`repoReorder`); the rest are computed client-side. */
  projectSort?: SortMode;
  /** Sort mode for the worktree rows within each project (same enum). "manual"
   *  follows each repo's `worktreeOrder`. */
  worktreeSort?: SortMode;
  /** Last-active timestamps (epoch ms) keyed by workspace path, stamped when a
   *  workspace is opened. Feeds the "recent" sort mode; self-heals (stale paths
   *  are ignored). */
  workspaceLastActive?: Record<string, number>;
  /** Pinned projects (repo ids) — shown first regardless of sort. Self-healing. */
  pinnedProjects?: string[];
  /** Pinned worktrees (paths) — shown first within their project. Self-healing. */
  pinnedWorktrees?: string[];
  /** How the left sidebar groups its rows: the project→worktree tree, or every
   *  worktree flattened into lanes by agent attention. */
  sidebarGroupBy?: SidebarGroupBy;
  /** Attention lanes (class 1–4) the user collapsed in the "group by status"
   *  view; persisted so the collapse survives a restart. */
  sidebarCollapsedLanes?: number[];
  /** GitHub integration (the GitHub section + the right-panel GitHub tab). */
  github?: GithubSettings;
}

/** GitHub integration preferences (mirror of Rust `GithubSettings`). The token is
 *  never stored here — `gh` owns it. */
export interface GithubSettings {
  /** Show the contextual GitHub tab in the right panel (per-worktree PR/CI); it
   *  only appears for GitHub repos. Default true. */
  rightPanelTab?: boolean;
  /** Show the GitHub status/quota button in the bottom status bar. Default true. */
  statusBarEnabled?: boolean;
  /** How often (seconds) the active worktree's PR/CI context refreshes while the
   *  window is focused. 0 = manual only. Default 45. */
  pollSeconds?: number;
  /** Poll the notifications count for the status-bar badge. Default false. */
  notificationsEnabled?: boolean;
  /** Ask for confirmation before creating or merging a PR (both surfaces). Default
   *  true. */
  confirmPr?: boolean;
  /** Agent id used to draft PR bodies / review summaries from a diff (same catalog
   *  as AI commit). Undefined = the AI button is hidden. */
  aiAgentId?: string;
  /** Model for the AI-authoring agent (undefined = the CLI's default). */
  aiModel?: string;
}

/** Left-sidebar grouping mode.
 *  - `none`   — the project → worktree tree (default).
 *  - `status` — every worktree flattened into lanes by agent attention
 *    (needs-you · done · working · idle), empty lanes omitted. */
export type SidebarGroupBy = "none" | "status";

/** How the left-sidebar project cards / worktree rows are ordered.
 *  - `manual`   — the user's own drag-and-drop arrangement (persisted).
 *  - `name-asc` / `name-desc` — alphabetical by display name / branch.
 *  - `recent`   — most-recently-opened first (via `workspaceLastActive`).
 *  - `attention`— agents that need you first (blocked/waiting → done → working →
 *    idle), then most-recent within each class. */
export type SortMode =
  | "manual"
  | "name-asc"
  | "name-desc"
  | "recent"
  | "attention";

/** Where a link opens when the integrated browser is enabled (mirror of Rust
 *  `BrowserLinkPolicy`). `internal` uses the in-app tab; `external` hands off to
 *  the OS browser; `ask` prompts per link. */
export type BrowserLinkPolicy = "internal" | "external" | "ask";

/** How the browser-control MCP server is injected into agents (mirror of Rust
 *  `McpInjection`). `workspace` writes a project-scoped config in the terminal's
 *  cwd (default); `global` registers it in each CLI's global user config; `off`
 *  injects nothing (wire it by hand from the copy-paste snippet). */
export type McpInjection = "off" | "workspace" | "global";

/** Integrated developer-browser preferences (mirror of Rust `BrowserSettings`). */
export interface BrowserSettings {
  /** Master switch. Off → every link goes to the OS browser, no agent shim. */
  enabled: boolean;
  /** Where links open by default. Default `internal`. */
  linkPolicy: BrowserLinkPolicy;
  /** Let agents open URLs in the integrated browser (inject a `BROWSER` shim). */
  allowAgents: boolean;
  /** Make URLs printed in the terminal clickable (routed through `linkPolicy`). */
  terminalLinks: boolean;
  /** Page opened when a fresh browser tab has no target URL. Empty = blank. */
  homepage: string;
  /** Expose the browser-control MCP server to agents so they discover the
   *  `browser_*` tools automatically. Default on. */
  mcpEnabled: boolean;
  /** How the MCP server is injected into agents. Default `workspace`. */
  mcpInjection: McpInjection;
  /** Agent ids (`claude`/`codex`/`gemini`/`opencode`/`pi`) to skip when injecting
   *  the MCP config. Empty = all supported agents. */
  mcpDisabledAgents: string[];
}

/** One agent the ADE can auto-configure for the browser MCP server (mirror of Rust
 *  `mcpinject::AgentInfo`). */
export interface McpAgentInfo {
  id: string;
  label: string;
}

/** Runtime MCP coordinates for the Settings panel (mirror of Rust `McpInfo`). */
export interface McpInfo {
  /** Live `/mcp` endpoint, or null until the hook server is listening. */
  endpoint: string | null;
  /** Local loopback token for the copy-paste snippet, or null. */
  token: string | null;
  /** Env var the injected configs read the token from (`UXNAN_MCP_TOKEN`). */
  tokenEnv: string;
  /** MCP server name agents register us under (`uxnan-browser`). */
  serverName: string;
  /** Supported-agent catalog. */
  agents: McpAgentInfo[];
}

/** Release channel the updater follows (mirror of Rust `UpdateChannel`). Mapped
 *  to GitHub's `prerelease` flag, not the tag: a normal Release → `stable`; a
 *  Release marked pre-release → `nightly` (earlier, less-stable builds).
 *  `stable` is the default; `nightly` is opt-in for testers. */
export type UpdateChannel = "stable" | "nightly";

/** How a downloaded update is applied (mirror of Rust `InstallPolicy`).
 *  `ask` never installs unasked; `whenIdle` auto-installs once no agent is
 *  working; `manual` only when the user triggers it. */
export type InstallPolicy = "ask" | "whenIdle" | "manual";

/** Auto-updater preferences (mirror of Rust `UpdaterSettings`). Checking for a
 *  newer version is always available; these govern the channel and how/when an
 *  update is downloaded and applied. */
export interface UpdaterSettings {
  /** Check for updates automatically (on launch + periodically). Default on. */
  autoCheck: boolean;
  /** Release channel to follow. Default `stable`. */
  channel: UpdateChannel;
  /** Download a found update in the background without asking. Default on. */
  autoDownload: boolean;
  /** How a downloaded update is applied. Default `ask`. */
  installPolicy: InstallPolicy;
}

/** Metadata about an available update (mirror of Rust `UpdateInfo`). */
export interface UpdateInfo {
  /** The new version offered by the manifest. */
  version: string;
  /** The version currently running. */
  currentVersion: string;
  /** Release notes, if the manifest provided any. */
  notes: string | null;
  /** Publish date (RFC 3339 string), if provided. */
  date: string | null;
}

/** Payload of the `updater:download-progress` event. */
export interface UpdateDownloadProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total bytes, when the server reported a content length. */
  contentLength: number | null;
}

/** Config for the optional AI commit-message generator (mirror of Rust
 *  `AiCommitSettings`). The user picks a known agent + a model; the backend
 *  resolves the CLI and runs it one-shot with the staged diff. */
export interface AiCommitSettings {
  /** Master switch (off by default — the Generate button stays hidden). */
  enabled: boolean;
  /** Selected agent id: `claude`/`codex`/`gemini`/`opencode`/`pi`, or empty. */
  agentId: string;
  /** Selected model id (as the CLI expects it), or empty to use the CLI default. */
  model: string;
  /** Preferred message language: `auto` or a language name (e.g. `English`). */
  language: string;
  /** Ask for a Conventional Commits subject line. */
  conventional: boolean;
  /** Also generate an extended body (vs. subject only). */
  includeBody: boolean;
  /** Extra free-form instructions appended to the prompt. */
  instructions: string;
}

/** A model offered by an agent (mirror of Rust `AgentModel`). `id` is what the
 *  CLI's model flag expects verbatim; `displayName` is for the picker. */
export interface AgentModel {
  id: string;
  displayName: string;
}

export interface WorktreeData {
  id: string;
  repoId: string;
  name: string;
  branch: string;
  path: string;
  createdByAde: boolean;
  createdAt: number;
  lastActivity: number;
  agentId: string | null;
}

export interface RepoData {
  id: string;
  name: string;
  path: string;
  worktrees: WorktreeData[];
  /** Whether the folder is a git repository. Non-git folders are valid projects
   *  too — they just have no worktrees/branches and their git panels stay empty.
   *  Optional for back-compat with state persisted before this field existed
   *  (treated as git when absent). */
  isGit?: boolean;
  /** User-chosen project icon: an inline `data:` URL (a file/URL/GitHub avatar
   *  rasterized to a small square PNG), or null/undefined for the default folder
   *  glyph. The project's real folder name is never touched; `name` is display. */
  icon?: string | null;
  /** Per-branch custom icons, keyed by branch name (or the worktree path when
   *  detached). Same inline `data:` URL form as `icon`. Optional for back-compat. */
  branchIcons?: Record<string, string>;
  /** User's manual order for this project's child worktrees, as their absolute
   *  paths. The primary worktree is always shown first regardless. Paths no longer
   *  present are ignored and freshly-seen ones fall to the end (self-healing).
   *  Absent/empty → the git listing order. Set via `setWorktreeOrder`. */
  worktreeOrder?: string[];
}

/** A git remote's hosting owner/org (mirror of Rust `RemoteOwner`), used to offer
 *  the account avatar as a project icon. `avatarUrl` is set only for hosts whose
 *  avatar URL we can build (GitHub, GitLab). */
export interface RemoteOwner {
  host: string;
  owner: string;
  avatarUrl: string | null;
}

/** A worktree as reported by `git worktree list` (ADE- or agent-created). */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  isMain: boolean;
}

/** What `worktree_remove` did with the branch (mirror of Rust `RemoveOutcome`).
 *  The worktree itself is always removed on success; these flags describe only
 *  the branch cleanup so the UI can tell the user. */
export interface RemoveOutcome {
  /** The branch was deleted (safe `-d`, or `-D` after a confirmed squash merge). */
  branchDeleted: boolean;
  /** The branch was kept because its changes couldn't be confirmed as merged. */
  branchPreserved: boolean;
  /** The delete relied on squash-merge (patch-equivalence) detection. */
  squashMerged: boolean;
}

/** A repo's local branches + the resolved default base for the new-worktree
 *  dialog (mirror of the Rust `BranchList` command DTO). */
export interface BranchList {
  branches: string[];
  defaultBase: string;
}

/** One sub-directory in the in-app directory browser (mirror of Rust `DirEntry`). */
export interface DirEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

/** A directory listing for the in-app project picker (mirror of `DirListing`). */
export interface DirListing {
  path: string;
  parent: string | null;
  isRepo: boolean;
  entries: DirEntry[];
}

/** One entry in the file-tree tab's lazy directory listing (mirror of Rust
 *  `FsEntry`). `path` is absolute, forward-slash normalized. */
export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** Whether git ignores this entry (a `.gitignore` / exclude match), computed
   *  per-listing. `false` outside a git repo. The file tree dims ignored entries
   *  (muted + italic) — independent of git *status* (ignored entries never show
   *  in the review panel). */
  ignored: boolean;
}

/** A page of project-wide file-tree search results (mirror of Rust `FileSearch`).
 *  `entries` are matching files; `truncated` is true when the walk hit the result
 *  cap before exhausting the tree. */
export interface FileSearch {
  entries: FsEntry[];
  truncated: boolean;
}

/** The current on-disk conversation of a Zero agent (mirror of Rust `ZeroSession`).
 *  `title` is the session name; `status` is a coarse agent-view state derived from
 *  the session's last event. Read by cwd since Zero emits no hook/OSC. */
export interface ZeroSession {
  title: string;
  status: "working" | "waiting" | "done" | "idle";
  updatedAt: string;
}

/** A file opened in the center editor (mirror of Rust `FileContent`). `content`
 *  is empty when `binary` or `tooLarge`, which the editor surfaces as a notice. */
export interface FileContent {
  content: string;
  binary: boolean;
  tooLarge: boolean;
}

/** One changed file in a worktree (mirror of Rust `FileChange`). `index` and
 *  `worktree` are the two `git status` XY codes (" " clean, M/A/D/R/C/U, "?"
 *  untracked). */
export interface FileChange {
  path: string;
  /** Index (staged) status code — the `X`. */
  index: string;
  /** Working-tree (unstaged) status code — the `Y`. */
  worktree: string;
}

/** One side of an image diff (mirror of Rust `ImageData`): the bytes as base64
 *  plus the MIME type, ready to render as `data:<mime>;base64,<base64>`. */
export interface ImageData {
  mime: string;
  base64: string;
}

/** Before/after image versions for a changed image file (mirror of Rust
 *  `ImageDiff`). A side is `null` when it doesn't exist (added → no `old`,
 *  deleted → no `new`). */
export interface ImageDiff {
  old: ImageData | null;
  new: ImageData | null;
}

/** Per-file added/deleted line counts vs HEAD (mirror of Rust `FileNumstat`). */
export interface FileNumstat {
  path: string;
  added: number;
  deleted: number;
}

/** Payload of the `fs:changed` event (mirror of Rust `FsChangedEvent`): the
 *  watched worktree root plus the affected paths (changed entries + their parent
 *  dirs), all forward-slash normalized. */
export interface FsChangedEvent {
  root: string;
  paths: string[];
}

/** One commit in the history log (mirror of Rust `CommitInfo`). `parents` powers
 *  the branch graph (2+ = a merge); `refs` are the decorations (`HEAD`, branch
 *  names, `tag: …`) pointing at this commit. */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  /** Author time, Unix seconds. */
  timestamp: number;
  refs: string[];
}

/** Payload of the `git:status-changed` event (mirror of Rust `GitStatusEvent`). */
export interface GitStatusEvent {
  path: string;
  files: FileChange[];
  ahead: number;
  behind: number;
}

/** A worktree's working-tree status summary (mirror of Rust `WorktreeStatus`). */
export interface WorktreeStatus {
  /** Changed entries (modified/added/deleted/untracked). */
  dirty: number;
  /** Commits ahead of the upstream (0 when none). */
  ahead: number;
  /** Commits behind the upstream (0 when none). */
  behind: number;
}

/** A cached agent state reported via the hook server (mirror of Rust
 *  `AgentStateEntry`). Keyed by `agentId` — the `UXNAN_AGENT_ID` (PTY id) the
 *  ADE injected and the agent's hook echoed back. */
export interface AgentStateEntry {
  agentId: string;
  status: AgentStatus;
  agentType?: string | null;
  prompt?: string | null;
  tool?: string | null;
  interrupted: boolean;
  /** Short preview of the agent's latest response (sent on `done`), if any. */
  summary?: string | null;
  firstSeen: number;
  lastUpdate: number;
}

/** Payload of the `agent:status-changed` event (mirror of Rust
 *  `hooks::AgentStatusEvent`). Same shape as a cached `AgentStateEntry`. */
export type AgentStatusEvent = AgentStateEntry;

/** Coordinates of the local agent hook server (mirror of Rust `HookServerInfo`).
 *  Shown in Settings so a user can wire their agent to report state. */
export interface HookServerInfo {
  url: string;
  token: string;
}

/** Absolute paths of the bundled hook scripts the ADE wrote to
 *  `<app-data>/hooks/` at startup, plus the resolved per-agent config paths.
 *  `null` if the install-on-startup step failed. */
export interface HookInstall {
  dir: string;
  /** The Node relay shared by Claude Code + Gemini CLI. */
  statusRelayScript: string;
  /** Codex `curl` hook (POSIX / Windows). */
  codexHookSh: string;
  codexHookCmd: string;
  /** OpenCode plugin / Pi extension sources (in the hooks dir). */
  opencodePluginScript: string;
  piExtensionScript: string;
  wrapperBash: string;
  wrapperPowershell: string;
  wrapperCmd: string;
  wrapperFish: string;
  browserShimBash: string;
  browserShimCmd: string;
  /** Where each agent's managed config lives (shown in the UI). */
  claudeSettingsPath: string;
  codexHooksPath: string;
  geminiSettingsPath: string;
  opencodePluginPath: string;
  piExtensionPath: string;
}

/** The current install state of a managed agent hook (Claude Code, Codex,
 *  Gemini CLI, OpenCode or Pi). The UI uses this to render an honest
 *  "Installed" / "Not installed" / "Unavailable" badge. */
export interface AgentHooksStatus {
  installed: boolean;
  fileExists: boolean;
  unavailable: boolean;
  /** Human-readable detail; the path on success, the error otherwise. */
  detail: string;
}

/** Textual content of every bundled hook script. The Claude JSON is
 *  rendered against the installed script path so the user can copy it
 *  as-is into `~/.claude/settings.json`. `null` if the install step on
 *  startup failed. */
export interface HookScripts {
  claudeJson: string;
  statusRelayCjs: string;
  wrapperBash: string;
  wrapperPowershell: string;
  wrapperCmd: string;
  wrapperFish: string;
}

/** Persisted terminal layout (structure only — fresh shells spawn on restore).
 *  Mirrors the serialized form produced by the terminals store. */
/** One persisted tab descriptor. `kind` is optional for backward compatibility:
 *  a descriptor with no `kind` (older saved layouts) is a terminal. Commit tabs
 *  are transient and never persisted; a file tab's diff is now one of its views. */
export type SavedTab =
  | {
      kind?: "terminal";
      title: string;
      /** User-set tab label ("Rename tab"); overrides the derived title. */
      customTitle?: string;
      cwd?: string;
      shell?: string;
      args?: string[];
    }
  | {
      kind: "file";
      title: string;
      path: string;
      worktree?: string | null;
      /** Which view the tab last showed: editor, rendered preview, or working diff. */
      view?: "edit" | "preview" | "changes";
      /** In the `changes` view: staged (index-vs-HEAD) vs unstaged (worktree-vs-index). */
      staged?: boolean;
    };

export type SavedTermNode =
  | {
      type: "group";
      tabs: SavedTab[];
      activeTab: number;
    }
  | {
      type: "split";
      dir: "row" | "col";
      ratio: number;
      a: SavedTermNode;
      b: SavedTermNode;
    };

/** Persisted terminal layout: one region tree per workspace (worktree path, or
 *  `""` for the unassigned "Global" space), plus which workspace was active. */
export interface SavedTerminalLayout {
  active: string;
  workspaces: Record<string, SavedTermNode>;
}

export interface AppData {
  version: number;
  repos: RepoData[];
  settings: AppSettings;
  agentCache: AgentStateEntry[];
  terminalLayout?: SavedTerminalLayout | null;
}

/** Mirror of the Rust `CommandError` returned across the command boundary. */
export interface CommandError {
  message: string;
  code: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  leftSidebarWidth: 280,
  rightSidebarWidth: 350,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  // The backend seeds real platform profiles; this fallback is only used before
  // hydration (or in the plain web preview, which can't spawn PTYs anyway).
  terminalProfiles: [],
  defaultProfileId: null,
  agentProfiles: [],
  usageProviders: [],
  usageRefreshMinutes: 5,
  usageStatusBarEnabled: true,
  defaultAgentId: null,
  agentShellProfileId: null,
  agentNotifications: true,
  preventSleep: false,
  autoInstallHooks: true,
  language: "system",
  keybindings: {},
  activeThemeId: "system",
  customThemes: [],
  fonts: {},
  terminalFonts: {},
  terminalThemes: [],
  terminalThemeMode: "single",
  activeTerminalThemeId: "inherit",
  terminalThemeLightId: "inherit",
  terminalThemeDarkId: "inherit",
  aiCommit: {
    enabled: false,
    agentId: "",
    model: "",
    language: "auto",
    conventional: true,
    includeBody: true,
    instructions: "",
  },
  updater: {
    autoCheck: true,
    channel: "stable",
    autoDownload: true,
    installPolicy: "ask",
  },
  browser: {
    enabled: true,
    linkPolicy: "internal",
    allowAgents: true,
    terminalLinks: true,
    homepage: "",
    mcpEnabled: true,
    mcpInjection: "workspace",
    mcpDisabledAgents: [],
  },
  browserPanelWidth: 520,
  projectSort: "manual",
  worktreeSort: "manual",
  workspaceLastActive: {},
  pinnedProjects: [],
  pinnedWorktrees: [],
  sidebarGroupBy: "none",
  sidebarCollapsedLanes: [],
  github: {
    rightPanelTab: true,
    statusBarEnabled: true,
    pollSeconds: 45,
    notificationsEnabled: false,
    confirmPr: true,
  },
};

// --- GitHub integration (wire shapes; mirror of Rust `github.rs`) -----------

/** Sanitized GitHub sign-in status. Never carries the token. */
export interface GithubStatus {
  ghInstalled: boolean;
  authenticated: boolean;
  login: string | null;
  host: string | null;
  scopes: string[];
  message: string | null;
}

/** Rolled-up CI checks summary for a PR. `state` is one word. */
export interface CheckSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  state: "success" | "failure" | "pending" | "none";
}

/** A single check/status row (drill-down). */
export interface CheckItem {
  name: string;
  bucket: "pass" | "fail" | "pending" | "skip";
  link: string | null;
  workflow: string | null;
}

/** A compact PR summary for the worktree card / right-panel tab. */
export interface PrSummary {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  reviewDecision: string | null;
  mergeable: string | null;
  checks: CheckSummary;
}

/** The active worktree's GitHub context. */
export interface RepoContext {
  host: string;
  owner: string;
  repo: string;
  nameWithOwner: string;
  branch: string | null;
  pr: PrSummary | null;
}

/** One row in the PR list. */
export interface PrListItem {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string | null;
  headRefName: string | null;
  baseRefName: string | null;
  reviewDecision: string | null;
  updatedAt: string | null;
  checksSummary: CheckSummary;
  checks: CheckItem[];
}

/** A changed file within a PR. */
export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

/** A submitted PR review (approve / request-changes / comment). */
export interface PrReview {
  author: string | null;
  /** `APPROVED` | `CHANGES_REQUESTED` | `COMMENTED` | `DISMISSED`. */
  state: string;
  body: string;
  submittedAt: string | null;
}

/** An issue-level comment on the PR (the conversation). */
export interface PrComment {
  author: string | null;
  body: string;
  createdAt: string | null;
}

/** A commit within the PR. */
export interface PrCommit {
  oid: string;
  message: string;
  author: string | null;
  committedAt: string | null;
}

/**
 * One normalized entry in a PR/issue timeline (GitHub's Timeline Events API).
 * Only the fields relevant to a given `event` kind are populated.
 */
export interface TimelineEvent {
  /** `commented` | `reviewed` | `committed` | `labeled` | `unlabeled` | `assigned`
   *  | `unassigned` | `closed` | `merged` | `reopened` | `renamed`
   *  | `review_requested` | `review_request_removed` | `head_ref_force_pushed`
   *  | `cross-referenced` | `ready_for_review` | `convert_to_draft` | … */
  event: string;
  actor: string | null;
  createdAt: string | null;
  /** Comment / review body. */
  body: string | null;
  /** Uppercase review verdict (APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED). */
  state: string | null;
  label: string | null;
  /** Label hex color without `#`. */
  labelColor: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  /** Assignee/reviewer login, rename destination, milestone title, or cross-ref title. */
  subject: string | null;
  /** A cross-referenced issue/PR number. */
  refNumber: number | null;
  /** Whether a `committed` event's commit signature is verified. */
  verified: boolean | null;
}

/** Full PR detail for the review center tab. */
export interface PrDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string | null;
  baseRefName: string | null;
  headRefName: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  labels: string[];
  files: PrFile[];
  checks: CheckItem[];
  checksSummary: CheckSummary;
  reviewers: string[];
  reviews: PrReview[];
  comments: PrComment[];
  commits: PrCommit[];
}

/** Options for creating a PR. */
export interface PrCreateOptions {
  title: string;
  body?: string;
  /** Branch the PR targets. Omitted = the repo's default branch. */
  base?: string | null;
  /** Branch the PR comes from. Omitted = the checked-out branch. */
  head?: string | null;
  draft?: boolean;
}

/** Branch candidates for the create-PR form (`github_branches`). */
export interface PrBranches {
  /** Local branches — the head candidates. */
  local: string[];
  /** Branches on `origin` — the base candidates (GitHub can only target a
   *  branch that exists on the remote). */
  remote: string[];
  /** The repo's default branch, preselected as the base. */
  defaultBase: string;
  /** The worktree's checked-out branch, preselected as the head. */
  current: string | null;
}

/** One row in the issue list. */
export interface IssueListItem {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  labels: string[];
  assignees: string[];
  updatedAt: string | null;
  comments: number;
}

/** Full detail for one issue. */
export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author: string | null;
  labels: string[];
  assignees: string[];
  createdAt: string | null;
  updatedAt: string | null;
  comments: PrComment[];
}

/** One workflow run row. */
export interface RunListItem {
  databaseId: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  workflowName: string | null;
  event: string | null;
  createdAt: string | null;
  url: string;
}

/** The core REST rate-limit window (status-bar gauge). */
export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  reset: number;
}
