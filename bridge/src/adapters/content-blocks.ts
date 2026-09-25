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
  AssistantResponseBoundaryBlock,
  AssistantResponsePhase,
  ApprovalRequestBlock,
  ApprovalRisk,
  CompactionContentBlock,
  CompactionReason,
  QuestionItem,
  QuestionRequestBlock,
  SubagentContentBlock,
  ToolContentBlock,
  ToolKind,
} from '@uxnan/shared';
import { isAbsolute, relative, resolve } from 'node:path';

/** Marks the end of one native assistant response item within a turn. */
export function assistantResponseBoundaryBlock(
  phase: AssistantResponsePhase = 'unknown',
  itemId?: string,
): AssistantResponseBoundaryBlock {
  return {
    type: 'assistant_response_boundary',
    phase,
    ...(itemId !== undefined && itemId.length > 0 ? { itemId } : {}),
  };
}

/** A durable marker for a context compaction the agent explicitly reported. */
export function compactionBlock(
  reason: CompactionReason = 'unknown',
  opts: { tokensBefore?: number; tokensAfter?: number } = {},
): CompactionContentBlock {
  return {
    type: 'compaction',
    reason,
    ...(opts.tokensBefore !== undefined ? { tokensBefore: opts.tokensBefore } : {}),
    ...(opts.tokensAfter !== undefined ? { tokensAfter: opts.tokensAfter } : {}),
  };
}

/** Cap tool/command output carried on the wire so a big read doesn't bloat it. */
const MAX_OUTPUT = 4000;

