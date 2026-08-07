import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { componentOf, previousTagFor } from './notes.mjs';

/** Newest first, the way the CLI sorts them before asking. */
const DESKTOP = [
  'desktop-nightly-v0.0.29-nightly.20260807.1',
  'desktop-stable-v0.0.28',
  'desktop-stable-v0.0.27',
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

  it('works for a stable cut too', () => {
    const tags = ['desktop-stable-v0.0.30', ...DESKTOP];
    assert.equal(
      previousTagFor('desktop-stable-v0.0.30', tags),
      'desktop-nightly-v0.0.29-nightly.20260807.1',
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
