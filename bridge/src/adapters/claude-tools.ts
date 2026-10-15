/**
 * Maps Claude Code `tool_use` / `tool_result` stream-json blocks onto the
 * bridge's structured MessageContent JSON (`command_execution` / `diff` /
 * `tool` / `plan` / `subagent`) every client renders.
 *
 * Tool inputs are taken from the (complete) `assistant` message's `tool_use`
 * blocks; outputs from the matching `tool_result` block in the following `user`
 * message (paired by `tool_use_id`). Verified against `claude` 2.x stream-json.
 */
import type { QuestionItem } from '@uxnan/shared';
import {
  commandBlock,
  extractPlanSteps,
  multiEditDiffBlock,
  planBlock,
  runningBlock,
  subagentBlock,
  toolBlock,
  writeDiffBlock,
  type PlanStepBlock,
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
  /**
   * The line's `tool_use_result`: the tool's own structured outcome, which the
   * text result leaves out (a `TaskCreate` carries the id it gave the task only
   * here). Set only when the line answers exactly one tool call.
   */
  data?: Record<string, unknown>;
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

/**
 * Extracts the `tool_result` blocks from a `user` message's content, and the
 * message's `tool_use_result` (its structured outcome) onto the one result it
 * answers.
 */
export function extractToolResults(content: unknown, toolUseResult?: unknown): ClaudeToolResult[] {
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
  if (results.length === 1 && isRecord(toolUseResult)) results[0]!.data = toolUseResult;
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

/**
 * Tools with nothing to show as a row: the model managing its own session, and
 * the two that ask the person — their question or plan is shown as its own
 * card or text (`AskUserQuestion`, `ExitPlanMode`), not as a tool.
 */
const HIDDEN_TOOLS = new Set(['ToolSearch', 'AskUserQuestion', 'ExitPlanMode']);

/**
 * The task tools Claude Code 2.x offers in place of `TodoWrite`
 * (`CLAUDE_CODE_ENABLE_TASKS`): `TaskCreate` adds a task, `TaskUpdate` changes it.
 */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate']);

/** Whether a tool is one of the task tools, which build the plan list (see {@link applyTaskResult}). */
export function isTaskTool(name: string): boolean {
  return TASK_TOOLS.has(name);
}

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
  if (HIDDEN_TOOLS.has(tool.name) || isTaskTool(tool.name)) return null;
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
 * for what shows only once done: an edit (its diff), the to-do list and the
 * task tools (the whole list is shown, see {@link applyTaskResult}), and what
 * is never shown.
 */
export function toolUseStartBlock(tool: ClaudeToolUse): Record<string, unknown> | null {
  if (HIDDEN_TOOLS.has(tool.name) || tool.name === 'TodoWrite' || isTaskTool(tool.name)) {
    return null;
  }
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

/** One task of a session's task list, as `TaskCreate` and `TaskUpdate` leave it. */
export interface ClaudeTask {
  subject: string;
  activeForm?: string;
  status: PlanStepBlock['status'];
}

/** A session's task list, keyed by the id the CLI gave each task, in creation order. */
export type ClaudeTaskList = Map<string, ClaudeTask>;

/** The status a `TaskUpdate` names; `undefined` for anything else. */
function taskStatus(raw: string): PlanStepBlock['status'] | undefined {
  switch (raw) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return raw;
    default:
      return undefined;
  }
}

/**
 * Applies one settled `TaskCreate` or `TaskUpdate` to its session's task list
 * (verified on claude 2.1.296). `TaskCreate` takes its id from the result's
 * `task.id` (the text result carries none) and its subject from the input.
 * `TaskUpdate` names the task by `taskId` and may change its `status` (`deleted`
 * drops it), `subject` or `activeForm`. A failed call, an id the list does not
 * hold and a status it does not know change nothing. Returns whether the call
 * was applied.
 */
export function applyTaskResult(
  list: ClaudeTaskList,
  tool: ClaudeToolUse,
  result: ClaudeToolResult,
): boolean {
  if (result.isError) return false;
  const input = tool.input;
  if (tool.name === 'TaskCreate') {
    const created = result.data && isRecord(result.data['task']) ? result.data['task'] : undefined;
    const id = created?.['id'];
    const subject = str(input['subject']);
    if ((typeof id !== 'string' && typeof id !== 'number') || subject.length === 0) return false;
    const activeForm = str(input['activeForm']);
    list.set(String(id), {
      subject,
      ...(activeForm.length > 0 ? { activeForm } : {}),
      status: 'pending',
    });
    return true;
  }
  if (tool.name === 'TaskUpdate') {
    const id = input['taskId'];
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    const key = String(id);
    const task = list.get(key);
    if (!task) return false;
    const raw = str(input['status']);
    if (raw === 'deleted') {
      list.delete(key);
      return true;
    }
    const status = taskStatus(raw);
    if (status !== undefined) task.status = status;
    const subject = str(input['subject']);
    if (subject.length > 0) task.subject = subject;
    const activeForm = str(input['activeForm']);
    if (activeForm.length > 0) task.activeForm = activeForm;
    return true;
  }
  return false;
}

/**
 * The plan steps of a task list, in creation order: a task that is running
 * shows its `activeForm` ("Running step 1"), the others their subject.
 */
export function taskListSteps(list: ClaudeTaskList): PlanStepBlock[] {
  return [...list.values()].map((task) => ({
    description: task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject,
    status: task.status,
  }));
}

/**
 * The questions of an `AskUserQuestion` input as the bridge asks them. Claude
 * takes free text as well as the options, so every question is `custom`.
 */
export function claudeQuestions(input: Record<string, unknown>): QuestionItem[] {
  const raw = Array.isArray(input['questions']) ? input['questions'] : [];
  const questions: QuestionItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const question = str(entry['question']);
    if (question.length === 0) continue;
    const options = (Array.isArray(entry['options']) ? entry['options'] : [])
      .filter(isRecord)
      .map((option) => {
        const description = str(option['description']);
        return {
          label: str(option['label']),
          ...(description.length > 0 ? { description } : {}),
        };
      })
      .filter((option) => option.label.length > 0);
    const header = str(entry['header']);
    questions.push({
      question,
      ...(header.length > 0 ? { header } : {}),
      options,
      multiple: entry['multiSelect'] === true,
      custom: true,
    });
  }
  return questions;
}
