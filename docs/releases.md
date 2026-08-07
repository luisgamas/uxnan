# Releases — how the automation works

Everything about cutting and publishing a version of Uxnan: what happens by
itself, what waits for you, and what to do when something goes wrong.

[`VERSIONS.md`](../VERSIONS.md) stays the source of truth for the **convention**
(version formats, tag names, which files carry a version). This page is about the
**machinery** that follows it.

---

## The short version

| I want to… | Do this |
|---|---|
| See what needs releasing | `npm run release:status` |
| Cut a nightly desktop build | Nothing — it happens at 00:20 Mexico City if there is something to ship |
| Cut anything else | Actions → **Release — cut versions** → tick the components → Run |
| Publish a stable desktop build | Review the draft release on GitHub and press **Publish** |
| Bring `main` level after a cut | Merge the `build(release): …` pull request the run opened |
| Know why a release did not happen | Read the run summary; a component with no real change is skipped on purpose |

---

## What is automated, and what is not

**Automated.** Working out whether a component genuinely changed, computing the
next version, writing it into every version-bearing file, proving those files
agree, adding the `VERSIONS.md` history row, committing, tagging, pushing the
tag, opening the pull request that brings all of it into `main`, and — for a
desktop **nightly** — writing the release notes and publishing.

**Not automated, on purpose.**

- **Publishing a stable desktop release.** The draft arrives complete: installers,
  signatures, `latest.json`, and its notes already written. Pressing *Publish* is
  the moment it becomes the default download and the updater starts offering it.
  That is a judgement call, not a build step.
- **Merging the bump pull request.** `main` is protected and stays that way; the
  run opens the PR, you merge it. The tags already point at those commits, so the
  builds never wait for it.
- **Enriching the `VERSIONS.md` note.** The row itself is written for you — date,
  version in its column, and a summary seeded from the pull request titles the
  release contains. Rewrite that summary if it deserves better prose; nobody has
  to remember to add the row.
- **The CHANGELOG.** The tooling never writes your prose. For a stable release,
  rename `## [Unreleased]` to the version yourself before cutting.

---

## The two entry points

### The nightly, at 00:20 Mexico City

`release.yml` runs on a cron at **06:20 UTC**, which is 00:20 in Mexico City
(UTC−6 all year). It asks whether `uxnandesktop/` has changed in a way that can
affect a build since the last desktop tag **in either channel**. If not, it
finishes green having done nothing — most days.

The time is not arbitrary. Version stamps are UTC, and 00:20 local is 06:20 UTC
**of the same date**, so `nightly.20260808.1` really is the nightly of the 8th on
your calendar. Cutting at 23:00 local would stamp it with the following day.

### The dispatch, for everything else

Actions → **Release — cut versions**. Tick `shared`, `bridge`, `relay`, `mobile`;
pick `none` / `nightly` / `stable` for the desktop. Two switches matter:

- **`dry_run`** — on by default. Computes and prints everything, tags nothing.
  Use it first when releasing several components together.
- **`force`** — cut even when nothing release-worthy changed. Rarely right;
  its usual use is republishing after a failed publish.

---

## The credential, and why `main` is never touched

Two constraints shaped this, and neither is about permissions being convenient.

**The workflow never pushes to `main`.** The bump commit lands on a
`release/<timestamp>` branch, the tag points at that commit, and a pull request
brings it into `main` through the same reviewed path as everything else. So the
`main-protection` ruleset stays exactly as it is: **nothing is added to its
bypass list**. Granting a bypass to the `github-actions` app would let *any*
workflow in the repository write to `main`, which is a much larger door than this
needs.

**But a tag pushed with `GITHUB_TOKEN` starts no build.** GitHub refuses to
trigger a workflow from an event created with the default token — its
anti-recursion rule — so `release-desktop.yml` would simply never run. This is
the one thing the automation cannot do with the permissions it is given.

The fix is a **GitHub App** used only for this, which is narrower than a personal
token in three ways that matter: its permissions are just `contents: write` and
`pull requests: write` on this repository, the token it mints **expires in an
hour**, and it appears in the audit log as itself rather than as you.

### Setting it up (once, in a browser — the API cannot create apps)

1. **Settings → Developer settings → GitHub Apps → New GitHub App.**
   Name it something like `uxnan-release`. Homepage URL can be the repo. Uncheck
   **Webhook → Active**.
2. **Repository permissions:** `Contents: Read and write`, `Pull requests: Read
   and write`. Nothing else.
3. **Where can this app be installed:** *Only on this account*. Create it.
4. On the app's page: **Generate a private key** (downloads a `.pem`), and note
   the **App ID**.
5. **Install App** → this repository only.
6. In the repo: **Settings → Secrets and variables → Actions**
   - **Variables** → `RELEASE_APP_ID` = the App ID
   - **Secrets** → `RELEASE_APP_PRIVATE_KEY` = the whole `.pem`, including the
     `-----BEGIN…` and `-----END…` lines.

### Until it exists

