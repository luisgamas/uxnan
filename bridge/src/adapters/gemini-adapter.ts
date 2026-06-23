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
 *   - **Interactive approvals** (opt-in, see `interactiveApprovals` below): the
 *     adapter writes a `<cwd>/.gemini/settings.json` with a `BeforeTool` hook
 *     (gemini-cli uses the same hook contract as Claude Code; the CLI ships a
 *     `gemini hooks migrate` command that imports Claude hook settings). The
 *     hook round-trips every tool to the bridge's local HTTP endpoint, which
 *     forwards the decision to the phone (`turn/send { approvalResponse }`).
 *     `--approval-mode` is set to Gemini's `default` (which means "prompt for
 *     approval" in Gemini's vocabulary — the hook is the gate, NOT a TTY
 *     prompt, since `-p` is non-interactive). Without the hook the prompt would
 *     block Gemini forever; the bridge only injects it when the endpoint is
 *     resolvable. See `gemini-approval-hook.ts` for the script.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * Timeout (seconds) for the injected `BeforeTool` approval hook. Mirrors the
 * Claude adapter: raise it well above the CLI's short default so a backgrounded
 * phone can reconnect and answer before the CLI aborts the hook (defaulting the
 * tool to deny and making the agent take an unauthorized default).
 */
const APPROVAL_HOOK_TIMEOUT_SECONDS = 1800;

/**
 * Curated Gemini model set. The Gemini CLI exposes **no headless enumerate
 * command** (like Claude Code — only Codex via app-server and OpenCode/pi via
 * their own list commands can enumerate), so we ship a hand-kept table sourced
 * from the CLI's own constants
 * (`packages/core/src/config/models.ts` in google-gemini/gemini-cli). Every id
 * in the CLI's `VALID_GEMINI_MODELS` set is listed, plus the `auto` routing
 * alias. The concrete model a run resolves to is always surfaced via the
 * `model_resolved` event.
 */
const GEMINI_MODELS: AgentModel[] = [
  // Auto-routing (the CLI picks the best model for each task).
  {
    id: 'auto',
    displayName: 'Auto',
    description: 'Let the CLI pick the best model for each task (recommended)',
    isDefault: true,
  },
  // Pro tier.
  {
    id: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro (Preview)',
    description: 'Most capable, preview build',
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro (Preview)',
    description: 'Newer Pro preview build',
  },
  {
    id: 'gemini-3.1-pro-preview-customtools',
    displayName: 'Gemini 3.1 Pro (Preview, custom tools)',
    description: '3.1 Pro preview variant for custom-tools backends',
  },
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    description: 'Stable 2.5-generation Pro',
  },
  // Flash tier.
  {
    id: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash (Preview)',
    description: 'Pinned 3-generation Flash preview build',
  },
  {
    id: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    description: '3.5-generation Flash (GA)',
  },
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    description: 'Secondary 3.5-flash alias for backends that reject "gemini-3.5-flash"',
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    description: 'Stable 2.5-generation Flash',
  },
  // Flash-Lite tier.
  {
    id: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    description: 'Cheapest 3.1-generation tier (GA)',
  },
  // Experimental — gated by the CLI's `experimentalGemma` flag.
  {
    id: 'gemma-4-31b-it',
    displayName: 'Gemma 4 31B (IT) — Experimental',
    description: 'Experimental — only enabled when the CLI runs with `experimentalGemma` on',
  },
  {
    id: 'gemma-4-26b-a4b-it',
    displayName: 'Gemma 4 26B (A4B, IT) — Experimental',
    description: 'Experimental — only enabled when the CLI runs with `experimentalGemma` on',
  },
];

const DEFAULT_GEMINI_MODEL = 'auto';

