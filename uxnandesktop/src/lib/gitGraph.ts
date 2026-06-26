// Branch-graph layout for the History tab — the VS Code swimlane model.
//
// Turns an ordered commit list (newest first, topological — children before
// parents) into per-row lane assignments + drawable edges so the panel can draw
// the flowing, colored branch graph (the smooth arcs VS Code uses) in an SVG
// gutter.
//
// Algorithm (swimlane, compacting): each row carries a list of "swimlanes" — one
// per active branch line, each holding the hash it's waiting to reach (its
// pending parent) and a branch-stable color. A row's `inputs` is the previous
// row's `outputs`, so lines connect seamlessly between rows. For each commit:
//   - The leftmost input lane waiting for it is the commit's node lane; the
//     first parent continues straight down in that lane keeping its color.
//   - Every OTHER input lane waiting for it (extra children, on merges) collapses
//     into the node — it is dropped from the outputs, so lanes to its right shift
//     left one column (this compaction is what makes the graph narrow with
//     flowing curves instead of leaving parallel gaps).
//   - Each additional parent (a merge) opens a new lane at the right with a fresh
//     color.
//   - A commit with no waiting lane is a branch tip: it takes a new lane at the
//     right.
// Lane index → color is carried per lane (assigned at birth), so a branch keeps
// one color down the graph even as it shifts columns — matching VS Code.

/** One drawn edge within a row. Lanes are column indices; the renderer maps them
 *  to x positions and the row height. Shapes by `kind`:
 *  - `through`: a lane passing the row — straight vertical if `fromLane` ===
 *    `toLane`, else a gentle S-curve shifting left (compaction).
 *  - `mergeIn`: a converging child lane arcing down into the node at mid-row.
 *  - `inNode` / `outNode`: the node's own lane, top half (into the dot) / bottom
 *    half (out toward the first parent) — plain verticals.
 *  - `mergeOut`: the node arcing out to an extra (merge) parent's lane. */
export interface GraphEdge {
  kind: "through" | "mergeIn" | "inNode" | "outNode" | "mergeOut";
  fromLane: number;
  toLane: number;
  color: string;
}

/** Layout for one commit row. */
export interface GraphRow {
  /** Lane the commit's node sits in. */
  nodeLane: number;
  nodeColor: string;
  edges: GraphEdge[];
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

/** A live swimlane: the hash it's waiting to reach + its branch-stable color id. */
interface Lane {
  id: string;
  color: number;
}

/** Compute the branch-graph layout for `commits`. `cap` bounds the lane count so
 *  a pathologically branchy history can't blow up the gutter width; the layout
 *  itself is uncapped (lanes compact naturally), `cap` only clamps the reported
 *  gutter width. */
export function computeGraph(commits: GraphCommit[], cap = 10): GraphLayout {
  const rows: GraphRow[] = [];
  let inputs: Lane[] = [];
  let maxLanes = 1;
  let nextColor = 0;

  const colorOf = (id: number) => GRAPH_COLORS[id % GRAPH_COLORS.length];

  for (const c of commits) {
    const inputIndex = inputs.findIndex((l) => l.id === c.hash);
    // The node sits in the leftmost lane waiting for it, or a new lane at the
    // right when this commit is a branch tip.
    const nodeLane = inputIndex !== -1 ? inputIndex : inputs.length;
    const nodeColorId = inputIndex !== -1 ? inputs[inputIndex].color : nextColor++;

    const outputs: Lane[] = [];
    const edges: GraphEdge[] = [];
    let firstParentAdded = false;

    // Walk the input lanes: each either is this commit (node lane → continue with
    // the first parent; extra matches collapse in) or passes through (kept,
    // shifting left if earlier lanes collapsed).
    for (let i = 0; i < inputs.length; i++) {
      const lane = inputs[i];
      if (lane.id === c.hash) {
        if (i === nodeLane) {
          if (c.parents.length > 0 && !firstParentAdded) {
            outputs.push({ id: c.parents[0], color: nodeColorId });
            firstParentAdded = true;
          }
          // The node's own lane is drawn as inNode/outNode verticals below.
        } else {
          // A converging child lane: arcs into the node, then ends (not kept) —
          // so lanes to its right compact left.
          edges.push({
            kind: "mergeIn",
            fromLane: i,
            toLane: nodeLane,
            color: colorOf(lane.color),
          });
        }
        continue;
      }
      const outLane = outputs.length;
      outputs.push({ id: lane.id, color: lane.color });
      edges.push({
        kind: "through",
        fromLane: i,
        toLane: outLane,
        color: colorOf(lane.color),
      });
    }

    // Tip commit (no incoming lane): the first parent still continues the
    // node's lane — append it so it lands at nodeLane (= outputs.length here)
    // and is drawn as the straight out-of-node vertical, never a curve.
    if (!firstParentAdded && c.parents.length > 0) {
      outputs.push({ id: c.parents[0], color: nodeColorId });
      firstParentAdded = true;
    }

    // Extra (merge) parents — only parents[1..] — open new lanes at the right.
    for (let p = 1; p < c.parents.length; p++) {
      const colorId = nextColor++;
      const k = outputs.length;
      outputs.push({ id: c.parents[p], color: colorId });
      edges.push({
        kind: "mergeOut",
        fromLane: nodeLane,
        toLane: k,
        color: colorOf(colorId),
      });
    }

    // The node's own lane: a vertical into the dot from above (if a child was
    // waiting) and out of the dot toward the first parent (if it has parents).
    if (inputIndex !== -1) {
      edges.push({
        kind: "inNode",
        fromLane: nodeLane,
        toLane: nodeLane,
        color: colorOf(nodeColorId),
      });
    }
    if (firstParentAdded) {
      edges.push({
        kind: "outNode",
        fromLane: nodeLane,
        toLane: nodeLane,
        color: colorOf(nodeColorId),
      });
    }

    const laneCount = Math.max(inputs.length, outputs.length, nodeLane + 1);
    maxLanes = Math.max(maxLanes, laneCount);

    rows.push({
      nodeLane,
      nodeColor: colorOf(nodeColorId),
      edges,
      lanes: laneCount,
      isMerge: c.parents.length > 1,
    });
    inputs = outputs;
  }

  return { rows, maxLanes: Math.min(maxLanes, cap) };
}
