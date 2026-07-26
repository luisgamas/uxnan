// Automations store (Svelte 5 runes) — the screen's window onto the Rust engine.
//
// Unlike the orchestration console, this store drives **nothing**: the engine
// lives in Rust and a run is executed by a separate headless process (spec
// `02f`). So the job here is narrow and honest — read the definitions, mutate
// them through the command surface, and reflect what the backend reports,
// including when scheduling *failed*.
//
// Live progress comes from polling the run records while the screen is open.
// The app's single filesystem watcher is aimed at the active worktree for the
// file tree and diffs; hijacking it here would break that, and a 2 s poll of a
// handful of small JSON files only while the user is looking at them is cheaper
// than the bug that would cause.

import {
  automationsDelete,
  automationsList,
  automationsRunNow,
  automationsRuns,
  automationsSave,
  automationsSeedExamples,
  automationsSchedulerStatus,
  automationsSchedulerSupported,
  automationsSetEnabled,
} from "$lib/api";
import { i18n } from "$lib/i18n";
import { buildAllExamples } from "$lib/automations/examples";
import { startBoundary } from "$lib/automations/schedule";
import type { Automation, AutomationRun, SchedulerStatus } from "$lib/automations/types";

/** How often run records are re-read while the screen is open. */
const POLL_MS = 2000;

class AutomationsStore {
  /** Every saved automation. */
  items = $state<Automation[]>([]);
  /** True until the first load resolves, so the list can show a skeleton
   *  instead of an empty state that would read as "you have none". */
  loading = $state(true);
  /** Last error from a mutation, for an inline message. */
  error = $state<string | null>(null);
  /** Whether this platform can schedule at all — surfaced up front rather than
   *  after a failed save. */
  schedulerSupported = $state(true);
  /** Per-automation OS scheduler state. */
  scheduler = $state<Record<string, SchedulerStatus>>({});
  /** Per-automation run history, newest first. */
  runs = $state<Record<string, AutomationRun[]>>({});

  private hydrated = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** Automations whose runs the open screen wants kept fresh. */
  private watched = new Set<string>();

  // --- Loading -------------------------------------------------------------

  /** Load the definitions (once per session unless `force`). */
  async load(force = false): Promise<void> {
    if (this.hydrated && !force) return;
    this.loading = true;
    try {
      this.items = await automationsList();
      this.hydrated = true;
      this.error = null;
      void this.refreshSupported();
      // Ask the OS about each one: a task can disappear behind our back (a user
      // deleting it by hand, a policy sweep), and the list must not claim
      // otherwise.
      for (const a of this.items) void this.refreshScheduler(a.id);
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  private async refreshSupported(): Promise<void> {
    try {
      this.schedulerSupported = await automationsSchedulerSupported();
    } catch {
      // A failed probe must not claim the platform is unsupported; leave the
      // optimistic default and let a real registration report the truth.
    }
  }

  /** Offer the shipped examples on a machine that has never seen them.
   *
   *  They land **paused**, so nothing runs by itself, and the backend refuses a
   *  second seeding — deleting an example is a decision, and bringing it back
   *  next launch would be arguing with it. Best-effort: a failure here must
   *  never stop the screen from opening. */
  async seedExamples(installedAgents: string[], workingDir: string): Promise<void> {
    try {
      const examples = buildAllExamples({
        installedAgents,
        workingDir,
        t: (key) => i18n.t(key),
        now: Date.now(),
      });
      if (await automationsSeedExamples(examples)) {
        this.items = await automationsList();
        for (const a of this.items) void this.refreshScheduler(a.id);
      }
    } catch {
      // An unseeded machine simply shows an empty list with its own guidance.
    }
  }

  /** Re-read the OS scheduler's view of one automation. */
  async refreshScheduler(id: string): Promise<void> {
    try {
      this.scheduler[id] = await automationsSchedulerStatus(id);
    } catch (e) {
      this.scheduler[id] = { kind: "failed", message: message(e) };
    }
  }

  /** Re-read one automation's run history. */
  async loadRuns(id: string): Promise<void> {
    try {
      this.runs[id] = await automationsRuns(id);
    } catch (e) {
      this.error = message(e);
    }
  }

  byId(id: string): Automation | undefined {
    return this.items.find((a) => a.id === id);
  }

  /** The most recent run of an automation, if any. */
  lastRun(id: string): AutomationRun | undefined {
    return this.runs[id]?.[0];
  }

  /** Whether a run of this automation is in flight right now. */
  isRunning(id: string): boolean {
    return (this.runs[id] ?? []).some((r) => r.status === "running");
  }

  // --- Mutations -----------------------------------------------------------

  /** Create or update an automation and register its task in the same step.
   *  Returns whether it was stored — the scheduler outcome is reported
   *  separately in `scheduler[id]`, because a save that stored fine but could
   *  not schedule is a real and *useful* state, not a failure. */
  async save(automation: Automation): Promise<boolean> {
    try {
      const result = await automationsSave(automation, startBoundary(automation.schedule));
      const idx = this.items.findIndex((a) => a.id === result.automation.id);
      if (idx >= 0) this.items[idx] = result.automation;
      else this.items = [...this.items, result.automation];
      this.scheduler[result.automation.id] = result.scheduler;
      this.error = null;
      return true;
    } catch (e) {
      this.error = message(e);
      return false;
    }
  }

  /** Pause or resume an automation, adding or removing its OS task to match. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = this.byId(id);
    if (!current) return;
    try {
      const result = await automationsSetEnabled(
        id,
        enabled,
        startBoundary(current.schedule),
      );
      const idx = this.items.findIndex((a) => a.id === id);
      if (idx >= 0) this.items[idx] = result.automation;
      this.scheduler[id] = result.scheduler;
      this.error = null;
    } catch (e) {
      this.error = message(e);
    }
  }

  /** Delete an automation, its task and its history. */
  async remove(id: string): Promise<void> {
    try {
      await automationsDelete(id);
      this.items = this.items.filter((a) => a.id !== id);
      delete this.scheduler[id];
      delete this.runs[id];
      this.watched.delete(id);
      this.error = null;
    } catch (e) {
      this.error = message(e);
    }
  }

  /** Duplicate an automation as a new draft ("create from"). The copy is
   *  **paused**: an accidental duplicate must never start firing on its own. */
  duplicate(source: Automation, name: string): Automation {
    return {
      ...structuredClone($state.snapshot(source)),
      id: crypto.randomUUID(),
      name,
      enabled: false,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  /** Start a run now (the same headless runner the OS scheduler spawns).
   *  Refreshes the history shortly after so the new record appears without the
   *  user having to do anything. */
  async runNow(id: string): Promise<void> {
    try {
      await automationsRunNow(id);
      this.error = null;
      setTimeout(() => void this.loadRuns(id), 400);
    } catch (e) {
      this.error = message(e);
    }
  }

  // --- Live progress -------------------------------------------------------

  /** Keep `id`'s runs fresh while the caller is showing them. Returns a
   *  cleanup for the caller's `$effect`. */
  watch(id: string): () => void {
    this.watched.add(id);
    void this.loadRuns(id);
    this.ensurePolling();
    return () => {
      this.watched.delete(id);
      if (this.watched.size === 0) this.stopPolling();
    };
  }

  private ensurePolling(): void {
    if (this.pollTimer !== undefined) return;
    this.pollTimer = setInterval(() => {
      for (const id of this.watched) void this.loadRuns(id);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}

function message(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** Singleton automations store shared across the app. */
export const automations = new AutomationsStore();
