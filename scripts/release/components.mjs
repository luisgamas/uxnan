/**
 * The release registry: one place that knows what each component is, where its
 * version lives, and which tag drives it.
 *
 * `docs/releases.md` describes all of this in prose for humans. This file is the
 * machine's copy — when the two disagree, one of them is a bug, and the tests in
 * `components.test.mjs` pin the parts that have burned us before (a version file
 * left out of a bump is invisible until a release ships wrong).
 */

/**
 * Paths whose change cannot possibly need a new build.
 *
 * Two classes, kept in one list because the question they answer is the same —
 * "would a user get anything different if we released this?".
 *
 * **Prose and specs.** Documentation, architecture, workflow files.
 *
 * **Tests and their helpers.** A test change proves something about code that
 * already shipped; it never alters what a user downloads. Without this, the
 * nightly cron cuts a release for a test-only commit — it did, the day
 * `setup.dom.ts` was fixed, and a nightly is four installers, a published
 * pre-release and an updater roll for a build nobody can tell apart from the
 * one before it. Rust unit tests live inline in `src/` under `#[cfg(test)]` and
 * are deliberately NOT matched: this errs toward releasing.
 */
export const NON_SHIPPING = [
  /\.md$/i,
  /(^|\/)docs\//,
  /(^|\/)architecture(\.old)?\//,
  /(^|\/)\.github\//,
  /\.test\.[cm]?[jt]sx?$/i,
  /\.spec\.[cm]?[jt]sx?$/i,
  /(^|\/)(test|tests|__tests__)\//,
];

/**
 * `kind` decides how a version string is built:
 *   npm      → 0.0.PATCH-alpha.YYYYMMDD
 *   mobile   → 0.0.PATCH-alpha.YYYYMMDD+BUILD   (Play needs a rising integer)
 *   desktop  → 0.0.PATCH            (stable)
 *              0.0.PATCH-nightly.YYYYMMDD.N     (nightly)
 */
export const COMPONENTS = [
  {
    id: 'shared',
    name: '@uxnan/shared',
    kind: 'npm',
    path: 'shared',
    tagPrefixes: ['shared-v'],
    workspace: 'shared',
    /** Every file that carries the version, in the order a human would check. */
    versionFiles: [
      { file: 'shared/package.json', adapter: 'json' },
      { file: 'package-lock.json', adapter: 'lock-workspace', pkgPath: 'shared' },
    ],
    /** Consumers that resolve this from npm at build time — order matters. */
    releaseBefore: ['bridge', 'relay'],
  },
  {
    id: 'bridge',
    name: 'uxnan-bridge',
    kind: 'npm',
    path: 'bridge',
    tagPrefixes: ['bridge-v'],
    workspace: 'bridge',
    versionFiles: [
      { file: 'bridge/package.json', adapter: 'json' },
      { file: 'package-lock.json', adapter: 'lock-workspace', pkgPath: 'bridge' },
    ],
    releaseBefore: [],
  },
  {
    id: 'relay',
    name: 'uxnan-relay',
    kind: 'npm',
    path: 'relay',
    tagPrefixes: ['relay-v'],
    workspace: 'relay',
    versionFiles: [
      { file: 'relay/package.json', adapter: 'json' },
      { file: 'package-lock.json', adapter: 'lock-workspace', pkgPath: 'relay' },
    ],
    releaseBefore: [],
  },
  {
    id: 'desktop',
    name: 'uxnan-desktop',
    kind: 'desktop',
    path: 'uxnandesktop',
    // Both channels share one numeric line: a base must be new against BOTH, or
    // the Windows MSI and the updater cannot see the newer build.
    tagPrefixes: ['desktop-stable-v', 'desktop-nightly-v'],
    // `uxnandesktop/scripts/` is check, benchmark and release tooling. Tauri
    // declares no `bundle.resources` and its `beforeBuildCommand` is the Vite
    // build, so nothing in there reaches an installer. This is deliberately NOT
    // a global rule: `bridge/package.json` lists `scripts` in its `files`, so
    // the bridge's scripts folder is published to npm and does ship.
    nonShipping: [/^uxnandesktop\/scripts\//],
    versionFiles: [
      { file: 'uxnandesktop/src-tauri/tauri.conf.json', adapter: 'json' },
      { file: 'uxnandesktop/src-tauri/Cargo.toml', adapter: 'cargo-toml' },
      { file: 'uxnandesktop/src-tauri/Cargo.lock', adapter: 'cargo-lock', crate: 'uxnan-desktop' },
      { file: 'uxnandesktop/package.json', adapter: 'json' },
      { file: 'uxnandesktop/package-lock.json', adapter: 'lock-root' },
    ],
    releaseBefore: [],
  },
  {
    id: 'mobile',
    name: 'uxnanmobile',
    kind: 'mobile',
    path: 'uxnanmobile',
    tagPrefixes: ['mobile-v'],
    versionFiles: [{ file: 'uxnanmobile/pubspec.yaml', adapter: 'pubspec' }],
    releaseBefore: [],
  },
];

/** The order releases must be cut in: a component never precedes its provider. */
export const RELEASE_ORDER = ['shared', 'bridge', 'relay', 'mobile', 'desktop'];

export function component(id) {
  const found = COMPONENTS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown component: ${id}`);
  return found;
}

/**
 * True when a changed path cannot affect what a build produces.
 *
 * `meta` adds the component's own exceptions, because "does this ship?" is not
 * always answerable from the path alone — the same `scripts/` folder is dev
 * tooling in one component and published files in another.
 */
export function isNonShipping(file, meta) {
  if (NON_SHIPPING.some((rule) => rule.test(file))) return true;
  return (meta?.nonShipping ?? []).some((rule) => rule.test(file));
}

/**
 * The desktop's numeric base must exceed every build already shipped in either
 * channel, so its "previous version" is not one tag but the whole line.
 */
export function tagPrefixes(id) {
  return component(id).tagPrefixes;
}
