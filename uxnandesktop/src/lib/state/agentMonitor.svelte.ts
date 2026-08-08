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

/**
 * How long output must keep coming before it counts as work.
 *
 * Terminal output is not proof of an agent working: a TUI with mouse tracking on
 * answers a plain **click** by redrawing, and treating that first byte as
 * activity lit the "working" dot every time the user touched the terminal —
 * three seconds of green for having looked at it. Real work is not a single
 * redraw: a thinking agent streams (spinner, tokens, tool output) for as long as
 * it runs, so requiring output that is *still* arriving this long after it
 * started separates the two without knowing anything about the CLI. The cost is
 * that the dot lights a fraction of a second late, which nobody can perceive.
 */
const ACTIVITY_SUSTAIN_MS = 400;

class AgentMonitor {
  /** When each tab last produced output (epoch ms). */
  private lastOutputAt = new Map<string, number>();
  /** When the current run of output on each tab began (epoch ms) — output that
   *  stops before [`ACTIVITY_SUSTAIN_MS`] never becomes "working". Reset once the
   *  tab falls quiet, so the next burst is judged on its own. */
  private outputRunStartedAt = new Map<string, number>();
  /** Tabs an agent process has been detected in during this app run. Gates the
   *  "agent exited" edge so a restore's first "no agent" report — emitted before
   *  the resumed TUI has started — can't declare a live session dead. */
  private agentSeen = new Set<string>();
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
        // Keep the captured session's liveness current: whether an agent
        // process is (still) running in this tab decides if a restored/woken
        // tab AUTO-relaunches its session's TUI or only pre-types the resume.
        //
        // Only an OBSERVED exit — we saw the agent, then we didn't — marks a
        // session dead. The backend emits on change from an empty map, so right
        // after a restore every tab reports "no agent" once: the shell is up but
        // the resumed TUI hasn't started yet. Believing that first report
        // declared the just-restored sessions dead, and from then on they were
        // only ever pre-typed — the tab you were working in survived (its hooks
        // kept re-stamping it live) while the idle ones stopped coming back.
        if (e.payload.command) {
          this.agentSeen.add(tab.id);
          terminals.noteAgentLiveness(tab.id, true);
        } else if (this.agentSeen.delete(tab.id)) {
          terminals.noteAgentLiveness(tab.id, false);
        }
        // A tab launched via uxnan already carries its true identity (set from the
        // agent profile). Process detection can misidentify a wrapper agent by an
        // inner helper it spawns (e.g. OpenClaude→claude, Zero→a child), so never
        // let detection override a known launch identity — it only names tabs where
        // the user started an agent by hand (no `agentCommand`).
        if (tab.agentCommand) return;
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

  /** Record output on a tab. Sustained output (see [`ACTIVITY_SUSTAIN_MS`]) reads
   *  as "working"; a one-off burst — a redraw answering a click — does not.
   *  Cheap (reactive only on edge). */
  noteOutput(tabId: string): void {
    const now = Date.now();
    const last = this.lastOutputAt.get(tabId);
    // A gap longer than the idle window starts a new run: whatever came before
    // has already been written off, so it must not count towards this one.
    const runStart =
      last !== undefined && now - last < VISUAL_IDLE_MS
        ? (this.outputRunStartedAt.get(tabId) ?? now)
        : now;
    this.outputRunStartedAt.set(tabId, runStart);
    this.lastOutputAt.set(tabId, now);
    const tab = terminals.findTab(tabId);
    if (
      tab &&
      tab.kind === "terminal" &&
      !tab.exited &&
      !tab.working &&
      now - runStart >= ACTIVITY_SUSTAIN_MS
    ) {
      tab.working = true;
    }
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
      if (now - seen >= VISUAL_IDLE_MS) {
        if (tab.working) tab.working = false;
        // The run is over; a later burst must earn "working" on its own.
        this.outputRunStartedAt.delete(tab.id);
      }
    }
    // Prune tracking for tabs that have closed.
    for (const id of this.lastOutputAt.keys()) {
      if (!live.has(id)) this.lastOutputAt.delete(id);
    }
    for (const id of this.outputRunStartedAt.keys()) {
      if (!live.has(id)) this.outputRunStartedAt.delete(id);
    }
    for (const id of this.agentSeen) {
      if (!live.has(id)) this.agentSeen.delete(id);
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
