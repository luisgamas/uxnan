/**
 * uxnan-bridge — public API.
 *
 * `startBridge()` boots the daemon core (state, identity, JSON-RPC router).
 * The live transport and agent runtimes are added in later increments.
 */
export { startBridge, type Bridge, type StartBridgeOptions } from './bridge.js';
export { BRIDGE_VERSION, BRIDGE_PACKAGE_NAME } from './version.js';
export {
  fetchLatestPublishedVersion,
  computeUpdateStatus,
  readUpdateCache,
  cachedUpdateStatus,
  ensureUpdateStatus,
  updateNoticeMessage,
  UPDATE_CHECK_TTL_MS,
  type UpdateCheckCache,
  type UpdateStatus,
  type UpdateCheckOptions,
} from './update-check.js';

export { HandlerRouter, type RpcHandler } from './handler-router.js';
export type { BridgeContext } from './bridge-context.js';
export { DaemonState, DAEMON_FILES } from './daemon-state.js';
export {
  DEFAULT_DAEMON_CONFIG,
  resolveDaemonConfig,
  mergeAgentModels,
  type DaemonConfig,
  type AgentSettings,
  type AgentModelSpec,
} from './daemon-config.js';
export { ProjectRegistry, projectIdFor } from './projects/project-registry.js';
export {
  PushService,
  type PushServiceOptions,
  type RegisterPushParams,
  type TurnEndInfo as PushTurnEndInfo,
} from './push/push-service.js';
export {
  createBridgePushSender,
  defaultServiceAccountPath,
  type PushSender,
  type PushPayload,
} from './push/push-sender.js';
export {
  SessionHistoryReader,
  type HistorySource,
  type SessionHistoryOptions,
} from './conversation/session-history.js';
export {
  PairingCodeService,
  type PairingCodeServiceOptions,
  PAIRING_WINDOW_MS,
} from './pairing/pairing-code-service.js';
export {
  MdnsAdvertiser,
  parseQuestions,
  buildMessage,
  encodeName,
  type MdnsAdvertiserOptions,
  type UdpSocketLike,
} from './transport/mdns-advertiser.js';
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
export {
  buildServicePlan,
  buildWindowsStartupPlan,
  installService,
  uninstallService,
  currentServiceEnv,
  isServicePlatformSupported,
  type ServiceEnv,
  type ServicePlan,
  type ServiceCommand,
  type ServicePlatform,
} from './service-installer.js';
export { buildBridgeStatus, type BridgeStatusInput } from './bridge-status.js';
export { getAuthStatus, type AccountStatusDeps } from './account-status.js';
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
export {
  CodexAdapter,
  codexUsageTokens,
  parseCodexConfigModels,
  parseCodexModelList,
  parseCodexModelWindows,
  parseCodexReasoning,
  type CodexAdapterOptions,
  type CodexEvent,
  type SpawnedAppServer,
  type CodexPermissionMode,
} from './adapters/codex-adapter.js';
export { resolveCodexBinary, type ResolvedCodex } from './adapters/resolve-codex.js';
export {
  PiAdapter,
  parsePiLine,
  parsePiModelList,
  parsePiUsageTokens,
  parsePiContextWindow,
  type PiAdapterOptions,
  type PiEvent,
  type PiPermissionMode,
} from './adapters/pi-adapter.js';
export { resolvePiBinary, type ResolvedPi } from './adapters/resolve-pi.js';
export {
  GeminiAdapter,
  parseGeminiLine,
  type GeminiAdapterOptions,
  type GeminiEvent,
  type GeminiPermissionMode,
} from './adapters/gemini-adapter.js';
export { resolveGeminiBinary, type ResolvedGemini } from './adapters/resolve-gemini.js';
export {
  AntigravityAdapter,
  antigravityPermissionMode,
  parseAntigravityModelList,
  permissionArgs as antigravityPermissionArgs,
  type AntigravityAdapterOptions,
  type AntigravityPermissionMode,
} from './adapters/antigravity-adapter.js';
export {
  resolveAntigravityBinary,
  type ResolvedAntigravity,
} from './adapters/resolve-antigravity.js';
export {
  OpenCodeAdapter,
  parseModelList,
  parseOpenCodeModelWindows,
  openCodeUsageTokens,
  splitOpenCodeModel,
  decisionToPermissionReply,
  type OpenCodeAdapterOptions,
} from './adapters/opencode-adapter.js';
export {
  OpenCodeServer,
  parseSseRecord,
  parseServeUrl,
  type IOpenCodeServer,
  type OpenCodeServerEvent,
  type OpenCodePermissionRule,
  type OpenCodePromptBody,
  type PermissionReply,
} from './adapters/opencode-server.js';
export { resolveOpenCodeBinary, type ResolvedOpenCode } from './adapters/resolve-opencode.js';
export {
  ZeroAdapter,
  parseZeroModels,
  mergeZeroProviderModels,
  type ZeroAdapterOptions,
  type SpawnedAcp,
  type ZeroProvider,
} from './adapters/zero-adapter.js';
export { zeroToolBlock, zeroPlanSteps, type ZeroToolCall } from './adapters/zero-tools.js';
export { resolveZeroBinary, type ResolvedZero } from './adapters/resolve-zero.js';
export { GrokAdapter, mapGrokModels, type GrokAdapterOptions } from './adapters/grok-adapter.js';
export { grokToolBlock, grokPlanSteps, type GrokToolCall } from './adapters/grok-tools.js';
export { resolveGrokBinary, type ResolvedGrok } from './adapters/resolve-grok.js';
export { defaultSpawn, type SpawnFn, type SpawnedProcess } from './adapters/spawn.js';
export {
  ClaudeCodeAdapter,
  claudeContextWindow,
  claudeUsageTokens,
  parseClaudeLine,
  type ClaudeCodeAdapterOptions,
  type ClaudeEvent,
  type ClaudeModelSpec,
  type ClaudePermissionMode,
} from './adapters/claude-adapter.js';
export { resolveClaudeBinary, type ResolvedClaude } from './adapters/resolve-claude.js';
export { EchoAgentAdapter } from './adapters/echo-agent-adapter.js';
export {
  ProcessAgentAdapter,
  type ProcessAdapterOptions,
} from './adapters/process-agent-adapter.js';

