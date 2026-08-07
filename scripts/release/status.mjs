#!/usr/bin/env node
/**
 * `npm run release:status` — the state of every component in one table.
 *
 * Answers, without anyone having to remember the convention: what shipped last,
 * what changed since, whether that change can affect a build, and what the next
 * version would be. Read-only; it never writes a file or touches a tag.
 *
 * Flags:
 *   --channel=nightly   compute the desktop's next version as a nightly
 *   --json              machine-readable, for the release workflow's summary
 */

import { inspectAll } from './changes.mjs';
import { readCurrent } from './bump.mjs';
import { component } from './components.mjs';
import { workingTreeState } from './git.mjs';
import { versionForFiles } from './bump.mjs';

const args = process.argv.slice(2);
const channel =
  /^--channel=(stable|nightly)$/.exec(args.find((a) => a.startsWith('--channel=')) ?? '')?.[1] ??
  'nightly';
const asJson = args.includes('--json');

const rows = inspectAll({ channel });

/** A component whose files already disagree with each other is a release bug. */
function fileState(id) {
  try {
    const current = readCurrent(id);
    const values = new Set(current.map((entry) => entry.version));
    return values.size === 1 ? { ok: true, version: [...values][0] } : { ok: false, current };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

if (asJson) {
  console.log(JSON.stringify({ rows, tree: workingTreeState() }, null, 2));
  process.exit(0);
}

const tree = workingTreeState();
console.log(
  `\nuxnan release status — ${tree.branch} @ ${tree.head}${tree.dirty ? ' (dirty)' : ''}\n`,
);

const pad = (value, width) => String(value).padEnd(width);
console.log(
  `${pad('component', 10)}${pad('last tag', 40)}${pad('changed', 9)}${pad('needs release', 15)}next`,
);
console.log('-'.repeat(104));

let owed = 0;
for (const row of rows) {
  const changed = `${row.substantive.length}+${row.docsOnly.length}d`;
  const verdict = row.worthy ? 'YES' : row.files.length ? 'no (docs only)' : 'no';
  if (row.worthy) owed += 1;
  const suffix = row.id === 'desktop' ? ` (${channel})` : '';
  console.log(
    `${pad(row.id, 10)}${pad(row.since ?? '(never released)', 40)}${pad(changed, 9)}${pad(verdict, 15)}${row.worthy ? row.next + suffix : '—'}`,
  );
}

console.log(
  '\nchanged = files that can affect a build + files that cannot (docs, architecture, .github)\n',
);

for (const row of rows.filter((r) => r.worthy)) {
  const meta = component(row.id);
  console.log(`${row.id}: ${row.commits} commit(s), ${row.substantive.length} file(s)`);
  for (const file of row.substantive.slice(0, 8)) console.log(`  ${file}`);
  if (row.substantive.length > 8) console.log(`  … ${row.substantive.length - 8} more`);
  const state = fileState(row.id);
  if (state.ok) {
    console.log(
      `  version files agree at ${state.version} → would become ${versionForFiles(row.id, row.next)}`,
    );
  } else if (state.current) {
    console.log('  ⚠ version files DISAGREE already:');
    for (const entry of state.current)
      console.log(`    ${entry.file}: ${entry.version ?? '(none)'}`);
  } else {
    console.log(`  ⚠ could not read version files: ${state.error}`);
  }
  if (meta.releaseBefore.length > 0) {
    console.log(
      `  must be published (and visible on npm) before: ${meta.releaseBefore.join(', ')}`,
    );
  }
  console.log('');
}

console.log(owed === 0 ? 'Nothing owes a release.\n' : `${owed} component(s) owe a release.\n`);
