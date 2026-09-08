/**
 * pi adapter (`@earendil-works/pi-coding-agent`, the `pi` CLI — real agent).
 *
 * ## Architecture — Persistent RPC sessions
 *
 * pi runs in `--mode rpc` over stdio as a persistent child process per thread,
 * eliminating the cold-start latency and full disk session-history replay that
 * would occur if spawning a fresh process on every turn.
 *
 * Why persistent RPC sessions:
 *  1. **Zero repeat startup & history replay latency**: Spawning a fresh CLI for
 *     every turn forced pi to re-initialize Node.js and reload/parse the entire
 *     on-disk session history JSONL on every single turn (which scales badly as
 *     conversations grow to tens of thousands of tokens). A persistent session
 *     keeps history and state in memory.
 *  2. **Streaming and token reporting**: In `--mode rpc`, pi streams assistant
 *     `message_update` text deltas, thinking deltas, tool executions, and per-turn
 *     token usage in `message_end` events (`reportsContextUsage: true`).
 *  3. **Mid-turn steering**: The persistent RPC channel keeps stdin open, allowing
 *     first-class `steer` commands to reach the agent loop at the next tool boundary.
 *  4. **24-hour idle timeout**: Inactive sessions are automatically dismantled after
 *     24 hours without turns (`DEFAULT_PI_IDLE_TIMEOUT_MS`). The session ID is
 *     persisted (`--session-id <id>`), so subsequent turns seamlessly re-attach.
 *     Each completed interaction automatically refreshes this 24-hour timer.
 *  5. **Workspace & model isolation**: If a thread changes its project directory,
 *     model, or permission mode, the session is recycled cleanly while preserving
 *     session continuity via `--session-id`.
 *
 * Captured `--mode rpc` event shapes (one JSON object per line):
 *   { "type":"session", "id":"019…", "cwd":"…" }
 *   { "type":"message_update", "assistantMessageEvent":{ "type":"text_delta", "delta":"…" } }
 *   { "type":"message_end", "message":{ "role":"assistant", "content":[{ "type":"text","text":"…" }],
 *       "usage":{ "input":…, "output":…, "totalTokens":… }, "stopReason":"stop"|"error", "errorMessage"?:"…" } }
 *   { "type":"agent_end", "messages":[…], "willRetry":false }
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/agents.md.
 */
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  CompactionReason,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { piResultText, piToolBlock, type PiToolUse } from './pi-tools.js';
import { effortValues, reasoningOption, reasoningValue } from './run-options.js';
import { assistantResponseBoundaryBlock, compactionBlock } from './content-blocks.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** Default idle timeout before closing an inactive `pi` process (24 hours). */
export const DEFAULT_PI_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Hard cap on the `--list-models` spawn before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

const PI_CAPABILITIES: AgentCapabilities = {
  // Plan mode is a pi extension, not core, so it's not advertised here.
  planMode: false,
  streaming: true,
  // pi runs its tools autonomously in `-p` mode (no per-turn approval RPC).
  approvals: false,
  // pi operates in autonomous ("YOLO") mode by default: it acts and edits
  // without per-action approval prompts because its headless CLI exposes no
  // pre-tool approval channel. The phone surfaces this so the user knows pi
  // won't ask before running tools.
  autonomous: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
  reportsCompaction: true,
  // pi's RPC protocol has a first-class `steer` command, drained by the agent
  // loop at its next boundary — so a follow-up joins the running turn instead
  // of waiting for it. This is why the adapter runs `--mode rpc` rather than
  // `-p --mode json`: print mode reads ALL of stdin as the initial prompt, so
  // it has no input channel while it works.
  steering: true,
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
  /** Inactivity timeout before dismantling an idle pi process (default 2 hours). */
  idleTimeoutMs?: number;
}

interface ActiveTurn {
  turnId: string;
  full: string;
  currentAssistantText: string;
  finalText: string;
  tokens?: number;
  errored: boolean;
  errorMsg?: string;
  pendingTools: Map<string, PiToolUse>;
  plainLines: string[];
  completed: boolean;
  finish: () => void;
}

interface ActiveSession {
  child: SpawnedProcess;
  threadId: string;
  sessionId?: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: PiPermissionMode;
  idleTimer?: NodeJS.Timeout;
  activeTurn?: ActiveTurn;
  exited: boolean;
  send: (command: Record<string, unknown>) => boolean;
}

