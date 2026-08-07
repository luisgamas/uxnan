# Release tooling

Two commands that take the guesswork and the transcription errors out of cutting
a release. [`VERSIONS.md`](../../VERSIONS.md) remains the source of truth for the
convention; this is the code that follows it.

Everything here is read-only or writes version files. **Nothing commits, tags or
pushes** — that stays with a human, and from phase 2 with the release workflow.

## `npm run release:status`

The state of the whole monorepo in one table:

```
component last tag                                changed  needs release  next
shared    shared-v0.0.13-alpha.20260804           0+0d     no             —
relay     relay-v0.0.2-alpha.20260720             0+1d     no (docs only) —
desktop   desktop-stable-v0.0.28                  25+9d    YES            0.0.29-nightly.20260806.1
```

`changed` is `files that can affect a build + files that cannot`. That second
number is the whole point: on 2026-08-06 the only change in `relay/` since its
tag was `FOR-DEV.md`, and a trigger that fired on "the folder changed" would have
published an identical package.

Flags: `--channel=stable|nightly` (how to compute the desktop's next version,
default `nightly`) and `--json` (for the workflow's job summary).

## `npm run release:prepare -- <component> [flags]`

Computes the next version, then writes it into every file that carries one and
reads them all back:

```
desktop → 0.0.29-nightly.20260806.1 (nightly)
  0.0.28 → 0.0.29  uxnandesktop/src-tauri/tauri.conf.json
  0.0.28 → 0.0.29  uxnandesktop/src-tauri/Cargo.toml
  0.0.28 → 0.0.29  uxnandesktop/src-tauri/Cargo.lock
  0.0.28 → 0.0.29  uxnandesktop/package.json
  0.0.28 → 0.0.29  uxnandesktop/package-lock.json
```

It refuses to run when the component has nothing release-worthy, when the tree is
dirty, or when the version would not move past every channel. `--force`
overrides the first two; nothing overrides the third, because a reused numeric
base does not fail — it ships a build the Windows MSI and the updater cannot see.

Flags: `--channel=stable|nightly`, `--version=<exact>`, `--dry-run`, `--force`.

## `plan.mjs` and `notes.mjs` — used by the workflow

`plan.mjs` decides **what a release run should cut and in what order**: it drops
components with nothing release-worthy, orders `shared` ahead of the packages
that resolve it from npm, and refuses a version that would not move past every
channel. `--scheduled` is the nightly cron's plan (desktop, nightly channel).

`notes.mjs` produces the release body the way GitHub's *Generate release notes*
button does, but with `previous_tag_name` pinned to the previous desktop build in
**either** channel. Left to choose, GitHub reached back to the previous *nightly*
and re-listed nine pull requests that had already shipped.

`record.mjs` writes the `VERSIONS.md` row — date, the version in its component's
column, and a summary seeded from the pull request titles in the release. It is
idempotent on the version, so a retried run cannot record the same release
twice. The row goes in the **same commit as the version bump**, so it travels in
the same pull request: merging that is what records the release.

`plan.mjs` and `notes.mjs` print to stdout and change nothing;
`.github/workflows/release.yml` is what turns their output into commits and tags.

## What the pieces are

| File | Responsibility |
|---|---|
| `components.mjs` | the registry: paths, tag prefixes, every version-bearing file, release order |
| `version.mjs` | pure version arithmetic — next version per kind and channel, and the guard against a base that has already shipped |
| `adapters.mjs` | pure text transforms per file format (`package.json`, both lockfile shapes, `Cargo.toml`, `Cargo.lock`, `pubspec.yaml`) |
| `bump.mjs` | applies a version to every file, then asserts they all agree |
| `changes.mjs` | "does this component need a release?" — path diff since its last tag, minus docs |
| `git.mjs` | the only place that shells out to git |
| `plan.mjs` | what to cut, in what order — the workflow's decisions |
| `notes.mjs` | the release body, with the baseline pinned |
| `record.mjs` | the `VERSIONS.md` history row, written at cut time |

`node --test "scripts/release/*.test.mjs"` (also part of the root `npm test`)
covers all of it, including the two failures that have actually shipped here: a
lockfile left behind a manifest, and a desktop base reused across channels.

## Adding a component, or a file that carries a version

Both are one edit in `components.mjs` — add the entry, or add the file to
`versionFiles` with the adapter that matches its format. `components.test.mjs`
then enforces that the path exists and that a manifest never travels without its
lockfile.
