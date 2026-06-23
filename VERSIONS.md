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

## History

| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |
| ----------------- | ------ | ------ | ----- | ------- | ------ |
| _no releases yet_ |        |        |       |         |        |

> FOR-DEV: once the release pipeline is validated end-to-end, a final step in
> each release workflow can append/update the matching cell here automatically
> (commit the row back to `main`). Until then, add rows by hand at release time.
