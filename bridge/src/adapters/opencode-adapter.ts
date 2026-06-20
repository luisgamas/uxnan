/**
 * OpenCode adapter (MVP-priority real agent).
 *
 * OpenCode does NOT speak the generic bridge agent IPC. Instead, each turn spawns
 * `opencode run --format json` as a one-shot process and maps its newline-JSON
 * event stream onto the bridge's agent events. Session continuity is preserved by
 * capturing the `sessionID` from the first turn and passing `--session` on the next.
 *
 * Critical detail: OpenCode blocks reading stdin when stdin is an open pipe, so we
 * spawn with stdin IGNORED (closed). The prompt is passed as an argv element and
 * spawned with `shell:false`, so it is never interpolated into a shell.
 *
 * Captured `--format json` event shape (one JSON object per line):
 *   { "type":"step_start", "sessionID":"ses_…", "part":{…} }
 *   { "type":"text", "sessionID":"ses_…", "part":{ "id":"prt_…","type":"text","text":"…" } }
 *   { "type":"step_finish", "sessionID":"ses_…", "part":{ "tokens":{…}, "cost":… } }
 *   { "type":"error", "sessionID":"ses_…", "error":{ "data":{ "message":"…" } } }
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md (validating adapters).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { opencodeToolBlock } from './opencode-tools.js';
import { reasoningValue } from './run-options.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

// Re-exported for backwards-compatible imports (these types now live in spawn.ts).
export type { SpawnFn, SpawnedProcess } from './spawn.js';

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: true,
  images: true,
  // OpenCode reports per-step token counts (`step_finish.part.tokens`), surfaced
  // as `usage.tokens` so the phone shows the context indicator.
  reportsContextUsage: true,
};

/**
 * Sum the context-occupying tokens from an OpenCode `step_finish.part.tokens`
 * object (`{ input, output, reasoning, cache: { read, write } }`). Counts the
 * distinct buckets — cache read/write are subsets of `input`, so they are not
 * added (avoids double counting). Falls back to summing any top-level numeric
 * fields if the shape differs, and returns undefined when there is nothing.
 */
export function openCodeUsageTokens(tokens: unknown): number | undefined {
  if (!isRecord(tokens)) return undefined;
  const num = (key: string): number =>
    typeof tokens[key] === 'number' ? (tokens[key] as number) : 0;
  const known = num('input') + num('output') + num('reasoning');
  if (known > 0) return known;
  let sum = 0;
  for (const value of Object.values(tokens)) {
    if (typeof value === 'number') sum += value;
  }
  return sum > 0 ? sum : undefined;
}

