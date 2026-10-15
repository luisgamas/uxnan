/**
 * Antigravity adapter (Google's Antigravity CLI, the `agy` binary — real agent).
 *
 * Antigravity is Google's successor to the now-deprecated standalone Gemini CLI:
 * its models ARE the Gemini family ("Gemini 3.8 Flash", "Gemini 3.1 Pro", …) plus
 * a few hosted others. It does NOT speak the generic bridge agent IPC. The bridge
 * keeps ONE resident `agy` process per thread and drives it over its NDJSON
 * surface (`--input-format stream-json --output-format stream-json`): a user
 * message is one JSON line on stdin, and every line on stdout is a JSON event.
 * Validated live against `agy` 1.2.7.
 *
 * Process shape (spawned on a thread's first turn, reused by the next ones):
 *   agy [--conversation <id>] --add-dir <cwd> \
 *       (--dangerously-skip-permissions | --mode plan) \
 *       --input-format stream-json --output-format stream-json \
 *       --print-timeout 2h [--model <id>]
 *
 * Why each flag (each verified live — earlier `agy` releases lacked several of
 * them, which is why Antigravity was previously deferred, see bridge/FOR-DEV.md):
 *  - `--conversation <id>`: session continuity. `agy` **owns** the conversation
 *    id: a first turn runs without the flag, `agy` creates the conversation and
 *    announces the id on its `init` event, and every later spawn for the same
 *    thread (a recycle, a restart after the idle teardown) passes that id back to
 *    resume it. A client-minted UUID no longer works — since 1.2.x an unknown id
 *    is answered with `warning: conversation "<id>" not found` and a NEW
 *    conversation, so the thread silently lost its history every turn. Stored
 *    per thread in {@link AntigravityAdapter.nativeSessionId}.
 *  - `--add-dir <cwd>`: workspace targeting. `agy` has NO `-C/--cwd`; without
 *    `--add-dir` it ignores the process cwd and edits a private scratch folder,
 *    so we add the thread's project dir as the workspace root.
 *  - permission flag: `agy`'s headless mode has NO interactive approval channel —
 *    a tool that needs permission is AUTO-DENIED unless we pass
 *    `--dangerously-skip-permissions`. Antigravity offers no access modes to
 *    choose from (it cannot ask, and the apps show no selector for it): every
 *    turn runs in the configured posture, `bypassPermissions` by default.
 *  - `--input-format stream-json`: "reads one NDJSON message per line from stdin
 *    and runs a turn for each" (`agy --help`), which is what keeps the process
 *    resident: the same authenticated process answers turn after turn. It
 *    requires `--output-format stream-json`.
 *  - `--print-timeout 2h`: a cap on ONE turn, not on the process — verified: a
 *    resident process outlived an 8 s cap by 12 s of idling and answered the
 *    next turn. It only bounds a runaway turn.
 *  - `--model <id>`: the id column of `agy models` (e.g. `gemini-3.7-flash-high`),
 *    which already carries the reasoning tier — a tier-less id is rejected with
 *    "requires --effort", so the bridge never passes `--effort` separately;
 *    omitted → `agy`'s own default.
 *
 * Why resident instead of one process per turn: every `agy` start re-runs the
 * Google sign-in check and environment setup. Measured on the same machine, the
 * first turn of a process answered in 2.5 s and the second in 1.0 s; the one-shot
 * shape paid the cold start on every turn. The process is torn down after
 * {@link DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS} without a turn, when the thread's
 * cwd / model / posture changes (a fresh process resumes the same conversation),
 * on cancel, and when the thread is archived or deleted.
 *
 * What the stream carries (captured from real turns, see bridge/docs/agents.md →
 * *Drive surface*):
 *  - `init` — `conversation_id` + the workspace and tool list; once per process.
 *  - `step_update` — `user_input`, `agent_response` (with `text_delta` while
 *    `ACTIVE`, and per-model-call `usage` when `DONE`) and `tool` steps
 *    (`tool_name` + `tool_info.parameters`, then `DONE`/`ERROR`).
 *  - `result` — `status`, the full `response`, and `usage` **summed over the
 *    whole conversation** (`num_turns` says how many), NOT the current context.
 *  - No reasoning text. `thinking_tokens` is a count; the model's thoughts are
 *    never emitted on this surface, so no `thinking` event is produced for
 *    Antigravity (they exist in `agy`'s private transcript on disk, which the
 *    bridge deliberately does not read — bridge/FOR-DEV.md, *native-session
 *    history*).
 *
 * Critical detail: the prompt travels as a JSON line on stdin (never argv, never
 * a shell — `shell:false`), so it is never interpolated into a shell. `agy`'s
 * verbose logs go to a log file; STDERR carries only real diagnostics, surfaced
 * as the turn error when a turn produced no answer.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/agents.md.
 */
import { onLines } from '../json-lines.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentMcpServer,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import {
  commandBlock,
  compactionBlock,
  editDiffBlock,
  fileDiffBlock,
  planBlock,
  runningBlock,
  subagentBlock,
  toolBlock,
  withBlockId,
  writeDiffBlock,
  type PlanStepBlock,
} from './content-blocks.js';
import { REASONING_KEY, effortValues, reasoningOption, reasoningValue } from './run-options.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';
import { proxyLaunchEnv } from './mcp-proxy.js';

/**
 * How long a thread's resident `agy` process may sit without a turn before it is
 * torn down (24 hours). Every completed turn re-arms the countdown. A later turn
 * simply spawns a new process on the same conversation, so the timeout costs the
 * user one cold start, never any history.
 */
export const DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * `--print-timeout` for a turn: how long `agy` lets ONE turn run before giving up
 * on it. Per turn, not per process (verified live) — it bounds a runaway turn
 * without touching an idle resident process.
 */
const TURN_TIMEOUT = '2h';

/** Hard cap on the `agy models` spawn before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

/**
 * Hard cap on the `agy -p /model` spawn that reads the account's default model
 * (about 5 s on a cold start). It runs beside `agy models`, so a slow answer
 * only costs the default mark, never the list.
 */
const ACCOUNT_MODEL_TIMEOUT_MS = 10_000;

/** How long a folder's skill list is reused before `agy` is asked again. */
const COMMANDS_TTL_MS = 60_000;

