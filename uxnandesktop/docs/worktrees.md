# Worktrees — where they land, and why

Every task in uxnan gets its own git worktree. This page covers **where those
folders are created**, how to change it, and the rules the resolver applies so
the result is a path git accepts and the app can find again.

Spec: [`architecture/02c-git-worktrees.md`](../architecture/02c-git-worktrees.md)
§2.1. Implementation: [`crates/workspace-engine/src/worktreeloc.rs`](../src-tauri/crates/workspace-engine/src/worktreeloc.rs) — the workspace engine's, so a host places its worktrees by the same rules.

## Settings → Git

Three sections. **Identity** is read-only: the name, email, `init.defaultBranch`
and git version the app reads from git's **global/system** configuration
(`git_identity` → `git::identity`), never from an open repository — a repo can
override its own author, and reporting that here would describe an identity the
user does not have anywhere else. An unset name/email is shown as such, because
it is what makes `git commit` fail later. **Worktree location** and **Cleanup**
are the rest of this page.

## What lives in `~/uxnan`

```
~/uxnan/
  repos/<repo>/                 cloned repositories
  worktrees/<repo>/<branch>/    worktrees, grouped by project
```

Two siblings with obvious roles. Clones used to land directly in `~/uxnan`,
which left the worktree root as just another folder among the projects — a
repository literally named `worktrees` would have collided with it. Only the
destination the clone dialog *suggests* changed; clones already on disk are not
moved.

## The three layouts

Settings → **Git** → *Worktree location*:

| Mode | Path | When |
|---|---|---|
| **Managed folder** (default) | `<home>/uxnan/worktrees/<project>/<branch>` | Groups a repository's checkouts under a folder uxnan owns, beside the `<home>/uxnan/repos` the clone flow writes to |
| **Beside the project** | `<parent>/<project>--<branch>` | What the app did before; keep it if your tooling expects the sibling folders |
| **Custom folder** | `<your root>/<project>/<branch>` | Same grouping on another volume, or under a shorter path |

A single project can override the root from its own settings (project card ⋯ →
*Project settings* → **Worktree folder**). Leave it empty to follow the global
setting. The create dialog's **Location** field still overrides both, for one
worktree.

Precedence: dialog location → project root → global setting.

## What is never done

- **Nothing is migrated.** Worktrees already on disk are read from
  `git worktree list` and keep working wherever they are. Changing the setting
  affects only worktrees created afterwards.
- **Worktrees are never nested inside the repository's own work tree.** A
  checkout under `<repo>/…` is untracked content git wants ignored, `git clean
  -xdf` deletes it (with any uncommitted agent work inside), and every tool that
  walks the tree — analyzers, watchers, the app's own file tree — would walk one
  copy of the project per worktree.

## On a host

A project that lives on an SSH host gets the same worktrees, made by that host's
engine with these same rules (`architecture/02g-remote-hosts.md` §5.10i). The
managed root is the host's own `~/uxnan/worktrees`; the **global** custom root
is a folder on this machine, so on a host only a project's own root applies;
`sibling` puts the folder next to the repository there. Creating and removing
are fenced to the connection you are looking at and refused while the host is
disconnected. The cleanup below works on a host too: with a host connected,
Settings → Git → Cleanup offers a machine picker, and that host's engine scans
and cleans its own managed folders by the same rules.

## The left panel: names, projects and hidden worktrees

Three rules about how a worktree is *shown* (not where it lives). The pure logic
is `src/lib/worktree-label.ts` and `src/lib/sidebar-visibility.ts`; the store
that owns the state is `src/lib/state/projects.svelte.ts`.

