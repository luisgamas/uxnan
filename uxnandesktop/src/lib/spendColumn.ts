// How one day's column of the spend chart is laid out: the agents' segments
// stacked bottom up, each one visible and apart from the next. The phone draws
// its chart by the same rule (`spend_chart.dart` → `stackColumn`), so a day
// reads alike on both.
//
// The column is one shape — its rounded top is the chart's clip, not a corner
// of whichever segment happens to be on top — so a column of one agent and one
// of five end the same way. Each segment keeps a minimum height and a gap to
// the next: a tiny share still shows its colour, and never disappears into the
// gap. What a small segment gains comes out of the largest ones, so the
// column's height stays the day's total; only a column too short to hold every
// segment it has grows to fit them.

/** Where a segment sits: pixels up from the baseline. */
export interface ColumnSegment {
  index: number;
  bottom: number;
  top: number;
}

export interface ColumnLayout {
  /** The column's height from the baseline. */
  height: number;
  /** The non-empty values' segments, bottom up, in the order given. */
  segments: ColumnSegment[];
}

/** The gap between two segments and the least a segment is drawn at (px). */
export const SEGMENT_GAP = 2;
export const MIN_SEGMENT = 2;

/**
 * The column for [values] (one per agent, bottom up; zeros are skipped) whose
 * total is drawn [height] pixels tall.
 */
export function stackColumn(values: readonly number[], height: number): ColumnLayout {
  const present = values.map((value, index) => ({ value, index })).filter((v) => v.value > 0);
  if (present.length === 0) return { height: 0, segments: [] };
  const gaps = SEGMENT_GAP * (present.length - 1);
  const columnHeight = Math.max(height, gaps + MIN_SEGMENT * present.length);
  const room = columnHeight - gaps;
  const total = present.reduce((sum, v) => sum + v.value, 0);
  const sizes = present.map((v) => (v.value / total) * room);

  // Lift every segment below the minimum; take it from the ones above it,
  // largest first, never below the minimum themselves.
  let owed = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i]! < MIN_SEGMENT) {
      owed += MIN_SEGMENT - sizes[i]!;
      sizes[i] = MIN_SEGMENT;
    }
  }
  const byLargest = sizes.map((_, i) => i).sort((a, b) => sizes[b]! - sizes[a]!);
  for (const i of byLargest) {
    if (owed <= 0) break;
    const spare = sizes[i]! - MIN_SEGMENT;
    const take = Math.min(spare, owed);
    sizes[i] = sizes[i]! - take;
    owed -= take;
  }

  let bottom = 0;
  const segments = present.map((v, i) => {
    const segment = { index: v.index, bottom, top: bottom + sizes[i]! };
    bottom = segment.top + SEGMENT_GAP;
    return segment;
  });
  return { height: columnHeight, segments };
}

/** The outline of a column [w] wide and [h] tall standing at ([x], [baseline])
 *  in SVG coordinates: square at the baseline, its top corners rounded by up
 *  to [radius]. */
export function columnOutline(x: number, baseline: number, w: number, h: number, radius = 4): string {
  const top = baseline - h;
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return [
    `M${x},${baseline}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + w - r}`,
    `Q${x + w},${top} ${x + w},${top + r}`,
    `V${baseline}`,
    "Z",
  ].join(" ");
}
