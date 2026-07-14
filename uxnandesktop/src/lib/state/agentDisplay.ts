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
import { zeroSessions, isZeroAgent } from "./zeroSessions.svelte";
import type { AgentStatus, SubagentEntry } from "$lib/types";

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
    const stale = agentStatus.isStale(tab.id);
    // Done-gate: while a spawned child is still working, the parent isn't done —
    // keep it "working" so it doesn't flash a premature ✓ (a background subagent
    // can outlive the parent's own Stop).
    let status = hook.status;
    if (status === "done" && hook.subagents.some((s) => s.status === "working")) {
      status = "working";
    }
    // Safety net: an attention state (waiting/blocked) that went quiet past the
    // staleness window and never got a terminal event shouldn't dominate the
    // "needs you" lane forever — present it as a neutral idle (still dimmed).
    // `done`/`working` keep their meaning. The common Claude "stuck on waiting"
    // case is fixed at the source in the backend event mapping; this backstops
    // any agent (or future one) that gets stuck without a closing event.
    if (stale && (status === "waiting" || status === "blocked")) {
      return { status: "idle", source: "hook", stale: true };
    }
    return { status, source: "hook", stale };
  }
  // 2. Terminal-title inference.
  const title = agentMonitor.titleStatus(tab.id);
  if (title) return { status: title, source: "title", stale: false };
  // 3. Output-activity inference.
  if (tab.working) return { status: "working", source: "activity", stale: false };
  if (tab.agentName) return { status: "idle", source: "activity", stale: false };
  return null;
}

/** The richer per-agent state the left-panel **agent view** renders: the effective
 *  status plus the conversation title + a preview line. Built on top of
 *  [`resolveAgentDisplay`]. */
export interface AgentView {
  status: DisplayStatus;
  stale: boolean;
  /** Conversation title — the user's latest prompt (hook) or Zero's session title;
   *  falls back to the agent's product name when unknown. */
  title: string;
  /** Raw secondary text (current tool while working, else the latest reply preview),
   *  or null when there's none — the row then shows the status label. */
  preview: string | null;
  /** The current turn was interrupted by the user (render a distinct preview). */
  interrupted: boolean;
  /** Epoch ms of the last hook update, for a relative timestamp (null if unknown). */
  lastUpdate: number | null;
  /** Sub-agents (children) this session spawned — rendered as nested rows. */
  subagents: SubagentEntry[];
}

/** Resolve the agent-view state for a terminal tab in `workspacePath` (its worktree
 *  cwd). Surfaces the conversation title/preview that already flow through the hook
 *  store (`prompt`/`tool`/`summary`), and reads Zero's on-disk session for agents
 *  that report no hook. Reactive: reads the monitoring stores. */
export function resolveAgentView(tab: GroupTab, workspacePath: string): AgentView | null {
  if (tab.kind !== "terminal") return null;
  const base = resolveAgentDisplay(tab);
  const hook = agentStatus.get(tab.id);
  const zero = isZeroAgent(tab) ? zeroSessions.get(workspacePath) : null;
  const name = tab.agentName ?? tab.title ?? "";

  let status: DisplayStatus = base?.status ?? "idle";
  let title = "";
  let preview: string | null = null;
  let interrupted = false;
  let lastUpdate: number | null = null;

  if (hook) {
    // Hook agents (Claude/Codex/OpenCode/Pi): the conversation title is the user's
    // latest prompt; the preview is the current tool while working, else the reply.
    title = (hook.prompt ?? "").trim();
    interrupted = hook.interrupted;
    lastUpdate = hook.lastUpdate;
    preview =
      hook.status === "working"
        ? (hook.tool ?? "").trim() || null
        : (hook.summary ?? "").trim() || null;
  } else if (zero) {
    // Zero has no hook — its title + status come from the on-disk session.
    status = zero.status;
    title = zero.title.trim();
  }

  if (!title) title = name;
  return {
    status,
    stale: base?.stale ?? false,
    title,
    preview,
    interrupted,
    lastUpdate,
    subagents: hook?.subagents ?? [],
  };
}

/** Whether any open terminal currently resolves to a "working" agent — drives
 *  the opt-in keep-awake. Reactive: reads the monitoring stores. */
export function anyAgentWorking(): boolean {
  for (const { tab } of terminals.tabsWithWorkspace()) {
    if (resolveAgentDisplay(tab)?.status === "working") return true;
  }
  return false;
}
