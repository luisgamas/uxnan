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
}

/** A worktree as reported by `git worktree list` (ADE- or agent-created). */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  isMain: boolean;
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
 *  `<app-data>/hooks/` at startup, plus the resolved `~/.claude/settings.json`
 *  path. `null` if the install-on-startup step failed. */
export interface HookInstall {
  dir: string;
  claudeHookScript: string;
  wrapperBash: string;
  wrapperPowershell: string;
  wrapperCmd: string;
  claudeSettingsPath: string;
}

/** The current state of the Claude `settings.json` `hooks` block. The UI
 *  uses this to render an honest "Installed" / "Not installed" /
 *  "Unavailable" badge — never claim installed unless the file actually
 *  carries our managed marker. */
export interface ClaudeHooksStatus {
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
  wrapperBash: string;
  wrapperPowershell: string;
  wrapperCmd: string;
}

/** Persisted terminal layout (structure only — fresh shells spawn on restore).
 *  Mirrors the serialized form produced by the terminals store. */
/** One persisted tab descriptor. `kind` is optional for backward compatibility:
 *  a descriptor with no `kind` (older saved layouts) is a terminal. Diff tabs are
 *  transient and never persisted. */
export type SavedTab =
  | { kind?: "terminal"; title: string; cwd?: string; shell?: string; args?: string[] }
  | { kind: "file"; title: string; path: string; worktree?: string | null };

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
};
