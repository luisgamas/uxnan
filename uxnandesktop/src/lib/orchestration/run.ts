// Pure orchestration-run logic — the deterministic core of the "run engine"
// (spec `02d` §3). A **run** is a DAG of **steps**; each step targets an agent,
// declares dependencies, carries a templated prompt, and holds its own state +
// captured output. This module has **no** Svelte/Tauri deps so it is fully
// unit-testable: DAG readiness (deps → ready / skipped), context-template
// substitution, cycle detection, validation, and run-status derivation.
//
// The reactive engine in `state/orchestrationRun.svelte.ts` layers live agent
// state, dispatch (PTY / headless), timers and persistence on top of these
// functions. Kept self-contained (it imports nothing from `$lib/types`) so
// `types.ts` can re-export `SavedRun` without an import cycle.

/** Lifecycle of a whole run. `draft` = still being edited; `running` = the
 *  engine is advancing it; `paused` = held by the user (or a pending gate);
 *  `completed`/`failed`/`cancelled` are terminal. */
export type RunStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Lifecycle of one step. Non-terminal: `pending` (deps unmet), `ready`
 *  (dispatchable), `running` (dispatched, awaiting completion), `blocked`
 *  (ready but no live target / agent busy right now — the engine keeps
 *  retrying). Terminal: `completed`, `failed`, `skipped` (a dependency failed
 *  or was skipped, so this can never run). */
export type StepStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "skipped";

/** What a step does. `interactive` types the prompt into a live agent's PTY (as
 *  the broadcast console does) and reads its coarse hook `summary` as output.
 *  `headless` (Stage 2) runs the agent in print-mode, capturing full stdout +
 *  a verified exit code. `gate` (Stage 3) pauses for a human decision. */
export type StepKind = "interactive" | "headless" | "gate";

/** What to do when a step fails. `stop` fails the run; `retry` re-runs the step
 *  up to `maxAttempts` (auto-repair — Stage 3 adds `remediate`). */
export type OnFailure = "stop" | "retry";

/** How a gate step resolves (Stage 3). */
export type GateDecision = "approve" | "reject";

/** Where a step is dispatched. Interactive: a live agent tab (`tabId`), re-bound
 *  after a restart via `agentType` (+ `workspace`) when the exact tab is gone.
 *  Headless: an `agent` id + `model` run in `workspace`. */
export interface StepTarget {
  /** interactive: the live agent tab (PTY id) to type into. A live pointer that
   *  can go stale across a restart — see `agentType`/`workspace`. */
  tabId?: string;
  /** interactive: the agent command/type (`claude`, `codex`, …), used to
   *  re-bind to a live agent of the same type after a restart, and for display. */
  agentType?: string;
  /** The workspace (worktree path, or "" for Global) the step runs in. */
  workspace?: string;
  /** headless (Stage 2): the agent id to run in print-mode. */
  agent?: string;
  /** headless (Stage 2): the model id (empty = the CLI's default model). */
  model?: string;
}

/** A gate step's human-in-the-loop question + resolution (Stage 3). */
export interface GateSpec {
  /** The question shown to the user. */
  question: string;
  /** The user's decision, once made (undefined = still waiting). */
  decision?: GateDecision;
  /** Optional note/edit the user attached when resolving (feeds later steps). */
  note?: string;
}

