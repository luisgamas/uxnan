/**
 * Relay push delivery (architecture/02a §5.10.2–§5.10.4).
 *
 * The bridge registers a device's push token for a session and later asks the
 * relay to deliver a turn-completed notification. Delivery goes through a
 * {@link PushSender} seam so all the routing/auth/dedupe logic is testable with a
 * fake sender — no Firebase/APNs credentials required. The real FCM sender is
 * loaded lazily and only when `UXNAN_FCM_SERVICE_ACCOUNT` is configured; without
 * it the relay still accepts registrations and notify calls but delivery is a
 * no-op (gracefully degraded). See relay/FOR-HUMAN.md for the credential setup.
 */
import { randomBytes } from 'node:crypto';
import type { PushNotifyRequest, PushPlatform } from '@uxnan/shared';
import type { RelayLogger } from './relay-server.js';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Delivers a single notification to one device token. */
export interface PushSender {
  send(token: string, platform: PushPlatform, payload: PushPayload): Promise<void>;
}

/** Default sender used when no push credentials are configured: logs and no-ops. */
export class NoopPushSender implements PushSender {
  readonly #logger: RelayLogger;
  constructor(logger: RelayLogger) {
    this.#logger = logger;
  }
  send(token: string, platform: PushPlatform, payload: PushPayload): Promise<void> {
    this.#logger.info(
      `[push:noop] ${platform} ${token.slice(0, 8)}… "${payload.title}" (no FCM creds — not delivered)`,
    );
    return Promise.resolve();
  }
}

export interface NotifyOutcome {
  delivered: boolean;
  recipients: number;
  reason?: 'unauthorized' | 'duplicate' | 'no-tokens';
}

interface SessionPush {
  secret: string;
  /** token → platform */
  tokens: Map<string, PushPlatform>;
}

export interface PushRegistryOptions {
  sender: PushSender;
  logger: RelayLogger;
  now?: () => number;
  generateSecret?: () => string;
  /** Suppress duplicate (sessionId,turnId) notifications within this window. */
  dedupeTtlMs?: number;
}

export class PushRegistry {
  readonly #sessions = new Map<string, SessionPush>();
  readonly #dedupe = new Map<string, number>();
  readonly #sender: PushSender;
  readonly #logger: RelayLogger;
  readonly #now: () => number;
  readonly #generateSecret: () => string;
  readonly #dedupeTtlMs: number;

  constructor(options: PushRegistryOptions) {
    this.#sender = options.sender;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => Date.now());
    this.#generateSecret = options.generateSecret ?? (() => randomBytes(24).toString('hex'));
    this.#dedupeTtlMs = options.dedupeTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /** Register a device token for a session; returns the session's notify secret. */
  register(
    sessionId: string,
    pushToken: string,
    platform: PushPlatform,
  ): { registered: boolean; notificationSecret: string } {
    const existing = this.#sessions.get(sessionId);
    const secret = existing?.secret ?? this.#generateSecret();
    const tokens = existing?.tokens ?? new Map<string, PushPlatform>();
    tokens.set(pushToken, platform);
    this.#sessions.set(sessionId, { secret, tokens });
    return { registered: true, notificationSecret: secret };
  }

  unregister(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  /** Validate the secret, dedupe by (sessionId,turnId), then fan out to tokens. */
  async notify(req: PushNotifyRequest): Promise<NotifyOutcome> {
    const session = this.#sessions.get(req.sessionId);
    if (!session || session.secret !== req.notificationSecret) {
      return { delivered: false, recipients: 0, reason: 'unauthorized' };
    }
    const key = `${req.sessionId}:${req.turnId}`;
    const last = this.#dedupe.get(key);
    const now = this.#now();
    if (last !== undefined && now - last < this.#dedupeTtlMs) {
      return { delivered: false, recipients: 0, reason: 'duplicate' };
    }
    this.#dedupe.set(key, now);
    if (session.tokens.size === 0) {
      return { delivered: false, recipients: 0, reason: 'no-tokens' };
    }
    let recipients = 0;
    for (const [token, platform] of session.tokens) {
      try {
        await this.#sender.send(token, platform, {
          title: req.title,
          body: req.body,
          data: { threadId: req.threadId, turnId: req.turnId },
        });
        recipients += 1;
      } catch (err) {
        this.#logger.warn(`push delivery failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { delivered: recipients > 0, recipients };
  }
}

/**
 * Build the default sender. With `UXNAN_FCM_SERVICE_ACCOUNT` set, lazily loads
 * `firebase-admin` (an optional dependency) and sends via FCM HTTP v1; otherwise
 * returns a {@link NoopPushSender}. Kept async + dynamic so the relay never hard-
 * depends on firebase-admin.
 */
export async function createDefaultPushSender(logger: RelayLogger): Promise<PushSender> {
  const serviceAccountPath = process.env['UXNAN_FCM_SERVICE_ACCOUNT'];
  if (!serviceAccountPath) {
    logger.info('push: no UXNAN_FCM_SERVICE_ACCOUNT set — delivery disabled (noop sender)');
    return new NoopPushSender(logger);
  }
  try {
    const sender = await loadFcmSender(serviceAccountPath, logger);
    logger.info('push: FCM sender ready');
    return sender;
  } catch (err) {
    logger.warn(
      `push: failed to init FCM (${err instanceof Error ? err.message : err}) — falling back to noop`,
    );
    return new NoopPushSender(logger);
  }
}

async function loadFcmSender(serviceAccountPath: string, logger: RelayLogger): Promise<PushSender> {
  // Dynamic import via a non-literal specifier so the optional `firebase-admin`
  // dependency is not statically resolved at build time (it may not be installed).
  // FOR-HUMAN: install `firebase-admin` + provide the service account (relay/FOR-HUMAN.md).
  const moduleName = 'firebase-admin';
  // firebase-admin is CommonJS: under ESM dynamic import its API lands on the
  // `.default` interop key (the namespace itself only exposes `default`), so
  // reach through it — falling back to the namespace should a bundler ever hoist
  // the named exports. Without this the admin object is undefined and FCM init
  // silently degrades to the noop sender.
  const imported = (await import(moduleName)) as unknown as {
    default?: FirebaseAdminLike;
  } & FirebaseAdminLike;
  const admin = imported.default ?? imported;
  const { readFile } = await import('node:fs/promises');
  const credential = JSON.parse(await readFile(serviceAccountPath, 'utf-8')) as object;
  const app = admin.initializeApp({ credential: admin.credential.cert(credential) }, 'uxnan-relay');
  const messaging = admin.messaging(app);
  return {
    async send(token, _platform, payload): Promise<void> {
      await messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        ...(payload.data ? { data: payload.data } : {}),
      });
      logger.info(`push: delivered "${payload.title}"`);
    },
  };
}

/** Minimal structural type for the parts of firebase-admin we use. */
interface FirebaseAdminLike {
  initializeApp(options: { credential: unknown }, name: string): unknown;
  credential: { cert(serviceAccount: object): unknown };
  messaging(app: unknown): {
    send(message: {
      token: string;
      notification: { title: string; body: string };
      data?: Record<string, string>;
    }): Promise<string>;
  };
}
