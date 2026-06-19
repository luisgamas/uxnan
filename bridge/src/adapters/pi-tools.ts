/**
 * Maps pi tool executions onto structured MessageContent blocks.
 *
 * pi (`-p --mode json`) reports tools as top-level `tool_execution_start`
 * (`{ toolCallId, toolName, args }`) and `tool_execution_end`
 * (`{ toolCallId, toolName, result:{ content:[{type:'text',text}] }, isError }`)
 * events; the adapter pairs them by `toolCallId`. Tool/arg names verified live
 * against pi 0.79.1: `bash`→`command`, `write`→`path`+`content`, `read`→`path`.
 */
import {
  commandBlock,
  editDiffBlock,
  extractPlanSteps,
  multiEditDiffBlock,
  planBlock,
  toolBlock,
  writeDiffBlock,
} from './content-blocks.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A pi tool invocation (paired `tool_execution_start` args + `_end` result). */
export interface PiToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Extracts the text of a pi tool `result` (`{ content:[{type:'text',text}] }`). */
export function piResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (isRecord(result) && Array.isArray(result['content'])) {
    let text = '';
    for (const block of result['content']) {
      if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      }
    }
    return text;
  }
  return '';
}

/** Builds the MessageContent JSON for a paired pi tool execution. */
export function piToolBlock(
  tool: PiToolUse,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  const path = str(tool.input['path']) || str(tool.input['file_path']);
  switch (tool.name) {
    case 'bash':
      return commandBlock(str(tool.input['command']), output, isError);
    case 'edit':
    case 'str_replace': {
      // pi's edit tool: `{ path, edits: [{ oldText, newText }] }` (verified live
      // against pi 0.79.1); tolerant of single old/new string shapes too.
      const raw = tool.input['edits'];
      if (Array.isArray(raw)) {
        const edits = raw.filter(isRecord).map((e) => ({
          old: str(e['oldText']) || str(e['old_string']) || str(e['old_str']),
          new: str(e['newText']) || str(e['new_string']) || str(e['new_str']),
        }));
        return multiEditDiffBlock(path, edits);
      }
      return editDiffBlock(
        path,
        str(tool.input['oldText']) || str(tool.input['old_string']) || str(tool.input['old_str']),
        str(tool.input['newText']) || str(tool.input['new_string']) || str(tool.input['new_str']),
      );
    }
    case 'write':
    case 'create':
      return writeDiffBlock(path, str(tool.input['content']));
    // pi's plan/to-do tool. FOR-DEV: tool name + input shape ASSUMED
    // (`todo`/`update_plan`/`plan`) — verify against a real pi plan turn; a
    // mismatch yields no steps → falls back to a generic tool block.
    case 'todo':
    case 'todowrite':
    case 'update_plan':
    case 'plan': {
      const steps = extractPlanSteps(tool.input);
      if (steps.length > 0) {
        return planBlock(steps, str(tool.input['explanation']) || str(tool.input['title']));
      }
      return toolBlock(tool.name, tool.id, tool.input, output, isError);
    }
    default:
      return toolBlock(tool.name, tool.id, tool.input, output, isError);
  }
}
