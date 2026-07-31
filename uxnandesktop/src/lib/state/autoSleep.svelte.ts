// Workspace auto-sleep engine — the slow tick that executes the pure planner
// (`$lib/resources/autoSleep`) against the live workspace world.
//
// Double-gated: the resource profile must allow it (capability `suggest` or
// `auto`) AND the explicit feature flag must be on (Settings → Resources →
// Resource mode). The tick itself is one cheap function call per minute while
// gated off, so arming the engine at boot costs nothing.
//
// Execution reuses the existing sleep/wake lifecycle in `terminals.svelte.ts` —
// this module never kills a process itself:
// - `sleep` decisions re-check the blockers at execution time (an agent may
//   have started since the snapshot) and downgrade to a suggestion if any
//   appeared — an agent-active workspace is never slept without a human click;
// - `suggest` decisions surface a toast whose action performs the same
//   `sleepWorkspace` a row-menu click would (with a last-moment blocker check).

import {
  planAutoSleep,
  type AutoSleepCandidate,
} from "$lib/resources/autoSleep";
import { i18n } from "$lib/i18n";
import { toast } from "$lib/toast";
import { app } from "./app.svelte";
import { resourceMode } from "./resourceMode.svelte";
import { terminals, GLOBAL_WORKSPACE } from "./terminals.svelte";

/** How often the engine evaluates the world. Slow on purpose: idleness is
 *  measured in tens of minutes, so a minute of latency is invisible. */
const TICK_MS = 60_000;

class AutoSleepStore {
  #timer: ReturnType<typeof setInterval> | null = null;
  /** Per-workspace timestamp of the last suggestion (the planner's cooldown). */
  #lastPromptMs: Record<string, number> = {};

  /** Arm the engine (idempotent). Returns a stop function. */
  start(): () => void {
    if (this.#timer) return () => this.stop();
    this.#timer = setInterval(() => this.tick(), TICK_MS);
    return () => this.stop();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Snapshot the workspace world for the planner. Only workspaces mounted
   *  this session are candidates — an unmounted (restored, never activated)
   *  workspace holds no processes, so sleeping it would save nothing and
   *  disturb its restore semantics. */
  #candidates(): AutoSleepCandidate[] {
    const lastActive = app.settings.workspaceLastActive ?? {};
    return terminals.mountedWorkspaceKeys.map((key) => ({
      key,
      liveTerminals: terminals.liveTerminalCount(key),
      asleep: terminals.isWorkspaceAsleep(key),
      blockers: terminals.sleepBlockers(key).length,
      lastActiveMs: lastActive[key] ?? null,
    }));
  }

  /** One evaluation pass (also directly callable from tests). */
  tick(now = Date.now()): void {
    const policy = resourceMode.policy;
    const decisions = planAutoSleep({
      level: policy.capabilities.workspaceAutoSleep,
      flagEnabled: policy.autoSleepEnabled,
      activeKey: terminals.activeWorkspace,
      globalKey: GLOBAL_WORKSPACE,
      nowMs: now,
      idleMinutes: policy.capabilities.autoSleepIdleMinutes,
      candidates: this.#candidates(),
      lastPromptMs: this.#lastPromptMs,
    });
    for (const d of decisions) {
      if (d.action === "sleep") this.#sleep(d.key, now);
      else this.#suggest(d.key, now);
    }
  }

  /** Execute an auto sleep — with a last-moment blocker re-check, so an agent
   *  that started between the snapshot and now downgrades to a suggestion. */
  #sleep(key: string, now: number): void {
    if (terminals.sleepBlockers(key).length > 0) {
      this.#suggest(key, now);
      return;
    }
    void terminals.sleepWorkspace(key).then(() => {
      toast(i18n.t("resourceMode.autoSleep.sleptToast", { name: workspaceLabel(key) }));
    });
  }

  /** Surface a suggestion whose action is the user's explicit confirmation. */
  #suggest(key: string, now: number): void {
    this.#lastPromptMs[key] = now;
    toast(i18n.t("resourceMode.autoSleep.suggestToast", { name: workspaceLabel(key) }), {
      action: {
        label: i18n.t("resourceMode.autoSleep.suggestAction"),
        onClick: () => {
          // The user just confirmed — but an agent that went to work since the
          // toast appeared still wins (same guard as the row-menu sleep).
          if (terminals.sleepBlockers(key).length > 0) {
            toast.warning(i18n.t("resourceMode.autoSleep.blockedToast"));
            return;
          }
          void terminals.sleepWorkspace(key);
        },
      },
    });
  }
}

/** The workspace folder name (workspace keys are worktree paths). */
function workspaceLabel(key: string): string {
  return key.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? key;
}

/** Singleton auto-sleep engine, armed from the root layout. */
export const autoSleep = new AutoSleepStore();
