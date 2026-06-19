/**
 * Maps Claude Code `tool_use` / `tool_result` stream-json blocks onto the
 * bridge's structured MessageContent JSON (`command_execution` / `diff` /
 * `tool`) the phone renders in the Work log and Changed files sections.
 *
 * Tool inputs are taken from the (complete) `assistant` message's `tool_use`
 * blocks; outputs from the matching `tool_result` block in the following `user`
 * message (paired by `tool_use_id`). Verified against `claude` 2.x stream-json.
 */
import { extractPlanSteps, planBlock } from './content-blocks.js';

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

/** Cap tool output carried on the wire so a big Read/Grep doesn't bloat it. */
const MAX_OUTPUT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (truncated)` : text;
}

/** The tool names whose edits become a `diff` block. */
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

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
    if (isRecord(block) && block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
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

/** Lines as additions (`+`) for a whole-file Write. */
function additions(text: string): string[] {
  return text.length > 0 ? text.split('\n') : [];
}

/** Builds a `diff` MessageContent from an edit/write tool's input. */
function diffBlock(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const filename = str(input['file_path']);
  if (name === 'Write' || name === 'NotebookEdit') {
    const lines = additions(str(input['content']) || str(input['new_source']));
    return {
      type: 'diff',
      filename,
      diff: lines.map((line) => `+${line}`).join('\n'),
      additions: lines.length,
      deletions: 0,
    };
  }
  // Edit / MultiEdit: render old→new as -/+ hunks.
  const edits = name === 'MultiEdit' && Array.isArray(input['edits'])
    ? (input['edits'] as unknown[])
    : [input];
  const parts: string[] = [];
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (!isRecord(edit)) continue;
    const oldLines = additions(str(edit['old_string']));
    const newLines = additions(str(edit['new_string']));
    removed += oldLines.length;
    added += newLines.length;
    parts.push(...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`));
  }
  return { type: 'diff', filename, diff: parts.join('\n'), additions: added, deletions: removed };
}

/**
 * Maps a paired tool_use + tool_result onto a MessageContent block:
 * Bash → `command_execution`, edit/write tools → `diff`, everything else →
 * a generic `tool` block. Returns the JSON the phone decodes via
 * `MessageContent.fromJson`.
 */
export function toolUseToBlock(tool: ClaudeToolUse, result: ClaudeToolResult): Record<string, unknown> {
  if (tool.name === 'Bash') {
    const output = truncate(result.text);
    return {
      type: 'command_execution',
      command: str(tool.input['command']),
      status: result.isError ? 'error' : 'completed',
      ...(output ? { output } : {}),
    };
  }
  if (EDIT_TOOLS.has(tool.name)) {
    return diffBlock(tool.name, tool.input);
  }
  // Claude's TodoWrite tool carries the plan/to-do list: `{ todos: [{ content,
  // status, activeForm }] }`. Surface it as a `plan` block (the phone renders a
  // checklist); fall through to a generic tool block if it has no parseable steps.
  if (tool.name === 'TodoWrite') {
    const steps = extractPlanSteps(tool.input);
    if (steps.length > 0) return planBlock(steps);
  }
  const output = truncate(result.text);
  return {
    type: 'tool',
    toolName: tool.name,
    toolId: tool.id,
    input: tool.input,
    ...(output ? { output } : {}),
    isError: result.isError,
  };
}
