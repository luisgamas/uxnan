/**
 * Bounded history: how the bridge serves a conversation so that no cost grows
 * with its length (architecture/02a §5.8.8, 02b `turn/list`).
 *
 * A page (`turn/list`, `turn/read`) carries a turn the way it reads — the
 * user's message, the assistant's prose in full — with every run of
 * consecutive steps (commands, edits, tool calls, thoughts) folded into ONE
 * {@link WorkRunSegment} that says what the run amounts to. What a client
 * opens is fetched on demand: a run's steps as {@link StepPreview}s
 * (`turn/steps`), one step whole (`turn/step`) — a thought's whole text too.
 *
 * A step is addressed by its **index in the stored `segments`** of the turn's
 * assistant message. It is stable: a new step is appended (or slotted before
 * the open text run), one that settles is replaced where it stood, and a
 * thought that grows grows where it stands ({@link appendThinkingSegment}).
 *
 * Everything here is pure, so the bridge and any TypeScript client classify
 * and cut a step the same way.
 */
import type { Message, Turn } from './thread.js';

/** Largest serialized `turn/list` page, in UTF-8 bytes (always at least one turn). */
export const TURN_PAGE_MAX_BYTES = 1024 * 1024;

/** Largest serialized `turn/steps` answer, in UTF-8 bytes (always at least one step). */
export const STEP_PAGE_MAX_BYTES = 256 * 1024;

/** A step preview's `command`: its first this-many characters. */
export const STEP_COMMAND_PREVIEW_CHARS = 400;

/** A step preview's `output`: its LAST this-many characters (where a result ends up). */
export const STEP_OUTPUT_PREVIEW_CHARS = 1_200;

/** A thought's preview `text`: its first this-many characters. */
export const STEP_THINKING_PREVIEW_CHARS = 600;

/** How many items of an array inside a tool's `input` a preview keeps. */
const INPUT_PREVIEW_ITEMS = 20;

/** How deep into a tool's `input` a preview follows objects and arrays. */
const INPUT_PREVIEW_DEPTH = 4;

/** The segment types that are steps of the agent's work. */
export type StepType = 'command_execution' | 'diff' | 'tool' | 'thinking';

/** Every {@link StepType}. */
export const STEP_TYPES: readonly StepType[] = ['command_execution', 'diff', 'tool', 'thinking'];

/**
 * A stretch of the agent's reasoning ("thinking"), stored in the assistant
 * message's `segments` where it happened — before the command it led to,
 * between two text runs, wherever the agent thought. It is a step: a page
 * folds it into the {@link WorkRunSegment} it sits in, and `turn/step` gives
 * it whole.
 *
 * It is built from `stream/thinking/delta` chunks by ONE rule, the same on
 * the bridge (live and on journal replay) and on every client: a chunk
 * extends the last segment when that is a thought, and otherwise opens a new
 * thought at the END of `segments` ({@link appendThinkingSegment}). Unlike a
 * `beforeText` block it is never slotted before an open text run: the
 * agent's own reasoning is sequential with its prose, so a thought after
 * text is a new step after it, and the next text delta opens a new run.
 *
 * A thought carries no status: it is never failed, and it is running only
 * while it is the LAST segment of a turn that is still live — which each
 * client derives from the turn's state (nothing on the wire marks it, so no
 * notification has to un-mark it when the next activity arrives).
 */
export interface ThinkingSegment {
  type: 'thinking';
  text: string;
}

const STEP_TYPE_SET: ReadonlySet<string> = new Set(STEP_TYPES);

/**
 * One step as a page or a live notification carries it: the stored block with
 * its large fields cut, plus where it sits ({@link index}) and, for each field
 * that was cut, its full size — so a client knows there is more and fetches
 * it with `turn/step`. Fields the stored block has that are not listed here
 * (`exitCode`, `toolId`, `kind`, `target`, …) pass through unchanged.
 *
 * Sizes are in characters (UTF-16 code units, a JavaScript/Dart string's length).
 */
export type StepPreview =
  | CommandStepPreview
  | DiffStepPreview
  | ToolStepPreview
  | ThinkingStepPreview;

interface StepPreviewBase {
  /** Its index in the stored `segments` of the turn's assistant message. */
  index: number;
  /** The live step it stands for (`LiveBlock`), when it has one. */
  blockId?: string;
}

export interface CommandStepPreview extends StepPreviewBase {
  type: 'command_execution';
  /** The first {@link STEP_COMMAND_PREVIEW_CHARS} characters of the command. */
  command: string;
  /** The command's full length — present only when `command` was cut. */
  commandChars?: number;
  /** The last {@link STEP_OUTPUT_PREVIEW_CHARS} characters of the output. */
  output?: string;
  /** The output's full length — present only when `output` was cut. */
  outputChars?: number;
  /** `running` | `completed` | `error`, as stored. */
  status?: string;
  exitCode?: number;
  [field: string]: unknown;
}