/** A normalized pi event extracted from one RPC/`--mode json` line. */
export interface PiEvent {
  kind:
    | 'session'
    | 'compaction'
    | 'delta'
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'final'
    | 'end'
    /** An RPC command pi rejected (`{ type:'response', success:false }`). */
    | 'command_failed'
    | 'other';
  /** Only set for `session`: the session id (for `--session-id` continuity). */
  sessionId?: string;
  /** Only set for `command_failed`: which RPC command was rejected. */
  commandName?: string;
  /**
   * `delta`: the streamed text chunk. `thinking`: a reasoning chunk. `final`:
   * the assistant message's full text.
   */
  text?: string;
  /** Only set for `final`: context-occupying token count, if reported. */
  tokens?: number;
  /** Only set for `final`: whether the assistant message ended in error. */
  isError?: boolean;
  /** Only set for `final`: the error message, when present. */
  errorText?: string;
  /** `tool_start`/`tool_end`: the tool call's id (for pairing args ↔ result). */
  toolCallId?: string;
  /** Only set for `tool_start`: the tool name + its arguments. */
  tool?: PiToolUse;
  /** Only set for `tool_end`: the tool's output text. */
  toolOutput?: string;
  /** Only set for `tool_end`: whether the tool failed. */
  toolIsError?: boolean;
  /** Only set for a successful `compaction_end`. */
  compactionReason?: CompactionReason;
  tokensBefore?: number;
  tokensAfter?: number;
}

/**
 * Sum the context-occupying tokens from a pi `usage` object
 * (`{ input, output, cacheRead, cacheWrite, totalTokens, cost }`). Prefers the
 * reported `totalTokens`, falling back to `input + output`.
 */
export function parsePiUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const num = (key: string): number =>
    typeof usage[key] === 'number' ? (usage[key] as number) : 0;
  const total = num('totalTokens') > 0 ? num('totalTokens') : num('input') + num('output');
  return total > 0 ? total : undefined;
}

/**
 * Parse a pi `--list-models` `context` cell into a token count: `"1.0M"` →
 * 1_000_000, `"384K"` → 384_000, a bare `"200000"` → 200000. Returns undefined
 * for an unparseable / non-positive cell (so the model just omits its window).
 */
