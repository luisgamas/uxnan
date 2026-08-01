# GitHub integration — validation status

What of the `gh`-backed GitHub integration is **validated against real data**,
what is validated **against faithful stand-ins**, and what is honestly still
**pending** — with the evidence for each claim. The write-ups that produce this
status live next to it:

- **Command inventory** — [`../tests/github-command-inventory.json`](../tests/github-command-inventory.json):
  every `gh` invocation `src-tauri/src/github.rs` can run (read vs mutation,
  confirmation, scopes, parser, UI consumer, validation evidence), checked
  against the source by `tests/github-command-inventory.test.mjs`.
- **Captured real fixtures** — [`../tests/fixtures/github/`](../tests/fixtures/github/):
  real `gh` responses from `luisgamas/uxnan`, sanitized and frozen with per-file
  provenance (`scripts/github/capture-fixtures.mjs` regenerates them).
- **Sandbox harness + runbook** — [`github-sandbox-runbook.md`](github-sandbox-runbook.md):
  the supervised procedure for the write-side live runs.

**Minimum `gh`:** developed and captured against **`gh` 2.95.0**. The one
version-sensitive path is handled: `gh auth status --json hosts` needs
**gh ≥ 2.63**, and older versions fall back to the prose parser (both parsers
contract-tested; the fallback chain itself is exercised end to end in
`src-tauri/tests/github_cli.rs`). Everything else uses long-stable `gh`
surfaces (`--json` field lists, `gh api`); a too-old gh rejecting a field
surfaces gh's own `Unknown JSON field` message rather than hanging.

## How to read the tables

- **validated (real data)** — the production parser ran against captured real
  GitHub output, or the production runner ran against the real service
  (read-only), and a test pins the result.
- **validated (faithful stand-in)** — exercised through the production code
  against gh-shaped answers whose format is cited from the gh sources
  (`tests/fixtures/github/mutation-outcomes.json` records each case's
  provenance and confidence).
- **pending: supervised sandbox run** — the executable live suite
  (`src-tauri/tests/github_live.rs`, all `#[ignore]`) covers it, but mutations
  require maintainer supervision, so the first execution follows the
  [runbook](github-sandbox-runbook.md). Until that run happens the cell is a
  claim, not a fact.
- **unsupported: single account** — needs a second GitHub account (or a
  cross-account fork), which this project does not have. Simulated where
  simulable; listed so nobody mistakes absence for coverage.

## Read surface

| Area | Status | Evidence |
|---|---|---|
| Sign-in status (structured `--json hosts` + prose fallback) | **validated (real data)** | captures `auth-status-json/text`; `github.rs` fixture tests; fallback chain in `github_cli.rs` |
| Signed-out / gh-missing degradation | **validated (faithful stand-in)** | `github_cli.rs` (`logged-out`, missing-gh); mutation-outcomes provenance |
| PR list (incl. per-row checks roll-up) | **validated (real data)** | `pr-list.json` capture → `pr_list_item_from_json` fixture tests |
| PR detail (files, reviews, comments, commits, checks, skipped check) | **validated (real data)** | `pr-view-132.json` → `pr_detail_from_json` fixture tests |
| PR timeline (commits, comments, merged/closed events) | **validated (real data)** | `pr-timeline-132.json` → `timeline_events_from_json` fixture tests |
| PR diff → Files-changed split | **validated (real data)** | `pr-diff-131.json` → `splitCommitDiff` contract tests (`src/lib/diffParse.test.ts`) |
| Bot-comment Markdown (hidden HTML markers, bare autolinks) | **validated (real data)** | `pr-view-132.json` body → `src/lib/markdown.test.ts` (found and fixed the dropped-bare-URL bug) |
| Merge policy: repo settings ∩ branch rulesets | **validated (real data)** | `repo-view-merge.json`, `repo-rest.json`, `rules-branches-main.json` (the ruleset really guarding `main`) |
| Merge state probe (`mergeStateStatus`, head oid) | **validated (real data)** | `pr-merge-state-132.json` → `merge_state_from_json` |
| Labels / issues list (incl. the honest empty case) | **validated (real data)** | `label-list.json`, `issue-list.json` fixture tests |
| Actions run list (incl. in-progress `conclusion: ""`) | **validated (real data)** | `run-list.json` fixture tests |
| Rate limit / notifications count | **validated (real data)** / numeric parse | `rate-limit.json`; notifications is a `--jq length` numeric |
| Timeouts, truncated JSON, offline, rate-limited, old gh | **validated (faithful stand-in)** | `github_cli.rs` through real child processes |
| `.cmd`-installed gh (Windows shim installs) | **validated (real data, this machine)** | `github_cli.rs` `a_cmd_installed_gh_works…` — failed before the resolution fix, passes after |

## Write surface