/** Hard cap on the `agy -p /skills` spawn (it answers in ~4-5 s, a cold start). */
const COMMANDS_TIMEOUT_MS = 20_000;

/** What a skill name looks like in `/skills` output: no spaces, no punctuation soup. */
const SKILL_NAME = /^[A-Za-z0-9][\w.:-]*$/;

/**
 * The skills in `agy -p /skills` output: one `name<TAB>description` line each
 * (`agy` 1.2.11), the workspace's own and the user's. Anything else — a blank
 * line, a warning — is skipped.
 */
export function parseAntigravitySkills(output: string): AgentCommand[] {
  const commands: AgentCommand[] = [];
  const seen = new Set<string>();
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const tab = line.indexOf('\t');
    const name = (tab >= 0 ? line.slice(0, tab) : line).trim();
    if (!SKILL_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    const description = tab >= 0 ? line.slice(tab + 1).trim() : '';
    commands.push({
      name,
      ...(description ? { description } : {}),
      source: 'skill',
      headlessSupported: true,
    });
  }
  return commands;
}

/**
 * `/compact`: summarize the conversation to free its context. On the stream-json
 * surface `agy` runs it as a `checkpoint` step (verified on `agy` 1.3.5), so it
 * is a turn like any other that answers nothing.
 */
const ANTIGRAVITY_COMPACT_COMMAND: AgentCommand = {
  name: 'compact',
  description: 'Summarize the conversation to free up context',
  source: 'builtin',
  headlessSupported: true,
};

const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  // `agy` runs its tools without a per-turn approval RPC in headless mode (it
  // cannot prompt), so no interactive approval channel is advertised.
  approvals: false,
  // Antigravity operates autonomously ("YOLO"): with `--dangerously-skip-
  // permissions` it acts and edits without per-action approval prompts, because
  // its headless CLI exposes no pre-tool approval channel. The phone surfaces
  // this so the user knows Antigravity won't ask before running tools.
  autonomous: true,
  // `--conversation <id>` resumes the thread's own conversation on a new process.
  forking: true,
  // The bridge delivers an attachment as a file in the workspace, and `agy`
  // opens it with its own file tools (its models are the multimodal Gemini
  // family). Verified against `agy --add-dir <cwd>` with a four-quadrant probe
  // image, which it described correctly.
  images: true,
  // Under `--output-format stream-json` every `agent_response` step reports its
  // model call's `usage`; the last one of a turn is the context the conversation
  // occupies (see `contextTokens`). Captured from real runs on `agy` 1.2.7.
  reportsContextUsage: true,
  // Its skills, as `agy -p /skills` lists them; each runs as `/name args`.
  commands: true,
};

/**
 * Tool posture passed to `agy`:
 *  - `plan`              → `--mode plan` (read-only; analyses and plans, no edits);
 *  - `acceptEdits`       → `--dangerously-skip-permissions` (autonomous edits);
 *  - `bypassPermissions` → `--dangerously-skip-permissions` (autonomous edits).
 *
 * `agy`'s headless mode has only two effective postures — "act autonomously" and
 * "just plan" — because `--mode accept-edits` still auto-denies writes without a
 * prompt (verified), so both edit-capable modes map to skip-permissions.
 */
export type AntigravityPermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions';

/** The CLI flags for a resolved {@link AntigravityPermissionMode}. */
export function permissionArgs(mode: AntigravityPermissionMode): string[] {
  return mode === 'plan' ? ['--mode', 'plan'] : ['--dangerously-skip-permissions'];
}

/**
 * Map the shared per-agent config `permissionMode` (`default | acceptEdits |
 * bypassPermissions`) to an {@link AntigravityPermissionMode}. `agy` has no
 * "read-only tools" posture short of plan mode, so `default`/unset resolves to
 * autonomous `bypassPermissions` — the only posture that lets `agy` edit at all
 * headless.
 */
export function antigravityPermissionMode(
  configured?: 'default' | 'acceptEdits' | 'bypassPermissions',
): AntigravityPermissionMode {
  return configured === 'acceptEdits' || configured === 'bypassPermissions'
    ? configured
    : 'bypassPermissions';
}

/**
 * The `usage` block `agy` attaches to a `DONE` `agent_response` step (one model
 * call) and to `result` (summed over the conversation). Field names verbatim.
 */
export interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

/** `tool_info` of a `tool` step: the call, and its output or error once done. */
export interface AntigravityToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: string;
  error?: {
    type?: string;
    message?: string;
  };
}

/**
 * One `step_update` event. A step is a `user_input`, an `agent_response` or a
 * `tool` call; it goes `ACTIVE` (with `text_delta` fragments for a response)
 * and then `DONE` or `ERROR`, the terminal update carrying `duration_seconds`
 * and — for a response — the model call's `usage`.
 */
export interface AntigravityStepUpdate {
  conversation_id?: string;
  step_index?: number;
  state?: 'ACTIVE' | 'DONE' | 'ERROR' | string;
  step_type?: 'user_input' | 'agent_response' | 'tool' | string;
  tool_name?: string;
  tool_info?: AntigravityToolInfo;
  text_delta?: string;
  duration_seconds?: number;
  usage?: AntigravityUsage;
}

/** The `result` event that ends a turn. `usage` here is conversation-wide. */
export interface AntigravityResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AntigravityUsage;
}

export type AntigravityStreamEvent =
  | { kind: 'init'; conversationId?: string; cwd?: string }
  | { kind: 'step_update'; update: AntigravityStepUpdate }
  | { kind: 'result'; result: AntigravityResult }
  | { kind: 'unrecognized'; raw: unknown };

/**
 * The context a conversation occupies after one model call, in the shape the
 * phone's meter expects (`TurnUsage.tokens`: "the latest turn's input + the
 * output it produced"). `agy` splits the prompt into `input_tokens` (fresh) and
 * `cache_read_tokens` (served from cache) — both are context the model read —
 * plus the reply's `output_tokens`. `thinking_tokens` are already inside
 * `output_tokens`, and `total_tokens` is `input + output` without the cache
 * part, so neither is used.
 *
 * NOT `result.usage`: that block is summed over every turn the conversation has
 * run (turn 2 reported 18 324 input tokens = 13 184 from turn 1 + 5 140 of its
 * own, `num_turns: 2`), so a meter fed from it would climb forever.
 *
 * `undefined` when the step carries no usable numbers.
 */
