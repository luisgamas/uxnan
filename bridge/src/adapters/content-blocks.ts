/**
 * Builders for the structured MessageContent JSON the phone decodes (via
 * `MessageContent.fromJson`) into the Work log / Changed files sections:
 * `command_execution`, `diff` and a generic `tool` block.
 *
 * Each agent adapter (Claude, Codex, pi, OpenCode) extracts the raw fields from
 * its own CLI event shape and calls these builders, so the on-the-wire block
 * shape is defined in exactly one place and stays in lock-step with the Dart
 * `MessageContent` types.
 */
import type {
  ApprovalRequestBlock,
  ApprovalRisk,
  QuestionItem,
  QuestionRequestBlock,
} from '@uxnan/shared';

/** Cap tool/command output carried on the wire so a big read doesn't bloat it. */
const MAX_OUTPUT = 4000;

/** Truncates long tool/command output for the wire. */
export function truncateOutput(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (truncated)` : text;
}

/** Splits text into lines (empty → no lines), for +/- diff synthesis. */
function lines(text: string): string[] {
  return text.length > 0 ? text.split('\n') : [];
}

/** A `command_execution` block (a shell command and its output). */
export function commandBlock(
  command: string,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  const trimmed = truncateOutput(output);
  return {
    type: 'command_execution',
    command,
    status: isError ? 'error' : 'completed',
    ...(trimmed ? { output: trimmed } : {}),
  };
}

/** A `diff` block for one or more edits (old → new) — synthesized −old/+new. */
export function multiEditDiffBlock(
  filename: string,
  edits: { old: string; new: string }[],
): Record<string, unknown> {
  const parts: string[] = [];
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    const oldLines = lines(edit.old);
    const newLines = lines(edit.new);
    removed += oldLines.length;
    added += newLines.length;
    parts.push(...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`));
  }
  return { type: 'diff', filename, diff: parts.join('\n'), additions: added, deletions: removed };
}

/** A `diff` block for a single edit (old → new). */
export function editDiffBlock(
  filename: string,
  oldText: string,
  newText: string,
): Record<string, unknown> {
  return multiEditDiffBlock(filename, [{ old: oldText, new: newText }]);
}

/** A `diff` block for a whole-file write (all additions). */
export function writeDiffBlock(filename: string, content: string): Record<string, unknown> {
  const added = lines(content);
  return {
    type: 'diff',
    filename,
    diff: added.map((l) => `+${l}`).join('\n'),
    additions: added.length,
    deletions: 0,
  };
}

/**
 * A minimal `diff` block when only the changed path (and optionally counts) is
 * known — no hunk text. Used by agents that report file changes without the
 * before/after content (e.g. Codex `file_change`).
 */
export function fileChangeBlock(
  filename: string,
  additions = 0,
  deletions = 0,
): Record<string, unknown> {
  return { type: 'diff', filename, diff: '', additions, deletions };
}

/**
 * A `diff` block from a real unified diff (e.g. `git diff` output): strips the
 * file-level header, keeps the `@@` hunks + content, and counts real +/- lines.
 * Used to show an accurate per-line diff (not a whole-file "all additions").
 */
export function unifiedDiffBlock(filename: string, diffText: string): Record<string, unknown> {
  const body: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of diffText.split('\n')) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('\\ No newline')
    ) {
      continue;
    }
    body.push(line);
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return {
    type: 'diff',
    filename,
    diff: body.join('\n').replace(/^\n+|\n+$/g, ''),
    additions: added,
    deletions: removed,
  };
}

/**
 * An `approval` content block: the agent is asking the user to authorize an
 * action. The phone renders it as an interactive card and replies via
 * `turn/send { approvalResponse }`. `approvalId` is the bridge handle the
 * adapter uses to deliver the decision back to the agent.
 */
export function approvalBlock(
  approvalId: string,
  action: string,
  opts: { risk?: ApprovalRisk; detail?: string } = {},
): ApprovalRequestBlock {
  return {
    type: 'approval',
    approvalId,
    action,
    ...(opts.risk !== undefined ? { risk: opts.risk } : {}),
    ...(opts.detail !== undefined && opts.detail.length > 0 ? { detail: opts.detail } : {}),
  };
}

