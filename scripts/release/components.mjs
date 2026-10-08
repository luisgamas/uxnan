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
    releaseBefore: ['bridge'],
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
    // `uxnan-relay/local` is the Miniflare harness the bridge's tests start the
    // Worker with. The bridge takes `uxnan-relay` as a devDependency only, so
    // nothing under it reaches the published package.
    nonShipping: [/^relay\/src\/local\//],
    /**
     * Built elsewhere in the repo, published only inside this package.
     *
     * The relay is a Cloudflare Worker the bridge deploys into the user's own
     * account (`relay/setup`, `relay/update`). `bridge/tools/copy-relay-worker.mjs`
     * copies its bundle into `bridge/dist/relay-worker/` at build time, so a
     * change to the Worker reaches users through a bridge release and no other
     * way: `uxnan-relay` is private, carries no tag and is never published.
     *
     * Two consequences, both enforced by the tooling rather than remembered:
     *
     *  - a shipping change under `paths` makes the **bridge** need a release;
     *  - that bridge cut also moves the Worker's own version (`versionFiles`),
     *    which is what the deployed Worker reports at `GET /v1/version` and what
     *    `relay/status.bundledVersion` compares against. It moves **only** when
     *    the Worker changed: a bridge release that leaves the Worker alone must
     *    not tell every user their relay is out of date.
     *
     * `shared/src/relay/` is listed because esbuild inlines `@uxnan/shared/relay`
     * into the bundle — a protocol change there is a Worker change.
     *
     * `tagPrefixes` are historical: `relay-v*` tags were cut while the relay was
     * a published Node server. They are read, never written, so the Worker's
     * patch line can never fall back below a version that already shipped.
     */
    carries: [
      {
        id: 'relay',
        name: 'uxnan-relay',
        kind: 'npm',
        paths: ['relay', 'shared/src/relay'],
        tagPrefixes: ['relay-v'],
        changelog: 'relay/CHANGELOG.md',
        versionFiles: [
          { file: 'relay/package.json', adapter: 'json' },
          { file: 'package-lock.json', adapter: 'lock-workspace', pkgPath: 'relay' },
        ],
      },
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
      // The workspace members take `version.workspace = true` from the root
      // Cargo.toml (the `[workspace.package]` line is the one the cargo-toml
      // adapter rewrites), so only their lock entries need a hand. Every member
      // is listed: `components.test.mjs` reads the workspace and fails on one
      // that is missing (four were, and 0.0.78 shipped them at 0.0.75).
      ...[
        'uxnan-control-protocol',
        'uxnan-control-client',
        'uxnan-cli',
        'uxnan-workspace-engine',
        'uxnan-host-protocol',
        'uxnan-host',
      ].map((crate) => ({
        file: 'uxnandesktop/src-tauri/Cargo.lock',
        adapter: 'cargo-lock',
        crate,
      })),
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
export const RELEASE_ORDER = ['shared', 'bridge', 'mobile', 'desktop'];

/**
 * Ids that used to be released on their own, and where their changes go now.
 * Kept so an old habit gets an answer instead of a bare "unknown component".
 */
export const RETIRED = {
  relay: 'the relay Worker ships inside uxnan-bridge — cut the bridge',
};

export function component(id) {
  const found = COMPONENTS.find((c) => c.id === id);
  if (!found) {
    const hint = RETIRED[id] ? ` (${RETIRED[id]})` : '';
    throw new Error(`unknown component: ${id}${hint}`);
  }
  return found;
}

/** Every path whose change can reach this component's artifact. */
export function pathsOf(meta) {
  return [meta.path, ...(meta.carries ?? []).flatMap((part) => part.paths)];
}

/** True when `file` sits at or under `path` (a path segment, not a prefix). */
export function within(file, path) {
  return file === path || file.startsWith(`${path}/`);
}

/** Every file that carries a version for this component, carried parts included. */
export function allVersionFiles(meta) {
  return [...meta.versionFiles, ...(meta.carries ?? []).flatMap((part) => part.versionFiles)];
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