export function parsePiContextWindow(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const match = cell.trim().match(/^([\d.]+)\s*([KMkm]?)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2]?.toUpperCase();
  const multiplier = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return Math.round(value * multiplier);
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
    case 'compaction_end': {
      const result = isRecord(parsed['result']) ? parsed['result'] : undefined;
      if (!result || parsed['aborted'] === true || parsed['errorMessage'] !== undefined) {
        return { kind: 'other' };
      }
      const rawReason = parsed['reason'];
      const compactionReason: CompactionReason =
        rawReason === 'manual' || rawReason === 'threshold' || rawReason === 'overflow'
          ? rawReason
          : 'unknown';
      const before = result['tokensBefore'];
      const after = result['estimatedTokensAfter'];
      return {
        kind: 'compaction',
        compactionReason,
        ...(typeof before === 'number' && before >= 0 ? { tokensBefore: Math.round(before) } : {}),
        ...(typeof after === 'number' && after >= 0 ? { tokensAfter: Math.round(after) } : {}),
      };
    }
    case 'message_update': {
      const event = isRecord(parsed['assistantMessageEvent'])
        ? parsed['assistantMessageEvent']
        : undefined;
      if (event && event['type'] === 'text_delta' && typeof event['delta'] === 'string') {
        return { kind: 'delta', text: event['delta'] };
      }
      // Reasoning streams as `thinking_delta` updates (verified: pi emits
      // `thinking_*` assistant events for the model's reasoning).
      if (event && event['type'] === 'thinking_delta' && typeof event['delta'] === 'string') {
        return { kind: 'thinking', text: event['delta'] };
      }
      // text_start/end and other updates carry no answer text.
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
    case 'tool_execution_start': {
      const id = typeof parsed['toolCallId'] === 'string' ? parsed['toolCallId'] : '';
      const name = typeof parsed['toolName'] === 'string' ? parsed['toolName'] : '';
      const args = isRecord(parsed['args']) ? parsed['args'] : {};
      return { kind: 'tool_start', toolCallId: id, tool: { id, name, input: args } };
    }
    case 'tool_execution_end': {
      const id = typeof parsed['toolCallId'] === 'string' ? parsed['toolCallId'] : '';
      return {
        kind: 'tool_end',
        toolCallId: id,
        toolOutput: piResultText(parsed['result']),
        toolIsError: parsed['isError'] === true,
      };
    }
    case 'agent_end':
      return { kind: 'end' };
    // RPC-mode command acknowledgements. A success is noise, but a FAILED one
    // is the only signal that a command never took effect — a rejected `prompt`
    // would otherwise leave the turn waiting for events that never come.
    case 'response': {
      if (parsed['success'] !== false) return { kind: 'other' };
      const message = typeof parsed['error'] === 'string' ? parsed['error'] : undefined;
      const command = typeof parsed['command'] === 'string' ? parsed['command'] : 'command';
      return {
        kind: 'command_failed',
        commandName: command,
        ...(message !== undefined ? { errorText: message } : {}),
      };
    }
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
    const context = cols[2]!;
    const thinking = cols[4]!;
    if (provider === 'provider') continue; // header row
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const contextWindow = parsePiContextWindow(context);
    out.push({
      id,
      displayName: model,
      description: provider,
      isDefault: id === defaultModel,
      ...(thinking === 'yes' ? { options: [PI_REASONING_OPTION] } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
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
  readonly #idleTimeoutMs: number;
  /** threadId → pi session id, for `--session-id` continuity across recycles. */
  readonly #sessionByThread = new Map<string, string>();
  /** threadId → active persistent session. */
  readonly #sessions = new Map<string, ActiveSession>();
  /** model id → context-window tokens, cached from `--list-models` for `usage`. */
  readonly #contextWindowByModel = new Map<string, number>();
  #defaultCwd = process.cwd();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  hasActiveSession(threadId: string): boolean {
    const session = this.#sessions.get(threadId);
    return Boolean(session && !session.exited);
  }

  /** Native pi session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: PiAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'pi';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'acceptEdits';
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_PI_IDLE_TIMEOUT_MS;
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(config: AgentConfig): Promise<void> {
    if (config.cwd) this.#defaultCwd = config.cwd;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const threadId of Array.from(this.#sessions.keys())) {
      this.#teardownSession(threadId);
    }
    this.#sessions.clear();
    return Promise.resolve();
  }

  /** Dismantle and terminate the active persistent session for a specific thread immediately. */
  closeSession(threadId: string): Promise<void> {
    this.#teardownSession(threadId);
    return Promise.resolve();
  }

  #scheduleIdleTeardown(session: ActiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.#teardownSession(session.threadId);
    }, this.#idleTimeoutMs);
    if (typeof session.idleTimer.unref === 'function') {
      session.idleTimer.unref();
    }
  }

  #teardownSession(threadId: string): void {
    const session = this.#sessions.get(threadId);
    if (!session) return;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.activeTurn && !session.activeTurn.completed) {
      session.activeTurn.completed = true;
    }
    this.#sessions.delete(threadId);
    session.exited = true;
    try {
      if (session.child.stdin && typeof session.child.stdin.end === 'function') {
        session.child.stdin.end();
      }
      session.child.kill();
    } catch {
      /* already gone */
    }
  }

  #getOrCreateSession(
    threadId: string,
    cwd: string,
    model: string | undefined,
    effort: string | undefined,
    permissionMode: PiPermissionMode,
  ): ActiveSession {
    const existing = this.#sessions.get(threadId);
    if (
      existing &&
      !existing.exited &&
      existing.cwd === cwd &&
      existing.model === model &&
      existing.effort === effort &&
      existing.permissionMode === permissionMode
    ) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }

    if (existing) {
      this.#teardownSession(threadId);
    }

    const sessionId = this.#sessionByThread.get(threadId);
    const args = ['--mode', 'rpc'];
    if (permissionMode === 'default') args.push('--tools', 'read,grep,find,ls');
    else if (permissionMode === 'bypassPermissions') args.push('--approve');
    if (model) args.push('--model', model);
    if (effort) args.push('--thinking', effort);
    if (sessionId) args.push('--session-id', sessionId);

    const child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, {
      stdin: 'pipe',
    });

    const send = (command: Record<string, unknown>): boolean => {
      const stdin = child.stdin;
      if (!stdin || !stdin.writable) return false;
      try {
        stdin.write(`${JSON.stringify(command)}\n`);
        return true;
      } catch {
        return false;
      }
    };

    const session: ActiveSession = {
      child,
      threadId,
      sessionId,
      cwd,
      model,
      effort,
      permissionMode,
      exited: false,
      send,
    };

    const reader = createInterface({ input: child.stdout as unknown as Readable });
    reader.on('line', (line) => {
      const event = parsePiLine(line);
      if (!event) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && session.activeTurn && !session.activeTurn.completed) {
          session.activeTurn.plainLines.push(trimmed);
        }
        return;
      }
      if (event.kind === 'session' && event.sessionId) {
        session.sessionId = event.sessionId;
        this.#sessionByThread.set(threadId, event.sessionId);
      }
      const active = session.activeTurn;
      if (!active || active.completed) return;

      if (event.kind === 'compaction') {
        this.emit({
          type: 'block',
          threadId,
          turnId: active.turnId,
          data: {
            content: compactionBlock(event.compactionReason, {
              ...(event.tokensBefore !== undefined ? { tokensBefore: event.tokensBefore } : {}),
              ...(event.tokensAfter !== undefined ? { tokensAfter: event.tokensAfter } : {}),
            }),
          },
        });
      } else if (event.kind === 'delta' && event.text) {
        active.full += event.text;
        active.currentAssistantText += event.text;
        this.emit({ type: 'delta', threadId, turnId: active.turnId, data: { text: event.text } });
      } else if (event.kind === 'thinking' && event.text) {
        this.emit({ type: 'thinking', threadId, turnId: active.turnId, data: { text: event.text } });
      } else if (event.kind === 'tool_start' && event.tool) {
        active.pendingTools.set(event.toolCallId ?? '', event.tool);
      } else if (event.kind === 'tool_end') {
        const tool = active.pendingTools.get(event.toolCallId ?? '');
        if (tool) {
          active.pendingTools.delete(event.toolCallId ?? '');
          this.emit({
            type: 'block',
            threadId,
            turnId: active.turnId,
            data: {
              content: piToolBlock(tool, event.toolOutput ?? '', event.toolIsError === true),
            },
          });
        }
      } else if (event.kind === 'final') {
        if (event.text) {
          active.finalText = event.text;
          const unseen = unseenAssistantText(active.currentAssistantText, event.text);
          if (unseen) {
            active.full += unseen;
            this.emit({ type: 'delta', threadId, turnId: active.turnId, data: { text: unseen } });
          }
        }
        if (active.currentAssistantText.length > 0 || (event.text?.length ?? 0) > 0) {
          this.emit({
            type: 'block',
            threadId,
            turnId: active.turnId,
            data: { content: assistantResponseBoundaryBlock() },
          });
        }
        active.currentAssistantText = '';
        if (event.tokens !== undefined) active.tokens = event.tokens;
        if (event.isError) {
          active.errored = true;
          if (event.errorText) active.errorMsg = event.errorText;
        }
      } else if (event.kind === 'command_failed') {
        if (event.commandName === 'prompt') {
          active.errored = true;
          active.errorMsg = event.errorText ?? 'pi rejected the prompt';
          active.finish();
        }
      } else if (event.kind === 'end') {
        active.finish();
      }
    });

    child.stderr?.on('data', (chunk: unknown) => {
      const active = session.activeTurn;
      if (active && !active.completed) {
        const str = String(chunk).trim();
        if (str.length > 0) active.plainLines.push(str);
      }
    });

    child.on('error', (err: Error) => {
      reader.close();
      session.exited = true;
      this.#sessions.delete(threadId);
      const active = session.activeTurn;
      if (active && !active.completed) {
        active.completed = true;
        session.activeTurn = undefined;
        this.emit({
          type: 'turn_error',
          threadId,
          turnId: active.turnId,
          data: { text: `pi process error: ${err.message}` },
        });
      }
    });

    child.on('close', () => {
      reader.close();
      session.exited = true;
      this.#sessions.delete(threadId);
      const active = session.activeTurn;
      if (active && !active.completed) {
        active.finish();
      }
    });

    this.#sessions.set(threadId, session);
    return session;
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const effort = reasoningValue(options);
    const permissionMode = this.#permissionMode;

    let session: ActiveSession;
    try {
      session = this.#getOrCreateSession(threadId, cwd, model, effort, permissionMode);
    } catch (err) {
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: `failed to launch pi: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    const activeTurn: ActiveTurn = {
      turnId,
      full: '',
      currentAssistantText: '',
      finalText: '',
      tokens: undefined,
      errored: false,
      errorMsg: undefined,
      pendingTools: new Map(),
      plainLines: [],
      completed: false,
      finish: () => {
        if (activeTurn.completed) return;
        activeTurn.completed = true;
        if (session.activeTurn?.turnId === turnId) {
          session.activeTurn = undefined;
        }
        this.#scheduleIdleTeardown(session);

        const body = activeTurn.full.length > 0 ? activeTurn.full : activeTurn.finalText;
        if (activeTurn.errored && body.length === 0) {
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: activeTurn.errorMsg ?? plainText(activeTurn.plainLines) ?? 'pi error' },
          });
          return;
        }
        if (body.length === 0 && activeTurn.plainLines.length > 0 && !activeTurn.errored) {
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: plainText(activeTurn.plainLines) ?? 'pi produced no output' },
          });
          return;
        }
        const contextWindow = model !== undefined ? this.#contextWindowByModel.get(model) : undefined;
        const usage =
          activeTurn.tokens !== undefined
            ? { tokens: activeTurn.tokens, ...(contextWindow !== undefined ? { contextWindow } : {}) }
            : undefined;
        this.emit({
          type: 'turn_completed',
          threadId,
          turnId,
          data: { text: body, ...(usage !== undefined ? { usage } : {}) },
        });
      },
    };

    session.activeTurn = activeTurn;
    this.emit({ type: 'turn_started', threadId, turnId });

    if (!session.send({ type: 'prompt', message: text })) {
      this.#teardownSession(threadId);
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: 'failed to send the prompt to pi (stdin unavailable)' },
      });
      return Promise.resolve();
    }

    return Promise.resolve();
  }

  /**
   * Name a conversation with a one-shot `pi -p`, deliberately **not** the RPC
   * session a turn uses: `--no-session` keeps it out of session storage, so the
   * errand leaves no trace in the thread's history.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const model = this.#titleModel();
    const args = ['-p', '--no-session'];
    if (model) args.push('--model', model);
    args.push(prompt);
    const cwd = options.cwd ?? this.#defaultCwd;
    const raw = await runTitleOneShot(() =>
      this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
    );
    return raw === undefined ? undefined : sanitizeTitle(raw);
  }

  /**
   * The model to name with.
   *
   * pi routes through many providers, so unlike the single-vendor CLIs there is
   * no fixed "cheap tier" id to hard-code — pinning one here would break the
   * moment a user's provider set differs. Passing nothing lets pi use its own
   * configured default, which is the honest answer until a per-provider cheap
   * model is configurable (see bridge/FOR-DEV.md).
   */
  #titleModel(): string | undefined {
    return undefined;
  }

  /**
   * Hand a follow-up to the turn `activeTurnId` is already running, as pi's own
   * RPC `steer` command. pi drains its steering queue at the agent loop's next
   * boundary, so the message lands inside the same turn — no second process and
   * no second `--session-id`.
   *
   * Returns false rather than throwing for every ordinary "too late": the turn
   * is unknown to this adapter, it already emitted its terminal event, or the
   * pipe closed underneath us.
   */
  steerTurn(options: SendTurnOptions & { activeTurnId: string }): Promise<boolean> {
    const session = this.#sessions.get(options.threadId);
    if (!session || session.exited || !session.activeTurn || session.activeTurn.completed) {
      return Promise.resolve(false);
    }
    if (session.activeTurn.turnId !== options.activeTurnId) {
      return Promise.resolve(false);
    }
    return Promise.resolve(session.send({ type: 'steer', message: options.text }));
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    if (session && session.activeTurn?.turnId === turnId) {
      session.send({ type: 'abort' });
      session.activeTurn.completed = true;
      session.activeTurn = undefined;
      this.emit({ type: 'turn_aborted', threadId, turnId });
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * List the models pi reports via `pi --list-models` (account-aware: only
   * providers the user has configured appear). The output is a table, parsed by
   * {@link parsePiModelList}. Resolves to `[]` if the spawn fails or times out.
   *
   * Note: pi prints the `--list-models` table to STDERR, not stdout (verified
   * against pi 0.79.1), so we accumulate BOTH streams. Without this the phone's
   * model picker shows no models for the pi agent.
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
        child = this.#spawn(
          this.#binaryPath,
          [...this.#prependArgs, '--list-models'],
          this.#defaultCwd,
        );
      } catch {
        resolve([]);
        return;
      }

      const timer = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);
      // pi emits the table on stderr; read stdout too so we stay correct if a
      // future version moves it. Parse the combined output on close.
      const collect = (chunk: unknown): void => {
        output += String(chunk);
      };
      child.stdout.on('data', collect);
      child.stderr?.on('data', collect);
      child.on('error', () => finish([]));
      child.on('close', () => {
        const models = parsePiModelList(output, this.#defaultModel);
        // Cache each model's context window so `sendTurn` can emit `usage`
        // with a window (→ percentage on the phone) without re-listing.
        for (const m of models) {
          if (m.contextWindow !== undefined) {
            this.#contextWindowByModel.set(m.id, m.contextWindow);
          }
        }
        finish(models);
      });
    });
  }
}

function unseenAssistantText(streamed: string, complete: string): string {
  if (complete.length === 0 || streamed === complete || streamed.includes(complete)) return '';
  return complete.startsWith(streamed) ? complete.slice(streamed.length) : complete;
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