**The header.** Beside *PROJECTS (N)* the header keeps only what must stay in
sight: the *needs you* pill (an agent waiting inside a collapsed project is
otherwise invisible), the **Add project** button and one **panel options** button
(`SidebarOptionsMenu.svelte`). Its menu is the panel's whole control surface —
*New terminal* (with its shortcut; configured profiles are a submenu), view
(tree / by status / by review), *Sort projects* and *Sort worktrees* (submenus
that show their current choice), *View hidden worktrees (N)* and *Stop hiding
worktrees* (once anything is set aside — the first only looks, the second ends the
hiding), and *Refresh worktrees* — so a new panel-wide action goes there, not into
the header. *Add project* lives in one place only, the
button (its shortcut is global, so the menu does not need a second entry).

**What a worktree is called.** Its branch. A worktree with no branch — a checkout
of a tag, a commit, a PR — is named after its **folder** (git refuses two
worktrees on one path, so the folder is what tells them apart), with
*detached at 9fceb02* (the short commit HEAD stands on) as the second line and in
the hover card. On a host git could not be asked on, the hint reads *branch not
read* instead — "detached" would be a claim about a repository nobody read. The
same name is used by the card, the hover card, the search palette and the remove,
note and batch-close dialogs: `worktreeIdentity` is the one place that decides.

**Which project a card belongs to.** The tree groups by project, so a row there
leaves it implicit. The two flat views (**by status**, **by review**) lift rows
out of their project, and two projects can both be on `main`: their second line
therefore leads with the project's own icon and name, and keeps the *detached*
hint beside it (below 15rem of sidebar width the hint gives way to the name).

**Hiding a worktree.** *Hide from the list* (a worktree's right-click menu) and
*Hide idle worktrees* (a project's ⋯ menu) put worktrees out of the panel without
touching them: they stay on disk, in the search palette (Ctrl/Cmd+P) and in the
agents' control surface (`worktree/list`). It is a *view state*, kept in
`app.settings` (`hiddenWorktrees`, a list of paths, and `sidebarShowHidden`) and
saved with the rest of the panel; whether a hidden row is drawn *right now* is
derived on every read from live facts, never written back:

| A hidden worktree is shown again while… | Why |
|---|---|
| it is **selected** | hiding what you are looking at pulls the floor out from under the pointer |
| an agent in it **works, waits on you, or left an unread result** | the panel must never sit on something that needs you |
| it is **ready to close** (merged, closed, integrated) | the *Ready to close* lane and its count are a decision the panel is asking for; hiding is not closing |
| it is **pinned** (pinning one also shows it again) | a pin says "keep this in front of me" |
| an agent **surfaced it and has since gone quiet**, until you select another worktree | reading a result (the window regaining focus clears every unread dot) must not make the row leave under the pointer; selecting something else is the signal you have moved on (`nextLingering`; in memory only) |

and the primary worktree can't be hidden at all. When the reason stops, the row
goes again — which is what "hide it for later" means. *Hide idle worktrees* is
stricter than the single hide: it takes only worktrees the panel already calls
**inert** (clean, nothing unpushed, no live agent) that nothing above would show.
A search looks through hidden worktrees, so a name you type is never "missing".

What is held back is always said: a count badge on the panel's **options** button
in the header (primary while rows are being held back, quiet once you chose to
look at them), a *N hidden · Show* line under each expanded project, the *View
hidden worktrees (N)* checkbox — a view switch, the marks stay — and *Stop hiding
worktrees* — the action that ends the hiding — in the options menu (a project's
⋯ menu has *Stop hiding worktrees here*), and a count beside the branch glyph of
a collapsed project. When a flat view has nothing to draw, the empty state says
*Every worktree here is hidden* with a *Show N hidden* button, which is not the
same message as *No projects yet*. Removing a worktree forgets its marks, and a
mark whose worktree is gone is pruned once every project has loaded.

**Worktrees created outside Uxnan start out set aside.** A worktree an agent's
CLI or a `git worktree add` made on its own — a scratch checkout, a throwaway
experiment — is held back the same way a hidden one is, **while it is
untouched**: clean, nothing unpushed, no live agent, no open pull request (the
completion verdict `inert`). The rule is the hidden one plus two inputs
(`sidebar-visibility.ts`: `external` and `quiet`), so it is *counted* in the same
badge and *N hidden · Show* line, *surfaced* by the same reasons in the table
above, *lifted* by *View hidden worktrees* and by a search, and recoverable by the
same *Show*. The moment there is work in it — a change, a commit, an agent, a PR
— it is an ordinary row; when it goes quiet again it is set aside again, unless
you showed it. (A merged or closed one lands in *Ready to close*, never hidden.)

Who made a worktree is a **fact**, kept where the worktree is. Whoever creates
one for Uxnan — the dialog, `worktree/create`, the PR and issue checkouts, a
host's engine, the bridge for the phone — leaves an empty file `uxnan-created` in
the worktree's own git admin directory (`<common dir>/worktrees/<name>/`,
`crates/workspace-engine/src/git.rs` → `mark_created`; the bridge's twin is
`markWorktreeCreated`). It has the worktree's lifetime — `git worktree remove` and
`prune` delete it, `git worktree move` keeps it — git ignores it, and listing
reads it into `WorktreeEntry.createdByUxnan`. *Taking it in* is a **decision**,
kept with the panel's other view state in `app.settings.knownWorktrees` (and
which projects were taken in in `worktreeBaselineProjects`):

