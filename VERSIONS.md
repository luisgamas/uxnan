# Release versions

Tracks which version of each Uxnan component shipped, and when. Components
version **independently** (each has its own patch), but a shared
`-alpha.YYYYMMDD` date suffix marks releases cut on the same day, so you can tell
which versions "go together".

## Convention

- Base SemVer starts at `0.0.1` (pre-1.0 = unstable; breaking changes allowed).
- Alpha builds use `0.0.PATCH-alpha.YYYYMMDD`. The `YYYYMMDD` date orders
  correctly under SemVer/npm (see `CI_CD_MONOREPOS.md` §4).
- Per-component git tags drive releases:
  `shared-v*`, `bridge-v*`, `relay-v*`, `desktop-v*`, `mobile-v*`
  (mobile may append `+<buildNumber>`, e.g. `mobile-v0.0.1-alpha.20260621+5`).
- npm packages publish under the **`alpha`** dist-tag.
- Mobile ships to **Google Play** (internal track); desktop to **GitHub
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
   dist-tag / the Play **internal** track has the new build / the desktop **GitHub
   Release** draft exists. A red or half-finished run is **not** a release — fix it.
6. **Record it** — add the row to the *History* table below (date + the component's
   new version) and commit it to `main`, as the last release step (see the
   automation note under the table).

## History

| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |
| ----------------- | ------ | ------ | ----- | ------- | ------ |
| _no releases yet_ |        |        |       |         |        |

> FOR-DEV: once the release pipeline is validated end-to-end, a final step in
> each release workflow can append/update the matching cell here automatically
> (commit the row back to `main`). Until then, add rows by hand at release time.
