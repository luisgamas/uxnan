// Precise agent state from the local hook server (Phase 4, Layer 1).
//
// Unlike the coarse output-activity inference in `agentMonitor` (working/idle),
// this holds the exact state an agent's hook reported — working / blocked /
// waiting / done — keyed by agent id (the `UXNAN_AGENT_ID` we injected, which is
// the PTY/tab id, so it maps straight onto a terminal tab). The sidebar/tab
// indicators prefer this precise state when present and fall back to inference.
//
// Hydrated once from the persisted cache, then kept live via the
// `agent:status-changed` Tauri event. A report older than 30 min is "stale".

import { listen } from "@tauri-apps/api/event";
import { agentStates } from "$lib/api";
import type { AgentStatus, AgentStatusEvent } from "$lib/types";

/** A report grows stale (shown dimmed) after this long with no update (spec §1.5). */
const STALE_MS = 30 * 60 * 1000;

/** The live state the hook reported for one agent (timestamps in epoch ms). */
export interface LiveAgentState {
  status: AgentStatus;
  agentType?: string | null;
  prompt?: string | null;
  tool?: string | null;
  interrupted: boolean;
  /** Last hook update (epoch ms; the backend reports seconds, scaled here). */
  lastUpdate: number;
}

function toLive(e: AgentStatusEvent): LiveAgentState {
  return {
    status: e.status,
    agentType: e.agentType,
    prompt: e.prompt,
    tool: e.tool,
    interrupted: e.interrupted,
    lastUpdate: e.lastUpdate * 1000,
  };
}

class AgentStatusStore {
  /** Reported state per agent id (= PTY/tab id). */
  byId = $state<Record<string, LiveAgentState>>({});
  private started = false;

  /** Hydrate from the persisted cache, then subscribe to live updates (once). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const cached = await agentStates();
      const map: Record<string, LiveAgentState> = {};
      for (const e of cached) map[e.agentId] = toLive(e);
      this.byId = map;
    } catch {
      // No backend (web preview) — leave empty.
    }
    try {
      await listen<AgentStatusEvent>("agent:status-changed", (e) => {
        this.byId = { ...this.byId, [e.payload.agentId]: toLive(e.payload) };
      });
    } catch {
      this.started = false; // no Tauri event bus
    }
  }

  /** Precise state for a tab id, if the hook reported one. */
  get(id: string): LiveAgentState | undefined {
    return this.byId[id];
  }

  /** Whether a tab's reported state is stale (>30 min without an update). */
  isStale(id: string): boolean {
    const s = this.byId[id];
    return !!s && Date.now() - s.lastUpdate > STALE_MS;
  }
}

/** Singleton precise-agent-state store shared across the app. */
export const agentStatus = new AgentStatusStore();
