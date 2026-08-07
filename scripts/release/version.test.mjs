import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertMovesForward, baseOf, dateStamp, highestBase, nextVersion } from './version.mjs';

/** The real tag history, so the rules are pinned against what actually shipped. */
const NPM_TAGS = [
  'shared-v0.0.13-alpha.20260804',
  'shared-v0.0.12-alpha.20260803',
  'shared-v0.0.11-alpha.20260729',
];
const DESKTOP_TAGS = [
  'desktop-stable-v0.0.28',
  'desktop-stable-v0.0.23',
  'desktop-nightly-v0.0.22-nightly.20260724.1',
  'desktop-v0.0.9-alpha.20260711',
];
const MOBILE_TAGS = [
  'mobile-v0.0.18-alpha.20260805+20260805',
  'mobile-v0.0.17-alpha.20260804+20260804',
];

const AUG_6 = new Date('2026-08-06T09:00:00Z');

describe('dateStamp', () => {
  it('is the UTC date, zero-padded', () => {
    assert.equal(dateStamp(new Date('2026-08-06T23:59:59Z')), '20260806');
    assert.equal(dateStamp(new Date('2026-01-02T00:00:00Z')), '20260102');
  });

  it('does not drift with the local timezone', () => {
    // 23:30 UTC is already "tomorrow" in +02:00 — the stamp must stay UTC, or
    // two machines cutting the same release disagree on the version.
    assert.equal(dateStamp(new Date('2026-08-06T23:30:00Z')), '20260806');
  });
});

describe('baseOf / highestBase', () => {
  it('reads the numeric base out of every tag shape this repo has used', () => {
    assert.deepEqual(baseOf('shared-v0.0.13-alpha.20260804'), { major: 0, minor: 0, patch: 13 });
    assert.deepEqual(baseOf('desktop-nightly-v0.0.22-nightly.20260724.1'), {
      major: 0,
      minor: 0,
      patch: 22,
    });
    assert.deepEqual(baseOf('mobile-v0.0.18-alpha.20260805+20260805'), {
      major: 0,
      minor: 0,
      patch: 18,
    });
    assert.equal(baseOf('not-a-version'), null);
  });

  it('takes the highest across channels, not the newest tag', () => {
    // The nightly line sits below the stable one here; picking "most recent"
    // instead of "highest" would reuse a base the MSI has already seen.
    assert.deepEqual(highestBase(DESKTOP_TAGS), { major: 0, minor: 0, patch: 28 });
  });

  it('is null when nothing has shipped', () => {
    assert.equal(highestBase([]), null);
  });
});

describe('nextVersion — npm', () => {
  it('bumps the patch and stamps today', () => {
    assert.equal(
      nextVersion({ kind: 'npm', tags: NPM_TAGS, date: AUG_6 }).version,
      '0.0.14-alpha.20260806',
    );
  });

  it('starts at 0.0.1 for a component that has never shipped', () => {
    assert.equal(
      nextVersion({ kind: 'npm', tags: [], date: AUG_6 }).version,
      '0.0.1-alpha.20260806',
    );
  });
});

describe('nextVersion — mobile', () => {
  it('carries a build number Play will accept', () => {
    assert.equal(
      nextVersion({ kind: 'mobile', tags: MOBILE_TAGS, date: AUG_6 }).version,
      '0.0.19-alpha.20260806+20260806',
    );
  });

  it('steps past a build number already used the same day', () => {
    // Two releases in one day would otherwise repeat the integer, and Play
    // rejects a versionCode it has already seen.
    const tags = ['mobile-v0.0.19-alpha.20260806+20260806', ...MOBILE_TAGS];
    assert.equal(
      nextVersion({ kind: 'mobile', tags, date: AUG_6 }).version,
      '0.0.20-alpha.20260806+20260807',
    );
  });
});

describe('nextVersion — desktop', () => {
  it('cuts a stable above every channel', () => {
    assert.equal(
      nextVersion({ kind: 'desktop', tags: DESKTOP_TAGS, channel: 'stable', date: AUG_6 }).version,
      '0.0.29',
    );
  });

  it('cuts a nightly on a fresh base', () => {
    assert.equal(
      nextVersion({ kind: 'desktop', tags: DESKTOP_TAGS, channel: 'nightly', date: AUG_6 }).version,
      '0.0.29-nightly.20260806.1',
    );
  });

  it('increments N for a second nightly the same day', () => {
    const tags = ['desktop-nightly-v0.0.29-nightly.20260806.1', ...DESKTOP_TAGS];
    assert.equal(
      nextVersion({ kind: 'desktop', tags, channel: 'nightly', date: AUG_6 }).version,
      '0.0.30-nightly.20260806.2',
    );
  });
});

describe('assertMovesForward', () => {
  it('accepts a base above everything shipped', () => {
    assert.doesNotThrow(() => assertMovesForward({ version: '0.0.29', tags: DESKTOP_TAGS }));
  });

  it('refuses a base that has already shipped in either channel', () => {
    // The failure mode this prevents is silent: the MSI and the updater compare
    // only the numeric base, so a reused one makes the build invisible.
    assert.throws(
      () => assertMovesForward({ version: '0.0.28-nightly.20260806.1', tags: DESKTOP_TAGS }),
      /does not move past 0\.0\.28/,
    );
    assert.throws(
      () => assertMovesForward({ version: '0.0.22', tags: DESKTOP_TAGS }),
      /already shipped/,
    );
  });

  it('accepts anything when nothing has shipped yet', () => {
    assert.doesNotThrow(() => assertMovesForward({ version: '0.0.1', tags: [] }));
  });
});