// Conversation engine
export {
  ThreadStore,
  type StartTurnResult,
  type StartThreadInput,
  type ThreadRuntime,
} from './conversation/thread-store.js';
export {
  AgentManager,
  type AgentManagerOptions,
  type AgentMeta,
  type SendTurnOptions as AgentManagerSendTurnOptions,
} from './agents/agent-manager.js';

// Profile metrics (bridge-owned, survivable stats + tamper-proof backup)
export { MetricsService, type MetricsServiceOptions } from './metrics/metrics-service.js';
export {
  MetricsStore,
  type MetricsEvents,
  type SessionEvent,
  type GitActionEvent,
} from './metrics/metrics-store.js';
export {
  sealMetrics,
  openMetrics,
  MetricsSealError,
  type MetricsSealErrorCode,
  type SealOptions,
  type OpenOptions,
} from './metrics/metrics-seal.js';
export { utcDayKey } from './metrics/day.js';

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
export {
  BridgeSecureChannel,
  ReplayError,
  buildEnvelopeAad,
  DIRECTION_PHONE_TO_BRIDGE,
  DIRECTION_BRIDGE_TO_PHONE,
  type ChannelRole,
} from './transport/secure-channel.js';
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
export { localHostPorts, type InterfaceMap } from './transport/local-hosts.js';
export { OutboundLog, type OutboundLogEntry } from './transport/outbound-log.js';
export { SessionRegistry, type SessionSink } from './transport/session-registry.js';

// Git + workspace services
export { GitService } from './git/git-service.js';
export { runGit, GitCommandError, sanitizePaths, type RunGitResult } from './git/git-runner.js';
export { WorkspaceService } from './workspace/workspace-service.js';
export { BrowseService, browseRootIdFor } from './workspace/browse-service.js';
export { CheckpointService, type CaptureOptions } from './workspace/checkpoint-service.js';
export { resolveWithinRoot, isSensitiveName } from './workspace/path-guard.js';
