/**
 * Bridge-side push coordination (architecture/02a §5.10.2; FOR-DEV → *Direct FCM
 * from the bridge*).
 *
 * The phone registers its FCM/APNs token over the live session
 * (`notifications/register`). The bridge keeps the real token and, when a turn
 * ends with push enabled, delivers a background notification via two paths, in
 * priority order:
 *
 *   1. **Direct FCM (PRIMARY)** — when a Firebase service account is present the
 *      bridge sends straight to FCM via {@link PushSender}. Works on ANY transport
 *      (direct LAN, Tailscale, or relay) — no hosted relay required.
 *   2. **Relay fallback** — with no local credential (or the relay explicitly
 *      enabled), the bridge forwards the token to the relay (`POST /push/register`),
 *      keeps the returned `notificationSecret`, and asks the relay to deliver
 *      (`POST /push/notify`). For setups that keep the credential on a hosted relay.
 *
 * Everything here is GATED: with neither a direct FCM sender nor a reachable relay,
 * background push is a silent no-op (foreground local notifications still work).
 * Without a registered token the bridge simply skips pushing. Direct delivery needs
 * the user's Firebase service account (bridge/FOR-HUMAN.md); the relay path needs it
 * on the relay (relay/FOR-HUMAN.md) — plus a real device to validate either.
 *
 * Persistence: registrations are keyed by `sessionId` and persisted to
 * `~/.uxnan/push-state.json` (atomic write), so background push survives a
 * bridge restart WITHOUT waiting for the phone to reconnect and re-register. The
 * persisted entry carries the device token + platform (for the direct path) and,
 * when used, the relay `notificationSecret` (for the fallback). Multiple
 * registrations are kept, so several paired phones each receive background push;
 * a turn-end pushes to all of them.
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

type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Registration {
  sessionId: string;
  /** FCM/APNs device token — used by the direct bridge→FCM path. */
  pushToken?: string;
  /** Device platform, for the direct path's per-platform delivery config. */
  platform?: PushPlatform;
  /** Relay notify secret — present only when the relay-fallback path is used. */
  notificationSecret?: string;
  preferences: NotificationPreferences;
}

/** Shape persisted to `~/.uxnan/push-state.json`. */
interface PersistedPushState {
  version: 1;
  registrations: Registration[];
}

const DEFAULT_PREFERENCES: NotificationPreferences = { turnCompleted: true, turnError: true };

export interface PushServiceOptions {
  relayUrl: string;
  config: DaemonConfig;
  logger: Logger;
  fetchFn?: FetchFn;
  /** Daemon state for persisting registrations; omitted in unit tests (no-op). */
  state?: DaemonState;
  /**
   * Direct FCM sender (PRIMARY push path). Present when a Firebase service account
   * is configured (see {@link createBridgePushSender}); `undefined` → the bridge
   * uses the relay fallback only. Injected by tests with a fake sender.
   */
  pushSender?: PushSender;
}

export class PushService {
  readonly #httpBase: string;
  readonly #config: DaemonConfig;
  readonly #logger: Logger;
  readonly #fetch: FetchFn;
  readonly #state: DaemonState | undefined;
  readonly #pushSender: PushSender | undefined;
  #activeSessionId: string | undefined;
  /** Registrations keyed by relay `sessionId` (one per paired phone). */
  readonly #registrations = new Map<string, Registration>();

