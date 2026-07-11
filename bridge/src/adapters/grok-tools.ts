/**
 * Maps Grok's ACP `tool_call`/`tool_call_update` and `plan` updates onto the
 * bridge's structured MessageContent blocks (via the shared content-blocks
 * builders), so the phone renders Grok's work log / diffs / plan with the SAME
 * widgets as every other agent (plan → PlanCard, diff → DiffBlock, execute →
 * CommandCard). This is the crux of "identical UI per tool type regardless of the
 * agent's own tool names": each agent's adapter normalizes to these canonical
 * blocks, and the phone's renderer is purely block-`type`-driven.
 *
 * Grok's `grok agent stdio` speaks the Agent Client Protocol (ACP v1 — verified
 * live via a handshake), the same protocol as Zero, so the tool shapes match the
 * ACP spec:
 *   toolCall: { toolCallId, title, kind, status, rawInput, content:[ToolCallContent] }
 *   ToolCallContent: { type:'content', content:{type:'text',text} } | { type:'diff', path, oldText, newText }
 *   plan entries: [{ content, priority, status }]
 *
 * ASSUMED tool payload shapes (`kind`/`rawInput` field names) — the ACP envelope
 * is verified, but the per-tool arg names could not be exercised live because the
 * test account's Grok Build balance was exhausted (HTTP 402). Verify against a
 * real Grok turn once balance is restored (bridge/FOR-DEV.md).
 */
import {
  commandBlock,
  editDiffBlock,
  extractPlanSteps,
  toolBlock,
  writeDiffBlock,
  type PlanStepBlock,
} from './content-blocks.js';

/** A merged ACP tool call (initial `tool_call` + later `tool_call_update`s). */
export interface GrokToolCall {
  toolCallId: string;
  title: string;
  /** ACP tool kind: `read`/`edit`/`execute`/`search`/`fetch`/… */
  kind: string;
  /** `pending`/`in_progress`/`completed`/`failed`. */
  status: string;
  /** The tool's arguments. */
  rawInput?: Record<string, unknown>;
  /** ACP `ToolCallContent[]` (text output and/or a diff). */
  content?: unknown[];
}

/** Build the MessageContent block for a terminal Grok tool call. */
export function grokToolBlock(tc: GrokToolCall): Record<string, unknown> {
  const isError = tc.status === 'failed';
  const input = tc.rawInput ?? {};
  const { output, diff } = extractToolContent(tc.content);
  const kind = tc.kind.toLowerCase();

  if (kind === 'execute') {
    const command = str(input['command']) || str(input['cmd']) || tc.title;
    return commandBlock(command, output, isError);
  }
  if (diff) {
    return editDiffBlock(diff.path, diff.oldText, diff.newText);
  }
  if (kind === 'edit') {
    // A write with no diff content: synthesize an all-additions diff from the args.
    const path = str(input['path']) || str(input['filePath']) || str(input['file_path']);
    if (path) return writeDiffBlock(path, str(input['content']));
  }
  // `ask_user`: not wired as an interactive channel over ACP (Grok drives its own
  // TUI approval flow via `session/request_permission`, which we route to the
  // phone's approval card). When Grok surfaces an ask-user *tool* instead, we
  // can't answer it, so we surface the questions legibly rather than dumping the
  // raw args — mirroring Zero's handling.
  const asked = formatAskUser(input);
  if (asked) {
    const note =
      output ||
      'No interactive answer was available, so the agent continued with its best assumption.';
    return toolBlock(tc.title || 'ask_user', tc.toolCallId, {}, `${asked}\n\n${note}`, isError);
  }
  return toolBlock(tc.title || tc.kind || 'tool', tc.toolCallId, input, output, isError);
}

/**
 * Render an `ask_user` `rawInput` (`{ header?, questions:[{question, options?,
 * recommended?}] }`) as a readable prompt. Returns undefined when the args aren't
 * an ask_user shape, so the caller falls back to the generic block.
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
export function grokPlanSteps(entries: unknown): PlanStepBlock[] {
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
