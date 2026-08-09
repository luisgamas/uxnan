# GitHub integration

Uxnan Desktop has a native GitHub integration for reviewing pull requests, triaging
issues, watching CI, and tying both to worktrees — all backed by the local
**GitHub CLI (`gh`)**.

## Requirements & sign-in

- Install the **GitHub CLI** (`gh`) and sign in once: `gh auth login`. Developed and
  validated against `gh` 2.95.0; any reasonably current gh works — the one
  version-sensitive call (`gh auth status --json hosts`, gh ≥ 2.63) falls back to
  parsing the prose banner on older versions.
- That's it — the app **never stores or reads your token**. `gh` owns the OAuth token
  in your OS keychain; Uxnan only reads sanitized status (login / scopes / host) via
  `gh auth status` (the structured `--json hosts` form first, prose as the
  compatibility fallback). Check it in **Settings → GitHub → Account / Session**.
- When `gh` is missing or logged-out, GitHub features show a clear "connect" state and
  every action still offers **Open on GitHub**.

Because everything routes through `gh`, **every agent-automatable action has an
identical manual path** — GitHub keeps working even with zero AI-agent quota.

## Clone and add a project

Open **Add project** from the Projects sidebar. The dialog starts in **Auto** mode,
where its single input detects any of:

- `owner/repository`;
- an HTTPS repository URL;
- an SSH repository URL in either common form.

Explicit local paths keep the folder list visible; a recognized GitHub reference
replaces that list with the canonical repository and a destination derived from the
user's home directory. **Local** and **GitHub** tabs can
force either interpretation when the input is ambiguous. By default the clone goes
to `<home>/uxnan/<repository>`; Uxnan creates the missing parent folder on first use.
The destination remains editable, and **Choose folder** opens the operating system's
native directory picker to select a different parent. **Clone and add** runs
`gh repo clone`, registers the returned folder through the normal project path, loads
its worktrees, focuses its primary worktree, and closes the dialog. The button reports
the cloning and registration phases separately. Clone transfers have a dedicated
15-minute ceiling; ordinary GitHub reads keep the shorter one-minute request budget.
Clones retain complete history but use Git's partial-clone object filter, so file
contents are transferred only when a checkout needs them. This lowers the initial
download without imposing the history limitations of a shallow clone.
If cloning fails, Uxnan reports the
error and leaves any partial destination untouched for inspection or recovery.

In local mode the same input is the folder address field. The list underneath keeps
repo detection, live refresh, per-row add actions, and multi-project folder selection.

## Create a worktree from the project launcher

The **+** button on a project card is the unified launcher. **New** is the first and
default tab for git projects, preserving the write-a-name-first worktree flow. It is
followed by **Worktree**, **PR**, and **Issue**; the tabs replace one source area
instead of stacking separate forms.
The Worktree tab searches the project's current worktrees; PR and Issue each load up
to 50 open items for that project and accept `#42`, `42`, or a full item URL. A URL
for another repository is rejected before any mutation.

The first New field is also a source-aware entry point. A full PR/issue URL, a
labeled reference, or simply `#42` / `42` moves to the matching tab and resolves
that item automatically. Because PRs and issues share GitHub's number space, a
neutral number is looked up once through the active repository's shared work-item
endpoint; Uxnan uses the returned type instead of guessing. Within the PR and Issue
tabs, search matches numbers, titles, authors, branch names, and visible metadata;
`#42` resolves the exact item, while a lone in-progress `#` keeps the complete list visible.

After an item is selected, naming is automatic and storage details stay out of the
launcher. Pull requests keep their real head branch; issues use a stable
`<number>-<title-slug>` branch. The user may select zero or
more terminals, agents, and the integrated browser: zero creates and focuses only the
worktree, while any selected actions start after the worktree has been adopted through
the same state path as manual creation. The item title is saved as the worktree note.
Its body is never injected into an agent prompt automatically.

PR and issue creation fetch only the requested ref and skip unrelated tags. After
Git returns the canonical worktree list, Uxnan activates the new workspace and starts
its selected actions immediately; the new status badge hydrates in the background
instead of making launch wait for status checks across every existing worktree.

## The GitHub view (per project)

Open it **per project**, from either entry point — both land in the same view:

- each project card's **⋯ menu → GitHub → Pull Requests / Issues / Actions**;
- **right-click any worktree row → GitHub → …**, which opens the view for the
  worktree's **owning project** (its submenu is headed by the project name). This is
  the way in while the sidebar is **grouped by status**, where worktrees are
  flattened into attention lanes and no project card — hence no ⋯ menu — is drawn.

