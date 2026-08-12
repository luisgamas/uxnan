# Releases — how the automation works

Everything about cutting and publishing a version of Uxnan: what happens by
itself, what waits for you, and what to do when something goes wrong.

This page is the whole of it: the **convention** (version formats, tag names,
which files carry a version) and the **machinery** that follows it.

> **`VERSIONS.md` was removed on 2026-08-10.** It held the convention — which now
> lives here — and a hand-kept history table of what shipped when. The table had
> no readers: versions come from git tags, and *what shipped* is a GitHub release
> with its notes and its installers. Keeping a second copy by hand only created a
> way to be wrong (it was already forgotten once, for desktop 0.0.29). Every row
> it ever held is in the repository's history if you need it —
> `git show <commit>:VERSIONS.md`.

---

## The short version

| I want to… | Do this |
|---|---|
| See what needs releasing | `npm run release:status` |
| Cut a nightly desktop build | Nothing — it happens at 00:20 Mexico City if there is something to ship |
| Cut anything else | Actions → **Release — cut versions** → tick the components → Run |
| Publish a stable desktop build | Review the draft release on GitHub and press **Publish** |
| Bring `main` level after a cut | Nothing — the run merges its own bump pull request once `verify` is green |
| Know why a release did not happen | Read the run summary; a component with no real change is skipped on purpose |

---

## What is automated, and what is not

**Automated.** Working out whether a component genuinely changed, computing the
next version, writing it into every version-bearing file, proving those files
agree, **heading the CHANGELOG with that version**, committing, tagging, pushing
the tag, opening the pull request that brings all of it into `main` **and merging
it once its checks pass**, and — for a desktop **nightly** — writing the release
notes and publishing. A nightly at 00:20 local therefore finishes on its own,
with nobody awake.

**Not automated, on purpose.**

- **Publishing a stable desktop release.** The draft arrives complete: installers,
  signatures, `latest.json`, and its notes already written. Pressing *Publish* is
  the moment it becomes the default download and the updater starts offering it.
  That is a judgement call, not a build step.
- **CHANGELOG *entries*.** The heading is written for you — it is a version and
  a date, and the cut already knows both. The prose under it is not: every entry
  is authored in the pull request that changed the behaviour, which is the only
  place anyone knows what happened. If `[Unreleased]` is empty at cut time the
  run says so out loud, because a release with nothing to tell anyone is a
  mistake, not a style.
- **Google Play's "what's new", for a mobile release.**
  `.github/whatsnew/whatsnew-en-US` and `whatsnew-es-ES` must describe *this*
  version in plain, non-technical language, **≤ 500 characters each**. A workflow
  can check shape, never meaning — so it checks everything about them that is
  mechanical: present, non-empty, under the limit, not a placeholder, **and
  touched since the previous `mobile-v*` tag**. That last one exists because the
  notes for 0.0.19 were valid prose about 0.0.18 and would have shipped: files
  nobody has edited since the last release either describe that release or were
  never reviewed.

---

## The two entry points

### The nightly, at 00:20 Mexico City

`release.yml` runs on a cron at **06:20 UTC**, which is 00:20 in Mexico City
(UTC−6 all year). It asks whether `uxnandesktop/` has changed in a way that can
affect a build since the last desktop tag **in either channel**. If not, it
finishes green having done nothing — most days.

"In a way that can affect a build" excludes prose *and tests*: a documentation
pass or a test-only fix does not earn four installers, a published pre-release
and an updater roll for a binary nobody can tell apart. `npm run release:status`
shows both counts, and `scripts/release/README.md` lists what each class covers.

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

## The credential, and why `main` is still protected

Two constraints shaped this, and neither is about permissions being convenient.

**A tag pushed with `GITHUB_TOKEN` starts no build.** GitHub refuses to trigger a
workflow from an event created with the default token — its anti-recursion rule —
so `release-desktop.yml` would simply never run.

**And `main` must not become writable by workflows.** Granting a bypass to
`github-actions` would let *any* workflow in the repository through, including
one a future pull request introduces. That door was never opened and is not open
now.

Both are answered by the same thing: a **GitHub App**, `Uxnan Releases`, used
only for this. It is narrower than a personal token in three ways that matter —
its permissions are just `contents: write` and `pull requests: write` on this
repository, the token it mints **expires in an hour**, and it appears in the
audit log as itself rather than as you.

### How the pull request merges itself

`Uxnan Releases` is a **bypass actor on the `main-protection` ruleset, in
pull-request mode** (`Allow for pull requests only`). That mode is precise about
what it grants:

- the app **cannot push to `main`** — it must open a pull request, exactly as
  before;
