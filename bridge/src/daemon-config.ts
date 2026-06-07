/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import { DEFAULT_LAN_PORT, DEFAULT_RELAY_URL, type AgentId } from '@uxnan/shared';

/** Per-agent overrides (binary location + default model). */
export interface AgentSettings {
  /** Absolute path to the agent CLI/binary; resolved from PATH/standard locations when omitted. */
  binaryPath?: string;
  /** Default model the agent uses (e.g. `provider/model` for OpenCode). */
  model?: string;
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
  agents: {},
};

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  return { ...DEFAULT_DAEMON_CONFIG, ...(partial ?? {}) };
}
