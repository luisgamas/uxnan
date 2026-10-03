/**
 * "Does this component actually need a release?"
 *
 * The rule that matters: a folder changing is not the same as a build changing.
 * On 2026-08-06 the only change in `relay/` since its tag was `FOR-DEV.md` — a
 * checklist. A trigger that fires on any path under the component would have cut
 * a release of identical code, published it to npm, and put a row in the history
 * for nothing.
 *
 * A component is measured over every path that reaches its artifact, not just
 * its own folder: the bridge carries the relay Worker, so a shipping change
 * under `relay/` is a bridge change (see `carries` in `components.mjs`).
 */

import {
  RELEASE_ORDER,
  allVersionFiles,
  component,
  isNonShipping,
  pathsOf,
  within,
} from './components.mjs';
import {
  changedFiles,
  commitSubjects,
  isAncestorOfHead,
  isVersionOnlyDiff,
  latestTag,
  tagsFor,
} from './git.mjs';
import { readCarried } from './bump.mjs';
import { highestBase, nextCarriedVersion, nextVersion } from './version.mjs';

/**
 * @param {string} id component id
 * @param {{cwd?: string, channel?: 'stable'|'nightly', date?: Date}} [options]
 * @returns {{
 *   id: string, since: string|null, landed: boolean, files: string[],
 *   nonShipping: string[], substantive: string[], commits: number,
 *   carried: {
 *     id: string, substantive: string[], worthy: boolean,
 *     current: string|null, next: string,
 *   }[],
 *   worthy: boolean, shipped: string|null, next: string,
 * }}
 *
 * `landed` is false when the last release tag is not an ancestor of HEAD — its
 * pull request is still open, so `main` does not yet carry that version.
 */
export function inspect(id, options = {}) {
  const meta = component(id);
  const gitOptions = { cwd: options.cwd };

  const since = latestTag(meta.tagPrefixes, gitOptions);

  // Whether that release actually reached `main`. It is not a detail: while its
  // pull request sits open the tag lives on a branch `main` never absorbed, so
  // the five version files read as "changed" in *both* directions and each
  // following cut sees shippable work that does not exist. That is how 0.0.34
  // came to be — an identical build to 0.0.33 with an empty release body — and
  // left alone it repeats every night.
  const landed = isAncestorOfHead(since, gitOptions);
  const paths = pathsOf(meta);
  const files = changedFiles(since, paths, gitOptions);

  // Which is why a version file is judged by *what* changed inside it. Only its
  // version line moved → bookkeeping, whichever direction it moved in. The same
  // file having also gained a dependency is real work and still counts.
  const versionFiles = new Set(allVersionFiles(meta).map((entry) => entry.file));
  const bookkeeping = (file) =>
    versionFiles.has(file) && isVersionOnlyDiff(since, file, gitOptions);

  const skip = (file) => isNonShipping(file, meta) || bookkeeping(file);
  const nonShipping = files.filter(skip);
  const substantive = files.filter((file) => !skip(file));

  // Which carried parts changed, and so must move their own version in the cut.
  // `current` is read from the working tree, because that is what a cut writes.
  const carried = (meta.carries ?? []).map((part) => {
    const own = substantive.filter((file) => part.paths.some((path) => within(file, path)));
    const current = readCarried(part, { cwd: options.cwd })[0]?.version ?? null;
    return {
      id: part.id,
      substantive: own,
      worthy: own.length > 0,
      current,
      next: nextCarriedVersion({
        kind: part.kind,
        current,
        tags: tagsFor(part.tagPrefixes, gitOptions),
        date: options.date,
      }),
    };
  });

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
    landed,
    files,
    nonShipping,
    substantive,
    carried,
    commits: commitSubjects(since, paths, gitOptions).length,
    worthy: substantive.length > 0,
    shipped: shipped ? `${shipped.major}.${shipped.minor}.${shipped.patch}` : null,
    next: version,
  };
}

/** The same answer for every component, in the order releases must be cut. */
export function inspectAll(options = {}) {
  return RELEASE_ORDER.map((id) => inspect(id, options));
}