  constructor(options: PushServiceOptions) {
    this.#httpBase = toHttpBase(options.relayUrl);
    this.#config = options.config;
    this.#logger = options.logger;
    this.#fetch = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
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
   * Handle `notifications/register`. Always stores the real device token locally
   * (the direct FCM path needs it); additionally registers with the relay when the
   * relay is enabled OR there is no direct sender, keeping the returned secret for
   * the fallback path. `registered` is true when at least one delivery path exists.
   */
  async register(
    pushToken: string,
    platform: PushPlatform,
    preferences?: NotificationPreferences,
  ): Promise<RegisterNotificationsResult> {
    const sessionId = this.#activeSessionId;
    if (!sessionId) {
      this.#logger.warn('push register without an active session — ignored');
      return { registered: false };
    }
    const reg: Registration = {
      sessionId,
      pushToken,
      platform,
      preferences: preferences ?? DEFAULT_PREFERENCES,
    };
    // Register with the relay only when it's the wanted/only path: the user enabled
    // it, or there is no direct FCM sender to deliver. Best-effort — a relay that is
    // down does not fail registration when direct FCM can still deliver.
    if (this.#config.relayEnabled || !this.#pushSender) {
      const secret = await this.#registerWithRelay(sessionId, pushToken, platform);
      if (secret) reg.notificationSecret = secret;
    }
    this.#registrations.set(sessionId, reg);
    await this.#persist();

    const direct = this.#pushSender !== undefined;
    const viaRelay = reg.notificationSecret !== undefined;
    if (direct || viaRelay) {
      this.#logger.info(`push token registered (${direct ? 'direct FCM' : 'relay'})`);
      return { registered: true };
    }
    this.#logger.warn('push token stored but no delivery path (no FCM creds, relay unavailable)');
    return { registered: false };
  }

  /** Forward a token to the relay; returns the notify secret, or undefined on failure. */
  async #registerWithRelay(
    sessionId: string,
    pushToken: string,
    platform: PushPlatform,
  ): Promise<string | undefined> {
    try {
      const res = await this.#fetch(`${this.#httpBase}/push/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, pushToken, platform }),
      });
      if (!res.ok) {
        this.#logger.warn(`push register rejected by relay (${res.status})`);
        return undefined;
      }
      const data = (await res.json()) as { notificationSecret?: string };
      return data.notificationSecret ?? undefined;
    } catch (err) {
      this.#logger.warn(`push relay register failed: ${errorMessage(err)}`);
      return undefined;
    }
  }

  updatePreferences(preferences: NotificationPreferences): void {
    const reg = this.#activeSessionId ? this.#registrations.get(this.#activeSessionId) : undefined;
    if (!reg) return;
    reg.preferences = preferences;
    void this.#persist();
  }

  unregister(): void {
    if (!this.#activeSessionId) return;
    if (this.#registrations.delete(this.#activeSessionId)) void this.#persist();
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
    const data = { threadId: info.threadId, turnId: info.turnId };
    // PRIMARY: deliver straight to FCM when a sender + token are available. Works
    // on any transport; on failure we log rather than retry via the relay (the
    // direct path has no dedupe, so a fallback could double-deliver).
    if (this.#pushSender && reg.pushToken && reg.platform) {
      try {
        await this.#pushSender.send(reg.pushToken, reg.platform, { title, body, data });
      } catch (err) {
        this.#logger.warn(`direct push delivery failed: ${errorMessage(err)}`);
      }
      return;
    }
    // FALLBACK: ask the relay to deliver (it holds the token + dedupes by turn).
    if (reg.notificationSecret) {
      const res = await this.#fetch(`${this.#httpBase}/push/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: reg.sessionId,
          notificationSecret: reg.notificationSecret,
          ...data,
          title,
          body,
        }),
      });
      if (!res.ok) this.#logger.warn(`push notify rejected by relay (${res.status})`);
      return;
    }
    this.#logger.warn(`push skipped for ${reg.sessionId}: no delivery path`);
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
  // A usable registration needs at least one delivery path: a device token (direct
  // FCM) or a relay secret (fallback). Older persisted entries had only the secret.
  const hasPath =
    typeof reg['pushToken'] === 'string' || typeof reg['notificationSecret'] === 'string';
  return (
    typeof reg['sessionId'] === 'string' &&
    hasPath &&
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

/** Convert a relay ws(s):// URL into its http(s):// origin for the REST endpoints. */
function toHttpBase(relayUrl: string): string {
  try {
    const url = new URL(relayUrl);
    const protocol =
      url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    return `${protocol}//${url.host}`;
  } catch {
    return relayUrl.replace(/^ws/, 'http').replace(/\/$/, '');
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
