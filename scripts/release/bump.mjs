/**
 * Writes a version into every file that carries it, then reads them all back.
 *
 * The read-back is the point. `docs/releases.md` says "verify each manifest version
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

/** What each listed file holds today, without changing anything. */
function readEntries(entries, { cwd = process.cwd() } = {}) {
  return entries.map((entry) => {
    const text = readFileSync(join(cwd, entry.file), 'utf8');
    return { file: entry.file, version: adapterFor(entry.adapter).read(text, entry) };
  });
}

/** Writes one version into every listed file. Returns what changed. */
function writeEntries(entries, target, { cwd = process.cwd(), dryRun = false } = {}) {
  const changes = [];
  for (const entry of entries) {
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
  return changes;
}

function assertEntries(label, entries, expected, { cwd = process.cwd() } = {}) {
  const wrong = readEntries(entries, { cwd }).filter((entry) => entry.version !== expected);
  if (wrong.length > 0) {
    const detail = wrong.map((e) => `  ${e.file}: ${e.version ?? '(none)'}`).join('\n');
    throw new Error(`${label}: these files do not say ${expected}:\n${detail}`);
  }
}

/** What each file holds today, without changing anything. */
export function readCurrent(id, { cwd = process.cwd() } = {}) {
  return readEntries(component(id).versionFiles, { cwd });
}

/**
 * Applies the version everywhere, then verifies. Returns what changed so the
 * caller can print it.
 *
 * @returns {{file: string, from: string|null, to: string}[]}
 */
export function applyVersion(id, version, { cwd = process.cwd(), dryRun = false } = {}) {
  const target = versionForFiles(id, version);
  const changes = writeEntries(component(id).versionFiles, target, { cwd, dryRun });
  if (!dryRun) assertConsistent(id, target, { cwd });
  return changes;
}

/**
 * Every version-bearing file agrees. Called after a bump, and worth calling on
 * its own before tagging — a manifest/lock mismatch is exactly the drift that
 * `--allow-same-version` hides at build time.
 */
export function assertConsistent(id, expected, { cwd = process.cwd() } = {}) {
  assertEntries(id, component(id).versionFiles, expected, { cwd });
}

/**
 * A part the component carries (the relay Worker inside the bridge), looked up
 * by id. Throws rather than returning undefined, like `component()`.
 */
export function carriedPart(id, partId) {
  const part = (component(id).carries ?? []).find((p) => p.id === partId);
  if (!part) throw new Error(`${id} carries no part named ${partId}`);
  return part;
}

/** What a carried part's files hold today. */
export function readCarried(part, { cwd = process.cwd() } = {}) {
  return readEntries(part.versionFiles, { cwd });
}

/**
 * Moves a carried part's own version — every one of its files, then reads them
 * back — in the same tree the component's bump is written to. Carried parts use
 * their version as tagged (they are npm-kind; no numeric-base rule applies).
 *
 * @returns {{file: string, from: string|null, to: string}[]}
 */
export function applyCarriedVersion(part, version, { cwd = process.cwd(), dryRun = false } = {}) {
  const changes = writeEntries(part.versionFiles, version, { cwd, dryRun });
  if (!dryRun) assertEntries(part.id, part.versionFiles, version, { cwd });
  return changes;
}
