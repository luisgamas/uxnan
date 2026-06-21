// Agent activity monitoring (Phase 4 — activity inference).
//
// We don't ask agents to report state; we infer it from terminal output. A tab
// producing output is "working"; once it goes quiet it's idle (likely waiting
// for you). When an *agent* tab settles idle while the app is in the background,
// we fire one native notification. This is universal (any CLI, no setup) but
// coarse — precise states would need agent cooperation (see FOR-DEV: hooks).
//
// State lives on the terminal tabs (`tab.working`, set here); `lastOutputAt` and
// the notified set are kept here, non-reactive, and self-pruned so closed tabs
// don't leak.

import { listen } from "@tauri-apps/api/event";
import { terminals } from "./terminals.svelte";
import { app } from "./app.svelte";
import { i18n } from "$lib/i18n";
import { notify } from "$lib/notify";
import { statusFromTitle } from "$lib/agentTitle";
import { unread } from "./unread.svelte";
import { agentStatus } from "./agentStatus.svelte";
import type { AgentStatus } from "$lib/types";

/** Payload of the backend `agent:detected` event. */
interface AgentDetected {
  ptyId: string;
  command: string | null;
}

/** Idle after this long with no output → the "working" dot turns off. */
const VISUAL_IDLE_MS = 3_000;
/** Idle this long → an agent tab is considered "settled" and may notify. */
const NOTIFY_IDLE_MS = 12_000;

const baseName = (p: string) =>
  p ? (p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p) : "";

class AgentMonitor {
  /** When each tab last produced output (epoch ms). */
  private lastOutputAt = new Map<string, number>();
  /** Agent tabs already notified for the current idle period (re-armed on output). */
  private notified = new Set<string>();
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
    this.notified.delete(tabId);
    const tab = terminals.findTab(tabId);
    if (tab && tab.kind === "terminal" && !tab.exited && !tab.working) tab.working = true;
    this.start();
  }

  private tick(): void {
    const now = Date.now();
    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    const live = new Set<string>();
    for (const { tab, workspace } of terminals.tabsWithWorkspace()) {
      live.add(tab.id);
      if (tab.kind !== "terminal") continue;
      if (tab.exited) {
        if (tab.working) tab.working = false;
        continue;
      }
      const seen = this.lastOutputAt.get(tab.id);
      if (seen === undefined) continue;
      const idle = now - seen;
      if (tab.working && idle >= VISUAL_IDLE_MS) tab.working = false;
      // One notification when an agent settles idle while you're NOT looking at
      // its terminal — i.e. the window is unfocused, or a different workspace /
      // tab is showing. (Opt-out via settings.)
      const viewing =
        focused &&
        terminals.activeWorkspace === workspace &&
        terminals.activePtyId() === tab.id;
      // When the hook server is driving this tab, it owns "done"/notifications;
      // skip the coarse inference so we don't double-fire or misfire.
      const hookDriven = agentStatus.get(tab.id) !== undefined;
      if (
        tab.agentName &&
        !hookDriven &&
        idle >= NOTIFY_IDLE_MS &&
        !viewing &&
        !this.notified.has(tab.id)
      ) {
        this.notified.add(tab.id);
        // Flag the worktree as having an unreviewed result (red badge + count).
        unread.mark(workspace);
        if (app.settings.agentNotifications !== false) {
          const where = baseName(workspace) || i18n.t("terminal.general");
          void notify(
            i18n.t("notify.agentIdleTitle", { agent: tab.agentName }),
            i18n.t("notify.agentIdleBody", { agent: tab.agentName, worktree: where }),
          );
        }
      }
    }
    // Prune tracking for tabs that have closed.
    for (const id of this.lastOutputAt.keys()) {
      if (!live.has(id)) {
        this.lastOutputAt.delete(id);
        this.notified.delete(id);
      }
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
