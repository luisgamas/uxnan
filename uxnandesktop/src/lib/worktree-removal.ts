// What "Remove worktree" should already know before you tick anything.
//
// There is exactly one action in a user's head — get rid of this worktree — so
// there is exactly one dialog. What changes is how much it can answer on your
// behalf: once a space is `done` or `abandoned`, its state has already decided
// whether the branch is safe to delete, and the dialog should arrive with that
// filled in and explained rather than asking again.
//
// Two rules keep the convenience honest:
//
//   - **Defaults are never destructive beyond the obvious.** A branch is only
//     pre-ticked when its commits demonstrably landed, so the safe
//     `git branch -d` will accept it. Forcing is never a default; it lives
//     behind "Advanced", where you go looking for it.
//   - **Warnings are not blockers.** Removal stays a deliberate action you are
//     allowed to take — uncommitted work and unpushed commits are said out loud,
//     not silently prevented, because sometimes wiping a dead end is the point.

import type { CompletionState } from "./worktree-completion";

export interface RemovalInputs {
  completion: CompletionState;
  /** Changed entries in the worktree (uncommitted work). */
  dirty: number;
  /** Commits not on the upstream. */
  ahead: number;
  /** Agents still alive in this workspace. */
  liveAgents: number;
  /** Detached worktrees have no branch to clean up. */
  hasBranch: boolean;
}

/** Something the user should read before confirming. Never blocks. */
export type RemovalWarning = "uncommitted" | "unpushed" | "live-agents";

export interface RemovalDefaults {
  /** Pre-tick "delete the local branch". */
  deleteLocal: boolean;
  /** The verdict worth explaining above the options, or `null` when the space
   *  isn't finished and the dialog should just be its plain self. */
  verdict: "done" | "abandoned" | null;
  /** Ordered so the costliest surprise reads first. */
  warnings: RemovalWarning[];
}

/**
 * Derive the dialog's opening state. Pure, so "what does Remove worktree
 * pre-select, and why" is a unit test rather than a thing you discover by
 * deleting something.
 */
export function removalDefaults(input: RemovalInputs): RemovalDefaults {
  const warnings: RemovalWarning[] = [];
  // Uncommitted work first: it is the only one that cannot be recovered from
  // anywhere else once the directory is gone.
  if (input.dirty > 0) warnings.push("uncommitted");
  if (input.ahead > 0) warnings.push("unpushed");
  if (input.liveAgents > 0) warnings.push("live-agents");

  const verdict =
    input.completion === "done" || input.completion === "abandoned"
      ? input.completion
      : null;

  return {
    // Only work that demonstrably landed earns a pre-ticked delete: `-d` will
    // accept it without a force. `abandoned` never does — nobody merged it, and
    // git would refuse anyway.
    //
    // Uncommitted files deliberately do NOT hold this back: they are not
    // commits, so they say nothing about whether the branch is safe to drop.
    deleteLocal: input.completion === "done" && input.hasBranch,
    verdict,
    warnings,
  };
}