export interface DiffStepPreview extends StepPreviewBase {
  type: 'diff';
  filename: string;
  additions: number;
  deletions: number;
  /** The diff body's length; the body itself never rides a preview. Absent when it had none. */
  diffChars?: number;
  status?: string;
}

export interface ToolStepPreview extends StepPreviewBase {
  type: 'tool';
  toolName: string;
  /**
   * The tool's input with every string cut to {@link STEP_COMMAND_PREVIEW_CHARS}
   * characters, arrays to their first 20 items and nesting to 4 levels.
   */
  input: Record<string, unknown>;
  /** The full input's serialized length — present only when `input` was cut. */
  inputChars?: number;
  /** The last {@link STEP_OUTPUT_PREVIEW_CHARS} characters of the result. */
  output?: string;
  /** The result's full length — present only when `output` was cut. */
  outputChars?: number;
  isError?: boolean;
  status?: string;
  [field: string]: unknown;
}

export interface ThinkingStepPreview extends StepPreviewBase {
  type: 'thinking';
  /** The first {@link STEP_THINKING_PREVIEW_CHARS} characters of the thought. */
  text: string;
  /** The thought's full length — present only when `text` was cut. */
  textChars?: number;
}

/** A file a run of steps changed, once, with its line counts summed. */
export interface ChangedFileSummary {
  filename: string;
  additions: number;
  deletions: number;
}

/**
 * A run of consecutive steps (`command_execution` / `diff` / `tool` /
 * `thinking`) of an assistant message, as pages serve it in place of the
 * steps themselves — a thought between two commands does not split their
 * run. A run ends at anything else in `segments` — a text run (even a blank one), an
 * `assistant_response_boundary`, a plan, a view, any other block — which pages
 * serve as stored. A client that shows two runs separated only by blank text
 * or a boundary as one group may merge them: `turn/steps` skips whatever in
 * its range is not a step.
 */
