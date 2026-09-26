/**
 * Bridge daemon orchestration: wires daemon state, identity, config, the
 * JSON-RPC router and handlers, the agent runtimes (OpenCode/Claude/Codex/pi/
 * Antigravity/Zero/Grok + echo),
 * the per-device outbound catch-up log, and
 * the live E2EE transport (relay + direct LAN).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge entrypoint).
 */
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LOCAL_CONTROL_FILE,
  StreamNotification,
  localReceiverId,
  makeNotification,
  type AgentsUpdatedParams,
  type LocatedAgent,
  type BridgeStatus,
  type PairingPayload,
  type DevicesUpdatedParams,
  type PresenceUpdatedParams,
  type ProjectRemovedParams,
  type ProjectUpdatedParams,
  type SettingsUpdatedParams,
  type ThreadDeletedParams,
  type ThreadUpdatedParams,
} from '@uxnan/shared';
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
import {
  startLocalControlServer,
  type LocalControlServerHandle,
} from './transport/local-control-server.js';
import {
  buildDiscovery,
  mintLocalControlToken,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from './local-control-discovery.js';
import { localHostPorts, localIPv4s } from './transport/local-hosts.js';
import { MdnsAdvertiser } from './transport/mdns-advertiser.js';
import { SessionRegistry } from './transport/session-registry.js';
import { constantTimeEqual } from './transport/constant-time.js';
import { ThreadStore } from './conversation/thread-store.js';
import { MetricsService } from './metrics/metrics-service.js';
import { MetricsStore } from './metrics/metrics-store.js';
import { AgentManager } from './agents/agent-manager.js';
import { writeClaudeApprovalHook } from './hooks/claude-approval-hook.js';
import { EchoAgentAdapter } from './adapters/echo-agent-adapter.js';
import { OpenCodeAdapter } from './adapters/opencode-adapter.js';
import { ClaudeCodeAdapter } from './adapters/claude-adapter.js';
import { CodexAdapter } from './adapters/codex-adapter.js';
import { PiAdapter } from './adapters/pi-adapter.js';
import { AntigravityAdapter, antigravityPermissionMode } from './adapters/antigravity-adapter.js';
import { ZeroAdapter } from './adapters/zero-adapter.js';
import { GrokAdapter } from './adapters/grok-adapter.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { AgentInstalls } from './agents/agent-installs.js';
import { ensureGlobalEntry, type GlobalEntryAgent } from './agents/global-mcp-entry.js';
import { SyncLedger } from './sync/sync-ledger.js';
import { BridgeSettingsStore } from './settings/bridge-settings.js';
import { PresenceRegistry } from './presence/presence-registry.js';
import { bridgeHost } from './presence/host-info.js';

/** The local client id Uxnan Desktop connects as. */
const DESKTOP_LOCAL_CLIENT = 'desktop';
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
  /**
   * Keep the `uxnan-browser` entry in Zero's and Antigravity's global MCP
   * config (agents/global-mcp-entry.ts). Only the long-running daemon
   * (`uxnan-bridge start`) sets it — never a short-lived command or a test,
   * which must not touch the user's agent configs.
   */
  manageGlobalEntries?: boolean;
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
  /**
   * The same payload WITHOUT opening the pairing window — its addresses and
   * relay session, for a bridge that starts as a service and pairs only when
   * asked (`uxnan-bridge qr`, Uxnan Desktop).
   */
  pairingInfo(): PairingPayload;
  /** The current manual-pairing code to show on the PC (rotates on expiry). */
  currentPairingCode(): string;
  /** Connect to the relay as `mac` and serve a phone for the given session. */
  connectRelay(sessionId: string): Promise<void>;
  /** Start the direct-LAN WebSocket server; resolves with the bound port. */
  startLan(): Promise<{ port: number }>;
  /**
   * Start the loopback-only local control channel (architecture/02a §5.8.15)
   * and publish its address + a fresh token in `~/.uxnan/local-control.json`.
   * Resolves with the bound port. Idempotent.
   */
  startLocalControl(): Promise<{ port: number }>;
  /**
   * Push a JSON-RPC notification to a connected phone. Returns `true` if it was
   * sent live, `false` if the device is offline and it was buffered.
   */
  notify(deviceId: string, method: string, params?: unknown): boolean;
  stop(): Promise<void>;
}