It opens **in place of the center + right panels** — the left
sidebar (projects) and the browser panel stay visible — scoped to that project, so
there's no repository selector. A **section switcher** (Pull Requests / Issues /
Actions) sits next to a **close** button (left) and a **refresh** button (right), all
inside the view's own toolbar. **Close** it with that button or by activating any
worktree — clicking a worktree/project opens its terminal as usual and returns to the
workspace. Sections:

- **Pull Requests** — a **search bar** (`gh pr list --search`) + a `open / closed /
  merged / all` filter (defaults to **open**; an empty open list offers a **View all**
  shortcut). Each row shows a colored **status icon** (open / merged / closed / draft),
  a relative date, and a **CI status icon** whose popover lists the **full checks**.
  Open a PR for a full **review view**: a colored **state pill** + summary pills (review
  decision, checks roll-up, `+/−`, commit & file counts, labels), the **opened / edited**
  times and a **reviewers** row, then two **tabs**:
  - **Conversation** — a **GitHub-style timeline** (a vertical rail interleaving the
    description, comments, review verdicts, commits — with a **Verified** badge on
    signed commits and a **CI popover on the head commit** — and smaller events), plus an
    **expandable CI checks section** (collapsed by default).
  - **Files changed** (with a count badge) — the **diff split per file** (collapsible,
    collapsed by default, with **Expand all / Collapse all**). Reviewing a diff is its
    own reading mode, so it gets its own tab rather than sitting under the whole
    conversation.

  The **pencil** in the header edits the **title and description** in place
  (`gh pr edit` / `gh issue edit`) — a PR/issue opened from here no longer has to go to
  github.com to fix a typo. The **reviewers** row also *requests* reviews (comma-separated
  logins → `gh pr edit --add-reviewer`), not just displays them. Descriptions, comments and reviews render as **Markdown** —
  see *Markdown in comments* below. The **reply box + review / merge / Close-PR / checkout** tools live in a
  **bottom action bar** that stays available from **both tabs** (reviewing the diff is
  exactly when you want to approve); **merge / approve / request-changes are only
  enabled on open PRs**, and a closed PR offers **Reopen**.
- **Issues** — a **search bar** + `open / closed / all` filter; each row shows a colored
  **open/closed status icon**, a relative date, labels and a comment count. The detail
  view shows a colored pill + **opened / edited** times, the same **timeline**
  (description + comments + events) and a bottom bar with the **comment field**, a
  **Close / Reopen** button, and **Start work → worktree** (creates + links a branch via
  `gh issue develop` and opens it as a new worktree). **Creating** an issue offers the
  repo's real **labels** (colored chips, from `gh label list`) and **assignees** (from
  the assignees API), so one filed here lands as triaged as one filed on github.com.
- **Actions** — recent workflow runs; open a run's **log**, and **re-run**,
  **re-run failed**, or **cancel**.

The **Account / Session** panel (signed-in user, host, token scopes, CLI presence, API
rate-limit — no token is ever shown) and the GitHub preferences live in **Settings →
GitHub** (see *Settings* below), not in this view.

## The right-panel GitHub tab

A 4th tab in the right panel (next to Files / Changes / History), scoped to the
**active worktree** — a digest of the repo that worktree belongs to, top to bottom:

| Block | What it shows |
|---|---|
| **Header** | `owner/repo` + the branch, with two icon buttons: **open the GitHub view** for this project (same entry point as the project card's ⋯ menu) and **refresh** (its tooltip names exactly what it re-reads: the branch's PR plus the repo's pull requests, CI runs and issues). |
| **This branch's PR** | The PR for the active branch with a colored checks roll-up + quick actions, or a full **create-PR form** (base ← head, title + body, manual or AI-drafted; the head is pinned to this worktree's branch — see *Creating a PR* below). |
| **Pull requests** | The repo's **5 most recent** PRs, any state, each with its state icon (open / draft / merged / closed) and relative date. |
| **CI runs** | The repo's **5 most recent** workflow runs — **not** filtered to this branch, so it answers "what has CI been doing" instead of repeating the same handful of runs. |
| **Issues** | The repo's **5 most recent** issues, any state. Hovering one reveals a **start-work** button that opens the same automatic-naming + agent dialog the section uses. |

Every row **opens that item's detail inside the app** — the inline GitHub view takes
over already showing that PR's review, that run's log or that issue's thread. None of
them sends you to the browser (the explicit **Open on GitHub** action still does).

