/**
 * Antigravity adapter (Google's Antigravity CLI, the `agy` binary — real agent).
 *
 * Antigravity is Google's successor to the standalone Gemini CLI: its models ARE
 * the Gemini family ("Gemini 3.7 Flash", "Gemini 3.1 Pro", …) plus a few hosted
 * others.
 *
 * ## Architecture — Persistent stream-json sessions
 *
 * Each conversation thread runs an interactive, persistent `agy` process using
 * `--input-format stream-json --output-format stream-json`.
 *
 * Why persistent stream-json instead of per-turn one-shot CLI spawns:
 *  1. **Zero repeat authentication latency**: Spawning `agy` one-shot for every
 *     turn forced the CLI to repeat Google authentication and environment
 *     initialization on every single turn (4–5 seconds of cold-start latency).
 *     With a persistent session, auth runs once on thread spin-up; subsequent
 *     turns respond within ~1.0s.
 *  2. **Streaming and token reporting**: `stream-json` exposes real-time
 *     `step_update` deltas and complete per-turn token usage in `result` events
 *     (`input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`,
 *     `total_tokens`), lighting up the context meter (`reportsContextUsage: true`).
 *  3. **2-hour idle timeout**: To prevent abandoned threads from leaking host
 *     resources, an idle session is automatically dismantled after 2 hours
 *     without client turns (configurable via `idleTimeoutMs`). The thread's
 *     UUID (`--conversation <uuid>`) is persisted, so a subsequent turn seamlessly
 *     re-attaches to the conversation history on disk.
 *  4. **Workspace & model isolation**: Each thread binds its own project directory
 *     (`--add-dir <cwd>`), model, and permission mode. If a thread alters these,
 *     the session is recycled cleanly while keeping session continuity.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/agents.md.
 */
import { randomUUID } from 'node:crypto';
import { openSync, readSync, statSync, existsSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { commandBlock, editDiffBlock, toolBlock, writeDiffBlock } from './content-blocks.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** Default idle timeout before closing an inactive `agy` process (24 hours). */
export const DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Hard cap on the `agy models` spawn before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

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
  // `agy` runs its tools without a per-turn approval RPC in headless mode,
  // so no interactive approval channel is advertised.
  approvals: false,
  // Antigravity operates autonomously ("YOLO"): with `--dangerously-skip-permissions`
  // it acts and edits without per-action approval prompts.
  autonomous: true,
  // A client-owned `--conversation <uuid>` resumes a thread across turns.
  forking: true,
  // The bridge delivers an attachment as a file in the workspace, and `agy`
  // opens it with its own file tools (multimodal Gemini models).
  images: true,
  // `agy` reports per-turn usage under `--output-format stream-json`.
  reportsContextUsage: true,
};

/**
 * Tool posture passed to `agy`:
 *  - `plan`              → `--mode plan` (read-only; analyses and plans, no edits);
 *  - `acceptEdits`       → `--dangerously-skip-permissions` (autonomous edits);
 *  - `bypassPermissions` → `--dangerously-skip-permissions` (autonomous edits).
 *
 * `agy`'s headless mode has only two effective postures — "act autonomously" and
 * "just plan" — because `--mode accept-edits` still auto-denies writes without a
 * prompt, so both edit-capable modes map to skip-permissions.
 */
export type AntigravityPermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions';

/** The CLI flags for a resolved {@link AntigravityPermissionMode}. */
export function permissionArgs(mode: AntigravityPermissionMode): string[] {
  return mode === 'plan' ? ['--mode', 'plan'] : ['--dangerously-skip-permissions'];
}

/**
 * Map the shared per-agent config `permissionMode` (`default | acceptEdits |
 * bypassPermissions`) to an {@link AntigravityPermissionMode}.
 */
export function antigravityPermissionMode(
  configured?: 'default' | 'acceptEdits' | 'bypassPermissions',
): AntigravityPermissionMode {
  return configured === 'acceptEdits' || configured === 'bypassPermissions'
    ? configured
    : 'bypassPermissions';
}

export interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface AntigravityToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: string;
  error?: {
    type?: string;
    message?: string;
  };
}

