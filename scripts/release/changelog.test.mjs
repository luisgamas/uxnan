import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convertHeading, convertsHeading, unreleasedBody } from './changelog.mjs';

const CHANGELOG = [
  '# Changelog — uxnan-bridge',
  '',
  'Format: [Keep a Changelog](https://keepachangelog.com/).',
  '',
  '## [Unreleased]',
  '',
  '### Fixed — a tool step could be announced out of order',
  '',
  'Prose about the fix.',
  '',
  '## [0.0.20-alpha.20260812] - 2026-08-12',
  '',
  '### Added — something older',
  '',
].join('\n');

describe('convertsHeading', () => {
  it('converts for npm packages, mobile and a desktop stable', () => {
    assert.equal(convertsHeading({ kind: 'npm', channel: 'stable' }), true);
    assert.equal(convertsHeading({ kind: 'mobile', channel: 'stable' }), true);
    assert.equal(convertsHeading({ kind: 'desktop', channel: 'stable' }), true);
  });

  it('never converts for a desktop nightly', () => {
    // A run of nightlies piles under [Unreleased] on purpose; the next stable
    // absorbs the lot. Converting each one would shred the notes.
    assert.equal(convertsHeading({ kind: 'desktop', channel: 'nightly' }), false);
  });
});

describe('convertHeading', () => {
  it('renames the heading and opens a fresh empty one above it', () => {
    const { markdown, converted } = convertHeading(CHANGELOG, {
      version: '0.0.21-alpha.20260812',
      date: '2026-08-12',
    });

    assert.equal(converted, true);
    const lines = markdown.split('\n');
    const unreleased = lines.indexOf('## [Unreleased]');
    const cut = lines.indexOf('## [0.0.21-alpha.20260812] - 2026-08-12');
    assert.ok(unreleased !== -1, 'a fresh [Unreleased] stays at the top');
    assert.ok(cut > unreleased, 'and the version sits under it');
    // The entries that were under [Unreleased] belong to the version now.
    assert.ok(markdown.indexOf('### Fixed — a tool step') > cut);
    // Older releases are untouched.
    assert.ok(markdown.includes('## [0.0.20-alpha.20260812] - 2026-08-12'));
  });

  it('does not stamp the same version twice', () => {
    const once = convertHeading(CHANGELOG, { version: '0.0.21', date: '2026-08-12' });
    const twice = convertHeading(once.markdown, { version: '0.0.21', date: '2026-08-13' });

    assert.equal(twice.converted, false);
    assert.match(twice.reason, /already has a heading/);
    assert.equal(twice.markdown, once.markdown, 'a retried cut changes nothing');
  });

  it('says so rather than guessing when there is no [Unreleased]', () => {
    const { converted, reason } = convertHeading('# Changelog\n\n## [0.0.1] - 2026-01-01\n', {
      version: '0.0.2',
      date: '2026-08-12',
    });
    assert.equal(converted, false);
    assert.match(reason, /no \[Unreleased\]/);
  });

  it('survives an empty or absent file', () => {
    assert.equal(convertHeading('', { version: '1.0.0', date: 'x' }).converted, false);
    assert.equal(convertHeading(undefined, { version: '1.0.0', date: 'x' }).converted, false);
  });
});

describe('unreleasedBody', () => {
  it('is what would become the release notes', () => {
    assert.match(unreleasedBody(CHANGELOG), /^### Fixed/);
    assert.ok(!unreleasedBody(CHANGELOG).includes('0.0.20-alpha'), 'stops at the next heading');
  });

  it('is empty when nothing was written — which is worth reporting', () => {
    const bare = '# Changelog\n\n## [Unreleased]\n\n## [0.0.1] - 2026-01-01\n';
    assert.equal(unreleasedBody(bare), '');
  });
});
