/**
 * Version arithmetic for the release convention in `VERSIONS.md`.
 *
 * Everything here is pure: given the tags that already exist and a date, it says
 * what the next version and tag are. No git, no filesystem — so the rules can be
 * tested exhaustively, which matters because getting one wrong is not a typo,
 * it is a shipped build nobody's updater can see.
 */

/** `20260806` — the date component every alpha and nightly carries. */
export function dateStamp(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
}

/**
 * Pulls `0.0.PATCH` out of any tag this repo has ever used, whatever rides
 * behind it (`-alpha.20260805`, `-nightly.20260724.1`, `+20260805`).
 * Returns null for a tag that does not carry one.
 */
export function baseOf(tag) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(tag ?? '');
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

/** `0.0.28` → 28. The number the desktop's MSI and updater actually compare. */
export function patchOf(tag) {
  return baseOf(tag)?.patch ?? null;
}

/** The highest numeric base across a set of tags (channels included). */
export function highestBase(tags) {
  let best = null;
  for (const tag of tags) {
    const base = baseOf(tag);
    if (!base) continue;
    const rank = base.major * 1e6 + base.minor * 1e3 + base.patch;
    if (!best || rank > best.rank) best = { ...base, rank };
  }
  return best ? { major: best.major, minor: best.minor, patch: best.patch } : null;
}

function nextBase(tags) {
  const highest = highestBase(tags);
  return highest ? { ...highest, patch: highest.patch + 1 } : { major: 0, minor: 0, patch: 1 };
}

const fmt = (b) => `${b.major}.${b.minor}.${b.patch}`;

/**
 * The next version for a component.
 *
 * @param {object} input
 * @param {'npm'|'mobile'|'desktop'} input.kind
 * @param {string[]} input.tags   every existing tag for the component (all channels)
 * @param {'stable'|'nightly'} [input.channel]  desktop only
 * @param {Date} [input.date]
 * @returns {{version: string, base: string, tag: (prefix: string) => string}}
 */
export function nextVersion({ kind, tags, channel = 'stable', date = new Date() }) {
  const base = fmt(nextBase(tags));
  const stamp = dateStamp(date);

  if (kind === 'npm') {
    return { version: `${base}-alpha.${stamp}`, base };
  }

  if (kind === 'mobile') {
    // Play needs a strictly rising integer. The date is one, and it is
    // self-documenting — but a second release on the same day would repeat it,
    // so step past any build number already used.
    const used = new Set(
      tags.map((t) => Number(/\+(\d+)$/.exec(t)?.[1])).filter((n) => Number.isFinite(n)),
    );
    let build = Number(stamp);
    while (used.has(build)) build += 1;
    return { version: `${base}-alpha.${stamp}+${build}`, base, build };
  }

  if (kind === 'desktop') {
    if (channel === 'stable') return { version: base, base };
    // `N` only separates nightlies cut on the same date for the same base.
    const sameDay = tags.filter((t) => t.includes(`-nightly.${stamp}.`));
    const highestN = sameDay.reduce((max, t) => {
      const n = Number(/-nightly\.\d+\.(\d+)/.exec(t)?.[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return { version: `${base}-nightly.${stamp}.${highestN + 1}`, base };
  }

  throw new Error(`unknown component kind: ${kind}`);
}

/**
 * Refuses a version that would not be seen as newer than what already shipped.
 * For the desktop that is the whole point: the MSI and the updater compare only
 * `0.0.PATCH`, so reusing a base makes the new build invisible rather than
 * failing loudly.
 */
export function assertMovesForward({ version, tags }) {
  const proposed = baseOf(version);
  const highest = highestBase(tags);
  if (!proposed) throw new Error(`cannot read a 0.0.PATCH base out of "${version}"`);
  if (!highest) return;

  const rank = (b) => b.major * 1e6 + b.minor * 1e3 + b.patch;
  if (rank(proposed) <= rank(highest)) {
    throw new Error(
      `version ${version} does not move past ${fmt(highest)}, which has already shipped — ` +
        `pick a base above every tag in every channel`,
    );
  }
}