export interface AntigravityStepUpdate {
  conversation_id?: string;
  step_index?: number;
  state?: 'ACTIVE' | 'DONE' | 'ERROR' | string;
  step_type?: 'user_input' | 'agent_response' | 'tool' | string;
  tool_name?: string;
  tool_info?: AntigravityToolInfo;
  text_delta?: string;
  thinking?: string;
  thought?: string;
  thinking_delta?: string;
  duration_seconds?: number;
  usage?: AntigravityUsage;
}

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
 * Builds structured message content blocks from Antigravity tool step updates.
 */
export function buildAntigravityToolBlock(
  update: AntigravityStepUpdate,
): Record<string, unknown> | null {
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
      const oldText =
        typeof params['TargetContent'] === 'string' ? params['TargetContent'] : '';
      const newText =
        typeof params['ReplacementContent'] === 'string'
          ? params['ReplacementContent']
          : '';
      return editDiffBlock(target, oldText, newText);
    }
    default: {
      const toolId = `${toolName}_${update.step_index ?? Math.random().toString(36).slice(2, 8)}`;
      return toolBlock(toolName, toolId, params, out, isError);
    }
  }
}

/**
 * Returns the path to the Antigravity conversation transcript log file.
 */
export function getAntigravityTranscriptPath(conversationId: string): string {
  const geminiHome =
    process.env.GEMINI_CLI_HOME ||
    process.env.ANTIGRAVITY_APP_DATA_DIR ||
    join(homedir(), '.gemini', 'antigravity-cli');
  return join(geminiHome, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
}

/**
 * Parse one line from `agy --output-format stream-json`.
 * Returns null if the line is empty or invalid JSON.
 */
export function parseAntigravityLine(line: string): AntigravityStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const event = parsed['event'];
  if (event === 'init') {
    const initObj =
      typeof parsed['init'] === 'object' && parsed['init'] !== null
        ? (parsed['init'] as Record<string, unknown>)
        : undefined;
    return {
      kind: 'init',
      conversationId:
        typeof parsed['conversation_id'] === 'string' ? parsed['conversation_id'] : undefined,
      cwd: typeof initObj?.['cwd'] === 'string' ? initObj['cwd'] : undefined,
    };
  }
  if (
    event === 'step_update' &&
    typeof parsed['step_update'] === 'object' &&
    parsed['step_update'] !== null
  ) {
    const su = parsed['step_update'] as Record<string, unknown>;
    const toolInfo =
      typeof su['tool_info'] === 'object' && su['tool_info'] !== null
        ? (su['tool_info'] as Record<string, unknown>)
        : undefined;
    const errorObj =
      toolInfo && typeof toolInfo['error'] === 'object' && toolInfo['error'] !== null
        ? (toolInfo['error'] as Record<string, unknown>)
        : undefined;

    const update: AntigravityStepUpdate = {};
    if (typeof su['conversation_id'] === 'string') update.conversation_id = su['conversation_id'];
    if (typeof su['step_index'] === 'number') update.step_index = su['step_index'];
    if (typeof su['state'] === 'string') update.state = su['state'];
    if (typeof su['step_type'] === 'string') update.step_type = su['step_type'];
    if (typeof su['tool_name'] === 'string') update.tool_name = su['tool_name'];
    if (typeof su['duration_seconds'] === 'number') update.duration_seconds = su['duration_seconds'];
    if (toolInfo) {
      update.tool_info = {
        ...(typeof toolInfo['name'] === 'string' ? { name: toolInfo['name'] } : {}),
        ...(typeof toolInfo['parameters'] === 'object' && toolInfo['parameters'] !== null
          ? { parameters: toolInfo['parameters'] as Record<string, unknown> }
          : {}),
        ...(typeof toolInfo['output'] === 'string' ? { output: toolInfo['output'] } : {}),
        ...(errorObj
          ? {
              error: {
                ...(typeof errorObj['type'] === 'string' ? { type: errorObj['type'] } : {}),
                ...(typeof errorObj['message'] === 'string' ? { message: errorObj['message'] } : {}),
              },
            }
          : {}),
      };
    }
    if (typeof su['text_delta'] === 'string') update.text_delta = su['text_delta'];
    if (typeof su['thinking'] === 'string') update.thinking = su['thinking'];
    if (typeof su['thought'] === 'string') update.thought = su['thought'];
    if (typeof su['thinking_delta'] === 'string') update.thinking_delta = su['thinking_delta'];
    if (typeof su['usage'] === 'object' && su['usage'] !== null)
      update.usage = su['usage'] as AntigravityUsage;

    return {
      kind: 'step_update',
      update,
    };
  }
  if (event === 'result' && typeof parsed['result'] === 'object' && parsed['result'] !== null) {
    return {
      kind: 'result',
      result: parsed['result'] as AntigravityResult,
    };
  }
  return { kind: 'unrecognized', raw: parsed };
}

