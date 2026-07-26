// The example automations uxnan ships with.
//
// They exist for two reasons, and the second is the one that shapes them: they
// teach the model of the feature by being *readable*, and they give the screen
// something real to show. An empty Automations list makes the overview, the
// list, the detail and the history all look like dead ends.
//
// Every one is **multi-agent** on purpose — a single agent on a timer is the
// thing this feature is not — and every one is created **paused**, so nothing
// an example does can surprise the user. They are ordinary automations after
// that: editable, runnable, deletable.
//
// Pure and data-only, so both the first-run seeding and the Templates section
// build from the same definitions instead of drifting apart.

import type { MessageKey } from "$lib/i18n/locales/en";
import { defaultPolicy, newStep, type Automation, type Schedule, type Step } from "./types";

/** One step of an example, before an agent is assigned. */
interface ExampleStep {
  titleKey: MessageKey;
  promptKey: MessageKey;
  /** Indices into the example's own step list. */
  dependsOn?: number[];
  /** Which distinct installed agent to use (see `assignAgents`). */
  agentSlot: number;
  /** Steps that only read and report never need to approve their own tools. */
  autonomous?: boolean;
}

export interface ExampleSpec {
  /** Stable id, so a re-add replaces rather than duplicates. */
  id: string;
  nameKey: MessageKey;
  descKey: MessageKey;
  /** Free-form label, doubling as the "task type" the list groups by. */
  tagKey: MessageKey;
  schedule: Schedule;
  /** Shell command gating the run, when the example is about that. */
  preconditionKey?: MessageKey;
  steps: ExampleStep[];
}

/** The shipped examples, in the order they are seeded and listed.
 *
 *  Between them they cover every idea a user needs to have seen: parallel work
 *  feeding one consolidating agent, the same question answered by different
 *  providers, a run that continues the previous run, and a cheap shell check
 *  that decides whether spending an agent turn is worth it at all. */
export const EXAMPLES: ExampleSpec[] = [
  {
    id: "example-fan-in",
    nameKey: "automations.tplFanInTitle",
    descKey: "automations.tplFanInDesc",
    tagKey: "automations.exTagReview",
    // Early, so it is done before the working day starts.
    schedule: { kind: "dailyAt", hour: 3, minute: 0 },
    steps: [
      { titleKey: "automations.tplFanInS1", promptKey: "automations.tplFanInS1Prompt", agentSlot: 0 },
      { titleKey: "automations.tplFanInS2", promptKey: "automations.tplFanInS2Prompt", agentSlot: 1 },
      {
        titleKey: "automations.tplFanInS3",
        promptKey: "automations.tplFanInS3Prompt",
        agentSlot: 2,
        dependsOn: [0, 1],
      },
    ],
  },
  {
    id: "example-consensus",
    nameKey: "automations.tplConsensusTitle",
    descKey: "automations.tplConsensusDesc",
    tagKey: "automations.exTagReview",
    schedule: { kind: "weeklyAt", day: 1, hour: 9, minute: 0 },
    steps: [
      {
        titleKey: "automations.tplConsensusS1",
        promptKey: "automations.tplConsensusPrompt",
        agentSlot: 0,
      },
      {
        titleKey: "automations.tplConsensusS2",
        promptKey: "automations.tplConsensusPrompt",
        agentSlot: 1,
      },
      {
        titleKey: "automations.tplConsensusS3",
        promptKey: "automations.tplConsensusJudge",
        agentSlot: 2,
        dependsOn: [0, 1],
      },
    ],
  },
  {
    id: "example-relay",
    nameKey: "automations.tplRelayTitle",
    descKey: "automations.tplRelayDesc",
    tagKey: "automations.exTagOngoing",
    schedule: { kind: "weekdaysAt", hour: 8, minute: 0 },
    steps: [
      {
        titleKey: "automations.tplRelayS1",
        promptKey: "automations.tplRelayPrompt",
        agentSlot: 0,
      },
      {
        titleKey: "automations.tplRelayS2",
        promptKey: "automations.tplRelayS2Prompt",
        agentSlot: 1,
        dependsOn: [0],
      },
    ],
  },
  {
    id: "example-watch",
    nameKey: "automations.tplWatchTitle",
    descKey: "automations.tplWatchDesc",
    tagKey: "automations.exTagWatch",
    schedule: { kind: "every", n: 30, unit: "minutes", startsAt: 0 },
    // The point of this one: a cheap shell check decides whether an agent turn
    // is worth spending at all.
    preconditionKey: "automations.tplWatchPrecondition",
    steps: [
      { titleKey: "automations.tplWatchS1", promptKey: "automations.tplWatchS1Prompt", agentSlot: 0 },
      {
        titleKey: "automations.tplWatchS2",
        promptKey: "automations.tplWatchS2Prompt",
        agentSlot: 1,
        dependsOn: [0],
      },
    ],
  },
];

/** Pick the agent for each slot, cycling through what is installed.
 *
 *  Cycling rather than repeating one agent is deliberate: on a machine with two
 *  CLIs an example is still genuinely multi-provider, which is the whole thing
 *  it is meant to demonstrate. With none installed the slots come back empty and
 *  the editor asks the user to choose — better than inventing an agent that
 *  isn't there. */
export function assignAgents(installed: string[], slot: number): string {
  if (installed.length === 0) return "";
  return installed[slot % installed.length];
}

export interface BuildOptions {
  /** Agent ids the machine can actually run, in preference order. */
  installedAgents: string[];
  /** Folder the example runs in; may be empty, and the editor will say so. */
  workingDir: string;
  /** Localizer, injected so this module stays free of the i18n singleton. */
  t: (key: MessageKey) => string;
  now: number;
}

/** Turn a spec into a real, **paused** automation. */
export function buildExample(spec: ExampleSpec, opts: BuildOptions): Automation {
  const steps: Step[] = spec.steps.map((s, i) => ({
    ...newStep(`s${i + 1}`, assignAgents(opts.installedAgents, s.agentSlot)),
    title: opts.t(s.titleKey),
    prompt: opts.t(s.promptKey),
    dependsOn: (s.dependsOn ?? []).map((d) => `s${d + 1}`),
    autonomous: s.autonomous ?? false,
  }));

  return {
    id: spec.id,
    name: opts.t(spec.nameKey),
    description: opts.t(spec.descKey),
    icon: null,
    // Paused: an example must never start firing on its own.
    enabled: false,
    tags: [opts.t(spec.tagKey)],
    workingDir: opts.workingDir,
    worktreePerRun: false,
    baseBranch: null,
    schedule: spec.schedule,
    policy: {
      ...defaultPolicy(),
      precondition: spec.preconditionKey
        ? { command: opts.t(spec.preconditionKey), timeoutSeconds: 20 }
        : null,
    },
    steps,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** Every example, built. */
export function buildAllExamples(opts: BuildOptions): Automation[] {
  return EXAMPLES.map((spec) => buildExample(spec, opts));
}
