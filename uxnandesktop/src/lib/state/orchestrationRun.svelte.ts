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
import { agentRunHeadless, setOrchestrationRuns, type HeadlessResult } from "$lib/api";
import { registerFlush } from "./flushRegistry";
import { terminals } from "./terminals.svelte";
import { agentStatus } from "./agentStatus.svelte";
import { orchestration } from "./orchestration.svelte";
import { app } from "./app.svelte";
import { resourceMode } from "./resourceMode.svelte";
import { resources } from "./resources.svelte";
import {
  effectiveOrchestrationConcurrency,
  orchestrationHeadroom,
} from "$lib/resources/policy";
import { notify } from "$lib/notify";
import { i18n } from "$lib/i18n";
import type { OrchestratorAgent } from "$lib/orchestration";
import { buildExampleRun, type ExampleStepSpec } from "$lib/orchestration/examples";
import {
  ackInbox,
  addStep,
  createRun,
  deriveRunStatus,
  dispatchIdFor,
  isDriven,
  isStepTerminal,
  nextStatusForPending,
  postInbox,
  resolveTemplate,
  stepsById,
  validateRun,
  workerPreamble,
  type GateDecision,
  type InboxItem,
  type Run,
  type RunStep,
  type SavedRun,
  type StepStatus,
  type TaskOutcome,
} from "$lib/orchestration/run";

/** A cooperative report from an agent through the orchestration MCP tools
 *  (spec 02d §3), handed in by the control bridge. Attributed to the running
 *  step whose target tab is `agentId` — or, when the agent is a worker a
 *  coordinator started, to the task and dispatch its preamble named: a
 *  report naming a dispatch that is no longer the task's current one is
 *  stale and refused (the completion authority is the active dispatch). */
export interface AgentReport {
  agentId: string;
  type: "result" | "progress";
  text: string;
  summary?: string | null;
  taskId?: string | null;
  dispatchId?: string | null;
  outcome?: TaskOutcome | null;
}

/** What the engine says about a report. */
export interface ReportVerdict {
  accepted: boolean;
  runId?: string;
  stepId?: string;
  reason?: string;
}

/** Engine tick cadence while any run is active. 700 ms is responsive enough for
 *  human-paced orchestration without a busy always-on timer. */
const TICK_MS = 700;

/** How long after dispatching an interactive step we wait for the agent to
 *  visibly go busy before assuming it already finished (a fast / hook-less agent
 *  whose activity we couldn't catch). Longer than the broadcast console's pickup
 *  grace, to reduce false "done" on a slow-to-start agent. */
const PICKUP_GRACE_MS = 6000;

// Max steps a single run runs concurrently (backpressure across the DAG) comes
// from the resource-mode policy: 4 on Balanced (the pre-mode constant), 2 on
// Efficient, and on Performance up to 6 — but only while the resource monitor
// measures real headroom (see `effectiveConcurrency` below).

/** How long an interactive step waits for its (busy) target agent to free up
 *  before it is force-dispatched anyway. Backpressure is a courtesy, not a gate —
 *  an agent whose busy signal is stuck/unreliable must not wedge the step forever
 *  (mirrors the broadcast console's `MAX_HOLD_MS`). */
const MAX_HOLD_MS = 12000;

/** How long a worker a coordinator started may sit idle before its task is
 *  completed on the hook signal alone. Its preamble asks for a report, and a
 *  CLI often ends a turn (its Stop hook fires) a moment before the tool call
 *  that carries it — completing on the first idle would take the coarse
 *  summary and refuse the real report as late. A worker that never reports
 *  (an agent without the tools) still completes, after this. */
const REPORT_GRACE_MS = 60_000;

/** Agent routing types uxnan registers the orchestration MCP tools with at launch
 *  (mirror of `mcpinject::AGENTS`). Only these can be nudged to call
 *  `orchestration_report_result`; for any other agent we never mention MCP, so a
 *  CLI is never told to use a tool it doesn't have. */