export interface AntigravityAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-antigravity.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (unused for the native `agy` exe). */
  prependArgs?: string[];
  /** Default model id (an `agy models` routing key) when the thread/turn picks none. */
  defaultModel?: string;
  /** Tool posture default when the thread sets no access mode (default `bypassPermissions`). */
  permissionMode?: AntigravityPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
  /** Idle timeout in milliseconds before tearing down the resident CLI process (default: 2 hours). */
  idleTimeoutMs?: number;
}

interface ActiveTurn {
  turnId: string;
  fullText: string;
  stderrBuf: string;
  completed: boolean;
  finish: (res?: AntigravityResult) => void;
}

interface ActiveSession {
  threadId: string;
  conversationId: string;
  cwd: string;
  model: string | undefined;
  mode: AntigravityPermissionMode;
  child: SpawnedProcess;
  idleTimer?: NodeJS.Timeout;
  transcriptTimer?: NodeJS.Timeout;
  transcriptOffset: number;
  transcriptLineBuf: string;
  emittedThinkingSteps: Set<number>;
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

  /** threadId → client-owned `agy` conversation UUID, for `--conversation` continuity. */
  readonly #conversationByThread = new Map<string, string>();
  /** threadId → active persistent session */
  readonly #sessions = new Map<string, ActiveSession>();

  #defaultCwd = process.cwd();

  defaultCwd(): string {
    return this.#defaultCwd;
  }