export function contextTokens(usage: AntigravityUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const input = usage.input_tokens ?? 0;
  const cached = usage.cache_read_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const total = input + cached + output;
  return total > 0 ? total : undefined;
}

/** The tools that change a file, whose `TargetFile` the adapter reads around the step. */
export const ANTIGRAVITY_FILE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

/**
 * The checklists the agent keeps for its own task list: `task.md` and `plan.md`
 * in its brain folder (`~/.gemini/antigravity-cli/brain/<conversation>/`),
 * with either separator: on Windows the path comes with backslashes.
 */
const ANTIGRAVITY_CHECKLIST_FILE = /[\\/]brain[\\/][^\\/]+[\\/](?:task|plan)\.md$/;

/** The tools that hand work to a subagent. */
const ANTIGRAVITY_SUBAGENT_TOOLS = new Set(['invoke_subagent', 'browser_subagent']);

/** A file's text before and after a step (`null`: it did not exist). */
export interface AntigravityFileChange {
  before: string | null;
  after: string | null;
}

/** The text of a file, or `null` when it cannot be read (absent, a folder…). */
export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** A file's text at `HEAD`, or `null` when it is not committed (or not in a repository). */
export function committedTextOrNull(path: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:./${basename(path)}`], {
      cwd: dirname(path),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Map a finished `tool` step onto the bridge's structured content blocks.
 *
 * Parameter names are `agy`'s own (captured live): `run_command` carries
 * `CommandLine`; the file tools carry `TargetFile`. Older releases also sent
 * the content (`CodeContent`, `TargetContent` + `ReplacementContent`); 1.2.x
 * sends only the path, once the change is applied, so the adapter passes the
 * text before it (as the agent last read or wrote it this turn, else as
 * committed) and after it as `change` — the diff is then exact, with line
 * numbers. Any other tool becomes a classified tool block whose id is
 * `<tool>_<step_index>` — the step index is unique within a conversation, and
 * `sequence` only stands in for a step that has none.
 */
export function buildAntigravityToolBlock(
  update: AntigravityStepUpdate,
  sequence = 0,
  change?: AntigravityFileChange,
): Record<string, unknown> {
  const toolName = update.tool_name ?? update.tool_info?.name ?? 'tool';
  const params = update.tool_info?.parameters ?? {};
  const out =
    typeof update.tool_info?.output === 'string'
      ? update.tool_info.output
      : (update.tool_info?.error?.message ?? '');
  const isError = update.state === 'ERROR' || Boolean(update.tool_info?.error);
  const text = (key: string): string => (typeof params[key] === 'string' ? params[key] : '');
  const toolId = `${toolName}_${update.step_index ?? sequence}`;

  if (toolName === 'run_command') return commandBlock(text('CommandLine'), out, isError);
  if (ANTIGRAVITY_FILE_TOOLS.has(toolName)) {
    const target = text('TargetFile');
    if (change && (change.before !== null || change.after !== null)) {
      return fileDiffBlock(target, change.before ?? '', change.after ?? '');
    }
    if (toolName === 'write_to_file' && text('CodeContent')) {
      return writeDiffBlock(target, text('CodeContent'));
    }
    if (toolName === 'replace_file_content' && text('TargetContent')) {
      return editDiffBlock(target, text('TargetContent'), text('ReplacementContent'));
    }
    return writeDiffBlock(target, '');
  }
  if (ANTIGRAVITY_SUBAGENT_TOOLS.has(toolName)) {
    const task =
      text('Task') || text('TaskDescription') || text('Prompt') || text('Description') || toolName;
    return subagentBlock(toolId, task, out, isError);
  }
  return toolBlock(toolName, toolId, params, out, isError);
}

/**
 * The steps of a markdown checklist the agent wrote (`- [ ]` pending, `- [/]` in
 * progress, `- [x]` done), in file order. Anything else is not a step. Emphasis
 * markers are dropped from the text: the phone draws the step, not the markdown.
 */
export function parseAntigravityChecklist(markdown: string): PlanStepBlock[] {
  const steps: PlanStepBlock[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\[( |\/|x|X)\]\s+(\S.*?)\s*$/.exec(raw);
    if (!match) continue;
    const description = stripEmphasis(match[2]!);
    if (description.length === 0) continue;
    const mark = match[1];
    const status: PlanStepBlock['status'] =
      mark === 'x' || mark === 'X' ? 'completed' : mark === '/' ? 'in_progress' : 'pending';
    steps.push({ description, status });
  }
  return steps;
}

/** `**bold**`, `__bold__`, `*em*` and `_em_` without their markers. */
function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=$|[\s).,:;!?])/g, '$1$2')
    .trim();
}

/**
 * Parse one line of `agy --output-format stream-json`. `null` for an empty or
 * non-JSON line (the surface emits only JSON; anything else is noise, never an
 * answer); `unrecognized` for a JSON event this adapter does not model.
 */
export function parseAntigravityLine(line: string): AntigravityStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const event = obj['event'];
  if (event === 'init') {
    const init = asObject(obj['init']);
    return {
      kind: 'init',
      conversationId: asString(obj['conversation_id']),
      cwd: asString(init?.['cwd']),
    };
  }
  if (event === 'step_update') {
    const su = asObject(obj['step_update']);
    if (su) return { kind: 'step_update', update: parseStepUpdate(su) };
  }
  if (event === 'result') {
    const result = asObject(obj['result']);
    if (result) return { kind: 'result', result: parseResult(result) };
  }
  return { kind: 'unrecognized', raw: parsed };
}

function parseStepUpdate(su: Record<string, unknown>): AntigravityStepUpdate {
  const update: AntigravityStepUpdate = {};
  const conversationId = asString(su['conversation_id']);
  if (conversationId !== undefined) update.conversation_id = conversationId;
  const stepIndex = asNumber(su['step_index']);
  if (stepIndex !== undefined) update.step_index = stepIndex;
  const state = asString(su['state']);
  if (state !== undefined) update.state = state;
  const stepType = asString(su['step_type']);
  if (stepType !== undefined) update.step_type = stepType;
  const toolName = asString(su['tool_name']);
  if (toolName !== undefined) update.tool_name = toolName;
  const duration = asNumber(su['duration_seconds']);
  if (duration !== undefined) update.duration_seconds = duration;
  const textDelta = asString(su['text_delta']);
  if (textDelta !== undefined) update.text_delta = textDelta;
  const usage = parseUsage(su['usage']);
  if (usage !== undefined) update.usage = usage;
  const toolInfo = asObject(su['tool_info']);
  if (toolInfo) {
    const info: AntigravityToolInfo = {};
    const name = asString(toolInfo['name']);
    if (name !== undefined) info.name = name;
    const parameters = asObject(toolInfo['parameters']);
    if (parameters) info.parameters = parameters;
    const output = asString(toolInfo['output']);
    if (output !== undefined) info.output = output;
    const error = asObject(toolInfo['error']);
    if (error) {
      info.error = {};
      const type = asString(error['type']);
      if (type !== undefined) info.error.type = type;
      const message = asString(error['message']);
      if (message !== undefined) info.error.message = message;
    }
    update.tool_info = info;
  }
  return update;
}

function parseResult(result: Record<string, unknown>): AntigravityResult {
  const out: AntigravityResult = {};
  const conversationId = asString(result['conversation_id']);
  if (conversationId !== undefined) out.conversation_id = conversationId;
  const status = asString(result['status']);
  if (status !== undefined) out.status = status;
  const response = asString(result['response']);
  if (response !== undefined) out.response = response;
  const error = asString(result['error']);
  if (error !== undefined) out.error = error;
  const duration = asNumber(result['duration_seconds']);
  if (duration !== undefined) out.duration_seconds = duration;
  const numTurns = asNumber(result['num_turns']);
  if (numTurns !== undefined) out.num_turns = numTurns;
  const usage = parseUsage(result['usage']);
  if (usage !== undefined) out.usage = usage;
  return out;
}

function parseUsage(value: unknown): AntigravityUsage | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const usage: AntigravityUsage = {};
  for (const key of [
    'input_tokens',
    'output_tokens',
    'thinking_tokens',
    'cache_read_tokens',
    'total_tokens',
  ] as const) {
    const n = asNumber(obj[key]);
    if (n !== undefined) usage[key] = n;
  }
  return usage;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface AntigravityAdapterOptions {
  /** Executable to spawn (found by `locateAgent`, `agents/agent-installs.ts`). */
  binaryPath?: string;
  /** Args prepended before the adapter args (unused for the native `agy` exe). */
  prependArgs?: string[];
  /** Default model id (an `agy models` routing key) when the thread/turn picks none. */
  defaultModel?: string;
  /** Tool posture default when the thread sets no access mode (default `bypassPermissions`). */
  permissionMode?: AntigravityPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
  /**
   * Idle time after which a thread's resident `agy` process is torn down
   * (default {@link DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS}, 24 hours).
   */
  idleTimeoutMs?: number;
}

/** The turn currently running on a resident process (at most one per thread). */
interface ActiveTurn {
  turnId: string;
  /** The answer as streamed (`text_delta`s), the text the phone already saw. */
  fullText: string;
  /** Context after the latest `agent_response` step — the turn's `usage.tokens`. */
  contextTokens: number | undefined;
  /** A `checkpoint` step ended in this turn: the context was compacted. */
  compacted: boolean;
  /** Diagnostics: stderr plus any non-JSON stdout line, surfaced when no answer came. */
  diagnostics: string[];
  completed: boolean;
  finish: (res?: AntigravityResult) => void;
}

/** A thread's resident `agy` process and the parameters it was spawned with. */
interface ActiveSession {
  threadId: string;
  /** `agy`'s conversation id once announced on `init`; undefined until then. */
  conversationId: string | undefined;
  cwd: string;
  model: string | undefined;
  mode: AntigravityPermissionMode;
  /** MCP server list fingerprint the process was started with (`proxyLaunchEnv`). */
  mcpKey: string;
  child: SpawnedProcess;
  idleTimer?: NodeJS.Timeout;
  /** Fallback for a tool block id when a step has no `step_index`. */
  toolSequence: number;
  /** Steps shown as running, not yet ended (see the step handler). */
  startedSteps: Set<string>;
  /** Each file's text as the agent last read or wrote it, and in which turn. */
  fileText: Map<string, { turnId: string; text: string | null }>;
  exited: boolean;
  activeTurn?: ActiveTurn;
}

/**
 * The reasoning tiers `agy` appends to a model id (`gemini-3.8-flash-high`),
 * lowest first. A listed id ends in one of them and is a tier of its base.
 */
const AGY_TIERS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** `<base>-<tier>`: the id of one tier of a model family. */
const TIERED_ID = new RegExp(`^(.+)-(${AGY_TIERS.join('|')})$`);

/** A trailing ` (High)`-style tier in a label, which the grouped name drops. */
const TIER_LABEL = /\s*\((?:low|medium|high|xhigh|extra high|max)\)\s*$/i;

/**
 * Parse the `agy models` output into one {@link AgentModel} per listed row.
 *
 * The surface as of `agy` 1.3.5 (captured verbatim, `--model` routing keys):
 *
 * ```text
 * Fetching available models...
 * gemini-3.8-flash-high⟨TAB⟩Gemini 3.8 Flash (High)
 * gemini-3.8-flash-low⟨TAB⟩Gemini 3.8 Flash (Low)
 * claude-sonnet-4-6⟨TAB⟩Claude Sonnet 4.6 (Thinking)
 * ```
 *
 * So a data row is `<id>⟨TAB⟩<label>`: the **id** is the `--model` routing key
 * (it already carries the reasoning tier — `--model gemini-3.5-flash` alone was
 * rejected with "requires --effort" on 1.1.x), and the label is for humans.
 *
 * Anything that is not a data row is dropped, including the leading progress
 * line and a `Available models:` header. A line without a TAB is only kept when
 * it is a bare id (older `agy` printed those alone); prose is never minted into
 * a phantom model. Rows are not grouped and none is marked as the default: that
 * is {@link groupAntigravityModels}' job.
 */
export function parseAntigravityModelList(output: string): AgentModel[] {
  const out: AgentModel[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a header row like "Available models:".
    if (line.endsWith(':')) continue;
    const tab = line.indexOf('\t');
    const id = (tab >= 0 ? line.slice(0, tab) : line).trim();
    const label = tab >= 0 ? line.slice(tab + 1).trim() : '';
    // A routing key never contains whitespace, so a "column" that does is prose
    // (the progress line, or a signed-out CLI answering in sentences).
    if (!id || /\s/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, displayName: label || id });
  }
  return out;
}

/**
 * The account's default model, from `agy -p /model --output-format json` — a
 * payload whose `command.data.id` is the routing key the account runs by
 * default (`{"command":{"name":"model","data":{"id":"gemini-3.8-flash-medium",…}}}`,
 * verified on `agy` 1.3.5; it starts no turn and spends no quota). `undefined`
 * for anything else: the list then shows no default rather than a guessed one.
 */
export function parseAntigravityAccountModel(output: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return undefined;
  }
  const data = asObject(asObject(asObject(parsed)?.['command'])?.['data']);
  const id = asString(data?.['id'])?.trim();
  return id && !/\s/.test(id) ? id : undefined;
}

/** The tier of a tiered id (`gemini-3.8-flash-high` → `high`), or undefined. */
function tierOf(id: string): { base: string; tier: string } | undefined {
  const match = TIERED_ID.exec(id);
  return match ? { base: match[1]!, tier: match[2]! } : undefined;
}

/** The label without its trailing tier (`Gemini 3.8 Flash (High)` → `Gemini 3.8 Flash`). */
function familyLabel(label: string, fallback: string): string {
  const stripped = label.replace(TIER_LABEL, '').trim();
  return stripped.length > 0 ? stripped : fallback;
}

/**
 * Group the tiers of one model family into ONE selectable model.
 *
 * Ids that share a base with at least one sibling (`gemini-3.8-flash-high`,
 * `…-medium`, `…-low`) become one model whose id is the base, named after the
 * family, with a reasoning option over exactly the tiers listed, lowest first.
 * Its default tier is the account default's tier when the account default is
 * one of them, else the middle listed tier. A lone tiered id
 * (`gpt-oss-120b-medium`) and anything untiered (`claude-sonnet-4-6`) stay as
 * they are: nothing to choose between.
 *
 * `isDefault` marks the model the account default belongs to — the family, for a
 * tiered default; never a guess when `accountDefault` is absent or not listed.
 */
export function groupAntigravityModels(rows: AgentModel[], accountDefault?: string): AgentModel[] {
  const families = new Map<string, { tier: string; label: string }[]>();
  for (const row of rows) {
    const parts = tierOf(row.id);
    if (!parts) continue;
    const members = families.get(parts.base) ?? [];
    // A row without a label (a bare id) is named by its family id.
    const label = row.displayName === row.id ? parts.base : row.displayName;
    members.push({ tier: parts.tier, label });
    families.set(parts.base, members);
  }
  const grouped = new Map<string, { levels: string[]; name: string; defaultTier: string }>();
  for (const [base, members] of families) {
    if (members.length < 2) continue;
    const levels = AGY_TIERS.filter((t) => members.some((m) => m.tier === t));
    const accountTier = accountDefault !== undefined ? tierOf(accountDefault) : undefined;
    const defaultTier =
      accountTier?.base === base && levels.includes(accountTier.tier as (typeof AGY_TIERS)[number])
        ? accountTier.tier
        : levels[Math.floor((levels.length - 1) / 2)]!;
    const first = members[0]!;
    grouped.set(base, { levels, name: familyLabel(first.label, base), defaultTier });
  }

  const out: AgentModel[] = [];
  const emitted = new Set<string>();
  for (const row of rows) {
    const parts = tierOf(row.id);
    const family = parts ? grouped.get(parts.base) : undefined;
    if (!parts || !family) {
      out.push(row.id === accountDefault ? { ...row, isDefault: true } : row);
      continue;
    }
    if (emitted.has(parts.base)) continue;
    emitted.add(parts.base);
    const isDefault = accountDefault !== undefined && tierOf(accountDefault)?.base === parts.base;
    out.push({
      id: parts.base,
      displayName: family.name,
      ...(isDefault ? { isDefault: true } : {}),
      options: [reasoningOption(effortValues(family.levels), family.defaultTier)],
    });
  }
  return out;
}

/** The reasoning option of a grouped model, when it has one. */
function reasoningKnob(model: AgentModel): NonNullable<AgentModel['options']>[number] | undefined {
  return model.options?.find((option) => option.key === REASONING_KEY);
}

/**
 * The `--model` value for a turn.
 *
 * A grouped family (see {@link groupAntigravityModels}) is run as its tiered id,
 * `<base>-<tier>`: that works on every `agy` version, where `--effort` is only
 * recent. The tier is the chosen reasoning level when it is one the family
 * lists, else the family's default tier. A selection that is not a grouped
 * family — an ungrouped id, or a tiered id stored by an earlier version — runs
 * unchanged. Before any listing (a bridge that just started), a chosen level on
 * an untiered id still names its tier: only a grouped family has a level to
 * choose. `undefined` when there is no selection (`agy` picks its own).
 */
export function antigravityRunModel(
  selection: string | undefined,
  level: string | undefined,
  listing: AgentModel[],
): string | undefined {
  const model = normalizeAntigravityModel(selection);
  if (model === undefined) return undefined;
  const family = listing.find((m) => m.id === model && reasoningKnob(m) !== undefined);
  const knob = family ? reasoningKnob(family) : undefined;
  if (!knob) {
    const tiered = tierOf(model) !== undefined;
    const known = level !== undefined && (AGY_TIERS as readonly string[]).includes(level);
    return listing.length === 0 && known && !tiered ? `${model}-${level}` : model;
  }
  const levels = (knob.values ?? []).map((v) => v.value);
  const chosen =
    level !== undefined && levels.includes(level)
      ? level
      : typeof knob.default === 'string'
        ? knob.default
        : undefined;
  return chosen !== undefined ? `${model}-${chosen}` : model;
}

/**
 * Every model id `agy` runs, with each grouped family expanded to its tiers:
 * `gemini-3.8-flash` (tiers low, medium, high) → `gemini-3.8-flash-low`, …
 */
export function expandAntigravityModels(listing: AgentModel[]): string[] {
  const ids: string[] = [];
  for (const model of listing) {
    const knob = reasoningKnob(model);
    if (knob) {
      for (const value of knob.values ?? []) ids.push(`${model.id}-${value.value}`);
    } else {
      ids.push(model.id);
    }
  }
  return ids;
}

/**
 * The model that names a conversation, from the ids `agy` runs
 * ({@link expandAntigravityModels}): the lowest tier of a `flash` family — the
 * cheap one — else any `-low` id, else `undefined` (no `--model`: `agy`'s own
 * default, which naming never prefers over a cheap tier when one is listed).
 *
 * Never the thread's own model: a six-word title must not spend the quota of
 * the model the user is working with. The id is taken from the listing, not
 * pinned, so a retired tier is never asked for.
 */
export function chooseAntigravityTitleModel(ids: string[]): string | undefined {
  let cheapest: { id: string; rank: number } | undefined;
  for (const id of ids) {
    const parts = tierOf(id);
    if (!parts || !parts.base.includes('flash')) continue;
    const rank = AGY_TIERS.indexOf(parts.tier as (typeof AGY_TIERS)[number]);
    if (cheapest === undefined || rank < cheapest.rank) cheapest = { id, rank };
  }
  if (cheapest) return cheapest.id;
  return ids.find((id) => id.endsWith('-low'));
}

/**
 * The `--model` value for a stored model selection, or undefined for "let `agy`
 * pick".
 *
 * A thread keeps whatever the picker handed it, and an earlier parser handed out
 * the **whole** `agy models` line (`<id>⟨TAB⟩<label>`), which `agy` rejects. So a
 * selection carrying a TAB is cut back to its id column: threads chosen before
 * the fix keep running instead of failing every turn until the user re-picks.
 */
export function normalizeAntigravityModel(model?: string): string | undefined {
  if (model === undefined) return undefined;
  const tab = model.indexOf('\t');
  const value = (tab >= 0 ? model.slice(0, tab) : model).trim();
  return value.length > 0 ? value : undefined;
}

export class AntigravityAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'antigravity-cli';
  readonly capabilities = ANTIGRAVITY_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: AntigravityPermissionMode;
  readonly #spawn: SpawnFn;
  readonly #idleTimeoutMs: number;

  /**
   * threadId → the `agy` conversation id announced on the thread's first `init`,
   * passed back as `--conversation` on every later spawn for that thread.
   */
  /** threadId → the thread's resident process, while one is alive. */
  readonly #sessions = new Map<string, ActiveSession>();
  /** The last non-empty `agy models` listing, grouped (see listModels). */
  #models: AgentModel[] = [];
  /** The folder's skill list, briefly reused (see listCommands). */
  readonly #commandsByCwd = new Map<string, { at: number; commands: AgentCommand[] }>();

  /** Agent-wide folder, home: model catalogs and every other agent-wide work
   *  run here, so a renamed or deleted project folder cannot break them. A
   *  turn carries its own `cwd` and never writes this. */
  #defaultCwd = homedir();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  /** The configured idle timeout (observability + tests). */
  get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  /** Whether a resident process is alive for the thread (observability + tests). */
  hasActiveSession(threadId: string): boolean {
    const session = this.#sessions.get(threadId);
    return Boolean(session && !session.exited);
  }

  constructor(options: AntigravityAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'agy';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'bypassPermissions';
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS;
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(_config: AgentConfig): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const threadId of Array.from(this.#sessions.keys())) {
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * Tear down the thread's resident process now (the thread was archived or
   * deleted). The conversation id is kept: an unarchived thread's next turn
   * resumes the same conversation on a fresh process.
   */
  closeSession(threadId: string): Promise<void> {
    this.#teardownSession(threadId);
    return Promise.resolve();
  }

  /** (Re)arm the idle countdown after a turn ended. */
  #scheduleIdleTeardown(session: ActiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.#teardownSession(session.threadId);
    }, this.#idleTimeoutMs);
    // A pending countdown must never keep the daemon alive on shutdown.
    session.idleTimer.unref();
  }

  /**
   * Kill the thread's process and forget it. A turn still running on it is
   * marked completed WITHOUT a terminal event — every caller emits its own
   * (`turn_aborted` on cancel; a recycle only happens between turns).
   */
  #teardownSession(threadId: string): void {
    const session = this.#sessions.get(threadId);
    if (!session) return;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.activeTurn) session.activeTurn.completed = true;
    this.#sessions.delete(threadId);
    session.exited = true;
    try {
      session.child.stdin?.end();
      session.child.kill();
    } catch {
      /* already exited */
    }
  }

  /**
   * The thread's resident process, spawning one when there is none or when the
   * live one was started with a different cwd / model / posture — those are
   * process arguments, so honouring a change means a new process. The new one
   * resumes the same conversation via `--conversation`.
   */
  #getOrCreateSession(
    threadId: string,
    cwd: string,
    model: string | undefined,
    mode: AntigravityPermissionMode,
    mcpServers?: AgentMcpServer[],
  ): ActiveSession {
    // Each MCP server reaches `agy` through a process-local proxy entry
    // (`mcp-proxy.ts`); a changed list restarts the process with new endpoints.
    const mcp = proxyLaunchEnv(mcpServers, cwd);
    const existing = this.#sessions.get(threadId);
    if (
      existing &&
      !existing.exited &&
      existing.cwd === cwd &&
      existing.model === model &&
      existing.mode === mode &&
      existing.mcpKey === mcp.key
    ) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }
    if (existing) this.#teardownSession(threadId);

    // Resume the conversation `agy` created on this thread's first turn; on the
    // very first spawn there is none yet and `agy` mints one (announced on `init`).
    const conversationId = this.nativeSessionId(threadId);
    const args = [
      ...(conversationId !== undefined ? ['--conversation', conversationId] : []),
      '--add-dir',
      cwd,
      ...permissionArgs(mode),
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--print-timeout',
      TURN_TIMEOUT,
    ];
    if (model) args.push('--model', model);

    const child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, {
      stdin: 'pipe',
      ...(mcp.key ? { env: mcp.env } : {}),
    });

    const session: ActiveSession = {
      threadId,
      conversationId,
      cwd,
      model,
      mode,
      mcpKey: mcp.key,
      child,
      toolSequence: 0,
      fileText: new Map(),
      startedSteps: new Set(),
      exited: false,
    };

    const adoptConversation = (id: string | undefined): void => {
      if (id === undefined || id === session.conversationId) return;
      session.conversationId = id;
      this.setNativeSession(threadId, id);
    };

    onLines(child.stdout as unknown as Readable, (line: string) => {
      const ev = parseAntigravityLine(line);
      // `init` is per process and may precede any turn: adopt the id regardless.
      if (ev?.kind === 'init') {
        adoptConversation(ev.conversationId);
        return;
      }
      const active = session.activeTurn;
      if (!active || active.completed) return;
      if (ev === null) {
        // Not JSON: the surface never puts an answer here, so keep it only as a
        // diagnostic for a turn that ends with no answer.
        const trimmed = line.trim();
        if (trimmed.length > 0) active.diagnostics.push(trimmed);
        return;
      }
      if (ev.kind === 'step_update') {
        adoptConversation(ev.update.conversation_id);
        const { update } = ev;
        const toolName = update.tool_name ?? '';
        const fileTool = update.step_type === 'tool' && ANTIGRAVITY_FILE_TOOLS.has(toolName);
        const params = update.tool_info?.parameters ?? {};
        const target = typeof params['TargetFile'] === 'string' ? params['TargetFile'] : '';
        // A step is shown as it starts; its end replaces it in place (same
        // `blockId`: the tool and its step index). A file step shows only its diff.
        const stepId =
          update.step_index !== undefined ? `${toolName}_${update.step_index}` : undefined;
        if (
          update.step_type === 'tool' &&
          update.state === 'ACTIVE' &&
          stepId !== undefined &&
          !fileTool &&
          !session.startedSteps.has(stepId)
        ) {
          session.startedSteps.add(stepId);
          const started = buildAntigravityToolBlock(update);
          if (started['type'] !== 'diff') {
            this.emit({
              type: 'block',
              threadId,
              turnId: active.turnId,
              data: { content: runningBlock(started, stepId) },
            });
          }
        }
        if (update.step_type === 'tool' && (update.state === 'DONE' || update.state === 'ERROR')) {
          // 1.2.x reports only which file a step changed, and announces the
          // step once it is already applied. The text before it is what the
          // agent last read or wrote this turn, else the committed file.
          let change: AntigravityFileChange | undefined;
          if (fileTool && target) {
            const known = session.fileText.get(target);
            const before =
              known && known.turnId === active.turnId ? known.text : committedTextOrNull(target);
            const after = readTextOrNull(target);
            change = { before, after };
            session.fileText.set(target, { turnId: active.turnId, text: after });
          } else if (toolName === 'view_file' && typeof params['AbsolutePath'] === 'string') {
            const path = params['AbsolutePath'];
            session.fileText.set(path, { turnId: active.turnId, text: readTextOrNull(path) });
          }
          // The task list the agent keeps for itself is shown as the plan, not as
          // a diff of a file outside the project — when it is a checklist at all.
          const checklist =
            fileTool && update.state === 'DONE' && ANTIGRAVITY_CHECKLIST_FILE.test(target)
              ? parseAntigravityChecklist(change?.after ?? '')
              : [];
          const settled =
            checklist.length > 0
              ? planBlock(checklist)
              : buildAntigravityToolBlock(update, session.toolSequence++, change);
          const block = stepId !== undefined ? withBlockId(settled, stepId) : settled;
          if (stepId !== undefined) session.startedSteps.delete(stepId);
          this.emit({ type: 'block', threadId, turnId: active.turnId, data: { content: block } });
        }
        if (update.step_type === 'agent_response') {
          const delta = update.text_delta;
          if (delta && delta.length > 0) {
            active.fullText += delta;
            this.emit({ type: 'delta', threadId, turnId: active.turnId, data: { text: delta } });
          }
          const tokens = contextTokens(update.usage);
          if (tokens !== undefined) active.contextTokens = tokens;
        }
        // `/compact` runs as a checkpoint step: the context is compacted, and the
        // turn's result then carries no answer.
        if (update.step_type === 'checkpoint' && update.state === 'DONE') {
          active.compacted = true;
          this.emit({
            type: 'block',
            threadId,
            turnId: active.turnId,
            data: { content: compactionBlock() },
          });
        }
        return;
      }
      if (ev.kind === 'result') {
        adoptConversation(ev.result.conversation_id);
        active.finish(ev.result);
      }
    });

    child.stderr?.on('data', (chunk: unknown) => {
      const active = session.activeTurn;
      if (!active || active.completed) return;
      const text = String(chunk).trim();
      if (text.length > 0) active.diagnostics.push(text);
    });

    child.on('error', (err: Error) => {
      session.exited = true;
      this.#sessions.delete(threadId);
      const active = session.activeTurn;
      if (active && !active.completed) {
        active.completed = true;
        session.activeTurn = undefined;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId: active.turnId,
          data: { text: `Antigravity process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      session.exited = true;
      this.#sessions.delete(threadId);
      // A process that died mid-turn ends the turn with whatever it streamed.
      const active = session.activeTurn;
      if (active && !active.completed) active.finish();
    });

    this.#sessions.set(threadId, session);
    return session;
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = antigravityRunModel(
      options.service ?? this.#defaultModel,
      reasoningValue(options),
      this.#models,
    );
    const mode = this.#permissionMode;

    let session: ActiveSession;
    try {
      session = this.#getOrCreateSession(threadId, cwd, model, mode, options.mcpServers);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch Antigravity (agy): ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    const activeTurn: ActiveTurn = {
      turnId,
      fullText: '',
      contextTokens: undefined,
      compacted: false,
      diagnostics: [],
      completed: false,
      finish: (res?: AntigravityResult): void => {
        if (activeTurn.completed) return;
        activeTurn.completed = true;
        if (session.activeTurn?.turnId === turnId) session.activeTurn = undefined;
        if (!session.exited) this.#scheduleIdleTeardown(session);

        const diagnostics = activeTurn.diagnostics.join('\n').trim();
        if (res?.status === 'ERROR') {
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: res.error || diagnostics || 'Antigravity error' },
          });
          return;
        }
        // The streamed text is what the phone saw; `response` only fills in for
        // a CLI that skipped deltas and handed the answer whole.
        const body = activeTurn.fullText.length > 0 ? activeTurn.fullText : (res?.response ?? '');
        // A compaction answers nothing by design: a SUCCESS with an empty response
        // after a checkpoint is a finished turn, not a missing answer.
        const compacted = activeTurn.compacted && res?.status === 'SUCCESS';
        if (body.trim().length > 0 || compacted) {
          const tokens = activeTurn.contextTokens;
          this.emit({
            type: 'turn_completed',
            threadId,
            turnId,
            data: { text: body, ...(tokens !== undefined ? { usage: { tokens } } : {}) },
          });
          return;
        }
        // No answer: surface `agy`'s own diagnostic (e.g. the headless "no output
        // produced — a tool required permission" auto-deny), or its status.
        const status = res?.status && res.status !== 'SUCCESS' ? `Antigravity ${res.status}` : '';
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: diagnostics || status || 'Antigravity produced no output' },
        });
      },
    };

    session.activeTurn = activeTurn;
    this.emit({ type: 'turn_started', threadId, turnId });

    // The turn is one NDJSON line on stdin: `agy` "runs a turn for each".
    const userMessage = { event: 'user', message: { content: [{ type: 'text', text }] } };
    const stdin = session.child.stdin;
    if (!stdin || !stdin.writable) {
      activeTurn.finish({ status: 'ERROR', error: 'Antigravity stdin is not writable' });
      this.#teardownSession(threadId);
      return Promise.resolve();
    }
    try {
      stdin.write(`${JSON.stringify(userMessage)}\n`);
    } catch (err) {
      activeTurn.finish({
        status: 'ERROR',
        error: `failed to write to Antigravity stdin: ${errorMessage(err)}`,
      });
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * Name a conversation with a one-shot `agy -p`, without `--conversation`, so
   * it never joins the conversation this thread resumes, and in `--mode plan`
   * so a naming errand can never touch the workspace.
   *
   * On the cheapest model the account's listing offers
   * ({@link chooseAntigravityTitleModel}), never the thread's own: a title must
   * not spend the quota of the model the user is working with. The listing is
   * the last one `agy models` gave (fetched here when there is none yet); with
   * no cheap tier listed, `agy`'s own default names it.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const listing = this.#models.length > 0 ? this.#models : await this.listModels();
    const titleModel = chooseAntigravityTitleModel(expandAntigravityModels(listing));
    const args = [
      '--output-format',
      'text',
      ...(titleModel !== undefined ? ['--model', titleModel] : []),
      '--mode',
      'plan',
      '--add-dir',
      cwd,
      '-p',
      prompt,
    ];
    const raw = await runTitleOneShot(() =>
      this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
  }

  /**
   * Cancel = kill the process: `agy`'s stream-json surface has no abort message,
   * and a new process resumes the conversation on the next turn.
   */
  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    if (session && session.activeTurn?.turnId === turnId) {
      session.activeTurn.completed = true;
      session.activeTurn = undefined;
      this.emit({ type: 'turn_aborted', threadId, turnId });
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * The models `agy models` reports, grouped into one selectable model per
   * family ({@link groupAntigravityModels}), with the account's default marked.
   * The default is read from `agy -p /model` in the same breath; the
   * configured `defaultModel` wins over it when set. Both reads are best-effort:
   * a failed read yields no default (never the first row), a failed listing
   * yields `[]` and the phone shows no picker — `agy` then runs its own default.
   * A non-empty listing is kept for the next turn and the title model.
   */
  async listModels(): Promise<AgentModel[]> {
    const [listing, account] = await Promise.all([
      this.#capture(['models'], this.#defaultCwd, MODEL_LIST_TIMEOUT_MS),
      this.#capture(
        ['-p', '/model', '--output-format', 'json'],
        this.#defaultCwd,
        ACCOUNT_MODEL_TIMEOUT_MS,
      ),
    ]);
    const accountDefault =
      this.#defaultModel ?? parseAntigravityAccountModel(account?.stdout ?? '');
    const models = groupAntigravityModels(
      parseAntigravityModelList(listing?.stdout ?? ''),
      accountDefault,
    );
    if (models.length > 0) this.#models = models;
    return models;
  }

  /**
   * One short `agy` run in [cwd], its stdout and exit code; `undefined` when it
   * cannot start, errors, or does not exit within [timeoutMs] (it is killed).
   */
  #capture(
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; code: number | null } | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let child: SpawnedProcess;
      const finish = (result: { stdout: string; code: number | null } | undefined): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        resolve(result);
      };

      try {
        child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
      } catch {
        resolve(undefined);
        return;
      }

      const timer = setTimeout(() => finish(undefined), timeoutMs);
      child.stdout.on('data', (chunk: unknown) => {
        stdout += String(chunk);
      });
      child.on('error', () => finish(undefined));
      child.on('close', (code: number | null) => finish({ stdout, code }));
    });
  }

  /**
   * The commands Antigravity runs from the conversation: `/compact`, which `agy`
   * runs as a checkpoint on the stream-json surface (see the adapter's turn
   * handling), and its **skills** — the workspace's own and the user's — as
   * `agy -p /skills` lists them, in the thread's folder with the same
   * `--add-dir` a turn gets (the workspace's skills come from it; verified on
   * `agy` 1.2.11: without it the project's skill is not listed). A picked
   * command is sent as `/name args` on the user message, which `agy` expands
   * natively — no {@link expandCommand}.
   *
   * The other commands `agy` answers itself (`/help`, `/skills`, …) fail on the
   * stream-json surface the bridge drives ("is answered by the CLI itself and is
   * unavailable with --input-format stream-json"), and legacy
   * `.agents/workflows` are not expanded — skills replace them. The stream's
   * `init` event carries no command list. The skills are reused per folder for
   * a minute; an unanswered request yields none of them, `/compact` always.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const cached = this.#commandsByCwd.get(dir);
    let skills: AgentCommand[];
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) {
      skills = cached.commands;
    } else {
      const output = await this.#askSkills(dir);
      skills = output === undefined ? [] : parseAntigravitySkills(output);
      this.#commandsByCwd.set(dir, { at: Date.now(), commands: skills });
    }
    return [
      ANTIGRAVITY_COMPACT_COMMAND,
      ...skills.filter((skill) => skill.name !== ANTIGRAVITY_COMPACT_COMMAND.name),
    ];
  }

  /** `agy -p /skills` in [cwd]; its stdout, or `undefined` if it failed. */
  async #askSkills(cwd: string): Promise<string | undefined> {
    const out = await this.#capture(['-p', '/skills', '--add-dir', cwd], cwd, COMMANDS_TIMEOUT_MS);
    return out?.code === 0 ? out.stdout : undefined;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
