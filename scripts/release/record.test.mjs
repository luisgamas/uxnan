import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRow, insertRow, summarizeNotes, today } from './record.mjs';

/** Exactly what GitHub generated for desktop 0.0.31 — the run that got it wrong. */
const REAL_NOTES = [
  "## What's Changed",
  '* fix(release): three defects the first real cut exposed by @luisgamas in https://github.com/luisgamas/uxnan/pull/160',
  '* build(release): desktop 0.0.30-nightly.20260807.2 by @uxnan-releases[bot] in https://github.com/luisgamas/uxnan/pull/159',
  '* feat(svelte): make the left panel legible without expanding it by @luisgamas in https://github.com/luisgamas/uxnan/pull/154',
  '* feat: workspace lifecycle — know when a space is finished, and close it by @luisgamas in https://github.com/luisgamas/uxnan/pull/155',
  '',
  '## New Contributors',
  '* @uxnan-releases[bot] made their first contribution in https://github.com/luisgamas/uxnan/pull/159',
  '',
  '**Full Changelog**: https://github.com/luisgamas/uxnan/compare/desktop-nightly-v0.0.30-nightly.20260807.2...desktop-nightly-v0.0.31-nightly.20260807.3',
].join('\n');

/** The shape of the real table, trimmed to what the insert cares about. */
const TABLE = [
  '## History',
  '',
  '| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |',
  '| ----------------- | ------ | ------ | ----- | ------- | ------ |',
  '| 2026-08-05 | — | 0.0.18-alpha.20260805 | — | — | — |',
  '| 2026-08-04 | 0.0.13-alpha.20260804 | — | — | — | — |',
  '',
].join('\n');

describe('today', () => {
  it('is the UTC date, like every other stamp in the convention', () => {
    assert.equal(today(new Date('2026-08-07T23:59:00Z')), '2026-08-07');
  });
});

describe('buildRow', () => {
  it('puts the version in its own column and dashes the rest', () => {
    assert.equal(
      buildRow({ id: 'desktop', version: '0.0.30-nightly.20260807.2', date: '2026-08-07' }),
      '| 2026-08-07 | — | — | — | 0.0.30-nightly.20260807.2 | — |',
    );
    assert.equal(
      buildRow({ id: 'shared', version: '0.0.14-alpha.20260807', date: '2026-08-07' }),
      '| 2026-08-07 | 0.0.14-alpha.20260807 | — | — | — | — |',
    );
  });

  it('carries the summary as an HTML comment, like the hand-written rows', () => {
    const row = buildRow({
      id: 'desktop',
      version: '0.0.30',
      date: '2026-08-07',
      note: 'search inside files (PR #156)',
    });
    assert.ok(row.endsWith('| <!-- search inside files (PR #156) -->'));
  });

  it('refuses a component the table has no column for', () => {
    assert.throws(
      () => buildRow({ id: 'web', version: '1.0.0', date: '2026-08-07' }),
      /no history column/,
    );
  });
});

describe('insertRow', () => {
  it('puts the newest release directly under the header', () => {
    const row = buildRow({ id: 'desktop', version: '0.0.30', date: '2026-08-07' });
    const { markdown, inserted } = insertRow(TABLE, row, { version: '0.0.30' });

    assert.equal(inserted, true);
    const lines = markdown.split('\n');
    const separator = lines.findIndex((l) => l.startsWith('| ---'));
    assert.equal(lines[separator + 1], row);
    // and the rows that were there are still there, in order
    assert.ok(lines[separator + 2].startsWith('| 2026-08-05'));
    assert.ok(lines[separator + 3].startsWith('| 2026-08-04'));
  });

  it('does not record the same version twice', () => {
    // A retried workflow, or a second run of the same cut, must not duplicate.
    const once = insertRow(
      TABLE,
      buildRow({ id: 'desktop', version: '0.0.30', date: '2026-08-07' }),
      {
        version: '0.0.30',
      },
    );
    const twice = insertRow(
      once.markdown,
      buildRow({ id: 'desktop', version: '0.0.30', date: '2026-08-08' }),
      {
        version: '0.0.30',
      },
    );

    assert.equal(twice.inserted, false);
    assert.equal(twice.markdown, once.markdown);
    assert.match(twice.reason, /already in the table/);
  });

  it('leaves everything above and below the table untouched', () => {
    const { markdown } = insertRow(
      TABLE,
      buildRow({ id: 'relay', version: '0.0.3', date: '2026-08-07' }),
      {
        version: '0.0.3',
      },
    );
    assert.ok(markdown.startsWith('## History\n'));
    assert.ok(markdown.includes('| 2026-08-04 | 0.0.13-alpha.20260804 |'));
  });

  it('fails loudly rather than guessing when the table is missing', () => {
    assert.throws(
      () => insertRow('# VERSIONS\n\nno table here\n', '| x |', { version: '1.0.0' }),
      /no history table/,
    );
  });
});

describe('summarizeNotes', () => {
  it('keeps what shipped, in order, without the attribution', () => {
    assert.equal(
      summarizeNotes(REAL_NOTES),
      'fix(release): three defects the first real cut exposed; ' +
        'feat(svelte): make the left panel legible without expanding it; ' +
        'feat: workspace lifecycle — know when a space is finished, and close it',
    );
  });

  it('never lets New Contributors into the row', () => {
    // The bug this whole function exists for: 0.0.31 was recorded claiming the
    // release bot's first contribution was one of the changes.
    assert.ok(!summarizeNotes(REAL_NOTES).includes('first contribution'));
    assert.ok(!summarizeNotes(REAL_NOTES).includes('Full Changelog'));
  });

  it('drops the release plumbing, which names the previous version', () => {
    assert.ok(!summarizeNotes(REAL_NOTES).includes('0.0.30-nightly'));
    assert.equal(
      summarizeNotes(
        ["## What's Changed", '* build: prepare desktop 0.0.31', '* chore(release): bridge 0.0.17'].join(
          '\n',
        ),
      ),
      '',
    );
  });

  it('survives notes with nothing in them, and notes that are not notes', () => {
    assert.equal(summarizeNotes(''), '');
    assert.equal(summarizeNotes(undefined), '');
    assert.equal(summarizeNotes('## New Contributors\n* @someone made their first contribution'), '');
  });

  it('does not repeat an entry that appears twice', () => {
    assert.equal(
      summarizeNotes(
        ["## What's Changed", '* feat: a thing by @a in https://x/1', '* feat: a thing by @b in https://x/2'].join(
          '\n',
        ),
      ),
      'feat: a thing',
    );
  });

  it('leaves a title alone when it has no attribution suffix', () => {
    assert.equal(summarizeNotes("## What's Changed\n* feat: written by hand"), 'feat: written by hand');
  });
});
