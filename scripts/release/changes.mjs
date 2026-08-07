/**
 * "Does this component actually need a release?"
 *
 * The rule that matters: a folder changing is not the same as a build changing.
 * On 2026-08-06 the only change in `relay/` since its tag was `FOR-DEV.md` — a
 * checklist. A trigger that fires on any path under the component would have cut
 * a release of identical code, published it to npm, and put a row in the history
 * for nothing.
 */

import { component, isNonShipping } from './components.mjs';
import { changedFiles, commitSubjects, latestTag } from './git.mjs';
import { highestBase, nextVersion } from './version.mjs';
import { tagsFor } from './git.mjs';

/**
 * @param {string} id component id
 * @param {{cwd?: string, channel?: 'stable'|'nightly', date?: Date}} [options]
 * @returns {{
 *   id: string, since: string|null, files: string[], nonShipping: string[],
 *   substantive: string[], commits: number, worthy: boolean,
 *   shipped: string|null, next: string,
 * }}
 */
export function inspect(id, options = {}) {
  const meta = component(id);
  const gitOptions = { cwd: options.cwd };

  const since = latestTag(meta.tagPrefixes, gitOptions);
  const files = changedFiles(since, meta.path, gitOptions);
  const nonShipping = files.filter(isNonShipping);
  const substantive = files.filter((file) => !isNonShipping(file));

  const tags = tagsFor(meta.tagPrefixes, gitOptions);
  const shipped = highestBase(tags);
  const { version } = nextVersion({
    kind: meta.kind,
    tags,
    channel: options.channel ?? 'stable',
    date: options.date,
  });

  return {
    id,
    since,
    files,
    nonShipping,
    substantive,
    commits: commitSubjects(since, meta.path, gitOptions).length,
    worthy: substantive.length > 0,
    shipped: shipped ? `${shipped.major}.${shipped.minor}.${shipped.patch}` : null,
    next: version,
  };
}

/** The same answer for every component, in the order releases must be cut. */
export function inspectAll(options = {}) {
  return ['shared', 'bridge', 'relay', 'mobile', 'desktop'].map((id) => inspect(id, options));
}
