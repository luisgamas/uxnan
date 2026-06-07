/**
 * Bridge daemon orchestration: wires daemon state, identity, config, the
 * JSON-RPC router and handlers, and the live E2EE transport (relay + LAN).
 *
 * Agent runtimes and the outbound catch-up buffer remain deferred (see FOR-DEV).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge entrypoint).
 */
import { hostname } from 'node:os';
import { WebSocket } from 'ws';
import { makeNotification, type BridgeStatus, type PairingPayload } from '@uxnan/shared';
import type { BridgeContext } from './bridge-context.js';
import { HandlerRouter } from './handler-router.js';
import { registerAllHandlers } from './handlers/index.js';
import { DaemonState } from './daemon-state.js';
import { SecureDeviceState } from './secure-device-state.js';
import type { SecretStore } from './secret-store.js';
import { createDefaultSecretStore } from './keyring-secret-store.js';
import { SessionState } from './session-state.js';
import { buildBridgeStatus } from './bridge-status.js';
import { generatePairingPayload } from './qr.js';
import { createFileLogger, type LogLevel } from './logger.js';
import { BRIDGE_VERSION } from './version.js';
import { FileTrustStore, type TrustStore } from './transport/trust-store.js';
import { handleSecureConnection } from './transport/session-handler.js';
import { connectRelayAsMac, type RelayConnection } from './transport/relay-client.js';
import { startLanServer, type LanServerHandle } from './transport/lan-server.js';
import { SessionRegistry } from './transport/session-registry.js';
import { ThreadStore } from './conversation/thread-store.js';
import { AgentManager } from './agents/agent-manager.js';
import { EchoAgentAdapter } from './adapters/echo-agent-adapter.js';
import { OpenCodeAdapter } from './adapters/opencode-adapter.js';
import { resolveOpenCodeBinary } from './adapters/resolve-opencode.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { PushService } from './push/push-service.js';

export interface StartBridgeOptions {
  /** Override the daemon state directory (defaults to `~/.uxnan`). */
  baseDir?: string;
  /** Inject a secret store (defaults to an in-memory one). */
  secretStore?: SecretStore;
  logLevel?: LogLevel;
  /** Inject a clock (epoch ms) for testability. */
  now?: () => number;
}

export interface Bridge {
  readonly context: BridgeContext;
  readonly router: HandlerRouter;
  readonly trustStore: TrustStore;
  status(): BridgeStatus;
  generatePairingQr(): PairingPayload;
  /** Connect to the relay as `mac` and serve a phone for the given session. */
  connectRelay(sessionId: string): Promise<void>;
  /** Start the direct-LAN WebSocket server; resolves with the bound port. */
  startLan(): Promise<{ port: number }>;
  /**
   * Push a JSON-RPC notification to a connected phone. Returns `true` if it was
   * sent live, `false` if the device is offline and it was buffered.
   */
  notify(deviceId: string, method: string, params?: unknown): boolean;
  stop(): Promise<void>;
}

export async function startBridge(options: StartBridgeOptions = {}): Promise<Bridge> {
  const now = options.now ?? (() => Date.now());
  const state = new DaemonState(options.baseDir);
  const logger = createFileLogger({
    scope: 'bridge',
    minLevel: options.logLevel ?? 'info',
    logDir: state.logsDir,
  });
  const config = await state.initConfig();

  const secretStore = options.secretStore ?? (await createDefaultSecretStore(logger));
  const deviceState = new SecureDeviceState(secretStore);
  await deviceState.loadOrCreate();

  const sessions = new SessionState();
  const sessionRegistry = new SessionRegistry();
  const trustStore = new FileTrustStore(state);
  const threadStore = new ThreadStore(state);
  const projects = new ProjectRegistry(config.workspaceRoots);
  const pushService = new PushService({ relayUrl: config.relayUrl, config, logger });
  const agentManager = new AgentManager({
    store: threadStore,
    notify: (message) => sessionRegistry.broadcast(message),
    now,
    logger,
    defaultAgent: config.defaultAgent,
    onTurnEnd: (info) => pushService.onTurnEnd(info),
  });
  // Echo: built-in reference agent (no external CLI), useful for development.
  agentManager.register(new EchoAgentAdapter(), { displayName: 'Echo (dev)' });
  // OpenCode: real agent driven via `opencode run --format json` (see FOR-DEV.md).
  const openCodeSettings = config.agents.opencode ?? {};
  const openCode = resolveOpenCodeBinary(openCodeSettings.binaryPath);
  agentManager.register(
    new OpenCodeAdapter({
      binaryPath: openCode.binaryPath,
      ...(openCodeSettings.model !== undefined ? { defaultModel: openCodeSettings.model } : {}),
    }),
    {
      displayName: 'OpenCode',
      available: openCode.available,
      ...(openCodeSettings.model !== undefined ? { defaultModel: openCodeSettings.model } : {}),
    },
  );
  const startedAt = now();

  const context: BridgeContext = {
    version: BRIDGE_VERSION,
    startedAt,
    config,
    state,
    deviceState,
    sessions,
    sessionRegistry,
    threadStore,
    agentManager,
    projects,
    pushService,
    logger,
    now,
  };

  const router = new HandlerRouter(context);
  registerAllHandlers(router);

  const relayConnections: RelayConnection[] = [];
  let lanHandle: LanServerHandle | undefined;
  let relayConnected = false;

  logger.info(`bridge ready (v${BRIDGE_VERSION})`);

  return {
    context,
    router,
    trustStore,
    status: () =>
      buildBridgeStatus({
        version: BRIDGE_VERSION,
        relayConnected,
        lanEnabled: config.lanEnabled,
        activeSessions: sessions.count,
        startedAt,
        now: now(),
      }),
    generatePairingQr: () =>
      generatePairingPayload({
        relayUrl: config.relayUrl,
        macDeviceId: deviceState.identity.macDeviceId,
        macIdentityPublicKey: deviceState.identity.macIdentityPublicKey,
        displayName: hostname(),
        now: now(),
      }),
    connectRelay: async (sessionId: string) => {
      const connection = await connectRelayAsMac({
        relayUrl: config.relayUrl,
        sessionId,
        macDeviceId: deviceState.identity.macDeviceId,
        macIdentityPublicKey: deviceState.identity.macIdentityPublicKey,
        machineName: hostname(),
      });
      relayConnections.push(connection);
      relayConnected = true;
      connection.ws.once('close', () => {
        relayConnected = relayConnections.some((c) => c.ws.readyState === WebSocket.OPEN);
      });
      void handleSecureConnection({
        io: connection.io,
        ctx: context,
        router,
        deviceState,
        trustStore,
        displayName: hostname(),
        expectedSessionId: sessionId,
      });
    },
    startLan: async () => {
      if (lanHandle) return { port: lanHandle.port };
      lanHandle = await startLanServer({
        port: config.lanPort,
        onConnection: (io) => {
          void handleSecureConnection({
            io,
            ctx: context,
            router,
            deviceState,
            trustStore,
            displayName: hostname(),
          });
        },
      });
      logger.info(`LAN server listening on port ${lanHandle.port}`);
      return { port: lanHandle.port };
    },
    notify: (deviceId, method, params) =>
      sessionRegistry.notify(deviceId, makeNotification(method, params)),
    stop: async () => {
      logger.info('bridge stopping');
      await agentManager.stopAll();
      for (const connection of relayConnections) {
        connection.ws.close();
      }
      relayConnections.length = 0;
      relayConnected = false;
      if (lanHandle) {
        await lanHandle.close();
        lanHandle = undefined;
      }
    },
  };
}
