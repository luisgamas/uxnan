/**
 * Semantic-version comparison shared across the ecosystem.
 *
 * Uxnan versions follow SemVer with a date-stamped prerelease, e.g.
 * `0.0.3-alpha.20260702` (and, on mobile, an optional `+<build>` metadata
 * suffix). This implements SemVer 2.0.0 precedence (§11) closely enough for
 * those formats — enough for the bridge to decide "is the published version
 * newer than mine?" without pulling in a `semver` dependency.
 *
 * Build metadata (`+...`) is ignored for precedence, per the spec.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifiers (empty for a stable release). */
  prerelease: string[];
}

/** Parse `MAJOR.MINOR.PATCH[-prerelease][+build]`, or `null` if unparseable. */
function parseVersion(version: string): ParsedVersion | null {
  const trimmed = version.trim();
  if (!trimmed) return null;
  // Strip build metadata (everything from the first `+`), which never affects
  // precedence.
  const noBuild = trimmed.split('+', 1)[0]!;
  const dashIndex = noBuild.indexOf('-');
  const core = dashIndex === -1 ? noBuild : noBuild.slice(0, dashIndex);
  const prereleaseRaw = dashIndex === -1 ? '' : noBuild.slice(dashIndex + 1);

  const coreParts = core.split('.');
  if (coreParts.length !== 3) return null;
  const major = Number(coreParts[0]);
  const minor = Number(coreParts[1]);
  const patch = Number(coreParts[2]);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    return null;
  }

  const prerelease = prereleaseRaw.length > 0 ? prereleaseRaw.split('.') : [];
  return { major, minor, patch, prerelease };
}

/** Numeric identifiers are all-digits (SemVer §9). */
function isNumericIdentifier(id: string): boolean {
  return id.length > 0 && /^[0-9]+$/.test(id);
}

/** Compare two prerelease identifier lists per SemVer §11. */
function comparePrerelease(a: string[], b: string[]): number {
  // A release with no prerelease outranks one that has a prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // `a` is stable, `b` is prerelease → a > b
  if (b.length === 0) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const idA = a[i]!;
    const idB = b[i]!;
    if (idA === idB) continue;
    const numA = isNumericIdentifier(idA);
    const numB = isNumericIdentifier(idB);
    if (numA && numB) {
      const diff = Number(idA) - Number(idB);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (numA) {
      return -1; // numeric identifiers have lower precedence than alphanumeric
    } else if (numB) {
      return 1;
    } else {
      return idA < idB ? -1 : 1; // lexical ASCII order
    }
  }
  // All shared identifiers equal → the longer set has higher precedence.
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Compare two SemVer strings. Returns `-1` if `a < b`, `1` if `a > b`, `0` if
 * they are precedence-equal. Unparseable inputs sort as *lower* than any
 * parseable version (and equal to each other), so a garbage/absent version
 * never masquerades as "newer".
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * True when `candidate` is a strictly newer version than `current`. Used to
 * decide whether to announce an available update. A candidate that is absent or
 * unparseable is never treated as newer.
 */
export function isNewerVersion(candidate: string | undefined | null, current: string): boolean {
  if (!candidate) return false;
  if (parseVersion(candidate) === null) return false;
  return compareVersions(candidate, current) > 0;
}
