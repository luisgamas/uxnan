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
  const rows: GraphRow[] = [];
  let maxLanes = 1;

  const color = (lane: number) => GRAPH_COLORS[lane % GRAPH_COLORS.length];

  /** First free lane (reused in place), else a new one, else the capped last. */
  const firstFree = (): number => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    if (lanes.length < cap) {
      lanes.push(null);
      return lanes.length - 1;
    }
    return cap - 1;
  };

  for (const c of commits) {
    // Lanes waiting for this commit (its children, drawn above).
    const incoming: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) incoming.push(i);

    const nodeLane = incoming.length > 0 ? incoming[0] : firstFree();

    // Snapshot the top-of-row state before mutating (used to draw passing lanes).
    const topLanes = lanes.slice();

    // The node consumes every lane that was waiting for it.
    for (const idx of incoming) lanes[idx] = null;

    // First parent continues straight down in the node's lane; no parent (a root
    // commit) frees the lane.
    const parents = c.parents;
    lanes[nodeLane] = parents.length > 0 ? parents[0] : null;

    // Each extra parent (a merge) reuses a lane already waiting for it, or opens
    // a new one.
    const extraParentLanes: number[] = [];
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      let lane = lanes.findIndex((h) => h === ph);
      if (lane === -1) {
        lane = firstFree();
        lanes[lane] = ph;
      }
      extraParentLanes.push(lane);
    }

    // --- Build the row's drawn segments. ---
    const segments: GraphSegment[] = [];
    // Top-half edges: each lane active above either arrives at the node (it was
    // waiting for this commit) or passes straight through.
    for (let i = 0; i < topLanes.length; i++) {
      if (topLanes[i] === null) continue;
      if (incoming.includes(i)) {
        segments.push({ fromLane: i, toLane: nodeLane, color: color(i), kind: "in" });
      } else {
        segments.push({ fromLane: i, toLane: i, color: color(i), kind: "through" });
      }
    }
    // Bottom-half edges leaving the node toward its parents.
    if (parents.length > 0) {
      segments.push({ fromLane: nodeLane, toLane: nodeLane, color: color(nodeLane), kind: "out" });
    }
    for (const lane of extraParentLanes) {
      segments.push({ fromLane: nodeLane, toLane: lane, color: color(lane), kind: "out" });
    }

    const activeNow = lanes.reduce((m, h, i) => (h !== null ? i + 1 : m), 0);
    const laneCount = Math.min(cap, Math.max(topLanes.length, activeNow, nodeLane + 1));
    maxLanes = Math.max(maxLanes, laneCount);

    rows.push({
      nodeLane,
      nodeColor: color(nodeLane),
      segments,
      lanes: laneCount,
      isMerge: parents.length > 1,
    });
  }

  return { rows, maxLanes: Math.min(maxLanes, cap) };
}
