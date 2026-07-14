# Release versions

Tracks which version of each Uxnan component shipped, and when. Components
version **independently** (each has its own patch), but a shared
`-alpha.YYYYMMDD` date suffix marks releases cut on the same day, so you can tell
which versions "go together".

## Convention

- Base SemVer starts at `0.0.1` (pre-1.0 = unstable; breaking changes allowed).
- Alpha builds use `0.0.PATCH-alpha.YYYYMMDD`. The `YYYYMMDD` date orders
  correctly under SemVer/npm.
- **Desktop channels are intentionally different.** The tag is the channel's
  source of truth, not a manual GitHub Release checkbox:
  - **Stable:** `desktop-stable-v0.0.PATCH` (for example,
    `desktop-stable-v0.0.10`). It produces a normal GitHub Release and feeds the
    stable updater manifest.
  - **Nightly:** `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` (for example,
    `desktop-nightly-v0.0.11-nightly.20260712.1`). `N` starts at `1` and only
    distinguishes multiple nightlies cut on the same date. It produces a GitHub
    pre-release and feeds the nightly updater manifest.
  - The numeric `0.0.PATCH` base must be **new for every Desktop build in either
    channel**. Windows MSI and Tauri's updater compare only that numeric base, so
    reusing it would make a newer nightly invisible. Choose a base greater than
    every already-shipped Desktop build; switching from a higher nightly build to
    an older stable build is a downgrade and is intentionally not automatic.
- Per-component git tags drive releases:
  `shared-v*`, `bridge-v*`, `relay-v*`, `desktop-stable-v*`,
  `desktop-nightly-v*`, `mobile-v*`
  (mobile may append `+<buildNumber>`, e.g. `mobile-v0.0.1-alpha.20260621+5`).
- **Source tracks the tag — bump EVERY version file AND its lockfile in the same
  commit.** A stale lockfile is silent drift: the npm/desktop release workflows
  re-apply the version at build time with `--allow-same-version`, which **masks**
  an un-bumped source lock (that is exactly how `uxnandesktop/package-lock.json`
  sat at `0.0.2` while the app shipped `0.0.3`/`0.0.4`). So bump **all** of a
  component's version-bearing files, and re-sync the lockfile, before tagging:
  - **npm (shared / bridge / relay):** `package.json` **and the root
    `package-lock.json`** — use `npm version <v> -w <ws> --no-git-tag-version`
    (it updates **both**), not a hand edit of `package.json`.
  - **desktop:** the **numeric base** (`0.0.PATCH`, MSI-safe — the Windows MSI
    rejects a non-numeric pre-release id; the full version rides the tag + the
    compiled-in `UXNAN_VERSION`) in **all five**: `src-tauri/tauri.conf.json`,
    `src-tauri/Cargo.toml`, **`src-tauri/Cargo.lock`** (the `uxnan-desktop`
    entry), `uxnandesktop/package.json`, **and `uxnandesktop/package-lock.json`**
    (`npm install --package-lock-only` to re-sync the lock). Do **not** rely on
    the CI `npm version` step to fix the lock — that leaves the committed lock
    drifting.
  - **mobile:** `pubspec.yaml` (its `pubspec.lock` carries no app version).
    `release-mobile.yml` **fails** the release on a pubspec↔tag mismatch.
  - **Verify before tagging:** each manifest version **equals** its lockfile
    counterpart (`node -p "require('./uxnandesktop/package-lock.json').version"`
    etc.). Never commit a manifest/lock version mismatch.
