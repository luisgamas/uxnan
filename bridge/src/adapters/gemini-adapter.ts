/**
 * Google Gemini CLI adapter (`@google/gemini-cli`, the `gemini` command — real agent).
 *
 * Gemini does NOT speak the generic bridge agent IPC. Each turn spawns
 * `gemini -p <prompt> --output-format stream-json …` as a one-shot process and maps
 * its NDJSON event stream onto the bridge's agent events (same one-shot pattern as
 * the OpenCode, Claude Code, Codex and pi adapters). Validated live against
 * gemini-cli 0.45.2.
 *
 * Session continuity: the first turn passes `--session-id <uuid>` (a UUID the
 * adapter generates); subsequent turns pass `--resume <uuid>` to resume the SAME
 * conversation (verified: a fact set on turn 1 is recalled on turn 2). The native
 * session id is captured from the `init` event and tracked per thread.
 *
 * Critical detail: like the other CLIs, `gemini -p` is spawned with stdin IGNORED
 * (the shared `defaultSpawn`); the prompt is passed as an argv element with
 * `shell:false`, so it is never interpolated into a shell. `--skip-trust` trusts
 * the workspace for the session so a headless run never blocks on a trust prompt.
 *
 * Captured `--output-format stream-json` event shapes (one JSON object per line):
 *   { "type":"init", "session_id":"<uuid>", "model":"gemini-2.5-flash" }
 *   { "type":"message", "role":"user", "content":"…" }                         (echo — ignored)
 *   { "type":"tool_use", "tool_name":"write_file", "tool_id":"…", "parameters":{…} }
 *   { "type":"tool_result", "tool_id":"…", "status":"success", "output"?:"…" }
 *   { "type":"message", "role":"assistant", "content":"…", "delta":true }      (streamed text)
 *   { "type":"result", "status":"success", "stats":{ "total_tokens":…, "models":{…} } }
 *
 * Notes:
 *   - Gemini's `stats.models` reports the CONCRETE model an alias resolved to
 *     (e.g. `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite`); we surface it via
 *     `model_resolved`, and `stats.total_tokens` as the per-turn context usage.
 *   - No reasoning/thinking flag is exposed by the CLI, so no reasoning knob is
 *     advertised (FOR-DEV: revisit if a `--thinking`-style flag appears).
 *   - `update_topic` is a Gemini-internal bookkeeping tool and is filtered out.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { geminiToolBlock, isInternalGeminiTool } from './gemini-tools.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

const GEMINI_CAPABILITIES: AgentCapabilities = {
  // Gemini has an `--approval-mode plan` (read-only) mode.
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
};

/** Gemini context window (all current 2.5/3.x models are ~1M tokens). */
const GEMINI_CONTEXT_WINDOW = 1_048_576;

/**
 * Known Gemini models. The CLI has no enumerate command, so this is a curated
 * table (like Claude Code's aliases). `gemini-2.5-flash` is the free-tier
 * workhorse default; `flash-lite` is cheapest, `pro` the most capable.
 */