const INJECTABLE_MCP_TYPES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "opencode",
]);

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
  /** Interactive steps blocked on a busy target since (epoch ms, keyed
   *  `runId/stepId`) — gates the force-dispatch after `MAX_HOLD_MS`. Runtime-only. */
  private blockedSince = new Map<string, number>();
  /** Worker tasks seen idle since (epoch ms, keyed `runId/stepId`): the
   *  report grace clock. */
  private idleSince = new Map<string, number>();

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
    // Force any pending debounced write on window close (singleton — no unregister).
    registerFlush("orchestration-runs", () => this.flush());
    if (this.activeRuns.length > 0) {
      this.ensureTimer();
      this.tick();
    }
  }

  /** Take an agent's report. A `result` completes (or, per `outcome`, fails)
   *  the step it is for, with the agent's *structured* output (better than the
   *  coarse hook summary); a `progress` updates the step's live summary. The
   *  step is found by dispatch (a worker's report), else by task, else by the
   *  reporting agent's tab (a plain interactive step). */
  applyAgentReport(ev: AgentReport): ReportVerdict {
    for (const run of this.runs) {
      if (run.status !== "running" && run.status !== "paused") continue;
      let step: RunStep | undefined;
      if (ev.dispatchId) {
        step = run.steps.find((s) => s.dispatchId === ev.dispatchId);
        if (!step) {
          const task = ev.taskId ? run.steps.find((s) => s.id === ev.taskId) : undefined;
          if (task) {
            return {
              accepted: false,
              runId: run.id,
              stepId: task.id,
              reason: `dispatch ${ev.dispatchId} is stale: task ${task.id} is now on ${task.dispatchId ?? "no dispatch"}`,
            };
          }
          continue;
        }
      } else if (ev.taskId) {
        step = run.steps.find((s) => s.id === ev.taskId);
        if (!step) continue;
      } else {
        step = run.steps.find(
          (s) => s.status === "running" && s.kind === "interactive" && s.target.tabId === ev.agentId,
        );
        if (!step) continue;
      }
      if (step.status !== "running") {
        return {
          accepted: false,
          runId: run.id,
          stepId: step.id,
          reason: `task ${step.id} is ${step.status}, not running`,
        };
      }
      if (step.target.tabId && step.target.tabId !== ev.agentId) {
        return {
          accepted: false,
          runId: run.id,
          stepId: step.id,
          reason: `task ${step.id} runs in another terminal`,
        };
      }
      const now = Date.now();
      if (ev.type === "result") {
        const out = (ev.text ?? "").trim();
        step.outcome = ev.outcome ?? "success";
        if (step.outcome === "success") {
          step.status = "completed";
          step.output = out;
          step.summary = (ev.summary ?? "").trim() || firstLine(out);
          step.error = undefined;
          step.finishedAt = now;
        } else {
          step.output = out;
          step.summary = (ev.summary ?? "").trim() || firstLine(out);
          this.failStep(step, `${step.outcome}: ${(ev.summary ?? "").trim() || firstLine(out)}`, now);
        }
        this.sawBusy.delete(this.key(run.id, step.id));
        this.idleSince.delete(this.key(run.id, step.id));
        this.announce(run, step, now);
      } else {
        step.summary = (ev.text ?? "").trim();
        if (isDriven(run)) {
          this.post(run, { type: "status", stepId: step.id, dispatchId: step.dispatchId, text: step.summary }, now);
        }
      }
      this.changed();
      this.tick();
      return { accepted: true, runId: run.id, stepId: step.id };
    }
    return { accepted: false, reason: "no running task is waiting on this agent" };
  }

  // --- Driven runs (a coordinator agent at the console's seat) --------------

  /** Create a run a coordinator drives: running from the start, empty, and
   *  finished only by `finishRun`. `coordinator` is the driving agent's
   *  terminal id (absent when a person drives it from `uxnan-cli`). */
  createDriven(title: string, coordinator?: string): Run {
    const now = Date.now();
    const run: Run = {
      ...createRun(crypto.randomUUID(), title.trim() || "Driven run", now),
      status: "running",
      driven: coordinator ? { coordinator } : {},
      inbox: [],
      inboxSeq: 0,
    };
    this.runs = [...this.runs, run];
    this.ensureTimer();
    this.changed();
    return run;
  }

  /** End a driven run with the coordinator's verdict. Running workers keep
   *  their terminals; the run takes no more reports. */
  finishRun(runId: string, outcome: TaskOutcome, summary?: string): Run | undefined {
    const run = this.runById(runId);
    if (!run || !isDriven(run)) return undefined;
    run.driven = { ...run.driven, outcome, summary: (summary ?? "").trim() || undefined };
    run.status = outcome === "success" ? "completed" : "failed";
    run.updatedAt = Date.now();
    this.clearRuntimeFor(runId);
    this.changed();
    if (this.activeRuns.length === 0) this.stopTimer();
    return run;
  }

  /** Add a task to a driven run. Interactive by default (a worker started by
   *  the coordinator); headless when told, with the agent that runs it. */
  createTask(
    runId: string,
    spec: {
      title: string;
      prompt: string;
      dependsOn?: string[];
      kind?: "interactive" | "headless";
      agent?: string;
      worktree?: string;
      retry?: boolean;
    },
  ): RunStep | undefined {
    const run = this.runById(runId);
    if (!run || !isDriven(run) || run.status !== "running") return undefined;
    const kind = spec.kind === "headless" ? "headless" : "interactive";
    const stepId = this.addStepTo(runId, {
      title: spec.title,
      prompt: spec.prompt,
      dependsOn: (spec.dependsOn ?? []).filter((d) => run.steps.some((s) => s.id === d)),
      kind,
      target:
        kind === "headless"
          ? { agent: spec.agent ?? "", workspace: spec.worktree ?? "" }
          : { workspace: spec.worktree ?? "" },
      onFailure: spec.retry ? "retry" : "stop",
    });
    if (!stepId) return undefined;
    // Promote at once, so the coordinator reads `ready` back when it applies.
    this.tick();
    this.changed();
    return this.runById(runId)?.steps.find((s) => s.id === stepId);
  }

  /** Change a task the coordinator owns: its text while it has not started,
   *  or close it by hand with a status and an output. */
  updateTask(
    runId: string,
    taskId: string,
    patch: {
      title?: string;
      prompt?: string;
      dependsOn?: string[];
      status?: Extract<StepStatus, "completed" | "failed" | "skipped">;
      output?: string;
    },
  ): RunStep | undefined {
    const run = this.runById(runId);
    const step = run?.steps.find((s) => s.id === taskId);
    if (!run || !step || !isDriven(run)) return undefined;
    const now = Date.now();
    if (patch.title !== undefined) step.title = patch.title;
    if (patch.prompt !== undefined && !isStepTerminal(step.status) && step.status !== "running") {
      step.prompt = patch.prompt;
    }
    if (patch.dependsOn !== undefined && (step.status === "pending" || step.status === "ready")) {
      step.dependsOn = patch.dependsOn.filter((d) => d !== step.id && run.steps.some((s) => s.id === d));
      step.status = "pending";
    }
    if (patch.status) {
      step.status = patch.status;
      step.finishedAt = now;
      if (patch.output !== undefined) {
        step.output = patch.output;
        step.summary = firstLine(patch.output);
      }
      if (patch.status === "failed") step.error = patch.output ?? "closed as failed by the coordinator";
      else step.error = undefined;
      this.sawBusy.delete(this.key(run.id, step.id));
    }
    run.updatedAt = now;
    this.tick();
    this.changed();
    return step;
  }

  /** Bind a worker's terminal to a ready task, mint its dispatch and queue the
   *  preamble + resolved prompt into it (behind the same backpressure every
   *  first message takes). Returns the dispatch id, or why not. */
  startWorker(
    runId: string,
    taskId: string,
    terminal: { tabId: string; agentType: string; workspace: string },
  ): { dispatchId: string } | { error: string } {
    const run = this.runById(runId);
    const step = run?.steps.find((s) => s.id === taskId);
    if (!run || !step) return { error: `no task \`${taskId}\` in run \`${runId}\`` };
    if (!isDriven(run) || run.status !== "running") return { error: "the run is not a running driven run" };
    if (step.kind !== "interactive") return { error: `task ${taskId} is ${step.kind}; only an interactive task takes a worker` };
    if (step.status !== "ready" && step.status !== "blocked") {
      return { error: `task ${taskId} is ${step.status}, not ready` };
    }
    const now = Date.now();
    const { text } = resolveTemplate(step.prompt, stepsById(run));
    step.target = { tabId: terminal.tabId, agentType: terminal.agentType, workspace: terminal.workspace };
    step.status = "running";
    step.attempts += 1;
    step.dispatchId = dispatchIdFor(step);
    step.outcome = undefined;
    step.startedAt = now;
    step.error = undefined;
    this.sawBusy.delete(this.key(run.id, step.id));
    this.blockedSince.delete(this.key(run.id, step.id));
    const message = workerPreamble(
      { runId: run.id, taskId: step.id, dispatchId: step.dispatchId, title: step.title },
      text,
    );
    orchestration.send({ kind: "tabs", tabIds: [terminal.tabId] }, message);
    run.updatedAt = now;
    this.ensureTimer();
    this.changed();
    return { dispatchId: step.dispatchId };
  }

  /** The inbox of a driven run after dropping `ack`. */
  inbox(runId: string, ack: readonly string[] = []): { messages: InboxItem[]; acked: number } | undefined {
    const run = this.runById(runId);
    if (!run) return undefined;
    const before = run.inbox?.length ?? 0;
    if (ack.length > 0) {
      const next = ackInbox(run, ack);
      run.inbox = next.inbox;
      this.schedulePersist();
    }
    const messages = [...(run.inbox ?? [])];
    return { messages, acked: before - messages.length };
  }

  /** A worker asks: a gate step is filed on its run, addressed to the
   *  coordinator (or to the person, when the run has none), and reaches the
   *  inbox as a question. Returns the question id (the gate step's). */
  ask(fromTabId: string, question: string, options?: string[]): { runId: string; questionId: string } | { error: string } {
    for (const run of this.runs) {
      if (run.status !== "running" && run.status !== "paused") continue;
      const asker = run.steps.find(
        (s) => s.status === "running" && s.kind === "interactive" && s.target.tabId === fromTabId,
      );
      if (!asker) continue;
      const q = question.trim();
      const stepId = this.addStepTo(run.id, {
        title: firstLine(q),
        kind: "gate",
        gate: {
          question: q,
          options: options?.length ? options : undefined,
          resolver: isDriven(run) ? "coordinator" : "human",
          askedBy: { stepId: asker.id, dispatchId: asker.dispatchId },
        },
      });
      const fresh = this.runById(run.id);
      const gate = fresh?.steps.find((s) => s.id === stepId);
      if (!fresh || !gate || !stepId) return { error: "the question could not be filed" };
      const now = Date.now();
      this.dispatchGate(fresh, gate, now);
      if (isDriven(fresh)) {
        const text = options?.length ? `${q}\nOptions: ${options.join(" | ")}` : q;
        this.post(fresh, { type: "question", stepId, dispatchId: asker.dispatchId, text }, now);
      }
      this.changed();
      return { runId: fresh.id, questionId: stepId };
    }
    return { error: "this terminal is not a worker of any running task" };
  }

  /** Where a question stands. */
  question(questionId: string): { runId: string; answered: boolean; answer?: string; decision?: GateDecision } | undefined {
    for (const run of this.runs) {
      const gate = run.steps.find((s) => s.id === questionId && s.kind === "gate" && s.gate?.askedBy);
      if (!gate) continue;
      const decision = gate.gate?.decision;
      return {
        runId: run.id,
        answered: decision !== undefined,
        answer: decision !== undefined ? gate.gate?.note : undefined,
        decision,
      };
    }
    return undefined;
  }

  /** The coordinator (or the person, through the same gate) answers. */
  answer(runId: string, questionId: string, answer: string, decision: GateDecision = "approve"): boolean {
    const run = this.runById(runId);
    const gate = run?.steps.find((s) => s.id === questionId && s.kind === "gate");
    if (!run || !gate || gate.status !== "running") return false;
    this.resolveGate(runId, questionId, decision, answer);
    return true;
  }

  /** Post a message to a driven run's inbox. */
  private post(run: Run, item: Omit<InboxItem, "deliveryId" | "at">, now: number): void {
    const next = postInbox(run, item, now);
    run.inbox = next.inbox;
    run.inboxSeq = next.inboxSeq;
  }

  /** Tell the coordinator a task ended — once per dispatch, in driven runs only. */
  private announce(run: Run, step: RunStep, now: number): void {
    if (!isDriven(run) || step.kind === "gate") return;
    if (step.status === "completed") {
      const text = step.output || (step.outcome ? "" : "(the worker went idle without reporting; no output captured)");
      this.post(run, { type: "worker_done", stepId: step.id, dispatchId: step.dispatchId, text }, now);
    } else if (step.status === "failed") {
      this.post(run, { type: "worker_failed", stepId: step.id, dispatchId: step.dispatchId, text: step.error ?? "" }, now);
    } else if (step.status === "ready" && step.error) {
      // A retry policy put it back: the coordinator starts the next worker.
      this.post(
        run,
        { type: "status", stepId: step.id, dispatchId: step.dispatchId, text: `attempt ${step.attempts} failed (${step.error}); the task is ready again` },
        now,
      );
    }
  }

  /** A run changed in a way a waiting caller cares about: persist, and wake
   *  every `inbox/check --wait` / `question/ask` sleeping in the backend. */
  private changed(): void {
    this.schedulePersist();
    void invoke("control_notify").catch(() => {});
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

  /** Force the pending (debounced) runs write immediately — called on window
   *  close so a run edited within the debounce window isn't dropped. Cancels the
   *  timer and writes the current snapshot; a no-op before hydration. */
  async flush(): Promise<void> {
    if (!this.hydrated) return;
    clearTimeout(this.saveTimer);
    await setOrchestrationRuns($state.snapshot(this.runs) as SavedRun[]).catch(() => {});
  }

  // --- Authoring (drafts) --------------------------------------------------

  /** Create a fresh draft run and return it. */
  createDraft(title: string): Run {
    const run = createRun(crypto.randomUUID(), title.trim() || "Untitled run", Date.now());
    this.runs = [...this.runs, run];
    this.schedulePersist();
    return run;
  }

  /** Register a ready-made **example** run (built from a template) as a new draft,
   *  with the chosen headless `agent` + `workspace` planted into its steps. */
  createExampleRun(
    title: string,
    steps: ExampleStepSpec[],
    agent: string,
    workspace: string,
  ): Run {
    const run = buildExampleRun(crypto.randomUUID(), title, steps, {
      agent,
      workspace,
      now: Date.now(),
    });
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
    for (const k of this.blockedSince.keys()) if (k.startsWith(prefix)) this.blockedSince.delete(k);
    for (const k of this.idleSince.keys()) if (k.startsWith(prefix)) this.idleSince.delete(k);
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
    this.syncBudgetLease(false);
  }

  /** Whether this engine currently holds the resource monitor's budget lease. */
  private budgetLeaseHeld = false;

  /** Hold the monitor's `budget` lease exactly while extended concurrency is
   *  reachable (Performance profile + an active run): the headroom check needs
   *  fresh samples, and holding the lease any longer would keep the sampler
   *  running for a question nobody is asking. Idempotent per direction. */
  private syncBudgetLease(wanted: boolean): void {
    if (wanted === this.budgetLeaseHeld) return;
    this.budgetLeaseHeld = wanted;
    if (wanted) void resources.acquireBudget();
    else void resources.releaseBudget();
  }

  /** The per-tick concurrency cap from the resource-mode policy. The extended
   *  (Performance) ceiling applies only against measured headroom — a fresh
   *  budget-lease summary whose uxnan-total CPU is known and low; no evidence
   *  means the base cap. */
  /** How many agents may run at once under the resource policy right now —
   *  the same number the engine dispatches by, exposed for the control
   *  surface's launch budget (`$lib/control/bridge`). */
  get concurrencyCap(): number {
    return this.effectiveConcurrency(Date.now());
  }

  private effectiveConcurrency(now: number): number {
    const policy = resourceMode.policy;
    const extendable = policy.capabilities.orchestrationExtendedConcurrency !== null;
    this.syncBudgetLease(extendable && this.activeRuns.length > 0);
    return effectiveOrchestrationConcurrency(
      policy,
      extendable && orchestrationHeadroom(resources.summary, now),
    );
  }

  /** One scheduler pass over every active run: promote → detect completion →
   *  dispatch → derive status. Persists (debounced) only when something changed,
   *  and parks the timer once no run is active. */
  private tick(): void {
    let changed = false;
    const now = Date.now();
    const agents = this.liveAgents;
    const concurrency = this.effectiveConcurrency(now);

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
          this.announce(run, s, now);
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
        let budget = concurrency - runningCount;
        for (const s of run.steps) {
          if (budget <= 0) break;
          if (s.status !== "ready" && s.status !== "blocked") continue;
          const prev = s.status;
          if (s.kind === "interactive") {
            // In a driven run an interactive task is the coordinator's to start
            // (`worker/start`): it waits as `ready`, never auto-lands on an agent.
            if (isDriven(run)) continue;
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
      //    stays paused until resumed). A driven run ends when its coordinator
      //    finishes it, not when its DAG happens to be empty or all done.
      if (run.status === "running" && !isDriven(run)) {
        const derived = deriveRunStatus(run);
        if (derived !== "running") {
          run.status = derived;
          run.updatedAt = now;
          changed = true;
        }
      }
    }

    if (changed) this.changed();
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
   *  into a live agent (step → running); otherwise the step is `blocked` (no live
   *  target, or the agent is busy and hasn't waited past the hold cap) and will be
   *  retried next tick. */
  private dispatchInteractive(
    run: Run,
    step: RunStep,
    agents: OrchestratorAgent[],
    occupied: Set<string>,
    now: number,
  ): boolean {
    const k = this.key(run.id, step.id);
    const agent = this.resolveTarget(step, agents, occupied);
    if (!agent) {
      step.status = "blocked";
      this.blockedSince.delete(k); // no target at all — reset the busy clock
      return false;
    }
    if (agent.busy) {
      // Hold for a free agent, but not forever: force-dispatch once it has waited
      // past the cap (its busy signal may be stuck/unreliable).
      const since = this.blockedSince.get(k) ?? now;
      this.blockedSince.set(k, since);
      if (now - since < MAX_HOLD_MS) {
        step.status = "blocked";
        return false;
      }
    }
    this.blockedSince.delete(k);
    const { text } = resolveTemplate(step.prompt, stepsById(run));
    step.target.tabId = agent.tabId;
    step.status = "running";
    step.attempts += 1;
    step.dispatchId = dispatchIdFor(step);
    step.outcome = undefined;
    step.startedAt = now;
    step.error = undefined;
    this.sawBusy.delete(k);
    occupied.add(agent.tabId);
    const payload = this.withAutoReport(text, step, run, agent);
    // Paste + submit as a distinct Enter (see `pty_paste_submit`): no leftover text
    // in the composer, no concatenation, multi-line prompts stay intact. Best-effort:
    // a dead PTY drops the write (handled as failure next tick when the tab is gone).
    void invoke("pty_paste_submit", { id: agent.tabId, text: payload }).catch(() => {});
    return true;
  }

  /** Append a short "report your result via MCP" nudge to an interactive prompt —
   *  but only when it is genuinely useful *and* safe (question 2 + the MCP concern):
   *   · the step's output actually feeds a later step (don't touch non-chaining
   *     prompts), and
   *   · the target agent truly has the orchestration MCP tool — injection is on and
   *     the agent is one uxnan injects into (and not disabled).
   *  Otherwise the prompt is returned untouched, so a CLI is never told to use a
   *  tool it doesn't have. When it applies, a compliant agent's structured result
   *  is captured verbatim via `agent:orchestration` (see `applyAgentReport`),
   *  giving real A→B context even for an interactive step. */
  private withAutoReport(text: string, step: RunStep, run: Run, agent: OrchestratorAgent): string {
    const feedsLater = run.steps.some((s) => s.id !== step.id && s.dependsOn.includes(step.id));
    if (!feedsLater) return text;
    const br = app.settings.browser;
    if (!br || br.mcpEnabled === false) return text;
    if (!INJECTABLE_MCP_TYPES.has(agent.type)) return text;
    if ((br.mcpDisabledAgents ?? []).includes(agent.type)) return text;
    const nudge = i18n.t("orchestration.autoReportNudge", { id: agent.tabId });
    return `${text}\n\n${nudge}`;
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
    step.dispatchId = dispatchIdFor(step);
    step.outcome = undefined;
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
    this.announce(run, step, now);
    this.changed();
    this.tick();
  }

  /** Dispatch a gate step: park it in `running` (awaiting a human decision) and
   *  fire a one-shot "needs you" native notification. It stays `running` until
   *  `resolveGate` is called — the run's other independent branches keep going. */
  private dispatchGate(run: Run, step: RunStep, now: number): void {
    step.status = "running";
    step.startedAt = now;
    const k = this.key(run.id, step.id);
    // A worker's question to its coordinator is the coordinator's to answer;
    // the person still sees it in the console, without a notification.
    if (step.gate?.resolver === "coordinator") return;
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
    step.gate = { ...step.gate, question: step.gate?.question ?? step.title, decision, note: text };
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
    this.changed();
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
      this.idleSince.delete(k);
      return false;
    }

    const elapsed = now - (step.startedAt ?? now);
    if (this.sawBusy.has(k) || elapsed > PICKUP_GRACE_MS) {
      // A coordinator's worker is expected to report; give its report the
      // grace to arrive before the idle signal alone closes the task.
      if (isDriven(run) && step.dispatchId) {
        const since = this.idleSince.get(k) ?? now;
        this.idleSince.set(k, since);
        if (now - since < REPORT_GRACE_MS) return false;
      }
      const summary = (live?.summary ?? "").trim();
      step.status = "completed";
      step.output = summary;
      step.summary = summary;
      step.error = undefined;
      step.finishedAt = now;
      this.sawBusy.delete(k);
      this.idleSince.delete(k);
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
