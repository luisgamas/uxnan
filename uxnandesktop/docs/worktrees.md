# Worktrees — where they land, and why

Every task in uxnan gets its own git worktree. This page covers **where those
folders are created**, how to change it, and the rules the resolver applies so
the result is a path git accepts and the app can find again.

Spec: [`architecture/02c-git-worktrees.md`](../architecture/02c-git-worktrees.md)
§2.1. Implementation: [`src-tauri/src/worktreeloc.rs`](../src-tauri/src/worktreeloc.rs).

## Settings → Git

Two sections. **Identity** is read-only: the name, email, `init.defaultBranch`
and git version the app reads from git's **global/system** configuration
(`git_identity` → `git::identity`), never from an open repository — a repo can
override its own author, and reporting that here would describe an identity the
user does not have anywhere else. An unset name/email is shown as such, because
it is what makes `git commit` fail later. **Worktree location** is the rest of
this page.

## The three layouts

Settings → **Git** → *Worktree location*:

| Mode | Path | When |
|---|---|---|
| **Managed folder** (default) | `<home>/uxnan/worktrees/<project>/<branch>` | Groups a repository's checkouts under a folder uxnan owns, beside the `<home>/uxnan/<project>` the clone flow already writes to |
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
