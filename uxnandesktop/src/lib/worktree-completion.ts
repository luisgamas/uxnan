// Is this workspace finished?
//
// The sidebar can already say what an agent is *doing*; it has never been able to
// say that a space is **done with** — so a worktree whose PR merged three weeks
// ago sits in the panel exactly like the one you opened this morning. This is the
// classifier behind that, and the whole design rests on one rule:
//
//   **Only a verdict uxnan can defend proposes closing anything.**
//
// A merged PR, a closed PR and a branch git itself agrees has landed are facts.
// "Nothing has moved in a while" is not — it is the state of every branch you
// mean to come back to on Monday. So the quiet case gets its own value that the
// UI may dim but must never offer to delete.

/** PR-ish input, narrowed to what the verdict needs. */
export interface CompletionPr {
  /** Provider state — compared case-insensitively (`gh` yields `MERGED`/`CLOSED`). */
  state: string;
}

export interface CompletionInputs {
  /** The cached pull request for this worktree's branch, if any. */
  pr: CompletionPr | null;
  /** Working-tree summary, or null while it is still unknown. */
  status: { dirty: number; ahead: number; behind: number } | null;
  /** Whether the branch already landed in the base. `null` = not asked yet
   *  (the answer costs a git call, so it is filled in lazily for candidates). */
  integrated: boolean | null;
  /** Any agent still alive in this workspace. */
  hasLiveAgent: boolean;
  /** The project's primary worktree. Never closable — closing it would mean
   *  removing the project, which is a different, louder decision. */
  isMain: boolean;
}

export type CompletionState =
  /** Still in play: work in progress, an open PR, or a live agent. */
  | "active"
  /** Quiet — clean, nothing unpushed, nobody home — but nothing *proves* it is
   *  over. Dim it; never propose closing it. */
  | "inert"
  /** Its pull request was closed without merging. The work was dropped. */
  | "abandoned"
  /** The work landed: the PR merged, or git confirms the branch is in the base
   *  (as real ancestry or as a squash). */
  | "done";

/** Verdicts uxnan is willing to act on — the only ones that may offer a close. */
export function isClosable(state: CompletionState): boolean {
  return state === "done" || state === "abandoned";
}

/**
 * Classify a workspace, from cheapest evidence to most expensive.
 *
 * Order matters: the provider's own verdict on the pull request outranks
 * anything inferred locally, because it survives a branch that was deleted on
 * the remote, a rebase, or a squash that local history cannot explain.
 */
export function classifyCompletion(input: CompletionInputs): CompletionState {
  if (input.isMain) return "active";

  const prState = input.pr?.state.trim().toUpperCase();
  if (prState === "MERGED") return "done";
  if (prState === "CLOSED") return "abandoned";
  // An open PR means the work is still in review — explicitly in play, even if
  // the checkout has gone quiet.
  if (prState === "OPEN") return "active";

  if (input.integrated === true) return "done";

  const quiet =
    !input.hasLiveAgent &&
    input.status != null &&
    input.status.dirty === 0 &&
    input.status.ahead === 0;
  return quiet ? "inert" : "active";
}

/**
 * Whether it is worth spending a git call to ask if this branch landed.
 *
 * The check spawns git, so it is only asked where it can change the answer: a
 * worktree with no PR verdict that already looks quiet. Anything dirty, ahead,
 * hosting a live agent, or already judged by its pull request is skipped — which
 * is what keeps the sweep affordable on the modest hardware uxnan targets.
 */
export function shouldCheckIntegration(input: CompletionInputs): boolean {
  if (input.isMain || input.integrated != null) return false;
  const prState = input.pr?.state.trim().toUpperCase();
  if (prState === "MERGED" || prState === "CLOSED" || prState === "OPEN") return false;
  return (
    !input.hasLiveAgent &&
    input.status != null &&
    input.status.dirty === 0 &&
    input.status.ahead === 0
  );
}
