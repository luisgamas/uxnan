// GitHub refresh policy — pure TS, no Svelte imports (so Vitest can test it).
//
// Both decisions here exist for the same reason: a *background* refresh must only
// ever ADD information. It may not blank a value the user is already looking at,
// and it may not spend a `gh` call on something that is merely stale while another
// worktree still shows nothing at all.

/** How many non-active worktrees may have their PR badge re-read per poll tick.
 *  Each one is a `gh` invocation against the account's API rate limit, so the
 *  badges catch up over a few ticks instead of all at once. */
export const BADGE_TICK_CAP = 2;

/** How many consecutive `null` reads it takes to blank a context we already have.
 *  `github_repo_context` answers `Option<RepoContext>`, so a transient failure
 *  (a git lock, a slow `gh` spawn, a dropped network) is indistinguishable from
 *  "this isn't a GitHub repo" — one miss must not be enough to tear the panel
 *  down and replace it with "not a GitHub repo". */
export const CONTEXT_MISS_TOLERANCE = 2;

/** Inputs to "which worktrees does this badge tick re-read?". */
export interface BadgeTickInput {
  /** Every known worktree path across all projects. */
  known: string[];
  /** The active worktree — it has its own load, so it is never picked here. */
  active: string | null;
  /** Paths whose git status just changed (drained from the projects store) plus
   *  anything a previous tick could not fit. */
  changed: string[];
  /** Paths that already have a cached context — i.e. a badge on screen. */
  primed: string[];
  /** Round-robin cursor over `known`, carried between ticks. */
  cursor: number;
  /** How many paths this tick may read. */
  cap: number;
}

export interface BadgeTick {
  /** The paths to read now. */
  picks: string[];
  /** The cursor to carry into the next tick. */
  cursor: number;
  /** Signalled paths that did not fit. They were *drained* from the projects
   *  store and nothing will announce them again, so the caller carries them
   *  forward instead of dropping them on the floor. */
  pending: string[];
}

/** Pick the worktrees whose PR badge this tick should re-read.
 *
 *  Priority, highest first:
 *  1. **Never read** — a worktree showing no badge at all is missing information,
 *     not stale information. This is what makes a freshly-opened app fill its
 *     sidebar instead of trickling two badges every poll interval.
 *  2. **Just changed** — new commits or a push is exactly when a branch gains or
 *     updates a PR, so it is the signal worth spending a call on.
 *  3. **Round-robin** — so a repo nobody touched is still re-read eventually
 *     rather than never.
 */
export function pickBadgeTargets(input: BadgeTickInput): BadgeTick {
  const { active, cursor, cap } = input;
  const candidates = [...new Set(input.known)].filter((p) => p !== active);
  if (candidates.length === 0 || cap <= 0) {
    return { picks: [], cursor, pending: [] };
  }
  const primed = new Set(input.primed);
  const picks: string[] = [];
  const take = (path: string) => {
    if (picks.length < cap && !picks.includes(path)) picks.push(path);
  };

  for (const path of candidates) if (!primed.has(path)) take(path);

  const changed = [...new Set(input.changed)].filter((p) => candidates.includes(p));
  for (const path of changed) take(path);

  let next = cursor;
  for (let i = 0; i < candidates.length && picks.length < cap; i++) {
    take(candidates[next++ % candidates.length]);
  }

  return { picks, cursor: next, pending: changed.filter((p) => !picks.includes(p)) };
}

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
