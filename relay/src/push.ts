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
 *
 * Persistence (architecture/02a §5.10.5): when constructed with a `statePath`,
 * the per-session token map AND the `(sessionId,turnId)` dedupe window are
 * persisted to a single JSON file (atomic temp+rename, matching the bridge's
 * `~/.uxnan/push-state.json` discipline). On restart, the registry rehydrates
 * from disk so background push keeps working across a relay restart WITHOUT the
 * phone re-registering — a self-hosted relay's most important hardening gap for
 * the bridge-first model. Missing/corrupt files leave the registry empty
 * (best-effort); persistence failures are logged and never fail the request.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PushNotifyRequest, PushPlatform } from '@uxnan/shared';
import type { RelayLogger } from './relay-server.js';
import { constantTimeEqual } from './constant-time.js';

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
  sessionId: string;
  secret: string;
  /** token → platform */
  tokens: Map<string, PushPlatform>;
}

/** On-disk shape of the relay's push state (architecture §5.10.5). */
export interface PersistedRelayState {
  version: 1;
  sessions: PersistedSession[];
  /** `key = "${sessionId}:${turnId}"` → epoch-ms timestamp of the last delivery. */
  dedupe: Record<string, number>;
}

export interface PersistedSession {
  sessionId: string;
  secret: string;
  /** token → 'android' | 'ios' */
  tokens: Record<string, PushPlatform>;
}

/** Hard cap on dedupe entries (architecture §5.10.5). Oldest evicted on overflow. */
const MAX_DEDUPE_KEYS = 10_000;
/** Default TTL for a dedupe entry (architecture §5.10.5). */
const DEFAULT_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PushRegistryOptions {
  sender: PushSender;
  logger: RelayLogger;
  now?: () => number;
  generateSecret?: () => string;
  /** Suppress duplicate (sessionId,turnId) notifications within this window. */
  dedupeTtlMs?: number;
  /**
   * Absolute path to persist the token map + dedupe window (e.g.
   * `~/.uxnan/relay-state.json`). When set, registrations and dedupe survive a
   * relay restart so background push keeps working without the phone
   * re-registering. Omit for an in-memory-only registry (tests).
   */
  statePath?: string;
}

export class PushRegistry {
  readonly #sessions = new Map<string, SessionPush>();
  readonly #dedupe = new Map<string, number>();
  readonly #sender: PushSender;
  readonly #logger: RelayLogger;
  readonly #now: () => number;
  readonly #generateSecret: () => string;
  readonly #dedupeTtlMs: number;
  readonly #statePath: string | undefined;
  /**
   * Serialized persist queue — each scheduled write runs after the previous
   * completes, so concurrent register/unregister/notify ops never race on the
   * atomic rename. Tests + graceful shutdown use {@link flush} to wait for
   * the chain to drain.
   */
  #persistChain: Promise<void> = Promise.resolve();

  constructor(options: PushRegistryOptions) {
    this.#sender = options.sender;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => Date.now());
    this.#generateSecret = options.generateSecret ?? (() => randomBytes(24).toString('hex'));
    this.#dedupeTtlMs = options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
    this.#statePath = options.statePath;
  }