The run still does everything else: it plans, refuses empty or backwards
versions, writes every version file, verifies them, commits, creates the tag
locally and opens the bump pull request. It stops short of *pushing* the tag and
prints the one command to finish:

```
git push origin desktop-nightly-v0.0.30-nightly.20260808.1
```

That is deliberate. Pushing a tag that triggers nothing would leave a released
version with no build behind it — worse than stopping.

---

## Order, and why it is not negotiable

`release-npm.yml` resolves `@uxnan/shared` **from npm at build time**. Tagging
`shared` and `bridge` together therefore publishes a bridge pinned to the
*previous* shared — and because `HandlerRouter` validates every request against
the shared method registry, that bridge answers this cycle's new methods with
"method not found". It happened once, on 2026-08-03.

So the run cuts `shared` first, then **waits until `npm view @uxnan/shared
version` reports the new version**, and only then tags its consumers. If npm
never serves it, the run fails and the consumers are left untagged — deliberately
better than publishing them against the wrong dependency.

---

## What each tag triggers

```
shared-v* / bridge-v* / relay-v*   → release-npm.yml      → npm, `latest` dist-tag
mobile-v*                          → release-mobile.yml   → Play, open testing
desktop-stable-v*                  → release-desktop.yml  → installers + DRAFT release
desktop-nightly-v*                 → release-desktop.yml  → installers + published pre-release
publishing any desktop release     → release-desktop-manifest.yml → rolls latest.json onto that channel
```

That last line is the one worth remembering: **the in-app updater only sees a
build once its release is published**, because publishing is what copies
`latest.json` onto the rolling channel release. A stable sitting in draft is
invisible to users, which is exactly the point.

---

## The release body

`tauri-action` creates the draft with an **empty** body. The "What's Changed" list
you are used to comes from GitHub's *Generate release notes*, and the automation
now produces the same thing — with one correction.

Left to pick its own baseline, GitHub compared a nightly against the previous
*nightly*: two weeks and six releases back. It listed 15 pull requests, 9 of them
already shipped. The automation passes `previous_tag_name` explicitly — the last
desktop build in either channel — which for that release gave the 6 that were
actually new.

The **Contributors** block at the bottom of a published release is *not* part of
the body. GitHub renders it from the commit range once the release is published,
so there is nothing to generate or paste; it appears by itself.

---

## What not to do

- **Do not push a release tag by hand.** The tag is what builds and, for a
  nightly, publishes. Cutting one without the matching version bump ships a build
  whose files disagree with its tag.
- **Do not reuse a desktop numeric base.** The Windows MSI and the Tauri updater
  compare only `0.0.PATCH`. A reused base does not fail — it ships a build nobody
  can see. The tooling refuses it; do not work around it.
- **Do not hand-edit a version file.** `npm run release:prepare` writes all of
  them and then reads them back. A manifest that disagrees with its lockfile is
  invisible until a release ships wrong: `--allow-same-version` in the release
  workflows masks it at build time.
- **Do not lower `timeout-minutes` in the verify workflows.** It counts from the
  moment a job is *queued*. During the Actions outage of 2026-08-06, jobs were
  cancelled at 15m01s having never started.
- **Do not publish a desktop draft without checking its run went green.** A draft
  exists even when a platform leg failed.

---

## When something goes wrong

**A release is public but the updater does not offer it.** `latest.json` on the
rolling channel was not rolled, because the publish event came from
`GITHUB_TOKEN` — the same anti-recursion rule that stops a tag from starting a
build. It happened to 0.0.30. Unpublish and publish it again from the UI or with
your own `gh`, which is a real event.

**A tag exists but nothing built.** The tag was pushed with `GITHUB_TOKEN`,
which cannot start a workflow. Either the app credential is missing (the run
warns and prints the push command) or someone pushed the tag from a workflow by
hand. Push the tag again from your own machine — `git push origin <tag>` on an
existing tag is a no-op for git but a real event for Actions — or delete and
re-push it.

**A release ran but published nothing.** Check whether every component was
skipped: the summary lists each one and why. "only docs changed" means exactly
that, and it is the intended behaviour.

**npm never served the new shared.** The run fails after tagging shared. Check
`release-npm.yml`; once it is green and `npm view @uxnan/shared version` reports
the version, re-run the dispatch for the consumers only.

**A nightly published something broken.** Delete the release and its tag, then cut
a new one — the base must still move forward, so the next nightly gets a higher
`0.0.PATCH`. Never re-cut the same base.

---

## The pieces

| Path | What it is |
|---|---|
| `.github/workflows/release.yml` | the entry point: dispatch + the nightly cron |
| `.github/workflows/release-desktop.yml` | builds installers, writes the body, publishes a nightly |
| `.github/workflows/release-desktop-manifest.yml` | rolls `latest.json` onto a channel when a release is published |
| `.github/workflows/release-npm.yml`, `release-mobile.yml` | publish to npm and Play |
| `scripts/release/` | the decisions: what needs releasing, what version, which files, and the history row ([README](../scripts/release/README.md)) |
| `VERSIONS.md` | the convention, and the release history |