- an operation **authenticated as the app** may merge that pull request without
  the required approval;
- **nothing else changes.** `GITHUB_TOKEN` is not this app, so ordinary
  workflows, and pull requests from forks, are as restricted as they ever were.
  Your own pull requests still need their approval.

This is why `git config user.name "…[bot]"` is irrelevant to it — that only
writes commit metadata. What GitHub matches against the bypass list is the
identity behind the token: `actions/create-github-app-token`, passed to
`actions/checkout` and to `gh` as `GH_TOKEN`.

The `land` job merges the pull request only after its **`verify`** checks pass.
Deliberately not *every* check on the commit: the release build reports onto the
same SHA, because the tag points at it, and a macOS leg is allowed to fail there
on purpose. A red `verify` means `main` itself is red — this pull request adds
nothing but version numbers — so it is left open and the job goes red with it.
**Re-run just that job** once the checks are fixed; it is a separate job for
exactly that reason, since re-running the cut would compute a *next* version and
tag it, burning a number to fix a merge.

One implementation detail worth keeping, because it cost a release to find: the
merge is the **REST** endpoint (`PUT /repos/…/pulls/…/merge`), not `gh pr merge`.
The latter goes through GraphQL `mergePullRequest`, which refuses on the pull
request's static state — *"the base branch policy prohibits the merge"* — before
the actor's bypass is ever consulted; the ruleset never even recorded an
evaluation. It is the same call `gh pr merge --admin` makes: the flag is named
for how a human uses it, but what it selects is this path, and the server then
authorizes against whatever the token's actor is allowed to do.

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
7. **Settings → Rules → Rulesets → `main-protection` → Bypass list → Add
   bypass** → the app, with **`Allow for pull requests only`**. Not
   *Repository administrators*, not `github-actions`, and not *Always allow* —
   pull-request mode is what keeps it unable to push to `main`.

### Until it exists

The run still does everything else: it plans, refuses empty or backwards
versions, writes every version file, verifies them, commits, creates the tag
locally and opens the bump pull request. It stops short of *pushing* the tag —
and of merging that pull request, since the bypass belongs to the app — and
prints the one command to finish:

```
git push origin desktop-nightly-v0.0.30-nightly.20260808.1
```

That is deliberate. Pushing a tag that triggers nothing would leave a released
version with no build behind it — worse than stopping.

---

## The version convention

Components version **independently** — each has its own patch — but a shared
`-alpha.YYYYMMDD` date suffix marks releases cut on the same day, so you can tell
which versions go together. Base SemVer starts at `0.0.1`: pre-1.0 means
unstable, and breaking changes are allowed.

| Component | Version form | Tag |
|---|---|---|
| shared / bridge / relay | `0.0.PATCH-alpha.YYYYMMDD` | `shared-v*`, `bridge-v*`, `relay-v*` |
| mobile | `0.0.PATCH-alpha.YYYYMMDD+BUILD` | `mobile-v*` (Play needs a rising integer) |
| desktop — stable | `0.0.PATCH` | `desktop-stable-v0.0.PATCH` |
| desktop — nightly | `0.0.PATCH-nightly.YYYYMMDD.N` | `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` |

`YYYYMMDD` is UTC and orders correctly under SemVer. Desktop's `N` starts at `1`
and only separates several nightlies cut on the same date.

**The desktop's numeric base must be new against *both* channels.** The Windows
MSI and Tauri's updater compare only `0.0.PATCH`, so reusing a base does not fail
— it ships a build nobody can see. A stable therefore takes the next base above
every nightly too, and going from a higher nightly back to an older stable is a
downgrade the updater will not perform. The tooling refuses a base that does not
move past both; do not work around it.

**`web/` is deliberately outside all of this.** It publishes no artifact and has
no consumers, so it carries no tag: a push to `main` runs `deploy-web.yml`, which
uploads the static export to Cloudflare Pages. See [`web/docs/deploy.md`](../web/docs/deploy.md).

### Which files carry a version

A release must move **every** file below *and its lockfile*, in the same commit.
A stale lockfile is silent drift, because the release workflows re-apply the
version at build time with `--allow-same-version` — which **masks** an un-bumped
committed lock. That is exactly how `uxnandesktop/package-lock.json` sat at
`0.0.2` while the app shipped `0.0.4`.

