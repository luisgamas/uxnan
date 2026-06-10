/**
 * Bridge-side push coordination (architecture/02a §5.10.2).
 *
 * The phone registers its FCM/APNs token over the live session
 * (`notifications/register`); the bridge forwards it to the relay
 * (`POST /push/register`) and keeps the returned `notificationSecret`. When an
 * agent turn ends and the user has push enabled, the bridge asks the relay to
 * deliver a notification (`POST /push/notify`) — this is what reaches the phone
 * while the app is backgrounded.
 *
 * Everything here is GATED: with no relay push credentials the relay accepts the
 * calls but does not deliver (noop). Without a registered token the bridge simply
 * skips pushing. Delivery end-to-end requires the user's Firebase/APNs setup
 * (relay/FOR-HUMAN.md) + a real device.
 *
 * Persistence: registrations are keyed by `sessionId` and persisted to
 * `~/.uxnan/push-state.json` (atomic write), so background push survives a
 * bridge restart WITHOUT waiting for the phone to reconnect and re-register
 * (the relay still holds its own sessionId→token mapping; the bridge only needs
 * the `sessionId` + `notificationSecret` to call `/push/notify`). Multiple
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
  notificationSecret: string;
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
}

export class PushService {
  readonly #httpBase: string;
  readonly #config: DaemonConfig;
  readonly #logger: Logger;
  readonly #fetch: FetchFn;
  readonly #state: DaemonState | undefined;
  #activeSessionId: string | undefined;
  /** Registrations keyed by relay `sessionId` (one per paired phone). */
  readonly #registrations = new Map<string, Registration>();

  constructor(options: PushServiceOptions) {
    this.#httpBase = toHttpBase(options.relayUrl);
    this.#config = options.config;
    this.#logger = options.logger;
    this.#fetch = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    this.#state = options.state;
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

  /** Handle `notifications/register`: forward the token to the relay, store the secret. */
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
    try {
      const res = await this.#fetch(`${this.#httpBase}/push/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, pushToken, platform }),
      });
      if (!res.ok) {
        this.#logger.warn(`push register rejected by relay (${res.status})`);
        return { registered: false };
      }
      const data = (await res.json()) as { notificationSecret?: string };
      if (!data.notificationSecret) return { registered: false };
      this.#registrations.set(sessionId, {
        sessionId,
        notificationSecret: data.notificationSecret,
        preferences: preferences ?? DEFAULT_PREFERENCES,
      });
      await this.#persist();
      this.#logger.info('push token registered with the relay');
      return { registered: true };
    } catch (err) {
      this.#logger.warn(`push register failed: ${errorMessage(err)}`);
      return { registered: false };
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
    const res = await this.#fetch(`${this.#httpBase}/push/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: reg.sessionId,
        notificationSecret: reg.notificationSecret,
        threadId: info.threadId,
        turnId: info.turnId,
        title,
        body,
      }),
    });
    if (!res.ok) this.#logger.warn(`push notify rejected by relay (${res.status})`);
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
    typeof reg['notificationSecret'] === 'string' &&
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
