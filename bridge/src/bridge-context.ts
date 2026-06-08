/**
 * Shared context passed to every JSON-RPC handler.
 */
import type { DaemonConfig } from './daemon-config.js';
import type { DaemonState } from './daemon-state.js';
import type { SecureDeviceState } from './secure-device-state.js';
import type { SessionState } from './session-state.js';
import type { SessionRegistry } from './transport/session-registry.js';
import type { ThreadStore } from './conversation/thread-store.js';
import type { AgentManager } from './agents/agent-manager.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import type { BrowseService } from './workspace/browse-service.js';
import type { PushService } from './push/push-service.js';
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
  /** Persistent conversation store. */
  readonly threadStore: ThreadStore;
  /** Agent turn orchestration. */
  readonly agentManager: AgentManager;
  /** The project directories the phone may open. */
  readonly projects: ProjectRegistry;
  /** Root-confined directory browsing for plug-and-play project selection. */
  readonly browse: BrowseService;
  /** Push-notification coordination (token registration + turn-end delivery). */
  readonly pushService: PushService;
  readonly logger: Logger;
  /** Injected clock (epoch ms) for testability. */
  now(): number;
}
