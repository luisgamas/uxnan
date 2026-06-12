/**
 * Maps Codex `exec --json` `item.completed` items onto structured MessageContent
 * blocks (and reasoning text).
 *
 * Codex emits one `item.completed` per item; the item `type` discriminates:
 * `agent_message` (handled in the adapter), `reasoning`, `command_execution`,
 * `file_change`, `mcp_tool_call`, … Inputs are read defensively.
 *
 * ASSUMED SHAPES — need on-device verification against a real Codex turn (the
 * adapter's documented event list only covered `agent_message`).
 */
import { commandBlock, fileChangeBlock, toolBlock } from './content-blocks.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rec(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * The text of an `mcp_tool_call` `result` — Codex reports it as
 * `{ content: [{ type:'text', text }], structured_content }` (or, defensively,
 * a plain string).
 */
function codexResultText(result: unknown): string {
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

/** The reasoning text of a Codex `reasoning` item (`text` or a `summary` list). */
export function codexReasoningText(item: Record<string, unknown>): string {
  if (typeof item['text'] === 'string') return item['text'];
  const summary = item['summary'];
  if (Array.isArray(summary)) {
    return summary
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : isRecord(entry) && typeof entry['text'] === 'string'
            ? entry['text']
            : '',
      )
      .filter((s) => s.length > 0)
      .join('\n');
  }
  return '';
}

/**
 * The structured block(s) for a Codex item, or `[]` for items that aren't
 * commands / file changes / tool calls. A `file_change` yields one diff block
 * per changed path (Codex reports paths + kind, not the hunk text).
 */
export function codexItemBlocks(item: Record<string, unknown>): Record<string, unknown>[] {
  switch (item['type']) {
    case 'command_execution': {
      const exit = item['exit_code'];
      const isError = item['status'] === 'failed' || (typeof exit === 'number' && exit !== 0);
      const output = str(item['aggregated_output']) || str(item['output']);
      return [commandBlock(str(item['command']), output, isError)];
    }
    case 'file_change': {
      const changes = Array.isArray(item['changes']) ? item['changes'] : [];
      const blocks: Record<string, unknown>[] = [];
      for (const change of changes) {
        if (isRecord(change) && typeof change['path'] === 'string') {
          blocks.push(fileChangeBlock(change['path']));
        }
      }
      return blocks;
    }
    case 'mcp_tool_call': {
      const name = str(item['tool']) || str(item['name']) || 'tool';
      const output = codexResultText(item['result']) || str(item['output']);
      return [
        toolBlock(name, str(item['id']), rec(item['arguments'] ?? item['input']), output, item['status'] === 'failed'),
      ];
    }
    default:
      return [];
  }
}
