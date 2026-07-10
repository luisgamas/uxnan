/**
 * Maps Zero's ACP `tool_call`/`tool_call_update` and `plan` updates onto the
 * bridge's structured MessageContent blocks (via the shared content-blocks
 * builders), so the phone renders Zero's work log / diffs / plan like any other
 * agent's.
 *
 * ACP tool shapes (verified against zero `internal/acp/types.go`):
 *   toolCall: { toolCallId, title, kind, status, rawInput, content:[ToolCallContent] }
 *   ToolCallContent: { type:'content', content:{type:'text',text} } | { type:'diff', path, oldText, newText }
 *   plan entries: [{ content, priority, status }]
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
export interface ZeroToolCall {
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

/** Build the MessageContent block for a terminal Zero tool call. */
export function zeroToolBlock(tc: ZeroToolCall): Record<string, unknown> {
  const isError = tc.status === 'failed';
  const input = tc.rawInput ?? {};
  const { output, diff } = extractToolContent(tc.content);
  const kind = tc.kind.toLowerCase();

  if (kind === 'execute') {
    const command = str(input['cmd']) || str(input['command']) || tc.title;
    return commandBlock(command, output, isError);
  }
  if (diff) {
    return editDiffBlock(diff.path, diff.oldText, diff.newText);
  }
  if (kind === 'edit') {
    // A write with no diff content: synthesize an all-additions diff from the args.
    const path = str(input['path']) || str(input['filePath']);
    if (path) return writeDiffBlock(path, str(input['content']));
  }
  // `ask_user`: non-interactive over ACP (Zero's ACP agent wires no OnAskUser
  // handler, so it auto-completes with "proceed with your best assumption"). We
  // can't answer it, but we surface the questions it asked legibly instead of a
  // raw-args dump, so the user at least sees what the agent wanted to know.
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
 * Render Zero's `ask_user` `rawInput` (`{ header?, questions:[{question,
 * options?, recommended?}] }`) as a readable prompt. Returns undefined when the
 * args aren't an ask_user shape, so the caller falls back to the generic block.
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
export function zeroPlanSteps(entries: unknown): PlanStepBlock[] {
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