Unlike the per-project GitHub view (scoped to the card you opened), this tab **is** bound
to the **active worktree** — when no worktree is selected it shows an empty state (like
the Files / Changes / History tabs). It stays visible whenever enabled (toggle in
**Settings → GitHub → Right-panel GitHub tab**), showing a "connect" / "no active
worktree" / "not a GitHub repo" state rather than appearing and disappearing. The
right-panel **tab strip scrolls horizontally** when it's narrow, and the panel has a
minimum width that keeps all four tabs visible.

## Creating a PR

The create-PR form (in the GitHub view's **Pull Requests** section and in the right-panel tab)
opens with a **`base ← head`** row: where the PR goes, and where it comes from. Both are
always visible, even when they can't be changed — a PR silently opened from whatever
branch happened to be checked out is exactly the mistake this row prevents.

- **Both sides list every branch** — local and `origin` — because a PR isn't always
  "my branch → main": it may target a colleague's branch, a release branch, or another
  feature branch it stacks on. Branches that exist only locally are marked *local only*.
- **Base** defaults to the repo's **default branch**; **head** defaults to the
  checked-out one. In the **right-panel tab** the head is fixed to the active worktree's
  branch and shown read-only — that tab *is* that worktree. In the **section** (which is
  scoped to a *repo*) it's a real choice.
- The form blocks a `base == head` PR, and warns when either branch hasn't been pushed to
  `origin` yet — `gh` runs with prompts disabled, so it can't offer to push for you.
- **AI drafting** diffs against the **selected base** (resolved to `origin/<base>` when
  that ref exists), so the body describes the PR's own changes rather than a stale
  local branch's.

## Markdown in comments

PR/issue bodies, comments and reviews render through the app's own Markdown renderer
(`$lib/markdown` + `MarkdownView`), which covers the GitHub-flavored bits that bot
comments lean on heavily:

- **HTML comments are hidden**, as on GitHub. Bots use them as machine markers
  (`<!-- review_stack_entry_start -->`); rendering them buried the real comment.
- **Alerts** (`> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`) render as
  colored, iconed callouts instead of a literal "!WARNING" link.
- **`<details>`/`<summary>`** render as real collapsibles, including several siblings in
  one comment and disclosures nested inside a blockquote (where bots put them). An
  unclosed one is left as raw text rather than swallowing the rest of the comment.
- Raw HTML is still **escaped text, never executed** — no `{@html}`, so a comment from
  an untrusted repo can't script the webview. Long raw-HTML/code lines scroll instead of
  being clipped.

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
     met. Only shown when the repo has auto-merge enabled (`allow_auto_merge`), which is
     a definite repo setting.
  2. **Merge as administrator** (`gh pr merge --admin`) — bypasses the rules. **Offered
     on any repo whenever GitHub is holding the merge back** (`BLOCKED`, `BEHIND` or
     `UNSTABLE`), like GitHub's own UI. It is *not* hidden behind a permission probe:
     `viewerCanAdminister` only knows about repo admins, while GitHub also grants bypass
     via a ruleset's `bypass_actors` (a team, a custom role, an app), and the probe fails
     outright on GHES or a logged-out `gh` — hiding the control there would leave a
     blocked PR with no visible way forward. When the right can't be confirmed the
     confirm dialog says so, and `gh`'s own error is the authority. Always behind a
     danger confirm naming the branch being overridden.
- Every merge passes **`--match-head-commit`** with the head commit the UI is showing, so
  a push that lands mid-review can't be merged unseen — you get an explicit failure
  instead.
- Each state the panel reports comes with the action that answers it, rather than telling
  you to go do it elsewhere: **`BEHIND`** offers **Update branch** (`gh pr update-branch`,
  plus a *Rebase instead* variant), armed auto-merge offers **Turn off**
  (`--disable-auto`), and a **draft** PR offers **Mark ready for review**
  (`gh pr ready`, reversible with *Convert to draft*).

If `gh` can't report the policy (logged out, GHES, an old `gh`), the controls degrade to
a plain merge and let `gh` itself reject what isn't allowed.

## Worktree-native flows (the differentiator)

- **PR → worktree:** *Check out to worktree* fetches `pull/<n>/head` and adds a
  worktree, so reviewing/running a PR is just another isolated worktree.
- **Issue → worktree:** *Start work* runs `gh issue develop` and adds a worktree with
  the linked branch. If GitHub explicitly denies linked-branch creation because the
  account lacks mutation rights, Uxnan falls back to the same branch locally; other
  errors still surface.

Both open a **settings + confirmation dialog** (the sibling of the New-worktree dialog),
so a GitHub-born worktree is set up like any other:

| Field | Behavior |
|---|---|
| **Naming** | Automatic: the item title becomes the worktree note/card title; a PR keeps its real head branch and an issue uses `<number>-<title-slug>`. |
| **Launch agent** | Same picker (and same global default) as the New-worktree dialog. **This closed a real gap:** these flows used to bypass `createWorktree`, so a PR/issue worktree arrived with **no agent** — unlike every other worktree. |
| **Already exists** | Warns when a worktree already sits at that folder (the issue flow reuses it). |

The new worktree is then registered, made the active context and given its agent through
the same path as a hand-made one (`projects.adoptWorktree`), so it appears in the
left-panel Projects tree identically.

## Elsewhere in the UI

- **Sidebar cards** show a PR icon on worktrees whose branch has a PR, colored by CI.
- The **status-bar GitHub readout** is passive and lives **inside the backend (server)
  popover** at the bottom-right — open it and a GitHub block shows the unread-notifications
  count (if enabled) and the API rate-limit remaining, plus a row that opens
  **Settings → GitHub**. It has no button of its own; GitHub opens per project from each
  card's ⋯ menu. Unread notifications also put a small dot on the backend icon, so the
  passive signal survives without a click.
- After a **push** on a GitHub branch with no PR yet, a **"Create PR"** toast appears
  (its action opens the per-project GitHub view on Pull Requests for the active repo).

## Settings (Settings → GitHub)

The GitHub preferences and the **Account / Session** panel live in **Settings → GitHub**
(the "Workspace" group, above Updates).

| Setting | What it does |
|---|---|
| **Right-panel GitHub tab** | Show/hide the contextual right-panel tab (GitHub repos only). |
| **Status-bar readout** | Show/hide the passive GitHub block (unread count + rate limit) inside the status bar's backend popover. |
| **Refresh interval** | How often (seconds) the active worktree's PR/CI status refreshes while focused. `0` = manual only. |
| **Notifications badge** | Poll your unread notifications count for the backend popover + its dot (an extra request). |
| **Confirm PR actions** | Ask before creating or merging a PR (both the GitHub view and the right-panel tab). On by default. |

### AI PR authoring

Its own block in **Settings → GitHub**, built like **Settings → AI commit messages**
(same agent catalog, same model picker, same install-awareness) — it drafts the PR body
from the branch diff by running an **installed local CLI agent**, so there are no API
keys and no provider SDK.

| Setting | What it does |
|---|---|
| **Enable AI PR authoring** | Master switch; adds the "Generate" button to the description field. **Off by default** — nothing runs unasked. |
| **Agent** | Claude Code / Codex / OpenCode / Grok / Antigravity, with logos. Agents that aren't installed stay listed but **disabled**, labeled "not found", rather than silently missing. |
| **Model** | The agent's own models, discovered from its CLI. A **discovery failure shows the CLI's own message** — "this CLI is broken / not signed in" and "this agent has no models" are different problems. |
| **Language** | `auto`, or a language stated verbatim in the prompt. |
| **Instructions** | Free-form text appended to every draft's prompt. |

The agent/model/language/instructions are read from settings **on the backend** (like AI
commit), so what runs is always what's configured.

Model discovery notes, by agent: **Claude** uses a built-in list; **Codex** is queried
live via `codex app-server` (`model/list`); **OpenCode** via `opencode models`;
**Antigravity** via `agy models`; **Grok** via `grok models`. Grok and Antigravity only
answer once their CLI is signed in — if a list comes back empty, run the CLI once and
sign in there.

The offered agents are a **curated subset** of the CLIs the backend can drive headlessly
(`src/lib/aiCommitPresets.ts`): an agent earns a place only once it also answers a model
list, or its model picker sits empty and the entry looks broken. **Gemini CLI is no longer
offered** — Google discontinued it in favour of Antigravity — though the backend can still
run it, so a config that already names it keeps working and shows it flagged as
discontinued until you pick another.

Settings persist in `AppSettings.github` (`GithubSettings`); all fields default, so
older state loads unchanged.

The refresh interval drives the complete right-panel digest: the active branch's
PR context plus the repository's five recent PRs, workflow runs and issues. Each
list request is sequence-guarded, so switching worktrees cannot let a slower
response from the previous repository overwrite the current panel.

### What a background refresh is allowed to do

One rule governs every automatic read here: **a refresh may add information; it
may never destroy what is on screen or what the user has typed.** In practice:

- **The panel is not unmounted while it re-reads.** The *Loading…* placeholder is
  shown only when there is nothing to show yet for the active worktree — a first
  read, or a real "not a GitHub repository". A poll updates the rendered digest in
  place. (Gating the body on "a read is in flight" is what used to replace the
  panel — and any open **Create PR** form — every 45 seconds.)
- **A single `null` context is a miss, not an answer.** `github_repo_context`
  returns `Option<RepoContext>`, so a git lock, a slow `gh` spawn or a dropped
  network looks exactly like "not a GitHub repo". A `null` over a context already
  on screen must repeat before it is believed (`resolveContext` in
  `src/lib/githubRefresh.ts`); a worktree that never had one answers at once.
- **An unsubmitted "Create PR" form is parked, not held by the component.** Title,
  description, base, head and the draft switch live in `github.prDrafts`, keyed by
  the form's owner (`worktree:<path>` for the right-panel tab, `section:<path>`
  for the section's own form — both can be open on the same repo and mean
  different things). Any remount restores it; only creating the PR or pressing
  **Cancel** drops it.

