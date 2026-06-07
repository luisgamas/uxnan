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
export {
  KeyringSecretStore,
  createDefaultSecretStore,
  loadNativeKeyringBackend,
  type KeyringBackend,
} from './keyring-secret-store.js';
export { SessionState } from './session-state.js';
export { LockFile, isProcessAlive, type LockInfo } from './lock-file.js';
export { buildBridgeStatus, type BridgeStatusInput } from './bridge-status.js';
export { generatePairingPayload, renderPairingQr, type GeneratePairingOptions } from './qr.js';
export {
  createLogger,
  createFileLogger,
  redactSecrets,
  logFileFor,
  type Logger,
  type LogLevel,
  type FileLoggerOptions,
} from './logger.js';

export { BaseAgentAdapter } from './adapters/base-adapter.js';
export { CodexAdapter } from './adapters/codex-adapter.js';
export { OpenCodeAdapter } from './adapters/opencode-adapter.js';
export { EchoAgentAdapter } from './adapters/echo-agent-adapter.js';
export {
  ProcessAgentAdapter,
  type ProcessAdapterOptions,
} from './adapters/process-agent-adapter.js';

// Conversation engine
export { ThreadStore, type StartTurnResult } from './conversation/thread-store.js';
export {
  AgentManager,
  type AgentManagerOptions,
  type SendTurnOptions as AgentManagerSendTurnOptions,
} from './agents/agent-manager.js';

// Transport (live E2EE)
export {
  type MessageIO,
  MessageQueue,
  queueFor,
  createInMemoryIoPair,
} from './transport/message-io.js';
export {
  generateEphemeralKeyPair,
  deriveSessionKey,
  randomHex,
  verifyEd25519,
  aesGcmEncrypt,
  aesGcmDecrypt,
  type EphemeralKeyPair,
  type AesGcmParts,
} from './transport/crypto.js';
export { BridgeSecureChannel, ReplayError } from './transport/secure-channel.js';
export {
  performServerHandshake,
  HandshakeError,
  type ServerHandshakeResult,
  type ServerHandshakeOptions,
} from './transport/server-handshake.js';
export {
  handleSecureConnection,
  type SecureConnectionOptions,
} from './transport/session-handler.js';
export { FileTrustStore, type TrustStore } from './transport/trust-store.js';
export {
  connectRelayAsMac,
  type ConnectRelayOptions,
  type RelayConnection,
} from './transport/relay-client.js';
export {
  startLanServer,
  type LanServerOptions,
  type LanServerHandle,
} from './transport/lan-server.js';
export { wsToMessageIO, rawDataToBuffer } from './transport/ws-adapter.js';
export { OutboundMessageBuffer } from './transport/outbound-buffer.js';
export { SessionRegistry, type SessionSink } from './transport/session-registry.js';

// Git + workspace services
export { GitService } from './git/git-service.js';
export { runGit, GitCommandError, sanitizePaths, type RunGitResult } from './git/git-runner.js';
export { WorkspaceService } from './workspace/workspace-service.js';
export { CheckpointService, type CaptureOptions } from './workspace/checkpoint-service.js';
export { resolveWithinRoot, isSensitiveName } from './workspace/path-guard.js';
