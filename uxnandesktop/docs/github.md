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
- **Pull Requests** — filter by `open / closed / merged / all` (defaults to **open**;
  when a repo has no open PRs the empty state offers a **View all** shortcut). Each row
  shows a colored **CI status icon** with a popover breaking down passed / failing /
  pending. Open a PR for a full **review view**: a colored **state pill** (open / merged / closed /
  draft) and summary pills (review decision, checks roll-up, `+/−`, commit & file
  counts, labels), a **reviewers** row, a **GitHub-style timeline** (a single
  chronological vertical rail interleaving the description, comments, review verdicts,
  commits, and smaller events — labeled / assigned / closed / merged / renamed /
  review-requested / force-pushed / cross-referenced / …) with a **comment field**, a
  compact **CI status box** for the head commit (a colored icon + "All checks passed" /
  "N failing", with the full check list in a **popover**), and the **diff split per
  file** — one collapsible row per changed file, **collapsed by default** (each file's
  diff loads only when expanded), with **Expand all / Collapse all**. Descriptions,
  comments and reviews render as **Markdown** (incl. inline images/screenshots).
  From there: **approve / request changes / comment**, **merge** (squash / rebase /
  merge, optionally deleting the branch), **check out into a new worktree**, and
  **create a PR** (with an optional AI-drafted body). **Merge / approve /
  request-changes are only enabled on open PRs** — a closed or merged PR is read-only
  (checkout still works).
- **Issues** — list / view / create; the detail view shows a colored open/closed pill
  and the same **timeline** (description + comments + events) with a **comment field**.
  **Start work → worktree** creates and links a branch (`gh issue develop`) as a new
  worktree.
- **Actions** — recent workflow runs; open a run's **log**, and **re-run**,
  **re-run failed**, or **cancel**.
- **Settings** — an **Account / Session** block (signed-in user, host, token scopes,
  CLI presence, API rate-limit — no token is ever shown) followed by the GitHub
  preferences (see below).

## The right-panel GitHub tab

A 4th tab in the right panel (next to Files / Changes / History), scoped to the
**active worktree**: its PR (with a colored checks roll-up + quick actions), this
branch's CI runs, and a full **create-PR form** (title + body, manual or AI-drafted).
Unlike the section (which has its own repo selector), this tab **is** bound to the
**active worktree** — when no worktree is selected it shows an empty state (like the
Files / Changes / History tabs). It stays visible whenever enabled (toggle in **GitHub →
Settings → Right-panel GitHub tab**), showing a "connect" / "no active worktree" /
"not a GitHub repo" state rather than appearing and disappearing. The right-panel **tab
strip scrolls horizontally** when it's narrow, and the panel has a minimum width that
keeps all four tabs visible. Big views (review, diff, logs) open in the GitHub section.

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

All 24 GitHub commands live in `src-tauri/src/github.rs` (thin wrappers in
`commands.rs`, registered in `lib.rs`, typed wrappers in `src/lib/api.ts`):
`github_status`, `github_repo_context`,
`github_pr_list/view/diff/timeline/create/comment/review/merge/checkout`,
`github_issue_list/view/comment/create/develop`, `github_run_list/log/rerun/cancel`,
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
