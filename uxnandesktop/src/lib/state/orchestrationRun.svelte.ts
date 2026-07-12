// Orchestration run engine (Svelte 5 runes) — the reactive driver for the "run
// engine" (spec `02d` §3). Layers live agent state, dispatch, timers and durable
// persistence on top of the pure DAG logic in `$lib/orchestration/run`.
//
// A **run** is a DAG of **steps**; the engine is a deterministic scheduler that,
// on each tick, promotes ready steps (deps satisfied), dispatches them respecting
// a concurrency cap + agent availability (backpressure), detects completion, and
// captures each step's output onto the run's shared "blackboard" so a later
// step's prompt can plant it (`{{steps.s1.output}}`). Interactive steps are typed
// into a live agent's PTY (like the broadcast console) and complete on the hook
// `done`/idle signal; headless steps (Stage 2) will complete on a verified exit
// code. The run graph + captured outputs are **durable** (persisted opaquely via
// `set_orchestration_runs`), so a run survives a restart and the engine
// re-attaches on load.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { agentRunHeadless, setOrchestrationRuns, type HeadlessResult } from "$lib/api";
import { terminals } from "./terminals.svelte";
import { agentStatus } from "./agentStatus.svelte";
import { orchestration } from "./orchestration.svelte";
import { notify } from "$lib/notify";
import { i18n } from "$lib/i18n";
import type { OrchestratorAgent } from "$lib/orchestration";
import {
  addStep,
  createRun,
  deriveRunStatus,
  nextStatusForPending,
  resolveTemplate,
  stepsById,
  validateRun,
  type GateDecision,
  type Run,
  type RunStep,
  type SavedRun,
} from "$lib/orchestration/run";

/** Payload of the `agent:orchestration` event — a cooperative report from an
 *  agent via the injected orchestration MCP tools (spec 02d §3). Attributed to
 *  the running step whose target tab is `agentId`. */
interface OrchestrationEvent {
  agentId: string;
  type: "result" | "progress";
  text: string;
  summary?: string | null;
}

/** Engine tick cadence while any run is active. 700 ms is responsive enough for
 *  human-paced orchestration without a busy always-on timer. */
const TICK_MS = 700;

/** How long after dispatching an interactive step we wait for the agent to
 *  visibly go busy before assuming it already finished (a fast / hook-less agent
 *  whose activity we couldn't catch). Longer than the broadcast console's pickup
 *  grace, to reduce false "done" on a slow-to-start agent. */
const PICKUP_GRACE_MS = 6000;

/** Max steps a single run runs concurrently (backpressure across the DAG). */
const MAX_CONCURRENCY = 4;

class OrchestrationRunStore {
  /** All runs (draft / active / past), most-recent last. Durable. */
  runs = $state<Run[]>([]);
  /** Whether hydration has run (so the persist effect doesn't fire pre-load). */
  private hydrated = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Interactive steps we've observed the target agent go busy for since
   *  dispatch (keyed `runId/stepId`) — gates the "agent went idle again =
   *  done" completion signal. Runtime-only. */
  private sawBusy = new Set<string>();
  /** Gate steps we've already fired a "needs you" notification for (keyed
   *  `runId/stepId`) — so a waiting gate alerts the user only once. */
  private notifiedGates = new Set<string>();
  private eventBridgeStarted = false;

  // --- Derived views (for the UI) ------------------------------------------

  /** Runs the engine is (or could be) advancing — running or paused. */
  get activeRuns(): Run[] {
    return this.runs.filter((r) => r.status === "running" || r.status === "paused");
  }
  /** Editable, not-yet-started runs. */
  get draftRuns(): Run[] {
    return this.runs.filter((r) => r.status === "draft");
  }
  /** Finished runs (completed / failed / cancelled), most-recent first. */
  get pastRuns(): Run[] {
    return this.runs
      .filter((r) => r.status === "completed" || r.status === "failed" || r.status === "cancelled")
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  runById(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id);
  }

