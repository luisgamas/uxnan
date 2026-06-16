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
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/testing.md (validating adapters).
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
import {
  extractToolResults,
  extractToolUses,
  toolUseToBlock,
  type ClaudeToolResult,
  type ClaudeToolUse,
} from './claude-tools.js';
import { effortValues, reasoningOption, reasoningValue, withOptions } from './run-options.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
};

/**
 * Stable `--model` aliases Claude Code accepts. Claude Code has no enumerate
 * command (verified against `claude` 2.x `--help`): `--model` takes an alias or
 * a full id, and the alias is the plug-and-play routing key — it always resolves
 * to the latest model of that tier the account can use. The concrete version a
 * run resolved to is reported in the `system/init` event and surfaced via the
 * `model_resolved` stream event (so the user can see e.g. `opus → claude-opus-4-8`).
 */
const CLAUDE_MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const;

/** Human-facing labels for the stable aliases. */
const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/**
 * Reasoning-effort levels Claude Code's `--effort` flag accepts (verified against
 * `claude --help`: low, medium, high, xhigh, max). Claude Code has no enumerate
 * API, so this is a maintained table — kept in lock-step with the CLI, the same
 * way the model aliases are. (`ultrathink` and friends are prompt-level thinking
 * triggers, NOT `--effort` levels, so they don't belong here.)
 */
const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Reasoning-effort knob advertised on every Claude model. */
const CLAUDE_REASONING_OPTION: AgentModelOption = reasoningOption(
  effortValues(CLAUDE_EFFORT_LEVELS),
);

/**
 * Headless permission posture passed to the CLI:
 *  - `default`           → no flag (tools needing approval are auto-denied headless);
 *  - `acceptEdits`       → `--permission-mode acceptEdits` (file edits auto-apply);
 *  - `bypassPermissions` → `--dangerously-skip-permissions` (all tools run).
 */
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** An explicit, concrete model to add to the picker beyond the stable aliases. */
export interface ClaudeModelSpec {
  /** Exact model id passed to `--model` (e.g. `claude-opus-4-8`). */
  id: string;
  /** Human-facing label (defaults to `id`). */
  displayName?: string;
  /** Optional one-line description. */
  description?: string;
}

export interface ClaudeCodeAdapterOptions {
  /** Executable to spawn (resolved path; see resolve-claude.ts). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[cli.js]` when running via node). */
  prependArgs?: string[];
  /** Default model (`alias` or full id) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /**
   * Concrete, versioned models to surface in the picker **in addition** to the
   * stable `opus`/`sonnet`/`haiku` aliases — declared in daemon config
   * (`agents.claude-code.models`). Lets users pick an exact/older version while
   * the aliases keep tracking "latest". Deduplicated against the aliases by id.
   */
  pinnedModels?: ClaudeModelSpec[];
  /** Headless permission posture (default `acceptEdits`). */
  permissionMode?: ClaudePermissionMode;
  /** Injected spawn function for the one-shot path (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized Claude Code event extracted from one stream-json line. */
export interface ClaudeEvent {
  kind: 'init' | 'delta' | 'thinking' | 'assistant_text' | 'tool_result' | 'result' | 'other';
  sessionId?: string;
  text?: string;
  /** Only set for `init`: the concrete model id the run resolved the alias to. */
  model?: string;
  /** Only set for `result`: whether the turn ended in error. */
  isError?: boolean;
  /** Only set for `result`: the raw `usage` object (token counts), if present. */
  usage?: unknown;
  /** Only set for `assistant_text`: any tool invocations in the message. */
  toolUses?: ClaudeToolUse[];
  /** Only set for `tool_result`: results the agent fed back from its tools. */
  toolResults?: ClaudeToolResult[];
}

/**
 * Context-window size (tokens) for a Claude model id or alias, so the phone can
 * show context usage as a percentage. Fable/Opus/Sonnet are 1M, Haiku is 200K
 * (matches the current model catalog); unknown ids return undefined.
 */
export function claudeContextWindow(model: string | undefined): number | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 200_000;
  if (m.includes('fable') || m.includes('opus') || m.includes('sonnet')) return 1_000_000;
  return undefined;
}

