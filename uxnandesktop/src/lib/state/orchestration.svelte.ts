// Multi-agent orchestration (Svelte 5 runes) — spec `02d` §3.
//
// Layers live agent state (from `terminals` + `agentStatus`), backpressure
// timers and PTY delivery on top of the pure routing/queue logic in
// `$lib/orchestration`. Routes a message to agents by type (`@claude`), to all
// agents (fan-out), or to an explicit selection; holds each message in a
// per-agent FIFO and only delivers the next once that agent is free again
// (backpressure). Nothing here is persisted.

import { invoke } from "@tauri-apps/api/core";
import { terminals } from "./terminals.svelte";
import { agentStatus } from "./agentStatus.svelte";
import {
  agentType,
  drainAvailable,
  enqueueAll,
  pendingCount,
  resolveTargets,
  type OrchestratorAgent,
  type OrchestrationTarget,
  type Queues,
} from "$lib/orchestration";

/** How fast the backpressure loop re-checks for freed agents while work is
 *  queued. 800 ms is responsive enough for human-paced orchestration without a
 *  busy always-on timer. */
const PUMP_INTERVAL_MS = 800;

/** After delivering a message we wait for the agent to report busy (it picked
 *  the work up) before considering its next message. If it never reports busy
 *  (an agent with no hooks and no output) we release this grace window so the
 *  queue still drains — best-effort backpressure for unmonitored agents. */
const PICKUP_GRACE_MS = 4000;

/** Hard cap on how long a queued message is held back solely because its agent
 *  reads *busy*. Backpressure is a courtesy (don't flood a working agent), not a
 *  gate — an agent whose busy signal is unreliable or stuck (no hooks, perpetual
 *  output activity, a stale status reader) would otherwise wedge its queue
 *  forever. Past this, the head is force-delivered (best-effort). */
const MAX_HOLD_MS = 12000;

class OrchestrationStore {
  /** Per-agent message queues (backpressure), keyed by tab id. */
  queues = $state<Queues>({});
  /** Tab id → deadline (epoch ms) while a just-delivered message awaits pickup. */
  private pending: Record<string, number> = {};
  /** Tab id → epoch ms the current queue head began waiting (for the hold cap). */
  private headSince: Record<string, number> = {};
  private idSeq = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Live agents the orchestrator can address: every non-exited terminal tab
   *  running an agent, with its current routing type + busy state. Reactive. */
  get agents(): OrchestratorAgent[] {
    const out: OrchestratorAgent[] = [];
    for (const { tab, workspace } of terminals.tabsWithWorkspace()) {
      if (tab.kind !== "terminal" || !tab.agentName || tab.exited) continue;
      const live = agentStatus.get(tab.id);
      const precise = live?.status;
      const busy = precise ? precise === "working" || precise === "blocked" : !!tab.working;
      out.push({
        tabId: tab.id,
        workspace,
        name: tab.agentName,
        icon: tab.agentIcon ?? null,
        type: agentType(tab.agentCommand ?? tab.agentName),
        status: precise ?? "idle",
        busy,
      });
    }
    return out;
  }

  /** Total messages still held in backpressure across all agents (console badge). */
  get pendingTotal(): number {
    return pendingCount(this.queues);
  }

  /** Queue length for one agent (waiting, not counting the one in flight). */
  pendingFor(tabId: string): number {
    return this.queues[tabId]?.length ?? 0;
  }

  /** Route a message to a target (by type, all, or an explicit selection),
   *  enqueueing one copy per matched agent (fan-out). Returns how many agents it
   *  was queued for (0 = nothing matched). Delivery is gated by backpressure. */
  send(target: OrchestrationTarget, message: string): number {
    const text = message.trim();
    if (!text) return 0;
    const tabIds = resolveTargets(this.agents, target);
    if (tabIds.length === 0) return 0;
    this.queues = enqueueAll(this.queues, tabIds, text, () => ++this.idSeq);
    this.pump();
    this.ensureTimer();
    return tabIds.length;
  }

  /** Drop queued (not-yet-delivered) messages for one agent, or all agents. */
  clearQueue(tabId?: string): void {
    if (tabId) {
      const { [tabId]: _drop, ...rest } = this.queues;
      this.queues = rest;
      delete this.headSince[tabId];
    } else {
      this.queues = {};
      this.headSince = {};
    }
    if (this.pendingTotal === 0) this.stopTimer();
  }

  /** True when an agent has queued work not moving right now because it currently
   *  reads busy — so the UI can show a "waiting for the agent to be free" hint
   *  instead of a silent stall (the hold cap will force it through eventually). */
  waitingForFree(tabId: string): boolean {
    if ((this.queues[tabId]?.length ?? 0) === 0) return false;
    return !!this.agents.find((a) => a.tabId === tabId)?.busy;
  }

  /** Backpressure pump: deliver the head of every queue whose agent is free, then
   *  keep the timer alive only while work remains. */
  private pump(): void {
    const byId = new Map(this.agents.map((a) => [a.tabId, a]));
    const now = Date.now();

    // An agent that has gone busy since we delivered has clearly picked the work
    // up — drop its pickup grace so its next message waits for it to free again.
    for (const id of Object.keys(this.pending)) {
      const a = byId.get(id);
      if (!a || a.busy || now >= this.pending[id]) delete this.pending[id];
    }

    // Track how long each queue's head has been waiting, so a head held back only
    // by a busy signal can be force-delivered past the hold cap. Empty queues drop
    // their clock; a consumed head re-clocks on the next pump.
    for (const [id, q] of Object.entries(this.queues)) {
      if (q.length > 0) {
        if (this.headSince[id] === undefined) this.headSince[id] = now;
      } else {
        delete this.headSince[id];
      }
    }

    const available = (tabId: string): boolean => {
      const a = byId.get(tabId);
      if (!a) return false; // agent gone — nothing to deliver to
      const deadline = this.pending[tabId];
      if (deadline && now < deadline) return false; // just delivered, awaiting pickup
      if (!a.busy) return true; // free → deliver now
      // Busy: hold, but not forever — force it through once the head has waited
      // past the cap (the busy signal may be unreliable/stuck).
      const since = this.headSince[tabId];
      return since !== undefined && now - since >= MAX_HOLD_MS;
    };

    const { dispatch, queues } = drainAvailable(this.queues, available);
    if (dispatch.length === 0) {
      if (this.pendingTotal === 0) this.stopTimer();
      return;
    }
    this.queues = queues;
    for (const d of dispatch) {
      this.pending[d.tabId] = now + PICKUP_GRACE_MS;
      delete this.headSince[d.tabId]; // head consumed; the next one re-clocks
      this.deliver(d.tabId, d.queued.message);
    }
    if (this.pendingTotal === 0 && Object.keys(this.pending).length === 0) this.stopTimer();
  }

  /** Type a message into an agent's PTY as a paste and submit it (Enter). Routed
   *  through `pty_paste_submit` so the text lands as one block and the Enter
   *  arrives as a distinct event (see that command): no leftover text in the
   *  composer, no "message1+message2" concatenation, and multi-line messages
   *  aren't cut at the first newline. Best-effort: a dead PTY drops the write. */
  private deliver(tabId: string, message: string): void {
    void invoke("pty_paste_submit", { id: tabId, text: message }).catch(() => {});
  }

  private ensureTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.pump(), PUMP_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

/** Singleton orchestration store shared across the app. */
export const orchestration = new OrchestrationStore();
