// Pure branch-graph layout for the History tab.
//
// Turns an ordered commit list (newest first, topological — children before
// parents) into per-row lane assignments so the panel can draw the classic
// colored branch graph (vertical lines, merges, branch splits) in an SVG gutter.
//
// Algorithm (stable-lane variant): each "lane" is a column. A lane holds the
// hash of the commit it is currently waiting to reach (its pending parent). As
// we walk rows top→bottom:
//   - The commit occupies the lane(s) that were waiting for its hash (the
//     leftmost such lane is its node; any others are incoming merge edges that
//     collapse into the node).
//   - Its first parent continues straight down in the node's lane; each extra
//     parent (a merge) opens/reuses another lane.
//   - A commit with no waiting lane is a branch tip: it takes the first free lane.
// Lanes are kept stable (a freed lane is reused in place, not compacted) so lines
// don't jump sideways between rows. Lane index → color is fixed, giving each
// branch a consistent color down the graph.

/** A single drawn edge within one row. Coordinates are lane indices; the panel
 *  maps them to x positions. The node sits at the vertical middle of the row, so
 *  an edge is one of three shapes:
 *  - `through`: a straight line top→bottom in one lane (a branch passing by).
 *  - `in`: top of `fromLane` → the node (an edge arriving at this commit).
 *  - `out`: the node → bottom of `toLane` (an edge leaving toward a parent). */
export interface GraphSegment {
  fromLane: number;
  toLane: number;
  color: string;
  kind: "through" | "in" | "out";
}

/** Layout for one commit row. */
export interface GraphRow {
  /** Lane the commit's node sits in. */
  nodeLane: number;
  nodeColor: string;
  segments: GraphSegment[];
  /** Lanes occupied at this row (for sizing the gutter). */
  lanes: number;
  /** True when the commit has 2+ parents (a merge). */
  isMerge: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Widest row's lane count (capped), to size the gutter consistently. */
  maxLanes: number;
}

/** Fixed lane palette — vivid enough to read in both light and dark themes. */
export const GRAPH_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#a855f7", // purple
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#ef4444", // red
  "#84cc16", // lime
] as const;

/** Minimal commit shape the layout needs. */
interface GraphCommit {
  hash: string;
  parents: string[];
}

/** Compute the branch-graph layout for `commits`. `cap` bounds the lane count so
 *  a pathologically branchy history can't blow up the gutter width; lanes beyond
 *  the cap collapse into the last column. */
export function computeGraph(commits: GraphCommit[], cap = 8): GraphLayout {
  /** Pending parent hash per lane (null = free). Top-of-row state. */
  const lanes: (string | null)[] = [];
  /** Branch-stable color id per lane (null = free). A lane keeps its color id
   *  for its whole life and a reused lane gets a fresh one — so a branch keeps
   *  one color even when it shifts columns, the way VS Code colors the graph
   *  (instead of coloring by column index, where unrelated branches sharing a
   *  column would look like the same branch). */
  const laneColors: (number | null)[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 1;
  let nextColor = 0;

  const colorOf = (id: number | null) =>
    GRAPH_COLORS[(id ?? 0) % GRAPH_COLORS.length];

  /** First free lane (reused in place), else a new one, else the capped last. */
  const firstFree = (): number => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    if (lanes.length < cap) {
      lanes.push(null);
      laneColors.push(null);
      return lanes.length - 1;
    }
    return cap - 1;
  };

  for (const c of commits) {
    // Lanes waiting for this commit (its children, drawn above).
    const incoming: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) incoming.push(i);

    const nodeLane = incoming.length > 0 ? incoming[0] : firstFree();

    // Snapshot the top-of-row state before mutating (used to draw passing lanes
    // in their own colors).
    const topLanes = lanes.slice();
    const topColors = laneColors.slice();

    // The node's color: continue the incoming branch's color if a child was
    // waiting for it, otherwise a brand-new branch tip → a fresh color.
    let nodeColorId = laneColors[nodeLane];
    if (nodeColorId == null) nodeColorId = nextColor++;

    // The node consumes every lane that was waiting for it.
    for (const idx of incoming) {
      lanes[idx] = null;
      laneColors[idx] = null;
    }

    // First parent continues straight down in the node's lane, keeping the
    // node's color; a root commit (no parents) frees the lane.
    const parents = c.parents;
    if (parents.length > 0) {
      lanes[nodeLane] = parents[0];
      laneColors[nodeLane] = nodeColorId;
    } else {
      lanes[nodeLane] = null;
      laneColors[nodeLane] = null;
    }

    // Each extra parent (a merge) reuses a lane already waiting for it (keeping
    // that branch's color), or opens a new lane with a fresh color.
    const extraParents: { lane: number; colorId: number }[] = [];
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      let lane = lanes.findIndex((h) => h === ph);
      let colorId: number;
      if (lane === -1) {
        lane = firstFree();
        lanes[lane] = ph;
        colorId = nextColor++;
        laneColors[lane] = colorId;
      } else {
        colorId = laneColors[lane] ?? nextColor++;
        laneColors[lane] = colorId;
      }
      extraParents.push({ lane, colorId });
    }

    // --- Build the row's drawn segments (each in its branch's color). ---
    const segments: GraphSegment[] = [];
    // Top-half edges: each lane active above either arrives at the node (it was
    // waiting for this commit) or passes straight through.
    for (let i = 0; i < topLanes.length; i++) {
      if (topLanes[i] === null) continue;
      if (incoming.includes(i)) {
        segments.push({
          fromLane: i,
          toLane: nodeLane,
          color: colorOf(topColors[i]),
          kind: "in",
        });
      } else {
        segments.push({
          fromLane: i,
          toLane: i,
          color: colorOf(topColors[i]),
          kind: "through",
        });
      }
    }
    // Bottom-half edges leaving the node toward its parents.
    if (parents.length > 0) {
      segments.push({
        fromLane: nodeLane,
        toLane: nodeLane,
        color: colorOf(nodeColorId),
        kind: "out",
      });
    }
    for (const { lane, colorId } of extraParents) {
      segments.push({
        fromLane: nodeLane,
        toLane: lane,
        color: colorOf(colorId),
        kind: "out",
      });
    }

    const activeNow = lanes.reduce((m, h, i) => (h !== null ? i + 1 : m), 0);
    const laneCount = Math.min(cap, Math.max(topLanes.length, activeNow, nodeLane + 1));
    maxLanes = Math.max(maxLanes, laneCount);

    rows.push({
      nodeLane,
      nodeColor: colorOf(nodeColorId),
      segments,
      lanes: laneCount,
      isMerge: parents.length > 1,
    });
  }

  return { rows, maxLanes: Math.min(maxLanes, cap) };
}