| A worktree becomes known when… | Why |
|---|---|
| it was **already there** the first time its project was listed — this feature arriving, or the project being added | nothing that existed before may vanish; only what *appears afterwards* is new (`baselineKnown`) |
| you **show** it (its menu, *Show* in the project line), **pin** it, or choose **Stop hiding worktrees** | "I looked at it once" is a decision: it stays, even when it goes quiet again |

The first listing only counts when git answered: the one-entry stand-in a project
gets while its host cannot be asked takes nothing in and does not use up the
project's first listing (`isAuthoritativeList`), or its real worktrees would all
arrive "new". *Stop hiding worktrees* ends **both** kinds of set-aside: every
hidden mark goes and every external worktree becomes known.

## Cleanup

Settings → **Git** → *Cleanup* is what keeps the managed folder from growing
forever. It is out of sight by design, and what is out of sight never gets
pruned — the sibling folders it replaced at least annoyed you into deleting
them.

Press **Look for old worktrees** and it reports two lists — **Worktrees** and
**Cloned repositories**, kept apart because they are different things with
different risk. Which list a row belongs to is stated by the backend, not
guessed from its reason: both kinds can be held back by uncommitted changes.

Between them, five buckets:

| Bucket | What it means | Pre-selected |
|---|---|---|
| **No longer owned by git** | The repository is gone from disk, or git no longer lists this folder as one of its worktrees | Yes — git owns nothing there |
| **Work finished** | A clean checkout whose branch landed on its base (merge or squash-merge), or whose remote branch is gone after being pushed | No — that is a judgement call |
| **No longer a project in uxnan** | The repository is still on disk, but you removed it from the app — which touches nothing on disk, so its worktrees stayed | No — the repository and the branch are both intact |
| **Cloned repositories, fully pushed** | A repository in `~/uxnan/repos` that is no longer a project **and** whose every commit is already on a remote | No — see below |
| **Held back** | In either list: a terminal running in it, uncommitted changes, unpushed commits, stashes, no remote, or worktrees still out — each row states which | Never |

Each list has a **select-all** beside its heading. It reaches only the rows the
safety rules allow removing — a held-back one is never picked up by it — and
stays within its own list.

Sizes are fetched after the list appears (`worktree_cleanup_sizes`): walking a
checkout's `node_modules` costs more than every git query in the scan combined.

### Cloned repositories are held to a higher bar

A worktree is a second checkout of history that lives in the repository, so
removing one costs a checkout. A clone **is** the history. It is therefore only
offered when it can be *proved* that deleting the folder loses nothing:

