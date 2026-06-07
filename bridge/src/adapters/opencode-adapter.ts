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
 * See bridge/FOR-DEV.md (agent adapters) and TESTING.md (validating adapters).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: true,
  images: true,
};

/** Minimal child-process surface the adapter relies on (so it can be faked in tests). */
export interface SpawnedProcess {
  stdout: NodeJS.ReadableStream;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export type SpawnFn = (command: string, args: string[], cwd: string) => SpawnedProcess;

const defaultSpawn: SpawnFn = (command, args, cwd) =>
  spawn(command, args, {
    cwd,
    // stdin IGNORED: OpenCode hangs waiting for stdin EOF otherwise.
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });

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
  kind: 'text' | 'reasoning' | 'error' | 'finish' | 'other';
  sessionId?: string;
  partId?: string;
  text?: string;
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
    case 'step_finish':
      return { kind: 'finish', ...base };
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
    if (options.effort) args.push('--variant', options.effort);
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
    let full = '';
    let errored = false;

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

  /** Run `opencode models` and return the `provider/model` ids it reports. */
  listModels(): Promise<string[]> {
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
      child.on('close', () => resolve(parseModelList(stdout)));
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
