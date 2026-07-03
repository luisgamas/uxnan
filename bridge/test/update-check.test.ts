import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  DaemonState,
  DAEMON_FILES,
  computeUpdateStatus,
  cachedUpdateStatus,
  ensureUpdateStatus,
  fetchLatestPublishedVersion,
  updateNoticeMessage,
  type UpdateCheckCache,
} from '../src/index.js';

function freshState(): DaemonState {
  return new DaemonState(join(tmpdir(), `uxnan-update-test-${randomUUID()}`));
}

/** A `fetch` stand-in that returns the given dist-tags body. */
function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

/** A `fetch` stand-in that rejects (offline). */
const offlineFetch: typeof fetch = (async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;

test('computeUpdateStatus flags a newer latest', () => {
  const s = computeUpdateStatus('0.0.3-alpha.20260702', '0.0.3-alpha.20260805');
  assert.equal(s.updateAvailable, true);
  assert.equal(s.latestVersion, '0.0.3-alpha.20260805');
});

test('computeUpdateStatus is false when up to date or unknown', () => {
  assert.equal(
    computeUpdateStatus('0.0.3-alpha.20260702', '0.0.3-alpha.20260702').updateAvailable,
    false,
  );
  assert.equal(computeUpdateStatus('0.0.3-alpha.20260702', undefined).updateAvailable, false);
});

test('fetchLatestPublishedVersion reads the latest dist-tag', async () => {
  const version = await fetchLatestPublishedVersion(
    'uxnan-bridge',
    fakeFetch({ latest: '0.0.9-alpha.20260901', beta: '0.0.1' }),
  );
  assert.equal(version, '0.0.9-alpha.20260901');
});

test('fetchLatestPublishedVersion returns undefined on a non-200 or bad body', async () => {
  assert.equal(await fetchLatestPublishedVersion('uxnan-bridge', fakeFetch({}, false)), undefined);
  // A body without the `latest` tag yields no version.
  assert.equal(
    await fetchLatestPublishedVersion('uxnan-bridge', fakeFetch({ beta: '1.0.0' })),
    undefined,
  );
  assert.equal(await fetchLatestPublishedVersion('uxnan-bridge', offlineFetch), undefined);
});

test('ensureUpdateStatus fetches when the cache is missing and persists it', async () => {
  const state = freshState();
  const status = await ensureUpdateStatus(state, {
    now: 1_000,
    currentVersion: '0.0.3-alpha.20260702',
    fetchImpl: fakeFetch({ latest: '0.0.3-alpha.20260805' }),
  });
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, '0.0.3-alpha.20260805');
  const cache = await state.readJson<UpdateCheckCache>(DAEMON_FILES.updateCheck);
  assert.equal(cache?.latestVersion, '0.0.3-alpha.20260805');
  assert.equal(cache?.checkedAt, 1_000);
  await rm(state.baseDir, { recursive: true, force: true });
});

test('ensureUpdateStatus serves a fresh cache without hitting the network', async () => {
  const state = freshState();
  await state.writeJson(DAEMON_FILES.updateCheck, {
    checkedAt: 5_000,
    latestVersion: '0.0.3-alpha.20260805',
  } satisfies UpdateCheckCache);
  let called = false;
  const status = await ensureUpdateStatus(state, {
    now: 5_000 + 60_000, // well within the TTL
    currentVersion: '0.0.3-alpha.20260702',
    fetchImpl: (async () => {
      called = true;
      throw new Error('should not be called');
    }) as unknown as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(status.latestVersion, '0.0.3-alpha.20260805');
  await rm(state.baseDir, { recursive: true, force: true });
});

test('ensureUpdateStatus re-checks once the cache is stale', async () => {
  const state = freshState();
  await state.writeJson(DAEMON_FILES.updateCheck, {
    checkedAt: 0,
    latestVersion: '0.0.3-alpha.20260702',
  } satisfies UpdateCheckCache);
  const status = await ensureUpdateStatus(state, {
    now: 25 * 60 * 60 * 1000, // past the 24h TTL
    currentVersion: '0.0.3-alpha.20260702',
    fetchImpl: fakeFetch({ latest: '0.0.4-alpha.20260901' }),
  });
  assert.equal(status.latestVersion, '0.0.4-alpha.20260901');
  assert.equal(status.updateAvailable, true);
  await rm(state.baseDir, { recursive: true, force: true });
});

test('ensureUpdateStatus keeps the last known latest when a re-check fails offline', async () => {
  const state = freshState();
  await state.writeJson(DAEMON_FILES.updateCheck, {
    checkedAt: 0,
    latestVersion: '0.0.4-alpha.20260901',
  } satisfies UpdateCheckCache);
  const status = await ensureUpdateStatus(state, {
    now: 25 * 60 * 60 * 1000,
    currentVersion: '0.0.3-alpha.20260702',
    fetchImpl: offlineFetch,
  });
  // Offline: we keep the previously-cached latest (don't clobber to unknown).
  assert.equal(status.latestVersion, '0.0.4-alpha.20260901');
  assert.equal(status.updateAvailable, true);
  await rm(state.baseDir, { recursive: true, force: true });
});

test('cachedUpdateStatus never touches the network', async () => {
  const state = freshState();
  assert.equal((await cachedUpdateStatus(state, '0.0.3-alpha.20260702')).updateAvailable, false);
  await state.writeJson(DAEMON_FILES.updateCheck, {
    checkedAt: 0,
    latestVersion: '0.0.5-alpha.20261001',
  } satisfies UpdateCheckCache);
  const status = await cachedUpdateStatus(state, '0.0.3-alpha.20260702');
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, '0.0.5-alpha.20261001');
  await rm(state.baseDir, { recursive: true, force: true });
});

test('updateNoticeMessage is null when up to date and set when outdated', () => {
  assert.equal(
    updateNoticeMessage(computeUpdateStatus('0.0.3-alpha.20260702', '0.0.3-alpha.20260702')),
    null,
  );
  const msg = updateNoticeMessage(
    computeUpdateStatus('0.0.3-alpha.20260702', '0.0.4-alpha.20260901'),
  );
  assert.ok(msg);
  assert.match(msg!, /0\.0\.4-alpha\.20260901/);
  assert.match(msg!, /npm install -g/);
});
