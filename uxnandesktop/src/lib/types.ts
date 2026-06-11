// TypeScript mirror of the Rust persisted model (`src-tauri/src/model.rs`).
// Serde emits camelCase, so these fields match the Rust structs one-to-one.
// Keep this file in sync whenever the Rust model changes.

export type Theme = "light" | "dark" | "system";

export type AgentStatus = "working" | "blocked" | "waiting" | "done";

export interface AppSettings {
  theme: Theme;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
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

export interface AgentStateEntry {
  worktreeId: string;
  status: AgentStatus;
  firstSeen: number;
  lastUpdate: number;
}

/** Persisted terminal layout (structure only — fresh shells spawn on restore).
 *  Mirrors the serialized form produced by the terminals store. */
export type SavedTermNode =
  | {
      type: "group";
      tabs: { title: string; cwd?: string }[];
      activeTab: number;
    }
  | {
      type: "split";
      dir: "row" | "col";
      ratio: number;
      a: SavedTermNode;
      b: SavedTermNode;
    };

export interface AppData {
  version: number;
  repos: RepoData[];
  settings: AppSettings;
  agentCache: AgentStateEntry[];
  terminalLayout?: SavedTermNode | null;
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
};
