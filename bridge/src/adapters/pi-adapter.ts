/**
 * pi adapter (`@earendil-works/pi-coding-agent`, the `pi` CLI — real agent).
 *
 * pi does NOT speak the generic bridge agent IPC. Each turn spawns
 * `pi -p --mode json …` as a one-shot process and maps its newline-JSON event
 * stream onto the bridge's agent events (same one-shot pattern as the OpenCode,
 * Claude Code and Codex adapters). Session continuity is preserved by capturing
 * the session `id` from the `session` event and passing `--session-id <id>` on
 * the next turn — validated live against `pi` 0.79.1.
 *
 * Critical detail: `pi -p` blocks reading stdin when stdin is an open pipe, so we
 * spawn with stdin IGNORED (the shared `defaultSpawn`). The prompt is passed as
 * an argv element with `shell:false`, so it is never interpolated into a shell.
 *
 * Captured `--mode json` event shapes (one JSON object per line):
 *   { "type":"session", "id":"019…", "cwd":"…" }
 *   { "type":"message_update", "assistantMessageEvent":{ "type":"text_delta", "delta":"…" } }
 *   { "type":"message_end", "message":{ "role":"assistant", "content":[{ "type":"text","text":"…" }],
 *       "usage":{ "input":…, "output":…, "totalTokens":… }, "stopReason":"stop"|"error", "errorMessage"?:"…" } }
 *   { "type":"agent_end", "messages":[…], "willRetry":false }
 * (`thinking_*` assistant events carry the model's reasoning and are NOT emitted
 * as answer text.) A startup failure (e.g. a provider with no API key) prints a
 * plain-text line instead of JSON; we surface that as the turn error.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md.
 */
import { createInterface } from 'node:readline';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { effortValues, reasoningOption, reasoningValue } from './run-options.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** Hard cap on the `--list-models` spawn before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

const PI_CAPABILITIES: AgentCapabilities = {
  // Plan mode is a pi extension, not core, so it's not advertised here.
  planMode: false,
  streaming: true,
  // pi runs its tools autonomously in `-p` mode (no per-turn approval RPC).
  approvals: false,
  forking: true,
  images: true,
  reportsContextUsage: true,
};

/** Reasoning-effort levels pi's `--thinking` flag accepts (verified via `pi --help`). */
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

/** The `reasoning` knob advertised on pi models that support thinking. */
const PI_REASONING_OPTION: AgentModelOption = reasoningOption(effortValues(PI_THINKING_LEVELS));

/**
 * Tool posture passed to pi:
 *  - `default`           → `--tools read,grep,find,ls` (read-only; no bash/edit/write);
 *  - `acceptEdits`       → pi's default built-in tools (read/bash/edit/write);
 *  - `bypassPermissions` → default tools + `--approve` (trust project-local files).
 */
