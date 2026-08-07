import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { componentOf, previousTagFor } from './notes.mjs';

/** Newest first, the way the CLI sorts them before asking. */
const DESKTOP = [
  'desktop-nightly-v0.0.30-nightly.20260807.2',
  'desktop-nightly-v0.0.29-nightly.20260807.1',
  'desktop-stable-v0.0.28',
  'desktop-nightly-v0.0.22-nightly.20260724.1',
];

describe('previousTagFor', () => {
  it('compares against the last build in ANY channel', () => {
    // The bug this fixes: left alone, GitHub compared the 0.0.29 nightly against
    // the previous *nightly* (0.0.22) and re-listed 9 pull requests that had
    // already shipped in 0.0.23 through 0.0.28.
    assert.equal(
      previousTagFor('desktop-nightly-v0.0.29-nightly.20260807.1', DESKTOP),
      'desktop-stable-v0.0.28',
    );
  });

  it('picks the build immediately below, across channels', () => {
    // The bug: `desktop-stable-v0.0.28` sorts AFTER `desktop-nightly-v0.0.30`
    // alphabetically, so a string sort made 0.0.30 compare against 0.0.28 and
    // re-list everything 0.0.29 had already shipped.
    assert.equal(
      previousTagFor('desktop-nightly-v0.0.30-nightly.20260807.2', DESKTOP),
      'desktop-nightly-v0.0.29-nightly.20260807.1',
    );
  });

  it('separates two nightlies cut on the same day', () => {
    const tags = [
      'desktop-nightly-v0.0.30-nightly.20260807.2',
      'desktop-nightly-v0.0.29-nightly.20260807.1',
    ];
    assert.equal(
      previousTagFor('desktop-nightly-v0.0.30-nightly.20260807.2', tags),
      'desktop-nightly-v0.0.29-nightly.20260807.1',
    );
  });

  it('ignores anything above the tag being released', () => {
    // Cutting an older tag late must reach DOWN to 0.0.22, never up to 0.0.28+.
    assert.equal(
      previousTagFor('desktop-stable-v0.0.27', DESKTOP),
      'desktop-nightly-v0.0.22-nightly.20260724.1',
    );
  });

  it('works for a stable cut too', () => {
    const tags = ['desktop-stable-v0.0.31', ...DESKTOP];
    assert.equal(
      previousTagFor('desktop-stable-v0.0.31', tags),
      'desktop-nightly-v0.0.30-nightly.20260807.2',
    );
  });

  it('returns null for the first release a component ever cuts', () => {
    assert.equal(
      previousTagFor('relay-v0.0.1-alpha.20260627', ['relay-v0.0.1-alpha.20260627']),
      null,
    );
    assert.equal(previousTagFor('relay-v0.0.1-alpha.20260627', []), null);
  });
});

describe('componentOf', () => {
  it('recognises every tag scheme in use', () => {
    assert.equal(componentOf('shared-v0.0.13-alpha.20260804'), 'shared');
    assert.equal(componentOf('bridge-v0.0.18-alpha.20260805'), 'bridge');
    assert.equal(componentOf('relay-v0.0.2-alpha.20260720'), 'relay');
    assert.equal(componentOf('mobile-v0.0.18-alpha.20260805+20260805'), 'mobile');
    assert.equal(componentOf('desktop-stable-v0.0.28'), 'desktop');
    assert.equal(componentOf('desktop-nightly-v0.0.22-nightly.20260724.1'), 'desktop');
  });

  it('does not guess at something that is not a release tag', () => {
    assert.equal(componentOf('v1.0.0'), null);
    assert.equal(componentOf('desktop-updater-stable'), null);
  });
});
