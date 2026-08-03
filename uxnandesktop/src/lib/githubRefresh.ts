// GitHub refresh policy — pure TS, no Svelte imports (so Vitest can test it).
//
// One rule governs everything here: a *background* refresh must only ever ADD
// information. It may not blank a value the user is already looking at.

/** How many consecutive `null` reads it takes to blank a context we already have.
 *  `github_repo_context` answers `Option<RepoContext>`, so a transient failure
 *  (a git lock, a slow `gh` spawn, a dropped network) is indistinguishable from
 *  "this isn't a GitHub repo" — one miss must not be enough to tear the panel
 *  down and replace it with "not a GitHub repo". */
export const CONTEXT_MISS_TOLERANCE = 2;

/** Inputs to "does this context read replace what is on screen?". */
export interface ContextUpdate<T> {
  /** What the backend just answered (`null` = no GitHub context). */
  next: T | null;
  /** What we are currently showing for this same path. */
  previous: T | null;
  /** Consecutive `null` reads so far for this path. */
  misses: number;
  /** How many misses in a row it takes to accept the `null` (default
   *  {@link CONTEXT_MISS_TOLERANCE}). */
  tolerance?: number;
}

/** Decide what a context read leaves on screen.
 *
 *  A `null` over a context we already hold is treated as a *miss* rather than an
 *  answer: the panel keeps rendering until the backend says `null` several times
 *  in a row. A `null` with nothing to protect is taken at face value — that is
 *  the honest "this worktree isn't a GitHub repo" answer, and it must still show
 *  up immediately on a worktree that never had a context. */
export function resolveContext<T>(u: ContextUpdate<T>): { context: T | null; misses: number } {
  if (u.next !== null) return { context: u.next, misses: 0 };
  if (u.previous === null) return { context: null, misses: 0 };
  const misses = u.misses + 1;
  if (misses >= (u.tolerance ?? CONTEXT_MISS_TOLERANCE)) return { context: null, misses: 0 };
  return { context: u.previous, misses };
}