/** Sum the context-occupying token counts from a Claude `result.usage` object. */
export function claudeUsageTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const count = (key: string): number =>
    typeof usage[key] === 'number' ? (usage[key] as number) : 0;
  const total =
    count('input_tokens') +
    count('cache_read_input_tokens') +
    count('cache_creation_input_tokens') +
    count('output_tokens');
  return total > 0 ? total : undefined;
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
    case 'system': {
      const model = typeof parsed['model'] === 'string' ? parsed['model'] : undefined;
      return { kind: 'init', ...base, ...(model !== undefined ? { model } : {}) };
    }
    case 'stream_event': {
      const event = isRecord(parsed['event']) ? parsed['event'] : undefined;
      if (event && event['type'] === 'content_block_delta') {
        const delta = isRecord(event['delta']) ? event['delta'] : undefined;
        if (delta && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
          return { kind: 'delta', ...base, text: delta['text'] };
        }
        // Extended-thinking output streams as `thinking_delta` blocks (the
        // signature_delta blocks that follow carry no readable text → ignored).
        if (delta && delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          return { kind: 'thinking', ...base, text: delta['thinking'] };
        }
      }
      return { kind: 'other', ...base };
    }
    case 'assistant': {
      const message = isRecord(parsed['message']) ? parsed['message'] : undefined;
      const content = message ? message['content'] : undefined;
      const text = extractAssistantText(content);
      const toolUses = extractToolUses(content);
      // Each assistant message carries its own `usage` (token counts including
      // the full input context at that point) — a fallback for turns whose final
      // `result` event omits usage, so the context meter still fills in.
      const usage = message && isRecord(message['usage']) ? message['usage'] : undefined;
      return {
        kind: 'assistant_text',
        ...base,
        text,
        ...(toolUses.length > 0 ? { toolUses } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    }
    case 'user': {
      const message = isRecord(parsed['message']) ? parsed['message'] : undefined;
      const toolResults = extractToolResults(message ? message['content'] : undefined);
      return { kind: 'tool_result', ...base, ...(toolResults.length > 0 ? { toolResults } : {}) };
    }
    case 'result': {
      const isError = parsed['is_error'] === true || parsed['subtype'] !== 'success';
      const text = typeof parsed['result'] === 'string' ? parsed['result'] : undefined;
      return {
        kind: 'result',
        ...base,
        text,
        isError,
        ...(parsed['usage'] !== undefined ? { usage: parsed['usage'] } : {}),
      };
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
  readonly #pinnedModels: ClaudeModelSpec[];
  readonly #permissionMode: ClaudePermissionMode;
  readonly #spawn: SpawnFn;
  /** threadId → Claude session id, for `--resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  #defaultCwd = process.cwd();

  /** Native Claude session id for a thread (on-disk history-fallback locator). */
  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'claude';
    this.#prependArgs = options.prependArgs ?? [];
    this.#defaultModel = options.defaultModel;
    this.#pinnedModels = options.pinnedModels ?? [];
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
    // Reasoning effort (low|medium|high|xhigh|max). Pass-through — the CLI
    // validates the level; `claude --effort` is a session flag (verified
    // against `claude --help`). Reads the `reasoning` knob, then legacy effort.
    const effort = reasoningValue(options);
    if (effort) args.push('--effort', effort);
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
    let sawModel = false;
    let resolvedModel: string | undefined;
    let errored = false;
    let completed = false;
    // The most recent assistant-message usage, used if the `result` event omits
    // its own usage (so the context meter still reports tokens).
    let lastUsage: unknown;
    // tool_use id → its (complete) invocation, until the matching tool_result
    // arrives and the two are paired into a structured content block.
    const pendingTools = new Map<string, ClaudeToolUse>();

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseClaudeLine(line);
      if (!event) return;
      if (event.sessionId) this.#sessionByThread.set(threadId, event.sessionId);
      // Register tool invocations (with their inputs) so the result can pair.
      if (event.toolUses) {
        for (const tool of event.toolUses) pendingTools.set(tool.id, tool);
      }
      // Track the latest assistant-message usage as a completion fallback.
      if (event.kind === 'assistant_text' && event.usage !== undefined) {
        lastUsage = event.usage;
      }
      // A tool_result completes a tool → emit a structured block (command/diff/
      // tool) for the Work log / Changed files sections.
      if (event.kind === 'tool_result' && event.toolResults) {
        for (const result of event.toolResults) {
          const tool = pendingTools.get(result.toolUseId);
          if (!tool) continue;
          pendingTools.delete(result.toolUseId);
          this.emit({
            type: 'block',
            threadId,
            turnId,
            data: { content: toolUseToBlock(tool, result) },
          });
        }
      }
      if (event.kind === 'init' && event.model && !sawModel) {
        // Surface the concrete model the alias resolved to (e.g. `opus` →
        // `claude-opus-4-8`) so the phone can show the exact version in use.
        sawModel = true;
        resolvedModel = event.model;
        this.emit({ type: 'model_resolved', threadId, turnId, data: { text: event.model } });
      } else if (event.kind === 'delta' && event.text) {
        sawPartial = true;
        full += event.text;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'thinking' && event.text) {
        // Reasoning chunk — streamed to the phone (and persisted) separately from
        // the answer so it can be shown in a collapsible "thinking" section.
        this.emit({ type: 'thinking', threadId, turnId, data: { text: event.text } });
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
          // Prefer the streamed text (`full`) — it's the complete narration the
          // user saw. `result.result` is often only the final segment of a
          // tool-using turn, so using it would shrink the message on re-sync and
          // drop earlier paragraphs. Fall back to `result.result` only when no
          // partials streamed.
          const finalText =
            sawPartial && full.length > 0
              ? full
              : event.text && event.text.length > 0
                ? event.text
                : full;
          const tokens = claudeUsageTokens(event.usage ?? lastUsage);
          const window = claudeContextWindow(resolvedModel ?? model);
          const usage =
            tokens !== undefined
              ? { tokens, ...(window !== undefined ? { contextWindow: window } : {}) }
              : undefined;
          this.emit({
            type: 'turn_completed',
            threadId,
            turnId,
            data: { text: finalText, ...(usage !== undefined ? { usage } : {}) },
          });
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

  /**
   * Claude Code has no model-list command. Expose the stable `--model` aliases
   * (each tracks the latest model of its tier the account can use — the concrete
   * version is reported per-run via the `model_resolved` event), followed by any
   * concrete versions pinned in config. Pinned ids that collide with an alias
   * are dropped so the alias (the "latest" entry) wins.
   */
  listModels(): Promise<AgentModel[]> {
    const def = this.#defaultModel;
    const aliasModels = CLAUDE_MODEL_ALIASES.map((alias) => {
      const label = CLAUDE_ALIAS_LABELS[alias] ?? alias;
      return {
        id: alias,
        // The "(latest)" suffix flags that the alias auto-tracks the newest
        // model; the picker also shows the bare alias id beneath it.
        displayName: `${label} (latest)`,
        description: `Always the newest ${label} your account can use`,
        isDefault: def === alias,
      } satisfies AgentModel;
    });

    const aliasIds = new Set<string>(CLAUDE_MODEL_ALIASES);
    const seen = new Set<string>(aliasIds);
    const pinnedModels: AgentModel[] = [];
    for (const spec of this.#pinnedModels) {
      const id = spec.id.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      pinnedModels.push({
        id,
        displayName: spec.displayName && spec.displayName.length > 0 ? spec.displayName : id,
        ...(spec.description && spec.description.length > 0
          ? { description: spec.description }
          : {}),
        isDefault: def === id,
      });
    }

    // Every Claude model accepts the same `--effort` levels, so advertise the
    // reasoning knob on each.
    return Promise.resolve(
      withOptions([...aliasModels, ...pinnedModels], [CLAUDE_REASONING_OPTION]),
    );
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
