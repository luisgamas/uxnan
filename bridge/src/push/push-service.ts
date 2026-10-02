/**
 * Bridge-side push coordination (architecture/02a §5.10.2; FOR-DEV → *Direct FCM
 * from the bridge*).
 *
 * The phone registers its FCM/APNs token over the live session
 * (`notifications/register`). The bridge keeps the token and, when a turn ends
 * with push enabled, delivers a background notification **itself**, straight to
 * FCM through {@link PushSender}. That works on any transport (LAN, Tailscale or
 * the relay), and the token never leaves this machine except toward FCM: the
 * relay carries no push traffic.
 *
 * Everything here is GATED: without a Firebase service account
 * (bridge/FOR-HUMAN.md) background push is a silent no-op (foreground local
 * notifications still work), and without a registered token the bridge simply
 * skips pushing. Validating delivery needs a real device.
 *
 * Persistence: registrations are keyed by `sessionId` and persisted to
 * `~/.uxnan/push-state.json` (atomic write), so background push survives a
 * bridge restart WITHOUT waiting for the phone to reconnect and re-register. The
 * persisted entry carries the device token + platform. Multiple registrations are
 * kept, so several paired phones each receive background push; a turn-end pushes
 * to all of them.
 *
 * Note: `register`/`updatePreferences`/`unregister` act on the *active* session
 * (the one whose request is being served). With the MVP default
 * `maxConcurrentSessions: 1` this is exact; with several concurrent sessions the
 * "active" one is the most recently established — per-request session identity
 * would be needed to disambiguate (FOR-DEV).
 */
import type {
  NotificationPreferences,
  PushPlatform,
  RegisterNotificationsResult,
} from '@uxnan/shared';
import type { DaemonConfig } from '../daemon-config.js';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import type { Logger } from '../logger.js';
import type { PushSender } from './push-sender.js';

export interface TurnEndInfo {
  threadId: string;
  turnId: string;
  status: 'completed' | 'error';
  /** Assistant text (completed) or error message, used to build the body. */
  text?: string;
}

interface Registration {
  sessionId: string;
  /** Trusted-device id that owns this registration (for prune-on-untrust). */
  deviceId?: string;
  /** FCM/APNs device token. */
  pushToken: string;
  /** Device platform, for FCM's per-platform delivery config. */
  platform: PushPlatform;
  preferences: NotificationPreferences;
}

/** Parameters for {@link PushService.register} — identifies the requesting phone. */
export interface RegisterPushParams {
  /** Secure-session id of the phone making the request (its registration key). */
  sessionId: string;
  /** Trusted-device id of that phone, when known (enables prune-on-untrust). */
  deviceId?: string;
  pushToken: string;
  platform: PushPlatform;
  preferences?: NotificationPreferences;
}

/** Shape persisted to `~/.uxnan/push-state.json`. */
interface PersistedPushState {
  version: 1;
  registrations: Registration[];
}

const DEFAULT_PREFERENCES: NotificationPreferences = { turnCompleted: true, turnError: true };

export interface PushServiceOptions {
  config: DaemonConfig;
  logger: Logger;
  /** Daemon state for persisting registrations; omitted in unit tests (no-op). */
  state?: DaemonState;
  /**
   * FCM sender. Present when a Firebase service account is configured (see
   * {@link createBridgePushSender}); `undefined` → no background push. Injected by
   * tests with a fake sender.
   */
  pushSender?: PushSender;
}

export class PushService {
  readonly #config: DaemonConfig;
  readonly #logger: Logger;
  readonly #state: DaemonState | undefined;
  readonly #pushSender: PushSender | undefined;
  #activeSessionId: string | undefined;
  /** Registrations keyed by secure-session `sessionId` (one per paired phone). */
  readonly #registrations = new Map<string, Registration>();

  constructor(options: PushServiceOptions) {
    this.#config = options.config;
    this.#logger = options.logger;
    this.#state = options.state;
    this.#pushSender = options.pushSender;
  }

  /** True when the bridge can deliver push directly via FCM (credential present). */
  get directPushAvailable(): boolean {
    return this.#pushSender !== undefined;
  }

