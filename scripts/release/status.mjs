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

// Every column keeps at least one space after its widest value, so a long tag
// or a long verdict pushes the row along instead of swallowing the gap — the
// desktop's nightly tag is 40 characters and used to run straight into the next
// column.
const pad = (value, width) => `${value}`.padEnd(width) + ' ';
console.log(
  `${pad('component', 9)}${pad('last tag', 41)}${pad('changed', 7)}${pad('needs release', 17)}next`,
);
console.log('-'.repeat(110));

let owed = 0;
for (const row of rows) {
  const changed = `${row.substantive.length}+${row.nonShipping.length}n`;
  const verdict = row.worthy ? 'YES' : row.files.length ? 'no (nothing ships)' : 'no';
  if (row.worthy) owed += 1;
  const suffix = row.id === 'desktop' ? ` (${channel})` : '';
  console.log(
    `${pad(row.id, 9)}${pad(row.since ?? '(never released)', 41)}${pad(changed, 7)}${pad(verdict, 17)}${row.worthy ? row.next + suffix : '—'}`,
  );
}

console.log(
  '\nchanged = files that can affect a build + files that cannot (docs, specs, .github, tests)\n',
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
