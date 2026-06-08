/**
 * Bridge daemon orchestration: wires daemon state, identity, config, the
 * JSON-RPC router and handlers, and the live E2EE transport (relay + LAN).
 *
 * Agent runtimes and the outbound catch-up buffer remain deferred (see FOR-DEV).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge entrypoint).
 */
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeNotification, type BridgeStatus, type PairingPayload } from '@uxnan/shared';
import type { BridgeContext } from './bridge-context.js';
import { HandlerRouter } from './handler-router.js';
import { registerAllHandlers } from './handlers/index.js';
import { DaemonState, DAEMON_FILES } from './daemon-state.js';
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
import { ClaudeCodeAdapter } from './adapters/claude-adapter.js';
import { resolveClaudeBinary } from './adapters/resolve-claude.js';
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

  // Persist the pairing sessionId so it is STABLE across bridge restarts. The
  // relay pairs phone↔bridge by sessionId; if we regenerated it every start,
  // the phone's trusted-reconnect (which reuses the stored sessionId) would no
  // longer find the bridge on the relay and would require re-scanning the QR.
  const persistedPairing = await state.readJson<{ sessionId: string }>(DAEMON_FILES.pairing);
  let pairingSessionId = persistedPairing?.sessionId;
  if (!pairingSessionId) {
    pairingSessionId = randomUUID();
    await state.writeJson(DAEMON_FILES.pairing, { sessionId: pairingSessionId });
  }

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
  // Claude Code: real agent driven via `claude -p --output-format stream-json` (see FOR-DEV.md).
  const claudeSettings = config.agents['claude-code'] ?? {};
  const claude = resolveClaudeBinary(claudeSettings.binaryPath);
  agentManager.register(
    new ClaudeCodeAdapter({
      binaryPath: claude.binaryPath,
      prependArgs: claude.prependArgs,
      permissionMode: claudeSettings.permissionMode ?? 'acceptEdits',
      ...(claudeSettings.model !== undefined ? { defaultModel: claudeSettings.model } : {}),
    }),
    {
      displayName: 'Claude Code',
      available: claude.available,
      ...(claudeSettings.model !== undefined ? { defaultModel: claudeSettings.model } : {}),
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
  let stopping = false;
  const RELAY_RECONNECT_DELAY_MS = 2000;
  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });

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
        sessionId: pairingSessionId,
      }),
    connectRelay: async (sessionId: string) => {
      const dial = (): Promise<RelayConnection> =>
        connectRelayAsMac({
          relayUrl: config.relayUrl,
          sessionId,
          macDeviceId: deviceState.identity.macDeviceId,
          macIdentityPublicKey: deviceState.identity.macIdentityPublicKey,
          machineName: hostname(),
        });

      // Serve exactly one phone session over `connection`; resolves when the
      // connection closes (the relay closes our socket when the phone drops).
      const serve = async (connection: RelayConnection): Promise<void> => {
        relayConnections.push(connection);
        relayConnected = true;
        try {
          await handleSecureConnection({
            io: connection.io,
            ctx: context,
            router,
            deviceState,
            trustStore,
            displayName: hostname(),
            expectedSessionId: sessionId,
          });
        } finally {
          const idx = relayConnections.indexOf(connection);
          if (idx >= 0) relayConnections.splice(idx, 1);
          try {
            connection.ws.close();
          } catch {
            /* already closed */
          }
          relayConnected = relayConnections.length > 0;
        }
      };

      // Initial connect (awaited so the caller knows the relay is reachable).
      const initial = await dial();
      // Background loop: after each session ends, reconnect to the relay and
      // wait for the phone again. This lets the phone trusted-reconnect after a
      // drop (or a bridge/relay restart) WITHOUT re-scanning the QR — the old
      // one-shot handler treated a reconnecting phone's handshake as encrypted
      // traffic and dropped it.
      void (async () => {
        let current: RelayConnection | undefined = initial;
        while (!stopping) {
          if (!current) {
            try {
              current = await dial();
            } catch (err) {
              logger.warn(
                `relay reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              await delay(RELAY_RECONNECT_DELAY_MS);
              continue;
            }
          }
          // Serve one phone session, then immediately re-arm on the relay (no
          // delay) so a reconnecting phone always finds the bridge paired.
          await serve(current);
          current = undefined;
        }
      })();
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
      stopping = true;
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