| Component | Files |
|---|---|
| shared / bridge / relay | `<component>/package.json` **and the root `package-lock.json`** — use `npm version <v> -w <ws> --no-git-tag-version`, which updates both |
| desktop | `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `uxnan-desktop` entry), `uxnandesktop/package.json`, `uxnandesktop/package-lock.json` |
| mobile | `uxnanmobile/pubspec.yaml` (its lock carries no app version) |

Desktop files take the **numeric base only** (`0.0.PATCH`): the Windows MSI
rejects a non-numeric pre-release id, so the full nightly version rides the tag
and the compiled-in `UXNAN_VERSION`. Mobile's `pubspec.yaml` must match its tag
exactly — `release-mobile.yml` fails the release if they disagree.

`scripts/release/components.mjs` is the machine-readable copy of this table, and
`npm run release:prepare` writes every file then reads them all back to prove
they agree. When a component gains a file that carries a version, it goes in that
registry **and** in the table above.

### npm dist-tags

Packages publish to **`latest`**, so `npm install -g uxnan-bridge` and the
bridge's own update check always resolve the newest release. `alpha`/`beta` are
opt-in, added by hand per build when wanted:
`npm dist-tag add uxnan-bridge@<version> beta`.

This was once wrong in a way worth remembering: the workflow published under
`--tag alpha`, and since npm only sets `latest` on a package's *first* publish,
`latest` stayed pinned to the oldest build while newer ones hid under `alpha` —
`npm install` handed you the first version ever released. Fixed in the workflow,
and the affected packages were moved forward by hand
(`npm dist-tag add <pkg>@<version> latest`, which needs publish rights and is not
something CI does). All three now resolve correctly; verify any time with
`npm view <pkg> dist-tags`.

---

## Cutting one by hand

You should not need this — `release.yml` does all of it, and cutting by hand is
how the drift above happened. It is here for the case where the workflow cannot
run at all.

1. **Pre-flight.** The commit you will tag is green on CI, and its `CHANGELOG.md`
   `[Unreleased]` says what actually ships. `npm run release:status` confirms the
   component genuinely has something to release.
2. **Write the version.** `npm run release:prepare -- <component> [--channel=nightly]`
   computes it, refuses it if the base would not move past every channel, writes
   every file from the registry, heads the CHANGELOG with it, reads the version
   files back, and prints the exact commit and tag commands. It never commits,
   tags or pushes. `--dry-run` prints all of it and writes nothing.
3. **Mobile only, and non-negotiable:** commit **and push** the `pubspec.yaml`
   bump *before* tagging, so the tagged commit carries the matching version. Also
   rewrite `.github/whatsnew/whatsnew-en-US` and `whatsnew-es-ES` — a short,
   non-technical, user-facing summary, **≤ 500 characters each**. The workflow
   fails the release if either is missing, empty, a leftover placeholder, or over
   the limit.
4. **Tag and push**, which is what triggers `release-<component>.yml`. For npm
   components, respect the ordering in the next section.
5. **Validate.** A red or half-finished run is not a release. Confirm the artifact
   landed: `npm view <pkg> dist-tags.latest`, the Play open-testing track, or the
   desktop GitHub Release.

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

**The build compiled everything and then failed to create the release** —
*"Resource not accessible by integration"*, every leg, `create-a-release`. The
Actions token can upload assets to a release that exists and be refused when
creating one, with `Contents: write` granted; it happened on 0.0.36, twenty-four
minutes after the identical call succeeded for 0.0.35, with nothing changed in
between that anyone could name. Release creation now runs as the **app** rather
than as Actions, which is what every other release operation here already does.
To recover a build already in this state, create the draft yourself
(`gh api --method POST repos/OWNER/REPO/releases -f tag_name=… -F draft=true -F
prerelease=true`) and re-run the failed jobs: `tauri-action` finds the existing
draft and uploads into it.

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
skipped: the summary lists each one and why. "nothing that ships changed" means
exactly that, and it is the intended behaviour.

**A version was cut for nothing** — identical installers, an empty release body.
Its predecessor's release pull request was left open. A tag on an unmerged
`release/…` branch is not an ancestor of `main`, so diffing `main` against it
reports the version files as changed, and by path a manifest is shippable. This
cut 0.0.34 out of nothing and would have repeated every night. Two things guard
it now: a version file is judged by *what* changed inside it (only the version
line moved → bookkeeping), and `npm run release:status` prints a ⚠ when the last
tag has not landed on `main`. The fix for the state itself is simply to merge the
pull request. The wasted version number is not recoverable — bases never repeat.

**npm never served the new shared.** The run fails after tagging shared. Check
`release-npm.yml`; once it is green and `npm view @uxnan/shared version` reports
the version, re-run the dispatch for the consumers only.

**A nightly published something broken.** Delete the release and its tag, then cut
a new one — the base must still move forward, so the next nightly gets a higher
`0.0.PATCH`. Never re-cut the same base.

---

## Proven, and still to prove

Every component except the relay has now been through the whole path for real,
and the defects that found are fixed and pinned by tests.

| Component | Exercised | What is still unproven |
|---|---|---|
| desktop | ✅ 0.0.29 → 0.0.39, both channels: nightlies cut unattended and landing their own pull request, and **0.0.39 as a stable** — draft built, reviewed, published, and the stable updater channel rolled 0.0.28 → 0.0.39 while nightly stayed at 0.0.38 | — |
| shared | ✅ 0.0.14-alpha.20260810 — tagged, published, `latest` moved | — |
| bridge | ✅ 0.0.19-alpha.20260810 — **published pinned to the shared cut minutes earlier**, which is the whole reason this is one workflow | — |
| mobile | ✅ 0.0.19-alpha.20260810+20260810 — pubspec↔tag gate passed on a pubspec `prepare.mjs` wrote, notes gate passed, uploaded to Play open testing | — |
| relay | ❌ | nothing has changed in `relay/` that reaches a build since the automation existed, so it has never been cut by it |

**The npm-visibility wait ran for real** on that cut, and it is the one thing no
dry run could have shown: the run tagged shared, waited (`waiting for npm to
serve @uxnan/shared@0.0.14-alpha.20260810` → `npm serves 0.0.14-alpha.20260810`),
and only then tagged the bridge. The published bridge resolves
`"@uxnan/shared": "0.0.14-alpha.20260810"` — the version cut minutes before, not
the previous one. That is the failure this workflow exists to prevent, and it is
now observed rather than argued.

**Two steps still belong to a person before a mobile cut**, and both fail the
release rather than degrade it: `.github/whatsnew/whatsnew-{en-US,es-ES}` must
describe *this* version in plain language under 500 characters, and the
`CHANGELOG` heading must be the version being cut. The tooling prints a reminder
and writes neither — the prose is the part someone is supposed to have read.

Two things proved themselves on the 0.0.39 cut by going wrong first, which is
the only way either could have been observed:

- **The `land` job refused to merge**, exactly as designed, because a `verify`
  leg was red. It held that line while the failure was diagnosed — and the
  failure was real (a content block announced after the prose that followed it),
  not the flake it looked like.
- **Re-running only `land`** then merged the pull request without re-cutting
  anything. That is why it is a separate job, and it had never been needed.

Still unproven: the `notes` job surviving a failed macOS leg (`if: always()`) —
every run since that fix has kept its mac legs, so the path it was written for
has not run again. A `build` leg *did* fail on 0.0.39 (ubuntu, a transient
`Not Found` from the release-asset API after its artifacts had already
uploaded), and `notes` ran through it green, which is the same guard from the
other side.

**What the first unattended cut cost, and what it teaches.** 0.0.31 was cut by
the cron with nobody watching, and it got everything right up to the last step:
it saw the merged work, computed the version, wrote the files, pushed the tag,
built four installers and wrote the body — then the *guard* added in the previous
fix refused it. The `--jq` filter counting installers used `\.` for a literal
dot, which jq rejects outright ("invalid escape sequence"), so the step exited
non-zero and the nightly stayed a draft. The lesson is narrow and worth keeping:
**a shell one-liner added to a workflow is untested code shipped straight to
production.** That expression passes through YAML, then bash, then jq, and only
the third one has an opinion about backslashes. It is now a `[.]` character
class, which needs no escaping at any layer, and it was checked against a real
release before being committed. Anything with the same shape — a guard that only
runs on the unhappy path, a filter with escapes — deserves the same treatment.

Cut anything unfamiliar with `dry_run` on first and read the plan — that is how
the shared+bridge+mobile cut was checked before it ran, and the plan showed the
`waitFor` sitting on the right component. If npm ever is slow enough that the
wait times out, the run fails having tagged shared but not the bridge:
recoverable by re-running the dispatch for the bridge alone once
`npm view @uxnan/shared version` reports the new version.

## The pieces

| Path | What it is |
|---|---|
| `.github/workflows/release.yml` | the entry point: dispatch + the nightly cron |
| `.github/workflows/release-desktop.yml` | builds installers, writes the body, publishes a nightly |
| `.github/workflows/release-desktop-manifest.yml` | rolls `latest.json` onto a channel when a release is published |
| `.github/workflows/release-npm.yml`, `release-mobile.yml` | publish to npm and Play |
| `scripts/release/` | the decisions: what needs releasing, what version, and which files carry it ([README](../scripts/release/README.md)) |
| `scripts/release/components.mjs` | the registry — the machine's copy of *Which files carry a version* |
| this page | the convention, and the machinery that follows it |
