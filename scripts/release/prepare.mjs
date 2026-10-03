#!/usr/bin/env node
/**
 * `npm run release:prepare -- <component> [--channel=nightly] [--version=x] [--dry-run]`
 *
 * Does the part of a release that is mechanical and easy to get wrong: works out
 * the next version, refuses it if the component has nothing to ship or the base
 * would not move forward, writes it into every version-bearing file, and reads
 * them all back to prove they agree.
 *
 * When the component carries a part that changed — the relay Worker inside the
 * bridge — the same run moves that part's own version too, so the Worker a user
 * deploys from this release reports a version no earlier Worker had.
 *
 * It deliberately stops there. Committing, tagging and pushing stay in human
 * hands (and, from phase 2, in the release workflow) — this prints the exact
 * commands so the tag can never disagree with the files it just wrote.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { inspect } from './changes.mjs';
import { applyCarriedVersion, applyVersion, carriedPart, versionForFiles } from './bump.mjs';
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
    'usage: release:prepare -- <shared|bridge|mobile|desktop> [--channel=nightly] [--version=…] [--dry-run] [--force]',
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

// A carried part moves only when it changed: a bridge release that leaves the
// relay Worker alone must not tell every user their deployed relay is behind.
const carriedCuts = report.carried.filter((part) => part.worthy);
for (const cut of carriedCuts) {
  const part = carriedPart(id, cut.id);
  console.log(`\n  carries ${part.name} → ${cut.next} (${cut.substantive.length} file(s) changed)`);
  for (const change of applyCarriedVersion(part, cut.next, { dryRun })) {
    console.log(`  ${change.from ?? '(none)'} → ${change.to}  ${change.file}`);
  }
}
for (const part of report.carried.filter((p) => !p.worthy)) {
  console.log(`\n  carries ${carriedPart(id, part.id).name} unchanged — stays ${part.current}`);
}

console.log(dryRun ? '\n(dry run — nothing written)\n' : '\nAll version files agree.\n');

/**
 * The CHANGELOG heading is a version and a date, which makes it this script's
 * business and not a person's. The entries under it stay authored where they
 * belong: in the pull request that changed the behaviour.
 */
function headChangelog(changelogPath, headingVersion) {
  let current = '';
  try {
    current = readFileSync(changelogPath, 'utf8');
  } catch {
    console.log(`CHANGELOG: ${changelogPath} not found — skipped.\n`);
  }
  if (!current) return;
  if (unreleasedBody(current) === '') {
    console.log(
      `CHANGELOG: WARNING — [Unreleased] is empty in ${changelogPath}, so ${headingVersion} would ship with nothing to tell anyone.`,
    );
  }
  const heading = convertHeading(current, { version: headingVersion, date: dateStamp() });
  if (!heading.converted) {
    console.log(`CHANGELOG: ${changelogPath} unchanged — ${heading.reason}.\n`);
  } else if (dryRun) {
    console.log(`CHANGELOG: would head ${changelogPath} with [${headingVersion}].\n`);
  } else {
    writeFileSync(changelogPath, heading.markdown);
    console.log(`CHANGELOG: ${changelogPath} now heads with [${headingVersion}].\n`);
  }
}

if (!convertsHeading({ kind: meta.kind, channel })) {
  console.log('CHANGELOG: left at [Unreleased] — a nightly piles up until the next stable.\n');
} else {
  headChangelog(`${meta.path}/CHANGELOG.md`, version);
  // The carried part keeps its own history under its own version.
  for (const cut of carriedCuts) {
    const part = carriedPart(id, cut.id);
    if (part.changelog) headChangelog(part.changelog, cut.next);
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