  /**
   * Load persisted sessions + dedupe from disk. Best-effort: a missing or
   * malformed file leaves the registry empty. Stale dedupe entries (older than
   * the TTL) are evicted at load time so the file shrinks over restarts.
   * Returns the number of sessions + dedupe keys loaded.
   */
  async load(): Promise<{ sessions: number; dedupeKeys: number }> {
    if (!this.#statePath) return { sessions: 0, dedupeKeys: 0 };
    const persisted = await this.#readState();
    if (!persisted) return { sessions: 0, dedupeKeys: 0 };
    const now = this.#now();
    let dedupeKeys = 0;
    for (const [key, ts] of Object.entries(persisted.dedupe ?? {})) {
      if (typeof ts === 'number' && now - ts < this.#dedupeTtlMs) {
        this.#dedupe.set(key, ts);
        dedupeKeys += 1;
      }
    }
    let sessions = 0;
    for (const entry of persisted.sessions ?? []) {
      if (isPersistedSession(entry)) {
        this.#sessions.set(entry.sessionId, {
          sessionId: entry.sessionId,
          secret: entry.secret,
          tokens: new Map(Object.entries(entry.tokens) as [string, PushPlatform][]),
        });
        sessions += 1;
      }
    }
    if (sessions > 0 || dedupeKeys > 0) {
      this.#logger.info(`loaded push state: ${sessions} session(s), ${dedupeKeys} dedupe key(s)`);
    }
    return { sessions, dedupeKeys };
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
    this.#sessions.set(sessionId, { sessionId, secret, tokens });
    this.#schedulePersist();
    return { registered: true, notificationSecret: secret };
  }

  unregister(sessionId: string): void {
    if (this.#sessions.delete(sessionId)) this.#schedulePersist();
  }

  /** Validate the secret, dedupe by (sessionId,turnId), then fan out to tokens. */
  async notify(req: PushNotifyRequest): Promise<NotifyOutcome> {
    const session = this.#sessions.get(req.sessionId);
    if (
      !session ||
      typeof req.notificationSecret !== 'string' ||
      !constantTimeEqual(session.secret, req.notificationSecret)
    ) {
      return { delivered: false, recipients: 0, reason: 'unauthorized' };
    }
    const key = `${req.sessionId}:${req.turnId}`;
    const last = this.#dedupe.get(key);
    const now = this.#now();
    if (last !== undefined && now - last < this.#dedupeTtlMs) {
      return { delivered: false, recipients: 0, reason: 'duplicate' };
    }
    this.#dedupe.set(key, now);
    // Bound memory: evict expired + enforce the cap (spec §5.10.5) on every
    // insertion so a busy relay never grows unbounded in memory.
    this.#pruneDedupe(now);
    if (session.tokens.size === 0) {
      this.#schedulePersist();
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
    this.#schedulePersist();
    return { delivered: recipients > 0, recipients };
  }

  /** Drop dedupe entries older than the TTL (called on load + before each write). */
  #pruneDedupe(now: number): void {
    for (const [key, ts] of this.#dedupe) {
      if (now - ts >= this.#dedupeTtlMs) this.#dedupe.delete(key);
    }
    // Cap on dedupe keys (spec §5.10.5): evict the oldest entries first.
    if (this.#dedupe.size > MAX_DEDUPE_KEYS) {
      const overflow = this.#dedupe.size - MAX_DEDUPE_KEYS;
      const byAge = [...this.#dedupe.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < overflow; i += 1) {
        const entry = byAge[i];
        if (entry) this.#dedupe.delete(entry[0]);
      }
    }
  }

  /**
   * Serialize a persist onto the chain — many register/unregister/notify ops
   * share a single in-flight write each. The atomic temp+rename inside
   * {@link #persist} guarantees a torn write is never observable.
   */
  #schedulePersist(): void {
    if (!this.#statePath) return;
    this.#persistChain = this.#persistChain.then(() => this.#persist());
  }

  /** Wait for any pending persist writes to complete (tests + shutdown). */
  async flush(): Promise<void> {
    await this.#persistChain;
  }

  /** Atomically write the current state to disk. Best-effort — never throws. */
  async #persist(): Promise<void> {
    if (!this.#statePath) return;
    const now = this.#now();
    this.#pruneDedupe(now);
    const data: PersistedRelayState = {
      version: 1,
      sessions: [...this.#sessions.values()].map((s) => ({
        sessionId: s.sessionId,
        secret: s.secret,
        tokens: Object.fromEntries(s.tokens),
      })),
      dedupe: Object.fromEntries(this.#dedupe),
    };
    try {
      await mkdir(dirname(this.#statePath), { recursive: true });
      const tmp = `${this.#statePath}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await rename(tmp, this.#statePath);
    } catch (err) {
      this.#logger.warn(`push state persist failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Read + tolerate a missing/corrupt state file. */
  async #readState(): Promise<PersistedRelayState | undefined> {
    if (!this.#statePath) return undefined;
    try {
      const raw = await readFile(this.#statePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return undefined;
      const obj = parsed as Record<string, unknown>;
      if (obj['version'] !== 1) return undefined;
      return parsed as PersistedRelayState;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.#logger.warn(`push state load failed: ${err instanceof Error ? err.message : err}`);
      }
      return undefined;
    }
  }

  /** Live dedupe size (test seam — the cap is enforced in memory on every write). */
  get dedupeSize(): number {
    return this.#dedupe.size;
  }

  /** Number of registered sessions (test seam). */
  get sessionCount(): number {
    return this.#sessions.size;
  }
}

/** Validate a persisted session entry's shape (tolerant — drops malformed rows). */
function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v['sessionId'] !== 'string' || v['sessionId'].length === 0) return false;
  if (typeof v['secret'] !== 'string' || v['secret'].length === 0) return false;
  if (!v['tokens'] || typeof v['tokens'] !== 'object') return false;
  return true;
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
