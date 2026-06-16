/**
 * Maps Gemini CLI tool events (`tool_use` + `tool_result` from the `stream-json`
 * output) onto the shared structured content blocks the phone renders in the Work
 * log and Changed files. Mirrors `codex-tools.ts` / `pi-tools.ts`.
 *
 * Gemini emits a `tool_use` (name + id + parameters) and, later, a matching
 * `tool_result` (status + optional output) keyed by `tool_id`; the adapter pairs
 * them and calls {@link geminiToolBlock} once the result arrives.
 *
 * Tool schemas (verified live against gemini-cli 0.45.2 / inferred from the public
 * Gemini CLI tool set):
 *   - `write_file`        → `{ file_path, content }`           → write diff block
 *   - `replace`           → `{ file_path, old_string, new_string }` → edit diff block
 *   - `run_shell_command` → `{ command }`                      → command block
 *   - everything else (`read_file`, `list_directory`, `glob`, `search_file_content`,
 *     `google_web_search`, …)                                   → generic tool block
 */
import { commandBlock, editDiffBlock, toolBlock, writeDiffBlock } from './content-blocks.js';

/** Internal Gemini bookkeeping tools that are noise in the Work log — skipped. */
const INTERNAL_TOOLS = new Set(['update_topic']);

/** Whether this tool is Gemini-internal bookkeeping that should not surface. */
export function isInternalGeminiTool(toolName: string): boolean {
  return INTERNAL_TOOLS.has(toolName);
}

/** Build the structured block for one completed Gemini tool call. */
export function geminiToolBlock(
  toolName: string,
  toolId: string,
  params: Record<string, unknown>,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  if (toolName === 'write_file') {
    const file = str(params['file_path']);
    if (file) return writeDiffBlock(file, str(params['content']) ?? '');
  }
  if (toolName === 'replace') {
    const file = str(params['file_path']);
    if (file) {
      return editDiffBlock(file, str(params['old_string']) ?? '', str(params['new_string']) ?? '');
    }
  }
  if (toolName === 'run_shell_command') {
    const command = str(params['command']);
    if (command) return commandBlock(command, output, isError);
  }
  return toolBlock(toolName, toolId, params, output, isError);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
