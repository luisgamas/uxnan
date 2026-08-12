/**
 * The `[Unreleased]` heading, converted at cut time.
 *
 * This used to be a human step, and it should never have been one. The tooling
 * does not write the *prose* — every entry is authored in the pull request that
 * changes the behaviour, which is the only place anyone knows what happened.
 * But the heading is not prose: it is the version and the date, both of which
 * the cut has already computed and written into five other files. Leaving it out
 * meant a release could not be cut without a person editing Markdown first, and
 * that person could get the version wrong in a way nothing checked.
 *
 * One rule is genuinely conditional, and it is a rule rather than a judgement:
 * **a desktop nightly does not convert**. A run of nightlies deliberately piles
 * under `[Unreleased]` and the next stable absorbs the lot, so converting on
 * each one would shred a release's notes into ten fragments nobody reads.
 */

/** Matches the `## [Unreleased]` line, however it is spaced. */
const UNRELEASED = /^##\s*\[Unreleased\]\s*$/m;

/**
 * True when this cut should convert the heading: everything except a desktop
 * nightly.
 */
export function convertsHeading({ kind, channel }) {
  return !(kind === 'desktop' && channel === 'nightly');
}

/**
 * Renames `## [Unreleased]` to the version being cut and opens a fresh empty
 * `[Unreleased]` above it.
 *
 * Idempotent on the version: a retried cut, or a workflow re-run, must not
 * stamp the same version twice. Returns `{ markdown, converted, reason }` so the
 * caller can report honestly rather than guess.
 */
export function convertHeading(markdown, { version, date }) {
  const text = String(markdown ?? '');

  if (text.includes(`## [${version}]`)) {
    return { markdown: text, converted: false, reason: `${version} already has a heading` };
  }
  if (!UNRELEASED.test(text)) {
    return { markdown: text, converted: false, reason: 'no [Unreleased] heading to convert' };
  }

  return {
    markdown: text.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${date}`),
    converted: true,
  };
}

/**
 * What sits under `[Unreleased]` right now, trimmed.
 *
 * A release whose notes are empty is worth saying out loud: it means every
 * change that earned this version arrived without a line describing it, and the
 * published release will say nothing to whoever installs it.
 */
export function unreleasedBody(markdown) {
  const text = String(markdown ?? '');
  const start = text.search(UNRELEASED);
  if (start === -1) return '';
  const after = text.slice(start).replace(UNRELEASED, '');
  const next = after.search(/^##\s+/m);
  return (next === -1 ? after : after.slice(0, next)).trim();
}