| Area | Status | Evidence / cause |
|---|---|---|
| PR create (URL result; no-commits refusal) | **validated (live, 2026-08-01)** + faithful stand-in | `github_live_pr_lifecycle_create_review_merge`; `github_cli.rs` |
| PR comment / review-comment | **validated (live, 2026-08-01)** | `github_live_pr_lifecycle_create_review_merge` |
| Review approve / request-changes | **unsupported: single account** (GitHub refuses them on your own PR — the *refusal* is asserted live and modeled offline) | `github_cli.rs` `approving_your_own_pr…`; live self-approval refusal in the PR lifecycle test |
| Merge (squash, `--match-head-commit`, `--delete-branch`, remote re-read `MERGED`) | **validated (live, 2026-08-01)** + faithful stand-in | `github_live_pr_lifecycle_create_review_merge`; `github_cli.rs` merge table |
| Stale-head refusal (push mid-review) | **validated (live, 2026-08-01)** — the real text is `Pull Request is not mergeable`, **not** the modeled `Head branch was modified` guess; fixture re-captured | `merge-stale-head` case (now `source-exact`); `github_live_stale_head_merge_is_refused` |
| Blocked-by-ruleset merge + admin bypass | **validated (live, 2026-08-01)** — block verbatim + `--admin` merge. Finding: a ruleset only honors `--admin` when it grants a bypass actor; without one gh fails with `Repository rule violations found` (the harness ruleset now mirrors production's admin `bypass_actors`) | `merge-blocked-policy` case; `github_live_ruleset_blocks_then_admin_bypass_merges` |
| Draft: refuse merge → mark ready → merge | **validated (live, 2026-08-01)** — real refusal is `Pull Request is still a draft`; fixture re-captured | `merge-draft` case (now `source-exact`); `github_live_draft_refuses_merge_until_ready` |
| Auto-merge arm / disarm | modeled offline (`merge-auto-armed`, `merge-auto-not-allowed`); live run **pending: not yet in the live suite** (runbook extension; setup already enables `allow_auto_merge`) | inventory rows `pr_merge` / `pr_disable_auto_merge` |
| Update branch (`BEHIND`) | **pending: not yet in the live suite** (needs a deliberately-behind branch; runbook extension) | inventory row `pr_update_branch` |
| Issue create/edit/comment/close/reopen (labeled) | **validated (live, 2026-08-01)** — every transition re-read remotely | `github_live_issue_lifecycle_is_verified_remotely` |
| Issue → worktree (`gh issue develop`) | **pending: on-device dialog pass** (the full dialog flow belongs to the on-device pass) | inventory row `issue_develop` |
| Reviewer requests (`--add-reviewer`) | **unsupported: single account** (cannot request yourself); arg validation unit-tested | inventory row `pr_add_reviewers` |
| Actions dispatch/cancel/log | **validated (live, 2026-08-01)** — note: the very first dispatch on a fresh repo can race GitHub's workflow registration (one retry settled it) | `github_live_actions_dispatch_cancel_and_log` |
| Actions re-run | **pending: not yet in the live suite** (pairs with the cancel run) | inventory row `run_rerun` |
| Cross-fork PRs | **unsupported: single account** (no cross-account fork; also an open feature gap — see FOR-DEV) | inventory + FOR-DEV |

## Environments

| Case | Status |
|---|---|
| Windows (this machine) | offline suites green **and the supervised live run executed 2026-08-01: 7/7 live tests green** against `luisgamas/uxnan-gh-sandbox` (created, exercised and cleaned by the harness; every mutation verified by a remote re-read) |
| macOS / Linux | untested (no hardware; same posture as the rest of the desktop app) |
| WSL repos | known gap — GitHub features degrade to "not a GitHub repo" (FOR-DEV) |
| GHES / non-standard hosts | untested — no GHES available; the code paths degrade (documented in `github.md`) |
| Localized gh output | non-issue by construction: `gh` ships English-only messages, and every parsed answer is `--json`/API JSON; human text is only displayed, never parsed (the auth prose fallback is the one exception, kept for old gh and contract-tested) |

## UI end-to-end

An **opt-in** E2E journey (`tests/e2e/specs/github-fake.e2e.mjs`, enabled with
`UXNAN_E2E_FAKE_GH=1`) boots the shipped app with `gh` routed to the fixture
(the canned answers are the captured real payloads) and asserts the status /
PR-list / rate-limit / empty-issues chains over real IPC. Its **first run
passed on 2026-08-01** (in the same operator session as the sandbox runbook,
with no other uxnan instance alive). Driving the GitHub *views* by clicking
(open PR detail, merge dialog) stays a known E2E gap (FOR-DEV), as with the
other journeys: assertions go through IPC.

## Supervised runs

**2026-08-01 — first run, all green.** Sandbox `luisgamas/uxnan-gh-sandbox`
created by the harness (public, marker topic, sleep workflow, auto-merge
enabled), the 7 live tests executed in runbook order, cleanup verified (0 open
PRs/issues, `main` only, no failure artifact; the repo is parked and safe to
delete). Three findings, all folded back into the code the same day:

1. **Two modeled refusal texts were wrong** — stale-head really answers
   `Pull Request is not mergeable` and draft really answers
   `Pull Request is still a draft`; both fixtures now carry the live bytes
   (`source-exact`) and the offline suite asserts them.
2. **`--admin` cannot bypass a ruleset that grants no bypass actor** — gh fails
   with `Repository rule violations found`. Production's ruleset grants the
   Repository-admin role an `always` bypass, which is why admin merges work
   there; the harness ruleset now mirrors that, and the failure text is a real
   outcome the app can meet on foreign repos.
3. **A fresh repo's first `workflow_dispatch` can race workflow registration**
   (the run simply doesn't appear for a while); a retry settled it.

A future run only needs the runbook extensions still marked pending above:
auto-merge arm/disarm, update-branch, Actions re-run, and the on-device
`issue develop` dialog pass. Re-running the whole suite stays routine — the
harness is idempotent and the sandbox may be deleted or parked between runs.
