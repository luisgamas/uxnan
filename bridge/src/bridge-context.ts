/**
 * Shared context passed to every JSON-RPC handler.
 */
import type { DaemonConfig } from './daemon-config.js';
import type { DaemonState } from './daemon-state.js';
import type { SecureDeviceState } from './secure-device-state.js';
import type { SessionState } from './session-state.js';
import type { SessionRegistry } from './transport/session-registry.js';
import type { Logger } from './logger.js';

export interface BridgeContext {
  readonly version: string;
  readonly startedAt: number;
  readonly config: DaemonConfig;
  readonly state: DaemonState;
  readonly deviceState: SecureDeviceState;
  readonly sessions: SessionState;
  /** Live encrypted sinks for connected phones (bridge → phone notifications). */
  readonly sessionRegistry: SessionRegistry;
  readonly logger: Logger;
  /** Injected clock (epoch ms) for testability. */
  now(): number;
}
