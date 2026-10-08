import { isViewToolName, viewIdInOutput, type ViewContentBlock } from '@uxnan/shared';
import { isRunning } from '../adapters/content-blocks.js';
import type { ViewStore } from './view-store.js';

/** Whether a tool block is a `view_show` call: by its own name, or — for an
 *  agent that calls MCP tools through a generic one (Grok's `UseTool`) — by
 *  the tool its arguments name. */
function isViewCall(block: Record<string, unknown>, input: Record<string, unknown>): boolean {
  const named = (value: unknown) => typeof value === 'string' && isViewToolName(value);
  return named(block['toolName']) || named(input['tool_name']) || named(input['name']);
}

/** The arguments without the page: `html` (top level or in a wrapper's
 *  `tool_input`) becomes `htmlBytes`, so a 512 KiB page never rides the stream
 *  or the thread store. */
function withoutHtml(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  if (typeof out['html'] === 'string') {
    out['htmlBytes'] = Buffer.byteLength(out['html'], 'utf8');
    delete out['html'];
  }
  const inner = out['tool_input'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    out['tool_input'] = withoutHtml(inner as Record<string, unknown>);
  }
  return out;
}

/**
 * The one place a tool step becomes a view. A finished, non-error tool block
 * whose output carries the marker of a view this bridge just made becomes a
 * {@link ViewContentBlock} (same `blockId`) — whatever the tool is called,
 * because agents reach MCP tools under their own names and wrappers
 * (`mcp__uxnan__view_show`, OpenCode's code-mode `execute`, Grok's `UseTool`).
 * Each view is claimed once, so a later step that merely prints an old marker
 * (a log, a transcript) shows nothing. A `view_show` call that is still
 * running, failed, or names no live view stays a tool step, without its HTML.
 */
export function convertViewToolBlock(value: unknown, store?: ViewStore): unknown {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>)['type'] !== 'tool')
    return value;
  const block = value as Record<string, unknown>;
  const rawInput = block['input'];
  const input =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  const safe = isViewCall(block, input) ? { ...block, input: withoutHtml(input) } : block;
  if (!store || safe['isError'] === true || isRunning(safe) || typeof safe['output'] !== 'string')
    return safe;
  const viewId = viewIdInOutput(safe['output']);
  if (!viewId) return safe;
  const meta = store.claim(viewId);
  if (!meta) return safe;
  const result: ViewContentBlock = {
    type: 'view',
    ...(typeof safe['blockId'] === 'string' ? { blockId: safe['blockId'] } : {}),
    viewId,
    title: meta.title,
    bytes: meta.bytes,
    ...(meta.height !== undefined ? { height: meta.height } : {}),
  };
  return result;
}
