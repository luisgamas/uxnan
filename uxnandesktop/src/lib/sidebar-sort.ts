// Pure ordering logic for the left-sidebar project cards and worktree rows.
//
// Kept free of Svelte/DOM (only `import type`s) so it is unit-testable in
// isolation: the store/components feed it plain metadata and then apply the
// resulting order. Two concerns live here:
//   1. Computed orders (name / recent / attention) — `sortItems`.
//   2. The user's persisted manual order — `applyManualOrder` (mirrors the
//      backend `reorder_by_ids` so it self-heals).

import type { SortMode } from "$lib/types";
import type { DisplayStatus } from "$lib/state/agentDisplay";

/** Attention class for the "attention" sort — lower is more urgent:
 *  1 needs-you · 2 done (unreviewed) · 3 working · 4 idle. */
export type AttentionClass = 1 | 2 | 3 | 4;

/** Whether a mode's order is static (never drifts over time): manual + the two
 *  name modes. The drifting modes (recent/attention) read live agent state, so
 *  the sidebar freezes their rendered order between settle windows. */
export function isStaticSortMode(mode: SortMode): boolean {
  return mode === "manual" || mode === "name-asc" || mode === "name-desc";
}

/** Metadata each sortable sidebar item exposes, decoupled from the concrete
 *  row/store types so the comparators stay pure. A project aggregates this from
 *  its worktrees; a worktree computes it from its own agents. */
export interface SortMeta {
  /** Display label for name sorting (project name or branch). */
  name: string;
  /** Epoch ms this workspace was last opened; 0 = never. Feeds "recent". */
  lastActive: number;
  /** Aggregate agent status for the item, or null when it has no agent. */
  status: DisplayStatus | null;
  /** An unreviewed agent result is waiting (the red "unread" dot). */
  unread: boolean;
  /** Epoch ms of the freshest agent signal, for the "attention"/"recent"
   *  tie-break; 0 when unknown. */
  activityAt: number;
}

/** Urgency rank for aggregating several agents in one workspace — lower wins.
 *  blocked/waiting (needs you) beat done, which beats working, which beats idle. */
const URGENCY: Record<DisplayStatus, number> = {
  blocked: 0,
  waiting: 0,
  done: 1,
  working: 2,
  idle: 3,
};

/** Pick the most-urgent status among a workspace's agents (blocked/waiting >
 *  done > working > idle), or null when there are no agents. Drives both the
 *  "attention" sort and the aggregate status the store hands the comparators. */
export function mostUrgentStatus(
  statuses: readonly (DisplayStatus | null)[],
): DisplayStatus | null {
  let best: DisplayStatus | null = null;
  let bestRank = Infinity;
  for (const s of statuses) {
    if (!s) continue;
    const rank = URGENCY[s];
    if (rank < bestRank) {
      bestRank = rank;
      best = s;
    }
  }
  return best;
}

/** Map an item's aggregate agent status (+ unread flag) to an attention class. */
export function attentionClass(
  status: DisplayStatus | null,
  unread: boolean,
): AttentionClass {
  switch (status) {
    case "blocked":
    case "waiting":
      return 1; // needs you: an agent is asking for input/permission
    case "working":
      return 3;
    case "done":
      // A finished agent you haven't looked at yet still wants attention; once
      // acknowledged (the unread dot cleared) it settles to idle.
      return unread ? 2 : 4;
    default:
      // No live agent (idle / null): an unreviewed result still bubbles up.
      return unread ? 2 : 4;
  }
}

