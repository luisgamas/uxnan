// Agent activity monitoring (Phase 4 — activity inference).
//
// We don't ask agents to report state; we infer it from terminal output. A tab
// producing output is "working"; once it goes quiet the "working" dot turns off.
// This drives only the *visual* indicator — it's universal (any CLI, no setup)
// but coarse, so it deliberately never raises notifications: those come from the
// precise hook layer (`agentStatus`), which can tell a finished task from an
// agent simply left sitting at its prompt.
//
// State lives on the terminal tabs (`tab.working`, set here); `lastOutputAt` is
// kept here, non-reactive, and self-pruned so closed tabs don't leak.

import { listen } from "@tauri-apps/api/event";
import { terminals } from "./terminals.svelte";
import { app } from "./app.svelte";
import { statusFromTitle } from "$lib/agentTitle";
import type { AgentStatus } from "$lib/types";

/** Payload of the backend `agent:detected` event. */
interface AgentDetected {
  ptyId: string;
  command: string | null;
}

/** Idle after this long with no output → the "working" dot turns off. */
const VISUAL_IDLE_MS = 3_000;

class AgentMonitor {
  /** When each tab last produced output (epoch ms). */
  private lastOutputAt = new Map<string, number>();
  /** State inferred from each tab's terminal title (OSC), Layer 2. Reactive so
   *  the sidebar/tab indicators update when a title changes. */
  private titleState = $state<Record<string, AgentStatus>>({});
  private timer: ReturnType<typeof setInterval> | undefined;
  private detecting = false;

  private start(): void {
    if (this.timer || typeof setInterval === "undefined") return;
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  /** Subscribe to the backend's `agent:detected` events (once): tag a tab with
   *  the agent currently running in it (or clear it when none) so its sidebar
   *  row + tab name follow whatever agent the user starts/stops there. */
  async startDetection(): Promise<void> {
    if (this.detecting) return;
    this.detecting = true;
    try {
      await listen<AgentDetected>("agent:detected", (e) => {
        const tab = terminals.findTab(e.payload.ptyId);
        if (!tab || tab.kind !== "terminal") return;
        if (e.payload.command) {
          const a = app.resolveAgent(e.payload.command);
          tab.agentName = a.name;
          tab.agentIcon = a.icon;
        } else {
          tab.agentName = undefined;
          tab.agentIcon = undefined;
        }
      });
    } catch {
      this.detecting = false; // no Tauri event bus (web preview)
    }
  }

  /** Record the agent state inferred from a tab's terminal title (Layer 2). A
   *  title that maps to a state is stored; an unrecognized one is ignored (the
   *  previous inference stands). Read via [`titleStatus`]. */
  noteTitle(tabId: string, title: string): void {
    const status = statusFromTitle(title);
    if (status && this.titleState[tabId] !== status) {
      this.titleState = { ...this.titleState, [tabId]: status };
    }
  }

  /** The state last inferred from a tab's terminal title, if any. */
  titleStatus(tabId: string): AgentStatus | undefined {
    return this.titleState[tabId];
  }

  /** Record output on a tab: it's "working" now. Cheap (reactive only on edge). */
  noteOutput(tabId: string): void {
    this.lastOutputAt.set(tabId, Date.now());
    const tab = terminals.findTab(tabId);
    if (tab && tab.kind === "terminal" && !tab.exited && !tab.working) tab.working = true;
    this.start();
  }

  private tick(): void {
    const now = Date.now();
    const live = new Set<string>();
    for (const { tab } of terminals.tabsWithWorkspace()) {
      live.add(tab.id);
      if (tab.kind !== "terminal") continue;
      if (tab.exited) {
        if (tab.working) tab.working = false;
        continue;
      }
      const seen = this.lastOutputAt.get(tab.id);
      if (seen === undefined) continue;
      // Visual only: turn the "working" dot off once output settles. No
      // notification here — the hook layer owns those (see file header).
      if (tab.working && now - seen >= VISUAL_IDLE_MS) tab.working = false;
    }
    // Prune tracking for tabs that have closed.
    for (const id of this.lastOutputAt.keys()) {
      if (!live.has(id)) this.lastOutputAt.delete(id);
    }
    for (const id of Object.keys(this.titleState)) {
      if (!live.has(id)) {
        const { [id]: _drop, ...rest } = this.titleState;
        this.titleState = rest;
      }
    }
  }
}

/** Singleton agent activity monitor. */
export const agentMonitor = new AgentMonitor();
