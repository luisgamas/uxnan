/**
 * Bridge self-update check.
 *
 * The bridge is the ecosystem's core engine, so it should nudge the user to
 * update when a newer build is published. This module queries the npm registry
 * for the latest `uxnan-bridge` version published under the `latest` dist-tag
 * (every release publishes to `latest`; see `.github/workflows/release-npm.yml`),
 * caches the result under `~/.uxnan/update-check.json` (TTL-gated so we never
 * hit the network more than needed), and derives whether the running version is
 * outdated.
 *
 * It is deliberately best-effort and non-blocking: any network/parse failure is
 * swallowed and reported as "unknown" (no update). The daemon refreshes the
 * cache in the background; `bridge/status` and the CLI notice read the derived
 * status. The result is also surfaced to the phone via `BridgeStatus`
 * (`latestVersion` / `updateAvailable`) so it can show an informational hint
 * without querying npm itself.
 *
 * Source: architecture/02a-system-architecture.md §5.8 (bridge status) +
 * shared `BridgeStatus`.
 */
import { isNewerVersion } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from './daemon-state.js';
import { BRIDGE_PACKAGE_NAME, BRIDGE_VERSION } from './version.js';

/** Persisted result of the last successful (or attempted) registry query. */
export interface UpdateCheckCache {
  /** Epoch ms of the last check attempt. */
  checkedAt: number;
  /** Latest version seen under the dist-tag, if the query succeeded. */
  latestVersion?: string;
}

/** Derived update status handed to the status snapshot and the CLI notice. */
export interface UpdateStatus {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
}

/** How long a cached check stays fresh before we re-query (24h). */
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/** Bound the registry request so a slow/hung network never stalls a command. */
const FETCH_TIMEOUT_MS = 4000;

/** dist-tag the bridge is published under (see `.github/workflows/release-npm.yml`). */
const DIST_TAG = 'latest';

type FetchLike = typeof fetch;

export interface UpdateCheckOptions {
  /** Injected clock (epoch ms) for testability. */
  now?: number;
  /** Cache freshness window; defaults to {@link UPDATE_CHECK_TTL_MS}. */
  ttlMs?: number;
  /** Injected fetch (tests); defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Request timeout; defaults to {@link FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Override the running version (tests); defaults to {@link BRIDGE_VERSION}. */
  currentVersion?: string;
  /** Override the package name (tests); defaults to {@link BRIDGE_PACKAGE_NAME}. */
  packageName?: string;
}

/**
 * Query the npm registry's lightweight dist-tags endpoint for the latest
 * version published under {@link DIST_TAG}. Returns `undefined` on any failure
 * (offline, non-200, malformed JSON, timeout) — never throws.
 */
export async function fetchLatestPublishedVersion(
  packageName: string = BRIDGE_PACKAGE_NAME,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const value = (body as Record<string, unknown>)[DIST_TAG];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Pure: build the derived status from a current and (maybe-missing) latest. */
export function computeUpdateStatus(
  currentVersion: string,
  latestVersion: string | undefined,
): UpdateStatus {
  return {
    currentVersion,
    ...(latestVersion !== undefined ? { latestVersion } : {}),
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
  };
}

/** Read the persisted cache, or `null` if none / unreadable. */
export async function readUpdateCache(state: DaemonState): Promise<UpdateCheckCache | null> {
  return state.readJson<UpdateCheckCache>(DAEMON_FILES.updateCheck);
}

/** True when the cache is missing or older than the TTL. */
function isStale(cache: UpdateCheckCache | null, now: number, ttlMs: number): boolean {
  return cache === null || now - cache.checkedAt >= ttlMs;
}

/**
 * Return the update status from the cache **without** touching the network.
 * Used by the frequently-called `bridge/status` heartbeat so it stays cheap.
 */
export async function cachedUpdateStatus(
  state: DaemonState,
  currentVersion: string = BRIDGE_VERSION,
): Promise<UpdateStatus> {
  const cache = await readUpdateCache(state);
  return computeUpdateStatus(currentVersion, cache?.latestVersion);
}

/**
 * Ensure the cache is fresh, querying the registry when it is stale/missing, and
 * return the derived status. Never throws — a failed query keeps (and returns)
 * any previously-cached value. Safe to call from short-lived CLI commands (fast
 * when the cache is fresh; bounded by the fetch timeout otherwise) and from the
 * daemon's background refresh.
 */
export async function ensureUpdateStatus(
  state: DaemonState,
  options: UpdateCheckOptions = {},
): Promise<UpdateStatus> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? UPDATE_CHECK_TTL_MS;
  const currentVersion = options.currentVersion ?? BRIDGE_VERSION;
  const packageName = options.packageName ?? BRIDGE_PACKAGE_NAME;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  const cache = await readUpdateCache(state);
  if (!isStale(cache, now, ttlMs)) {
    return computeUpdateStatus(currentVersion, cache?.latestVersion);
  }

  const latestVersion = await fetchLatestPublishedVersion(packageName, fetchImpl, timeoutMs);
  // On a failed query keep the last known latest (don't clobber it with
  // undefined); still stamp `checkedAt` so we back off until the next TTL.
  const nextLatest = latestVersion ?? cache?.latestVersion;
  try {
    await state.writeJson(DAEMON_FILES.updateCheck, {
      checkedAt: now,
      ...(nextLatest !== undefined ? { latestVersion: nextLatest } : {}),
    } satisfies UpdateCheckCache);
  } catch {
    // Persisting the cache is best-effort; a write failure must not break the
    // caller (or the command it's attached to).
  }
  return computeUpdateStatus(currentVersion, nextLatest);
}

/**
 * A one-line, human-facing notice for the CLI, or `null` when up to date or the
 * latest version is unknown. Printed to stderr by user-facing commands.
 */
export function updateNoticeMessage(status: UpdateStatus): string | null {
  if (!status.updateAvailable || !status.latestVersion) return null;
  return (
    `A newer bridge is available: ${status.latestVersion} ` +
    `(you have ${status.currentVersion}). ` +
    `Update with: npm install -g ${BRIDGE_PACKAGE_NAME}@${DIST_TAG}`
  );
}
