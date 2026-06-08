/**
 * OpenAI Codex CLI adapter (real agent).
 *
 * Codex does NOT speak the generic bridge agent IPC. Each turn spawns
 * `codex exec --json …` as a one-shot process and maps its JSONL event stream
 * onto the bridge's agent events (same one-shot pattern as the OpenCode and
 * Claude Code adapters). Session continuity is preserved by capturing the
 * `thread_id` from `thread.started` and passing `exec resume <thread_id>` on the
 * next turn — validated live against `codex-cli` 0.137.
 *
 * Critical detail: `codex exec` blocks reading stdin when stdin is an open pipe
 * (it prints "Reading additional input from stdin…"), so we spawn with stdin
 * IGNORED. The prompt is passed as an argv element with `shell:false`, so it is
 * never interpolated into a shell. We always pass `--skip-git-repo-check` so a
 * thread can run in any project directory, git or not.
 *
 * Captured `--json` event shapes (one JSON object per line):
 *   { "type":"thread.started", "thread_id":"019…" }
 *   { "type":"turn.started" }
 *   { "type":"item.completed", "item":{ "type":"agent_message", "text":"…" } }
 *   { "type":"turn.completed", "usage":{ … } }
 *   { "type":"turn.failed", "error":{ "message":"…" } }
 *
 * Note: Codex does NOT need its `app-server` / `exec-server` / `mcp-server` modes
 * here — those drive the desktop app / IDE / MCP integrations. `codex exec` is the
 * one-shot non-interactive entry point the bridge uses.
 *
 * See bridge/FOR-DEV.md (agent adapters) and TESTING.md (validating adapters).
 */
import { createInterface } from 'node:readline';
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

const CODEX_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
};

/**
 * Headless sandbox posture passed to `codex exec`:
 *  - `default`           → `-s read-only` (reads only; edits/commands denied);
 *  - `acceptEdits`       → `-s workspace-write` (edits the workspace, network gated);
 *  - `bypassPermissions` → `--dangerously-bypass-approvals-and-sandbox` (full access).
 */
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface CodexAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-codex.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[codex.js]` when running via node). */
  prependArgs?: string[];
  /** Default model when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Headless sandbox posture (default `acceptEdits`). */
  permissionMode?: CodexPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized Codex event extracted from one `exec --json` line. */
export interface CodexEvent {
  kind: 'thread' | 'message' | 'completed' | 'error' | 'other';
  threadId?: string;
  text?: string;
}

/** Parse one `codex exec --json` line, or null if it isn't JSON. */
export function parseCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (parsed['type']) {
    case 'thread.started': {
      const threadId = typeof parsed['thread_id'] === 'string' ? parsed['thread_id'] : undefined;
      return { kind: 'thread', threadId };
    }
    case 'item.completed': {
      const item = isRecord(parsed['item']) ? parsed['item'] : undefined;
      if (item && item['type'] === 'agent_message' && typeof item['text'] === 'string') {
        return { kind: 'message', text: item['text'] };
      }
      return { kind: 'other' };
    }
    case 'turn.completed':
      return { kind: 'completed' };
    case 'turn.failed':
    case 'error':
      return { kind: 'error', text: readErrorMessage(parsed['error']) };
    default:
      return { kind: 'other' };
  }
}

export class CodexAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'codex';
  readonly capabilities = CODEX_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: CodexPermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → Codex thread id, for `exec resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  constructor(options: CodexAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'codex';
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
    const resumeId = this.#sessionByThread.get(threadId);

    // Exec-level options come first, then the optional `resume <id>` subcommand,
    // then the prompt as the final positional (validated against codex-cli 0.137).
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (this.#permissionMode === 'acceptEdits') args.push('-s', 'workspace-write');
    else if (this.#permissionMode === 'bypassPermissions')
      args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('-s', 'read-only');
    if (model) args.push('-m', model);
    if (cwd) args.push('-C', cwd);
    if (resumeId) args.push('resume', resumeId);
    args.push(text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch codex: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    let errored = false;
    let completed = false;

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseCodexLine(line);
      if (!event) return;
      if (event.kind === 'thread' && event.threadId) {
        this.#sessionByThread.set(threadId, event.threadId);
      } else if (event.kind === 'message' && event.text) {
        // Codex emits complete `agent_message` items (no token deltas): each is a chunk.
        full += event.text;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'error') {
        errored = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: event.text ?? 'codex error' },
        });
      } else if (event.kind === 'completed') {
        completed = true;
        this.emit({ type: 'turn_completed', threadId, turnId, data: { text: full } });
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
          data: { text: `codex process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      this.#active.delete(turnId);
      if (!completed && !errored) {
        // No terminal `turn.completed` arrived (e.g. killed): complete with what we have.
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    if (typeof error['message'] === 'string') return error['message'];
    if (typeof error['type'] === 'string') return error['type'];
  }
  return typeof error === 'string' ? error : 'codex error';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
