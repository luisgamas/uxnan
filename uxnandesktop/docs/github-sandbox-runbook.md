# GitHub sandbox — supervised live-run runbook

The write side of the GitHub integration is exercised **live** against one
disposable repository, under supervision. This runbook is the procedure: every
step names the exact command, what it will do, what output to expect, and how
the remote outcome is verified. Nothing in it touches any other repository —
the tooling refuses to (see *Safety model* below).

**Operator:** the maintainer, at a terminal, reading each step's output before
the next. The first execution of every destructive action is supervised by
design; only after a full green pass does re-running become routine.

## Safety model (what makes this runnable at all)

- The **only** mutable target is `luisgamas/uxnan-gh-sandbox`, allowlisted as
  an exact string in `scripts/github/lib.mjs` (harness) and
  `src-tauri/tests/github_live.rs` (live suite), and armed per run via
  `UXNAN_GH_SANDBOX` — which must equal it exactly. Anything else, including
  and especially `luisgamas/uxnan`, is refused by name with an explanation.
- The sandbox **self-identifies** with the `uxnan-gh-sandbox` topic; every
  mutating run re-reads it first. Right name + missing marker = refusal.
- **Dry-run is the default** for the harness; `--execute` is explicit. Every
  mutation is followed by a **GET re-read** that verifies the remote outcome —
  exit 0 is never taken as success on its own.
- A failed `--execute` writes `scripts/github/.sandbox-failure.json`
  (sanitized ids only) and **blocks further execution** until a human inspects
  the sandbox, cleans up, and deletes the file.
- **No token is read, stored or passed** anywhere in this flow: `gh` owns
  authentication (OS keyring), exactly as in the app.
- The live tests are all `#[ignore]` — `cargo test` can never run them by
  accident — and each panics with instructions when `UXNAN_GH_SANDBOX` is
  missing or wrong.

Account facts this plan is built around: one account (`luisgamas`), scopes
`gist, project, read:org, repo, workflow` (no `delete_repo` — see step 8), no
second collaborator account, no cross-account fork. Cells needing those are
marked *unsupported: single account* in
[`github-validation.md`](github-validation.md). The sandbox is created
**public** because free-account rulesets are only *enforced* on public
repositories — a private sandbox would validate nothing about protection.

## Prerequisites

```powershell
gh --version          # 2.95.0 or newer
gh auth status        # luisgamas, keyring, scopes incl. repo + workflow
cd uxnandesktop
$env:UXNAN_GH_SANDBOX = "luisgamas/uxnan-gh-sandbox"
```

Every step below assumes `uxnandesktop/` as the working directory and the
variable exported. Un-set it when done: it is the arming switch.

## Step 1 — dry-run everything first

```powershell
node scripts/github/sandbox.mjs status      # read-only report
node scripts/github/sandbox.mjs setup       # prints the creation plan, touches nothing
node scripts/github/sandbox.mjs protect     # prints the ruleset plan
node scripts/github/sandbox.mjs cleanup     # prints the cleanup plan
```

Read each plan. Every command it prints names `luisgamas/uxnan-gh-sandbox`
explicitly; if anything looks off, stop here — nothing has happened yet.

## Step 2 — create the sandbox (supervised)

```powershell
node scripts/github/sandbox.mjs setup --execute
```

Expected: four steps, each ending in `verified: …` — repo created (public,
README), marker topic stamped, `sleep.yml` workflow committed (dispatch-only,
sleeps 10 min, exists so *cancel* always has a target), `allow_auto_merge`
enabled. Re-run `status` after: repo exists, marker present, branches = `main`.

## Step 3 — reads against the sandbox (no mutations)

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_status_and_context_resolve_the_sandbox -- --ignored --nocapture
```

Proves the production status / clone / context / branches / rate-limit chain
against the real repo before anything writes.

## Step 4 — issue lifecycle (first mutations; smallest blast radius)

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_issue_lifecycle_is_verified_remotely -- --ignored --nocapture
```

Create (labeled `bug`) → verify → edit → comment → verify → close → reopen →
close. Every transition is re-read through `issue_view` before the next.
Expected end state: one closed issue titled `Live validation issue
uxnan-live-<epoch> (edited)`.

## Step 5 — PR lifecycle on an unprotected main

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_pr_lifecycle_create_review_merge -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_draft_refuses_merge_until_ready -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_stale_head_merge_is_refused -- --ignored --nocapture
```

What each proves, in order: create → comment → review-comment → **self-approval
refused** (single-account truth) → squash-merge with `--match-head-commit` →
re-read `MERGED`; draft refuses to merge → `pr ready` → merges; a push after
reading the head oid makes the stale `--match-head-commit` merge **fail** and
the PR stays open (then closed as cleanup).

The refusal tests **print gh's verbatim message** — copy each into
`tests/fixtures/github/mutation-outcomes.json`, replacing the corresponding
`confidence: "modeled"` case's text and flipping it to `source-exact`
(re-run `cargo test --test github_cli` after; the offline suite then asserts
the *real* bytes).

## Step 6 — protect main, verify the block, verify the bypass

```powershell
node scripts/github/sandbox.mjs protect --execute
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_ruleset_blocks_then_admin_bypass_merges -- --ignored --nocapture
```

The ruleset mirrors production (1 review, thread resolution, merge+squash
only). Expected: the policy probe reports `protected` with `rebase` gone; the
plain merge is **refused** (message printed verbatim — capture it as above);
the `--admin` bypass merges; the PR re-reads `MERGED`.

To leave the sandbox unprotected again (e.g. before re-running step 5):

```powershell
node scripts/github/sandbox.mjs unprotect --execute
```

## Step 7 — Actions: dispatch, cancel, log

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test github_live `
  github_live_actions_dispatch_cancel_and_log -- --ignored --nocapture
```

Dispatches `sleep.yml`, waits for it to appear, cancels it through the
production `run_cancel`, waits for it to settle, reads its log. The workflow
only sleeps; worst case (a failed cancel) it times out on its own in 12 min.

## Step 8 — cleanup

```powershell
node scripts/github/sandbox.mjs cleanup            # read the plan
node scripts/github/sandbox.mjs cleanup --execute  # close PRs/issues, cancel runs, delete branches
```

Idempotent — safe to run again after any partial failure. To delete the
repository entirely (optional; the sandbox is also fine parked):

```powershell
gh auth refresh -h github.com -s delete_repo   # the token lacks delete_repo today
node scripts/github/sandbox.mjs cleanup --execute --delete-repo
```

If any `--execute` fails, `scripts/github/.sandbox-failure.json` now exists and
blocks further execution: inspect the sandbox on github.com, finish the
cleanup (usually just re-running it), then delete the file.

## Step 9 — the opt-in E2E journey (same operator session)

With no other uxnan instance running (the suite refuses otherwise):

```powershell
npm run bench:build         # release binary with the frontend embedded
npm run test:e2e:setup
$env:UXNAN_E2E_FAKE_GH = "1"
npm run test:e2e -- --spec tests/e2e/specs/github-fake.e2e.mjs
```

No network involved — `gh` is the fixture answering with the captured real
payloads; what this proves is the shipped app's own chain (PATH → spawn →
parse → IPC), including the `.cmd` resolution path on Windows.

## Step 10 — close the loop

Per [`github-validation.md`](github-validation.md) → *What a supervised run
must update*: flip the `pending` cells (with the date), commit the re-captured
refusal texts, update the quality matrix's `github` row and `docs/testing.md`'s
L5 rows 1–2. The run is not "done" until the docs say what it proved.
