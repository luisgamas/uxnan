/**
 * The thin git layer. Everything the release scripts need to know about history,
 * and nothing else — kept in one place so the logic modules stay pure and
 * testable, and so a shell quoting mistake can only live here.
 */

import { execFileSync } from 'node:child_process';

function git(args, { cwd = process.cwd() } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** Every tag matching any of the prefixes, newest first by version order. */
export function tagsFor(prefixes, options) {
  const out = [];
  for (const prefix of prefixes) {
    const listed = git(['tag', '-l', `${prefix}*`, '--sort=-v:refname'], options)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    out.push(...listed);
  }
  return out;
}

/**
 * The most recently created tag among the prefixes — the last build shipped.
 * Commit date beats version order here: "changes since the last release" means
 * the newest build, whichever channel produced it.
 */
export function latestTag(prefixes, options) {
  const all = prefixes.flatMap((prefix) =>
    git(['tag', '-l', `${prefix}*`, '--sort=-creatordate'], options)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((tag) => ({ tag, at: git(['log', '-1', '--format=%ct', tag], options).trim() })),
  );
  if (all.length === 0) return null;
  all.sort((a, b) => Number(b.at) - Number(a.at));
  return all[0].tag;
}

/** Files changed between a ref and HEAD, restricted to one path. */
export function changedFiles(fromRef, path, options) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  return git(['diff', '--name-only', range, '--', path], options)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Commit subjects in the same range, for the summary. */
export function commitSubjects(fromRef, path, options) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  return git(['log', '--format=%s', range, '--', path], options)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Refuses to compute a release from a dirty or unexpected tree. */
export function workingTreeState(options) {
  const dirty = git(['status', '--porcelain'], options).trim().length > 0;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], options).trim();
  const head = git(['rev-parse', '--short', 'HEAD'], options).trim();
  return { dirty, branch, head };
}
