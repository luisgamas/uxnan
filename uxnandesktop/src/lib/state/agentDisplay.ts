// Unified agent display state — merges the three monitoring layers into the one
// state the sidebar/tab indicators should show, with a clear priority:
//
//   1. Hook server (Layer 1, precise)        — agentStatus store
//   2. Terminal-title inference (Layer 2)     — agentMonitor.titleStatus
//   3. Output-activity inference (Layer 3-ish) — tab.working / tab.agentName
//
// The hook is authoritative when present; the title fills the gap for agents
// that don't report; activity is the universal last resort. Returns null when
// there's nothing to show (a plain terminal with no agent and no activity).

import { terminals, type GroupTab } from "./terminals.svelte";
import { agentStatus } from "./agentStatus.svelte";
import { agentMonitor } from "./agentMonitor.svelte";
import type { AgentStatus } from "$lib/types";

/** Display state: the four reported states plus "idle" (an agent at rest with no
 *  precise report). */
export type DisplayStatus = AgentStatus | "idle";

export interface AgentDisplay {
  status: DisplayStatus;
  /** Which layer produced it (for tooltips / debugging). */
  source: "hook" | "title" | "activity";
  /** The hook report is older than the staleness threshold (shown dimmed). */
  stale: boolean;
}

/** Resolve the effective display state for a terminal tab, or null when there's
 *  nothing to indicate. Reactive: reads the monitoring stores, so callers in a
 *  `$derived`/template re-run when any layer changes. */
export function resolveAgentDisplay(tab: GroupTab): AgentDisplay | null {
  // Only terminal tabs carry agent activity; file/diff tabs show nothing.
  if (tab.kind !== "terminal") return null;
  if (tab.exited) {
    // A finished agent terminal reads as "done"; a plain one shows nothing.
    return tab.agentName ? { status: "done", source: "activity", stale: false } : null;
  }
  // 1. Precise hook state.
  const hook = agentStatus.get(tab.id);
  if (hook) {
    return { status: hook.status, source: "hook", stale: agentStatus.isStale(tab.id) };
  }
  // 2. Terminal-title inference.
  const title = agentMonitor.titleStatus(tab.id);
  if (title) return { status: title, source: "title", stale: false };
  // 3. Output-activity inference.
  if (tab.working) return { status: "working", source: "activity", stale: false };
  if (tab.agentName) return { status: "idle", source: "activity", stale: false };
  return null;
}

/** Whether any open terminal currently resolves to a "working" agent — drives
 *  the opt-in keep-awake. Reactive: reads the monitoring stores. */
export function anyAgentWorking(): boolean {
  for (const { tab } of terminals.tabsWithWorkspace()) {
    if (resolveAgentDisplay(tab)?.status === "working") return true;
  }
  return false;
}
