/**
 * Antigravity adapter (Google's Antigravity CLI, the `agy` binary — real agent).
 *
 * Antigravity is Google's successor to the now-deprecated standalone Gemini CLI:
 * its models ARE the Gemini family ("Gemini 3.5 Flash", "Gemini 3.1 Pro", …) plus
 * a few hosted others. It does NOT speak the generic bridge agent IPC. Each turn
 * spawns `agy … -p <text>` as a one-shot process (the same one-shot pattern as the
 * pi and Claude Code adapters) and maps its plain-text stdout onto the
 * bridge's agent events. Validated live against `agy` 1.1.4.
 *
 * Per-turn command shape:
 *   agy --conversation <uuid> --add-dir <cwd> \
 *       (--dangerously-skip-permissions | --mode plan) [--model <id>] -p <text>
 *
 * Why each flag (each verified live — earlier `agy` releases lacked all of them,
 * which is why Antigravity was previously deferred, see bridge/FOR-DEV.md):
 *  - `--conversation <uuid>`: session continuity. `agy` accepts a client-owned
 *    UUID, CREATING the conversation on the first turn and RESUMING it on later
 *    ones (verified), so we generate
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
 *  - `--model <id>`: the id column of `agy models` (e.g. `gemini-3.7-flash-high`),
 *    which already carries the reasoning tier — a tier-less id is rejected with
 *    "requires --effort", so the bridge never passes `--effort` separately;
 *    omitted → `agy`'s own default.
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
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
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
  // The bridge delivers an attachment as a file in the workspace, and `agy`
  // opens it with its own file tools (its models are the multimodal Gemini
  // family). Verified against `agy --add-dir <cwd> -p` with a four-quadrant
  // probe image, which it described correctly.
  images: true,
  // `agy` DOES report per-turn usage — but only under `--output-format
  // stream-json`, and the turn runs on `text`. Captured from a real run, its
  // `result` event carries `{ input_tokens, output_tokens, thinking_tokens,
  // cache_read_tokens, total_tokens }`. Surfacing it means migrating the turn's
  // whole stream parsing to the JSON events, so the meter stays hidden until
  // then (FOR-DEV: see bridge/FOR-DEV.md).
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
  /** Default model id (an `agy models` routing key) when the thread/turn picks none. */
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
  /** threadId → client-owned `agy` conversation UUID, for `--conversation` continuity. */
  readonly #conversationByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

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
    const model = normalizeAntigravityModel(options.service ?? this.#defaultModel);
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

  /**
   * Name a conversation with a one-shot `agy -p`, without `--conversation`, so
   * it never joins the conversation this thread resumes.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const cwd = options.cwd ?? this.#defaultCwd;
    const args = ['--output-format', 'text', '--add-dir', cwd, '-p', prompt];
    const raw = await runTitleOneShot(() =>
      this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
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