  /**
   * Load persisted registrations from `push-state.json`. Call once at startup so
   * background push keeps working across a bridge restart. Best-effort: a missing
   * or malformed file leaves the service empty.
   */
  async load(): Promise<void> {
    if (!this.#state) return;
    try {
      const persisted = await this.#state.readJson<PersistedPushState>(DAEMON_FILES.pushState);
      const registrations = persisted?.registrations;
      if (!Array.isArray(registrations)) return;
      for (const reg of registrations) {
        if (isRegistration(reg)) this.#registrations.set(reg.sessionId, reg);
      }
      if (this.#registrations.size > 0) {
        this.#logger.info(`loaded ${this.#registrations.size} push registration(s)`);
      }
    } catch (err) {
      this.#logger.warn(`push-state load failed: ${errorMessage(err)}`);
    }
  }

  /** Called when a phone session is established. */
  setActiveSession(sessionId: string): void {
    this.#activeSessionId = sessionId;
  }

  /** Called when a session closes; the registration persists for background push. */
  clearActiveSession(sessionId: string): void {
    if (this.#activeSessionId === sessionId) this.#activeSessionId = undefined;
  }

  get activeSessionId(): string | undefined {
    return this.#activeSessionId;
  }

  /**
   * Handle `notifications/register` for a SPECIFIC phone session. Stores the
   * device token locally — it is never sent anywhere but FCM. Keyed by
   * `sessionId`, so several concurrent phones each get their own registration.
   * `registered` is true when the bridge can actually deliver (an FCM sender is
   * configured).
   */
  async register(params: RegisterPushParams): Promise<RegisterNotificationsResult> {
    const { sessionId, deviceId, pushToken, platform, preferences } = params;
    this.#registrations.set(sessionId, {
      sessionId,
      ...(deviceId !== undefined ? { deviceId } : {}),
      pushToken,
      platform,
      preferences: preferences ?? DEFAULT_PREFERENCES,
    });
    await this.#persist();

    if (this.#pushSender) {
      this.#logger.info('push token registered (direct FCM)');
      return { registered: true };
    }
    this.#logger.warn('push token stored but no delivery path (no FCM credential)');
    return { registered: false };
  }

  /** Update a specific session's notification preferences. */
  updatePreferences(sessionId: string, preferences: NotificationPreferences): void {
    const reg = this.#registrations.get(sessionId);
    if (!reg) return;
    reg.preferences = preferences;
    void this.#persist();
  }

  /** Drop a specific session's registration (its phone asked to stop pushes). */
  unregister(sessionId: string): void {
    if (this.#registrations.delete(sessionId)) void this.#persist();
  }

  /**
   * Drop every registration owned by a trusted device — called when the device is
   * removed via `bridge/removeTrustedDevice`, so a revoked phone stops receiving
   * background push instead of lingering until it re-registers or is overwritten.
   * Returns the number of registrations removed.
   */
  unregisterDevice(deviceId: string): number {
    let removed = 0;
    for (const [sessionId, reg] of this.#registrations) {
      if (reg.deviceId === deviceId) {
        this.#registrations.delete(sessionId);
        removed += 1;
      }
    }
    if (removed > 0) {
      void this.#persist();
      this.#logger.info(`pruned ${removed} push registration(s) for removed device`);
    }
    return removed;
  }

  /** Fire-and-forget: push a turn-ended notification if enabled and registered. */
  onTurnEnd(info: TurnEndInfo): void {
    void this.#maybePush(info).catch((err) =>
      this.#logger.warn(`push notify failed: ${errorMessage(err)}`),
    );
  }

  async #maybePush(info: TurnEndInfo): Promise<void> {
    if (!this.#config.pushEnabled) return;
    if (this.#registrations.size === 0) return;
    const { title, body } = buildNotification(info);
    // Notify every registered phone whose preferences opt into this event.
    await Promise.all(
      [...this.#registrations.values()]
        .filter((reg) => this.#wantsPush(info.status, reg.preferences))
        .map((reg) => this.#notifyOne(reg, info, title, body)),
    );
  }

  #wantsPush(status: TurnEndInfo['status'], prefs: NotificationPreferences): boolean {
    if (status === 'completed') return this.#config.pushOnAgentDone && prefs.turnCompleted;
    return this.#config.pushOnAgentError && prefs.turnError;
  }

  async #notifyOne(
    reg: Registration,
    info: TurnEndInfo,
    title: string,
    body: string,
  ): Promise<void> {
    if (!this.#pushSender) return;
    const data = { threadId: info.threadId, turnId: info.turnId };
    try {
      await this.#pushSender.send(reg.pushToken, reg.platform, { title, body, data });
    } catch (err) {
      this.#logger.warn(`push delivery failed: ${errorMessage(err)}`);
    }
  }

  /** Atomically persist the current registrations (best-effort). */
  async #persist(): Promise<void> {
    if (!this.#state) return;
    try {
      const state: PersistedPushState = {
        version: 1,
        registrations: [...this.#registrations.values()],
      };
      await this.#state.writeJson(DAEMON_FILES.pushState, state);
    } catch (err) {
      this.#logger.warn(`push-state persist failed: ${errorMessage(err)}`);
    }
  }
}

function isRegistration(value: unknown): value is Registration {
  if (!value || typeof value !== 'object') return false;
  const reg = value as Record<string, unknown>;
  return (
    typeof reg['sessionId'] === 'string' &&
    typeof reg['pushToken'] === 'string' &&
    (reg['platform'] === 'ios' || reg['platform'] === 'android') &&
    typeof reg['preferences'] === 'object' &&
    reg['preferences'] !== null
  );
}

function buildNotification(info: TurnEndInfo): { title: string; body: string } {
  if (info.status === 'error') {
    return { title: 'Turn failed', body: truncate(info.text) ?? 'The agent reported an error.' };
  }
  return { title: 'Turn completed', body: truncate(info.text) ?? 'Your agent finished a turn.' };
}

function truncate(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