  /** Live agents the engine can target (reuses the broadcast console's view). */
  get liveAgents(): OrchestratorAgent[] {
    return orchestration.agents;
  }

  // --- Hydration + persistence ---------------------------------------------

  /** Load persisted runs and re-attach the engine (spec: durable data,
   *  re-attachable driver). A `running`/`paused` run keeps its captured outputs;
   *  any step left mid-flight (`running`) is reset to `ready` because its live
   *  PTY is gone after a restart, so the engine re-dispatches it to a live agent
   *  of the same type. Idempotent. */
  hydrate(saved: SavedRun[] | null | undefined): void {
    if (this.hydrated) return;
    const runs = (saved ?? []).map((r) => this.reconcile(r));
    this.runs = runs;
    this.hydrated = true;
    this.startEventBridge();
    if (this.activeRuns.length > 0) {
      this.ensureTimer();
      this.tick();
    }
  }

  /** Subscribe (once) to `agent:orchestration` — a cooperative report an agent
   *  sends through the injected orchestration MCP tools. A `result` completes the
   *  running interactive step targeting that agent with the agent's *structured*
   *  output (better than the coarse hook summary); a `progress` updates its live
   *  summary. No-op in the web preview (no Tauri event bus). */
  private startEventBridge(): void {
    if (this.eventBridgeStarted) return;
    this.eventBridgeStarted = true;
    void listen<OrchestrationEvent>("agent:orchestration", (e) => {
      this.applyAgentReport(e.payload);
    }).catch(() => {
      this.eventBridgeStarted = false;
    });
  }

  /** Attribute an agent's MCP report to the running interactive step targeting
   *  it, and apply it (structured result → complete; progress → live summary). */
  private applyAgentReport(ev: OrchestrationEvent): void {
    for (const run of this.runs) {
      if (run.status !== "running" && run.status !== "paused") continue;
      const step = run.steps.find(
        (s) => s.status === "running" && s.kind === "interactive" && s.target.tabId === ev.agentId,
      );
      if (!step) continue;
      if (ev.type === "result") {
        const out = (ev.text ?? "").trim();
        step.status = "completed";
        step.output = out;
        step.summary = (ev.summary ?? "").trim() || firstLine(out);
        step.error = undefined;
        step.finishedAt = Date.now();
        this.sawBusy.delete(this.key(run.id, step.id));
      } else {
        step.summary = (ev.text ?? "").trim();
      }
      this.schedulePersist();
      this.tick();
      return;
    }
  }

  /** Reconcile a persisted run on load: a mid-flight `running` step (its PTY is
   *  gone) drops back to `ready`; a `blocked` step stays blocked (it will retry).
   *  Completed outputs are untouched, so the context chain survives the restart. */
  private reconcile(run: Run): Run {
    if (run.status !== "running" && run.status !== "paused") return run;
    const steps = run.steps.map((s) =>
      s.status === "running" ? { ...s, status: "ready" as const, startedAt: undefined } : s,
    );
    return { ...run, steps };
  }

