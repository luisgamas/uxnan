# Worktrees — where they land, and why

Every task in uxnan gets its own git worktree. This page covers **where those
folders are created**, how to change it, and the rules the resolver applies so
the result is a path git accepts and the app can find again.

Spec: [`architecture/02c-git-worktrees.md`](../architecture/02c-git-worktrees.md)
§2.1. Implementation: [`src-tauri/src/worktreeloc.rs`](../src-tauri/src/worktreeloc.rs).

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

## Cleanup

Settings → **Git** → *Cleanup* is what keeps the managed folder from growing
forever. It is out of sight by design, and what is out of sight never gets
pruned — the sibling folders it replaced at least annoyed you into deleting
them.

Press **Look for old worktrees** and it reports five buckets:

| Bucket | What it means | Pre-selected |
|---|---|---|
| **No longer owned by git** | The repository is gone from disk, or git no longer lists this folder as one of its worktrees | Yes — git owns nothing there |
| **Work finished** | A clean checkout whose branch landed on its base (merge or squash-merge), or whose remote branch is gone after being pushed | No — that is a judgement call |
| **No longer a project in uxnan** | The repository is still on disk, but you removed it from the app — which touches nothing on disk, so its worktrees stayed | No — the repository and the branch are both intact |
| **Cloned repositories, fully pushed** | A repository in `~/uxnan/repos` that is no longer a project **and** whose every commit is already on a remote | No — see below |
| **Has unsaved changes** | Listed with the reason and its count, never removable from here | Never |

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

If the app dies mid-delete, the next startup sweeps the leftovers — matching
**only** names this app generated (`wt-<millis>-<32 hex>`), inside a trash folder
inside a managed root. It never deletes a folder just because of where it sits.

### The status-bar nudge

Once the managed folder holds 12 or more checkouts, a one-time item appears in
the status bar linking here. It counts **folders**, not bytes: measuring the
size means walking every `node_modules`, and that question would be asked at
every startup. Dismissing it is permanent
(`worktrees.cleanupNoticeDismissed`) — a reminder that returns after being waved
away is nagging, and this section is always here to open on purpose.

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
