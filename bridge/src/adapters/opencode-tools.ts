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
  toolBlock,
  writeDiffBlock,
} from './content-blocks.js';

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
      return editDiffBlock(str(input['filePath']), str(input['oldString']), str(input['newString']));
    case 'write':
      return writeDiffBlock(str(input['filePath']), str(input['content']));
    // OpenCode's to-do tool surfaces the plan/task list. FOR-DEV: tool name +
    // input shape ASSUMED (`todowrite`/`todoread`, `{ todos:[…] }`) — verify
    // against a real OpenCode plan turn; a mismatch yields no steps → no block.
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