export interface WorkRunSegment {
  type: 'work';
  /** Index (in the stored `segments`) of the run's first step. */
  from: number;
  /** Index (in the stored `segments`) of the run's last step — inclusive. */
  to: number;
  /** How many of its steps are shell commands. */
  commands: number;
  /** How many are edits (`diff`). */
  edits: number;
  /** How many are other tool calls. */
  tools: number;
  /** How many are thoughts ({@link ThinkingSegment}). */
  thoughts: number;
  /** How many failed ({@link stepFailed}). */
  failed: number;
  /**
   * How many are still running ({@link stepRunning}). A thought is never
   * counted: whether one is still being written is derived by the client (it
   * is the last segment of a live turn — {@link ThinkingSegment}).
   */
  running: number;
  /** The files its edits touched, merged by name, in first-touched order. */
  files: ChangedFileSummary[];
  /** Its last step, as a preview. */
  last: StepPreview;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Whether a segment is a step of the agent's work (a command, an edit, a tool call, a thought). */
export function isStep(segment: unknown): segment is Record<string, unknown> & { type: StepType } {
  const type = record(segment)?.['type'];
  return typeof type === 'string' && STEP_TYPE_SET.has(type);
}

/** Whether a segment is a {@link WorkRunSegment} — for a client validating a page. */
export function isWorkRunSegment(segment: unknown): segment is WorkRunSegment {
  const s = record(segment);
  if (!s || s['type'] !== 'work') return false;
  const counts = ['from', 'to', 'commands', 'edits', 'tools', 'thoughts', 'failed', 'running'];
  if (!counts.every((key) => Number.isInteger(s[key]) && (s[key] as number) >= 0)) return false;
  if ((s['from'] as number) > (s['to'] as number)) return false;
  return Array.isArray(s['files']) && isStepPreview(s['last']);
}

/** Whether a value is a {@link StepPreview} — for a client validating a page or a notification. */
export function isStepPreview(value: unknown): value is StepPreview {
  const v = record(value);
  return !!v && isStep(v) && Number.isInteger(v['index']) && (v['index'] as number) >= 0;
}

/** Whether a segment is a {@link ThinkingSegment}. */
export function isThinkingSegment(segment: unknown): segment is ThinkingSegment {
  const s = record(segment);
  return !!s && s['type'] === 'thinking' && typeof s['text'] === 'string';
}

/**
 * Adds a reasoning chunk to an assistant message's [segments], in place — the
 * one rule ({@link ThinkingSegment}): the last segment grows when it is a
 * thought, otherwise a new thought is appended. An empty chunk changes
 * nothing. Returns whether it changed anything.
 */
export function appendThinkingSegment(segments: unknown[], delta: string): boolean {
  if (delta.length === 0) return false;
  const last = segments[segments.length - 1];
  if (isThinkingSegment(last)) last.text += delta;
  else segments.push({ type: 'thinking', text: delta } satisfies ThinkingSegment);
  return true;
}

/**
 * Whether a step failed: an error status, a tool error, a failed subagent, a
 * non-zero exit. The one rule every client counts a run's failures by. A
 * thought never fails.
 */
export function stepFailed(block: Record<string, unknown>): boolean {
  if (block['status'] === 'error' || block['isError'] === true) return true;
  if (record(block['state'])?.['status'] === 'error') return true;
  return typeof block['exitCode'] === 'number' && block['exitCode'] !== 0;
}

/**
 * Whether a step is still running, by its status. A thought has none, so this
 * is always `false` for one: a client shows a thought as running while it is
 * the last segment of a live turn ({@link ThinkingSegment}).
 */
export function stepRunning(block: Record<string, unknown>): boolean {
  const status = block['status'];
  if (status === 'running' || status === 'in_progress') return true;
  const state = record(block['state'])?.['status'];
  return state === 'running' || state === 'in_progress';
}

/** The first [max] characters of [text], never splitting a surrogate pair. */
function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

/** The last [max] characters of [text], never splitting a surrogate pair. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const start = text.length - max;
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** A tool input with its strings, arrays and nesting bounded; `cut` says whether anything was. */
function boundInput(value: unknown, depth: number, cut: { cut: boolean }): unknown {
  if (typeof value === 'string') {
    if (value.length <= STEP_COMMAND_PREVIEW_CHARS) return value;
    cut.cut = true;
    return head(value, STEP_COMMAND_PREVIEW_CHARS);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= INPUT_PREVIEW_DEPTH) {
    cut.cut = true;
    return Array.isArray(value) ? [] : {};
  }
  if (Array.isArray(value)) {
    if (value.length > INPUT_PREVIEW_ITEMS) cut.cut = true;
    return value.slice(0, INPUT_PREVIEW_ITEMS).map((item) => boundInput(item, depth + 1, cut));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = boundInput(item, depth + 1, cut);
  return out;
}

/** Cuts a preview's `output` to its last {@link STEP_OUTPUT_PREVIEW_CHARS} characters, in place. */
function cutOutput(out: Record<string, unknown>): void {
  const output = out['output'];
  if (typeof output !== 'string' || output.length <= STEP_OUTPUT_PREVIEW_CHARS) return;
  out['output'] = tail(output, STEP_OUTPUT_PREVIEW_CHARS);
  out['outputChars'] = output.length;
}

/**
 * The preview of the step stored at [index]: a command's first
 * {@link STEP_COMMAND_PREVIEW_CHARS} characters and its output's last
 * {@link STEP_OUTPUT_PREVIEW_CHARS}; an edit's name and line counts without
 * its body; a tool's input bounded and its result's tail. Each cut field
 * reports its full size. A thought's preview is its first
 * {@link STEP_THINKING_PREVIEW_CHARS} characters.
 */
export function previewStep(
  block: Record<string, unknown> & { type: StepType },
  index: number,
): StepPreview {
  switch (block.type) {
    case 'diff': {
      const out: Record<string, unknown> = {
        type: 'diff',
        index,
        filename: typeof block['filename'] === 'string' ? block['filename'] : '',
        additions: typeof block['additions'] === 'number' ? block['additions'] : 0,
        deletions: typeof block['deletions'] === 'number' ? block['deletions'] : 0,
      };
      if (typeof block['blockId'] === 'string') out['blockId'] = block['blockId'];
      if (typeof block['status'] === 'string') out['status'] = block['status'];
      const body = block['diff'];
      if (typeof body === 'string' && body.length > 0) out['diffChars'] = body.length;
      return out as unknown as DiffStepPreview;
    }
    case 'command_execution': {
      const out: Record<string, unknown> = { ...block, index };
      const command = block['command'];
      if (typeof command === 'string' && command.length > STEP_COMMAND_PREVIEW_CHARS) {
        out['command'] = head(command, STEP_COMMAND_PREVIEW_CHARS);
        out['commandChars'] = command.length;
      } else if (typeof command !== 'string') {
        out['command'] = '';
      }
      cutOutput(out);
      return out as CommandStepPreview;
    }
    case 'tool': {
      const out: Record<string, unknown> = { ...block, index };
      if (typeof block['toolName'] !== 'string') out['toolName'] = '';
      const input = record(block['input']) ?? {};
      const cut = { cut: false };
      out['input'] = boundInput(input, 0, cut);
      if (cut.cut) out['inputChars'] = JSON.stringify(input).length;
      cutOutput(out);
      return out as ToolStepPreview;
    }
    case 'thinking': {
      const text = typeof block['text'] === 'string' ? block['text'] : '';
      const out: ThinkingStepPreview = {
        type: 'thinking',
        index,
        text: head(text, STEP_THINKING_PREVIEW_CHARS),
      };
      if (text.length > STEP_THINKING_PREVIEW_CHARS) out.textChars = text.length;
      return out;
    }
  }
}

/** Folds a run of steps (with their stored indexes) into its {@link WorkRunSegment}. */
function workRun(
  run: readonly { block: Record<string, unknown> & { type: StepType }; index: number }[],
): WorkRunSegment {
  const segment: WorkRunSegment = {
    type: 'work',
    from: run[0]!.index,
    to: run[run.length - 1]!.index,
    commands: 0,
    edits: 0,
    tools: 0,
    thoughts: 0,
    failed: 0,
    running: 0,
    files: [],
    last: previewStep(run[run.length - 1]!.block, run[run.length - 1]!.index),
  };
  const files = new Map<string, ChangedFileSummary>();
  for (const { block } of run) {
    if (block.type === 'command_execution') segment.commands += 1;
    else if (block.type === 'diff') segment.edits += 1;
    else if (block.type === 'thinking') segment.thoughts += 1;
    else segment.tools += 1;
    if (stepFailed(block)) segment.failed += 1;
    if (stepRunning(block)) segment.running += 1;
    const filename = block['filename'];
    if (block.type !== 'diff' || typeof filename !== 'string' || filename.length === 0) continue;
    const additions = typeof block['additions'] === 'number' ? block['additions'] : 0;
    const deletions = typeof block['deletions'] === 'number' ? block['deletions'] : 0;
    const known = files.get(filename);
    if (known) {
      known.additions += additions;
      known.deletions += deletions;
    } else {
      files.set(filename, { filename, additions, deletions });
    }
  }
  segment.files = [...files.values()];
  return segment;
}

/**
 * An assistant message's stored `segments` as a page serves them: each run of
 * consecutive steps becomes one {@link WorkRunSegment}; everything else (text,
 * boundaries, plans, views, approvals, questions, subagents, notices,
 * compactions) is kept as stored.
 */
export function summarizeSegments(segments: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  let run: { block: Record<string, unknown> & { type: StepType }; index: number }[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    out.push(workRun(run));
    run = [];
  };
  segments.forEach((segment, index) => {
    if (isStep(segment)) {
      run.push({ block: segment, index });
      return;
    }
    flush();
    out.push(segment);
  });
  flush();
  return out;
}

/** A message as a page serves it: its steps (thoughts included) folded into runs. */
export function summarizeMessage(message: Message): Message {
  if (!message.segments) return message;
  return { ...message, segments: summarizeSegments(message.segments) };
}

/** A turn as a page (`turn/list`, `turn/read`, `stream/turn/created`) serves it. */
export function summarizeTurn(turn: Turn): Turn {
  return { ...turn, messages: turn.messages.map(summarizeMessage) };
}

/** The previews `turn/steps` answers with, and where to continue when the budget cut them. */
export interface StepPage {
  steps: StepPreview[];
  /** The index to ask from next (`from`), when the budget ended the page before `to`. */
  next?: number;
}

/**
 * The previews of the steps stored at [from]..[to] (inclusive) of [segments]
 * — entries in that range that are not steps are skipped — within
 * [maxBytes] of serialized JSON, always at least one step. [to] past the end
 * reads to the end.
 */
export function previewStepRange(
  segments: readonly unknown[],
  from: number,
  to: number,
  maxBytes: number = STEP_PAGE_MAX_BYTES,
): StepPage {
  const steps: StepPreview[] = [];
  const last = Math.min(to, segments.length - 1);
  // `[` + `]` and one comma per step after the first.
  let used = 2;
  for (let index = from; index <= last; index++) {
    const segment = segments[index];
    if (!isStep(segment)) continue;
    const preview = previewStep(segment, index);
    const bytes = jsonBytes(preview) + (steps.length > 0 ? 1 : 0);
    if (steps.length > 0 && used + bytes > maxBytes) return { steps, next: index };
    steps.push(preview);
    used += bytes;
  }
  return { steps };
}

/** The UTF-8 size of [value] serialized as JSON. */
export function jsonBytes(value: unknown): number {
  return utf8Length(JSON.stringify(value) ?? '');
}

/** The UTF-8 size of [text], without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}
