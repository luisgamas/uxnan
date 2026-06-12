/**
 * Maps pi tool executions onto structured MessageContent blocks.
 *
 * pi (`-p --mode json`) reports tools as top-level `tool_execution_start`
 * (`{ toolCallId, toolName, args }`) and `tool_execution_end`
 * (`{ toolCallId, toolName, result:{ content:[{type:'text',text}] }, isError }`)
 * events; the adapter pairs them by `toolCallId`. Tool/arg names verified live
 * against pi 0.79.1: `bash`→`command`, `write`→`path`+`content`, `read`→`path`.
 */
import { commandBlock, editDiffBlock, toolBlock, writeDiffBlock } from './content-blocks.js';

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
    case 'str_replace':
      return editDiffBlock(
        path,
        str(tool.input['old_str']) || str(tool.input['old_string']),
        str(tool.input['new_str']) || str(tool.input['new_string']),
      );
    case 'write':
    case 'create':
      return writeDiffBlock(path, str(tool.input['content']));
    default:
      return toolBlock(tool.name, tool.id, tool.input, output, isError);
  }
}
