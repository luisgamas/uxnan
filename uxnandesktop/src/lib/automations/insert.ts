// Inserting a value into a step's prompt.
//
// Pure, because the fiddly parts are easy to get subtly wrong and impossible to
// notice by eye: the token has to land at the caret (a value usually belongs
// mid-sentence, not tacked onto the end), a selection has to be replaced rather
// than pushed aside, the caret has to end up after what was inserted so typing
// continues naturally, and referencing an earlier step has to make this step
// wait for it — otherwise the hand-off arrives empty.

import type { Step } from "./types";

export interface InsertResult {
  /** The step with the token planted and any new dependency added. */
  step: Step;
  /** Where the caret should sit afterwards. */
  caret: number;
}

/**
 * Insert `token` into `step`'s prompt over the `[start, end)` selection.
 *
 * `dependsOn` is the step whose value is being referenced, when it comes from
 * earlier in the same run; passing it adds the dependency. Values from the
 * previous run take no dependency — that run already finished.
 */
export function insertToken(
  step: Step,
  token: string,
  start: number,
  end: number,
  dependsOn?: string,
): InsertResult {
  const prompt = step.prompt;
  // Clamp: a stale caret from a re-rendered field must never slice a string
  // out of bounds or silently drop the text after it.
  const from = clamp(Math.min(start, end), 0, prompt.length);
  const to = clamp(Math.max(start, end), 0, prompt.length);

  const text = `${prompt.slice(0, from)}${token}${prompt.slice(to)}`;
  const alreadyWaits = !dependsOn || step.dependsOn.includes(dependsOn);
  // Never depend on itself: a step waiting for its own output can never start.
  const selfReference = dependsOn === step.id;

  return {
    step: {
      ...step,
      prompt: text,
      dependsOn:
        alreadyWaits || selfReference
          ? step.dependsOn
          : [...step.dependsOn, dependsOn],
    },
    caret: from + token.length,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
