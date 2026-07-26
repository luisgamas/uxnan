// Pure display helpers for the Automations screen — grouping, labels, status
// tones. No Svelte, no Tauri, so the logic the list depends on is unit-tested
// instead of eyeballed.

import type { MessageKey } from "$lib/i18n/locales/en";
import type {
  Automation,
  AutomationRun,
  RunStatus,
  Schedule,
  SchedulerStatus,
  StepStatus,
} from "./types";

/** How the list is grouped. These are the facets a user actually thinks in:
 *  "which agent does this", "what kind of task is it", "how often does it run",
 *  "where does it run", "is it healthy". */
export type GroupBy = "agent" | "tag" | "frequency" | "folder" | "status";

export const GROUP_BY_OPTIONS: { value: GroupBy; labelKey: MessageKey }[] = [
  { value: "agent", labelKey: "automations.groupAgent" },
  { value: "tag", labelKey: "automations.groupTag" },
  { value: "frequency", labelKey: "automations.groupFrequency" },
  { value: "folder", labelKey: "automations.groupFolder" },
  { value: "status", labelKey: "automations.groupStatus" },
];

/** The distinct agents an automation drives, in first-seen order — what the
 *  list renders as a stack of logos, because an automation is rarely one agent. */
export function agentsOf(automation: Automation): string[] {
  const out: string[] = [];
  for (const s of automation.steps) {
    const id = s.agent.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The agent that leads an automation: the first step with no dependencies,
 *  falling back to the first step. This is the "main agent" the list groups by. */
export function primaryAgent(automation: Automation): string {
  const root = automation.steps.find((s) => s.dependsOn.length === 0) ?? automation.steps[0];
  return root?.agent.trim() ?? "";
}

/** A coarse recurrence bucket, so "every 15 minutes" and "every 30 minutes"
 *  group together instead of each forming a group of one. */
export function frequencyBucket(schedule: Schedule): MessageKey {
  if (schedule.kind !== "every") {
    return schedule.kind === "dailyAt"
      ? "automations.freqDaily"
      : schedule.kind === "weekdaysAt"
        ? "automations.freqWeekdays"
        : "automations.freqWeekly";
  }
  switch (schedule.unit) {
    case "minutes":
      return "automations.freqMinutes";
    case "hours":
      return "automations.freqHours";
    case "days":
      return "automations.freqDaily";
    default:
      return "automations.freqWeekly";
  }
}

/** The last segment of a path, for a compact folder label. Handles both
 *  separators, since a Windows user can type either. */
export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** One group of the list. */
export interface Group {
  /** Stable key for `{#each}`. */
  key: string;
  /** Ready-to-render label, or a message key the caller localizes. */
  label: string;
  labelKey?: MessageKey;
  items: Automation[];
}

/** Group automations by a facet. Groups come back sorted by label, with the
 *  "none" bucket last, and automations inside a group sorted by name — so the
 *  list never reshuffles just because something was saved. */
export function groupAutomations(
  automations: Automation[],
  by: GroupBy,
  opts: { unassignedKey: string } = { unassignedKey: "—" },
): Group[] {
  const buckets = new Map<string, { label: string; labelKey?: MessageKey; items: Automation[] }>();

  const push = (key: string, label: string, item: Automation, labelKey?: MessageKey) => {
    const bucket = buckets.get(key) ?? { label, labelKey, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  };

  for (const a of automations) {
    switch (by) {
      case "agent": {
        const agent = primaryAgent(a);
        push(agent || opts.unassignedKey, agent || opts.unassignedKey, a);
        break;
      }
      case "tag": {
        if (a.tags.length === 0) {
          push(opts.unassignedKey, opts.unassignedKey, a);
        } else {
          // An automation with several tags belongs to each of them.
          for (const tag of a.tags) push(tag, tag, a);
        }
        break;
      }
      case "frequency": {
        const key = frequencyBucket(a.schedule);
        push(key, key, a, key);
        break;
      }
      case "folder": {
        const label = folderLabel(a.workingDir) || opts.unassignedKey;
        push(a.workingDir || opts.unassignedKey, label, a);
        break;
      }
      case "status": {
        const key = a.enabled ? "automations.statusEnabled" : "automations.statusPaused";
        push(key, key, a, key as MessageKey);
        break;
      }
    }
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, labelKey: b.labelKey, items: sortByName(b.items) }))
    .sort((a, b) => {
      // The catch-all bucket always sinks to the bottom.
      if (a.key === opts.unassignedKey) return 1;
      if (b.key === opts.unassignedKey) return -1;
      return a.label.localeCompare(b.label);
    });
}

function sortByName(items: Automation[]): Automation[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/** Filter by a free-text query across the fields a user would search: name,
 *  description, tags, folder and the agents involved. */
export function filterAutomations(automations: Automation[], query: string): Automation[] {
  const q = query.trim().toLowerCase();
  if (!q) return automations;
  return automations.filter((a) => {
    const haystack = [
      a.name,
      a.description,
      a.workingDir,
      ...a.tags,
      ...agentsOf(a),
      ...a.steps.map((s) => s.title),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** Tailwind class for a run-status dot. Only a genuine failure is red: a
 *  *skipped* run is the policy working as intended, not a problem. */
export function runStatusDot(status: RunStatus): string {
  switch (status) {
    case "running":
      return "bg-sky-500 animate-pulse";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

export function runStatusLabelKey(status: RunStatus): MessageKey {
  switch (status) {
    case "running":
      return "automations.runRunning";
    case "completed":
      return "automations.runCompleted";
    case "failed":
      return "automations.runFailed";
    case "skippedPrecondition":
      return "automations.runSkippedPrecondition";
    case "skippedOverlap":
      return "automations.runSkippedOverlap";
    default:
      return "automations.runSkippedUnavailable";
  }
}

export function stepStatusDot(status: StepStatus): string {
  switch (status) {
    case "running":
      return "bg-sky-500 animate-pulse";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "skipped":
      return "bg-amber-500/60";
    default:
      return "bg-muted-foreground/40";
  }
}

export function stepStatusLabelKey(status: StepStatus): MessageKey {
  switch (status) {
    case "pending":
      return "automations.stepPending";
    case "running":
      return "automations.stepRunning";
    case "completed":
      return "automations.stepCompleted";
    case "failed":
      return "automations.stepFailed";
    default:
      return "automations.stepSkipped";
  }
}

/** How many of a run's steps have finished, for a compact progress label. */
export function runProgress(run: AutomationRun): { done: number; total: number } {
  return {
    done: run.steps.filter((s) => s.status === "completed").length,
    total: run.steps.length,
  };
}

/** Whether a scheduler status means "this will fire with the app closed".
 *  Everything else needs the UI to say so out loud. */
export function isScheduled(status: SchedulerStatus | undefined): boolean {
  return status?.kind === "registered";
}

/** The message key explaining a scheduler status. `failed` is deliberately not
 *  covered here: it carries the OS's own text, which must be shown verbatim
 *  rather than replaced by a friendlier lie. */
export function schedulerLabelKey(status: SchedulerStatus | undefined): MessageKey {
  switch (status?.kind) {
    case "registered":
      return "automations.schedRegistered";
    case "unsupported":
      return "automations.schedUnsupported";
    case "failed":
      return "automations.schedFailed";
    default:
      return "automations.schedAbsent";
  }
}

/** The message key explaining a scheduler status in more depth (the tooltip).
 *  A `failed` status has no canned explanation — it carries the OS's own text. */
export function schedulerTipKey(status: SchedulerStatus | undefined): MessageKey {
  switch (status?.kind) {
    case "registered":
      return "automations.schedRegisteredTip";
    case "unsupported":
      return "automations.schedUnsupportedTip";
    case "failed":
      return "automations.schedFailedTip";
    default:
      return "automations.schedAbsentTip";
  }
}

/** Duration of a run in milliseconds, or null while it is still going. */
export function runDuration(run: AutomationRun): number | null {
  return run.finishedAt ? run.finishedAt - run.startedAt : null;
}