export type PiPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface PiAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-pi.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[cli.js]` when running via node). */
  prependArgs?: string[];
  /** Default model (`provider/model`) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Tool posture (default `acceptEdits`). */
  permissionMode?: PiPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized pi event extracted from one `--mode json` line. */
export interface PiEvent {
  kind: 'session' | 'delta' | 'final' | 'end' | 'other';
  /** Only set for `session`: the session id (for `--session-id` continuity). */
  sessionId?: string;
  /** `delta`: the streamed text chunk. `final`: the assistant message's full text. */
  text?: string;
  /** Only set for `final`: context-occupying token count, if reported. */
  tokens?: number;
  /** Only set for `final`: whether the assistant message ended in error. */
  isError?: boolean;
  /** Only set for `final`: the error message, when present. */
  errorText?: string;
}

/**
 * Sum the context-occupying tokens from a pi `usage` object
 * (`{ input, output, cacheRead, cacheWrite, totalTokens, cost }`). Prefers the
 * reported `totalTokens`, falling back to `input + output`.
 */
export function parsePiUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const num = (key: string): number => (typeof usage[key] === 'number' ? (usage[key] as number) : 0);
  const total = num('totalTokens') > 0 ? num('totalTokens') : num('input') + num('output');
  return total > 0 ? total : undefined;
}

/** Parse one `pi -p --mode json` line, or null if it isn't JSON. */
export function parsePiLine(line: string): PiEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (parsed['type']) {
    case 'session': {
      const id = typeof parsed['id'] === 'string' ? parsed['id'] : undefined;
      return { kind: 'session', ...(id !== undefined ? { sessionId: id } : {}) };
    }
    case 'message_update': {
      const event = isRecord(parsed['assistantMessageEvent'])
        ? parsed['assistantMessageEvent']
        : undefined;
      if (event && event['type'] === 'text_delta' && typeof event['delta'] === 'string') {
        return { kind: 'delta', text: event['delta'] };
      }
      // thinking_*, text_start/end and other updates carry no answer text.
      return { kind: 'other' };
    }
    case 'message_end': {
      const message = isRecord(parsed['message']) ? parsed['message'] : undefined;
      if (!message || message['role'] !== 'assistant') return { kind: 'other' };
      const text = extractAssistantText(message['content']);
      const tokens = parsePiUsageTokens(message['usage']);
      const errorMessage =
        typeof message['errorMessage'] === 'string' ? message['errorMessage'] : undefined;
      const isError = message['stopReason'] === 'error' || errorMessage !== undefined;
      return {
        kind: 'final',
        ...(text.length > 0 ? { text } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        isError,
        ...(errorMessage !== undefined ? { errorText: errorMessage } : {}),
      };
    }
    case 'agent_end':
      return { kind: 'end' };
    default:
      return { kind: 'other' };
  }
}

/**
 * Parse the `pi --list-models` table into {@link AgentModel}s. Each row is
 * `provider model context max-out thinking images` (whitespace-separated, no
 * field contains spaces). `id` is `provider/model` (the `--model` routing key);
 * models whose `thinking` column is `yes` advertise the reasoning knob.
 */
export function parsePiModelList(output: string, defaultModel?: string): AgentModel[] {
  const out: AgentModel[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 6) continue;
    const provider = cols[0]!;
    const model = cols[1]!;
    const thinking = cols[4]!;
    if (provider === 'provider') continue; // header row
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      displayName: model,
      description: provider,
      isDefault: id === defaultModel,
      ...(thinking === 'yes' ? { options: [PI_REASONING_OPTION] } : {}),
    });
  }
  return out;
}

export class PiAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'pi-agent';
  readonly capabilities = PI_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: PiPermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → pi session id, for `--session-id` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  constructor(options: PiAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'pi';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'acceptEdits';
    this.#spawn = options.spawnFn ?? defaultSpawn;
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const run of this.#active.values()) {
      run.child.kill();
    }
    this.#active.clear();
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const effort = reasoningValue(options);
    const sessionId = this.#sessionByThread.get(threadId);

    const args = ['-p', '--mode', 'json'];
    if (this.#permissionMode === 'default') args.push('--tools', 'read,grep,find,ls');
    else if (this.#permissionMode === 'bypassPermissions') args.push('--approve');
    if (model) args.push('--model', model);
    // Reasoning effort → pi's `--thinking <off|minimal|low|medium|high|xhigh>`.
    if (effort) args.push('--thinking', effort);
    // Resume the thread's session (created on the first turn); the prompt is the
    // final positional, never shell-interpolated.
    if (sessionId) args.push('--session-id', sessionId);
    args.push(text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch pi: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    let finalText = '';
    let tokens: number | undefined;
    let errored = false;
    let errorMsg: string | undefined;
    // Non-JSON output (e.g. a startup "No API key found" error) — surfaced if the
    // turn produces no content.
    const plainLines: string[] = [];
    let completed = false;

    const finish = (): void => {
      if (completed) return;
      completed = true;
      const body = full.length > 0 ? full : finalText;
      if (errored && body.length === 0) {
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: errorMsg ?? plainText(plainLines) ?? 'pi error' },
        });
        return;
      }
      if (body.length === 0 && plainLines.length > 0 && !errored) {
        // No JSON content and no terminal event: surface the plain output.
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: plainText(plainLines) ?? 'pi produced no output' },
        });
        return;
      }
      const usage = tokens !== undefined ? { tokens } : undefined;
      this.emit({
        type: 'turn_completed',
        threadId,
        turnId,
        data: { text: body, ...(usage !== undefined ? { usage } : {}) },
      });
    };

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parsePiLine(line);
      if (!event) {
        const trimmed = line.trim();
        if (trimmed.length > 0) plainLines.push(trimmed);
        return;
      }
      if (event.kind === 'session' && event.sessionId) {
        this.#sessionByThread.set(threadId, event.sessionId);
      } else if (event.kind === 'delta' && event.text) {
        full += event.text;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'final') {
        if (event.text) finalText = event.text;
        if (event.tokens !== undefined) tokens = event.tokens;
        if (event.isError) {
          errored = true;
          if (event.errorText) errorMsg = event.errorText;
        }
      } else if (event.kind === 'end') {
        finish();
      }
    });

    child.on('error', (err) => {
      reader.close();
      this.#active.delete(turnId);
      if (!completed) {
        completed = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `pi process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      this.#active.delete(turnId);
      finish();
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
   * List the models pi reports via `pi --list-models` (account-aware: only
   * providers the user has configured appear). The output is a table, parsed by
   * {@link parsePiModelList}. Resolves to `[]` if the spawn fails or times out.
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
        child = this.#spawn(this.#binaryPath, [...this.#prependArgs, '--list-models'], this.#defaultCwd);
      } catch {
        resolve([]);
        return;
      }

      const timer = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);
      const reader = createInterface({ input: child.stdout });
      reader.on('line', (line) => {
        output += `${line}\n`;
      });
      child.on('error', () => finish([]));
      child.on('close', () => finish(parsePiModelList(output, this.#defaultModel)));
    });
  }
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      text += block['text'];
    }
  }
  return text;
}

function plainText(lines: string[]): string | undefined {
  const joined = lines.join('\n').trim();
  return joined.length > 0 ? joined : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
