/**
 * Bridge daemon orchestration: wires daemon state, identity, config, the
 * JSON-RPC router and handlers, the agent runtimes (OpenCode/Claude/Codex/pi/
 * Gemini/Antigravity/Zero/Grok + echo), the per-device outbound catch-up log, and
 * the live E2EE transport (relay + direct LAN).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge entrypoint).
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
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
import { PairingCodeService } from './pairing/pairing-code-service.js';
import { createFileLogger, type LogLevel } from './logger.js';
import { BRIDGE_VERSION } from './version.js';
import { cachedUpdateStatus, ensureUpdateStatus, type UpdateStatus } from './update-check.js';
import { FileTrustStore, type TrustStore } from './transport/trust-store.js';
import { handleSecureConnection } from './transport/session-handler.js';
import { connectRelayAsMac, type RelayConnection } from './transport/relay-client.js';
import { startLanServer, type LanServerHandle } from './transport/lan-server.js';
import { localHostPorts, localIPv4s } from './transport/local-hosts.js';
import { MdnsAdvertiser } from './transport/mdns-advertiser.js';
import { SessionRegistry } from './transport/session-registry.js';
import { constantTimeEqual } from './transport/constant-time.js';
import { ThreadStore } from './conversation/thread-store.js';
import { MetricsService } from './metrics/metrics-service.js';
import { AgentManager } from './agents/agent-manager.js';
import { writeClaudeApprovalHook } from './hooks/claude-approval-hook.js';
import { writeGeminiApprovalHook } from './hooks/gemini-approval-hook.js';
import { EchoAgentAdapter } from './adapters/echo-agent-adapter.js';
import { OpenCodeAdapter } from './adapters/opencode-adapter.js';
import { resolveOpenCodeBinary } from './adapters/resolve-opencode.js';
import { ClaudeCodeAdapter } from './adapters/claude-adapter.js';
import { resolveClaudeBinary } from './adapters/resolve-claude.js';
import { CodexAdapter } from './adapters/codex-adapter.js';
import { resolveCodexBinary } from './adapters/resolve-codex.js';
import { PiAdapter } from './adapters/pi-adapter.js';
import { resolvePiBinary } from './adapters/resolve-pi.js';
import { GeminiAdapter } from './adapters/gemini-adapter.js';
import { resolveGeminiBinary } from './adapters/resolve-gemini.js';
import { AntigravityAdapter, antigravityPermissionMode } from './adapters/antigravity-adapter.js';
import { resolveAntigravityBinary } from './adapters/resolve-antigravity.js';
import { ZeroAdapter } from './adapters/zero-adapter.js';
import { resolveZeroBinary } from './adapters/resolve-zero.js';
import { GrokAdapter } from './adapters/grok-adapter.js';
import { resolveGrokBinary } from './adapters/resolve-grok.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { BrowseService } from './workspace/browse-service.js';
import { PushService } from './push/push-service.js';
import { createBridgePushSender } from './push/push-sender.js';
import { SessionHistoryReader } from './conversation/session-history.js';

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
  /** Latest self-update status from the background npm check, or `undefined`
   * before the first check resolves. */
  updateStatus(): UpdateStatus | undefined;
  generatePairingQr(): PairingPayload;
  /** The current manual-pairing code to show on the PC (rotates on expiry). */
  currentPairingCode(): string;
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
  // Bridge-owned profile metrics: aggregates the conversation store + the session
  // and git-action events the bridge observes itself, and seals/verifies the
  // tamper-proof backup file. The phone reads these over `metrics/*`.
  const metrics = new MetricsService({
    state,
    secretStore,
    threadStore,
    deviceId: deviceState.identity.macDeviceId,
    now,
  });
  // Close any session left open by a previous run so a crash never inflates the
  // connected-time metric (best-effort; never blocks startup).
  void metrics
    .closeDanglingSessions()
    .catch((err: unknown) =>
      logger.warn(`failed to close dangling metric sessions: ${String(err)}`),
    );
  // Reads agent on-disk session logs when the store has no turns (§5.8.8).
  const sessionHistory = new SessionHistoryReader();
  // Single source of the pairing payload — shared by the QR and the manual-code
  // resolve endpoint, so both hand out identical pairing data.
  const buildPairingPayload = (): PairingPayload =>
    generatePairingPayload({
      ...(config.relayEnabled ? { relayUrl: config.relayUrl } : {}),
      ...(config.lanEnabled ? { hosts: localHostPorts(config.lanPort) } : {}),
      macDeviceId: deviceState.identity.macDeviceId,
      macIdentityPublicKey: deviceState.identity.macIdentityPublicKey,
      displayName: hostname(),
      now: now(),
      sessionId: pairingSessionId,
    });
  const pairingCodeService = new PairingCodeService({
    buildPayload: buildPairingPayload,
    now,
    // Persist the code so the running daemon (which serves `/pair/resolve`) and a
    // separate `qr` command — or an autostarted, console-less daemon — agree on it.
    statePath: state.pathFor(DAEMON_FILES.pairingCode),
  });
  const projects = new ProjectRegistry(config.workspaceRoots, process.cwd(), config.projectAgents);
  // Browse roots fall back to the project roots, then the bridge's launch
  // directory (`process.cwd()`) — so an unconfigured install browses from
  // wherever the bridge was started, no `browseRoots`/`workspaceRoots` needed.
  const browse = new BrowseService(
    config.browseRoots.length > 0 ? config.browseRoots : config.workspaceRoots,
  );
  // Direct FCM is the PRIMARY push path: when a Firebase service account is present
  // the bridge delivers straight to FCM on any transport (LAN/Tailscale/relay). With
  // no credential this is null and the bridge uses the relay fallback (FOR-DEV).
  const pushSender = await createBridgePushSender(logger);
  const pushService = new PushService({
    relayUrl: config.relayUrl,
    config,
    logger,
    state,
    ...(pushSender ? { pushSender } : {}),
  });
  // Restore persisted push registrations so background push survives a restart.
  await pushService.load();
  const agentManager = new AgentManager({
    store: threadStore,
    notify: (message) => sessionRegistry.broadcast(message),
    now,
    logger,
    defaultAgent: config.defaultAgent,
    onTurnEnd: (info) => pushService.onTurnEnd(info),
    // Pause the approval auto-reject countdown while no phone is connected, so an
    // approval requested while the app is backgrounded waits (and replays on
    // reconnect) instead of defaulting to reject on a card the user never saw.
    isPhoneConnected: () => sessionRegistry.anyActive(),
  });
  // Echo: built-in reference agent (no external CLI), useful for development.
  agentManager.register(new EchoAgentAdapter(), { displayName: 'Echo (dev)' });
  // OpenCode: real agent driven via the `opencode serve` HTTP/SSE protocol (the
  // bridge speaks HTTP to a local `opencode serve` process; approvals go through
  // the bridge's `requestApproval` flow — see `opencode-server.ts`).
  const openCodeSettings = config.agents.opencode ?? {};
  const openCode = resolveOpenCodeBinary(openCodeSettings.binaryPath);
  agentManager.register(
    new OpenCodeAdapter({
      binaryPath: openCode.binaryPath,
      // Route OpenCode's `permission.asked` elicitations to the bridge's shared
      // approval round-trip (the same one the Claude PreToolUse hook, Codex
      // app-server, and Echo demo use).
      onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
      // Route OpenCode's `question.asked` (the agent's multiple-choice tool) to
      // the phone's question card and back.
      onQuestionRequest: (threadId, questions) => agentManager.requestQuestion(threadId, questions),
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
  // Interactive approvals (opt-in): the Claude adapter injects a PreToolUse hook
  // that round-trips each tool to this bridge's local HTTP endpoint. The hook
  // URL is lazy (the LAN port is known only after `startLan`); the token guards
  // the endpoint and the script is written under `~/.uxnan/hooks/`.
  const claudeInteractiveApprovals =
    (claudeSettings.interactiveApprovals ?? false) && config.lanEnabled;
  const hookState: { port?: number; token: string } = { token: randomUUID() };
  const claudeHookScriptPath = state.pathFor(join('hooks', 'claude-approval-hook.cjs'));
  const geminiHookScriptPath = state.pathFor(join('hooks', 'gemini-approval-hook.cjs'));
  if (claudeInteractiveApprovals) {
    void writeClaudeApprovalHook(claudeHookScriptPath).catch((err: unknown) =>
      logger.warn(`failed to write the Claude approval hook: ${String(err)}`),
    );
  }
  // Normalize the configured extra models (bare id strings or {id,...} specs)
  // into the adapter's spec shape; they appear in the picker alongside the
  // auto-updating opus/sonnet/haiku aliases. See docs/agents.md.
  const claudePinnedModels = (claudeSettings.models ?? []).map((m) =>
    typeof m === 'string' ? { id: m } : m,
  );
  agentManager.register(
    new ClaudeCodeAdapter({
      binaryPath: claude.binaryPath,
      prependArgs: claude.prependArgs,
      permissionMode: claudeSettings.permissionMode ?? 'acceptEdits',
      ...(claudeInteractiveApprovals
        ? {
            interactiveApprovals: true,
            approvalHook: {
              token: hookState.token,
              scriptPath: claudeHookScriptPath,
              url: () =>
                hookState.port !== undefined
                  ? `http://127.0.0.1:${hookState.port}/agent-hook/approval`
                  : undefined,
            },
          }
        : {}),
      ...(claudeSettings.model !== undefined ? { defaultModel: claudeSettings.model } : {}),
      ...(claudePinnedModels.length > 0 ? { pinnedModels: claudePinnedModels } : {}),
    }),
    {
      displayName: 'Claude Code',
      available: claude.available,
      ...(claudeSettings.model !== undefined ? { defaultModel: claudeSettings.model } : {}),
    },
  );
  // Codex: real agent driven via the `codex app-server` turn protocol
  // (the bridge speaks JSON-RPC over the child's stdio; approvals go through
  // the bridge's `requestApproval` flow — see `codex-approval.ts`).
  const codexSettings = config.agents['codex'] ?? {};
  const codex = resolveCodexBinary(codexSettings.binaryPath);
  agentManager.register(
    new CodexAdapter({
      binaryPath: codex.binaryPath,
      prependArgs: codex.prependArgs,
      // The app-server has its own approval channel; default to `interactive`
      // so every tool gating is surfaced to the phone (the previous
      // `acceptEdits` default silently auto-approved everything via
      // `codex exec -s workspace-write`). `acceptEdits` is still accepted
      // for back-compat and maps to the same no-prompt behavior.
      permissionMode: codexSettings.permissionMode ?? 'interactive',
      // Route app-server approval elicitations to the bridge's shared
      // approval round-trip (the same one the Claude PreToolUse hook and
      // the Echo demo use).
      onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
      ...(codexSettings.model !== undefined ? { defaultModel: codexSettings.model } : {}),
    }),
    {
      displayName: 'Codex',
      available: codex.available,
      ...(codexSettings.model !== undefined ? { defaultModel: codexSettings.model } : {}),
    },
  );
  // pi: real agent driven via `pi -p --mode json` (see FOR-DEV.md).
  const piSettings = config.agents['pi-agent'] ?? {};
  const pi = resolvePiBinary(piSettings.binaryPath);
  agentManager.register(
    new PiAdapter({
      binaryPath: pi.binaryPath,
      prependArgs: pi.prependArgs,
      permissionMode: piSettings.permissionMode ?? 'acceptEdits',
      ...(piSettings.model !== undefined ? { defaultModel: piSettings.model } : {}),
    }),
    {
      displayName: 'pi',
      available: pi.available,
      ...(piSettings.model !== undefined ? { defaultModel: piSettings.model } : {}),
    },
  );
  // Gemini: real agent driven via `gemini -p --output-format stream-json` (see FOR-DEV.md).
  const geminiSettings = config.agents['gemini-cli'] ?? {};
  const gemini = resolveGeminiBinary(geminiSettings.binaryPath);
  // Interactive approvals for Gemini: opt-in (`agents['gemini-cli'].
  // interactiveApprovals: true`) and only when the LAN server is enabled (the
  // hook POSTs to the bridge's local HTTP endpoint). The adapter writes a
  // `<cwd>/.gemini/settings.json` with a `BeforeTool` hook — Gemini uses the
  // same hook contract as Claude Code (the CLI ships `gemini hooks migrate`
  // for that).
  const geminiInteractiveApprovals =
    (geminiSettings.interactiveApprovals ?? false) && config.lanEnabled;
  if (geminiInteractiveApprovals) {
    void writeGeminiApprovalHook(geminiHookScriptPath).catch((err: unknown) =>
      logger.warn(`failed to write the Gemini approval hook: ${String(err)}`),
    );
  }
  agentManager.register(
    new GeminiAdapter({
      binaryPath: gemini.binaryPath,
      prependArgs: gemini.prependArgs,
      permissionMode: geminiSettings.permissionMode ?? 'acceptEdits',
      ...(geminiInteractiveApprovals
        ? {
            approvalHook: {
              token: hookState.token,
              scriptPath: geminiHookScriptPath,
              url: () =>
                hookState.port !== undefined
                  ? `http://127.0.0.1:${hookState.port}/agent-hook/approval`
                  : undefined,
            },
          }
        : {}),
      ...(geminiSettings.model !== undefined ? { defaultModel: geminiSettings.model } : {}),
    }),
    {
      displayName: 'Gemini',
      available: gemini.available,
      ...(geminiSettings.model !== undefined ? { defaultModel: geminiSettings.model } : {}),
    },
  );
  // Antigravity: real agent driven via `agy … -p` (Google's successor to the
  // deprecated Gemini CLI; models are the Gemini family). See FOR-DEV.md.
  const antigravitySettings = config.agents['antigravity-cli'] ?? {};
  const antigravity = resolveAntigravityBinary(antigravitySettings.binaryPath);
  agentManager.register(
    new AntigravityAdapter({
      binaryPath: antigravity.binaryPath,
      prependArgs: antigravity.prependArgs,
      permissionMode: antigravityPermissionMode(antigravitySettings.permissionMode),
      ...(antigravitySettings.model !== undefined
        ? { defaultModel: antigravitySettings.model }
        : {}),
    }),
    {
      displayName: 'Antigravity',
      available: antigravity.available,
      ...(antigravitySettings.model !== undefined
        ? { defaultModel: antigravitySettings.model }
        : {}),
    },
  );
  // Zero: open-source Go agent driven over the Agent Client Protocol (`zero acp`
  // — two-way JSON-RPC over stdio; approvals go through the bridge's
  // `requestApproval` flow, mapped onto ACP `session/request_permission`).
  const zeroSettings = config.agents.zero ?? {};
  const zero = resolveZeroBinary(zeroSettings.binaryPath);
  agentManager.register(
    new ZeroAdapter({
      binaryPath: zero.binaryPath,
      prependArgs: zero.prependArgs,
      onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
      ...(zeroSettings.model !== undefined ? { defaultModel: zeroSettings.model } : {}),
    }),
    {
      displayName: 'Zero',
      available: zero.available,
      ...(zeroSettings.model !== undefined ? { defaultModel: zeroSettings.model } : {}),
    },
  );
  // Grok: xAI's coding CLI driven over the Agent Client Protocol (`grok agent
  // stdio` — two-way JSON-RPC over stdio; approvals go through the bridge's
  // `requestApproval` flow, mapped onto ACP `session/request_permission`).
  const grokSettings = config.agents.grok ?? {};
  const grok = resolveGrokBinary(grokSettings.binaryPath);
  agentManager.register(
    new GrokAdapter({
      binaryPath: grok.binaryPath,
      prependArgs: grok.prependArgs,
      onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
      ...(grokSettings.model !== undefined ? { defaultModel: grokSettings.model } : {}),
    }),
    {
      displayName: 'Grok',
      available: grok.available,
      ...(grokSettings.model !== undefined ? { defaultModel: grokSettings.model } : {}),
    },
  );
  const startedAt = now();

  // Live relay-connection state, mutated by the relay serve loop below and read
  // by both the CLI `status()` and the `bridge/status` handler (via the context).
  const relayState = { connected: false };

  // Self-update status from the background npm check, read by the CLI notice and
  // exposed to the phone via `bridge/status`. Seeded synchronously from the
  // on-disk cache, then refreshed in the background (TTL-gated, non-blocking).
  const updateState: { status: UpdateStatus | undefined } = {
    status: await cachedUpdateStatus(state, BRIDGE_VERSION),
  };
  const refreshUpdate = (): Promise<void> =>
    ensureUpdateStatus(state)
      .then((status) => {
        updateState.status = status;
      })
      .catch(() => {
        /* best-effort — never surface update-check failures to the daemon */
      });

  const context: BridgeContext = {
    version: BRIDGE_VERSION,
    startedAt,
    config,
    state,
    deviceState,
    sessions,
    sessionRegistry,
    trustStore,
    threadStore,
    metrics,
    sessionHistory,
    agentManager,
    projects,
    browse,
    pushService,
    logger,
    relayConnected: () => relayState.connected,
    updateStatus: () => updateState.status,
    now,
  };

  const router = new HandlerRouter(context);
  registerAllHandlers(router);

  // Kick a background refresh on boot and every 6h; unref'd so a short-lived CLI
  // command (qr/code/status) isn't kept alive, cleared on stop().
  void refreshUpdate();
  const UPDATE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const updateTimer = setInterval(() => void refreshUpdate(), UPDATE_REFRESH_INTERVAL_MS);
  updateTimer.unref?.();

  const relayConnections: RelayConnection[] = [];
  let lanHandle: LanServerHandle | undefined;
  let mdns: MdnsAdvertiser | undefined;
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
        relayConnected: relayState.connected,
        lanEnabled: config.lanEnabled,
        activeSessions: sessions.count,
        startedAt,
        now: now(),
        ...(updateState.status?.latestVersion !== undefined
          ? { latestVersion: updateState.status.latestVersion }
          : {}),
        ...(updateState.status?.updateAvailable ? { updateAvailable: true } : {}),
      }),
    updateStatus: () => updateState.status,
    // Showing the QR (or the manual code, below) IS the operator's "pair a
    // phone now" signal: arm the LAN bootstrap window so the handshake accepts
    // a qr_bootstrap for the next PAIRING_WINDOW_MS (see the LAN
    // handleSecureConnection wiring in startLan, and server-handshake.ts).
    generatePairingQr: () => {
      pairingCodeService.arm();
      return buildPairingPayload();
    },
    currentPairingCode: () => {
      pairingCodeService.arm();
      return pairingCodeService.currentCode();
    },
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
        relayState.connected = true;
        try {
          await handleSecureConnection({
            io: connection.io,
            ctx: context,
            router,
            deviceState,
            trustStore,
            displayName: hostname(),
            transport: 'relay',
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
          relayState.connected = relayConnections.length > 0;
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
            transport: 'direct',
            // Consent gate for first-time enrollment (architecture/02a §5.9.1):
            // a qr_bootstrap is only accepted while the operator recently showed
            // the QR/code (see generatePairingQr/currentPairingCode above).
            // trusted_reconnect never consults this.
            isPairingArmed: () => pairingCodeService.isArmed(),
          });
        },
        // Manual-code pairing: trade a code shown on the PC for the pairing payload.
        onPairResolve: (code, ip) => {
          if (pairingCodeService.rateLimited(ip)) {
            return { status: 429, json: { error: 'rate_limited' } };
          }
          const payload = pairingCodeService.resolve(code);
          if (!payload) return { status: 403, json: { error: 'invalid_or_expired_code' } };
          return { status: 200, json: payload };
        },
        // Claude PreToolUse approval hook: ask the user (on the phone) whether a
        // tool may run; hold the response until they answer (or it times out).
        onHookApproval: async (body, token) => {
          if (typeof token !== 'string' || !constantTimeEqual(token, hookState.token)) {
            return { status: 403, json: { error: 'bad_token' } };
          }
          const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
          const threadId = typeof b['threadId'] === 'string' ? (b['threadId'] as string) : '';
          if (!threadId) return { status: 400, json: { error: 'missing_thread' } };
          const toolName = typeof b['toolName'] === 'string' ? (b['toolName'] as string) : 'tool';
          const input =
            b['input'] && typeof b['input'] === 'object'
              ? (b['input'] as Record<string, unknown>)
              : {};
          // The hook script consumes `'allow' | 'deny'`; translate from the
          // generic `ApprovalDecision` (the Codex app-server uses the same
          // generic decision, so the same route serves both backends).
          const decision = await agentManager.requestApproval(threadId, { toolName, input });
          const hookDecision = decision === 'reject' ? 'deny' : 'allow';
          return { status: 200, json: { decision: hookDecision } };
        },
      });
      hookState.port = lanHandle.port;
      logger.info(`LAN server listening on port ${lanHandle.port}`);
      // Advertise on the LAN via mDNS so the phone can discover the bridge for
      // manual-code pairing (best-effort; degrades silently if it can't bind).
      if (config.mdnsEnabled && !mdns) {
        const name = hostname();
        mdns = new MdnsAdvertiser({
          instanceName: name,
          hostName: name.replace(/[^A-Za-z0-9-]/g, '-'),
          port: lanHandle.port,
          addresses: localIPv4s(),
          txt: { id: deviceState.identity.macDeviceId },
          logger,
        });
        mdns.start();
      }
      return { port: lanHandle.port };
    },
    notify: (deviceId, method, params) =>
      sessionRegistry.notify(deviceId, makeNotification(method, params)),
    stop: async () => {
      logger.info('bridge stopping');
      stopping = true;
      clearInterval(updateTimer);
      await agentManager.stopAll();
      for (const connection of relayConnections) {
        connection.ws.close();
      }
      relayConnections.length = 0;
      relayState.connected = false;
      if (mdns) {
        mdns.stop();
        mdns = undefined;
      }
      if (lanHandle) {
        await lanHandle.close();
        lanHandle = undefined;
      }
    },
  };
}
