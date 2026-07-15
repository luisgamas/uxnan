/**
 * Day bucketing for the activity heatmap.
 *
 * Buckets by the **bridge host's local calendar date** (the agent runs on this
 * PC, so "work done that day" is naturally in the PC's timezone), but encodes
 * that date as **UTC midnight** rather than the local-midnight instant. That
 * makes the key **timezone-stable**: the phone can match it to a heatmap cell
 * without knowing the bridge's offset. A local-midnight *instant* (e.g. 06:00Z
 * for UTC-6) reconstructed on a phone in another zone lands on the wrong
 * calendar day and the day never paints — this avoids that.
 *
 * Shared by the conversation aggregate and the git-action work buckets so both
 * land on the same boundaries.
 */

/** The UTC-midnight epoch ms of the local calendar date containing [ms]. */
export function utcDayKey(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
