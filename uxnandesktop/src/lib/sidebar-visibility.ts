// Which worktrees the left panel shows, and why one it was told to hide is shown
// anyway.
//
// "Hidden" is a **view state, not a verdict**: a worktree you hid is still on
// disk, still in the palette, still counted ("3 hidden"), and one call from
// coming back. That is the line `DONE-027` drew — hiding must never stand in for
// *closing* — and every rule below is there to keep it:
//
//   * hiding is a decision (persisted, one list); whether a hidden worktree is
//     *visible right now* is derived from live facts, never written back. A late
//     notification can therefore never leave a row stuck hidden, and an agent
//     finishing can never leave one stuck shown;
//   * a worktree **created outside Uxnan** (plain `git worktree add`, a CLI
//     agent's scratch checkout) starts out *set aside* the same way a hidden one
//     is — but only while it is untouched (`quiet`). Nobody decided to hide it,
//     so the rule is derived too: provenance is a fact the engine records when it
//     creates a worktree (`createdByUxnan`), and the user's acknowledgement
//     ("show it" once, or "it was already here when this arrived") is a persisted
//     decision (`known`). One notion — *set aside* — serves both, so the count,
//     the "N hidden · Show" line, the surface reasons and "show all" cannot
//     disagree about either kind;
//   * the panel's three views and the "Ready to close" lane read the same
//     answer, so none of them can disagree about what exists.
//
// Pure and free of Svelte, like `sidebar-sort.ts`: the store feeds it plain
// facts and the rules are unit-tested.

import type { AttentionClass } from "$lib/sidebar-sort";
import type { CompletionState } from "$lib/worktree-completion";

/** What the rules need to know about one worktree. */
export interface VisibilityInputs {
  /** The user hid it (it is in the persisted list). */
  hidden: boolean;
  /** Created outside Uxnan and not yet acknowledged (`isExternalWorktree`). */
  external: boolean;
  /** Untouched: clean, nothing unpushed, no live agent, no open pull request
   *  (the completion verdict `inert`). An external worktree is only set aside
   *  while it is quiet — one with work in it is somebody's work. */
  quiet: boolean;
  /** The project's primary worktree — the project's own context. */
  isMain: boolean;
  /** Pinned: the user said "keep this in front of me", which is the opposite of
   *  hiding. */
  pinned: boolean;
  /** It is the selected worktree. Hiding what you are looking at would pull the
   *  floor out from under the pointer. */
  active: boolean;
  /** The attention class of its agents (`attentionClass`): 1 needs you, 2 an
   *  unread result, 3 working, 4 nothing to say. */
  attention: AttentionClass;
  /** Its work landed or was abandoned, so it belongs in "Ready to close".
   *  Hiding a worktree must never hide a decision the panel is asking for. */
  closable: boolean;
  /** An agent in it surfaced it and has since gone quiet — typically because the
   *  result was just read — and the user has not selected another worktree yet.
   *  It stays until then: a row that vanishes the moment you read what it was
   *  showing you is the one place hiding would feel like losing something. */
  lingering: boolean;
}

/** Why a worktree is shown although it may be in the hidden list. */
export type SurfaceReason = "main" | "pinned" | "active" | "attention" | "closable" | "lingering";

/** Attention classes at or below this surface a hidden worktree: needs-you,
 *  an unread result, and working. Class 4 — idle — does not. */
export const SURFACING_ATTENTION: AttentionClass = 3;

/** The reason a worktree stays visible regardless of the hidden list, or null
 *  when nothing overrides it. In order of how little the user could mean it
 *  otherwise: the primary worktree cannot be hidden at all. */
export function surfaceReason(input: VisibilityInputs): SurfaceReason | null {
  if (input.isMain) return "main";
  if (input.pinned) return "pinned";
  if (input.active) return "active";
  if (input.closable) return "closable";
  if (input.attention <= SURFACING_ATTENTION) return "attention";
  if (input.lingering) return "lingering";
  return null;
}

/** What is still lingering after the world moved on. Pure, so the "does not
 *  vanish under the pointer" rule is a test rather than a hope.
 *
 *  - Selecting a **different** worktree ends every linger: that is the user
 *    moving on, the one signal that says the result has been dealt with.
 *  - A hidden worktree an agent is surfacing right now (`attentive`) starts one,
 *    so it is already lingering when the agent goes quiet.
 *  - A path no longer in the hidden list has nothing left to linger over.
 */
export function nextLingering(
  prev: readonly string[],
  ctx: {
    activePath: string | null;
    previousActivePath: string | null;
    hidden: readonly string[];
    /** Hidden worktrees surfaced by an agent right now. */
    attentive: readonly string[];
  },
): string[] {
  const moved = ctx.activePath !== ctx.previousActivePath;
  const next = new Set(moved ? [] : prev);
  for (const path of ctx.attentive) next.add(path);
  return [...next].filter((p) => ctx.hidden.includes(p));
}

/** Whether a worktree was created outside Uxnan and nobody has taken it in:
 *  not the primary one, not made by Uxnan (`createdByUxnan`, the engine's
 *  record), and not acknowledged (`known`). */
export function isExternalWorktree(w: {
  isMain: boolean;
  createdByUxnan: boolean;
  known: boolean;
}): boolean {
  return !w.isMain && !w.createdByUxnan && !w.known;
}

/** Marked to be out of the list: hidden by the user, or external and untouched.
 *  Whether it is *drawn* still depends on the surface reasons. */
export function isSetAside(input: VisibilityInputs): boolean {
  return input.hidden || (input.external && input.quiet);
}

/** Set aside **and** nothing surfaces it: the rows the panel is currently
 *  holding back, which is what the "N hidden" count counts. */