/**
 * Approval posture passed to `gemini --approval-mode`:
 *  - `default`           → `plan` (read-only; no edits/commands — safe headless);
 *  - `acceptEdits`       → `auto_edit` (auto-approve edit tools);
 *  - `bypassPermissions` → `yolo` (auto-approve all tools);
 *  - `interactive`       → Gemini's `default` ("prompt for approval"); the bridge
 *                          injects a `BeforeTool` hook so every tool round-trips
 *                          to the phone (requires `agents['gemini-cli'].
 *                          interactiveApprovals: true` + the bridge's LAN server).
 */
export type GeminiPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'interactive';

function approvalModeFor(mode: GeminiPermissionMode): string {
  if (mode === 'acceptEdits') return 'auto_edit';
  if (mode === 'bypassPermissions') return 'yolo';
  if (mode === 'interactive') return 'default';
  return 'plan';
}

/** True when this adapter should inject the BeforeTool hook (i.e. the bridge
 * has a resolvable approval endpoint AND the user opted in). */
function needsApprovalHook(
  mode: GeminiPermissionMode,
  hook: { token: string; scriptPath: string; url: () => string | undefined } | undefined,
): boolean {
  if (mode !== 'interactive') return false;
  if (!hook) return false;
  return hook.url() !== undefined;
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
  /**
   * The local approval-hook endpoint + token + script path used when
   * `permissionMode === 'interactive'`. The adapter writes a
   * `<cwd>/.gemini/settings.json` whose `BeforeTool` hook POSTs to this
   * endpoint; the bridge forwards each call to the phone and HOLDS the
   * response until the user answers (or the 5-min timeout fires → deny).
   * `url()` is lazy because the LAN port is known only after `startLan`.
   */
  approvalHook?: { token: string; scriptPath: string; url: () => string | undefined };
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
  readonly #approvalHook:
    | { token: string; scriptPath: string; url: () => string | undefined }
    | undefined;
  readonly #spawn: SpawnFn;
  /** threadId → Gemini session id, for `--resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();
  /** cwd's we've already written `.gemini/settings.json` into (idempotent). */
  readonly #hookInstalledCwd = new Set<string>();

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
    this.#approvalHook = options.approvalHook;
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

  async sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const resumeId = this.#sessionByThread.get(threadId);
    // First turn: create a session under a UUID we own; later turns resume it.
    const newSessionId = resumeId ? undefined : randomUUID();

    // Interactive approvals: when `permissionMode === 'interactive'` and the
    // bridge has a resolvable hook endpoint, write `<cwd>/.gemini/settings.json`
    // with a `BeforeTool` hook that round-trips every tool to the phone. The
    // hook script itself was written at bridge startup
    // (`writeGeminiApprovalHook`). Idempotent per cwd so we don't re-write on
    // every turn.
    //
    // We AWAIT the install before spawning the CLI so a misconfigured cwd (or
    // a transient EACCES) fails the turn with a clear error — and so tests
    // can assert on the written file synchronously after sendTurn resolves.
    // A failure to write the settings fails the turn (no fallback) so the
    // phone sees a clear "hook not installed" error instead of a CLI that
    // blocks on a non-existent prompt gate.
    const useHook = needsApprovalHook(this.#permissionMode, this.#approvalHook);
    if (useHook) {
      try {
        await this.#installHook(cwd);
      } catch (err) {
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: {
            text: `failed to install Gemini approval hook (${errorMessage(err)}); interactive approvals unavailable this turn`,
          },
        });
        return;
      }
    } else if (this.#permissionMode === 'interactive') {
      // The user opted into interactive approvals but the bridge can't wire
      // the hook (LAN server not started, no token, etc.). Fail the turn so
      // the phone knows why the approval is not interactive.
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: {
          text: 'gemini interactive approvals requested but the bridge hook URL is unavailable. Enable `lanEnabled` and ensure the bridge has bound its LAN server, or set `agents.gemini-cli.permissionMode` to a non-interactive value.',
        },
      });
      return;
    }

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

    // Pass the bridge endpoint + token to the hook via env so the script can
    // POST each tool invocation to the bridge's local HTTP endpoint. The
    // threadId is what the hook embeds in the request, so the bridge can
    // route the response back to the right thread.
    const spawnExtra =
      useHook && this.#approvalHook
        ? {
            env: {
              UXNAN_HOOK_URL: this.#approvalHook.url() ?? '',
              UXNAN_HOOK_TOKEN: this.#approvalHook.token,
              UXNAN_HOOK_THREAD_ID: threadId,
            },
          }
        : undefined;

    let child: SpawnedProcess;
    try {
      child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, spawnExtra);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch gemini: ${errorMessage(err)}` },
      });
      return;
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
   * Write (or overwrite) `<cwd>/.gemini/settings.json` with a `BeforeTool` hook
   * pointing at the bridge's local approval endpoint. Idempotent per cwd — the
   * hook only needs to exist in the workspace, not per turn. Existing user
   * settings (other hooks, theme, …) are preserved: we MERGE the `hooks` map
   * over whatever is already there. The bridge's hook is named `uxnan-approval`
   * so it's easy to identify and disable from `/hooks disable uxnan-approval`.
   *
   * The actual round-trip is handled by the bridge's central
   * `AgentManager.requestApproval` (the same flow Claude's `PreToolUse` hook
   * uses — the gemini hook POSTs to the same `POST /agent-hook/approval`
   * endpoint). The adapter does NOT need its own `respondApproval` for the
   * hook flow: the bridge resolves the pending approval and returns the
   * `allow`/`deny` decision via the HTTP response.
   */
  async #installHook(cwd: string): Promise<void> {
    const key = this.#hookKey(cwd);
    if (this.#hookInstalledCwd.has(key)) return;
    const hook = this.#approvalHook;
    if (!hook) return;
    const url = hook.url();
    if (!url) return;
    const dir = join(cwd, '.gemini');
    const path = join(dir, 'settings.json');
    let existing: Record<string, unknown> = {};
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(path, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // File doesn't exist or is unreadable / malformed — start fresh.
    }
    const hookEntry = {
      hooks: [
        {
          type: 'command',
          name: 'uxnan-approval',
          command: `node "${hook.scriptPath}"`,
          // Raise the hook timeout above the CLI default so a backgrounded phone
          // can reconnect and answer before the CLI aborts the hook (which would
          // default the tool to deny).
          timeout: APPROVAL_HOOK_TIMEOUT_SECONDS,
        },
      ],
    };
    // Wrap the entry under a matcher key (Gemini uses regex matchers on the
    // tool name; `.*` matches every tool — the bridge decides per-call).
    const matchers =
      existing.hooks && typeof existing.hooks === 'object'
        ? (existing.hooks as Record<string, unknown>)
        : {};
    const beforeToolRaw = matchers['BeforeTool'];
    const beforeTool = Array.isArray(beforeToolRaw) ? (beforeToolRaw as unknown[]) : [];
    // Drop any prior uxnan-approval entry so re-installs don't duplicate.
    const filtered = beforeTool.filter((entry) => {
      if (!entry || typeof entry !== 'object') return true;
      const hooks = (entry as Record<string, unknown>)['hooks'];
      if (!Array.isArray(hooks)) return true;
      return !hooks.some(
        (h: unknown) =>
          h && typeof h === 'object' && (h as Record<string, unknown>)['name'] === 'uxnan-approval',
      );
    });
    filtered.push({ matcher: '.*', ...hookEntry });
    const next = {
      ...existing,
      hooks: {
        ...(matchers ?? {}),
        BeforeTool: filtered,
      },
    };
    await mkdir(dir, { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    this.#hookInstalledCwd.add(key);
  }

  /**
   * Normalize a cwd for the dedup set so Windows mixed slashes / case
   * differences don't make us rewrite the same file. Best-effort — the
   * Windows file system is case-insensitive but Node strings are not.
   */
  #hookKey(cwd: string): string {
    return process.platform === 'win32' ? cwd.toLowerCase() : cwd;
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