/** One node in a run's DAG. */
export interface RunStep {
  /** Short id, unique **within the run** (`s1`, `s2`, …), so it reads cleanly in
   *  a `{{steps.s1.output}}` template and in the dependency list. */
  id: string;
  title: string;
  kind: StepKind;
  target: StepTarget;
  /** Prompt template; may reference prior steps' outputs (see `resolveTemplate`). */
  prompt: string;
  /** Ids of steps that must be `completed` before this one is `ready`. */
  dependsOn: string[];
  status: StepStatus;
  /** Captured output (headless: full stdout; interactive: the hook `summary`). */
  output?: string;
  /** Short preview/summary of the output (interactive `done` summary). */
  summary?: string;
  /** Process exit code (headless only; verified completion). */
  exitCode?: number;
  /** Failure detail, if the step failed. */
  error?: string;
  /** How many times this step has been dispatched (for retry limiting). */
  attempts: number;
  /** Max dispatch attempts before the step is terminally `failed`. */
  maxAttempts: number;
  onFailure: OnFailure;
  /** HITL gate spec (kind === "gate"). */
  gate?: GateSpec;
  /** When the current attempt was dispatched (epoch ms). */
  startedAt?: number;
  /** When the step reached a terminal state (epoch ms). */
  finishedAt?: number;
}

/** A whole run: a DAG of steps plus its lifecycle + a monotonic step-id counter. */
export interface Run {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  /** Monotonic counter backing `s1`, `s2`, … step ids (never reused, so a
   *  deleted step's id can't collide with a later one). */
  seq: number;
  steps: RunStep[];
}

/** The persisted shape is just the plain `Run` data (re-exported by `$lib/types`). */
export type SavedRun = Run;

/** Terminal step statuses (no further work will change them). */
const TERMINAL_STEP: ReadonlySet<StepStatus> = new Set([
  "completed",
  "failed",
  "skipped",
]);

/** Whether a step status is terminal. */
export function isStepTerminal(status: StepStatus): boolean {
  return TERMINAL_STEP.has(status);
}

/** Whether a run status is terminal. */
export function isRunTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Index a run's steps by id for O(1) dependency lookups. */
export function stepsById(run: Run): Record<string, RunStep> {
  const out: Record<string, RunStep> = {};
  for (const s of run.steps) out[s.id] = s;
  return out;
}

/** The status a **pending** step should advance to, given its dependencies:
 *  `skipped` if any dependency failed or was skipped (it can never run),
 *  `ready` once every dependency is `completed`, else `null` (stay pending).
 *  Roots (no deps) go straight to `ready`. Only pending steps advance here, so a
 *  dependent is always still pending when a dependency fails — no lost edges. */
export function nextStatusForPending(
  step: RunStep,
  byId: Record<string, RunStep>,
): StepStatus | null {
  if (step.status !== "pending") return null;
  const deps = step.dependsOn.map((id) => byId[id]).filter(Boolean);
  if (deps.some((d) => d.status === "failed" || d.status === "skipped")) {
    return "skipped";
  }
  if (deps.every((d) => d.status === "completed")) return "ready";
  return null;
}

/** Derive the natural status of an in-flight run from its steps: `running` while
 *  any step is still non-terminal; otherwise `failed` if any step failed, else
 *  `completed`. (User-set `paused`/`cancelled` are handled by the engine, not
 *  here.) An empty run derives to `completed`. */
export function deriveRunStatus(run: Run): RunStatus {
  if (run.steps.some((s) => !isStepTerminal(s.status))) return "running";
  if (run.steps.some((s) => s.status === "failed")) return "failed";
  return "completed";
}

/** Steps currently dispatchable (status `ready`). */
export function readySteps(run: Run): RunStep[] {
  return run.steps.filter((s) => s.status === "ready");
}

/** True if the run has a dependency cycle (which would deadlock the engine).
 *  DFS with a recursion stack over the `dependsOn` edges. Unknown dep ids are
 *  ignored here (they're caught by `validateRun`). */
export function hasCycle(steps: RunStep[]): boolean {
  const byId: Record<string, RunStep> = {};
  for (const s of steps) byId[s.id] = s;
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited,1=in-stack,2=done

  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 1) return true; // back-edge → cycle
    if (st === 2) return false;
    state.set(id, 1);
    const step = byId[id];
    if (step) {
      for (const dep of step.dependsOn) {
        if (byId[dep] && visit(dep)) return true;
      }
    }
    state.set(id, 2);
    return false;
  };

  return steps.some((s) => visit(s.id));
}

