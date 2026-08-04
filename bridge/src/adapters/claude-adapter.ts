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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  CompactionReason,
  GenerateTitleOptions,
  SendTurnOptions,
} from '@uxnan/shared';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { scanCustomCommands } from './command-scan.js';
import { BaseAgentAdapter } from './base-adapter.js';
import {
  extractToolResults,
  extractToolUses,
  toolUseToBlock,
  type ClaudeToolResult,
  type ClaudeToolUse,
} from './claude-tools.js';
import { warningBlock } from './content-blocks.js';
import { effortValues, reasoningOption, reasoningValue, withOptions } from './run-options.js';
import { assistantResponseBoundaryBlock, compactionBlock } from './content-blocks.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/**
 * Timeout (seconds) for the injected `PreToolUse` approval hook. Claude Code's
 * default hook timeout is ~60s; without raising it Claude aborts the hook (and
 * the tool defaults to deny) long before a backgrounded phone can reconnect and
 * answer the approval — making the agent take an unauthorized default and the
 * turn appear "cut". A generous cap lets the user return and answer; the bridge
 * still auto-rejects after its own (connection-aware) window once a phone is
 * connected. The total wait is bounded by this value, after which Claude denies.
 */
const APPROVAL_HOOK_TIMEOUT_SECONDS = 1800;

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
  reportsCompaction: true,
  commands: true,
};

/**
 * Built-in slash commands Claude Code runs in headless (`-p`) mode — sent as the
 * prompt string, resolved against the thread's `--resume` session so
 * history-dependent ones (`/compact`) work. A conservative, maintained set;
 * interactive-only commands (`/config`, `/login`) are excluded. The running
 * CLI's own `system/init` `slash_commands` list (captured per turn) augments
 * this with skills/plugins and any custom commands it actually sees.
 */
const CLAUDE_BUILTIN_COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context' },
  { name: 'context', description: 'Show current context usage' },
  { name: 'status', description: 'Show session status' },
  { name: 'cost', description: 'Show token cost for this session' },
  { name: 'usage', description: 'Show plan usage limits' },
];

/** Slash commands that only work in the interactive TUI — never advertised. */
const CLAUDE_EXCLUDED_COMMANDS = new Set(['config', 'login', 'logout', 'doctor']);

/**
 * Stable `--model` aliases Claude Code accepts. Claude Code has no enumerate
 * command (verified against `claude` 2.1.x `--help`, which names `fable`, `opus`
 * and `sonnet`): `--model` takes an alias or a full id, and the alias is the
 * plug-and-play routing key — it always resolves to the latest model of that
 * tier the account can use. The concrete version a run resolved to is reported
 * in the `system/init` event and surfaced via the `model_resolved` stream event
 * (so the user can see e.g. `opus → claude-opus-5`). Ordered most capable first;
 * the phone renders this order verbatim.
 */
const CLAUDE_MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

/**
 * Model used to name a conversation — the cheapest tier, never the one the
 * thread runs on. Writing a six-word title is not work for an expensive model,
 * and it must not eat that model's quota.
 */
const TITLE_MODEL = 'haiku';

/** Human-facing labels for the stable aliases. */
const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  fable: 'Fable',
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
   * stable `fable`/`opus`/`sonnet`/`haiku` aliases — declared in daemon config
   * (`agents.claude-code.models`). Lets users pick an exact/older version while
   * the aliases keep tracking "latest". Deduplicated against the aliases by id.
   */
  pinnedModels?: ClaudeModelSpec[];
  /** Headless permission posture (default `acceptEdits`). */
  permissionMode?: ClaudePermissionMode;
  /**
   * Opt-in interactive approvals: inject a `PreToolUse` hook (via `--settings`)
   * so every tool round-trips to the bridge for the user's approval. Requires
   * {@link approvalHook} to be set and resolvable (the bridge's local endpoint).
   */
  interactiveApprovals?: boolean;
  /**
   * The local approval-hook endpoint + token + the path to the shipped hook
   * script. `url()` is lazy because the LAN port is known only after the server
   * starts; it returns `undefined` until then (the turn runs without the hook).
   */
  approvalHook?: { token: string; scriptPath: string; url: () => string | undefined };
  /** Injected spawn function for the one-shot path (tests). */
  spawnFn?: SpawnFn;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
}

