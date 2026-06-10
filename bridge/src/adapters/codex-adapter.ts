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
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md (validating adapters).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
import { effortValues, reasoningOption, reasoningValue, withOptions } from './run-options.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** JSON-RPC ids for the app-server model-discovery handshake. */
const INIT_ID = 1;
const MODEL_LIST_ID = 2;
/** Hard cap on the app-server handshake before falling back to config.toml. */
const MODEL_LIST_TIMEOUT_MS = 8000;

const CODEX_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
};

/**
 * Reasoning-effort knob for Codex models discovered without an effort list
 * (the `~/.codex/config.toml` fallback path). The app-server `model/list`
 * reports the REAL per-model efforts (see `parseCodexReasoning`); this covers
 * only the config-only fallback. Maps to `-c model_reasoning_effort=<level>`.
 */
const CODEX_FALLBACK_REASONING: AgentModelOption = reasoningOption(
  effortValues(['low', 'medium', 'high', 'xhigh']),
);

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
  /** Only set for `completed`: context-occupying token count, if reported. */
  tokens?: number;
}

/**
 * Sum the context-occupying tokens from a Codex `turn.completed.usage` object
 * (`{ input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }`
 * — `cached_input_tokens` is a subset of `input_tokens`, so it isn't added).
 */
export function codexUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const count = (key: string): number =>
    typeof usage[key] === 'number' ? (usage[key] as number) : 0;
  const total = count('input_tokens') + count('output_tokens') + count('reasoning_output_tokens');
  return total > 0 ? total : undefined;
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
      return { kind: 'completed', tokens: codexUsageTokens(parsed['usage']) };
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
    // Reasoning effort → Codex config override (`-c model_reasoning_effort=…`,
    // low|medium|high). Applies to reasoning models; others ignore it. The `-c`
    // key=value override mechanism is verified against `codex exec --help`.
    // Reads the `reasoning` knob, then legacy effort.
    const effort = reasoningValue(options);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
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
        const usage = event.tokens !== undefined ? { tokens: event.tokens } : undefined;
        this.emit({
          type: 'turn_completed',
          threadId,
          turnId,
          data: { text: full, ...(usage !== undefined ? { usage } : {}) },
        });
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

  /**
   * List the models the account can use, account-aware (free vs paid changes
   * the set). `codex exec` has no enumerate command, so we drive the same
   * protocol the desktop app uses: spawn `codex app-server` and run the
   * `initialize` → `model/list` JSON-RPC handshake (newline-delimited JSON over
   * stdio). Falls back to `~/.codex/config.toml` (`model` + the
   * `[tui.model_availability_nux]` table) if the app-server is unavailable.
   */
  listModels(): Promise<AgentModel[]> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let child: ReturnType<typeof spawn>;

      const finish = (models: AgentModel[]): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        // parseCodexModelList already attaches each model's REAL per-model
        // reasoning efforts; the config fallback gets a generic effort knob.
        resolve(models.length > 0 ? models : this.#modelsFromConfig());
      };

      try {
        // Direct spawn (not the injected SpawnFn): app-server needs a writable
        // stdin for the JSON-RPC handshake, which the shared one-shot spawn closes.
        child = spawn(this.#binaryPath, [...this.#prependArgs, 'app-server'], {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        resolve(this.#modelsFromConfig());
        return;
      }

      if (!child.stdout) {
        finish([]);
        return;
      }

      timer = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);
      const send = (msg: unknown): void => {
        try {
          child.stdin?.write(`${JSON.stringify(msg)}\n`);
        } catch {
          /* pipe closed */
        }
      };

      const reader = createInterface({ input: child.stdout });
      reader.on('line', (line) => {
        const parsed = safeParse(line);
        if (!parsed) return;
        if (parsed['id'] === INIT_ID) {
          // Init acknowledged — now ask for the model catalog.
          send({ jsonrpc: '2.0', id: MODEL_LIST_ID, method: 'model/list', params: {} });
        } else if (parsed['id'] === MODEL_LIST_ID && isRecord(parsed['result'])) {
          finish(parseCodexModelList(parsed['result']['data']));
        }
      });
      child.on('error', () => finish([]));
      child.on('close', () => finish([]));

      send({
        jsonrpc: '2.0',
        id: INIT_ID,
        method: 'initialize',
        params: {
          clientInfo: { name: 'uxnan-bridge', title: null, version: '1.0.0' },
          capabilities: { experimentalApi: false, requestAttestation: false },
        },
      });
    });
  }

  /** Fallback model list read straight from `~/.codex/config.toml`. */
  #modelsFromConfig(): AgentModel[] {
    try {
      const path = join(homedir(), '.codex', 'config.toml');
      if (!existsSync(path)) return [];
      // No effort metadata in config.toml — attach the generic effort knob.
      return withOptions(
        parseCodexConfigModels(readFileSync(path, 'utf-8')),
        [CODEX_FALLBACK_REASONING],
      );
    } catch {
      return [];
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse one newline-delimited JSON-RPC line, or null if it isn't a JSON object. */
function safeParse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Map the app-server `model/list` → `result.data` array into {@link AgentModel}s,
 * skipping models hidden from the default picker.
 */
export function parseCodexModelList(data: unknown): AgentModel[] {
  if (!Array.isArray(data)) return [];
  const out: AgentModel[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    if (entry['hidden'] === true) continue;
    const id =
      typeof entry['id'] === 'string'
        ? entry['id']
        : typeof entry['model'] === 'string'
          ? entry['model']
          : undefined;
    if (!id) continue;
    const displayName =
      typeof entry['displayName'] === 'string' && entry['displayName'].length > 0
        ? entry['displayName']
        : id;
    const description =
      typeof entry['description'] === 'string' && entry['description'].length > 0
        ? entry['description']
        : undefined;
    const options = parseCodexReasoning(
      entry['supportedReasoningEfforts'],
      entry['defaultReasoningEffort'],
    );
    out.push({
      id,
      displayName,
      ...(description !== undefined ? { description } : {}),
      isDefault: entry['isDefault'] === true,
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return out;
}

/**
 * Build the per-model reasoning knob from the app-server's
 * `supportedReasoningEfforts` (`[{ reasoningEffort, description }]`) and
 * `defaultReasoningEffort`. Returns `[]` when the model reports no efforts.
 */
export function parseCodexReasoning(raw: unknown, defaultEffort: unknown): AgentModelOption[] {
  if (!Array.isArray(raw)) return [];
  const levels: string[] = [];
  for (const entry of raw) {
    const level =
      isRecord(entry) && typeof entry['reasoningEffort'] === 'string'
        ? entry['reasoningEffort']
        : undefined;
    if (level && !levels.includes(level)) levels.push(level);
  }
  if (levels.length === 0) return [];
  const def =
    typeof defaultEffort === 'string' && levels.includes(defaultEffort)
      ? defaultEffort
      : undefined;
  return [reasoningOption(effortValues(levels), def)];
}

/**
 * Fallback parse of `~/.codex/config.toml`: the top-level `model` plus the keys
 * of the `[tui.model_availability_nux]` table (models the account has seen).
 * The configured `model` is flagged `isDefault`. Minimal hand-rolled scan — no
 * TOML dependency — tolerant of comments and quoting.
 */
export function parseCodexConfigModels(toml: string): AgentModel[] {
  let section = '';
  let configuredModel: string | undefined;
  const ids = new Set<string>();
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim();
      continue;
    }
    const kv = /^("?)([^"=]+?)\1\s*=\s*(.+)$/.exec(line);
    const key = kv?.[2]?.trim();
    if (!key) continue;
    if (section === '' && key === 'model') {
      const value = (kv?.[3] ?? '').trim().replace(/^["']|["']$/g, '');
      if (value) {
        configuredModel = value;
        ids.add(value);
      }
    } else if (section === 'tui.model_availability_nux') {
      ids.add(key);
    }
  }
  return [...ids].map(
    (id) => ({ id, displayName: id, isDefault: id === configuredModel }) satisfies AgentModel,
  );
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