/**
 * A `question` content block: the agent is asking the user to choose among
 * options. The phone renders it as an interactive picker and replies via
 * `turn/send { questionResponse }`. `questionId` is the bridge handle the adapter
 * uses to deliver the chosen answers back to the agent.
 */
export function questionBlock(questionId: string, questions: QuestionItem[]): QuestionRequestBlock {
  return { type: 'question', questionId, questions };
}

/** One step of an agent plan / to-do list, on the wire (matches Dart `PlanStep`). */
export interface PlanStepBlock {
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Normalizes an agent's free-form step status to the wire vocabulary. */
function normalizePlanStatus(raw: unknown): PlanStepBlock['status'] {
  const s = typeof raw === 'string' ? raw.toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (
    s === 'in_progress' ||
    s === 'inprogress' ||
    s === 'running' ||
    s === 'active' ||
    s === 'doing'
  ) {
    return 'in_progress';
  }
  if (s === 'completed' || s === 'complete' || s === 'done' || s === 'finished') {
    return 'completed';
  }
  return 'pending';
}

function planText(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/**
 * Extracts plan/to-do steps from an agent's plan-tool input, tolerating the
 * common shapes: the step list under `todos` (Claude/OpenCode), `plan` (Codex),
 * `steps`/`items`, or a bare array; each item carrying its text under
 * `content`/`description`/`text`/`step`/`activeForm`/`title`/`name` and its
 * progress under `status`/`state`. Returns `[]` when nothing parses, so callers
 * fall back to a generic block (no plan) instead of emitting an empty one.
 */
export function extractPlanSteps(input: unknown): PlanStepBlock[] {
  const obj = isRecord(input) ? input : undefined;
  const list: unknown[] = Array.isArray(input)
    ? input
    : Array.isArray(obj?.['todos'])
      ? (obj!['todos'] as unknown[])
      : Array.isArray(obj?.['plan'])
        ? (obj!['plan'] as unknown[])
        : Array.isArray(obj?.['steps'])
          ? (obj!['steps'] as unknown[])
          : Array.isArray(obj?.['items'])
            ? (obj!['items'] as unknown[])
            : [];
  const steps: PlanStepBlock[] = [];
  for (const raw of list) {
    if (typeof raw === 'string') {
      if (raw.length > 0) steps.push({ description: raw, status: 'pending' });
      continue;
    }
    if (!isRecord(raw)) continue;
    const description = planText(raw, [
      'content',
      'description',
      'text',
      'step',
      'activeForm',
      'title',
      'name',
    ]);
    if (!description) continue;
    steps.push({ description, status: normalizePlanStatus(raw['status'] ?? raw['state']) });
  }
  return steps;
}

/**
 * A `plan` content block — the agent's to-do list for plan mode. The phone
 * decodes it into a `PlanContent` and renders the checklist
 * (`{ type:'plan', state:{ title?, steps:[{ description, status }] } }`).
 */
export function planBlock(steps: PlanStepBlock[], title?: string): Record<string, unknown> {
  return {
    type: 'plan',
    state: {
      ...(title !== undefined && title.length > 0 ? { title } : {}),
      steps,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A `system` content block of kind `error` — the reason a turn failed (e.g. a
 * quota / "usage balance exhausted" error). Persisted to the turn's history on
 * `turn_error` so the phone can render the failure inline (via its `SystemContent`
 * error banner) both live and after a `turn/list` re-sync. Matches the Dart
 * `SystemContent` wire shape (`{ type:'system', text, kind:'error' }`).
 */
export function errorBlock(text: string): Record<string, unknown> {
  return { type: 'system', text: truncateOutput(text), kind: 'error' };
}

/** A generic `tool` block (a non-shell, non-edit tool call and its output). */
export function toolBlock(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  const trimmed = truncateOutput(output);
  return {
    type: 'tool',
    toolName,
    toolId,
    input,
    ...(trimmed ? { output: trimmed } : {}),
    isError,
  };
}