/** A normalized Claude Code event extracted from one stream-json line. */
export interface ClaudeEvent {
  kind:
    | 'init'
    | 'compaction'
    | 'delta'
    | 'thinking'
    | 'assistant_text'
    | 'tool_result'
    | 'result'
    | 'task_started'
    | 'task_ended'
    | 'other';
  sessionId?: string;
  text?: string;
  /**
   * Only for `task_started` / `task_ended`: the CLI's own id for a **background
   * task** the model started (`Bash` with `run_in_background`). The turn is not
   * over while one is live — see `sendTurn`'s deferred-completion handling.
   */
  taskId?: string;
  /**
   * Only for `task_ended`: how the background task finished. `completed` means
   * its work is done (and the CLI then wakes the model for another turn);
   * `stopped` means the CLI **killed** it as the process came down, so that work
   * was lost.
   */
  taskStatus?: 'completed' | 'stopped';
  /**
   * The `parent_tool_use_id` of the line, set when the event belongs to a
   * SUBAGENT (Task-tool) turn running in parallel with the main loop rather
   * than to the top-level session. Subagent lines arrive interleaved with the
   * main stream (their tools while the main text is mid-delta), so the adapter
   * must not fold their text/usage into the main message and must order their
   * blocks before the open text run (`beforeText`).
   */
  parentToolUseId?: string;
  /**
   * Only for `stream_event` lines that mark a content-block boundary: the raw
   * SSE event type, used to track whether a main-loop text run is open.
   */
  streamType?: 'content_block_start' | 'content_block_stop';
  /** Only for `stream_event` lines: the content-block index the event addresses. */
  blockIndex?: number;
  /** Only for `content_block_start`: the starting block's type (`text`, `tool_use`, …). */
  blockType?: string;
  /** Only set for `init`: the concrete model id the run resolved the alias to. */
  model?: string;
  /**
   * Only set for `init`: the slash commands the running CLI reports as available
   * in this session (built-ins + skills + custom), used to advertise `agent/commands`.
   */
  slashCommands?: string[];
  /** Only set for `result`: whether the turn ended in error. */
  isError?: boolean;
  /** Only set for `result`: the raw `usage` object (token counts), if present. */
  usage?: unknown;
  /** Only set for `system/compact_boundary`. */
  compactionReason?: CompactionReason;
  /** Context tokens immediately before a compact boundary, when reported. */
  tokensBefore?: number;
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
  // Lines produced by a parallel SUBAGENT (Task) turn carry the spawning
  // tool_use id — the adapter keys its main-vs-subagent handling off this.
  const parentToolUseId =
    typeof parsed['parent_tool_use_id'] === 'string' ? parsed['parent_tool_use_id'] : undefined;
  const base = {
    sessionId,
    ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
  } as const;
  switch (parsed['type']) {
    case 'system': {
      // `system` is a family, not one event: alongside `init` the CLI reports
      // **context compaction** and **background tasks** (`Bash` with
      // `run_in_background`) — and those decide whether a `result` is really the
      // end of the turn. Treating every system line as an init, as this used to,
      // threw those signals away.
      const subtype = typeof parsed['subtype'] === 'string' ? parsed['subtype'] : undefined;
      const taskId = typeof parsed['task_id'] === 'string' ? parsed['task_id'] : undefined;
      if (subtype === 'task_started' && taskId) {
        return { kind: 'task_started', ...base, taskId };
      }
      // The CLI reports the outcome twice — `task_updated` then
      // `task_notification` — and only the notification carries the status.
      if (subtype === 'task_notification' && taskId) {
        const status = parsed['status'] === 'completed' ? 'completed' : 'stopped';
        return { kind: 'task_ended', ...base, taskId, taskStatus: status };
      }
      if (subtype === 'compact_boundary') {
        const metadata = isRecord(parsed['compact_metadata'])
          ? parsed['compact_metadata']
          : undefined;
        const trigger = metadata?.['trigger'];
        const compactionReason: CompactionReason =
          trigger === 'manual'
            ? 'manual'
            : trigger === 'auto' || trigger === 'automatic'
              ? 'automatic'
              : 'unknown';
        const preTokens = metadata?.['pre_tokens'];
        return {
          kind: 'compaction',
          ...base,
          compactionReason,
          ...(typeof preTokens === 'number' && preTokens >= 0
            ? { tokensBefore: Math.round(preTokens) }
            : {}),
        };
      }
      if (subtype !== undefined && subtype !== 'init') {
        // `background_tasks_changed`, `task_updated`, `thinking_tokens`, `status`:
        // real events we deliberately do not act on. Classifying them as `init`
        // would make each one look like a fresh session.
        return { kind: 'other', ...base };
      }
      const model = typeof parsed['model'] === 'string' ? parsed['model'] : undefined;
      const slashCommands = Array.isArray(parsed['slash_commands'])
        ? parsed['slash_commands'].filter((c): c is string => typeof c === 'string')
        : undefined;
      return {
        kind: 'init',
        ...base,
        ...(model !== undefined ? { model } : {}),
        ...(slashCommands !== undefined ? { slashCommands } : {}),
      };
    }
    case 'stream_event': {
      const event = isRecord(parsed['event']) ? parsed['event'] : undefined;
      const blockIndex =
        event && typeof event['index'] === 'number' ? (event['index'] as number) : undefined;
      const withIndex = blockIndex !== undefined ? { blockIndex } : {};
      if (event && event['type'] === 'content_block_delta') {
        const delta = isRecord(event['delta']) ? event['delta'] : undefined;
        if (delta && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
          return { kind: 'delta', ...base, ...withIndex, text: delta['text'] };
        }
        // Extended-thinking output streams as `thinking_delta` blocks (the
        // signature_delta blocks that follow carry no readable text → ignored).
        if (delta && delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          return { kind: 'thinking', ...base, ...withIndex, text: delta['thinking'] };
        }
      }
      // Content-block boundaries — surfaced so the adapter can track whether a
      // main-loop text run is currently open (a parallel subagent block landing
      // mid-run must be ordered before it, not spliced into it).
      if (event && event['type'] === 'content_block_start') {
        const block = isRecord(event['content_block']) ? event['content_block'] : undefined;
        const blockType =
          block && typeof block['type'] === 'string' ? (block['type'] as string) : undefined;
        return {
          kind: 'other',
          ...base,
          streamType: 'content_block_start',
          ...withIndex,
          ...(blockType !== undefined ? { blockType } : {}),
        };
      }
      if (event && event['type'] === 'content_block_stop') {
        return { kind: 'other', ...base, streamType: 'content_block_stop', ...withIndex };
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
  readonly #interactiveApprovals: boolean;
  readonly #approvalHook:
    | { token: string; scriptPath: string; url: () => string | undefined }
    | undefined;
  readonly #spawn: SpawnFn;
  /** threadId → Claude session id, for `--resume` continuity. */
  readonly #sessionByThread = new Map<string, string>();
  /** Slash commands the CLI reported in the last turn's `system/init` (see listCommands). */
  #slashCommands: string[] = [];
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
    this.#interactiveApprovals = options.interactiveApprovals ?? false;
    this.#approvalHook = options.approvalHook;
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

    // The thread's persisted access mode (chosen on the phone) overrides the
    // adapter's configured posture for THIS turn. Absent → unchanged behaviour.
    const accessMode = options.accessMode;
    // Interactive approvals: inject a PreToolUse hook (validated against claude
    // 2.1.177) that round-trips each tool to the bridge for the user's decision.
    // The hook stays in play for `requestApproval` (and when no mode is set);
    // `approveForMe`/`fullAccess` explicitly bypass it so the agent isn't asked.
    const hookConfigured = this.#interactiveApprovals && this.#approvalHook !== undefined;
    const allowHook =
      (accessMode === undefined || accessMode === 'requestApproval') && hookConfigured;
    const hookUrl = allowHook ? this.#approvalHook!.url() : undefined;
    const interactive = hookUrl !== undefined;
    // The non-interactive permission posture: the access mode wins when set,
    // else the configured default. `requestApproval` without a usable hook falls
    // back to the configured posture (so the turn isn't denied wholesale).
    const effectiveMode: ClaudePermissionMode =
      accessMode === 'approveForMe'
        ? 'acceptEdits'
        : accessMode === 'fullAccess'
          ? 'bypassPermissions'
          : this.#permissionMode;

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    if (interactive) {
      const settings = JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: `node "${this.#approvalHook!.scriptPath}"`,
                  // Raise the hook timeout well above Claude's ~60s default so a
                  // backgrounded phone can reconnect and answer before Claude
                  // aborts the hook (which would default the tool to deny).
                  timeout: APPROVAL_HOOK_TIMEOUT_SECONDS,
                },
              ],
            },
          ],
        },
      });
      // `--permission-mode default` is REQUIRED for the PreToolUse hook to run
      // (validated against claude 2.1.177: without it, headless `-p` doesn't
      // consult the hook and denies). The hook is then the gate.
      args.push('--settings', settings, '--permission-mode', 'default');
    } else if (effectiveMode === 'acceptEdits') {
      args.push('--permission-mode', 'acceptEdits');
    } else if (effectiveMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }
    if (model) args.push('--model', model);
    // Reasoning effort (low|medium|high|xhigh|max). Pass-through — the CLI
    // validates the level; `claude --effort` is a session flag (verified
    // against `claude --help`). Reads the `reasoning` knob, then legacy effort.
    const effort = reasoningValue(options);
    if (effort) args.push('--effort', effort);
    if (sessionId) args.push('--resume', sessionId);
    args.push(text);

    const spawnExtra = interactive
      ? {
          env: {
            UXNAN_HOOK_URL: hookUrl,
            UXNAN_HOOK_TOKEN: this.#approvalHook!.token,
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
        data: { text: `failed to launch claude: ${errorMessage(err)}` },
      });
      return Promise.resolve();
    }

    this.#active.set(turnId, { child, threadId });
    this.emit({ type: 'turn_started', threadId, turnId });

    let full = '';
    // Deltas belonging to the current native assistant-message envelope. Claude
    // may emit several envelopes in one turn around tool use; reconciling each
    // envelope independently prevents a later non-streamed message from being
    // skipped merely because an earlier one streamed.
    let currentAssistantText = '';
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
    // Index of the MAIN-loop text content block currently streaming deltas, or
    // undefined when no text run is open. Parallel subagent (Task) lines arrive
    // interleaved with the main stream; a block emitted while a text run is
    // open is flagged `beforeText` so the store/phone order it BEFORE the run
    // instead of severing it (which rendered sentences split mid-word by an
    // activity card). `-1` stands in when the CLI omits the block index.
    let openTextIndex: number | undefined;
    // Background tasks (`Bash` with `run_in_background`) the model started and
    // that have not reported an outcome yet. While one is live the CLI is still
    // running and may WAKE THE MODEL for another turn, so a `result` is NOT the
    // end of this turn.
    const liveBackgroundTasks = new Set<string>();
    // Set when a `result` arrived while a background task was still live: the
    // turn's completion is held until the tasks resolve and the CLI either
    // produces its follow-up turn or exits.
    let deferredCompletion = false;
    // Background tasks the CLI killed on its way out (`stopped`). That work was
    // started on the user's behalf and did NOT finish — staying silent about it
    // is what let the phone report a clean success over lost work.
    let interruptedTasks = 0;
    // The completion payload observed at the last `result`, replayed if the run
    // ends without another one.
    let pendingCompletion: { text: string; usage?: { tokens: number; contextWindow?: number } } = {
      text: '',
    };

    /** Emit the single `turn_completed` for this run, once. */
    const completeOnce = (payload: {
      text: string;
      usage?: { tokens: number; contextWindow?: number };
    }): void => {
      if (completed || errored) return;
      completed = true;
      if (interruptedTasks > 0) {
        // Say it in the turn itself. The CLI gives background work only a few
        // seconds' grace after the turn ends and then kills it, so this is a
        // real, silent loss the user would otherwise never learn about.
        this.emit({
          type: 'block',
          threadId,
          turnId,
          data: {
            content: warningBlock(
              interruptedTasks === 1
                ? 'The agent left a background task running, and it was interrupted when the turn ended. Its work did not finish.'
                : `The agent left ${interruptedTasks} background tasks running, and they were interrupted when the turn ended. Their work did not finish.`,
            ),
          },
        });
      }
      this.emit({
        type: 'turn_completed',
        threadId,
        turnId,
        data: {
          text: payload.text,
          ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
        },
      });
    };

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const event = parseClaudeLine(line);
      if (!event) return;
      // Lines carrying `parent_tool_use_id` belong to a parallel SUBAGENT turn:
      // their tool blocks still feed the work log, but their text/usage must
      // never fold into the main message or close the main text run.
      const subagent = event.parentToolUseId !== undefined;
      if (event.sessionId) this.#sessionByThread.set(threadId, event.sessionId);
      // Cache the CLI's advertised slash commands for `agent/commands` discovery.
      if (event.slashCommands) this.#slashCommands = event.slashCommands;
      // Register tool invocations (with their inputs) so the result can pair.
      if (event.toolUses) {
        for (const tool of event.toolUses) pendingTools.set(tool.id, tool);
      }
      // Track the latest MAIN assistant-message usage as a completion fallback
      // (a subagent's usage is its own context, not this conversation's).
      if (!subagent && event.kind === 'assistant_text' && event.usage !== undefined) {
        lastUsage = event.usage;
      }
      // Main-loop text-run boundaries: a text block opens on its start (or
      // defensively on its first delta below); any other block starting, its
      // stop, or the message envelope closes it.
      if (!subagent && event.streamType === 'content_block_start') {
        openTextIndex = event.blockType === 'text' ? (event.blockIndex ?? -1) : undefined;
      } else if (!subagent && event.streamType === 'content_block_stop') {
        if (openTextIndex === (event.blockIndex ?? -1)) openTextIndex = undefined;
      } else if (!subagent && event.kind === 'assistant_text') {
        openTextIndex = undefined;
      }
      // A tool_result completes a tool → emit a structured block (command/diff/
      // tool) for the Work log / Changed files sections. When it lands while the
      // main text is mid-run (only parallel subagent/background activity can),
      // `beforeText` orders it before the open run.
      if (event.kind === 'tool_result' && event.toolResults) {
        for (const result of event.toolResults) {
          const tool = pendingTools.get(result.toolUseId);
          if (!tool) continue;
          pendingTools.delete(result.toolUseId);
          this.emit({
            type: 'block',
            threadId,
            turnId,
            data: {
              content: toolUseToBlock(tool, result),
              ...(openTextIndex !== undefined ? { beforeText: true } : {}),
            },
          });
        }
      }
      if (subagent) return; // everything below folds into the MAIN message only
      if (event.kind === 'compaction') {
        this.emit({
          type: 'block',
          threadId,
          turnId,
          data: {
            content: compactionBlock(event.compactionReason, {
              ...(event.tokensBefore !== undefined ? { tokensBefore: event.tokensBefore } : {}),
            }),
          },
        });
      } else if (event.kind === 'init' && event.model && !sawModel) {
        // Surface the concrete model the alias resolved to (e.g. `opus` →
        // `claude-opus-4-8`) so the phone can show the exact version in use.
        sawModel = true;
        resolvedModel = event.model;
        this.emit({ type: 'model_resolved', threadId, turnId, data: { text: event.model } });
      } else if (event.kind === 'delta' && event.text) {
        full += event.text;
        currentAssistantText += event.text;
        openTextIndex = event.blockIndex ?? -1;
        this.emit({ type: 'delta', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'thinking' && event.text) {
        // Reasoning chunk — streamed to the phone (and persisted) separately from
        // the answer so it can be shown in a collapsible "thinking" section.
        this.emit({ type: 'thinking', threadId, turnId, data: { text: event.text } });
      } else if (event.kind === 'assistant_text') {
        // The complete native message follows its partial stream. Emit only an
        // unseen suffix (or the whole message when this envelope had no
        // deltas), then preserve its boundary for the mobile disclosure UI.
        const complete = event.text ?? '';
        const unseen = unseenAssistantText(currentAssistantText, complete);
        if (unseen) {
          full += unseen;
          this.emit({ type: 'delta', threadId, turnId, data: { text: unseen } });
        }
        if (currentAssistantText.length > 0 || complete.length > 0) {
          this.emit({
            type: 'block',
            threadId,
            turnId,
            data: { content: assistantResponseBoundaryBlock() },
          });
        }
        currentAssistantText = '';
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
          // Prefer the accumulated assistant envelopes (`full`) — they are the
          // complete narration the user saw. `result.result` is often only the
          // final segment of a tool-using turn, so using it would shrink the
          // message on re-sync and drop earlier paragraphs — and after a
          // deferred completion the run spans TWO model turns, of which
          // `result.result` only ever carries the latest, so the accumulated
          // narration is also the only text that still holds the first reply.
          const finalText = full.length > 0 ? full : (event.text ?? '');
          const tokens = claudeUsageTokens(event.usage ?? lastUsage);
          const window = claudeContextWindow(resolvedModel ?? model);
          const usage =
            tokens !== undefined
              ? { tokens, ...(window !== undefined ? { contextWindow: window } : {}) }
              : undefined;
          pendingCompletion = { text: finalText, ...(usage !== undefined ? { usage } : {}) };
          if (liveBackgroundTasks.size > 0) {
            // The model ended its turn but left work running, and the CLI keeps
            // running to wait for it — when that work finishes in time the CLI
            // wakes the model and a SECOND turn follows on this same process.
            // Completing here would end the turn mid-work: the phone would drop
            // its "responding" state, the queue would drain a follow-up into a
            // process that is still busy, and the wake-up turn would land on a
            // turn already closed (its text overwriting the first reply).
            deferredCompletion = true;
          } else {
            completeOnce(pendingCompletion);
          }
        }
      } else if (event.kind === 'task_started' && event.taskId) {
        liveBackgroundTasks.add(event.taskId);
      } else if (event.kind === 'task_ended' && event.taskId) {
        liveBackgroundTasks.delete(event.taskId);
        if (event.taskStatus === 'stopped') interruptedTasks += 1;
        // Deliberately NOT completing here even when the last task resolves: a
        // `completed` task is exactly when the CLI wakes the model, so the run
        // is finished by its follow-up `result` or by the process exiting.
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
      if (completed || errored) return;
      // A background task still open at exit was killed with the process, even
      // if its `task_notification` never arrived.
      interruptedTasks += liveBackgroundTasks.size;
      liveBackgroundTasks.clear();
      if (deferredCompletion) {
        // The turn was held for background work and the CLI exited without a
        // follow-up turn: complete it now — with the streamed text, which by
        // then includes any wake-up turn's output — and report whatever the CLI
        // killed on its way out.
        completeOnce({
          ...pendingCompletion,
          text: full.length > 0 ? full : pendingCompletion.text,
        });
        return;
      }
      // No terminal `result` line arrived (e.g. killed): complete with what we have.
      completeOnce({ text: full });
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
   * Name a conversation with `haiku`, the cheapest tier — a side errand, not a
   * turn: a fresh one-shot with **no `--resume`**, so it neither joins the
   * thread's session nor shows up in its history.
   *
   * Text in, text out (`--output-format text`): there is nothing to stream, and
   * parsing one line beats decoding a JSON event stream for it.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const args = ['-p', '--output-format', 'text', '--model', TITLE_MODEL, prompt];
    try {
      const cwd = options.cwd ?? this.#defaultCwd;
      const raw = await runTitleOneShot(() =>
        this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd),
      );
      return raw === undefined ? undefined : sanitizeTitle(raw);
    } catch {
      // Naming is cosmetic — no credit, a missing CLI or a timeout must never
      // disturb a thread that is otherwise working.
      return undefined;
    }
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
        // Flags the moving-target alias so the phone can offer to hide these
        // and show only the concrete pinned versions (contract field).
        isLatestAlias: true,
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

  /**
   * Slash commands Claude Code exposes: the curated headless-safe built-ins,
   * plus project/user custom commands (`.claude/commands/*.md`), plus whatever
   * the running CLI last reported in `system/init` (skills, plugins, custom).
   * Claude runs them natively in `-p` mode, so there is no {@link expandCommand}
   * — the bridge sends `/name args` and the CLI expands it against the thread's
   * `--resume` session. Discovery only; deduped by name.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const byName = new Map<string, AgentCommand>();
    for (const b of CLAUDE_BUILTIN_COMMANDS) {
      byName.set(b.name, {
        name: b.name,
        description: b.description,
        source: 'builtin',
        headlessSupported: true,
      });
    }
    const dir = cwd ?? this.#defaultCwd;
    const scanned = await scanCustomCommands({
      dirs: [join(dir, '.claude', 'commands'), join(homedir(), '.claude', 'commands')],
      ext: '.md',
      format: 'markdown',
    });
    for (const c of scanned) byName.set(c.name, c);
    // Names the running CLI advertised last turn — authoritative, covers skills/
    // plugins we don't scan. Names only (no description). Skip interactive-only.
    for (const raw of this.#slashCommands) {
      const name = raw.replace(/^\//, '');
      if (!name || CLAUDE_EXCLUDED_COMMANDS.has(name) || byName.has(name)) continue;
      byName.set(name, { name, source: 'builtin', headlessSupported: true });
    }
    return [...byName.values()];
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

function unseenAssistantText(streamed: string, complete: string): string {
  if (complete.length === 0 || streamed === complete || streamed.includes(complete)) return '';
  return complete.startsWith(streamed) ? complete.slice(streamed.length) : complete;
}
