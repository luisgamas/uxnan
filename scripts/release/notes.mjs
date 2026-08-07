#!/usr/bin/env node
/**
 * The release body, generated the way the "Generate release notes" button does —
 * but told which tag to compare against.
 *
 * Left to itself, GitHub picks the baseline badly for a pre-release: cutting
 * `desktop-nightly-v0.0.29` it reached back to the previous *nightly* (0.0.22,
 * two weeks and six releases earlier) and listed 15 pull requests, 9 of which
 * had already shipped in 0.0.23…0.0.28. Passing `previous_tag_name` explicitly
 * gives the 6 that are actually new.
 *
 * The "Contributors" block on a published release is **not** part of this body —
 * GitHub renders it from the commit range once the release is published. Nothing
 * to generate, nothing to paste.
 *
 * Usage: node scripts/release/notes.mjs <tag> [--repo owner/name] [--print]
 */

import { execFileSync } from 'node:child_process';

import { component } from './components.mjs';
import { tagsFor } from './git.mjs';

/**
 * The tag a release should be compared against: the newest build of the same
 * component in **any** channel, excluding the one being released.
 *
 * Pure, so the rule can be tested without the network — it is the part that was
 * wrong, not the API call.
 *
 * @param {string} tag the tag being released
 * @param {string[]} allTags every tag for that component, newest first
 * @returns {string|null}
 */
export function previousTagFor(tag, allTags) {
  const remaining = allTags.filter((candidate) => candidate !== tag);
  return remaining.length > 0 ? remaining[0] : null;
}

/** Which component a tag belongs to, from its prefix. */
export function componentOf(tag) {
  for (const id of ['shared', 'bridge', 'relay', 'mobile', 'desktop']) {
    if (component(id).tagPrefixes.some((prefix) => tag.startsWith(prefix))) return id;
  }
  return null;
}

/** Asks GitHub for the notes, with the baseline pinned. */
export function generate(tag, { repo, previous }) {
  const args = [
    'api',
    '--method',
    'POST',
    `repos/${repo}/releases/generate-notes`,
    '-f',
    `tag_name=${tag}`,
    '--jq',
    '.body',
  ];
  if (previous) args.push('-f', `previous_tag_name=${previous}`);
  return execFileSync('gh', args, { encoding: 'utf8' }).trimEnd();
}

if (process.argv[1] && process.argv[1].endsWith('notes.mjs')) {
  const [tag, ...rest] = process.argv.slice(2);
  const repo =
    rest.find((a) => a.startsWith('--repo='))?.split('=')[1] ??
    process.env.GITHUB_REPOSITORY ??
    'luisgamas/uxnan';

  if (!tag) {
    console.error('usage: notes.mjs <tag> [--repo owner/name]');
    process.exit(2);
  }

  const id = componentOf(tag);
  if (!id) {
    console.error(`"${tag}" does not look like a release tag for any known component`);
    process.exit(2);
  }

  // Sorted newest-first by version, which is what "the build before this one"
  // means for every scheme this repo uses.
  const all = tagsFor(component(id).tagPrefixes).sort((a, b) =>
    b.localeCompare(a, 'en', { numeric: true }),
  );
  const previous = previousTagFor(tag, all);
  process.stdout.write(generate(tag, { repo, previous }) + '\n');
}
