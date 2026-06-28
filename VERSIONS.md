# Release versions

Tracks which version of each Uxnan component shipped, and when. Components
version **independently** (each has its own patch), but a shared
`-alpha.YYYYMMDD` date suffix marks releases cut on the same day, so you can tell
which versions "go together".

## Convention

- Base SemVer starts at `0.0.1` (pre-1.0 = unstable; breaking changes allowed).
- Alpha builds use `0.0.PATCH-alpha.YYYYMMDD`. The `YYYYMMDD` date orders
  correctly under SemVer/npm.
- Per-component git tags drive releases:
  `shared-v*`, `bridge-v*`, `relay-v*`, `desktop-v*`, `mobile-v*`
  (mobile may append `+<buildNumber>`, e.g. `mobile-v0.0.1-alpha.20260621+5`).
- **Source tracks the tag.** Bump the component's manifest version to the release
  version before tagging — npm: `package.json`; mobile: `pubspec.yaml`. **Desktop**
  keeps the **numeric base** (`0.0.1`) in `tauri.conf.json` / `Cargo.toml` because
  the Windows MSI rejects a non-numeric pre-release identifier; its full version
  rides the tag + the compiled-in `UXNAN_VERSION`. The npm and desktop release
  workflows re-apply the version from the tag with `--allow-same-version`, so a
  source==tag match is fine; mobile **fails** the release on a pubspec↔tag mismatch.
- npm packages publish under the **`alpha`** dist-tag.
- Mobile ships to **Google Play** (open testing / beta); desktop to **GitHub
  Releases** (draft).

## Release checklist

Cutting a release for component `<comp>` (tag `<comp>-v<version>`):

1. **Pre-flight** — the commit you will tag is green on CI (`ci-*.yml`) and its
   `CHANGELOG.md [Unreleased]` accurately describes what ships.
2. **Mobile only — bump the source version FIRST (non-negotiable)** — set
   `uxnanmobile/pubspec.yaml` `version:` to the release `<name>+<build>` (e.g.
   `0.0.1-alpha.20260621+5`), then **commit and push it**, so the *tagged commit*
   carries the matching version and the Flutter source never lags a tag.
   `release-mobile.yml` **fails the release** if pubspec and the tag disagree.
3. **Mobile only — refresh the Play "What's new" notes** — rewrite
   `.github/whatsnew/whatsnew-en-US` and `whatsnew-es-ES` as a short,
   **non-technical**, user-facing summary of this version's CHANGELOG,
   **≤ 500 characters each**. The release workflow validates both (missing / empty /
   placeholder / over-limit → the release fails). Commit + push before tagging.
4. **Tag & push** — `git tag <comp>-v<version> && git push origin <comp>-v<version>`,
   which triggers `release-<comp>.yml`.
5. **Validate the deploy** — wait for the `release-*.yml` run to go **green** and
   confirm the artifact actually landed: npm shows the new version under the `alpha`
   dist-tag / the Play **open-testing** (beta) track has the new build / the desktop **GitHub
   Release** draft exists. A red or half-finished run is **not** a release — fix it.
6. **Record it** — add the row to the *History* table below (date + the component's
   new version) and commit it to `main`, as the last release step (see the
   automation note under the table).

## History

| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |
| ----------------- | ------ | ------ | ----- | ------- | ------ |
| 2026-06-27 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627+20260627 |

> FOR-DEV: once the release pipeline is validated end-to-end, a final step in
> each release workflow can append/update the matching cell here automatically
> (commit the row back to `main`). Until then, add rows by hand at release time.
