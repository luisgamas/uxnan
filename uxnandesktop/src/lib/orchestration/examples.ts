// Example run templates — ready-made runs a user can drop in to learn the engine
// and try their agents (paid ones like Claude/Codex, or free ones like
// OpenCode/Pi). This module is **pure**: it defines the step shapes and a builder;
// the localized copy and the chosen headless agent/workspace are supplied by the
// caller (the Runs UI), so it stays free of i18n/Tauri deps and is unit-testable.

import { addStep, createRun, type Run, type StepKind } from "./run";

/** One step of an example, before it's minted into a real run. Prompts may embed
 *  `{{steps.s1.output}}` directly — ids are minted `s1`, `s2`, … in order. */
export interface ExampleStepSpec {
  title: string;
  kind: StepKind;
  prompt: string;
  /** Indices (into the spec's `steps`) this step runs after. */
  dependsOn: number[];
}

/** A whole example: an id (stable, for the menu), localized title/description, and
 *  its ordered steps. */
export interface ExampleTemplate {
  id: string;
  title: string;
  description: string;
  steps: ExampleStepSpec[];
}

/** Build a draft `Run` from an example, planting the chosen headless `agent` +
 *  `workspace` into every non-gate step (gates need no target). Steps are added in
 *  order, so their minted ids are `s1`, `s2`, … and a prompt's `{{steps.s1.output}}`
 *  reference lines up. Dependencies are given as indices into `steps`. */
export function buildExampleRun(
  id: string,
  title: string,
  steps: ExampleStepSpec[],
  opts: { agent: string; workspace: string; now: number },
): Run {
  let run = createRun(id, title, opts.now);
  const ids: string[] = [];
  for (const s of steps) {
    const dependsOn = s.dependsOn.map((i) => ids[i]).filter(Boolean);
    const target =
      s.kind === "headless" ? { agent: opts.agent, model: "", workspace: opts.workspace } : {};
    const { run: next, stepId } = addStep(run, {
      title: s.title,
      kind: s.kind,
      prompt: s.prompt,
      target,
      dependsOn,
      gate: s.kind === "gate" ? { question: s.prompt } : undefined,
    });
    run = next;
    ids.push(stepId);
  }
  return run;
}
