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
