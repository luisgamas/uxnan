# GitHub integration

Uxnan Desktop has a native GitHub integration for reviewing pull requests, triaging
issues, watching CI, and tying both to worktrees — all backed by the local
**GitHub CLI (`gh`)**.

## Requirements & sign-in

- Install the **GitHub CLI** (`gh`) and sign in once: `gh auth login`.
- That's it — the app **never stores or reads your token**. `gh` owns the OAuth token
  in your OS keychain; Uxnan only reads sanitized status (login / scopes / host) via
  `gh auth status`. Check it in **GitHub → Settings → Account / Session**.
- When `gh` is missing or logged-out, GitHub features show a clear "connect" state and
  every action still offers **Open on GitHub**.

Because everything routes through `gh`, **every agent-automatable action has an
identical manual path** — GitHub keeps working even with zero AI-agent quota.

## The GitHub section

Open it from the **GitHub** button in the left sidebar (or the status bar), or with
**`Ctrl/Cmd+G`** (rebindable in Settings → Keyboard shortcuts). It's a full-screen
overlay (like Settings). A **repository selector** at the top of the section's left nav
chooses which of your registered projects the section acts on — it does
**not** require an active worktree
(it defaults to the active worktree's repo, then the active project, then the first
registered git repo). Panes:

- **Overview** — the active repo, its branch, and that branch's PR at a glance.
- **Pull Requests** — a **search bar** (`gh pr list --search`) + a `open / closed /
  merged / all` filter (defaults to **open**; an empty open list offers a **View all**
  shortcut). Each row shows a colored **status icon** (open / merged / closed / draft),
  a relative date, and a **CI status icon** whose popover lists the **full checks**.
  Open a PR for a full **review view**: a colored **state pill** + summary pills (review
  decision, checks roll-up, `+/−`, commit & file counts, labels), the **opened / edited**
  times, a **reviewers** row, a **GitHub-style timeline** (a vertical rail interleaving
  the description, comments, review verdicts, commits — with a **Verified** badge on
  signed commits and a **CI popover on the head commit** — and smaller events), an
  **expandable CI checks section**, and the **diff split per file** (collapsible,
  collapsed by default, with **Expand all / Collapse all**). Descriptions, comments and
  reviews render as **Markdown** (incl. inline images/screenshots). The **reply box +
  review / merge / Close-PR / checkout** tools live in a **bottom action bar**;
  **merge / approve / request-changes are only enabled on open PRs**, and a closed PR
  offers **Reopen**.
- **Issues** — a **search bar** + `open / closed / all` filter; each row shows a colored
  **open/closed status icon**, a relative date, labels and a comment count. The detail
  view shows a colored pill + **opened / edited** times, the same **timeline**
  (description + comments + events) and a bottom bar with the **comment field**, a
  **Close / Reopen** button, and **Start work → worktree** (creates + links a branch via
  `gh issue develop` and opens it as a new worktree).
- **Actions** — recent workflow runs; open a run's **log**, and **re-run**,
  **re-run failed**, or **cancel**.
- **Settings** — an **Account / Session** block (signed-in user, host, token scopes,
  CLI presence, API rate-limit — no token is ever shown) followed by the GitHub
  preferences (see below).

## The right-panel GitHub tab

A 4th tab in the right panel (next to Files / Changes / History), scoped to the
**active worktree**: its PR (with a colored checks roll-up + quick actions), this
branch's CI runs, and a full **create-PR form** (base ← head, title + body, manual or
AI-drafted; the head is pinned to this worktree's branch — see *Creating a PR* below).
Unlike the section (which has its own repo selector), this tab **is** bound to the
**active worktree** — when no worktree is selected it shows an empty state (like the
Files / Changes / History tabs). It stays visible whenever enabled (toggle in **GitHub →
Settings → Right-panel GitHub tab**), showing a "connect" / "no active worktree" /
"not a GitHub repo" state rather than appearing and disappearing. The right-panel **tab
strip scrolls horizontally** when it's narrow, and the panel has a minimum width that
keeps all four tabs visible. Big views (review, diff, logs) open in the GitHub section.

## Creating a PR

The create-PR form (in the section's **Pull Requests** pane and in the right-panel tab)
opens with a **`base ← head`** row: where the PR goes, and where it comes from. Both are
always visible, even when they can't be changed — a PR silently opened from whatever
branch happened to be checked out is exactly the mistake this row prevents.

- **Base** lists the repo's **`origin` branches** (GitHub can only target a branch that
  exists on the remote) and defaults to the repo's **default branch**.
- **Head** lists **local branches** and defaults to the checked-out one. In the
  **right-panel tab** it's fixed to the active worktree's branch and shown read-only —
  that tab *is* that worktree. In the **section** (which is scoped to a *repo*) it's a
  real choice.
