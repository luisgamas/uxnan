// Grouping the sidebar by where each workspace sits in the review process.
//
// The two views uxnan already had answer different questions: the tree asks
// "what belongs to what", the attention lanes ask "who needs me right now".
// Neither answers "how far along is this" — and that is the question you start
// asking once workspaces are cheap enough to have a dozen of them, because a
// branch waiting on a reviewer needs nothing from you but is not finished
// either.
//
// The lanes are ordered by how much of *your* action they want, not by progress:
// something failing checks needs a change now, something merged needs closing
// eventually, something without a PR is just work in flight.

/** A pull request as this grouping reads it. */
export interface ReviewPr {
  /** Provider state — compared case-insensitively (`gh` yields `MERGED`). */
  state: string;
  isDraft: boolean;
  /** Roll-up of the CI checks. */
  checks?: { state?: string | null } | null;
}

export type ReviewGroup =
  /** Open, checks failing — the only lane asking you to do something now. */
  | "failing"
  /** Open and not a draft: someone else's turn. */
  | "in-review"
  /** Open but a draft, or no pull request at all: still yours. */
  | "in-progress"
  /** Merged — the work landed; closing the space is the leftover. */
  | "merged"
  /** Closed without merging. */
  | "closed";

/** Lane order, most-actionable first. */
export const REVIEW_GROUP_ORDER: readonly ReviewGroup[] = [
  "failing",
  "in-review",
  "in-progress",
  "merged",
  "closed",
];

/**
 * Which lane a workspace belongs to. `null` = no pull request discovered, which
 * is deliberately the same lane as a draft: both mean the work has not been
 * handed over yet.
 */
export function reviewGroupOf(pr: ReviewPr | null | undefined): ReviewGroup {
  if (!pr) return "in-progress";
  const state = pr.state.trim().toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  // Open. A failing run outranks everything else here: it is the one state in
  // this view that is blocked on *you*, and burying it under "in review" is how
  // a red branch sits for a day.
  if ((pr.checks?.state ?? "").trim().toLowerCase() === "failure") return "failing";
  return pr.isDraft ? "in-progress" : "in-review";
}

/** Group `items` into review lanes, dropping the empty ones. Pure, so the
 *  bucketing is unit-tested without a repo or a network. */
export function buildReviewGroups<T>(
  items: readonly T[],
  prOf: (item: T) => ReviewPr | null | undefined,
): { group: ReviewGroup; items: T[] }[] {
  const out: { group: ReviewGroup; items: T[] }[] = [];
  for (const group of REVIEW_GROUP_ORDER) {
    const inLane = items.filter((it) => reviewGroupOf(prOf(it)) === group);
    if (inLane.length > 0) out.push({ group, items: inLane });
  }
  return out;
}
