/**
 * Writes a version into every file that carries it, then reads them all back.
 *
 * The read-back is the point. `VERSIONS.md` says "verify each manifest version
 * equals its lockfile counterpart" and asks a human to do it; this does it, and
 * refuses to leave a half-bumped tree behind.
 *
 * The desktop is the special case: its tag can carry a pre-release id but its
 * *files* must hold the plain numeric base, because the Windows MSI rejects
 * anything else. `versionForFiles` is where that rule lives.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { adapterFor } from './adapters.mjs';
import { component } from './components.mjs';
import { baseOf } from './version.mjs';

/** What actually goes *in the files* for a component's release version. */
export function versionForFiles(id, version) {
  if (component(id).kind !== 'desktop') return version;
  const base = baseOf(version);
  if (!base) throw new Error(`cannot read a numeric base out of "${version}"`);
  return `${base.major}.${base.minor}.${base.patch}`;
}

/** What each file holds today, without changing anything. */
export function readCurrent(id, { cwd = process.cwd() } = {}) {
  return component(id).versionFiles.map((entry) => {
    const text = readFileSync(join(cwd, entry.file), 'utf8');
    return { file: entry.file, version: adapterFor(entry.adapter).read(text, entry) };
  });
}

/**
 * Applies the version everywhere, then verifies. Returns what changed so the
 * caller can print it.
 *
 * @returns {{file: string, from: string|null, to: string}[]}
 */
export function applyVersion(id, version, { cwd = process.cwd(), dryRun = false } = {}) {
  const meta = component(id);
  const target = versionForFiles(id, version);
  const changes = [];

  for (const entry of meta.versionFiles) {
    const path = join(cwd, entry.file);
    const text = readFileSync(path, 'utf8');
    const adapter = adapterFor(entry.adapter);
    const from = adapter.read(text, entry);
    const next = adapter.write(text, target, entry);

    if (adapter.read(next, entry) !== target) {
      throw new Error(`${entry.file}: writing ${target} did not take — the file's shape changed?`);
    }
    if (!dryRun && next !== text) writeFileSync(path, next);
    changes.push({ file: entry.file, from, to: target });
  }

  if (!dryRun) assertConsistent(id, target, { cwd });
  return changes;
}

/**
 * Every version-bearing file agrees. Called after a bump, and worth calling on
 * its own before tagging — a manifest/lock mismatch is exactly the drift that
 * `--allow-same-version` hides at build time.
 */
export function assertConsistent(id, expected, { cwd = process.cwd() } = {}) {
  const wrong = readCurrent(id, { cwd }).filter((entry) => entry.version !== expected);
  if (wrong.length > 0) {
    const detail = wrong.map((e) => `  ${e.file}: ${e.version ?? '(none)'}`).join('\n');
    throw new Error(`${id}: these files do not say ${expected}:\n${detail}`);
  }
}