- The form blocks a `base == head` PR, and warns when the head hasn't been pushed to
  `origin` yet — `gh` runs with prompts disabled, so it can't offer to push for you.
- **AI drafting** diffs against the **selected base** (resolved to `origin/<base>` when
  that ref exists), so the body describes the PR's own changes rather than a stale
  local branch's.

## Merging (and protected branches)

The merge controls adapt to what the repo **and the base branch's rules** allow, rather
than offering a fixed list:

- **Methods** are the repo's settings (`mergeCommitAllowed` / `squashMergeAllowed` /
  `rebaseMergeAllowed`) **intersected with** the base branch's rules — a ruleset on
  `main` can forbid a method the repo allows, and the stricter one wins. The selected
  method and the delete-branch toggle default to the repo's own
  (`viewerDefaultMergeMethod`, `deleteBranchOnMerge`).
- **Protection is read from the rulesets API**
  (`gh api repos/{owner}/{repo}/rules/branches/{base}`), *not* the classic
  `/branches/{b}/protection` endpoint — a branch protected by a **ruleset** makes the
  classic one answer `404 Branch not protected`, so trusting it would report a protected
  branch as free.
- When GitHub reports the PR **blocked**, the panel says **why** (required approvals,
  unresolved review threads, required checks, stale-review dismissal) and offers, in
  GitHub's recommended order:
  1. **Enable auto-merge** (`gh pr merge --auto`) — merges once the requirements are
     met. Only shown when the repo has auto-merge enabled (`allow_auto_merge`).
  2. **Merge as administrator** (`gh pr merge --admin`) — bypasses the rules. Only shown
     when `viewerCanAdminister` is true (offering it otherwise would just fail), and
     always behind a danger confirm that names the branch being overridden.
- Every merge passes **`--match-head-commit`** with the head commit the UI is showing, so
  a push that lands mid-review can't be merged unseen — you get an explicit failure
  instead.

If `gh` can't report the policy (logged out, GHES, an old `gh`), the controls degrade to
a plain merge and let `gh` itself reject what isn't allowed.

## Worktree-native flows (the differentiator)

- **PR → worktree:** *Check out to worktree* fetches `pull/<n>/head` and adds a
  `pr-<n>` worktree, so reviewing/running a PR is just another isolated worktree.
- **Issue → worktree:** *Start work* runs `gh issue develop` and adds an `issue-<n>`
  worktree with the linked branch.

## Elsewhere in the UI

- **Sidebar cards** show a PR icon on worktrees whose branch has a PR, colored by CI.
- The **status-bar GitHub button** opens the section and shows the API rate-limit
  remaining (and, if enabled, the unread-notifications count).
- After a **push** on a GitHub branch with no PR yet, a **"Create PR"** toast appears.

## Settings (GitHub → Settings)

| Setting | What it does |
|---|---|
| **Right-panel GitHub tab** | Show/hide the contextual right-panel tab (GitHub repos only). |
| **Status-bar button** | Show/hide the status-bar GitHub button + rate-limit gauge. |
| **Refresh interval** | How often (seconds) the active worktree's PR/CI status refreshes while focused. `0` = manual only. |
| **Notifications badge** | Poll your unread notifications count for the status bar (an extra request). |
| **Confirm PR actions** | Ask before creating or merging a PR (both the section and the right-panel tab). On by default. |
| **AI PR authoring** | Pick an installed CLI agent + model to draft PR bodies from the branch diff. Off by default. |

Settings persist in `AppSettings.github` (`GithubSettings`); all fields default, so
older state loads unchanged.

## Backend commands

All 30 GitHub commands live in `src-tauri/src/github.rs` (thin wrappers in
`commands.rs`, registered in `lib.rs`, typed wrappers in `src/lib/api.ts`):
`github_status`, `github_repo_context`, `github_branches`, `github_merge_info`,
`github_pr_list/view/diff/timeline/create/comment/review/close/reopen/merge/checkout`,
`github_issue_list/view/comment/close/reopen/create/develop`,
`github_run_list/log/rerun/cancel`,
`github_rate_limit`, `github_notifications_count`, `github_clone`,
`github_ai_draft_pr`. (`github_pr_timeline` serves both PRs and issues — a PR *is* an
issue in the REST API.)

## Known limitations

- **WSL repos:** a Windows `gh` can't see a `\\wsl.localhost\…` checkout, so GitHub
  features degrade to "not a GitHub repo" for WSL worktrees.
- **GitLab / other hosts:** not covered (the `gh`-based approach is GitHub-only).
- **Native (no-`gh`) sign-in:** an OAuth **device-flow** login + OS-keychain token —
  which would remove the `gh` dependency — is a planned follow-up (see `FOR-DEV.md`).
- Sidebar-card PR badges are shown for **visited** worktrees (from the context cache),
  not eagerly for every worktree.
