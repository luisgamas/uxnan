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

/** A `diff` block for an edit (old → new) — synthesized −old/+new hunks. */
export function editDiffBlock(
  filename: string,
  oldText: string,
  newText: string,
): Record<string, unknown> {
  const removed = lines(oldText);
  const added = lines(newText);
  return {
    type: 'diff',
    filename,
    diff: [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n'),
    additions: added.length,
    deletions: removed.length,
  };
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