### Which worktrees get read, and when

Every context is a `gh` invocation against the account's rate limit, so a tick
reads at most `BADGE_TICK_CAP` (2) non-active worktrees. `pickBadgeTargets`
(`src/lib/githubRefresh.ts`) orders them: worktrees showing **no badge at all**
first (missing information beats stale information), then the ones whose **git
status just changed** (a push or new commits is when a branch gains or updates a
PR), then a **rotation** so an untouched repo is still re-read eventually. A
signalled path that doesn't fit a tick is carried to the next one — the projects
store hands each change over exactly once.

`setInterval` fires *after* its interval, so at launch a bounded **one-shot fill**
runs as soon as polling arms (or as soon as sign-in resolves, whichever is later):
the rate-limit gauge, the notifications count, and every worktree with no badge
yet, in batches no wider than a normal tick and capped at `PRIME_MAX_PATHS` (24)
scaled by the resource profile's GitHub factor. Setting the interval to `0`
(manual only) opts out of this too.

## Backend commands

All 38 GitHub commands live in `src-tauri/src/github.rs` (thin wrappers in
`commands.rs`, registered in `lib.rs`, typed wrappers in `src/lib/api.ts`):
`github_status`, `github_repo_context`, `github_branches`, `github_merge_info`,
`github_labels`, `github_assignees`,
`github_pr_list/view/diff/timeline/create/comment/review/close/reopen/merge/checkout`,
`github_pr_update_branch/ready/disable_auto_merge/edit/add_reviewers`,
`github_issue_list/view/comment/close/reopen/create/develop/edit`,
`github_run_list/log/rerun/cancel`,
`github_rate_limit`, `github_notifications_count`, `github_clone`,
`github_ai_draft_pr`. (`github_pr_timeline` serves both PRs and issues — a PR *is* an
issue in the REST API.)