/**
 * Pure decision for the relay reconnect backoff: given how long the last relay
 * session lasted and the current backoff, return the delay to use for the
 * *next* reconnect attempt. A session shorter than `minHealthyMs` never really
 * carried a phone (the relay accepted the socket and closed it again — the
 * session was already taken, a relay error, a relay bounce), so the backoff
 * doubles (capped at `maxMs`); a session that reached `minHealthyMs` resets
 * the backoff to `baseMs`. Exported standalone so the reconnect loop's timing
 * decision can be unit-tested without a live relay.
 */
export function nextRelayBackoff(
  sessionMs: number,
  currentBackoffMs: number,
  opts: { minHealthyMs: number; baseMs: number; maxMs: number },
): number {
  if (sessionMs >= opts.minHealthyMs) return opts.baseMs;
  return Math.min(currentBackoffMs * 2, opts.maxMs);
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

  // One revision counter for every change clients mirror (§5.8.17).
  const ledger = await SyncLedger.load(state);
  const presence = new PresenceRegistry();
  const host = bridgeHost();
  const sessions = new SessionState(presence);
  const sessionRegistry = new SessionRegistry();
  const trustStore = new FileTrustStore(state);
  const metricsStore = new MetricsStore(state);
  const threadStore = new ThreadStore(state, metricsStore, ledger);
  // Bridge-owned profile metrics: every conversation, turn, token report,
  // session and Git action is retained in a durable ledger and sealed into the
  // tamper-proof backup file. The phone reads these over `metrics/*`.
  const metrics = new MetricsService({
    state,
    secretStore,
    threadStore,
    store: metricsStore,
    deviceId: deviceState.identity.macDeviceId,
    now,
  });
  // Close crash-leftover sessions and migrate existing thread history before
  // accepting connections. Failure is non-fatal because each read/export also
  // retries the idempotent backfill.
  await metrics
    .initialize()
    .catch((err: unknown) => logger.warn(`failed to initialize metrics ledger: ${String(err)}`));
  // The message queue is live AgentManager state and does not survive a restart
  // (neither does the turn it was waiting behind). Close out any turn left
  // `queued` on disk so it reads as cancelled — visibly never sent — instead of
  // sitting in the thread forever waiting for a queue that no longer exists.
  await threadStore
    .cancelOrphanedQueuedTurns(now())
    .then((count) => {
      if (count > 0) logger.info(`cancelled ${count} queued turn(s) left by a previous run`);
    })
    .catch((err: unknown) => logger.warn(`failed to close orphaned queued turns: ${String(err)}`));
  // Single source of the pairing payload — shared by the QR and the manual-code
  // resolve endpoint, so both hand out identical pairing data.
  const buildPairingPayload = (): PairingPayload =>
    generatePairingPayload({
      ...(config.relayEnabled ? { relayUrl: config.relayUrl } : {}),
      ...(config.lanEnabled ? { hosts: localHostPorts(config.lanPort) } : {}),
      macDeviceId: deviceState.identity.macDeviceId,
      macIdentityPublicKey: deviceState.identity.macIdentityPublicKey,
      // The phone files the PC under the name every client uses for it.
      displayName: settings.get().name,
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
  const settings = new BridgeSettingsStore({ state, ledger, config });
  await settings.load();
  const projects = new ProjectRegistry({
    state,
    ledger,
    configRoots: config.workspaceRoots,
    projectAgents: config.projectAgents,
    now,
  });
  const firstRegistry = await projects.load();
  await seedProjects(projects, threadStore, firstRegistry).catch((err: unknown) =>
    logger.warn(`failed to link conversations to projects: ${String(err)}`),
  );
  // Browsing starts at the shared start folder (`home`) — never at whatever
  // directory `start` happened to run in — plus any configured roots.
  const browseRootsFor = (home: string): string[] => [
    home,
    ...config.browseRoots,
    ...config.workspaceRoots,
  ];
  const browse = new BrowseService(browseRootsFor(settings.get().home));
  settings.onChange(({ settings: next }) => browse.setRoots(browseRootsFor(next.home)));
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
  // Every change clients mirror is announced from the store that made it, with
  // its sync revision — the one place these notifications come from (§5.8.17).
  const broadcast = (method: string, params: unknown): void =>
    sessionRegistry.broadcast(makeNotification(method, params));
  threadStore.onChange((change) => {
    if (change.type === 'deleted') {
      broadcast(StreamNotification.ThreadDeleted, {
        threadId: change.threadId,
        rev: change.rev,
      } satisfies ThreadDeletedParams);
      return;
    }
    const activeTurnId = agentManager.activeTurnId(change.thread.id);
    broadcast(StreamNotification.ThreadUpdated, {
      thread: activeTurnId !== undefined ? { ...change.thread, activeTurnId } : change.thread,
    } satisfies ThreadUpdatedParams);
  });
  projects.onChange((change) => {
    if (change.type === 'removed') {
      broadcast(StreamNotification.ProjectRemoved, {
        projectId: change.projectId,
        rev: change.rev,
      } satisfies ProjectRemovedParams);
    } else {
      broadcast(StreamNotification.ProjectUpdated, {
        project: change.project,
      } satisfies ProjectUpdatedParams);
    }
  });
  settings.onChange((change) =>
    broadcast(StreamNotification.SettingsUpdated, change satisfies SettingsUpdatedParams),
  );
  // A phone named anywhere is named everywhere: every client hears the list,
  // and a connected phone shows under its new name at once.
  trustStore.onChange((devices) => {
    broadcast(StreamNotification.DevicesUpdated, { devices } satisfies DevicesUpdatedParams);
    for (const device of devices) sessions.rename(device.deviceId, device.displayName);
  });
  // The desktop goes by the PC's shared name.
  settings.onChange(({ settings: next }) => presence.rename('desktop', next.name));
  presence.onChange((clients) =>
    broadcast(StreamNotification.PresenceUpdated, { clients } satisfies PresenceUpdatedParams),
  );
  // A client that just connected is about to ask what it can run: re-check
  // what is installed first (bounded by the refresh TTL).
  presence.onChange(() => agentInstalls.refresh());
  // Echo: built-in reference agent (no external CLI), useful for development.
  agentManager.register(new EchoAgentAdapter(), { displayName: 'Echo (dev)' });
  // OpenCode: real agent driven over a local `opencode serve` (HTTP + SSE),
  // OpenCode 1 or 2 — the adapter reads the installed version and speaks its
  // protocol (`opencode-v1.ts` / `opencode-v2.ts`); approvals and questions go
  // through the bridge's shared round-trips below.
  // Every CLI agent is found with the rule shared with Uxnan Desktop and
  // re-checked while the bridge runs (`AgentInstalls`), so one installed later
  // appears without a restart.
  const agentInstalls = new AgentInstalls(agentManager, { now });
  agentInstalls.onChange(() =>
    broadcast(StreamNotification.AgentsUpdated, {
      agents: agentManager.listAgents(),
    } satisfies AgentsUpdatedParams),
  );
  const openCodeSettings = config.agents.opencode ?? {};
  // Swapped when OpenCode is installed while the bridge runs; the history
  // reader below always asks the current one.
  let openCodeAdapter: OpenCodeAdapter | undefined;
  agentInstalls.register({
    agentId: 'opencode',
    displayName: 'OpenCode',
    ...(openCodeSettings.binaryPath ? { configuredPath: openCodeSettings.binaryPath } : {}),
    ...(openCodeSettings.model !== undefined ? { defaultModel: openCodeSettings.model } : {}),
    create: (located) =>
      (openCodeAdapter = new OpenCodeAdapter({
        binaryPath: located.binaryPath,
        // Route OpenCode's permission requests to the bridge's shared approval
        // round-trip (the same one the Claude PreToolUse hook, Codex app-server, and
        // Echo demo use).
        onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
        // Route OpenCode's questions (the agent's multiple-choice tool; a form on
        // OpenCode 2) to the phone's question card and back.
        onQuestionRequest: (threadId, questions) =>
          agentManager.requestQuestion(threadId, questions),
        ...(openCodeSettings.model !== undefined ? { defaultModel: openCodeSettings.model } : {}),
      })),
  });
  // Claude Code: real agent driven via `claude -p --output-format stream-json` (see FOR-DEV.md).
  const claudeSettings = config.agents['claude-code'] ?? {};
  // Interactive approvals (opt-in): the Claude adapter injects a PreToolUse hook
  // that round-trips each tool to this bridge's local HTTP endpoint. The hook
  // URL is lazy (the LAN port is known only after `startLan`); the token guards
  // the endpoint and the script is written under `~/.uxnan/hooks/`.
  const claudeInteractiveApprovals =
    (claudeSettings.interactiveApprovals ?? false) && config.lanEnabled;
  const hookState: { port?: number; token: string } = { token: randomUUID() };
  const claudeHookScriptPath = state.pathFor(join('hooks', 'claude-approval-hook.cjs'));
  if (claudeInteractiveApprovals) {
    void writeClaudeApprovalHook(claudeHookScriptPath).catch((err: unknown) =>
      logger.warn(`failed to write the Claude approval hook: ${String(err)}`),
    );
  }
  // Normalize the configured extra models (bare id strings or {id,...} specs)
  // into the adapter's spec shape; they appear in the picker alongside the
  // auto-updating fable/opus/sonnet/haiku aliases. See docs/agents.md.
  const claudePinnedModels = (claudeSettings.models ?? []).map((m) =>
    typeof m === 'string' ? { id: m } : m,
  );
  agentInstalls.register({
    agentId: 'claude-code',
    displayName: 'Claude Code',
    ...(claudeSettings.binaryPath ? { configuredPath: claudeSettings.binaryPath } : {}),
    ...(claudeSettings.model !== undefined ? { defaultModel: claudeSettings.model } : {}),
    create: (located) =>
      new ClaudeCodeAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
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
  });
  // Codex: real agent driven via the `codex app-server` turn protocol
  // (the bridge speaks JSON-RPC over the child's stdio; approvals go through
  // the bridge's `requestApproval` flow — see `codex-approval.ts`).
  const codexSettings = config.agents['codex'] ?? {};
  agentInstalls.register({
    agentId: 'codex',
    displayName: 'Codex',
    ...(codexSettings.binaryPath ? { configuredPath: codexSettings.binaryPath } : {}),
    ...(codexSettings.model !== undefined ? { defaultModel: codexSettings.model } : {}),
    create: (located) =>
      new CodexAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
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
  });
  // pi: real agent driven via persistent `pi --mode rpc` sessions (see FOR-DEV.md).
  const piSettings = config.agents['pi-agent'] ?? {};
  agentInstalls.register({
    agentId: 'pi-agent',
    displayName: 'pi',
    ...(piSettings.binaryPath ? { configuredPath: piSettings.binaryPath } : {}),
    ...(piSettings.model !== undefined ? { defaultModel: piSettings.model } : {}),
    create: (located) =>
      new PiAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
        permissionMode: piSettings.permissionMode ?? 'acceptEdits',
        ...(piSettings.model !== undefined ? { defaultModel: piSettings.model } : {}),
      }),
  });
  // Antigravity: real Google agent driven via `agy … -p`; models are discovered
  // from the CLI and may belong to the Gemini family. See FOR-DEV.md.
  const antigravitySettings = config.agents['antigravity-cli'] ?? {};
  // Antigravity only reads MCP servers from its global config: keep the
  // secret-free `uxnan-browser` entry there (agents/global-mcp-entry.ts).
  const keepGlobalEntry = (agent: GlobalEntryAgent) => (located: LocatedAgent) => {
    if (options.manageGlobalEntries !== true) return;
    void ensureGlobalEntry(agent, located).then((outcome) => {
      if (outcome === 'added') logger.info(`registered uxnan-browser for ${agent}`);
      if (outcome === 'failed') logger.warn(`could not register uxnan-browser for ${agent}`);
    });
  };
  agentInstalls.register({
    agentId: 'antigravity-cli',
    displayName: 'Antigravity',
    whenAvailable: keepGlobalEntry('antigravity-cli'),
    ...(antigravitySettings.binaryPath ? { configuredPath: antigravitySettings.binaryPath } : {}),
    ...(antigravitySettings.model !== undefined ? { defaultModel: antigravitySettings.model } : {}),
    create: (located) =>
      new AntigravityAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
        permissionMode: antigravityPermissionMode(antigravitySettings.permissionMode),
        ...(antigravitySettings.model !== undefined
          ? { defaultModel: antigravitySettings.model }
          : {}),
      }),
  });
  // Zero: open-source Go agent driven over the Agent Client Protocol (`zero acp`
  // — two-way JSON-RPC over stdio; approvals go through the bridge's
  // `requestApproval` flow, mapped onto ACP `session/request_permission`).
  const zeroSettings = config.agents.zero ?? {};
  agentInstalls.register({
    agentId: 'zero',
    displayName: 'Zero',
    ...(zeroSettings.binaryPath ? { configuredPath: zeroSettings.binaryPath } : {}),
    ...(zeroSettings.model !== undefined ? { defaultModel: zeroSettings.model } : {}),
    create: (located) =>
      new ZeroAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
        onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
        ...(zeroSettings.model !== undefined ? { defaultModel: zeroSettings.model } : {}),
      }),
  });
  // Grok: xAI's coding CLI driven over the Agent Client Protocol (`grok agent
  // stdio` — two-way JSON-RPC over stdio; approvals go through the bridge's
  // `requestApproval` flow, mapped onto ACP `session/request_permission`).
  const grokSettings = config.agents.grok ?? {};
  agentInstalls.register({
    agentId: 'grok',
    displayName: 'Grok',
    ...(grokSettings.binaryPath ? { configuredPath: grokSettings.binaryPath } : {}),
    ...(grokSettings.model !== undefined ? { defaultModel: grokSettings.model } : {}),
    create: (located) =>
      new GrokAdapter({
        binaryPath: located.binaryPath,
        prependArgs: located.prependArgs,
        onApprovalRequest: (threadId, info) => agentManager.requestApproval(threadId, info),
        ...(grokSettings.model !== undefined ? { defaultModel: grokSettings.model } : {}),
      }),
  });
  // Agent-owned history is consulted on every idle `turn/list` so work written
  // from another client attached to the same native session converges back into
  // Uxnan. OpenCode is read through its own server's history API, normalized for
  // the installed version (current releases use SQLite); the other supported
  // agents use their documented local logs.
  const sessionHistory = new SessionHistoryReader({
    openCodeMessages: (sessionId, cwd) =>
      openCodeAdapter?.readSessionMessages(sessionId, cwd) ?? Promise.resolve([]),
  });
  const startedAt = now();
  // Identifies this run, so a local client reconnecting after a restart knows
  // the replay window it remembers is gone (see local-control-server.ts).
  const instanceId = randomUUID();
  let localControl: LocalControlServerHandle | undefined;
  let localControlToken: string | undefined;

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
    agentInstalls,
    projects,
    ledger,
    settings,
    presence,
    host,
    browse,
    pushService,
    logger,
    relayConnected: () => relayState.connected,
    localControlActive: () => localControl !== undefined,
    updateStatus: () => updateState.status,
    pairingPayload: () => {
      pairingCodeService.arm();
      return buildPairingPayload();
    },
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
  // A relay session shorter than this never really carried a phone (see
  // `nextRelayBackoff`); the reconnect loop backs off exponentially up to this
  // cap instead of hot-looping against a relay that accepts and closes.
  const MIN_HEALTHY_SESSION_MS = 3000;
  const MAX_RECONNECT_DELAY_MS = 30_000;
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
        localControl: localControl !== undefined,
        activeTurns: agentManager.activeTurnCount(),
        host,
        clients: presence.list(),
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
    pairingInfo: buildPairingPayload,
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
          machineName: settings.get().name,
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
            displayName: settings.get().name,
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
        // Backs off after a session that ends almost immediately (relay
        // accept-then-close, a bounce, or the session already being taken) so
        // a misbehaving relay can't drive this into a tight, CPU-spinning
        // reconnect loop; a session that actually carries a phone resets it.
        let backoffMs = RELAY_RECONNECT_DELAY_MS;
        while (!stopping) {
          if (!current) {
            try {
              current = await dial();
            } catch (err) {
              logger.warn(
                `relay reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              await delay(backoffMs);
              backoffMs = nextRelayBackoff(0, backoffMs, {
                minHealthyMs: MIN_HEALTHY_SESSION_MS,
                baseMs: RELAY_RECONNECT_DELAY_MS,
                maxMs: MAX_RECONNECT_DELAY_MS,
              });
              continue;
            }
          }
          // Serve one phone session, then re-arm on the relay.
          const startedAt = now();
          await serve(current);
          current = undefined;
          // `stop()` closes the relay connection, so the final `serve()` always
          // returns "unhealthily" fast. Leave before the backoff so shutdown
          // neither logs a misleading warning nor lingers in a sleep.
          if (stopping) break;
          const sessionMs = now() - startedAt;
          if (sessionMs < MIN_HEALTHY_SESSION_MS) {
            logger.warn(`relay session ended after ${sessionMs}ms; backing off ${backoffMs}ms`);
            await delay(backoffMs);
          }
          backoffMs = nextRelayBackoff(sessionMs, backoffMs, {
            minHealthyMs: MIN_HEALTHY_SESSION_MS,
            baseMs: RELAY_RECONNECT_DELAY_MS,
            maxMs: MAX_RECONNECT_DELAY_MS,
          });
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
            displayName: settings.get().name,
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
          // Log the OUTCOME (never the code — it is a shared secret). Without
          // this a failed manual pairing is indistinguishable from a request
          // that never arrived, which is exactly how a Tailscale-only failure
          // was misread as a rejected code.
          if (pairingCodeService.rateLimited(ip)) {
            logger.warn(`pair/resolve from ${ip}: rate limited (429)`);
            return { status: 429, json: { error: 'rate_limited' } };
          }
          const payload = pairingCodeService.resolve(code);
          if (!payload) {
            logger.warn(`pair/resolve from ${ip}: code did not match or expired (403)`);
            return { status: 403, json: { error: 'invalid_or_expired_code' } };
          }
          logger.info(`pair/resolve from ${ip}: accepted (200); pairing window armed`);
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
    startLocalControl: async () => {
      if (localControl) return { port: localControl.port };
      const token = mintLocalControlToken();
      const handle = await startLocalControlServer({
        port: 0,
        token,
        bridgeVersion: BRIDGE_VERSION,
        instanceId,
        registry: sessionRegistry,
        // Marked local, so methods only the desktop may call (`desktop/attach`)
        // can tell it from a phone.
        dispatch: (raw, clientId) =>
          router.dispatchRaw(raw, {
            sessionId: localReceiverId(clientId),
            deviceId: localReceiverId(clientId),
            local: clientId,
          }),
        // A local client can see and answer approvals exactly like a phone, so
        // it counts as "someone is there" for the approval countdown.
        onClientConnected: (clientId) => {
          agentManager.onPhoneConnected();
          // Only Uxnan Desktop is a presence; a CLI command's short call is not.
          if (clientId === DESKTOP_LOCAL_CLIENT) {
            presence.connected({
              id: localReceiverId(clientId),
              kind: 'desktop',
              name: settings.get().name,
              since: now(),
            });
          }
          logger.info(`local client connected: ${clientId}`);
        },
        onClientDisconnected: (clientId) => {
          agentManager.onPhoneDisconnected();
          presence.disconnected(localReceiverId(clientId));
          // Its tools' token dies with it (the desktop mints a new one).
          agentManager.clearDesktopTools(clientId);
          logger.info(`local client disconnected: ${clientId}`);
        },
      });
      try {
        await writeDiscoveryFile(
          state.pathFor(LOCAL_CONTROL_FILE),
          buildDiscovery({
            port: handle.port,
            token,
            pid: process.pid,
            bridgeVersion: BRIDGE_VERSION,
            instanceId,
          }),
        );
      } catch (err) {
        // Without the file no client can find the listener: close it rather
        // than keep a socket nobody can use.
        await handle.close();
        throw err;
      }
      localControl = handle;
      localControlToken = token;
      logger.info(`local control channel listening on 127.0.0.1:${handle.port}`);
      return { port: handle.port };
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
      if (localControl) {
        await localControl.close();
        localControl = undefined;
      }
      if (localControlToken !== undefined) {
        await removeDiscoveryFile(state.pathFor(LOCAL_CONTROL_FILE), localControlToken);
        localControlToken = undefined;
      }
    },
  };
}

/**
 * Link every conversation to the project its folder belongs to, and — the first
 * time the registry is created — register those folders, so everything a user
 * already did (on the phone alone, before this registry existed) shows up as
 * projects on every client from the start. Later runs never re-add a project
 * the user removed; they only relink conversations. Git is asked once per
 * distinct folder.
 */
async function seedProjects(
  projects: ProjectRegistry,
  threadStore: ThreadStore,
  firstRegistry: boolean,
): Promise<void> {
  if (firstRegistry) {
    for (const folder of await threadStore.threadFolders()) {
      // A folder that no longer exists is history, not a project to offer.
      if (!existsSync(folder)) continue;
      await projects.add(folder, { source: 'thread' }).catch(() => undefined);
    }
  }
  const idByFolder = new Map<string, Promise<string>>();
  await threadStore.relinkProjects((cwd) => {
    let id = idByFolder.get(cwd);
    if (!id) {
      id = projects.resolve(cwd).then((project) => project.id);
      idByFolder.set(cwd, id);
    }
    return id;
  });
}
