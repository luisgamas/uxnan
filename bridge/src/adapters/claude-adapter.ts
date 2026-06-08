/**
 * Claude Code adapter (real agent).
 *
 * Claude Code does NOT speak the generic bridge agent IPC. Each turn spawns
 * `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages`
 * as a one-shot process and maps its JSONL event stream onto the bridge's agent
 * events (same one-shot pattern as the OpenCode adapter). Session continuity is
 * preserved by capturing `session_id` from the stream and passing `--resume` on
 * the next turn.
 *
 * Critical detail: the prompt is passed as an argv element and spawned with
 * `shell:false` (no shell interpolation), and stdin is IGNORED.
 *
 * Captured stream-json event shapes (one JSON object per line), verified against
 * `claude` 2.x:
 *   { "type":"system", "subtype":"init", "session_id":"…", "model":"…" }
 *   { "type":"stream_event", "event":{ "type":"content_block_delta", "delta":{ "type":"text_delta", "text":"…" } }, "session_id":"…" }
 *   { "type":"assistant", "message":{ "content":[ { "type":"text", "text":"…" } ] }, "session_id":"…" }
 *   { "type":"result", "subtype":"success", "is_error":false, "result":"<final text>", "session_id":"…" }
 *
 * See bridge/FOR-DEV.md (agent adapters) and TESTING.md (validating adapters).
 */
import { createInterface } from 'node:readline';
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
};

/** Stable `--model` aliases Claude Code accepts (it has no enumerate command). */
const CLAUDE_MODEL_ALIASES = ['opus', 'sonnet', 'haiku'];

/**
 * Headless permission posture passed to the CLI:
 *  - `default`           → no flag (tools needing approval are auto-denied headless);
 *  - `acceptEdits`       → `--permission-mode acceptEdits` (file edits auto-apply);
 *  - `bypassPermissions` → `--dangerously-skip-permissions` (all tools run).
 */
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface ClaudeCodeAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-claude.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[cli.js]` when running via node). */
  prependArgs?: string[];
  /** Default model (`alias` or full id) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Headless permission posture (default `acceptEdits`). */
  permissionMode?: ClaudePermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized Claude Code event extracted from one stream-json line. */
export interface ClaudeEvent {
  kind: 'init' | 'delta' | 'assistant_text' | 'result' | 'other';
  sessionId?: string;
  text?: string;
  /** Only set for `result`: whether the turn ended in error. */
  isError?: boolean;
}

/** Parse one `claude … --output-format stream-json` line, or null if it isn't JSON. */
export function parseClaudeLine(line: string): ClaudeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId = typeof parsed['session_id'] === 'string' ? parsed['session_id'] : undefined;
  const base = { sessionId } as const;
  switch (parsed['type']) {
    case 'system':
      return { kind: 'init', ...base };
    case 'stream_event': {
      const event = isRecord(parsed['event']) ? parsed['event'] : undefined;
      if (event && event['type'] === 'content_block_delta') {
        const delta = isRecord(event['delta']) ? event['delta'] : undefined;
        if (delta && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
          return { kind: 'delta', ...base, text: delta['text'] };
        }
      }
      return { kind: 'other', ...base };
    }
    case 'assistant': {
      const message = isRecord(parsed['message']) ? parsed['message'] : undefined;
      const text = message ? extractAssistantText(message['content']) : '';
      return { kind: 'assistant_text', ...base, text };
    }
    case 'result': {
      const isError = parsed['is_error'] === true || parsed['subtype'] !== 'success';
      const text = typeof parsed['result'] === 'string' ? parsed['result'] : undefined;
      return { kind: 'result', ...base, text, isError };
    }
    default:
      return { kind: 'other', ...base };
  }
}

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'claude-code';
  readonly capabilities = CLAUDE_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: ClaudePermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → Claude session id, for `--resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'claude';
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
    const sessionId = this.#sessionByThread.get(threadId);

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    if (this.#permissionMode === 'acceptEdits') args.push('--permission-mode', 'acceptEdits');
    else if (this.#permissionMode === 'bypassPermissions')
      args.push('--dangerously-skip-permissions');
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    args.push(text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch claude: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    let sawPartial = false;
    let errored = false;
    let completed = false;

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseClaudeLine(line);
      if (!event) return;
      if (event.sessionId) this.#sessionByThread.set(threadId, event.sessionId);
      if (event.kind === 'delta' && event.text) {
        sawPartial = true;
        full += event.text;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'assistant_text' && event.text && !sawPartial) {
        // Fallback when token streaming produced no deltas: emit the complete
        // assistant message text as one chunk.
        full += event.text;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'result') {
        if (event.isError) {
          errored = true;
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: event.text && event.text.length > 0 ? event.text : 'claude error' },
          });
        } else {
          completed = true;
          const finalText = event.text && event.text.length > 0 ? event.text : full;
          this.emit({ type: 'turn_completed', threadId, turnId, data: { text: finalText } });
        }
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
          data: { text: `claude process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      this.#active.delete(turnId);
      if (!completed && !errored) {
        // No terminal `result` line arrived (e.g. killed): complete with what we have.
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

  /** Claude Code has no model-list command; expose the stable `--model` aliases. */
  listModels(): Promise<string[]> {
    return Promise.resolve([...CLAUDE_MODEL_ALIASES]);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
