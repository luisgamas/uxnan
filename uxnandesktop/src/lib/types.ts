// TypeScript mirror of the Rust persisted model (`src-tauri/src/model.rs`).
// Serde emits camelCase, so these fields match the Rust structs one-to-one.
// Keep this file in sync whenever the Rust model changes.

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

/** A registered CLI coding agent (mirror of the Rust `AgentProfile`). Launching
 *  it spawns a terminal running `command` + `args` in a worktree. */
export interface AgentProfile {
  id: string;
  name: string;
  /** Executable to launch (e.g. `claude`, `codex`, `aider`). */
  command: string;
  /** Arguments passed to the command (e.g. `["--model", "opus"]`). */
  args: string[];
  /** Terminal profile (shell) to launch the agent in; null → default profile. */
  terminalProfileId?: string | null;
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
  /** Notify when an agent goes idle while you're in another space. Default on. */
  agentNotifications?: boolean;
  /** UI language: "system" (follow the device) or a locale code ("en", "es"). */
  language: string;
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

/** Persisted terminal layout (structure only — fresh shells spawn on restore).
 *  Mirrors the serialized form produced by the terminals store. */
export type SavedTermNode =
  | {
      type: "group";
      tabs: { title: string; cwd?: string; shell?: string; args?: string[] }[];
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
  agentNotifications: true,
  language: "system",
};
