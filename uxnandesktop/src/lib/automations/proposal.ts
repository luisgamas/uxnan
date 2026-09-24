// Turning an agent's proposal into a draft the editor can show.
//
// `automation/propose` (the control surface) hands the window a description of
// an automation; this builds the `Automation` the editor opens on. Nothing is
// saved here and nothing is scheduled: the person reads the draft, changes what
// they want and presses Save — and the draft arrives **paused**, so even Save
// does not start it running.
//
// Pure on purpose, and strict on purpose. The backend already checked the
// cheap shape; what is left needs what only the window knows — which agents are
// installed here — and a bad reference is worth an error the agent can act on
// ("no agent `gpt` is installed; installed: claude, codex") rather than a draft
// that silently does something else.

import {
  defaultPolicy,
  newStep,
  type Automation,
  type Schedule,
  type Step,
  type TimeUnit,
} from "./types";

/** What the control surface sends. Unknown fields are ignored. */
export interface ProposedAutomation {
  name?: unknown;
  workingDir?: unknown;
  description?: unknown;
  tags?: unknown;
  steps?: unknown;
  schedule?: unknown;
  worktreePerRun?: unknown;
}

/** What the editor opens on, plus who asked for it. */
export interface Proposal {
  automation: Automation;
  /** The agent's name, or its terminal id, or null when a shell proposed it. */
  from: string | null;
}

const UNITS: TimeUnit[] = ["minutes", "hours", "days", "weeks"];

/** The default cadence of a draft: a person sets the real one. Deliberately not
 *  "every 5 minutes" — a proposal should never read as urgent by default. */
const DEFAULT_SCHEDULE: Schedule = { kind: "dailyAt", hour: 9, minute: 0 };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The schedule a proposal asked for, or the default. A cadence that does not
 *  parse falls back rather than failing: the person is about to see it in the
 *  picker anyway, and refusing the whole draft over a malformed hour would
 *  throw away the part that took the work. */
export function scheduleFrom(value: unknown): Schedule {
  if (!value || typeof value !== "object") return DEFAULT_SCHEDULE;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "every": {
      const unit = UNITS.includes(v.unit as TimeUnit) ? (v.unit as TimeUnit) : "hours";
      return { kind: "every", n: clamp(int(v.n, 1), 1, 999), unit, startsAt: 0 };
    }
    case "dailyAt":
      return { kind: "dailyAt", hour: clamp(int(v.hour, 9), 0, 23), minute: clamp(int(v.minute, 0), 0, 59) };
    case "weekdaysAt":
      return { kind: "weekdaysAt", hour: clamp(int(v.hour, 9), 0, 23), minute: clamp(int(v.minute, 0), 0, 59) };
    case "weeklyAt":
      return {
        kind: "weeklyAt",
        day: clamp(int(v.day, 1), 0, 6),
        hour: clamp(int(v.hour, 9), 0, 23),
        minute: clamp(int(v.minute, 0), 0, 59),
      };
    default:
      return DEFAULT_SCHEDULE;
  }
}

/** Build the draft, or throw the sentence the agent reads.
 *
 *  `installed` is the agent ids this machine has (`ai_commit_agents`); `id`
 *  mints the automation's id. */
export function buildProposal(
  params: ProposedAutomation,
  installed: string[],
  id: () => string,
): Automation {
  const name = str(params.name);
  const workingDir = str(params.workingDir);
  const raw = Array.isArray(params.steps) ? params.steps : [];
  if (!name) throw new Error("a proposed automation needs a name");
  if (!workingDir) throw new Error("a proposed automation needs a working folder");
  if (raw.length === 0) throw new Error("a proposed automation needs at least one step");

  // Ids first, so `dependsOn` can be checked against the whole set — a step may
  // depend on one declared after it.
  const ids = raw.map((s, i) => str((s as Record<string, unknown>).id) || `s${i + 1}`);
  const seen = new Set<string>();
  for (const stepId of ids) {
    if (seen.has(stepId)) throw new Error(`two steps share the id \`${stepId}\``);
    seen.add(stepId);
  }

  const steps: Step[] = raw.map((value, i) => {
    const s = value as Record<string, unknown>;
    const agent = str(s.agent);
    if (!installed.includes(agent)) {
      throw new Error(
        `no agent \`${agent}\` is installed on this machine; installed: ${
          installed.join(", ") || "none"
        }`,
      );
    }
    const prompt = str(s.prompt);
    if (!prompt) throw new Error(`step \`${ids[i]}\` has no prompt`);
    const dependsOn = Array.isArray(s.dependsOn) ? s.dependsOn.map(str).filter(Boolean) : [];
    for (const dep of dependsOn) {
      if (dep === ids[i]) throw new Error(`step \`${ids[i]}\` depends on itself`);
      if (!seen.has(dep)) {
        throw new Error(`step \`${ids[i]}\` depends on \`${dep}\`, which is not a step here`);
      }
    }
    return {
      ...newStep(ids[i], agent),
      title: str(s.title) || `${i + 1}`,
      model: str(s.model),
      prompt,
      dependsOn,
      autonomous: s.autonomous === true,
    };
  });

  return {
    id: id(),
    name,
    description: str(params.description),
    icon: null,
    // Paused, always. A proposal the person saves must not start firing because
    // they pressed Save to keep reading it — enabling is its own decision, one
    // switch away in the list.
    enabled: false,
    tags: Array.isArray(params.tags) ? params.tags.map(str).filter(Boolean) : [],
    workingDir,
    worktreePerRun: params.worktreePerRun === true,
    baseBranch: null,
    schedule: scheduleFrom(params.schedule),
    policy: defaultPolicy(),
    steps,
    createdAt: 0,
    updatedAt: 0,
  };
}
