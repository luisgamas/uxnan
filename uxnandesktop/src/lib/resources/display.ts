// Presentation logic for the resource-observability surfaces: which state a
// group renders in, how a workspace path becomes a short label, and the i18n
// keys explaining each attribution confidence. Pure (node test project) so the
// spike/ended/unknown rules are provable without mounting a component.

import type {
  AttributionConfidence,
  ResourceGroupSummary,
  ResourceSummary,
} from "$lib/types";

/** Visual state of one group row. Ordered by urgency for tie-breaks. */
export type ResourceGroupState = "unknown" | "spike" | "ended" | "ok";

/** A CPU reading this many × the short average (and at least `SPIKE_FLOOR`)
 *  renders as a spike. The floor keeps a 0.2% → 0.6% wiggle from shouting. */
export const SPIKE_FACTOR = 2.5;
export const SPIKE_FLOOR_PERCENT = 5;

/** Which state a group row renders in. `unknown` (identity lost) outranks a
 *  spike — a number we can't attribute shouldn't be dressed as a live alarm —
 *  and `ended` freezes the row regardless of its last figures. */
export function groupState(group: ResourceGroupSummary): ResourceGroupState {
  if (group.confidence === "unknown") return "unknown";
  if (group.ended) return "ended";
  if (
    group.cpuPercent !== null &&
    group.cpuAvgPercent !== null &&
    group.cpuPercent >= SPIKE_FLOOR_PERCENT &&
    group.cpuPercent >= SPIKE_FACTOR * group.cpuAvgPercent
  ) {
    return "spike";
  }
  return "ok";
}

/** Overall surface state, driving the popover section's body. */
export type ResourceSurfaceState = "loading" | "unsupported" | "empty" | "ready";

/** What the summary surface should render. `unsupported` = the platform gives
 *  us no CPU *and* no memory (nothing worth a table); partial support renders
 *  `ready` with per-metric dashes instead. */
export function surfaceState(
  summary: ResourceSummary | null,
  loading: boolean,
): ResourceSurfaceState {
  if (summary === null) return loading ? "loading" : "empty";
  if (!summary.capabilities.cpu && !summary.capabilities.memory) return "unsupported";
  if (summary.updatedAtMs === undefined) return loading ? "loading" : "empty";
  return "ready";
}

/** i18n key explaining one attribution confidence (tooltip text). */
export function confidenceKey(
  confidence: AttributionConfidence,
): "resources.confidenceExact" | "resources.confidenceInferred" | "resources.confidenceUnknown" {
  switch (confidence) {
    case "exact":
      return "resources.confidenceExact";
    case "inferred":
      return "resources.confidenceInferred";
    default:
      return "resources.confidenceUnknown";
  }
}

/** Short display label for a group: the workspace folder name, the agent
 *  command, or a terminal id trimmed to its tail. Display-only — the full id
 *  stays available for tooltips. */
export function groupLabel(group: ResourceGroupSummary): string {
  const id = group.id ?? "";
  if (group.kind === "workspace") {
    const segments = id.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] ?? id;
  }
  if (group.kind === "terminal") {
    return id.length > 12 ? `…${id.slice(-8)}` : id;
  }
  return id;
}

/** Groups in display order with the desktop row first. The backend already
 *  sorts (kind rank, id, ended last); this is a stable safety net so the UI
 *  never depends on wire order. */
export function orderedGroups(summary: ResourceSummary): ResourceGroupSummary[] {
  const rank = (g: ResourceGroupSummary): number =>
    g.ended
      ? 100
      : { desktop: 0, workspace: 1, terminal: 2, agent: 3, bridge: 4, browser: 5, unknown: 6 }[
          g.kind
        ];
  return [...summary.groups].sort(
    (a, b) => rank(a) - rank(b) || (a.id ?? "").localeCompare(b.id ?? ""),
  );
}
