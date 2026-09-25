/**
 * Maps the tool calls and plans of an Agent Client Protocol agent (Zero's
 * `zero acp`, Grok's `grok agent stdio`) onto the bridge's content blocks, so
 * every client renders them with the same rows and cards as any other agent.
 *
 * ACP shapes (the protocol's `session/update`):
 *   toolCall: { toolCallId, title, kind, status, rawInput, content:[ToolCallContent] }
 *   ToolCallContent: { type:'content', content:{type:'text',text} } | { type:'diff', path, oldText, newText }
 *   plan entries: [{ content, priority, status }]
 *
 * What each agent puts there, measured on a real turn of each (2026-09-25):
 *  - the tool's name: Zero leads its `title` with it (`read_file notes.txt`,
 *    `grep .`); Grok titles for people (``Read `notes.txt` ``, `alpha`) and
 *    names the tool in `rawInput.variant` (`ReadFile`, `Grep`, `WebFetch`);
 *  - a diff: Zero sends both whole files, Grok the changed snippet;
 *  - the plan: both send it as a `plan` update AND as the call that wrote it
 *    (`update_plan`, `TodoWrite`), which is therefore not shown twice.
 */
import { readFileSync } from 'node:fs';
import type { ToolKind } from '@uxnan/shared';
import {
  commandBlock,
  editDiffBlock,
  extractPlanSteps,
  fileDiffBlock,
  runningBlock,
  subagentBlock,
  toolBlock,
  writeDiffBlock,
  type PlanStepBlock,
} from './content-blocks.js';

/** A merged ACP tool call (the first `tool_call` plus its `tool_call_update`s). */
export interface AcpToolCall {
  toolCallId: string;
  title: string;
  /** ACP tool kind: `read`/`edit`/`delete`/`move`/`search`/`execute`/`think`/`fetch`/`other`. */
  kind: string;
  /** `pending`/`in_progress`/`completed`/`failed`. */
  status: string;
  /** The tool's arguments. */
  rawInput?: Record<string, unknown>;
  /** ACP `ToolCallContent[]` (text output and/or a diff). */
  content?: unknown[];
}

/** The ACP kinds that name a {@link ToolKind} outright. */
const KIND_BY_ACP: Record<string, ToolKind> = { read: 'read', search: 'search', fetch: 'fetch' };

/** Tools that write the plan the `plan` update already carries. */
const PLAN_TOOLS = new Set(['todowrite', 'updateplan', 'todo', 'plan', 'writetodos']);

/** Tools that hand work to a subagent. */
const SUBAGENT_TOOLS = new Set(['task', 'agent', 'subagent', 'spawnagent']);

/** The tool's own name: Grok's `variant`, else the first word of the title. */
function toolName(tc: AcpToolCall, input: Record<string, unknown>): string {
  const variant = str(input['variant']);
  if (variant) return variant;
  const first = tc.title.trim().split(/\s+/, 1)[0] ?? '';
  return /^[A-Za-z][\w.-]*$/.test(first) ? first : tc.kind || 'tool';
}

/**
 * The block for a finished ACP tool call, or `null` for the call that wrote
 * the plan (shown once, from the `plan` update).
 */
export function acpToolBlock(tc: AcpToolCall): Record<string, unknown> | null {
  const isError = tc.status === 'failed';
  const input = tc.rawInput ?? {};
  const { output, diff } = extractToolContent(tc.content);
  const kind = tc.kind.toLowerCase();
  const name = toolName(tc, input);
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, '');

  if (kind === 'execute') {
    const command = str(input['command']) || str(input['cmd']) || tc.title;
    return commandBlock(command, output, isError);
  }
  if (diff) return diffBlock(diff.path, diff.oldText, diff.newText);
  if (kind === 'edit') {
    // A write with no diff content: synthesize an all-additions diff from the args.
    const path = str(input['path']) || str(input['filePath']) || str(input['file_path']);
    if (path) return writeDiffBlock(path, str(input['content']));
  }
  if (PLAN_TOOLS.has(normalized) || extractPlanSteps(input).length > 0) return null;
  if (SUBAGENT_TOOLS.has(normalized)) {
    const task = str(input['description']) || str(input['prompt']) || tc.title;
    return subagentBlock(tc.toolCallId, task, output, isError);
  }
  // `ask_user`: an ACP agent cannot ask through this channel (it continues
  // with its best assumption), so the questions it had are shown legibly.
  const asked = formatAskUser(input);
  if (asked) {
    const note =
      output ||
      'No interactive answer was available, so the agent continued with its best assumption.';
    return toolBlock(name, tc.toolCallId, {}, `${asked}\n\n${note}`, isError);
  }
  const hint = KIND_BY_ACP[kind];
  return toolBlock(name, tc.toolCallId, input, output, isError, hint ? { kind: hint } : {});
}

