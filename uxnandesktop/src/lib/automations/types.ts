// Automations — the wire shapes, mirroring `src-tauri/src/automations/mod.rs`.
// Keep both sides in lockstep: the backend serializes camelCase, so these are
// the exact field names crossing the command boundary.
//
// An automation is an unattended, **recurring** task that runs in its own
// working folder — never bound to the selected project — and drives a graph of
// agent steps. Spec: `architecture/02f-automations.md`.

/** Unit of an `every` interval. */
export type TimeUnit = "minutes" | "hours" | "days" | "weeks";

/** How often an automation repeats. There is no one-shot variant on purpose:
 *  an automation is recurring by definition, and a single ad-hoc run belongs to
 *  the normal three-panel workflow. */
export type Schedule =
  | { kind: "every"; n: number; unit: TimeUnit; startsAt: number }
  | { kind: "dailyAt"; hour: number; minute: number }
  | { kind: "weekdaysAt"; hour: number; minute: number }
  | { kind: "weeklyAt"; day: number; hour: number; minute: number };

/** Smallest interval the backend accepts (seconds). */
export const MIN_INTERVAL_SECONDS = 60;

/** What to do when a run starts while the previous one is still going. */
export type Overlap = "skip" | "queue" | "cancelPrevious";

/** Which outcomes raise a native notification. */
export type NotifyOn = "completed" | "failed";

/** A shell command gating the run: exit 0 = proceed. */
export interface Precondition {
  command: string;
  timeoutSeconds: number;
}

export interface Policy {
  /** Recover a run whose moment passed while the machine was off. */
  catchUp: boolean;
  overlap: Overlap;
  precondition?: Precondition | null;
  maxRunMinutes: number;
  /** How many past runs to keep before the oldest are pruned. */
  keepRuns: number;
  notifyOn: NotifyOn[];
}

export type OnFailure = "stop" | "retry";

/** One node of the graph: a headless agent run. */
export interface Step {
  /** Short id, unique within the automation (`s1`, `s2`, …). */
  id: string;
  title: string;
  agent: string;
  /** Empty means the CLI's own default model. */
  model: string;
  prompt: string;
  /** Parallel and fan-in both fall out of this list alone. */
  dependsOn: string[];
  onFailure: OnFailure;
  maxAttempts: number;
  timeoutMs?: number | null;
  /** Let this step's agent approve its own tool use.
   *
   *  Off by default and set per step on purpose. A headless agent cannot ask a
   *  human, so with tools involved several CLIs auto-deny and come back with
   *  nothing — Antigravity says so outright. A step that must actually change
   *  something needs this; a step that only reads and reports should not have
   *  it, because it lets an agent edit files and run commands unattended. */
  autonomous: boolean;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  icon?: string | null;
  enabled: boolean;
  /** Free-form labels — the "task type" the list groups and filters by. */
  tags: string[];
  /** Any folder, repo or not. Deliberately independent of the sidebar. */
  workingDir: string;
  worktreePerRun: boolean;
  baseBranch?: string | null;
  schedule: Schedule;
  policy: Policy;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export type RunTrigger = "scheduled" | "manual";

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "skippedPrecondition"
  | "skippedOverlap"
  | "skippedUnavailable";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PreconditionResult {
  command: string;
  exitCode?: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** What one step did — verbose on purpose, because this is the only account of
 *  an execution nobody watched. */
export interface StepRun {
  id: string;
  title: string;
  agent: string;
  model: string;
  dependsOn: string[];
  status: StepStatus;
  /** The prompt **as actually sent**, after substitution. */
  prompt: string;
  /** References that resolved to nothing (a thin hand-off). */
  missingRefs: string[];
  output: string;
  stderr: string;
  /** The verified completion signal: 0 = done. */
  exitCode?: number | null;
  attempts: number;
  error?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  /** Snapshotted, so history stays readable after a rename or delete. */
  automationName: string;
  trigger: RunTrigger;
  status: RunStatus;
  workingDir: string;
  worktreePath?: string | null;
  startedAt: number;
  finishedAt?: number | null;
  precondition?: PreconditionResult | null;
  steps: StepRun[];
  error?: string | null;
}

/** What the OS scheduler thinks of an automation. `failed` carries the OS's own
 *  message so the UI can show what actually went wrong. */
export type SchedulerStatus =
  | { kind: "registered" }
  | { kind: "absent" }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string };

/** Result of saving: the stored record plus the resulting scheduler state, so
 *  the UI shows the truth instead of assuming the registration worked. */
export interface SaveResult {
  automation: Automation;
  scheduler: SchedulerStatus;
}

/** Defaults for a brand-new automation. Conservative on purpose: recover missed
 *  runs, never pile up concurrent runs, and only shout when something failed. */
export function defaultPolicy(): Policy {
  return {
    catchUp: true,
    overlap: "skip",
    precondition: null,
    maxRunMinutes: 60,
    keepRuns: 30,
    notifyOn: ["failed"],
  };
}

/** A fresh step with the id the caller mints. */
export function newStep(id: string, agent = ""): Step {
  return {
    id,
    title: "",
    agent,
    model: "",
    prompt: "",
    dependsOn: [],
    onFailure: "stop",
    maxAttempts: 1,
    autonomous: false,
  };
}

/** The next free `s<n>` id for a step list (never reuses a deleted one, so a
 *  `{{steps.sN.output}}` reference can't silently point at a different step). */
export function nextStepId(steps: Step[]): string {
  let max = 0;
  for (const s of steps) {
    const m = /^s(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s${max + 1}`;
}

/** A fresh automation, ready for the editor. */
export function newAutomation(id: string, name: string, workingDir = ""): Automation {
  return {
    id,
    name,
    description: "",
    icon: null,
    enabled: true,
    tags: [],
    workingDir,
    worktreePerRun: false,
    baseBranch: null,
    schedule: { kind: "dailyAt", hour: 9, minute: 0 },
    policy: defaultPolicy(),
    steps: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
