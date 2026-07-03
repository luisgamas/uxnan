/**
 * Shared context passed to every JSON-RPC handler.
 */
import type { DaemonConfig } from './daemon-config.js';
import type { DaemonState } from './daemon-state.js';
import type { SecureDeviceState } from './secure-device-state.js';
import type { SessionState } from './session-state.js';
import type { SessionRegistry } from './transport/session-registry.js';
import type { TrustStore } from './transport/trust-store.js';
import type { ThreadStore } from './conversation/thread-store.js';
import type { SessionHistoryReader } from './conversation/session-history.js';
import type { AgentManager } from './agents/agent-manager.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import type { BrowseService } from './workspace/browse-service.js';
import type { PushService } from './push/push-service.js';
import type { UpdateStatus } from './update-check.js';
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
  /** Persisted trusted phones (Ed25519 identity + metadata, no secrets). */
  readonly trustStore: TrustStore;
  /** Persistent conversation store. */
  readonly threadStore: ThreadStore;
  /** Reads agent on-disk session logs as a `turn/list` fallback (§5.8.8). */
  readonly sessionHistory: SessionHistoryReader;
  /** Agent turn orchestration. */
  readonly agentManager: AgentManager;
  /** The project directories the phone may open. */
  readonly projects: ProjectRegistry;
  /** Root-confined directory browsing for plug-and-play project selection. */
  readonly browse: BrowseService;
  /** Push-notification coordination (token registration + turn-end delivery). */
  readonly pushService: PushService;
  readonly logger: Logger;
  /** Whether at least one relay connection is currently serving a phone. */
  relayConnected(): boolean;
  /**
   * Latest known self-update status from the background npm check, or
   * `undefined` before the first check completes. Read by `bridge/status` so the
   * phone can show a "bridge update available" hint.
   */
  updateStatus(): UpdateStatus | undefined;
  /** Injected clock (epoch ms) for testability. */
  now(): number;
}
