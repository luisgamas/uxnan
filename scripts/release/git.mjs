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
 *
 * Commit dates have one-second resolution, so two tags cut in the same second
 * tie — and a tie used to resolve by whatever order git happened to list them,
 * which can name the *older* release. Version order breaks it, so the answer is
 * deterministic either way.
 */
export function latestTag(prefixes, options) {
  const byVersion = tagsFor(prefixes, options);
  const rank = new Map(byVersion.map((tag, index) => [tag, index]));
  const all = byVersion.map((tag) => ({
    tag,
    at: Number(git(['log', '-1', '--format=%ct', tag], options).trim()),
  }));
  if (all.length === 0) return null;
  all.sort((a, b) => b.at - a.at || rank.get(a.tag) - rank.get(b.tag));
  return all[0].tag;
}

/** True when the ref is already contained in `HEAD` — the release landed. */
export function isAncestorOfHead(ref, options) {
  if (!ref) return false;
  try {
    git(['merge-base', '--is-ancestor', ref, 'HEAD'], options);
    return true;
  } catch {
    return false;
  }
}

/** Files changed between a ref and HEAD, restricted to one path. */
export function changedFiles(fromRef, path, options) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  return git(['diff', '--name-only', range, '--', path], options)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * A version line in any manifest this repo bumps:
 *   `"version": "0.0.33",`  ·  `version = "0.0.33"`  ·  `version: 0.0.1+5`
 */
const VERSION_LINE = /^[+-]\s*"?version"?\s*[:=]\s*\S/;

/**
 * True when a file's whole diff is its version being bumped, and nothing else.
 *
 * A release's own bump commit reaches `main` through the release pull request,
 * so it lands *inside* the range the next cut measures — five manifests
 * "changed", every one of them shippable by path, and another identical release
 * cut for it. Asking what changed *inside* the file separates that from the case
 * that must still count: a dependency added to the same `package.json` or
 * `Cargo.toml` is real work, and this returns false for it.
 */
export function isVersionOnlyDiff(fromRef, file, options) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  const diff = git(['diff', '--unified=0', range, '--', file], options);
  const changed = diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return changed.length > 0 && changed.every((line) => VERSION_LINE.test(line));
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
