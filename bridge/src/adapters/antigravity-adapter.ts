/**
 * Antigravity adapter (Google's Antigravity CLI, the `agy` binary — real agent).
 *
 * Antigravity is Google's successor to the now-deprecated standalone Gemini CLI:
 * its models ARE the Gemini family ("Gemini 3.5 Flash", "Gemini 3.1 Pro", …) plus
 * a few hosted others. It does NOT speak the generic bridge agent IPC. Each turn
 * spawns `agy … -p <text>` as a one-shot process (the same one-shot pattern as the
 * pi, Claude Code and Gemini adapters) and maps its plain-text stdout onto the
 * bridge's agent events. Validated live against `agy` 1.1.4.
 *
 * Per-turn command shape:
 *   agy --conversation <uuid> --add-dir <cwd> \
 *       (--dangerously-skip-permissions | --mode plan) [--model "<label>"] -p <text>
 *
 * Why each flag (each verified live — earlier `agy` releases lacked all of them,
 * which is why Antigravity was previously deferred, see bridge/FOR-DEV.md):
 *  - `--conversation <uuid>`: session continuity. `agy` accepts a client-owned
 *    UUID, CREATING the conversation on the first turn and RESUMING it on later
 *    ones (verified), so — like the Gemini adapter's `--session-id` — we generate
 *    the id ourselves and never parse `agy`'s logs. Stored per thread in
 *    {@link AntigravityAdapter.nativeSessionId}.
 *  - `--add-dir <cwd>`: workspace targeting. `agy` has NO `-C/--cwd`; without
 *    `--add-dir` it ignores the process cwd and edits a private scratch folder,
 *    so we add the thread's project dir as the workspace root.
 *  - permission flag: `agy`'s headless `-p` mode has NO interactive approval
 *    channel — a tool that needs permission is AUTO-DENIED ("no output produced")
 *    unless we pass `--dangerously-skip-permissions`. So editing turns run with
 *    skip-permissions (autonomous, like pi); a `requestApproval` thread degrades
 *    to read-only `--mode plan` instead (the safe "can't ask you, so I'll only
 *    plan" posture). See {@link AntigravityAdapter.#effectiveMode}.
 *  - `--model "<label>"`: the label from `agy models` (e.g. "Gemini 3.5 Flash
 *    (High)"); omitted → `agy`'s own default.
 *
 * Critical detail: like the other one-shot CLIs, we spawn with stdin IGNORED (the
 * shared {@link defaultSpawn}) and pass the prompt as an argv element with
 * `shell:false`, so it is never interpolated into a shell (no command injection).
 * `agy` streams the answer as plain text on STDOUT (its verbose logs go to a log
 * file, never stderr); STDERR carries only real errors (the headless
 * "no output produced" auto-deny), surfaced as the turn error when stdout is empty.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/agents.md.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** Hard cap on the `agy models` spawn before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = {
  // `agy --mode plan` gives a real read-only planning mode.
  planMode: true,
  streaming: true,
  // `agy -p` runs its tools without a per-turn approval RPC (headless mode
  // cannot prompt), so no interactive approval channel is advertised.
  approvals: false,
  // Antigravity operates autonomously ("YOLO"): with `--dangerously-skip-
  // permissions` it acts and edits without per-action approval prompts, because
  // its headless CLI exposes no pre-tool approval channel. The phone surfaces
  // this so the user knows Antigravity won't ask before running tools.
  autonomous: true,
  // A client-owned `--conversation <uuid>` resumes a thread across turns.
  forking: true,
  images: false,
  // `agy -p` reports no per-turn token usage, so the context meter stays hidden.
  reportsContextUsage: false,
};

/**
 * Tool posture passed to `agy`:
 *  - `plan`              → `--mode plan` (read-only; analyses and plans, no edits);
 *  - `acceptEdits`       → `--dangerously-skip-permissions` (autonomous edits);
 *  - `bypassPermissions` → `--dangerously-skip-permissions` (autonomous edits).
 *
 * `agy`'s headless `-p` has only two effective postures — "act autonomously" and
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

export interface AntigravityAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-antigravity.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (unused for the native `agy` exe). */
  prependArgs?: string[];
  /** Default model label (an `agy models` entry) when the thread/turn picks none. */
  defaultModel?: string;
  /** Tool posture default when the thread sets no access mode (default `bypassPermissions`). */
  permissionMode?: AntigravityPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/**
 * Parse the `agy models` output (one model label per line) into
 * {@link AgentModel}s. The label IS the `--model` routing key (e.g. "Gemini 3.5
 * Flash (High)"), so `id === displayName`. `agy` lists its account default first,
 * so — absent a configured `defaultModel` that matches — the first entry is
 * marked as the default (presentation-only). Header/blank lines are skipped.
 */
