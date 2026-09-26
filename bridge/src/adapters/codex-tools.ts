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
import {
  commandBlock,
  extractPlanSteps,
  planBlock,
  runningBlock,
  subagentBlock,
  toolBlock,
  unwrapShellCommand,
} from './content-blocks.js';

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

/** A changed path + kind from a Codex `file_change` item. */
export interface CodexFileChange {
  path: string;
  kind: string;
}

/**
 * The changed paths/kinds of a `file_change` item — the adapter reads the files
 * to synthesize a diff (Codex reports only path + kind, not the hunk text).
 */
export function codexFileChanges(item: Record<string, unknown>): CodexFileChange[] {
  if (item['type'] !== 'file_change') return [];
  const changes = Array.isArray(item['changes']) ? item['changes'] : [];
  const out: CodexFileChange[] = [];
  for (const change of changes) {
    if (isRecord(change) && typeof change['path'] === 'string') {
      out.push({ path: change['path'], kind: str(change['kind']) });
    }
  }
  return out;
}

/**
 * The structured block(s) for a Codex `command_execution` / `mcp_tool_call`
 * item (`file_change` is handled by the adapter so it can read the file
 * content), or `[]` otherwise.
 */
export function codexItemBlocks(item: Record<string, unknown>): Record<string, unknown>[] {
  switch (item['type']) {
    case 'command_execution': {
      const exit = item['exit_code'];
      const isError = item['status'] === 'failed' || (typeof exit === 'number' && exit !== 0);
      const output = str(item['aggregated_output']) || str(item['output']);
      return [commandBlock(unwrapShellCommand(str(item['command'])), output, isError)];
    }
    case 'mcp_tool_call': {
      const name = str(item['tool']) || str(item['name']) || 'tool';
      const output = codexResultText(item['result']) || str(item['output']);
      return [
        toolBlock(
          name,
          str(item['id']),
          rec(item['arguments'] ?? item['input']),
          output,
          item['status'] === 'failed',
        ),
      ];
    }
    // Codex plan mode: the `update_plan` item carries the task list. FOR-DEV:
    // item type + shape ASSUMED (`{ plan:[{ step, status }], explanation? }`) —
    // verify against a real Codex plan turn; no steps → no block (no breakage).
    case 'update_plan':
    case 'todo_list': {
      const steps = extractPlanSteps(item['plan'] ?? item['todos'] ?? item);
      return steps.length > 0 ? [planBlock(steps, str(item['explanation']))] : [];
    }
    default:
      return [];
  }
}

/** The text parts of a V2 `contentItems` / MCP `content` list. */
function contentItemsText(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter(isRecord)
    .map((c) => (c['type'] === 'text' || c['type'] === 'inputText' ? str(c['text']) : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * The block for a finished app-server tool item — an MCP or dynamic tool
 * call, a web search, an image view or a collaboration (subagent) call —
 * or `null` for one with nothing to show. Shapes from the app-server's v2
 * schema (`ThreadItem`), `codex app-server generate-json-schema`.
 */
export function codexToolItemBlock(item: Record<string, unknown>): Record<string, unknown> | null {
  const id = str(item['id']);
  const status = str(item['status']);
  const failed = status === 'failed';
  switch (item['type']) {
    case 'mcpToolCall': {
      const error = isRecord(item['error']) ? str(item['error']['message']) : '';
      const result = isRecord(item['result']) ? contentItemsText(item['result']['content']) : '';
      const server = str(item['server']);
      const tool = str(item['tool']) || 'tool';
      return toolBlock(
        server ? `${server}/${tool}` : tool,
        id,
        rec(item['arguments']),
        error || result,
        failed || !!error,
        { kind: 'mcp' },
      );
    }
    case 'dynamicToolCall':
      return toolBlock(
        str(item['tool']) || 'tool',
        id,
        rec(item['arguments']),
        contentItemsText(item['contentItems']),
        failed || item['success'] === false,
      );
    case 'webSearch': {
      const action = rec(item['action']);
      if (action['type'] === 'openPage' && str(action['url'])) {
        return toolBlock('web_open', id, { url: str(action['url']) }, '', false, { kind: 'fetch' });
      }
      const query = str(item['query']) || str(action['query']);
      return query
        ? toolBlock('web_search', id, { query }, '', false, { kind: 'web_search' })
        : null;
    }
    case 'imageView': {
      const path = str(item['path']);
      return path ? toolBlock('view_image', id, { path }, '', false, { kind: 'read' }) : null;
    }
    case 'collabAgentToolCall': {
      // Only the call that hands a subagent its task is a step of the work;
      // waiting on it, messaging or closing it are bookkeeping.
      const tool = str(item['tool']);
      if (tool !== 'spawnAgent' && tool !== 'followupTask') return null;
      const states = rec(item['agentsStates']);
      const reports = Object.values(states)
        .filter(isRecord)
        .map((state) => str(state['message']))
        .filter(Boolean)
        .join('\n\n');
      return subagentBlock(id, str(item['prompt']), reports, failed);
    }
    default:
      return null;
  }
}

/**
 * The row an app-server item shows while it runs (`item/started`), or `null`
 * for one that shows only once done (a file change: its diff). Its
 * `item/completed` replaces it (same `blockId`: the item id).
 */
export function codexItemStartBlock(item: Record<string, unknown>): Record<string, unknown> | null {
  const id = str(item['id']);
  if (!id) return null;
  if (item['type'] === 'commandExecution') {
    const command = str(item['command']);
    return command ? runningBlock(commandBlock(unwrapShellCommand(command), '', false), id) : null;
  }
  const block = codexToolItemBlock({ ...item, status: 'inProgress', result: null, error: null });
  return block ? runningBlock(block, id) : null;
}
