/**
 * Maps an OpenCode `tool` part onto a structured MessageContent block.
 *
 * OpenCode's `run --format json` streams `{ type:'tool', part:{ tool, state:{
 * status, input, output } } }` parts. `tool` is the tool name (`bash`, `edit`,
 * `write`, `read`, `grep`, …); `state.input` holds the arguments and
 * `state.output` the result. Field names (`filePath`/`oldString`/`newString`)
 * are OpenCode's tool-arg conventions.
 *
 * ASSUMED SHAPE — needs on-device verification against a real OpenCode turn
 * (the adapter's documented event list didn't include tool parts).
 */
import {
  commandBlock,
  editDiffBlock,
  extractPlanSteps,
  planBlock,
  type PlanStepBlock,
  toolBlock,
  writeDiffBlock,
} from './content-blocks.js';

/**
 * Rank of a plan step status, used to keep the most advanced state when OpenCode
 * emits the same todo list twice per turn (`todowrite` fires once with
 * `in_progress`/`pending` and again with `completed`). Higher = more advanced.
 */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

/**
 * Merges OpenCode `todowrite` steps across the multiple emits a single turn
 * produces. Steps are keyed by their (normalized) content so the same task is
 * collapsed into one, keeping whichever status is most advanced. Returns the
 * unified step list, or `[]` when no steps were parsed.
 */
export function mergePlanSteps(
  prev: PlanStepBlock[],
  next: PlanStepBlock[],
): PlanStepBlock[] {
  const byContent = new Map<string, PlanStepBlock>();
  for (const step of [...prev, ...next]) {
    const key = step.description.trim();
    const existing = byContent.get(key);
    if (!existing) {
      byContent.set(key, { ...step });
      continue;
    }
    const rank = STATUS_RANK[step.status] ?? 0;
    const existingRank = STATUS_RANK[existing.status] ?? 0;
    if (rank > existingRank) existing.status = step.status;
  }
  return [...byContent.values()];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Builds the MessageContent JSON for an OpenCode tool part. */
export function opencodeToolBlock(
  toolName: string,
  partId: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  switch (toolName) {
    case 'bash':
      return commandBlock(str(input['command']), output, isError);
    case 'edit':
      return editDiffBlock(
        str(input['filePath']),
        str(input['oldString']),
        str(input['newString']),
      );
    case 'write':
      return writeDiffBlock(str(input['filePath']), str(input['content']));
    // OpenCode's to-do tool surfaces the plan/task list. Verified against
    // opencode 1.17.x: `todowrite` fires with `{ todos:[{content,status,priority}] }`
    // up to twice per turn (an `in_progress`/`pending` pass and a `completed` pass),
    // each with a distinct partId. The adapter accumulates these via
    // `mergePlanSteps` and emits a single `plan` block at turn close, so the
    // phone shows one plan card with the final states (not two). `todoread`/
    // `todo` are treated the same. A mismatch (no parsed steps) falls back to a
    // generic tool block.
    case 'todowrite':
    case 'todoread':
    case 'todo': {
      const steps = extractPlanSteps(input);
      if (steps.length > 0) return planBlock(steps);
      return toolBlock(toolName, partId, input, output, isError);
    }
    default:
      return toolBlock(toolName, partId, input, output, isError);
  }
}