1. it is not a registered project;
2. the working tree is clean;
3. no linked worktrees point into it (removing it would break them);
4. no stashes — those live in no remote and no branch;
5. it has a remote at all;
6. **no commit on any local branch is missing from every remote**
   (`git rev-list --branches --not --remotes --count`).

Anything failing 2–6 is listed **blocked**, naming the gate: "3 commits are on
no remote" is worth saying out loud far more than it is worth hiding. A count
git could not read is treated as unsafe, never as zero. Every gate is re-proved
at removal time, because the list the user acted on may be minutes old and a
pull or a commit in between has to move the answer.

Only `~/uxnan/repos` is ever looked at — that folder is not configurable, unlike
the worktree root, because the clone destination is an editable suggestion. A
repository you keep anywhere else is never listed and never touched.

### Why it is safe to have a delete button here

Implementation: [`src-tauri/src/worktreeclean.rs`](../src-tauri/src/worktreeclean.rs).

- **A folder that is itself a work tree is never descended into.** A worktree
  can sit straight in the root — made by hand, or through the dialog's custom
  location — and reading it as a group folder listed the project's own
  directories as abandoned worktrees, pre-selected. It is classified as the one
  worktree it is instead.
- **No marker proves nothing.** A folder uxnan never placed is reported as
  nothing at all; only a marker *naming a repository that is gone* means
  orphaned.
- **Anything with a terminal running in it is held back**, including a terminal
  open in a subfolder. An agent works by writing files, so between two writes
  the checkout is clean — "clean right now" is not enough on its own.
- **It only ever looks inside the managed roots** — the global one plus each
  project's override. A worktree beside its repository, or anywhere else you put
  one, is never listed and never touched. Symlinked entries are skipped, so a
  link cannot walk the scan out of the folder.
- **Nothing is automatic.** The scan reports, you pick, and the button removes.
- **Every path is re-verified at removal time** against a fresh scan — inside a
  root, still disposable, still clean — instead of being trusted from the
  caller. A list that went stale while you read it cannot delete the wrong
  folder, and a refusal comes back with its reason rather than being skipped
  silently.
- **"Never pushed" is not "finished".** A branch with no upstream is simply one
  you never pushed; only a branch that *had* a remote-tracking ref and lost it
  counts. Read from the last fetch — this screen never goes to the network.
- **An untouched branch is never offered**, because `branch_integrated` treats a
  branch that never diverged from its base as unfinished rather than merged.
  That rule is also why closing a project needed its own category: a worktree
  created and never touched is neither orphaned nor finished, so without it the
  worktrees of every project you close would be invisible here forever.

### What removal actually does

The folder is renamed into `.uxnan-trash` inside the same root (instant, and on
one volume by construction) and deleted in the background; `git worktree prune`
then drops the admin entry. Deleting a checkout in the foreground is tens of
seconds of frozen UI.

Removing the last worktree of a project also **prunes its group folder**, but
only when nothing is left in it but the marker. That matters beyond tidiness: a
`.uxnan-repo` outliving its repository used to be read as a live claim by the
next project of the same name, which then got a hash suffix on a name that was
free. For the same reason, a marker naming a repository that no longer exists is
now treated as litter — the name is reclaimed and the marker rewritten — while a
marker naming one that still exists keeps its group.

If the app dies mid-delete, the next startup sweeps the leftovers — matching
**only** names this app generated (`wt-<millis>-<32 hex>`), inside a trash folder
inside a managed root. It never deletes a folder just because of where it sits.

### The status-bar nudge

Once the managed folder holds 12 or more checkouts, a one-time item appears in
the status bar — the bar's usual style, a broom and the count — that opens this
section. It counts **folders**, not bytes: measuring the size means walking
every `node_modules`, and that question would be asked at every startup.
Clicking it retires it for good (`worktrees.cleanupNoticeDismissed`): once you
have looked, the nudge has done its job — a reminder that returns after being
looked at is nagging, and this section is always here to open on purpose.

