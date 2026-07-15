/**
 * Day bucketing for the activity heatmap. Buckets by the **bridge host's local
 * calendar day** (the agent runs on this PC, so "work done that day" is naturally
 * in the PC's timezone). Shared by the conversation aggregate and the git-action
 * work buckets so both land on the same day boundaries.
 */

/** Start of the local calendar day containing [ms], as epoch ms. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
