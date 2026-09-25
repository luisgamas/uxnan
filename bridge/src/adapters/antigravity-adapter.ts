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
 *    `--dangerously-skip-permissions`. So editing turns run with skip-permissions
 *    (autonomous, like pi); a `requestApproval` thread degrades to read-only
 *    `--mode plan` instead (the safe "can't ask you, so I'll only plan" posture).
 *    See {@link AntigravityAdapter.#effectiveMode}.
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
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  DesktopTools,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { commandBlock, editDiffBlock, toolBlock, writeDiffBlock } from './content-blocks.js';
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
 * Model used to name a conversation: the cheapest tier `agy models` reports,
 * never the thread's own — a six-word title must not spend the quota of the
 * model the user is working with.
 *
 * `flash` is the cheap family and `-low` its cheapest reasoning tier (the id
 * carries the tier, see {@link parseAntigravityModelList}). Hand-kept, like
 * every pinned id here: it is verified against a real `agy models`, and it has
 * a **twin in the desktop app** (`uxnandesktop/src-tauri/src/convtitle.rs` →
 * `title_model`) that must move with it. If Antigravity ever retires this id,
 * naming degrades to "no title" (the run is best-effort), never to a broken
 * conversation.
 */
const ANTIGRAVITY_TITLE_MODEL = 'gemini-3.6-flash-low';

const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = {
  // `agy --mode plan` gives a real read-only planning mode.
  planMode: true,
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
 * headless. A read-only posture stays reachable per thread via the
 * `requestApproval` access mode ({@link AntigravityAdapter.#effectiveMode}).
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

/**
 * Map a finished `tool` step onto the bridge's structured content blocks.
 *
 * Parameter names are `agy`'s own (captured live): `run_command` carries
 * `CommandLine`, `write_to_file` carries `TargetFile` + `CodeContent`, and
 * `replace_file_content` carries `TargetFile` + `TargetContent` +
 * `ReplacementContent`. Any other tool becomes a generic tool block whose id is
 * `<tool>_<step_index>` — the step index is unique within a conversation, and
 * `sequence` only stands in for a step that has none.
 */
export function buildAntigravityToolBlock(
  update: AntigravityStepUpdate,
  sequence = 0,
): Record<string, unknown> {
  const toolName = update.tool_name ?? update.tool_info?.name ?? 'tool';
  const params = update.tool_info?.parameters ?? {};
  const out =
    typeof update.tool_info?.output === 'string'
      ? update.tool_info.output
      : (update.tool_info?.error?.message ?? '');
  const isError = update.state === 'ERROR' || Boolean(update.tool_info?.error);

  switch (toolName) {
    case 'run_command': {
      const cmd = typeof params['CommandLine'] === 'string' ? params['CommandLine'] : '';
      return commandBlock(cmd, out, isError);
    }
    case 'write_to_file': {
      const target = typeof params['TargetFile'] === 'string' ? params['TargetFile'] : '';
      const code = typeof params['CodeContent'] === 'string' ? params['CodeContent'] : '';
      return writeDiffBlock(target, code);
    }
    case 'replace_file_content': {
      const target = typeof params['TargetFile'] === 'string' ? params['TargetFile'] : '';
      const oldText = typeof params['TargetContent'] === 'string' ? params['TargetContent'] : '';
      const newText =
        typeof params['ReplacementContent'] === 'string' ? params['ReplacementContent'] : '';
      return editDiffBlock(target, oldText, newText);
    }
    default: {
      const toolId = `${toolName}_${update.step_index ?? sequence}`;
      return toolBlock(toolName, toolId, params, out, isError);
    }
  }
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
  /** Which desktop attachment the process was started with (`proxyLaunchEnv`). */
  desktopKey: string;
  child: SpawnedProcess;
  idleTimer?: NodeJS.Timeout;
  /** Fallback for a tool block id when a step has no `step_index`. */
  toolSequence: number;
  exited: boolean;
  activeTurn?: ActiveTurn;
}

/**
 * Parse the `agy models` output into {@link AgentModel}s.
 *
 * The surface as of `agy` 1.1.13 (captured verbatim from a signed-in machine):
 *
 * ```text
 * Fetching available models...
 * gemini-3.7-flash-high⟨TAB⟩Gemini 3.7 Flash (High)
 * claude-sonnet-4-6⟨TAB⟩Claude Sonnet 4.6 (Thinking)
 * ```
 *
 * So a data row is `<id>⟨TAB⟩<label>`: the **id** is the `--model` routing key
 * (it already carries the reasoning tier, so no `--effort` is needed — `--model
 * gemini-3.5-flash` alone is rejected with "requires --effort"), and the label is
 * for humans. Both were verified live: `--model gemini-3.5-flash-low` and
 * `--model "Gemini 3.5 Flash (Low)"` each run, while the whole line does NOT —
 * which is what an earlier parser sent, so every model pick failed.
 *
 * Anything that is not a data row is dropped, including the leading progress
 * line: taking it made "Fetching available models..." the first entry and hence
 * the default, and the phone then sent it as `--model`. A line without a TAB is
 * only kept when it is a bare id (older `agy` printed those alone); prose is
 * never minted into a phantom model.
 *
 * `agy` lists its account default first, so — absent a configured
 * `defaultModel` that matches — the first entry is marked as the default
 * (presentation-only).
 */
export function parseAntigravityModelList(output: string, defaultModel?: string): AgentModel[] {
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
  const defaultIndex =
    defaultModel !== undefined ? out.findIndex((m) => m.id === defaultModel) : -1;
  const markIndex = defaultIndex >= 0 ? defaultIndex : out.length > 0 ? 0 : -1;
  if (markIndex >= 0) out[markIndex] = { ...out[markIndex]!, isDefault: true };
  return out;
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
  readonly #conversationByThread = new Map<string, string>();
  /** threadId → the thread's resident process, while one is alive. */
  readonly #sessions = new Map<string, ActiveSession>();
  /** The folder's skill list, briefly reused (see listCommands). */
  readonly #commandsByCwd = new Map<string, { at: number; commands: AgentCommand[] }>();

  #defaultCwd = process.cwd();

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

  /** Native `agy` conversation id for a thread (surfaced as the thread's session id). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#conversationByThread.get(threadId);
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

  /**
   * Resolve the permission posture for a turn: the thread's `accessMode` (from
   * the phone) wins when set, else the adapter's configured `permissionMode`.
   *  - `approveForMe`    → `acceptEdits` (autonomous edits — no finer headless gate);
   *  - `fullAccess`      → `bypassPermissions` (autonomous edits);
   *  - `requestApproval` → `plan` (read-only: `agy` cannot prompt for approval in
   *    headless mode, so "ask me first" safely degrades to plan-only, no edits).
   * Absent → the configured posture (no behaviour change).
   */
  #effectiveMode(accessMode: SendTurnOptions['accessMode']): AntigravityPermissionMode {
    switch (accessMode) {
      case 'approveForMe':
        return 'acceptEdits';
      case 'fullAccess':
        return 'bypassPermissions';
      case 'requestApproval':
        return 'plan';
      default:
        return this.#permissionMode;
    }
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
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
    desktopTools?: DesktopTools,
  ): ActiveSession {
    // Uxnan Desktop's tools reach `agy` through its global `uxnan-browser`
    // entry (`mcp-proxy.ts`), which reads the endpoint from this process's
    // environment — so a change of attachment restarts the process too.
    const desktop = proxyLaunchEnv(desktopTools, cwd);
    const existing = this.#sessions.get(threadId);
    if (
      existing &&
      !existing.exited &&
      existing.cwd === cwd &&
      existing.model === model &&
      existing.mode === mode &&
      existing.desktopKey === desktop.key
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
    const conversationId = this.#conversationByThread.get(threadId);
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
      ...(desktop.key ? { env: desktop.env } : {}),
    });

    const session: ActiveSession = {
      threadId,
      conversationId,
      cwd,
      model,
      mode,
      desktopKey: desktop.key,
      child,
      toolSequence: 0,
      exited: false,
    };

    const adoptConversation = (id: string | undefined): void => {
      if (id === undefined || id === session.conversationId) return;
      session.conversationId = id;
      this.#conversationByThread.set(threadId, id);
    };

    const rl = createInterface({ input: child.stdout as unknown as Readable, crlfDelay: Infinity });
    rl.on('line', (line: string) => {
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
        if (update.step_type === 'tool' && (update.state === 'DONE' || update.state === 'ERROR')) {
          const block = buildAntigravityToolBlock(update, session.toolSequence++);
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
    const model = normalizeAntigravityModel(options.service ?? this.#defaultModel);
    const mode = this.#effectiveMode(options.accessMode);

    let session: ActiveSession;
    try {
      session = this.#getOrCreateSession(threadId, cwd, model, mode, options.desktopTools);
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
        if (body.trim().length > 0) {
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
   * On {@link ANTIGRAVITY_TITLE_MODEL}, not the thread's model: this ran on the
   * account's default (the frontier tier) while both the spec and the desktop
   * app said it named on the cheap flash tier — so every title quietly spent
   * the quota of the model the user is actually working with.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const args = [
      '--output-format',
      'text',
      '--model',
      ANTIGRAVITY_TITLE_MODEL,
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
   * List the models `agy models` reports — the id is the `--model` routing key
   * (`gemini-3.7-flash-high`) and the label is what the phone shows ("Gemini 3.7
   * Flash (High)"). Parsed by {@link parseAntigravityModelList}. Resolves
   * to `[]` if the spawn fails or times out — the phone then shows no picker and
   * the agent runs on `agy`'s own default model.
   */
  listModels(): Promise<AgentModel[]> {
    return new Promise((resolve) => {
      let settled = false;
      let output = '';
      let child: SpawnedProcess;
      const finish = (models: AgentModel[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        resolve(models);
      };

      try {
        child = this.#spawn(this.#binaryPath, [...this.#prependArgs, 'models'], this.#defaultCwd);
      } catch {
        resolve([]);
        return;
      }

      const timer = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);
      const collect = (chunk: unknown): void => {
        output += String(chunk);
      };
      child.stdout.on('data', collect);
      child.stderr?.on('data', collect);
      child.on('error', () => finish([]));
      child.on('close', () => finish(parseAntigravityModelList(output, this.#defaultModel)));
    });
  }

  /**
   * The commands Antigravity runs from the conversation: its **skills** — the
   * workspace's own and the user's — as `agy -p /skills` lists them, a command
   * the CLI answers itself (like `/help`), in the thread's folder with the
   * same `--add-dir` a turn gets (the workspace's skills come from it; verified
   * on `agy` 1.2.11: without it the project's skill is not listed). A picked
   * skill is sent as `/name args` on the user message, which `agy` expands
   * natively — no {@link expandCommand}.
   *
   * Nothing else is advertised. The commands `agy` answers itself (`/help`,
   * `/skills`, …) fail on the stream-json surface the bridge drives ("is
   * answered by the CLI itself and is unavailable with --input-format
   * stream-json"), `/compact` is not a command there (it reaches the model as
   * plain text), and legacy `.agents/workflows` are not expanded — skills
   * replace them. The stream's `init` event carries no command list. Reused
   * per folder for a minute; an unanswered request yields none.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const cached = this.#commandsByCwd.get(dir);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
    const output = await this.#askSkills(dir);
    if (output === undefined) return [];
    const commands = parseAntigravitySkills(output);
    this.#commandsByCwd.set(dir, { at: Date.now(), commands });
    return commands;
  }

  /** `agy -p /skills` in [cwd]; its stdout, or `undefined` if it failed. */
  #askSkills(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      let output = '';
      let child: SpawnedProcess;
      const finish = (result: string | undefined): void => {
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
        child = this.#spawn(
          this.#binaryPath,
          [...this.#prependArgs, '-p', '/skills', '--add-dir', cwd],
          cwd,
        );
      } catch {
        resolve(undefined);
        return;
      }
      const timer = setTimeout(() => finish(undefined), COMMANDS_TIMEOUT_MS);
      child.stdout.on('data', (chunk: unknown) => {
        output += String(chunk);
      });
      child.on('error', () => finish(undefined));
      child.on('close', (code) => finish(code === 0 ? output : undefined));
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