export interface OpenCodeAdapterOptions {
  /** Executable to spawn (resolved exe path; see resolve-opencode.ts). */
  binaryPath?: string;
  /** Default model (`provider/model`) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized OpenCode event extracted from one `--format json` line. */
export interface OpenCodeEvent {
  kind: 'text' | 'reasoning' | 'tool' | 'error' | 'finish' | 'other';
  sessionId?: string;
  partId?: string;
  text?: string;
  /** `tool`: the tool name (`bash`/`edit`/`write`/…). */
  toolName?: string;
  /** `tool`: lifecycle status (`pending`/`running`/`completed`/`error`). */
  toolStatus?: string;
  /** `tool`: the tool's arguments. */
  toolInput?: Record<string, unknown>;
  /** `tool`: the tool's output, when finished. */
  toolOutput?: string;
  /** `finish`: context-occupying token count from `step_finish.part.tokens`. */
  tokens?: number;
}

/** Parse one `opencode run --format json` line, or null if it isn't JSON. */
export function parseOpenCodeLine(line: string): OpenCodeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId = typeof parsed['sessionID'] === 'string' ? parsed['sessionID'] : undefined;
  const part = isRecord(parsed['part']) ? parsed['part'] : undefined;
  const partId = part && typeof part['id'] === 'string' ? part['id'] : undefined;
  const base = { sessionId, partId } as const;
  switch (parsed['type']) {
    case 'text':
      return { kind: 'text', ...base, text: stringOr(part?.['text'], '') };
    case 'reasoning':
      return { kind: 'reasoning', ...base, text: stringOr(part?.['text'], '') };
    case 'tool_use': {
      const state = part && isRecord(part['state']) ? part['state'] : undefined;
      return {
        kind: 'tool',
        ...base,
        toolName: stringOr(part?.['tool'], ''),
        toolStatus: stringOr(state?.['status'], ''),
        toolInput: state && isRecord(state['input']) ? state['input'] : {},
        toolOutput: stringOr(state?.['output'], ''),
      };
    }
    case 'step_finish':
      return { kind: 'finish', ...base, tokens: openCodeUsageTokens(part?.['tokens']) };
    case 'error':
      return { kind: 'error', ...base, text: readErrorMessage(parsed['error']) };
    default:
      return { kind: 'other', ...base };
  }
}

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'opencode';
  readonly capabilities = OPENCODE_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #defaultModel: string | undefined;
  readonly #spawn: SpawnFn;
  /** threadId → OpenCode session id, for `--session` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  /** Native OpenCode session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: OpenCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'opencode';
    this.#defaultModel = options.defaultModel;
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
    const sessionId = this.#sessionByThread.get(threadId);

    const args = ['run', '--format', 'json'];
    if (model) args.push('--model', model);
    // OpenCode's reasoning knob is the provider/model `--variant`; it reads the
    // generic `reasoning` value, then legacy effort. (Variants are
    // provider-specific and enumerated at runtime, so they aren't advertised.)
    const variant = reasoningValue(options);
    if (variant) args.push('--variant', variant);
    if (sessionId) args.push('--session', sessionId);
    if (cwd) args.push('--dir', cwd);
    args.push(text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, args, cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch opencode: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    const partTexts = new Map<string, string>();
    const reasoningTexts = new Map<string, string>();
    const emittedTools = new Set<string>();
    let full = '';
    let errored = false;
    // Latest per-step token count (`step_finish.part.tokens`); emitted as
    // `usage.tokens` on completion so the phone's context indicator fills in.
    let tokens: number | undefined;

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseOpenCodeLine(line);
      if (!event) return;
      if (event.sessionId) this.#sessionByThread.set(threadId, event.sessionId);
      if (event.kind === 'text' && event.text) {
        const delta = this.#deltaFor(partTexts, event.partId, event.text);
        if (delta) {
          full += delta;
          this.emit({ type: 'delta', threadId, turnId, data: { text: delta } });
        }
      } else if (event.kind === 'reasoning' && event.text) {
        // Reasoning streams as a (re-sent) part text; emit only the new suffix
        // as a thinking delta.
        const delta = this.#deltaFor(reasoningTexts, event.partId, event.text);
        if (delta) {
          this.emit({ type: 'thinking', threadId, turnId, data: { text: delta } });
        }
      } else if (event.kind === 'tool') {
        // Emit the structured block once, when the tool reaches a terminal state.
        const id = event.partId ?? '';
        const status = event.toolStatus;
        if ((status === 'completed' || status === 'error') && !emittedTools.has(id)) {
          emittedTools.add(id);
          this.emit({
            type: 'block',
            threadId,
            turnId,
            data: {
              content: opencodeToolBlock(
                event.toolName ?? '',
                id,
                event.toolInput ?? {},
                event.toolOutput ?? '',
                status === 'error',
              ),
            },
          });
        }
      } else if (event.kind === 'finish') {
        // Keep the latest step's token count as the turn's context usage.
        if (event.tokens !== undefined) tokens = event.tokens;
      } else if (event.kind === 'error') {
        errored = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: event.text ?? 'opencode error' },
        });
      }
    });

    child.on('error', (err) => {
      reader.close();
      this.#active.delete(turnId);
      if (!errored) {
        errored = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `opencode process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      this.#active.delete(turnId);
      if (!errored) {
        const usage = tokens !== undefined ? { tokens } : undefined;
        this.emit({
          type: 'turn_completed',
          threadId,
          turnId,
          data: { text: full, ...(usage !== undefined ? { usage } : {}) },
        });
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

  /** Run `opencode models` and return the `provider/model` ids it reports. */
  listModels(): Promise<AgentModel[]> {
    const def = this.#defaultModel;
    return new Promise((resolve) => {
      let stdout = '';
      let child;
      try {
        child = spawn(this.#binaryPath, ['models'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        resolve([]);
        return;
      }
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.on('error', () => resolve([]));
      child.on('close', () =>
        resolve(
          parseModelList(stdout).map(
            (id) => ({ id, displayName: id, isDefault: def === id }) satisfies AgentModel,
          ),
        ),
      );
    });
  }

  /**
   * Emit only the newly-appended suffix for a part. Handles both one-shot text
   * parts and incrementally-updated parts (same id streamed multiple times).
   */
  #deltaFor(partTexts: Map<string, string>, partId: string | undefined, text: string): string {
    const key = partId ?? '';
    const previous = partTexts.get(key) ?? '';
    let delta: string;
    if (text.startsWith(previous)) {
      delta = text.slice(previous.length);
    } else {
      delta = text;
    }
    partTexts.set(key, text);
    return delta;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g;

/** Parse `opencode models` output into a unique list of `provider/model` ids. */
export function parseModelList(stdout: string): string[] {
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI_PATTERN, '').trim();
    // Model ids look like `provider/model`; skip headers/blank lines.
    if (line.includes('/') && !line.includes(' ')) seen.add(line);
  }
  return [...seen];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const data = error['data'];
    if (isRecord(data) && typeof data['message'] === 'string') return data['message'];
    if (typeof error['message'] === 'string') return error['message'];
    if (typeof error['name'] === 'string') return error['name'];
  }
  return 'opencode error';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
