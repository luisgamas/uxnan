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
 * MVP scope: tracks one active session (config default `maxConcurrentSessions: 1`)
 * and an in-memory registration. FOR-DEV: persist the registration to
 * `~/.uxnan/push-state.json` and support multiple sessions.
 */
import type {
  NotificationPreferences,
  PushPlatform,
  RegisterNotificationsResult,
} from '@uxnan/shared';
import type { DaemonConfig } from '../daemon-config.js';
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

const DEFAULT_PREFERENCES: NotificationPreferences = { turnCompleted: true, turnError: true };

export interface PushServiceOptions {
  relayUrl: string;
  config: DaemonConfig;
  logger: Logger;
  fetchFn?: FetchFn;
}

export class PushService {
  readonly #httpBase: string;
  readonly #config: DaemonConfig;
  readonly #logger: Logger;
  readonly #fetch: FetchFn;
  #activeSessionId: string | undefined;
  #registration: Registration | undefined;

  constructor(options: PushServiceOptions) {
    this.#httpBase = toHttpBase(options.relayUrl);
    this.#config = options.config;
    this.#logger = options.logger;
    this.#fetch = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
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
      this.#registration = {
        sessionId,
        notificationSecret: data.notificationSecret,
        preferences: preferences ?? DEFAULT_PREFERENCES,
      };
      this.#logger.info('push token registered with the relay');
      return { registered: true };
    } catch (err) {
      this.#logger.warn(`push register failed: ${errorMessage(err)}`);
      return { registered: false };
    }
  }

  updatePreferences(preferences: NotificationPreferences): void {
    if (this.#registration) this.#registration.preferences = preferences;
  }

  unregister(): void {
    this.#registration = undefined;
  }

  /** Fire-and-forget: push a turn-ended notification if enabled and registered. */
  onTurnEnd(info: TurnEndInfo): void {
    void this.#maybePush(info).catch((err) =>
      this.#logger.warn(`push notify failed: ${errorMessage(err)}`),
    );
  }

  async #maybePush(info: TurnEndInfo): Promise<void> {
    if (!this.#config.pushEnabled) return;
    const reg = this.#registration;
    if (!reg) return;
    if (
      info.status === 'completed' &&
      !(this.#config.pushOnAgentDone && reg.preferences.turnCompleted)
    ) {
      return;
    }
    if (info.status === 'error' && !(this.#config.pushOnAgentError && reg.preferences.turnError)) {
      return;
    }
    const { title, body } = buildNotification(info);
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