/** Validation errors for a run (empty = valid). Checks: at least one step, no
 *  self-dependency, every `dependsOn` id exists, and no cycle. Missing template
 *  references are a soft warning (see `resolveTemplate`), not a hard error. */
export function validateRun(run: Run): string[] {
  const errors: string[] = [];
  if (run.steps.length === 0) {
    errors.push("A run needs at least one step.");
    return errors;
  }
  const ids = new Set(run.steps.map((s) => s.id));
  for (const s of run.steps) {
    for (const dep of s.dependsOn) {
      if (dep === s.id) errors.push(`Step "${s.title || s.id}" depends on itself.`);
      else if (!ids.has(dep)) {
        errors.push(`Step "${s.title || s.id}" depends on a missing step (${dep}).`);
      }
    }
  }
  if (hasCycle(run.steps)) errors.push("The steps form a dependency cycle.");
  return errors;
}

/** Result of resolving a prompt template. */
export interface TemplateResolution {
  /** The prompt with every `{{steps.<id>.<field>}}` reference substituted. */
  text: string;
  /** References whose step/field had no value yet (substituted with ""). */
  missing: string[];
}

/** Matches `{{steps.<id>.output|summary|title}}` with optional inner spaces. */
const TEMPLATE_RE = /\{\{\s*steps\.([A-Za-z0-9_-]+)\.(output|summary|title)\s*\}\}/g;

/** Substitute prior-step references in a prompt. `{{steps.s1.output}}` →
 *  step `s1`'s captured output, `.summary` → its short summary, `.title` → its
 *  title. An unknown step or an as-yet-empty value resolves to "" and is
 *  recorded in `missing` (so the engine can note a thin/absent hand-off — real
 *  for interactive steps whose only output is the coarse hook summary). */
export function resolveTemplate(
  prompt: string,
  byId: Record<string, RunStep>,
): TemplateResolution {
  const missing: string[] = [];
  const text = prompt.replace(TEMPLATE_RE, (_m, id: string, field: string) => {
    const step = byId[id];
    let value: string | undefined;
    if (step) {
      if (field === "output") value = step.output;
      else if (field === "summary") value = step.summary ?? step.output;
      else value = step.title;
    }
    if (value === undefined || value === "") {
      missing.push(`${id}.${field}`);
      return "";
    }
    return value;
  });
  return { text, missing };
}

/** The step ids a prompt references (deduped, in first-seen order) — used by the
 *  builder to auto-suggest dependencies for a step from its own template. */
export function referencedStepIds(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(TEMPLATE_RE)) {
    const id = m[1];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** A fresh, empty run in `draft` status. */
export function createRun(id: string, title: string, now: number): Run {
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    seq: 0,
    steps: [],
  };
}

/** Default per-step fields, so callers only specify what differs. */
export function newStep(id: string, partial: Partial<RunStep>): RunStep {
  return {
    id,
    title: partial.title ?? "",
    kind: partial.kind ?? "interactive",
    target: partial.target ?? {},
    prompt: partial.prompt ?? "",
    dependsOn: partial.dependsOn ?? [],
    status: "pending",
    attempts: 0,
    maxAttempts: partial.maxAttempts ?? (partial.onFailure === "retry" ? 2 : 1),
    onFailure: partial.onFailure ?? "stop",
    gate: partial.gate,
  };
}

/** Append a step to a run, minting the next `s<n>` id (pure — bumps `seq`).
 *  Returns the new run and the created step's id. */
export function addStep(
  run: Run,
  partial: Partial<RunStep>,
): { run: Run; stepId: string } {
  const seq = run.seq + 1;
  const stepId = `s${seq}`;
  const step = newStep(stepId, partial);
  return {
    run: { ...run, seq, steps: [...run.steps, step] },
    stepId,
  };
}
