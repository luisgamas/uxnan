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
import { terminals } from "./terminals.svelte";
import { unread } from "./unread.svelte";
import { app } from "./app.svelte";
import { toast } from "$lib/toast";
import { notify } from "$lib/notify";
import { i18n } from "$lib/i18n";
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
  /** Short preview of the agent's latest response (sent on `done`), if any. */
  summary?: string | null;
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
    summary: e.summary,
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
        const p = e.payload;
        const prevState = this.byId[p.agentId];
        this.byId = { ...this.byId, [p.agentId]: toLive(p) };
        // Announce meaningful transitions (done / blocked / waiting). Pass the
        // previous state so we can recover the task prompt on `done` (the Stop
        // report's own prompt may be the freshly-read transcript task).
        if (prevState?.status !== p.status) this.notifyChange(p, prevState);
      });
    } catch {
      this.started = false; // no Tauri event bus
    }
  }

  /** Announce a meaningful agent state transition (gated by the agent-
   *  notifications setting). `working` is intentionally skipped — it fires on
   *  every tool call. When the app is focused, an in-app toast is enough; when
   *  it's in the background, a native OS notification is sent (enriched with the
   *  task and a short response preview for `done`). A non-`working` result also
   *  flags its worktree "unread" unless you're already looking at it. */
  private notifyChange(p: AgentStatusEvent, prevState?: LiveAgentState): void {
    const status = p.status;
    if (status === "working") return;
    if (app.settings.agentNotifications === false) return;

    const tab = terminals.findTab(p.agentId);
    const name =
      (tab?.kind === "terminal" ? tab.agentName : undefined) ?? i18n.t("toast.agent");
    const ws = terminals.workspaceOfTab(p.agentId);
    const viewing = ws !== undefined && this.viewing(ws, p.agentId);

    // Already looking right at this agent? Nothing to announce — you see it.
    if (viewing) return;

    // Flag the worktree as having an unreviewed result (red badge).
    if (ws !== undefined) unread.mark(ws);

    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    if (focused) {
      // In-app, lightweight — only useful while the window is up.
      if (status === "done") toast.success(i18n.t("toast.agentDone", { name }));
      else if (status === "blocked") toast.warning(i18n.t("toast.agentBlocked", { name }));
      else if (status === "waiting") toast.info(i18n.t("toast.agentWaiting", { name }));
      return;
    }

    // Background → native OS notification with enriching detail.
    const task = (p.prompt ?? prevState?.prompt ?? "").trim();
    if (status === "done") {
      const preview = (p.summary ?? "").trim();
      const body = preview
        ? preview
        : task
          ? i18n.t("notify.agentTask", { task })
          : i18n.t("notify.agentDoneBody");
      void notify(i18n.t("notify.agentDoneTitle", { agent: name }), body);
    } else if (status === "waiting") {
      void notify(
        i18n.t("notify.agentWaitingTitle", { agent: name }),
        task ? i18n.t("notify.agentTask", { task }) : i18n.t("notify.agentWaitingBody"),
      );
    } else if (status === "blocked") {
      const preview = (p.summary ?? "").trim();
      void notify(
        i18n.t("notify.agentBlockedTitle", { agent: name }),
        preview || i18n.t("notify.agentBlockedBody"),
      );
    }
  }

  /** Whether the user is currently looking at a given terminal (window focused,
   *  that workspace shown, that tab active) — so a result there needs no badge. */
  private viewing(workspace: string, tabId: string): boolean {
    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    return (
      focused &&
      terminals.activeWorkspace === workspace &&
      terminals.activePtyId() === tabId
    );
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
