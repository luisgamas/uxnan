/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import { DEFAULT_LAN_PORT, DEFAULT_RELAY_URL } from '@uxnan/shared';

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
};

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  return { ...DEFAULT_DAEMON_CONFIG, ...(partial ?? {}) };
}