## When a folder is not there

Two states the app used to carry silently, both answered the same way: **detect,
mark, stop spending work on it, offer the action — never take it.**

The reason that rule is not timidity: **a missing folder is not proof of
deletion.** An unmounted drive, an offline network share and a cloud placeholder
that has not hydrated all look exactly like a folder that was deleted. Acting on
that guess turns a temporary absence into a permanent loss.

| State | What the app does |
|---|---|
| A **project** whose folder is gone | Marks the card, skips it in the worktree reconcile and the GitHub badge poll (asking git and `gh` about a missing path produced nothing but failed spawns, forever), and leaves removing it to the ⋯ menu |
| A **worktree** git still lists whose folder is gone | Lists it under Settings → Git → *Git bookkeeping* with a **Forget them** action per project (`git worktree prune`) |

Pruning is the safest thing in this page: it removes **records, never files**,
because the directories it forgets are already missing. It is still never
automatic — pruning a drive that gets plugged back in tomorrow would leave that
checkout orphaned from its repository.

## Rules the resolver applies

In order, from `worktreeloc.rs`:

1. **The group is measured from the repository's main worktree** (the first
   `git worktree list` entry). Creating a worktree while standing *in* another
   one must not nest the new folder under it.
2. **The branch is folded into a folder name valid on every OS**: `/` and `\` →
   `-`; the characters Windows rejects (`<>:"|?*`, control codes) are dropped;
   the trailing dots and spaces Windows silently strips are trimmed (otherwise
   the folder we ask for and the folder that appears are two different names);
   its reserved device names (`CON`, `NUL`, `COM1`, …) are escaped with a leading
   `_`; and the name is capped at 60 characters on a word boundary.
3. **Two projects that share a folder name get separate groups.** The group
   folder holds a `.uxnan-repo` marker naming the repository it belongs to; if
   another project already claimed it, the group becomes `<project>-<hash8>`.
   The digest is FNV-1a, written out by hand rather than taken from Rust's
   `DefaultHasher` (whose output is not stable across releases) — it names a
   folder on disk, so it has to be the same forever.
4. **A taken destination takes the next free suffix** (`-2`, `-3`, …), because
   `git worktree add` refuses an existing directory.
5. **A WSL repository resolves inside the distro**
   (`//wsl.localhost/<distro>/<home>/uxnan/worktrees/…`), never on the Windows
   side of the 9P share, where a checkout is slow and loses file modes. The home
   is read off the repo's own path when it lives under `/home/<user>/`, and asked
   of the distro otherwise.
6. Paths are returned with forward slashes — the spelling `git worktree list`
   uses, which is what the frontend keys per-worktree workspaces off.

## One owner, on purpose

This layout used to be computed in three places: the Rust backend, the Svelte
create dialogs, and the phone. They drifted — the desktop produced
`<repo>--<branch>` and the phone `<repo>-<branch>` for the same repository and
branch. It now lives only in `worktreeloc.rs`; the dialogs render a preview from
`worktree_preview_path`, and `src/lib/branchName.ts` computes branch *names*
only.

If you add a caller that creates a worktree, resolve through
`commands.rs::resolve_worktree_location` and call `worktreeloc::prepare` before
`git worktree add` — that is what creates the group folder and claims it.

## Reusing an existing checkout

The PR and issue flows ask git **which worktree is on the branch** instead of
testing whether a computed path exists. That is what makes a re-run find the
existing checkout wherever it lives, including one created under the sibling
layout or moved by hand.

## Windows path length

The managed root is usually *shorter* than the sibling it replaces for a repo
kept under `Documents\GitHub\…`, which matters: `git worktree remove` fails with
*"Filename too long"* once a checkout's own deep paths (`node_modules`, `target`)
push past the 260-character limit. If you hit it anyway, point the root at
something short (`D:/wt`) with **Custom folder**, globally or for that project.
