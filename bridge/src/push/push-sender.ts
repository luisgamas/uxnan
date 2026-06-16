/**
 * Bridge-side direct push delivery (FOR-DEV → *Direct FCM from the bridge*).
 *
 * Background push is sent **by the bridge itself** so it works on ANY transport —
 * direct LAN, Tailscale, or relay — not only when a hosted relay is in the loop.
 * Delivery goes through a {@link PushSender} seam so {@link PushService} can be
 * unit-tested with a fake sender (no Firebase credentials required).
 *
 * The real FCM sender is loaded lazily and only when a Firebase service account is
 * available (`UXNAN_FCM_SERVICE_ACCOUNT`, falling back to the documented
 * `~/.uxnan/firebase-service-account.json`); without it the factory returns
 * `null` and the bridge degrades to the relay fallback — or, with neither, a
 * silent no-op (foreground local notifications still work, relay-free).
 *
 * Same trust model as the relay owning the credential today: a local, gitignored
 * JSON the user provides (see bridge/FOR-HUMAN.md). Push payloads stay minimal —
 * title + short body + thread/turn ids — no conversation plaintext beyond the
 * already-truncated turn summary the relay path also carries.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { PushPlatform } from '@uxnan/shared';
import type { Logger } from '../logger.js';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Delivers a single notification to one device token. */
export interface PushSender {
  send(token: string, platform: PushPlatform, payload: PushPayload): Promise<void>;
}

/** Documented default location for the Firebase service account (bridge/FOR-HUMAN.md). */
export function defaultServiceAccountPath(): string {
  return join(homedir(), '.uxnan', 'firebase-service-account.json');
}

/**
 * Resolve the Firebase service-account path: the explicit `UXNAN_FCM_SERVICE_ACCOUNT`
 * env var first, then the documented `~/.uxnan/firebase-service-account.json`. The
 * default keeps the bridge plug-and-play — drop the JSON in place and push works
 * without setting an env var.
 */
function resolveServiceAccountPath(): string {
  const fromEnv = process.env['UXNAN_FCM_SERVICE_ACCOUNT'];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : defaultServiceAccountPath();
}

/**
 * Build the bridge's direct FCM sender. Returns a {@link PushSender} when a
 * Firebase service account is present and `firebase-admin` loads; returns `null`
 * (no direct path) when the credential is missing or init fails — the caller then
 * falls back to the relay. Kept async + dynamic so the bridge never hard-depends
 * on `firebase-admin`.
 */
export async function createBridgePushSender(logger: Logger): Promise<PushSender | null> {
  const serviceAccountPath = resolveServiceAccountPath();
  let credentialRaw: string;
  try {
    credentialRaw = await readFile(serviceAccountPath, 'utf-8');
  } catch {
    logger.info(
      `push: no Firebase service account at ${serviceAccountPath} — direct FCM disabled (relay fallback only)`,
    );
    return null;
  }
  try {
    const sender = await loadFcmSender(credentialRaw, logger);
    logger.info('push: direct FCM sender ready');
    return sender;
  } catch (err) {
    logger.warn(
      `push: failed to init direct FCM (${errorMessage(err)}) — falling back to relay/noop`,
    );
    return null;
  }
}

async function loadFcmSender(credentialRaw: string, logger: Logger): Promise<PushSender> {
  // Dynamic import via a non-literal specifier so the optional `firebase-admin`
  // dependency is not statically resolved at build time (it may not be installed).
  // FOR-HUMAN: install `firebase-admin` + provide the service account.
  const moduleName = 'firebase-admin';
  // firebase-admin is CommonJS: under ESM dynamic import its API lands on the
  // `.default` interop key, so reach through it (falling back to the namespace
  // should a bundler ever hoist the named exports). Without this the admin object
  // is undefined and FCM init silently degrades.
  const imported = (await import(moduleName)) as unknown as {
    default?: FirebaseAdminLike;
  } & FirebaseAdminLike;
  const admin = imported.default ?? imported;
  const credential = JSON.parse(credentialRaw) as object;
  // Named app so this never collides with any other firebase-admin init in-process.
  const app = admin.initializeApp(
    { credential: admin.credential.cert(credential) },
    'uxnan-bridge',
  );
  const messaging = admin.messaging(app);
  return {
    async send(token, platform, payload): Promise<void> {
      await messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        ...(payload.data ? { data: payload.data } : {}),
        // High priority so the phone wakes promptly while backgrounded.
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      });
      logger.info(`push: delivered "${payload.title}" via direct FCM (${platform})`);
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
      android?: { priority: 'normal' | 'high' };
      apns?: { headers: Record<string, string> };
    }): Promise<string>;
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