/** Locale-aware, case-insensitive, natural (numeric) name comparison. */
function cmpName(a: SortMeta, b: SortMeta): number {
  return a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/** Most-recently-opened first; never-opened (0) sink to the bottom, then name. */
function cmpRecent(a: SortMeta, b: SortMeta): number {
  if (a.lastActive !== b.lastActive) return b.lastActive - a.lastActive;
  return cmpName(a, b);
}

/** By attention class (urgent first), then freshest signal, recency, name. */
function cmpAttention(a: SortMeta, b: SortMeta): number {
  const ca = attentionClass(a.status, a.unread);
  const cb = attentionClass(b.status, b.unread);
  if (ca !== cb) return ca - cb;
  if (a.activityAt !== b.activityAt) return b.activityAt - a.activityAt;
  if (a.lastActive !== b.lastActive) return b.lastActive - a.lastActive;
  return cmpName(a, b);
}

/** Comparator for a computed sort mode. "manual" is intentionally a no-op (0):
 *  that order comes from persisted state, not a comparison, so callers can pass
 *  it through harmlessly. */
export function compareBy(mode: SortMode, a: SortMeta, b: SortMeta): number {
  switch (mode) {
    case "name-asc":
      return cmpName(a, b);
    case "name-desc":
      return -cmpName(a, b);
    case "recent":
      return cmpRecent(a, b);
    case "attention":
      return cmpAttention(a, b);
    case "manual":
    default:
      return 0;
  }
}

/** Stably sort `items` by `mode`, reading each item's metadata via `metaOf`.
 *  For "manual" the original order is returned unchanged (a stable no-op), so the
 *  caller keeps whatever externally-persisted order it already applied. The
 *  decorate–sort–undecorate keeps the sort stable and reads each item's metadata
 *  once (important when `metaOf` touches reactive stores). */
export function sortItems<T>(
  items: readonly T[],
  mode: SortMode,
  metaOf: (item: T) => SortMeta,
): T[] {
  if (mode === "manual") return [...items];
  return items
    .map((item, index) => ({ item, index, meta: metaOf(item) }))
    .sort((a, b) => compareBy(mode, a.meta, b.meta) || a.index - b.index)
    .map((d) => d.item);
}

/** A lane of the "group by status" sidebar view: an attention class and its
 *  items, already sorted within the lane by the attention comparator. */
export interface StatusLane<T> {
  attention: AttentionClass;
  items: T[];
}

/** Lane order for the status view — most urgent first (needs-you · done · working
 *  · idle). */
const LANE_ORDER: readonly AttentionClass[] = [1, 2, 3, 4];

/** Group `items` into attention lanes for the "group by status" view. Empty lanes
 *  are omitted; each lane's items are ordered by the attention comparator (freshest
 *  signal, then recency, then name). Pure, so it's unit-testable. */
export function buildStatusGroups<T>(
  items: readonly T[],
  metaOf: (item: T) => SortMeta,
): StatusLane<T>[] {
  const lanes: StatusLane<T>[] = [];
  for (const attention of LANE_ORDER) {
    const inLane = items.filter(
      (it) => attentionClass(metaOf(it).status, metaOf(it).unread) === attention,
    );
    if (inLane.length === 0) continue;
    lanes.push({ attention, items: sortItems(inLane, "attention", metaOf) });
  }
  return lanes;
}

/** Partition `items` so pinned ones lead, each group keeping its incoming order.
 *  Applied *after* a sort, so pinned rows float to the top while staying sorted
 *  among themselves the same way as the rest. */
export function partitionPinned<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isPinned(item) ? pinned : rest).push(item);
  return [...pinned, ...rest];
}

/** Compute the new key order after a pointer-drag drops `key` at insertion index
 *  `toIndex` (an index into the *original* `keys`, i.e. the slot the drop marker
 *  sat at). Removing the dragged key first shifts later insertion points left by
 *  one, which this accounts for. A no-op if `key` isn't present. */
export function reorderByDrag(
  keys: readonly string[],
  key: string,
  toIndex: number,
): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  const without = keys.filter((k) => k !== key);
  const insertAt = toIndex > from ? toIndex - 1 : toIndex;
  without.splice(insertAt, 0, key);
  return without;
}

/** Apply a persisted manual order (`order`, keys front-to-back) to `items`.
 *  Items whose key is absent from `order` keep their position *after* the listed
 *  ones, in their original relative order; unknown keys in `order` are ignored.
 *  Mirrors the backend `reorder_by_ids` so the manual order self-heals (removed
 *  keys drop out, newly-seen ones fall to the end). */
export function applyManualOrder<T>(
  items: readonly T[],
  order: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const rank = new Map<string, number>();
  order.forEach((key, i) => rank.set(key, i));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = rank.get(keyOf(a.item)) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(keyOf(b.item)) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.index - b.index;
    })
    .map((d) => d.item);
}
