/**
 * Maps Claude Code `tool_use` / `tool_result` stream-json blocks onto the
 * bridge's structured MessageContent JSON (`command_execution` / `diff` /
 * `tool` / `plan` / `subagent`) every client renders.
 *
 * Tool inputs are taken from the (complete) `assistant` message's `tool_use`
 * blocks; outputs from the matching `tool_result` block in the following `user`
 * message (paired by `tool_use_id`). Verified against `claude` 2.x stream-json.
 */
import {
  commandBlock,
  extractPlanSteps,
  multiEditDiffBlock,
  planBlock,
  runningBlock,
  subagentBlock,
  toolBlock,
  writeDiffBlock,
} from './content-blocks.js';

/** A complete tool invocation parsed from an `assistant` message. */
export interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A tool result parsed from a `user` message. */
export interface ClaudeToolResult {
  toolUseId: string;
  text: string;
  isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Extracts the `tool_use` blocks from an `assistant` message's content. */
export function extractToolUses(content: unknown): ClaudeToolUse[] {
  if (!Array.isArray(content)) return [];
  const uses: ClaudeToolUse[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'tool_use' &&
      typeof block['id'] === 'string' &&
      typeof block['name'] === 'string'
    ) {
      uses.push({
        id: block['id'],
        name: block['name'],
        input: isRecord(block['input']) ? block['input'] : {},
      });
    }
  }
  return uses;
}

/** Extracts the `tool_result` blocks from a `user` message's content. */
export function extractToolResults(content: unknown): ClaudeToolResult[] {
  if (!Array.isArray(content)) return [];
  const results: ClaudeToolResult[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'tool_result' &&
      typeof block['tool_use_id'] === 'string'
    ) {
      results.push({
        toolUseId: block['tool_use_id'],
        text: extractResultText(block['content']),
        isError: block['is_error'] === true,
      });
    }
  }
  return results;
}

/** A tool_result's content is a string or an array of `{type:'text', text}`. */
export function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      }
    }
    return text;
  }
  return '';
}

/** Tools the model uses to manage its own session: nothing to show the user. */
const HIDDEN_TOOLS = new Set(['ToolSearch']);

/** The tools that delegate to a subagent (`Task` is its earlier name). */
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

/**
 * Maps a paired tool_use + tool_result onto a MessageContent block:
 * Bash → `command_execution`, edit/write tools → `diff`, `TodoWrite` → `plan`,
 * `Agent` → `subagent`, everything else → a classified `tool` block. `null`
 * for a tool with nothing to show (the model searching its own tool list).
 */
export function toolUseToBlock(
  tool: ClaudeToolUse,
  result: ClaudeToolResult,
): Record<string, unknown> | null {
  const input = tool.input;
  if (HIDDEN_TOOLS.has(tool.name)) return null;
  if (tool.name === 'Bash') {
    return commandBlock(str(input['command']), result.text, result.isError);
  }
  if (tool.name === 'Write') return writeDiffBlock(str(input['file_path']), str(input['content']));
  if (tool.name === 'NotebookEdit') {
    return writeDiffBlock(str(input['notebook_path']), str(input['new_source']));
  }
  if (tool.name === 'Edit' || tool.name === 'MultiEdit') {
    const edits = (
      tool.name === 'MultiEdit' && Array.isArray(input['edits']) ? input['edits'] : [input]
    )
      .filter(isRecord)
      .map((edit) => ({ old: str(edit['old_string']), new: str(edit['new_string']) }));
    return multiEditDiffBlock(str(input['file_path']), edits);
  }
  // `TodoWrite` carries the to-do list (`{ todos: [{ content, status,
  // activeForm }] }`); without parseable steps it falls through to a tool block.
  if (tool.name === 'TodoWrite') {
    const steps = extractPlanSteps(input);
    if (steps.length > 0) return planBlock(steps);
  }
  if (SUBAGENT_TOOLS.has(tool.name)) {
    return subagentBlock(
      tool.id,
      str(input['description']) || str(input['prompt']),
      result.text,
      result.isError,
    );
  }
  return toolBlock(tool.name, tool.id, input, result.text, result.isError);
}

/**
 * The row a tool shows while it runs (`runningBlock`), from its `tool_use`
 * alone; its result replaces it (`toolUseToBlock`, same `blockId`). `null`
 * for what shows only once done: an edit (its diff), the to-do list, and
 * what is never shown.
 */
export function toolUseStartBlock(tool: ClaudeToolUse): Record<string, unknown> | null {
  if (HIDDEN_TOOLS.has(tool.name) || tool.name === 'TodoWrite') return null;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool.name)) return null;
  if (tool.name === 'Bash') {
    return runningBlock(commandBlock(str(tool.input['command']), '', false), tool.id);
  }
  if (SUBAGENT_TOOLS.has(tool.name)) {
    const task = str(tool.input['description']) || str(tool.input['prompt']);
    return runningBlock(subagentBlock(tool.id, task, '', false), tool.id);
  }
  return runningBlock(toolBlock(tool.name, tool.id, tool.input, '', false), tool.id);
}