  /** Persist the runs (debounced), mirroring the terminal-layout write. */
  private schedulePersist(): void {
    if (!this.hydrated) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void setOrchestrationRuns($state.snapshot(this.runs) as SavedRun[]).catch(() => {});
    }, 500);
  }

  // --- Authoring (drafts) --------------------------------------------------

  /** Create a fresh draft run and return it. */
  createDraft(title: string): Run {
    const run = createRun(crypto.randomUUID(), title.trim() || "Untitled run", Date.now());
    this.runs = [...this.runs, run];
    this.schedulePersist();
    return run;
  }

  /** Append a step to a run; returns the new step's id (or undefined if the run
   *  is gone). Bumps the run's monotonic step-id counter. */
  addStepTo(runId: string, partial: Partial<RunStep>): string | undefined {
    const idx = this.runs.findIndex((r) => r.id === runId);
    if (idx === -1) return undefined;
    const { run, stepId } = addStep(this.runs[idx], partial);
    run.updatedAt = Date.now();
    this.runs[idx] = run;
    this.schedulePersist();
    return stepId;
  }

  /** Patch one step of a run in place. */
  updateStep(runId: string, stepId: string, patch: Partial<RunStep>): void {
    const run = this.runById(runId);
    const step = run?.steps.find((s) => s.id === stepId);
    if (!run || !step) return;
    Object.assign(step, patch);
    run.updatedAt = Date.now();
    this.schedulePersist();
  }

  /** Remove a step, and drop it from any other step's `dependsOn`. */
  removeStep(runId: string, stepId: string): void {
    const run = this.runById(runId);
    if (!run) return;
    run.steps = run.steps
      .filter((s) => s.id !== stepId)
      .map((s) =>
        s.dependsOn.includes(stepId)
          ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== stepId) }
          : s,
      );
    run.updatedAt = Date.now();
    this.schedulePersist();
  }

  /** Rename a run. */
  renameRun(runId: string, title: string): void {
    const run = this.runById(runId);
    if (!run) return;
    run.title = title.trim() || run.title;
    run.updatedAt = Date.now();
    this.schedulePersist();
  }

  /** Delete a run entirely. */
  deleteRun(runId: string): void {
    this.runs = this.runs.filter((r) => r.id !== runId);
    this.clearRuntimeFor(runId);
    this.schedulePersist();
    if (this.activeRuns.length === 0) this.stopTimer();
  }

  /** Validation errors for a run (empty = ready to start). */
  validate(runId: string): string[] {
    const run = this.runById(runId);
    return run ? validateRun(run) : ["Run not found."];
  }

  // --- Lifecycle -----------------------------------------------------------

  /** Start (or re-run) a run: validate, reset every step to a clean `pending`
   *  (clearing prior outputs), flip to `running`, and kick the engine. Returns
   *  validation errors on refusal (empty = started). */
  startRun(runId: string): string[] {
    const run = this.runById(runId);
    if (!run) return ["Run not found."];
    const errors = validateRun(run);
    if (errors.length > 0) return errors;
    for (const s of run.steps) this.resetStep(s);
    run.status = "running";
    run.updatedAt = Date.now();
    this.clearRuntimeFor(runId);
    this.ensureTimer();
    this.tick();
    this.schedulePersist();
    return [];
  }

  /** Hold a running run: no new steps are dispatched, but already-running steps
   *  still finish (we can't un-type an agent). Resume with `resumeRun`. */
  pauseRun(runId: string): void {
    const run = this.runById(runId);
    if (!run || run.status !== "running") return;
    run.status = "paused";
    run.updatedAt = Date.now();
    this.schedulePersist();
  }

  /** Resume a paused run. */
  resumeRun(runId: string): void {
    const run = this.runById(runId);
    if (!run || run.status !== "paused") return;
    run.status = "running";
    run.updatedAt = Date.now();
    this.ensureTimer();
    this.tick();
    this.schedulePersist();
  }

  /** Cancel a run: stop the engine for it and mark every not-yet-finished step
   *  `skipped` (an already-typed agent keeps working, but the engine lets go). */
  cancelRun(runId: string): void {
    const run = this.runById(runId);
    if (!run) return;
    for (const s of run.steps) {
      if (s.status !== "completed" && s.status !== "failed") s.status = "skipped";
    }
    run.status = "cancelled";
    run.updatedAt = Date.now();
    this.clearRuntimeFor(runId);
    this.schedulePersist();
    if (this.activeRuns.length === 0) this.stopTimer();
  }

  /** Drop the transient per-run runtime tracking (busy-observed, gate-notified)
   *  on (re)start, cancel or delete — keyed `runId/stepId`. */
  private clearRuntimeFor(runId: string): void {
    const prefix = `${runId}/`;
    for (const k of this.sawBusy) if (k.startsWith(prefix)) this.sawBusy.delete(k);
    for (const k of this.notifiedGates) if (k.startsWith(prefix)) this.notifiedGates.delete(k);
  }

  private resetStep(s: RunStep): void {
    s.status = "pending";
    s.output = undefined;
    s.summary = undefined;
    s.exitCode = undefined;
    s.error = undefined;
    s.attempts = 0;
    s.startedAt = undefined;
    s.finishedAt = undefined;
    if (s.gate) s.gate = { question: s.gate.question };
  }

  // --- The engine ----------------------------------------------------------

  private ensureTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }
  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One scheduler pass over every active run: promote → detect completion →
   *  dispatch → derive status. Persists (debounced) only when something changed,
   *  and parks the timer once no run is active. */
  private tick(): void {
    let changed = false;
    const now = Date.now();
    const agents = this.liveAgents;

    for (const run of this.runs) {
      if (run.status !== "running" && run.status !== "paused") continue;
      const by = stepsById(run);

      // 1) Promote pending steps whose dependencies are satisfied (or skip those
      //    whose dependency failed).
      for (const s of run.steps) {
        const next = nextStatusForPending(s, by);
        if (next) {
          s.status = next;
          changed = true;
        }
      }

      // 2) Detect completion of running steps. Interactive steps complete on the
      //    hook/idle signal here; headless steps complete asynchronously in their
      //    own promise callback (see `dispatchHeadless`), so they're skipped here.
      for (const s of run.steps) {
        if (s.status !== "running") continue;
        if (s.kind === "interactive" && this.detectInteractiveDone(run, s, agents, now)) {
          changed = true;
        }
      }

      // 3) Dispatch ready/blocked steps up to the concurrency cap. `occupied`
      //    holds the agent tabs already taken by running interactive steps, so a
      //    second interactive step never lands on the same agent.
      if (run.status === "running") {
        const runningCount = run.steps.filter((s) => s.status === "running").length;
        const occupied = new Set(
          run.steps
            .filter((s) => s.status === "running" && s.kind === "interactive")
            .map((s) => s.target.tabId)
            .filter((id): id is string => !!id),
        );
        let budget = MAX_CONCURRENCY - runningCount;
        for (const s of run.steps) {
          if (budget <= 0) break;
          if (s.status !== "ready" && s.status !== "blocked") continue;
          const prev = s.status;
          if (s.kind === "interactive") {
            if (this.dispatchInteractive(run, s, agents, occupied, now)) budget -= 1;
          } else if (s.kind === "headless") {
            this.dispatchHeadless(run, s, now);
            budget -= 1;
          } else if (s.kind === "gate") {
            this.dispatchGate(run, s, now);
            budget -= 1;
          }
          // Only a real status transition is worth persisting — a step that stays
          // `blocked` for lack of a live agent must not churn the disk each tick.
          if (s.status !== prev) changed = true;
        }
      }

      // 4) Derive the run's terminal status (only for a running run; a paused run
      //    stays paused until resumed).
      if (run.status === "running") {
        const derived = deriveRunStatus(run);
        if (derived !== "running") {
          run.status = derived;
          run.updatedAt = now;
          changed = true;
        }
      }
    }

    if (changed) this.schedulePersist();
    if (this.activeRuns.length === 0) this.stopTimer();
  }

  /** Resolve the live agent an interactive step should target: the exact bound
   *  tab if still live, else the first live agent of the same type (+ workspace,
   *  when pinned) not already occupied by another running step. */
  private resolveTarget(
    step: RunStep,
    agents: OrchestratorAgent[],
    occupied: Set<string>,
  ): OrchestratorAgent | undefined {
    const t = step.target;
    if (t.tabId) {
      const exact = agents.find((a) => a.tabId === t.tabId);
      if (exact) return exact;
    }
    if (t.agentType) {
      return agents.find(
        (a) =>
          a.type === t.agentType &&
          (!t.workspace || a.workspace === t.workspace) &&
          !occupied.has(a.tabId),
      );
    }
    return undefined;
  }

  /** Try to dispatch an interactive step. Returns true when the prompt was typed
   *  into a live, free agent (step → running); otherwise the step is `blocked`
   *  (no live target, or the agent is busy) and will be retried next tick. */
  private dispatchInteractive(
    run: Run,
    step: RunStep,
    agents: OrchestratorAgent[],
    occupied: Set<string>,
    now: number,
  ): boolean {
    const agent = this.resolveTarget(step, agents, occupied);
    if (!agent || agent.busy) {
      step.status = "blocked";
      return false;
    }
    const { text } = resolveTemplate(step.prompt, stepsById(run));
    step.target.tabId = agent.tabId;
    step.status = "running";
    step.attempts += 1;
    step.startedAt = now;
    step.error = undefined;
    this.sawBusy.delete(this.key(run.id, step.id));
    occupied.add(agent.tabId);
    // Best-effort: a dead PTY simply drops the write (handled as failure next
    // tick when the tab is gone).
    void invoke("pty_write", { id: agent.tabId, data: `${text}\r` }).catch(() => {});
    return true;
  }

  /** Dispatch a headless step: resolve its prompt, flip it to `running`, and
   *  spawn the agent in print-mode. The ADE **owns the process**, so completion
   *  is verified by the exit code when the promise resolves (`onHeadlessDone`) —
   *  no cooperative signal needed. Unlike interactive dispatch there's no agent
   *  backpressure (each run spawns its own subprocess); the concurrency cap bounds
   *  how many run at once. */
  private dispatchHeadless(run: Run, step: RunStep, now: number): void {
    const { text } = resolveTemplate(step.prompt, stepsById(run));
    const agent = step.target.agent ?? "";
    const model = step.target.model ?? "";
    const cwd = step.target.workspace ?? "";
    step.status = "running";
    step.attempts += 1;
    step.startedAt = now;
    step.error = undefined;
    const runId = run.id;
    const stepId = step.id;
    void agentRunHeadless(agent, model, text, cwd)
      .then((res) => this.onHeadlessDone(runId, stepId, res, null))
      .catch((err: unknown) =>
        this.onHeadlessDone(runId, stepId, null, err instanceof Error ? err.message : String(err)),
      );
  }

  /** Resolve a finished headless run: exit 0 completes the step with the full
   *  stdout as its output; a non-zero exit (or a spawn/timeout error) fails it
   *  (honoring the retry policy). Ignored if the step was cancelled/reset while
   *  the process was in flight. Kicks the engine so dependents advance at once. */
  private onHeadlessDone(
    runId: string,
    stepId: string,
    res: HeadlessResult | null,
    error: string | null,
  ): void {
    const run = this.runById(runId);
    const step = run?.steps.find((s) => s.id === stepId);
    if (!run || !step || step.status !== "running") return;
    const now = Date.now();
    if (res && res.exitCode === 0) {
      const out = res.stdout.trim();
      step.status = "completed";
      step.output = out;
      step.summary = firstLine(out);
      step.exitCode = 0;
      step.error = undefined;
      step.finishedAt = now;
    } else {
      step.exitCode = res?.exitCode ?? undefined;
      const detail =
        error ??
        (res ? res.stderr.trim() || `the agent exited with code ${res.exitCode}` : "the agent failed");
      this.failStep(step, detail, now);
    }
    this.schedulePersist();
    this.tick();
  }

  /** Dispatch a gate step: park it in `running` (awaiting a human decision) and
   *  fire a one-shot "needs you" native notification. It stays `running` until
   *  `resolveGate` is called — the run's other independent branches keep going. */
  private dispatchGate(run: Run, step: RunStep, now: number): void {
    step.status = "running";
    step.startedAt = now;
    const k = this.key(run.id, step.id);
    if (!this.notifiedGates.has(k)) {
      this.notifiedGates.add(k);
      const question = step.gate?.question ?? step.title;
      void notify(i18n.t("orchestration.gateNotifyTitle", { run: run.title }), question).catch(
        () => {},
      );
    }
  }

  /** Resolve a waiting gate step. `approve` completes it (its note becomes the
   *  step output, feeding later steps); `reject` fails it (dependents skip, and
   *  the run fails unless another branch is still running). Kicks the engine. */
  resolveGate(runId: string, stepId: string, decision: GateDecision, note = ""): void {
    const run = this.runById(runId);
    const step = run?.steps.find((s) => s.id === stepId);
    if (!run || !step || step.kind !== "gate" || step.status !== "running") return;
    const now = Date.now();
    const text = note.trim();
    step.gate = { question: step.gate?.question ?? step.title, decision, note: text };
    this.notifiedGates.delete(this.key(runId, stepId));
    if (decision === "approve") {
      step.status = "completed";
      step.output = text || "approved";
      step.summary = text || i18n.t("orchestration.gateApproved");
      step.error = undefined;
      step.finishedAt = now;
    } else {
      step.status = "failed";
      step.error = text || i18n.t("orchestration.gateRejected");
      step.finishedAt = now;
    }
    if (this.activeRuns.length > 0) this.ensureTimer();
    this.tick();
    this.schedulePersist();
  }

  /** Completion detection for a running interactive step. Returns whether the
   *  step's state changed. The target agent going busy is remembered; once it
   *  goes idle again (precise hook `done`/`waiting`, or coarse output activity
   *  stopping) the step completes with the hook `summary` as its output. As a
   *  fallback, a hook-less agent we never caught busy completes after a grace
   *  window so the run never wedges. A vanished/exited terminal fails the step. */
  private detectInteractiveDone(
    run: Run,
    step: RunStep,
    agents: OrchestratorAgent[],
    now: number,
  ): boolean {
    const tabId = step.target.tabId;
    if (!tabId) return this.failStep(step, "no target agent", now);

    const tab = terminals.findTab(tabId);
    if (!tab || (tab.kind === "terminal" && tab.exited)) {
      return this.failStep(step, "the agent's terminal closed", now);
    }

    const live = agentStatus.get(tabId);
    const precise = live?.status;
    const busy = precise
      ? precise === "working" || precise === "blocked"
      : !!(tab.kind === "terminal" && tab.working);

    const k = this.key(run.id, step.id);
    if (busy) {
      this.sawBusy.add(k);
      return false;
    }

    const elapsed = now - (step.startedAt ?? now);
    if (this.sawBusy.has(k) || elapsed > PICKUP_GRACE_MS) {
      const summary = (live?.summary ?? "").trim();
      step.status = "completed";
      step.output = summary;
      step.summary = summary;
      step.error = undefined;
      step.finishedAt = now;
      this.sawBusy.delete(k);
      return true;
    }
    return false;
  }

  /** Fail (or retry) a step. With `onFailure: "retry"` and attempts left it drops
   *  back to `ready` for another dispatch; otherwise it's terminally `failed`. */
  private failStep(step: RunStep, error: string, now: number): boolean {
    step.error = error;
    if (step.onFailure === "retry" && step.attempts < step.maxAttempts) {
      step.status = "ready";
    } else {
      step.status = "failed";
      step.finishedAt = now;
    }
    return true;
  }

  private key(runId: string, stepId: string): string {
    return `${runId}/${stepId}`;
  }
}

/** The first non-empty line of `text`, capped, for a step's short summary. */
function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/** Singleton orchestration-run engine shared across the app. */
export const orchestrationRun = new OrchestrationRunStore();
