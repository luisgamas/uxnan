/**
 * Bridge daemon orchestration: wires daemon state, identity, config, the
 * JSON-RPC router and handlers into a single runnable unit.
 *
 * The live relay/LAN transport and agent runtimes are deferred (see FOR-DEV).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge entrypoint).
 */
import { hostname } from 'node:os';
import type { BridgeStatus, PairingPayload } from '@uxnan/shared';
import type { BridgeContext } from './bridge-context.js';
import { HandlerRouter } from './handler-router.js';
import { registerAllHandlers } from './handlers/index.js';
import { DaemonState } from './daemon-state.js';
import { SecureDeviceState } from './secure-device-state.js';
import { InMemorySecretStore, type SecretStore } from './secret-store.js';
import { SessionState } from './session-state.js';
import { buildBridgeStatus } from './bridge-status.js';
import { generatePairingPayload } from './qr.js';
import { createLogger, type LogLevel } from './logger.js';
import { BRIDGE_VERSION } from './version.js';

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
  status(): BridgeStatus;
  generatePairingQr(): PairingPayload;
  stop(): Promise<void>;
}

export async function startBridge(options: StartBridgeOptions = {}): Promise<Bridge> {
  const now = options.now ?? (() => Date.now());
  const logger = createLogger('bridge', options.logLevel ?? 'info');

  const state = new DaemonState(options.baseDir);
  const config = await state.initConfig();

  const secretStore = options.secretStore ?? new InMemorySecretStore();
  const deviceState = new SecureDeviceState(secretStore);
  await deviceState.loadOrCreate();

  const sessions = new SessionState();
  const startedAt = now();

  const context: BridgeContext = {
    version: BRIDGE_VERSION,
    startedAt,
    config,
    state,
    deviceState,
    sessions,
    logger,
    now,
  };

  const router = new HandlerRouter(context);
  registerAllHandlers(router);

  logger.info(
    `bridge ready (v${BRIDGE_VERSION}); relay transport not yet wired (FOR-DEV: secure-transport)`,
  );

  // FOR-DEV: connect to the relay (WebSocket), start the LAN server, perform the
  // E2EE handshake and pump encrypted envelopes through `router.dispatchRaw`
  // (src/bridge.ts). Unblocks: real mobile connectivity.

  return {
    context,
    router,
    status: () =>
      buildBridgeStatus({
        version: BRIDGE_VERSION,
        relayConnected: false,
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
    stop: async () => {
      logger.info('bridge stopping');
      // FOR-DEV: close relay/LAN transports and agent runtimes here.
      await Promise.resolve();
    },
  };
}
