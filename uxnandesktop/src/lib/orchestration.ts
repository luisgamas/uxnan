// Pure orchestration logic — routing + backpressure, with no Svelte/Tauri deps
// so it can be unit-tested in isolation. The reactive store in
// `state/orchestration.svelte.ts` layers live agent state, timers and PTY I/O on
// top of these functions. Spec: `architecture/02d-agent-monitoring.md` §3.

import type { AgentStatus } from "$lib/types";

/** A live agent the orchestrator can route to: one terminal tab running an agent. */
export interface OrchestratorAgent {
  /** Terminal/PTY id (also the `UXNAN_AGENT_ID`). */
  tabId: string;
  /** Workspace (worktree path, or "" for Global) the tab lives in. */
  workspace: string;
  /** Display name (the configured agent name, e.g. "Claude Code"). */
  name: string;
  /** Logo key for the UI (catalog id or inline data URL); `null` → generic. */
  icon?: string | null;
  /** Routing type key, normalized from the agent's command (e.g. `claude`). */
  type: string;
  /** Precise hook status if known, else `"idle"` when only coarse activity. */
  status: AgentStatus | "idle";
  /** Whether the agent is busy and so must not receive the next message yet
   *  (precise `working`/`blocked`, or coarse output activity). */
  busy: boolean;
}

/** Where a message is routed. `type` fans out to every agent of one kind;
 *  `all` fans out to every live agent; `tabs` targets an explicit selection. */
export type OrchestrationTarget =
  | { kind: "all" }
  | { kind: "type"; type: string }
  | { kind: "tabs"; tabIds: string[] };

/** Normalize an agent command to its routing type key (`claude`, `codex`, …). */
export function agentType(command: string | undefined | null): string {
  return (command ?? "").trim().toLowerCase();
}

/** The distinct agent types present, in first-seen order (for the type picker). */
export function agentTypes(agents: readonly OrchestratorAgent[]): string[] {
  const seen: string[] = [];
  for (const a of agents) if (a.type && !seen.includes(a.type)) seen.push(a.type);
  return seen;
}

/** Resolve a target to the set of agent tab ids it addresses (deduped, order
 *  preserved). An empty result means nothing matched (e.g. that type went away). */
export function resolveTargets(
  agents: readonly OrchestratorAgent[],
  target: OrchestrationTarget,
): string[] {
  const live = new Set(agents.map((a) => a.tabId));
  switch (target.kind) {
    case "all":
      return agents.map((a) => a.tabId);
    case "type":
      return agents.filter((a) => a.type === target.type).map((a) => a.tabId);
    case "tabs": {
      const out: string[] = [];
      for (const id of target.tabIds) if (live.has(id) && !out.includes(id)) out.push(id);
      return out;
    }
  }
}

/** A queued message routed to one agent but not yet delivered (held by
 *  backpressure until the agent is free). */
export interface QueuedMessage {
  /** Monotonic id so the UI can key rows and the store can de-dupe dispatch. */
  id: number;
  message: string;
}

/** Per-agent FIFO queues, keyed by tab id. */
export type Queues = Record<string, QueuedMessage[]>;

/** One message ready to deliver right now. */
export interface Dispatch {
  tabId: string;
  queued: QueuedMessage;
}

/** Backpressure core (pure): pick the head of every agent's queue that is
 *  available right now, and return the queues with those heads removed. Only the
 *  single head per agent is dispatched — the next waits until the agent reports
 *  free again, exactly as the spec requires (no flooding a slow worker).
 *
 *  `available(tabId)` must fold in both the agent's busy state *and* whether a
 *  previously dispatched message is still being picked up (the store tracks the
 *  latter), so a just-sent agent isn't double-fed before it flips to busy. */
export function drainAvailable(
  queues: Queues,
  available: (tabId: string) => boolean,
): { dispatch: Dispatch[]; queues: Queues } {
  const dispatch: Dispatch[] = [];
  const next: Queues = {};
  for (const [tabId, q] of Object.entries(queues)) {
    if (q.length > 0 && available(tabId)) {
      dispatch.push({ tabId, queued: q[0] });
      next[tabId] = q.slice(1);
    } else {
      next[tabId] = q.slice();
    }
  }
  return { dispatch, queues: next };
}

/** Append a message to several agents' queues (fan-out), returning new queues.
 *  `nextId()` supplies each enqueued message's monotonic id. */
export function enqueueAll(
  queues: Queues,
  tabIds: readonly string[],
  message: string,
  nextId: () => number,
): Queues {
  const next: Queues = { ...queues };
  for (const tabId of tabIds) {
    next[tabId] = [...(next[tabId] ?? []), { id: nextId(), message }];
  }
  return next;
}

/** Total still-queued messages across all agents (for the console badge). */
export function pendingCount(queues: Queues): number {
  let n = 0;
  for (const q of Object.values(queues)) n += q.length;
  return n;
}