- npm packages publish to the **`latest`** dist-tag, so `npm install`
  (`npm install -g uxnan-bridge`) and the bridge's self-update check always
  resolve the **newest** release. Pre-release channels (`alpha`/`beta`) are
  **opt-in** — the maintainer adds them manually per build when wanted, e.g.
  `npm dist-tag add uxnan-bridge@<version> beta`. (Historically the workflow
  published under `alpha`, which left `latest` stuck at the very first version;
  see *Fixing an already-published package's `latest`* below.)
- Mobile ships to **Google Play** (open testing / beta); desktop to **GitHub
  Releases** (draft).

## Release checklist

Cutting a release for component `<comp>` (tag `<comp>-v<version>`; Desktop uses
the channel-specific forms above):

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
   confirm the artifact actually landed: npm shows the new version on the `latest`
   dist-tag (`npm view <pkg> dist-tags.latest`) / the Play **open-testing** (beta)
   track has the new build / the desktop **GitHub Release** draft exists. A red or
   half-finished run is **not** a release — fix it.
6. **Record it** — add the row to the *History* table below (date + the component's
   new version) and commit it to `main`, as the last release step (see the
   automation note under the table).

## Fixing an already-published package's `latest`

The workflow **used to** publish under the `alpha` dist-tag. Because npm only sets
`latest` on a package's **first** publish and `--tag alpha` never moves it, the
already-published packages have `latest` stuck at their first version
(`0.0.1-alpha.20260627`) even though newer versions exist under `alpha`. So
`npm install -g uxnan-bridge` installs the *oldest* build.

The workflow is now fixed (publishes to `latest`), but the **existing** packages
need a one-time manual `latest` move — this requires npm publish rights and is
**not** something CI does. From an `npm login`'d shell, point `latest` at the
newest published version (see the *History* table for the current newest):

```bash
npm dist-tag add @uxnan/shared@0.0.3-alpha.20260702 latest
npm dist-tag add uxnan-bridge@0.0.3-alpha.20260702 latest
# relay's latest is already its newest (0.0.1-alpha.20260627) — nothing to do.
```

Verify with `npm view <pkg> dist-tags`. Optionally drop the now-redundant `alpha`
tag (`npm dist-tag rm uxnan-bridge alpha`) — leaving it is harmless. From the next
release onward the workflow keeps `latest` current automatically.

## History

| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |
| ----------------- | ------ | ------ | ----- | ------- | ------ |
| 2026-07-13 | — | — | — | 0.0.11-nightly.20260713.2 | — | <!-- desktop: richer provider usage — reset time, Codex resets + redeem, account type, Grok $ (PR #62) — nightly channel -->
| 2026-07-13 | — | — | — | 0.0.11-nightly.20260713.1 | — | <!-- desktop: multi-agent orchestration run engine + broadcast rework (PR #61) — nightly channel -->
| 2026-07-11 | — | — | — | 0.0.10-nightly.20260711.1 | — | <!-- desktop: Grok provider usage statistics (PR #60) — nightly channel -->
| 2026-07-11 | 0.0.5-alpha.20260711 | 0.0.5-alpha.20260711 | — | 0.0.9-alpha.20260711 | 0.0.5-alpha.20260711+20260711 | <!-- shared/bridge: interactive ACP question/approval workflows plus Zero and Grok; desktop: file workspace, smart sidebar, agent views and provider usage; mobile: Zero/Grok, question cards and clearer turn errors (PRs #56-#58) -->
| 2026-07-05 | — | — | — | 0.0.8-alpha.20260705 | — | <!-- desktop: tooltip system, project cards/icons/tabs, batch theme import, bulk add projects, worktree gating (PRs #47-#52) -->
| 2026-07-05 | — | — | — | 0.0.7-alpha.20260705 | — | <!-- desktop: update toast redesign with elevated card + release notes link (PR #53) -->
| 2026-07-04 | — | — | — | 0.0.6-alpha.20260704 | — | <!-- desktop: browser MCP server for agents (PR #50) -->
| 2026-07-03 | — | — | — | 0.0.5-alpha.20260703 | — | <!-- desktop-only hotfix: blank-screen (rune in plain .ts) -->
| 2026-07-03 | 0.0.4-alpha.20260703 | 0.0.4-alpha.20260703 | — | 0.0.4-alpha.20260703 | 0.0.4-alpha.20260703+20260703 |
| 2026-07-02 | 0.0.3-alpha.20260702 | 0.0.3-alpha.20260702 | — | 0.0.3-alpha.20260702 | 0.0.3-alpha.20260702+20260702 |
| 2026-06-28 | 0.0.2-alpha.20260628 | 0.0.2-alpha.20260628 | — | 0.0.2-alpha.20260628 | 0.0.2-alpha.20260628+20260629 |
| 2026-06-28 | — | — | — | — | 0.0.1-alpha.20260628+20260628 |
| 2026-06-27 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627+20260627 |

> FOR-DEV: once the release pipeline is validated end-to-end, a final step in
> each release workflow can append/update the matching cell here automatically
> (commit the row back to `main`). Until then, add rows by hand at release time.
