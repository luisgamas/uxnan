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
import { baseOf } from './version.mjs';

/**
 * How far back a tag sits, as a sortable number: the numeric base first, then
 * the nightly counter. String order cannot do this — `desktop-stable-v0.0.28`
 * sorts *after* `desktop-nightly-v0.0.30` alphabetically, which is exactly how
 * 0.0.30's notes ended up listing everything since 0.0.28.
 */
function rankOf(tag) {
  const base = baseOf(tag);
  if (!base) return null;
  const nightly = Number(/-nightly\.\d+\.(\d+)$/.exec(tag)?.[1] ?? 0);
  return base.major * 1e9 + base.minor * 1e6 + base.patch * 1e3 + nightly;
}

/**
 * The tag a release should be compared against: the build immediately below it
 * in the same component, in **any** channel.
 *
 * Pure, so the rule can be tested without the network — it is the part that has
 * been wrong twice, not the API call.
 *
 * @param {string} tag the tag being released
 * @param {string[]} allTags every tag for that component, any order
 * @returns {string|null}
 */
export function previousTagFor(tag, allTags) {
  const mine = rankOf(tag);
  if (mine === null) return null;

  let best = null;
  for (const candidate of allTags) {
    if (candidate === tag) continue;
    const rank = rankOf(candidate);
    if (rank === null || rank >= mine) continue;
    if (!best || rank > best.rank) best = { tag: candidate, rank };
  }
  return best?.tag ?? null;
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

  const previous = previousTagFor(tag, tagsFor(component(id).tagPrefixes));
  process.stdout.write(generate(tag, { repo, previous }) + '\n');
}