/**
 * The row an ACP tool call shows while it runs, from its first announcement;
 * its end replaces it (same `blockId`: the call id). `null` for what shows
 * only once done: an edit (its diff), the plan, a question.
 */
export function acpToolStartBlock(tc: AcpToolCall): Record<string, unknown> | null {
  if (['edit', 'delete', 'move'].includes(tc.kind.toLowerCase())) return null;
  if (formatAskUser(tc.rawInput ?? {})) return null;
  const block = acpToolBlock({ ...tc, status: 'completed', content: [] });
  if (!block || block['type'] === 'diff' || block['type'] === 'plan') return null;
  return runningBlock(block, tc.toolCallId);
}

/** The ACP kind of a tool call: its own, or the one Grok puts in `_meta["x.ai/tool"]`. */
export function acpToolKind(update: Record<string, unknown>): string {
  const own = str(update['kind']);
  if (own) return own;
  const meta = isRecord(update['_meta']) ? update['_meta'] : {};
  const tool = isRecord(meta['x.ai/tool']) ? meta['x.ai/tool'] : {};
  return str(tool['kind']);
}

/**
 * A diff for an ACP edit. When the new side is the whole file as it now
 * stands on disk, the old side is the whole file too, and the block gets real
 * hunks with line numbers; a snippet gets its changed lines with context.
 */
function diffBlock(path: string, oldText: string, newText: string): Record<string, unknown> {
  let wholeFile = false;
  try {
    wholeFile = readFileSync(path, 'utf-8') === newText;
  } catch {
    /* gone or unreadable: treat as a snippet */
  }
  return wholeFile ? fileDiffBlock(path, oldText, newText) : editDiffBlock(path, oldText, newText);
}

/**
 * Render an `ask_user` `rawInput` (`{ header?, questions:[{question, options?,
 * recommended?}] }`) as a readable prompt. Undefined when the args are not
 * that shape, so the caller falls back to the generic block.
 */
function formatAskUser(input: Record<string, unknown>): string | undefined {
  const questions = input['questions'];
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const lines: string[] = [];
  const header = str(input['header']);
  if (header) lines.push(header);
  for (const q of questions) {
    if (!isRecord(q)) continue;
    const text = str(q['question']);
    if (text) lines.push(`• ${text}`);
    const options = q['options'];
    if (Array.isArray(options) && options.length > 0) {
      const opts = options.filter((o) => typeof o === 'string').join(' · ');
      const rec = str(q['recommended']);
      if (opts) lines.push(`   ${opts}${rec ? ` (suggested: ${rec})` : ''}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** Map ACP plan `entries` (`[{content,priority,status}]`) onto plan steps. */
export function acpPlanSteps(entries: unknown): PlanStepBlock[] {
  return Array.isArray(entries) ? extractPlanSteps(entries) : [];
}

/** Pull the text output and (first) diff out of an ACP tool's `content` array. */
function extractToolContent(content: unknown): {
  output: string;
  diff?: { path: string; oldText: string; newText: string };
} {
  if (!Array.isArray(content)) return { output: '' };
  const texts: string[] = [];
  let diff: { path: string; oldText: string; newText: string } | undefined;
  for (const item of content) {
    if (!isRecord(item)) continue;
    const type = str(item['type']);
    if (
      type === 'content' &&
      isRecord(item['content']) &&
      str(item['content']['type']) === 'text'
    ) {
      texts.push(str(item['content']['text']));
    } else if (type === 'diff' && !diff) {
      diff = {
        path: str(item['path']),
        oldText: str(item['oldText']),
        newText: str(item['newText']),
      };
    }
  }
  return { output: texts.join('\n'), ...(diff ? { diff } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