## Validation status (validated / limited / pending)

The integration's claims are backed by a layered validation effort — captured
**real `gh` responses** frozen as parser contract tests, the production runner
exercised through **real child processes** against gh-shaped stand-ins, an
executable **supervised live suite** against a disposable sandbox repository,
and a machine-checked **command inventory**. The honest per-area status —
what is validated against real data, what against faithful stand-ins, and what
is still *pending the supervised sandbox run* (mutations require maintainer
supervision) — lives in **[`github-validation.md`](github-validation.md)**,
with the sandbox procedure in
**[`github-sandbox-runbook.md`](github-sandbox-runbook.md)**. Every `gh`
invocation is logged locally (request id, redacted argv, exit, duration —
never a token, never a body).

## Known limitations

- **WSL repos:** a Windows `gh` can't see a `\\wsl.localhost\…` checkout, so GitHub
  features degrade to "not a GitHub repo" for WSL worktrees.
- **GitLab / other hosts:** not covered (the `gh`-based approach is GitHub-only).
- **Native (no-`gh`) sign-in:** an OAuth **device-flow** login + OS-keychain token —
  which would remove the `gh` dependency — is a planned follow-up (see `FOR-DEV.md`).
- Sidebar-card PR badges are filled by the launch pass and the poll's
  missing-first ordering (above), both bounded — with many worktrees, or on the
  Efficient profile, the last badges still arrive over several ticks rather than
  all at once.
