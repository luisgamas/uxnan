/**
 * uxnan-bridge — public API.
 *
 * `startBridge()` boots the daemon core (state, identity, JSON-RPC router).
 * The live transport and agent runtimes are added in later increments.
 */
export { startBridge, type Bridge, type StartBridgeOptions } from './bridge.js';
export { BRIDGE_VERSION } from './version.js';

export { HandlerRouter, type RpcHandler } from './handler-router.js';
export type { BridgeContext } from './bridge-context.js';
export { DaemonState, DAEMON_FILES } from './daemon-state.js';
export { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig, type DaemonConfig } from './daemon-config.js';
export { SecureDeviceState, type PublicIdentity } from './secure-device-state.js';
export { InMemorySecretStore, type SecretStore } from './secret-store.js';
export { SessionState } from './session-state.js';
export { buildBridgeStatus, type BridgeStatusInput } from './bridge-status.js';
export { generatePairingPayload, renderPairingQr, type GeneratePairingOptions } from './qr.js';
export { createLogger, type Logger, type LogLevel } from './logger.js';

export { BaseAgentAdapter } from './adapters/base-adapter.js';
export { CodexAdapter } from './adapters/codex-adapter.js';
export { OpenCodeAdapter } from './adapters/opencode-adapter.js';