  get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  nativeSessionId(threadId: string): string | undefined {
    return this.#conversationByThread.get(threadId);
  }

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
    this.#sessions.clear();
    return Promise.resolve();
  }

  /** Dismantle and terminate the active persistent session for a specific thread immediately. */
  closeSession(threadId: string): Promise<void> {
    this.#teardownSession(threadId);
    return Promise.resolve();
  }

  #scheduleIdleTeardown(session: ActiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.#teardownSession(session.threadId);
    }, this.#idleTimeoutMs);
    if (typeof session.idleTimer.unref === 'function') {
      session.idleTimer.unref();
    }
  }

  #teardownSession(threadId: string): void {
    const session = this.#sessions.get(threadId);
    if (!session) return;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.transcriptTimer) {
      clearInterval(session.transcriptTimer);
      session.transcriptTimer = undefined;
    }
    if (session.activeTurn && !session.activeTurn.completed) {
      session.activeTurn.completed = true;
    }
    this.#sessions.delete(threadId);
    session.exited = true;
    try {
      if (session.child.stdin && typeof session.child.stdin.end === 'function') {
        session.child.stdin.end();
      }
      session.child.kill();
    } catch {
      /* already exited */
    }
  }

  #pollTranscript(session: ActiveSession): void {
    if (!session.conversationId) return;
    const tPath = getAntigravityTranscriptPath(session.conversationId);
    try {
      if (!existsSync(tPath)) return;
      const stat = statSync(tPath);
      if (stat.size < session.transcriptOffset) {
        session.transcriptOffset = 0;
      }
      if (stat.size === session.transcriptOffset) return;

      const fd = openSync(tPath, 'r');
      try {
        const bytesToRead = stat.size - session.transcriptOffset;
        const buf = Buffer.alloc(bytesToRead);
        readSync(fd, buf, 0, bytesToRead, session.transcriptOffset);
        session.transcriptOffset += bytesToRead;

        session.transcriptLineBuf += buf.toString('utf-8');
        const lines = session.transcriptLineBuf.split(/\r?\n/);
        session.transcriptLineBuf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let record: Record<string, unknown>;
          try {
            record = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          const stepIndex =
            typeof record['step_index'] === 'number' ? record['step_index'] : undefined;
          const thinking =
            typeof record['thinking'] === 'string' ? record['thinking'] : undefined;
          if (stepIndex !== undefined && thinking && !session.emittedThinkingSteps.has(stepIndex)) {
            session.emittedThinkingSteps.add(stepIndex);
            const active = session.activeTurn;
            if (active && !active.completed) {
              this.emit({
                type: 'thinking',
                threadId: session.threadId,
                turnId: active.turnId,
                data: { text: thinking },
              });
            }
          }
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      /* best effort */
    }
  }

  #getOrCreateSession(
    threadId: string,
    cwd: string,
    model: string | undefined,
    mode: AntigravityPermissionMode,
  ): ActiveSession {
    const existing = this.#sessions.get(threadId);
    if (
      existing &&
      !existing.exited &&
      existing.cwd === cwd &&
      existing.model === model &&
      existing.mode === mode
    ) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }

    if (existing) {
      this.#teardownSession(threadId);
    }

    let conversationId = this.#conversationByThread.get(threadId);
    if (conversationId === undefined) {
      conversationId = randomUUID();
      this.#conversationByThread.set(threadId, conversationId);
    }

    let transcriptOffset = 0;
    try {
      const tPath = getAntigravityTranscriptPath(conversationId);
      if (existsSync(tPath)) {
        transcriptOffset = statSync(tPath).size;
      }
    } catch {
      /* ignore */
    }

    const args = [
      '--conversation',
      conversationId,
      '--add-dir',
      cwd,
      ...permissionArgs(mode),
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--print-timeout',
      '2h',
    ];
    if (model) args.push('--model', model);

    const child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, {
      stdin: 'pipe',
    });

    const session: ActiveSession = {
      threadId,
      conversationId,
      cwd,
      model,
      mode,
      child,
      transcriptOffset,
      transcriptLineBuf: '',
      emittedThinkingSteps: new Set<number>(),
      exited: false,
    };

    const rl = createInterface({
      input: child.stdout as unknown as Readable,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      const active = session.activeTurn;
      if (!active || active.completed) return;
      const ev = parseAntigravityLine(line);
      if (ev?.kind === 'init') {
        if (ev.conversationId && ev.conversationId !== session.conversationId) {
          session.conversationId = ev.conversationId;
          this.#conversationByThread.set(session.threadId, ev.conversationId);
        }
        return;
      }
      if (ev?.kind === 'step_update') {
        if (ev.update.conversation_id && ev.update.conversation_id !== session.conversationId) {
          session.conversationId = ev.update.conversation_id;
          this.#conversationByThread.set(session.threadId, ev.update.conversation_id);
        }

        this.#pollTranscript(session);

        const directThinking = ev.update.thinking || ev.update.thought;
        if (directThinking) {
          const stepIdx = ev.update.step_index ?? -1;
          if (stepIdx === -1 || !session.emittedThinkingSteps.has(stepIdx)) {
            if (stepIdx !== -1) session.emittedThinkingSteps.add(stepIdx);
            this.emit({
              type: 'thinking',
              threadId,
              turnId: active.turnId,
              data: { text: directThinking },
            });
          }
        } else if (ev.update.thinking_delta) {
          this.emit({
            type: 'thinking',
            threadId,
            turnId: active.turnId,
            data: { text: ev.update.thinking_delta },
          });
        }

        if (
          ev.update.step_type === 'tool' &&
          (ev.update.state === 'DONE' || ev.update.state === 'ERROR')
        ) {
          const block = buildAntigravityToolBlock(ev.update);
          if (block) {
            this.emit({
              type: 'block',
              threadId,
              turnId: active.turnId,
              data: { content: block },
            });
          }
        }

        const delta = ev.update.text_delta;
        if (delta && delta.length > 0) {
          active.fullText += delta;
          this.emit({ type: 'delta', threadId, turnId: active.turnId, data: { text: delta } });
        }
        return;
      }
      if (ev?.kind === 'result') {
        this.#pollTranscript(session);
        active.finish(ev.result);
        return;
      }
      // Non-JSON fallback: plain-text or legacy streams
      const trimmed = line.trim();
      if (!ev && trimmed.length > 0) {
        active.fullText += (active.fullText.length > 0 ? '\n' : '') + line;
        this.emit({ type: 'delta', threadId, turnId: active.turnId, data: { text: line } });
      }
    });

    child.stderr?.on('data', (chunk: unknown) => {
      if (session.activeTurn) {
        session.activeTurn.stderrBuf += String(chunk);
      }
    });

    child.on('error', (err: Error) => {
      const active = session.activeTurn;
      if (session.transcriptTimer) {
        clearInterval(session.transcriptTimer);
        session.transcriptTimer = undefined;
      }
      session.exited = true;
      this.#sessions.delete(threadId);
      if (active && !active.completed) {
        active.completed = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId: active.turnId,
          data: { text: `Antigravity process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      if (session.transcriptTimer) {
        clearInterval(session.transcriptTimer);
        session.transcriptTimer = undefined;
      }
      session.exited = true;
      this.#sessions.delete(threadId);
      if (session.activeTurn && !session.activeTurn.completed) {
        session.activeTurn.finish();
      }
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
      session = this.#getOrCreateSession(threadId, cwd, model, mode);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch Antigravity (agy): ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    let completed = false;

    const finish = (res?: AntigravityResult): void => {
      if (completed) return;
      completed = true;
      if (session.transcriptTimer) {
        clearInterval(session.transcriptTimer);
        session.transcriptTimer = undefined;
      }
      this.#pollTranscript(session);
      if (session.activeTurn?.turnId === turnId) {
        session.activeTurn = undefined;
      }
      this.#scheduleIdleTeardown(session);

      if (res?.status === 'ERROR') {
        const errorText = res.error || activeTurn.stderrBuf.trim() || 'Antigravity error';
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: errorText },
        });
        return;
      }

      const body = (activeTurn.fullText || res?.response || '').trim();
      if (body.length > 0) {
        const computedTokens =
          res?.usage?.total_tokens ??
          (res?.usage?.input_tokens ?? 0) + (res?.usage?.output_tokens ?? 0);
        const tokens = computedTokens && computedTokens > 0 ? computedTokens : undefined;
        const usage = tokens !== undefined ? { tokens } : undefined;
        this.emit({
          type: 'turn_completed',
          threadId,
          turnId,
          data: {
            text: activeTurn.fullText || res?.response || '',
            ...(usage !== undefined ? { usage } : {}),
          },
        });
        return;
      }

      const errText = activeTurn.stderrBuf.trim();
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: errText.length > 0 ? errText : 'Antigravity produced no output' },
      });
    };

    const activeTurn: ActiveTurn = {
      turnId,
      fullText: '',
      stderrBuf: '',
      completed: false,
      finish,
    };

    session.activeTurn = activeTurn;
    this.emit({ type: 'turn_started', threadId, turnId });

    session.transcriptTimer = setInterval(() => {
      this.#pollTranscript(session);
    }, 150);
    if (typeof session.transcriptTimer.unref === 'function') {
      session.transcriptTimer.unref();
    }

    // Write input turn payload via NDJSON to stdin
    const userMessage = {
      event: 'user',
      message: {
        content: [{ type: 'text', text }],
      },
    };

    if (session.child.stdin && typeof session.child.stdin.write === 'function') {
      try {
        session.child.stdin.write(JSON.stringify(userMessage) + '\n');
      } catch (err) {
        finish({
          status: 'ERROR',
          error: `failed to write to Antigravity stdin: ${errorMessage(err)}`,
        });
      }
    }

    return Promise.resolve();
  }

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
      '-p',
      prompt,
    ];
    const raw = await runTitleOneShot(() =>
      this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    if (session && session.activeTurn?.turnId === turnId) {
      if (session.transcriptTimer) {
        clearInterval(session.transcriptTimer);
        session.transcriptTimer = undefined;
      }
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
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