export function isSuppressed(input: VisibilityInputs): boolean {
  return isSetAside(input) && surfaceReason(input) === null;
}

/** Whether the menus may offer "Hide" for this worktree. Never for the primary
 *  worktree, a pinned one (pin says "keep it in front of me") or one that is
 *  ready to close (that decision is not the user's to bury); and not for one
 *  already set aside — that is "Show".
 *
 *  A worktree that is selected or has an agent at work *can* be hidden: the
 *  request is kept, and the row leaves the list the moment nothing surfaces it —
 *  which is what "hide this one for later" means. */
export function canHide(input: VisibilityInputs): boolean {
  return !isSetAside(input) && !input.isMain && !input.pinned && !input.closable;
}

/** Whether hiding takes effect now, or waits for the worktree to go quiet
 *  (selected, or an agent still at work). For the confirmation the user sees. */
export function hidesImmediately(input: VisibilityInputs): boolean {
  return surfaceReason(input) === null;
}

/** Whether a bulk "hide idle worktrees" may take this one: hideable, nothing
 *  surfacing it, *and* quiet by the same verdict the rest of the panel already
 *  uses (clean, nothing unpushed, no live agent). The bulk action acts on a
 *  count rather than on a worktree you are looking at, so it is the stricter of
 *  the two. */
export function canHideIdle(input: VisibilityInputs, completion: CompletionState): boolean {
  return canHide(input) && hidesImmediately(input) && completion === "inert";
}

/** Whether a row is drawn. A search looks through hidden worktrees on purpose
 *  (typing a name and not finding it because it is hidden would be the one
 *  moment the feature looks like data loss), and "show hidden" lifts the filter
 *  entirely. */
export function isRowShown(
  input: VisibilityInputs,
  opts: { showHidden: boolean; searching: boolean },
): boolean {
  if (opts.showHidden || opts.searching) return true;
  return !isSuppressed(input);
}

/** Drop marks (hidden or known) whose worktree is gone, so a list cannot
 *  accumulate paths that no longer exist. Returns the same array when nothing
 *  changed. */
export function pruneMarks(marks: readonly string[], existing: ReadonlySet<string>): string[] {
  const kept = marks.filter((p) => existing.has(p));
  return kept.length === marks.length ? (marks as string[]) : kept;
}

// --- Taking in what was already there -----------------------------------------

/** Whether a project's worktree list is the answer of its git, rather than the
 *  one-entry stand-in a project gets while its host cannot be asked (a lone
 *  primary entry with no branch). Taking in the existing worktrees on a stand-in
 *  would file the project as done before its real worktrees were ever listed —
 *  and they would all arrive as "new" and vanish. A folder that is not a
 *  repository answers the same way, which is harmless: it has nothing to take. */
export function isAuthoritativeList(list: readonly { branch: string | null }[]): boolean {
  return list.length > 1 || (list.length === 1 && list[0].branch !== null);
}

/** The first time a project's worktrees are listed (after this arrived, or when
 *  the project was added), every worktree already there is *known*: they were
 *  not "created outside Uxnan while it looked", and nobody asked for them to
 *  vanish. Returns the new known list — the very same array when there is
 *  nothing to add. Worktrees Uxnan made carry their own record and need no
 *  entry; the primary one is never external. */
export function baselineKnown(
  known: readonly string[],
  list: readonly { path: string; isMain: boolean; createdByUxnan: boolean }[],
): string[] {
  const have = new Set(known);
  const add = [
    ...new Set(
      list.filter((w) => !w.isMain && !w.createdByUxnan && !have.has(w.path)).map((w) => w.path),
    ),
  ];
  return add.length === 0 ? (known as string[]) : [...known, ...add];
}

/** Make worktrees known — what showing one, pinning one, or "stop hiding" does
 *  to the external ones among them. Same array when nothing is new. */
export function addKnown(known: readonly string[], paths: readonly string[]): string[] {
  const add = [...new Set(paths)].filter((p) => !known.includes(p));
  return add.length === 0 ? (known as string[]) : [...known, ...add];
}

// --- The empty state --------------------------------------------------------

/** What the panel body should say when it has nothing to draw. Four different
 *  situations that all look the same on screen — and need four different
 *  answers, only one of which is "add a project". */
export type SidebarEmptyState =
  /** There is something to draw. */
  | "none"
  /** No project is registered. */
  | "no-projects"
  /** A search matched nothing. */
  | "no-match"
  /** Worktrees exist, and every one of them is hidden. */
  | "all-hidden"
  /** Projects exist and nothing is hidden, but no worktree is known yet. */
  | "no-worktrees";

export interface EmptyStateInputs {
  /** The tree draws projects; the flat views draw worktree rows. */
  view: "tree" | "flat";
  /** Registered projects. */
  projectCount: number;
  /** Projects that survive the search query. */
  matchedProjectCount: number;
  /** Rows the flat views would draw (ignored by the tree). */
  rowCount: number;
  query: string;
  /** Worktrees currently held back by "hidden". */
  hiddenCount: number;
  showHidden: boolean;
}

/** Decide the empty state. Pure, so "nothing here" vs "everything is hidden" is
 *  a test rather than a thing a user finds out by being confused. */
export function sidebarEmptyState(input: EmptyStateInputs): SidebarEmptyState {
  if (input.projectCount === 0) return "no-projects";
  if (input.matchedProjectCount === 0) return "no-match";
  // The tree always draws its project cards: a project whose worktrees are all
  // hidden is still a card, with its primary worktree.
  if (input.view === "tree") return "none";
  if (input.rowCount > 0) return "none";
  if (input.query.trim()) return "no-match";
  if (input.hiddenCount > 0 && !input.showHidden) return "all-hidden";
  return "no-worktrees";
}