/** Truncates long tool/command output for the wire. */
export function truncateOutput(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (truncated)` : text;
}

/** Splits text into lines (empty → no lines; a closing newline ends the last line). */
function lines(text: string): string[] {
  if (text.length === 0) return [];
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all[all.length - 1] === '') all.pop();
  return all;
}

/** One line of a line diff: kept (` `), removed (`-`) or added (`+`). */
interface DiffOp {
  op: ' ' | '-' | '+';
  line: string;
}

/** Above this many cells the LCS table is not worth it: the middle is replaced whole. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * The line diff of two texts: the shared head and tail are kept, and the part
 * between them is aligned by longest common subsequence, so an edit shows the
 * lines it changed — not the whole file removed and written again.
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = lines(oldText);
  const b = lines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const ops: DiffOp[] = a.slice(0, head).map((line) => ({ op: ' ', line }));
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  if (n > 0 && m > 0 && n * m <= MAX_LCS_CELLS) {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..], flattened.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1]! + 1
            : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ op: ' ', line: midA[i]! });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
        ops.push({ op: '-', line: midA[i]! });
        i += 1;
      } else {
        ops.push({ op: '+', line: midB[j]! });
        j += 1;
      }
    }
    while (i < n) ops.push({ op: '-', line: midA[i++]! });
    while (j < m) ops.push({ op: '+', line: midB[j++]! });
  } else {
    ops.push(...midA.map((line) => ({ op: '-' as const, line })));
    ops.push(...midB.map((line) => ({ op: '+' as const, line })));
  }
  ops.push(...a.slice(a.length - tail).map((line) => ({ op: ' ' as const, line })));
  return ops;
}

function countOps(ops: DiffOp[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const { op } of ops) {
    if (op === '+') additions += 1;
    else if (op === '-') deletions += 1;
  }
  return { additions, deletions };
}

/** Lines of context a whole-file diff keeps around each change. */
const DIFF_CONTEXT = 3;

/**
 * A `diff` block for a whole file before and after a change: real unified
 * hunks with their line numbers and three lines of context — what `git diff`
 * would show. For an agent that reports the full text of both sides, or when
 * the bridge read the file around the edit itself.
 */
export function fileDiffBlock(
  filename: string,
  oldText: string,
  newText: string,
): Record<string, unknown> {
  const ops = diffLines(oldText, newText);
  const hunks: string[] = [];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  while (index < ops.length) {
    // Skip to the next change, counting the lines passed.
    let next = index;
    while (next < ops.length && ops[next]!.op === ' ') next += 1;
    if (next === ops.length) break;
    const lead = Math.min(DIFF_CONTEXT, next - index);
    oldLine += next - index - lead;
    newLine += next - index - lead;
    const start = next - lead;
    // Extend while the gap to the following change is short enough to join.
    let end = next;
    for (;;) {
      while (end < ops.length && ops[end]!.op !== ' ') end += 1;
      let gap = end;
      while (gap < ops.length && ops[gap]!.op === ' ') gap += 1;
      if (gap < ops.length && gap - end <= DIFF_CONTEXT * 2) {
        end = gap;
        continue;
      }
      end = Math.min(end + DIFF_CONTEXT, gap);
      break;
    }
    const body = ops.slice(start, end);
    const oldCount = body.filter((o) => o.op !== '+').length;
    const newCount = body.filter((o) => o.op !== '-').length;
    hunks.push(
      `@@ -${oldCount === 0 ? oldLine - 1 : oldLine},${oldCount} +${newCount === 0 ? newLine - 1 : newLine},${newCount} @@`,
      ...body.map((o) => `${o.op}${o.line}`),
    );
    oldLine += oldCount;
    newLine += newCount;
    index = end;
  }
  return { type: 'diff', filename, diff: hunks.join('\n'), ...countOps(ops) };
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

/**
 * A `diff` block for one or more edits described as old → new snippets (where
 * in the file they sit is unknown): each snippet's changed lines, with the
 * lines it kept as context.
 */
export function multiEditDiffBlock(
  filename: string,
  edits: { old: string; new: string }[],
): Record<string, unknown> {
  const ops = edits.flatMap((edit) => diffLines(edit.old, edit.new));
  return {
    type: 'diff',
    filename,
    diff: ops.map((o) => `${o.op}${o.line}`).join('\n'),
    ...countOps(ops),
  };
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

/**
 * A system **warning** block: something the user needs to know about the turn
 * that is not a failure of the turn itself.
 *
 * Used for background work an agent left running that its CLI then killed —
 * the turn did produce its reply, so `errorBlock` would overstate it, but the
 * work the agent promised silently did not happen. Same `SystemContent` wire
 * shape as `errorBlock` with `kind:'warning'`, which the phone already renders
 * with its own icon and colour.
 */
export function warningBlock(text: string): Record<string, unknown> {
  return { type: 'system', text: truncateOutput(text), kind: 'warning' };
}

/** Tool names by what they do, compared lowercase without `_`/`-`/spaces. */
const KIND_BY_NAME: Record<string, ToolKind> = {
  read: 'read',
  readfile: 'read',
  viewfile: 'read',
  view: 'read',
  notebookread: 'read',
  viewimage: 'read',
  imageview: 'read',
  grep: 'search',
  grepsearch: 'search',
  search: 'search',
  searchfiles: 'search',
  codebasesearch: 'search',
  glob: 'search',
  find: 'search',
  findfiles: 'search',
  findbyname: 'search',
  ls: 'list',
  list: 'list',
  listdir: 'list',
  listfiles: 'list',
  listdirectory: 'list',
  webfetch: 'fetch',
  fetch: 'fetch',
  readurl: 'fetch',
  readurlcontent: 'fetch',
  urlfetch: 'fetch',
  websearch: 'web_search',
  searchweb: 'web_search',
  googlesearch: 'web_search',
};

/** The argument keys a target is read from, per kind, in order. */
const TARGET_KEYS: Record<ToolKind, string[]> = {
  read: ['file_path', 'filePath', 'path', 'AbsolutePath', 'target_file', 'notebook_path', 'uri'],
  list: ['path', 'DirectoryPath', 'directory', 'dir', 'dirPath', 'target_directory'],
  search: ['pattern', 'Pattern', 'query', 'Query', 'regex', 'glob', 'name', 'SearchPattern'],
  fetch: ['url', 'Url', 'URL', 'uri'],
  web_search: ['query', 'Query', 'q', 'search_term'],
  mcp: [],
  other: [],
};

/** Keys any tool is best summarized by, when its kind has none. */
const SUMMARY_KEYS = [
  'command',
  'file_path',
  'filePath',
  'path',
  'AbsolutePath',
  'url',
  'pattern',
  'query',
  'description',
  'prompt',
  'code',
  'skill',
  'name',
];

/** The first line of a value, capped: a target is one line of a row. */
function oneLine(value: string): string {
  const first = value.trim().split('\n', 1)[0] ?? '';
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

function firstString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  return '';
}

/**
 * What a tool call did and what it acted on, from its name and arguments —
 * the classification every agent's tools go through ({@link toolBlock}).
 * `hint.kind` wins when the agent says itself (an ACP `kind`, a Codex item
 * type); a Grok-style `variant` argument names the real tool when the name
 * is a title.
 */
export function describeTool(
  toolName: string,
  input: Record<string, unknown>,
  hint: { kind?: ToolKind } = {},
): { kind: ToolKind; target?: string } {
  const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');
  const variant = typeof input['variant'] === 'string' ? input['variant'] : '';
  const kind: ToolKind =
    hint.kind ??
    (/^mcp__/.test(toolName) ? 'mcp' : undefined) ??
    KIND_BY_NAME[normalize(variant)] ??
    KIND_BY_NAME[normalize(toolName)] ??
    'other';
  let target = firstString(input, TARGET_KEYS[kind]);
  if (kind === 'search' && target) {
    const where = firstString(input, ['path', 'SearchPath', 'directory', 'include']);
    if (where && where !== '.') target = `${target} · ${where}`;
  }
  if (!target) target = firstString(input, SUMMARY_KEYS);
  return { kind, ...(target ? { target } : {}) };
}

/**
 * A `tool` block: a call that is not a shell command, an edit, a plan or a
 * subagent, classified by {@link describeTool} so every client can say what
 * it did without knowing the agent.
 */
export function toolBlock(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
  hint: { kind?: ToolKind } = {},
): Record<string, unknown> {
  const trimmed = truncateOutput(output);
  return {
    type: 'tool',
    toolName,
    toolId,
    input,
    ...(trimmed ? { output: trimmed } : {}),
    isError,
    ...describeTool(toolName, input, hint),
  } satisfies ToolContentBlock;
}

/** A finished subagent: what it was asked, how it ended, and its report. */
export function subagentBlock(
  id: string,
  name: string,
  output: string,
  isError: boolean,
): Record<string, unknown> {
  const trimmed = truncateOutput(output.trim());
  return {
    type: 'subagent',
    state: {
      id,
      name: oneLine(name) || 'Subagent',
      status: isError ? 'error' : 'completed',
      ...(trimmed ? { output: trimmed } : {}),
    },
  } satisfies SubagentContentBlock;
}

/**
 * The command a shell wrapper runs: `/bin/zsh -lc 'ls -la'` → `ls -la`.
 * Codex reports every command through the user's login shell; the row should
 * show what ran, not how it was launched. Anything that is not exactly one
 * `sh`-family `-c` / `-lc` with one argument is returned as it came.
 */
export function unwrapShellCommand(command: string): string {
  const match = /^(?:\S*\/)?(?:ba|z|da|k|fi)?sh\s+-(?:l?c|cl)\s+([\s\S]+)$/.exec(command.trim());
  if (!match) return command;
  const word = readShellWord(match[1]!);
  return word !== undefined && word.trim().length > 0 ? word : command;
}

/** Reads exactly one POSIX shell word (quotes and escapes resolved), or undefined. */
function readShellWord(text: string): string | undefined {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return undefined;
      out += text.slice(i + 1, close);
      i = close + 1;
    } else if (c === '"') {
      i += 1;
      for (;;) {
        if (i >= text.length) return undefined;
        const d = text[i]!;
        if (d === '"') break;
        if (d === '\\' && i + 1 < text.length && '$`"\\\n'.includes(text[i + 1]!)) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        out += d;
        i += 1;
      }
      i += 1;
    } else if (c === '\\') {
      if (i + 1 >= text.length) return undefined;
      out += text[i + 1];
      i += 2;
    } else if (/\s/.test(c)) {
      return text.slice(i).trim().length === 0 ? out : undefined;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** macOS reaches `/var` and `/tmp` through `/private`; agents report either spelling. */
function withoutPrivate(path: string): string {
  return path.replace(/^\/private(?=\/(?:var|tmp)\/)/, '');
}

/** `path` relative to `cwd` when it lies inside it; anything else as it came. */
export function projectRelative(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(withoutPrivate(resolve(cwd)), withoutPrivate(path));
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

/**
 * A block with its paths shown from the project: a diff's file and a tool's
 * target become `src/app.ts` instead of the absolute path some agents report.
 * Applied once, by the agent manager, to every block of every agent.
 */
export function withProjectPaths(block: unknown, cwd: string | undefined): unknown {
  if (!cwd || typeof block !== 'object' || block === null || Array.isArray(block)) return block;
  const b = block as Record<string, unknown>;
  if (b['type'] === 'diff' && typeof b['filename'] === 'string') {
    return { ...b, filename: projectRelative(b['filename'], cwd) };
  }
  if (b['type'] === 'tool' && typeof b['target'] === 'string') {
    const target = b['target']
      .split(' · ')
      .map((part) => projectRelative(part, cwd))
      .join(' · ');
    return { ...b, target };
  }
  return block;
}
