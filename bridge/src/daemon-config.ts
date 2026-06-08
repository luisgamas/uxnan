/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import { DEFAULT_LAN_PORT, DEFAULT_RELAY_URL, type AgentId } from '@uxnan/shared';

/**
 * Headless permission posture for agents that gate tool use (e.g. Claude Code):
 *  - `default`           → no flag (tools needing approval are auto-denied headless);
 *  - `acceptEdits`       → file edits auto-apply, other tools stay gated;
 *  - `bypassPermissions` → all tools run without approval (full autonomy).
 */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** Per-agent overrides (binary location + default model + permissions). */
export interface AgentSettings {
  /** Absolute path to the agent CLI/binary; resolved from PATH/standard locations when omitted. */
  binaryPath?: string;
  /** Default model the agent uses (e.g. `provider/model` for OpenCode). */
  model?: string;
  /**
   * Headless permission posture for agents that support it (Claude Code).
   * Defaults to `acceptEdits` when omitted. Ignored by agents that don't gate tools.
   */
  permissionMode?: AgentPermissionMode;
}

export interface DaemonConfig {
  relayUrl: string;
  lanEnabled: boolean;
  lanPort: number;
  pushEnabled: boolean;
  pushOnAgentDone: boolean;
  pushOnAgentError: boolean;
  autoReconnect: boolean;
  maxConcurrentSessions: number;
  sessionTimeoutMinutes: number;
  /** Agent the bridge uses when a thread does not pick one. */
  defaultAgent: AgentId;
  /**
   * Absolute project directories the phone may open. Empty → the bridge's own
   * working directory is exposed as the single project.
   */
  workspaceRoots: string[];
  /**
   * Absolute base directories the phone may BROWSE under via `workspace/browseDirs`
   * (descend into sub-folders, pick any directory as a thread's cwd) without
   * escaping the root. Empty → falls back to {@link workspaceRoots}, then the
   * user's home directory. Set this to e.g. your `Documents` folder.
   */
  browseRoots: string[];
  /** Per-agent settings keyed by {@link AgentId}. */
  agents: Partial<Record<AgentId, AgentSettings>>;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  relayUrl: DEFAULT_RELAY_URL,
  lanEnabled: true,
  lanPort: DEFAULT_LAN_PORT,
  pushEnabled: true,
  pushOnAgentDone: true,
  pushOnAgentError: true,
  autoReconnect: true,
  maxConcurrentSessions: 1,
  sessionTimeoutMinutes: 30,
  defaultAgent: 'opencode',
  workspaceRoots: [],
  browseRoots: [],
  agents: {},
};

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  return { ...DEFAULT_DAEMON_CONFIG, ...(partial ?? {}) };
}
