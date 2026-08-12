#!/usr/bin/env node
/**
 * `npm run release:prepare -- <component> [--channel=nightly] [--version=x] [--dry-run]`
 *
 * Does the part of a release that is mechanical and easy to get wrong: works out
 * the next version, refuses it if the component has nothing to ship or the base
 * would not move forward, writes it into every version-bearing file, and reads
 * them all back to prove they agree.
 *
 * It deliberately stops there. Committing, tagging and pushing stay in human
 * hands (and, from phase 2, in the release workflow) — this prints the exact
 * commands so the tag can never disagree with the files it just wrote.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { inspect } from './changes.mjs';
import { applyVersion, versionForFiles } from './bump.mjs';
import { convertHeading, convertsHeading, unreleasedBody } from './changelog.mjs';
import { component } from './components.mjs';
import { tagsFor, workingTreeState } from './git.mjs';
import { assertMovesForward, dateStamp } from './version.mjs';

const [id, ...rest] = process.argv.slice(2);
const flag = (name) =>
  rest
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const has = (name) => rest.includes(`--${name}`);

if (!id) {
  console.error(
    'usage: release:prepare -- <shared|bridge|relay|mobile|desktop> [--channel=nightly] [--version=…] [--dry-run] [--force]',
  );
  process.exit(2);
}

const meta = component(id);
const channel = flag('channel') ?? 'stable';
const dryRun = has('dry-run');

if (meta.kind === 'desktop' && !['stable', 'nightly'].includes(channel)) {
  console.error(`desktop releases are stable or nightly, not "${channel}"`);
  process.exit(2);
}

const tree = workingTreeState();
if (tree.dirty && !has('force')) {
  console.error(`the working tree is dirty — commit or stash first (or pass --force)`);
  process.exit(1);
}

const report = inspect(id, { channel });
if (!report.worthy && !has('force')) {
  console.error(`\n${id} has nothing to release since ${report.since ?? 'the beginning'}.`);
  if (report.nonShipping.length > 0) {
    console.error('Only these changed, and none of them can affect a build:');
    for (const file of report.nonShipping) console.error(`  ${file}`);
  }
  console.error('\nPass --force to release it anyway.\n');
  process.exit(1);
}

const version = flag('version') ?? report.next;
const tags = tagsFor(meta.tagPrefixes);
assertMovesForward({ version, tags });

const tagPrefix =
  meta.kind === 'desktop'
    ? channel === 'nightly'
      ? 'desktop-nightly-v'
      : 'desktop-stable-v'
    : meta.tagPrefixes[0];
const tag = `${tagPrefix}${version}`;

console.log(`\n${id} → ${version}${meta.kind === 'desktop' ? ` (${channel})` : ''}`);
console.log(`  last shipped: ${report.since ?? '(never)'}`);
console.log(`  files carry:  ${versionForFiles(id, version)}\n`);

for (const change of applyVersion(id, version, { dryRun })) {
  console.log(`  ${change.from ?? '(none)'} → ${change.to}  ${change.file}`);
}

console.log(dryRun ? '\n(dry run — nothing written)\n' : '\nAll version files agree.\n');
// The CHANGELOG heading is a version and a date, which makes it this script's
// business and not a person's. The entries under it stay authored where they
// belong: in the pull request that changed the behaviour.
const changelogPath = `${meta.path}/CHANGELOG.md`;
if (!convertsHeading({ kind: meta.kind, channel })) {
  console.log('CHANGELOG: left at [Unreleased] — a nightly piles up until the next stable.\n');
} else {
  let current = '';
  try {
    current = readFileSync(changelogPath, 'utf8');
  } catch {
    console.log(`CHANGELOG: ${changelogPath} not found — skipped.\n`);
  }
  if (current) {
    if (unreleasedBody(current) === '') {
      console.log(
        `CHANGELOG: WARNING — [Unreleased] is empty, so ${version} would ship with nothing to tell anyone.`,
      );
    }
    const heading = convertHeading(current, { version, date: dateStamp() });
    if (!heading.converted) {
      console.log(`CHANGELOG: unchanged — ${heading.reason}.\n`);
    } else if (dryRun) {
      console.log(`CHANGELOG: would head ${changelogPath} with [${version}].\n`);
    } else {
      writeFileSync(changelogPath, heading.markdown);
      console.log(`CHANGELOG: ${changelogPath} now heads with [${version}].\n`);
    }
  }
}

console.log('Next:\n');
console.log(`  git commit -am "chore(release): ${id} ${version}"`);
console.log(`  git tag ${tag}`);
console.log(`  git push origin main --tags\n`);

if (meta.releaseBefore.length > 0) {
  console.log(
    `Wait for this to publish before tagging ${meta.releaseBefore.join(' / ')} — they resolve it from npm at build time.\n`,
  );
}