const GEMINI_MODELS: AgentModel[] = [
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', isDefault: true },
  { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' },
];

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Approval posture passed to `gemini --approval-mode`:
 *  - `default`           → `plan` (read-only; no edits/commands — safe headless);
 *  - `acceptEdits`       → `auto_edit` (auto-approve edit tools);
 *  - `bypassPermissions` → `yolo` (auto-approve all tools).
 */
export type GeminiPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

function approvalModeFor(mode: GeminiPermissionMode): string {
  if (mode === 'acceptEdits') return 'auto_edit';
  if (mode === 'bypassPermissions') return 'yolo';
  return 'plan';
}

export interface GeminiAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-gemini.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[gemini.js]` when running via node). */
  prependArgs?: string[];
  /** Default model when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Approval posture (default `acceptEdits`). */
  permissionMode?: GeminiPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

interface GeminiToolUse {
  name: string;
  id: string;
  params: Record<string, unknown>;
}

/** A normalized Gemini event extracted from one `stream-json` line. */
export interface GeminiEvent {
  kind: 'session' | 'delta' | 'tool_use' | 'tool_result' | 'completed' | 'error' | 'other';
  /** `session`: the native session id (for `--resume` continuity). */
  sessionId?: string;
  /** `session`: requested model. `completed`: the concrete model it resolved to. */
  model?: string;
  /** `delta`: streamed assistant text. `error`: the error message. */
  text?: string;
  /** `delta`: whether this is a streamed chunk (vs a single complete message). */
  delta?: boolean;
  /** `tool_use`: the tool call (name + id + parameters). */
  tool?: GeminiToolUse;
  /** `tool_result`: the tool call id this result belongs to. */
  toolId?: string;
  /** `tool_result`/`completed`: status string (`success`/`error`). */
  status?: string;
  /** `tool_result`: the tool's output text. */
  output?: string;
  /** `completed`: context-occupying token count for the turn. */
  tokens?: number;
}

/** Parse one `gemini --output-format stream-json` line, or null if it isn't JSON. */
export function parseGeminiLine(line: string): GeminiEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (parsed['type']) {
    case 'init': {
      const sessionId = str(parsed['session_id']);
      const model = str(parsed['model']);
      return {
        kind: 'session',
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(model !== undefined ? { model } : {}),
      };
    }
    case 'message': {
      if (parsed['role'] !== 'assistant') return { kind: 'other' };
      const text = str(parsed['content']) ?? '';
      return { kind: 'delta', text, delta: parsed['delta'] === true };
    }
    case 'tool_use': {
      const name = str(parsed['tool_name']);
      const id = str(parsed['tool_id']) ?? '';
      if (!name) return { kind: 'other' };
      const params = isRecord(parsed['parameters']) ? parsed['parameters'] : {};
      return { kind: 'tool_use', tool: { name, id, params } };
    }
    case 'tool_result': {
      return {
        kind: 'tool_result',
        toolId: str(parsed['tool_id']) ?? '',
        status: str(parsed['status']) ?? 'success',
        output: str(parsed['output']) ?? '',
      };
    }
    case 'result': {
      const status = str(parsed['status']) ?? 'success';
      if (status !== 'success') {
        return { kind: 'error', text: readResultError(parsed), status };
      }
      const stats = isRecord(parsed['stats']) ? parsed['stats'] : undefined;
      const tokens =
        typeof stats?.['total_tokens'] === 'number' ? stats['total_tokens'] : undefined;
      const concrete = concreteModel(stats?.['models']);
      return {
        kind: 'completed',
        ...(tokens !== undefined ? { tokens } : {}),
        ...(concrete !== undefined ? { model: concrete } : {}),
      };
    }
    case 'error':
      return { kind: 'error', text: str(parsed['message']) ?? 'gemini error' };
    default:
      return { kind: 'other' };
  }
}

export class GeminiAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'gemini-cli';
  readonly capabilities = GEMINI_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string;
  readonly #permissionMode: GeminiPermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → Gemini session id, for `--resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  /** Native Gemini session id for a thread (continuity + history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: GeminiAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'gemini';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel ?? DEFAULT_GEMINI_MODEL;
    this.#permissionMode = options.permissionMode ?? 'acceptEdits';
    this.#spawn = options.spawnFn ?? defaultSpawn;
  }

  get defaultModel(): string {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const run of this.#active.values()) run.child.kill();
    this.#active.clear();
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const resumeId = this.#sessionByThread.get(threadId);
    // First turn: create a session under a UUID we own; later turns resume it.
    const newSessionId = resumeId ? undefined : randomUUID();

    const args = [
      '--output-format',
      'stream-json',
      '--approval-mode',
      approvalModeFor(this.#permissionMode),
      // Trust the workspace for this session so a headless run never blocks on a
      // trust prompt in an arbitrary project directory.
      '--skip-trust',
    ];
    if (model) args.push('-m', model);
    if (resumeId) args.push('--resume', resumeId);
    else if (newSessionId) args.push('--session-id', newSessionId);
    args.push('-p', text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch gemini: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    let sawDelta = false;
    let errored = false;
    let completed = false;
    const pendingTools = new Map<string, GeminiToolUse>();

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseGeminiLine(line);
      if (!event) return;
      switch (event.kind) {
        case 'session':
          if (event.sessionId) this.#sessionByThread.set(threadId, event.sessionId);
          break;
        case 'delta':
          if (event.text) {
            if (event.delta) {
              full += event.text;
              sawDelta = true;
              this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
            } else if (!sawDelta) {
              // A single complete (non-streamed) assistant message.
              full = event.text;
              this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
            }
          }
          break;
        case 'tool_use':
          if (event.tool && !isInternalGeminiTool(event.tool.name)) {
            pendingTools.set(event.tool.id, event.tool);
          }
          break;
        case 'tool_result': {
          const tool = event.toolId ? pendingTools.get(event.toolId) : undefined;
          if (tool) {
            pendingTools.delete(tool.id);
            const content = geminiToolBlock(
              tool.name,
              tool.id,
              tool.params,
              event.output ?? '',
              event.status === 'error',
            );
            this.emit({ type: 'block', threadId, turnId, data: { content } });
          }
          break;
        }
        case 'completed': {
          completed = true;
          if (event.model) {
            this.emit({ type: 'model_resolved', threadId, turnId, data: { text: event.model } });
          }
          const usage =
            event.tokens !== undefined
              ? { tokens: event.tokens, contextWindow: GEMINI_CONTEXT_WINDOW }
              : undefined;
          this.emit({
            type: 'turn_completed',
            threadId,
            turnId,
            data: { text: full, ...(usage !== undefined ? { usage } : {}) },
          });
          break;
        }
        case 'error':
          errored = true;
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: event.text ?? 'gemini error' },
          });
          break;
      }
    });

    child.on('error', (err) => {
      reader.close();
      this.#active.delete(turnId);
      if (!errored && !completed) {
        errored = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `gemini process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      this.#active.delete(turnId);
      if (!completed && !errored) {
        // No terminal `result` arrived (e.g. killed): complete with what we have.
        this.emit({ type: 'turn_completed', threadId, turnId, data: { text: full } });
      }
    });

    return Promise.resolve();
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (run) {
      run.child.kill();
      this.#active.delete(turnId);
      this.emit({ type: 'turn_aborted', threadId, turnId });
    }
    return Promise.resolve();
  }

  /**
   * Gemini CLI has no enumerate command, so report the curated known set. No
   * reasoning knob is advertised (the CLI exposes no thinking/effort flag).
   */
  listModels(): Promise<AgentModel[]> {
    return Promise.resolve(GEMINI_MODELS.map((m) => ({ ...m })));
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * From Gemini's `stats.models` map (`{ "<modelId>": { total_tokens, … } }`) pick
 * the concrete model that actually ran (the one with the most tokens) — that is
 * the version an alias resolved to.
 */
function concreteModel(models: unknown): string | undefined {
  if (!isRecord(models)) return undefined;
  let best: string | undefined;
  let bestTokens = -1;
  for (const [id, stat] of Object.entries(models)) {
    const tokens =
      isRecord(stat) && typeof stat['total_tokens'] === 'number' ? stat['total_tokens'] : 0;
    if (tokens > bestTokens) {
      bestTokens = tokens;
      best = id;
    }
  }
  return bestTokens > 0 ? best : undefined;
}

/** Best-effort error message extraction from a failed `result` event. */
function readResultError(parsed: Record<string, unknown>): string {
  if (isRecord(parsed['error']) && typeof parsed['error']['message'] === 'string') {
    return parsed['error']['message'];
  }
  return str(parsed['message']) ?? 'gemini turn failed';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
