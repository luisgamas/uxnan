#!/usr/bin/env node
/**
 * The `VERSIONS.md` history row, written by the release itself.
 *
 * It was step 6 of the checklist and the one that got forgotten — desktop
 * 0.0.29 shipped, was published, and the table never learned about it. Nothing
 * breaks when that happens (no tool reads this file; versions come from git
 * tags), but the record is the only place a human can see what shipped when, so
 * a gap in it is a small lie.
 *
 * The row is written **at cut time**, in the same commit as the version bump, so
 * it travels in the same pull request. Merging that pull request is what records
 * the release — which keeps the convention's intent: the row lands once a human
 * has seen the release go green.
 *
 * Usage:
 *   node scripts/release/record.mjs <component> <version> [--date=YYYY-MM-DD]
 *                                   [--note="…"] [--notes-file=notes.md]
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { component } from './components.mjs';

/** Column order of the history table, left to right after the date. */
export const COLUMNS = ['shared', 'bridge', 'relay', 'desktop', 'mobile'];

/** `2026-08-07`, in UTC like every other stamp the release convention uses. */
export function today(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Builds one table row: the date, a version in its component's column, an
 * em dash everywhere else, and an optional HTML comment carrying the summary.
 */
export function buildRow({ id, version, date, note }) {
  if (!COLUMNS.includes(id)) throw new Error(`no history column for "${id}"`);
  const cells = COLUMNS.map((column) => (column === id ? version : '—'));
  const comment = note ? ` <!-- ${note} -->` : '';
  return `| ${date} | ${cells.join(' | ')} |${comment}`;
}

/** Entries that describe the release plumbing, not anything that shipped. */
const PLUMBING = [/^build\(release\):/i, /^chore\(release\):/i, /^build: prepare /i];

/** The ` by @someone in <url>` GitHub appends to every generated bullet. */
const ATTRIBUTION = /\s+by\s+@\S+\s+in\s+https?:\/\/\S+$/;

/**
 * Turns GitHub's generated release notes into the one line the history row
 * carries.
 *
 * This lived in the release workflow as a `grep | sed | paste` pipeline, and it
 * was wrong on its first unattended run: **New Contributors** is also a bullet
 * list, so 0.0.31's row was recorded with "@uxnan-releases[bot] made their first
 * contribution" among the changes — the release tooling's own bot, described as
 * if it were a feature. It also kept the `build(release):` commit that names the
 * *previous* version, which reads as if 0.0.30 shipped inside 0.0.31.
 *
 * Only the **What's Changed** list contributes; every other section is about
 * people or links. Plumbing entries are dropped, because the row answers "what
 * shipped in this version" and preparing the release is not part of the answer.
 *
 * It is here rather than in the workflow for the reason the bug proves: a shell
 * one-liner in a YAML file is untested code with a production-only failure mode.
 */
export function summarizeNotes(markdown) {
  const entries = [];
  let inChanges = false;

  for (const raw of String(markdown ?? '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      inChanges = /^#+\s+what's changed\b/i.test(line);
      continue;
    }
    if (!inChanges || !line.startsWith('* ')) continue;

    const title = line.slice(2).replace(ATTRIBUTION, '').trim();
    if (!title || PLUMBING.some((pattern) => pattern.test(title))) continue;
    if (!entries.includes(title)) entries.push(title);
  }

  return entries.join('; ');
}

/**
 * Inserts a row directly under the table header, where the newest release goes.
 *
 * Idempotent on the version: re-running a cut, or a workflow retrying, must not
 * leave the same release recorded twice.
 */
export function insertRow(markdown, row, { version }) {
  if (markdown.includes(`| ${version} `) || markdown.includes(`| ${version} |`)) {
    return { markdown, inserted: false, reason: `${version} is already in the table` };
  }

  const separator = /^\| -+ \| -+ \| -+ \| -+ \| -+ \| -+ \|$/m.exec(markdown);
  if (!separator) {
    throw new Error('VERSIONS.md has no history table header to insert under');
  }

  const at = separator.index + separator[0].length;
  return {
    markdown: `${markdown.slice(0, at)}\n${row}${markdown.slice(at)}`,
    inserted: true,
  };
}

if (process.argv[1] && process.argv[1].endsWith('record.mjs')) {
  const [id, version, ...rest] = process.argv.slice(2);
  const flag = (name) =>
    rest
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');

  if (!id || !version) {
    console.error(
      'usage: record.mjs <component> <version> [--date=YYYY-MM-DD] [--note="…"] [--notes-file=…]',
    );
    process.exit(2);
  }

  component(id); // throws on an unknown component before touching the file
  const path = flag('file') ?? 'VERSIONS.md';
  const notesFile = flag('notes-file');
  const note = flag('note') ?? (notesFile ? summarizeNotes(readFileSync(notesFile, 'utf8')) : '');
  const row = buildRow({ id, version, date: flag('date') ?? today(), note });

  const result = insertRow(readFileSync(path, 'utf8'), row, { version });
  if (!result.inserted) {
    console.log(`nothing to record — ${result.reason}`);
    process.exit(0);
  }

  writeFileSync(path, result.markdown);
  console.log(`recorded in ${path}:`);
  console.log(row);
}