export function parseAntigravityModelList(output: string, defaultModel?: string): AgentModel[] {
  const out: AgentModel[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a header row like "Available models:" (the sub-command prints none
    // today, but stay robust if a future version adds one).
    if (line.endsWith(':')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({ id: line, displayName: line });
  }
  const defaultIndex =
    defaultModel !== undefined ? out.findIndex((m) => m.id === defaultModel) : -1;
  const markIndex = defaultIndex >= 0 ? defaultIndex : out.length > 0 ? 0 : -1;
  if (markIndex >= 0) out[markIndex] = { ...out[markIndex]!, isDefault: true };
  return out;
}

export class AntigravityAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'antigravity-cli';
  readonly capabilities = ANTIGRAVITY_CAPABILITIES;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #permissionMode: AntigravityPermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → client-owned `agy` conversation UUID, for `--conversation` continuity. */
  readonly #conversationByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  /** Native `agy` conversation id for a thread (surfaced as the thread's session id). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#conversationByThread.get(threadId);
  }

  constructor(options: AntigravityAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'agy';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'bypassPermissions';
    this.#spawn = options.spawnFn ?? defaultSpawn;
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
    for (const run of this.#active.values()) run.child.kill();
    this.#active.clear();
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    // Conversation id: created and owned by us on the first turn, reused after so
    // `agy` resumes the same conversation (continuity across turns).
    let conversationId = this.#conversationByThread.get(threadId);
    if (conversationId === undefined) {
      conversationId = randomUUID();
      this.#conversationByThread.set(threadId, conversationId);
    }
    const mode = this.#effectiveMode(options.accessMode);

    const args = ['--conversation', conversationId, '--add-dir', cwd, ...permissionArgs(mode)];
    if (model) args.push('--model', model);
    // The prompt is the final positional, never shell-interpolated (`shell:false`).
    args.push('-p', text);

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch Antigravity (agy): ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    let stderrBuf = '';
    let completed = false;

    const finish = (): void => {
      if (completed) return;
      completed = true;
      this.#active.delete(turnId);
      const body = full.trim();
      if (body.length > 0) {
        this.emit({ type: 'turn_completed', threadId, turnId, data: { text: full } });
        return;
      }
      // No answer on stdout: `agy` prints a diagnostic to stderr (e.g. the
      // headless "no output produced — a tool required permission" auto-deny).
      const errText = stderrBuf.trim();
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: errText.length > 0 ? errText : 'Antigravity produced no output' },
      });
    };

    child.stdout.on('data', (chunk: unknown) => {
      const chunkText = String(chunk);
      full += chunkText;
      this.emit({ type: 'delta', threadId, turnId, data: { text: chunkText } });
    });
    child.stderr?.on('data', (chunk: unknown) => {
      stderrBuf += String(chunk);
    });

    child.on('error', (err) => {
      this.#active.delete(turnId);
      if (!completed) {
        completed = true;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: `Antigravity process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => finish());

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
   * List the models `agy models` reports (e.g. "Gemini 3.5 Flash (High)"), each a
   * `--model` routing key. Parsed by {@link parseAntigravityModelList}. Resolves
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
