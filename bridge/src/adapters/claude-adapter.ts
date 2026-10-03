/**
 * Claude Code adapter (real agent).
 *
 * Claude Code does NOT speak the generic bridge agent IPC. Each turn spawns
 * `claude -p --input-format stream-json --output-format stream-json --verbose
 * --include-partial-messages` as a one-shot process and maps its JSONL event
 * stream onto the bridge's agent events. Session continuity is preserved by
 * capturing `session_id` from the stream and passing `--resume` on the next turn.
 *
 * Critical detail: the prompt is NOT an argv element — it is written to stdin as
 * a stream-json user message (`{"type":"user","message":{…}}`), which is what
 * keeps an input channel open for the length of the turn so `steerTurn` can hand
 * the agent a follow-up mid-run. The process is still spawned `shell:false`, so
 * the prompt is never interpolated into a shell.
 *
 * The pipe MUST be closed when the turn ends: in this mode the CLI waits for
 * another message after emitting `result` instead of exiting.
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
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import type {
  AccessMode,
  AgentCapabilities,
  AgentCommand,
  AgentConfig,
  AgentId,
  AgentModel,
  AgentModelOption,
  CompactionReason,
  GenerateTitleOptions,
  NativeSessionInfo,
  SendTurnOptions,
} from '@uxnan/shared';
import { DESKTOP_CWD_HEADER, DESKTOP_MCP_SERVER_NAME, encodeCwdHeader } from '@uxnan/shared';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { listClaudeSessions } from './native-sessions.js';
import {
  extractToolResults,
  extractToolUses,
  toolUseStartBlock,
  toolUseToBlock,
  type ClaudeToolResult,
  type ClaudeToolUse,
} from './claude-tools.js';
import { warningBlock, withBlockId } from './content-blocks.js';
import { effortValues, reasoningOption, reasoningValue } from './run-options.js';
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
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
  reportsContextUsage: true,
  reportsCompaction: true,
  commands: true,
  // `--input-format stream-json` keeps stdin open for the length of the turn, so
  // a follow-up written mid-run is picked up at the next tool boundary. Verified
  // against claude 2.1.220: a message sent 7s into a five-`sleep` turn was taken
  // after the first tool returned, the remaining sleeps were abandoned, and the
  // run produced a SINGLE `result` — one turn, steered.
  steering: true,
};

/**
 * Commands the CLI itself says only work in its terminal UI (`system/init`
 * `terminal_slash_commands`, verified on claude 2.1.282). Replaced by what the
 * running CLI reports as soon as a turn has run.
 */
const CLAUDE_TERMINAL_COMMANDS = ['doctor', 'color', 'focus', 'reload-plugins'];

/**
 * Commands the CLI can run headless but that the bridge must not offer: it
 * owns what they change (the conversation's context and name, its model and
 * effort, the agent's settings), they manage the user's account, or they are
 * internal. `/status` is advertised but answers "isn't available in this
 * environment" in `-p` mode.
 */
const CLAUDE_BRIDGE_OWNED_COMMANDS = new Set([
  'clear',
  'rename',
  'model',
  'effort',
  'fast',
  'config',
  'output-style',
  'autocompact',
  'status',
  'mcp',
  'import',
  'heapdump',
  'auto-mode-setup',
  'usage-credits',
  'extra-usage',
  'design',
  'design-consent',
  'design-revoke',
  'workflow-launch-exec',
  'login',
  'logout',
]);

/** How long a folder's command list is reused before the CLI is asked again. */
/**
 * How long a turn held for background work waits, once its last task has
 * ended, for the CLI to wake the model. Measured: the wake-up's `init` follows
 * the `task_notification` in ~0.2 s, so this only bounds a wake that never
 * comes — then the input is closed and the run ends as it did before.
 */
const WAKE_GRACE_MS = 30_000;

const COMMANDS_TTL_MS = 60_000;

/** How long the CLI may take to answer `initialize`. */
const COMMANDS_TIMEOUT_MS = 10_000;

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

/**
 * The effort a Claude turn runs at when nobody picked one. Claude Code's own
 * default is decided per model at run time (remote configuration, then the
 * model's capabilities, then `high`), and no headless surface reports it —
 * neither `system/init` nor the `initialize` / `get_status` control requests
 * (verified on 2.1.283). So the bridge names one and sends it: the level the
 * picker shows as the default is the level the turn runs at.
 */
const CLAUDE_DEFAULT_EFFORT = 'high';

/** Reasoning-effort knob advertised on the Claude models that take one. */
const CLAUDE_REASONING_OPTION: AgentModelOption = reasoningOption(
  effortValues(CLAUDE_EFFORT_LEVELS),
  CLAUDE_DEFAULT_EFFORT,
);

/**
 * Whether a model takes `--effort`: every one but Haiku, which Claude Code's
 * `initialize` lists without `supportsEffort` (verified on 2.1.283).
 */
export function claudeTakesEffort(modelId: string): boolean {
  return !/haiku/i.test(modelId);
}

/**
 * How each access mode runs on `claude -p` (verified on claude 2.1.287):
 *  - `requestApproval` → the `PreToolUse` hook asks the person for every tool,
 *    with `--permission-mode default` (headless `-p` consults the hook only
 *    then). Offered only when the bridge can serve the hook.
 *  - `approveForMe`    → `--permission-mode auto`: tools run under Claude's own
 *    reviewer, which declines what it judges unsafe. Not every model has it
 *    (haiku starts in `default` instead, which declines anything needing
 *    approval) — the turn says so when the CLI reports another mode.
 *  - `fullAccess`      → `--dangerously-skip-permissions`.
 *  - `plan`            → `--permission-mode plan`: reads and plans, changes nothing.
 */
const CLAUDE_MODE_FLAGS: Record<Exclude<AccessMode, 'requestApproval'>, string[]> = {
  approveForMe: ['--permission-mode', 'auto'],
  fullAccess: ['--dangerously-skip-permissions'],
  plan: ['--permission-mode', 'plan'],
};
/** The `permissionMode` `system/init` reports for each mode it was asked for. */
const CLAUDE_REPORTED_MODE: Record<AccessMode, string> = {
  requestApproval: 'default',
  approveForMe: 'auto',
  fullAccess: 'bypassPermissions',
  plan: 'plan',
};

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
  /** Home directory its session store is listed from (tests); the user's by default. */
  homeDir?: string;
  /** Executable to spawn (found by `locateAgent`, `agents/agent-installs.ts`). */
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
  /**
   * The local approval-hook endpoint + token + the path to the shipped hook
   * script — what lets `requestApproval` ask the person. Without it the mode is
   * not offered. `url()` is lazy because the LAN port is known only after the
   * server starts; a turn that asks before then fails rather than run unasked.
   */
  approvalHook?: { token: string; scriptPath: string; url: () => string | undefined };
  /** Injected spawn function for the one-shot path (tests). */
  spawnFn?: SpawnFn;
  /** Override {@link WAKE_GRACE_MS} (tests). */
  wakeGraceMs?: number;
}

interface ActiveRun {
  child: SpawnedProcess;
  threadId: string;
  /**
   * True once the turn has emitted its terminal event. A follow-up must not be
   * written after that: the CLI would read it as a NEW turn on the same process
   * and stream a second reply into a turn the bridge already closed.
   */
  finished: boolean;
  /**
   * Write one more user message into the running turn (see {@link
   * ClaudeAdapter.steerTurn}). Resolves `true` once the CLI READ it — echoed
   * it back, `--replay-user-messages` — and `false` when it could not be
   * written or the CLI came down before reading it.
   */
  send: (text: string) => Promise<boolean>;
  /**
   * Why the process is being ended from here, if it is: the user stopped the
   * turn (`cancelTurn`, which reports it itself), or the bridge is shutting
   * down (`stop`) — the turn did not finish, and must not read as if it had.
   */
  ending?: 'cancelled' | 'stopping';
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
    | 'replay'
    | 'result'
    | 'task_started'
    | 'task_ended'
    | 'other';
  sessionId?: string;
  text?: string;
  /**
   * Only for `replay`: the `uuid` the adapter gave a message it wrote to stdin,
   * echoed back by `--replay-user-messages` the moment the CLI reads it.
   */
  uuid?: string;
  /**
   * Only for `task_started` / `task_ended`: the CLI's own id for a **background
   * task** the model started (`Bash` with `run_in_background`). The turn is not
   * over while one is live — see `sendTurn`'s deferred-completion handling.
   */
  taskId?: string;
  /**
   * Only for `task_ended`: how the background task finished, as the CLI says
   * it (verified on `claude -p --output-format stream-json`). `completed`: it
   * exited 0. `failed`: it exited with an error — its work did finish, and the
   * model is told the result like any other. `stopped`: something ended it —
   * the model or the user while the run goes on, or the CLI itself as it comes
   * down once its input is closed; only the last is work lost.
   */
  taskStatus?: 'completed' | 'failed' | 'stopped';
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
  /** `system/init` `terminal_slash_commands`: commands only its TUI runs. */
  terminalCommands?: string[];
  /** Only for `init`: the permission mode the CLI says it runs in. */
  permissionMode?: string;
  /** Only set for `result`: whether the turn ended in error. */
  isError?: boolean;
  /** Only set for `result`: the CLI's error messages, when it failed before
   *  running the turn (e.g. `No conversation found with session ID: …`). */
  errors?: string[];
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
        const reported = parsed['status'];
        const status =
          reported === 'completed' ? 'completed' : reported === 'failed' ? 'failed' : 'stopped';
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
      const terminalCommands = Array.isArray(parsed['terminal_slash_commands'])
        ? parsed['terminal_slash_commands'].filter((c): c is string => typeof c === 'string')
        : undefined;
      const permissionMode =
        typeof parsed['permissionMode'] === 'string' ? parsed['permissionMode'] : undefined;
      return {
        kind: 'init',
        ...base,
        ...(model !== undefined ? { model } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        ...(terminalCommands !== undefined ? { terminalCommands } : {}),
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
      // A message the adapter wrote, echoed back as the CLI takes it in
      // (`--replay-user-messages`, verified against claude 2.1.283: the line
      // carries the `uuid` it was written with and `isReplay: true`).
      if (parsed['isReplay'] === true && typeof parsed['uuid'] === 'string') {
        return { kind: 'replay', ...base, uuid: parsed['uuid'] };
      }
      const message = isRecord(parsed['message']) ? parsed['message'] : undefined;
      const toolResults = extractToolResults(message ? message['content'] : undefined);
      return { kind: 'tool_result', ...base, ...(toolResults.length > 0 ? { toolResults } : {}) };
    }
    case 'result': {
      const isError = parsed['is_error'] === true || parsed['subtype'] !== 'success';
      const text = typeof parsed['result'] === 'string' ? parsed['result'] : undefined;
      const errors = Array.isArray(parsed['errors'])
        ? parsed['errors'].filter((e): e is string => typeof e === 'string')
        : [];
      return {
        kind: 'result',
        ...base,
        text,
        isError,
        ...(errors.length > 0 ? { errors } : {}),
        ...(parsed['usage'] !== undefined ? { usage: parsed['usage'] } : {}),
      };
    }
    default:
      return { kind: 'other', ...base };
  }
}

/** Whether a failed `result` says the resumed session does not exist — the
 *  CLI's words for it, verified against claude 2.1.283: `No conversation found
 *  with session ID: <id>`, before any turn ran. */
function isMissingSession(errors: string[] | undefined): boolean {
  return (errors ?? []).some((e) => e.startsWith('No conversation found with session ID'));
}

/** The environment variables a run's desktop MCP config expands: the bearer
 *  token (the same name the desktop's own launches use) and the conversation's
 *  working directory, which the desktop scopes the agent to. */
export const DESKTOP_TOKEN_ENV = 'UXNAN_MCP_TOKEN';
export const DESKTOP_CWD_ENV = 'UXNAN_THREAD_CWD';

/** `--mcp-config` for a run with Uxnan Desktop's tools: the desktop's MCP
 *  endpoint under the name its terminal agents know, with the token and the
 *  cwd read from the environment when Claude loads it. */
export function claudeDesktopMcpConfig(mcpUrl: string): string {
  return JSON.stringify({
    mcpServers: {
      [DESKTOP_MCP_SERVER_NAME]: {
        type: 'http',
        url: mcpUrl,
        headers: {
          Authorization: `Bearer \${${DESKTOP_TOKEN_ENV}}`,
          [DESKTOP_CWD_HEADER]: `\${${DESKTOP_CWD_ENV}}`,
        },
      },
    },
  });
}

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'claude-code';
  readonly capabilities: AgentCapabilities;

  readonly #binaryPath: string;
  readonly #prependArgs: string[];
  readonly #defaultModel: string | undefined;
  readonly #pinnedModels: ClaudeModelSpec[];
  readonly #approvalHook:
    | { token: string; scriptPath: string; url: () => string | undefined }
    | undefined;
  readonly #spawn: SpawnFn;
  readonly #wakeGraceMs: number;
  /** What the CLI last said only works in its terminal (see listCommands). */
  #terminalCommands: string[] = CLAUDE_TERMINAL_COMMANDS;
  /** The CLI's command list per folder, briefly reused (see listCommands). */
  readonly #commandsByCwd = new Map<string, { at: number; commands: AgentCommand[] }>();
  /** turnId → in-flight run, for cancellation. */
  readonly #active = new Map<string, ActiveRun>();
  readonly #homeDir: string;
  #defaultCwd = process.cwd();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  /** Claude Code's sessions in a folder, from its own session store (`native-sessions.ts`). */
  listNativeSessions(cwd: string): Promise<NativeSessionInfo[]> {
    return listClaudeSessions(this.#homeDir, cwd);
  }

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'claude';
    this.#prependArgs = options.prependArgs ?? [];
    this.#homeDir = options.homeDir ?? homedir();
    this.#defaultModel = options.defaultModel;
    this.#pinnedModels = options.pinnedModels ?? [];
    this.#approvalHook = options.approvalHook;
    // Asking first needs the hook's endpoint; every other mode is a flag.
    this.capabilities = {
      ...CLAUDE_CAPABILITIES,
      accessModes: [
        ...(options.approvalHook !== undefined ? (['requestApproval'] as const) : []),
        'approveForMe',
        'fullAccess',
        'plan',
      ],
      defaultAccessMode: 'fullAccess',
    };
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#wakeGraceMs = options.wakeGraceMs ?? WAKE_GRACE_MS;
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
      run.ending = 'stopping';
      run.child.kill();
    }
    this.#active.clear();
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    const cwd = options.cwd ?? this.#defaultCwd;
    const model = options.service ?? this.#defaultModel;
    const sessionId = this.nativeSessionId(threadId);

    // The conversation's access mode, one this adapter declared (the bridge
    // resolves anything else to the default before it gets here).
    const accessMode: AccessMode = options.accessMode ?? 'fullAccess';
    const hookUrl = accessMode === 'requestApproval' ? this.#approvalHook?.url() : undefined;
    if (accessMode === 'requestApproval' && hookUrl === undefined) {
      // Running it anyway would act without the approvals the person chose.
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: {
          text: 'Claude Code cannot ask for approval yet: the bridge has no approval endpoint. Try again in a moment, or choose another access mode.',
        },
      });
      return Promise.resolve();
    }

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      // The prompt travels on stdin as a stream-json user message rather than as
      // an argv element. That is what leaves an input channel open for the
      // length of the turn, so a follow-up can reach the agent while it works
      // instead of waiting for the whole turn (see `steerTurn`).
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Echo each message written to stdin as the CLI takes it in, with the
      // uuid it was written with. The only way to tell which `result` answers
      // our messages: a steer joins the running model turn (one `result`),
      // but one read after that turn ended runs as another, and the CLI also
      // runs turns of its own — waking the model when background work ends,
      // or for a `<task-notification>` a resumed session still owed. A
      // `result` ends this turn only once every message we wrote was read.
      '--replay-user-messages',
    ];
    if (hookUrl !== undefined) {
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
    } else if (accessMode !== 'requestApproval') {
      args.push(...CLAUDE_MODE_FLAGS[accessMode]);
    }
    if (model) args.push('--model', model);
    // Reasoning effort (low|medium|high|xhigh|max). Pass-through — the CLI
    // validates the level; `claude --effort` is a session flag (verified
    // against `claude --help`). Reads the `reasoning` knob, then legacy effort.
    const effort = reasoningValue(options);
    if (effort) args.push('--effort', effort);
    // Verified against claude 2.1.220: `--resume` carries the session exactly as
    // before when the prompt arrives on stdin (turn 2 of a probe recalled a
    // number given in turn 1, on the same session id, with deltas still streaming).
    if (sessionId) args.push('--resume', sessionId);
    // Uxnan Desktop's tools, when it attached them: one MCP server for this run
    // only, named like the desktop's own launches. Verified against claude
    // 2.1.282: a JSON-string `--mcp-config` connects, lists and calls the
    // server, and expands `${VAR}` in its headers from the environment — so the
    // token never reaches argv or a file.
    const desktop = options.desktopTools;
    if (desktop) args.push('--mcp-config', claudeDesktopMcpConfig(desktop.mcpUrl));

    const env: Record<string, string> = {
      ...(hookUrl !== undefined
        ? {
            UXNAN_HOOK_URL: hookUrl,
            UXNAN_HOOK_TOKEN: this.#approvalHook!.token,
            UXNAN_HOOK_THREAD_ID: threadId,
          }
        : {}),
      ...(desktop
        ? { [DESKTOP_TOKEN_ENV]: desktop.token, [DESKTOP_CWD_ENV]: encodeCwdHeader(cwd ?? '') }
        : {}),
    };
    const spawnExtra = {
      // A real pipe, not the default closed stdin — this CLI is reading a
      // message stream, so it does not hang on an open one.
      stdin: 'pipe' as const,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };

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

    // Messages written to the CLI that it has not echoed back yet (by uuid),
    // each with who waits to hear it was read (a follow-up; not the prompt).
    // While one is unread the turn is not over, whatever `result` arrives.
    const unread = new Map<string, ((read: boolean) => void) | undefined>();
    // One stream-json user message per line. Returns its uuid, or undefined
    // when the pipe is already gone, so a caller can report "not taken"
    // instead of pretending.
    const writeUserMessage = (
      message: string,
      onRead?: (read: boolean) => void,
    ): string | undefined => {
      const stdin = child.stdin;
      if (!stdin || !stdin.writable) return undefined;
      const uuid = randomUUID();
      unread.set(uuid, onRead);
      try {
        stdin.write(
          `${JSON.stringify({
            type: 'user',
            uuid,
            message: { role: 'user', content: [{ type: 'text', text: message }] },
          })}\n`,
        );
        return uuid;
      } catch {
        unread.delete(uuid);
        return undefined;
      }
    };
    // A follow-up is placed in the conversation when the CLI reads it, not
    // when it is written: the CLI holds it until the step it is in ends.
    const sendFollowUp = (message: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (writeUserMessage(message, resolve) === undefined) resolve(false);
      });
    // The process is gone: a follow-up the CLI never read goes back to the
    // queue, to run as a turn of its own — it was not part of this run.
    const returnUnreadFollowUps = (): void => {
      for (const [uuid, onRead] of unread) {
        if (onRead === undefined) continue;
        unread.delete(uuid);
        onRead(false);
      }
    };
    // The last lines the CLI wrote to stderr: the only account of why it came
    // down without answering. Read as it arrives, which also keeps the pipe
    // from filling and stalling the CLI.
    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2000);
    });

    // Once the input is closed the CLI comes down, and it stops whatever
    // background work is still running as it goes.
    let inputClosed = false;
    /**
     * Tell the CLI no more input is coming. REQUIRED to end the run: with
     * `--input-format stream-json` the process keeps waiting for another message
     * after it emits `result` (verified), so leaving the pipe open would hang
     * the turn forever.
     */
    const endInput = (): void => {
      inputClosed = true;
      try {
        child.stdin?.end();
      } catch {
        /* the pipe is already gone; nothing to close */
      }
    };

    const run: ActiveRun = { child, threadId, finished: false, send: sendFollowUp };
    this.#active.set(turnId, run);
    this.emit({ type: 'turn_started', threadId, turnId });

    if (writeUserMessage(text) === undefined) {
      this.#active.delete(turnId);
      this.emit({
        type: 'turn_error',
        threadId,
        turnId,
        data: { text: 'failed to send the prompt to claude (stdin unavailable)' },
      });
      child.kill();
      return Promise.resolve();
    }

    let full = '';
    // Deltas belonging to the current native assistant-message envelope. Claude
    // may emit several envelopes in one turn around tool use; reconciling each
    // envelope independently prevents a later non-streamed message from being
    // skipped merely because an earlier one streamed.
    let currentAssistantText = '';
    // Whether this turn already said the CLI runs in another mode than asked.
    let warnedMode = false;
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
    // Armed when the last background task of a held turn ends: the CLI is about
    // to wake the model, and the input must stay open for it — the wake-up may
    // start more background work, which the CLI only waits for while it can
    // still be written to. Cleared as soon as the wake-up shows; if none does,
    // it closes the input so the run can end.
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    const stopWaitingForWake = (): void => {
      if (wakeTimer !== undefined) clearTimeout(wakeTimer);
      wakeTimer = undefined;
    };
    // Whether any `result` arrived at all: a CLI that exits without one did
    // not answer, however cleanly it exited.
    let sawResult = false;
    // Background tasks the CLI killed on its way out. That work was started on
    // the user's behalf and did NOT finish — staying silent about it is what
    // let the phone report a clean success over lost work. Only a task that
    // ends BECAUSE the run is ending counts: one that failed on its own, or
    // that the model stopped while the run went on, is an outcome the model
    // was told about, not an interruption.
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
      run.finished = true;
      stopWaitingForWake();
      // No more follow-ups can join this turn, and the CLI is still waiting on
      // the pipe — close it so the process can exit.
      endInput();
      if (interruptedTasks > 0) {
        // Say it in the turn itself. The CLI stops what is still running once
        // its input closes, so this is a real, silent loss the user would
        // otherwise never learn about.
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
      // The wake-up turn has begun (it opens with an `init`, then the model's
      // output): its own `result` decides whether the turn is over.
      if (wakeTimer !== undefined && event.kind !== 'other' && event.kind !== 'task_ended') {
        stopWaitingForWake();
      }
      // Lines carrying `parent_tool_use_id` belong to a parallel SUBAGENT turn:
      // their tool blocks still feed the work log, but their text/usage must
      // never fold into the main message or close the main text run.
      const subagent = event.parentToolUseId !== undefined;
      if (event.sessionId) this.setNativeSession(threadId, event.sessionId);
      // The CLI's own word on which commands only work in its terminal.
      if (event.terminalCommands) this.#terminalCommands = event.terminalCommands;
      // Register tool invocations (with their inputs) so the result can pair.
      // Each one is shown as it starts, and its result replaces it in place.
      if (event.toolUses) {
        for (const tool of event.toolUses) {
          if (pendingTools.has(tool.id)) continue;
          pendingTools.set(tool.id, tool);
          const started = toolUseStartBlock(tool);
          if (started) {
            this.emit({
              type: 'block',
              threadId,
              turnId,
              data: {
                content: started,
                ...(openTextIndex !== undefined ? { beforeText: true } : {}),
              },
            });
          }
        }
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
          const settled = toolUseToBlock(tool, result);
          if (!settled) continue;
          const content = withBlockId(settled, tool.id);
          this.emit({
            type: 'block',
            threadId,
            turnId,
            data: {
              content,
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
      } else if (
        event.kind === 'init' &&
        event.permissionMode !== undefined &&
        event.permissionMode !== CLAUDE_REPORTED_MODE[accessMode] &&
        !warnedMode
      ) {
        // The CLI started in another mode than the one asked for — `auto` on a
        // model without Claude's reviewer (haiku) starts in `default`, which
        // declines anything needing approval. Say it in the turn, once.
        warnedMode = true;
        this.emit({
          type: 'block',
          threadId,
          turnId,
          data: {
            content: warningBlock(
              `Claude Code ran this turn in its "${event.permissionMode}" mode, not "${CLAUDE_REPORTED_MODE[accessMode]}"${accessMode === 'approveForMe' ? ' — automatic review is not available for this model' : ''}. Actions that needed approval were declined; choose another model or access mode.`,
            ),
          },
        });
      }
      if (event.kind === 'init' && event.model && !sawModel) {
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
      } else if (event.kind === 'replay' && event.uuid) {
        const onRead = unread.get(event.uuid);
        unread.delete(event.uuid);
        onRead?.(true);
      } else if (event.kind === 'result') {
        if (event.isError && sessionId && isMissingSession(event.errors)) {
          // The session this conversation continues is gone (its transcript
          // was deleted, or it belongs to another folder). Nothing ran yet:
          // run the same turn again in a fresh session rather than failing it.
          errored = true;
          run.finished = true;
          endInput();
          // The session to refuse is the one this run tried to resume — not the
          // fresh id the CLI announced on its way to failing.
          this.refuseNativeSession(threadId, sessionId);
          child.on('close', () => void this.sendTurn(options));
        } else if (event.isError) {
          errored = true;
          run.finished = true;
          endInput();
          const reason =
            event.text && event.text.length > 0 ? event.text : event.errors?.join('\n');
          this.emit({
            type: 'turn_error',
            threadId,
            turnId,
            data: { text: reason && reason.length > 0 ? reason : 'claude error' },
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
          sawResult = true;
          if (unread.size > 0) {
            // The CLI answered something that is not (all of) ours: a wake-up
            // it ran on its own, or the model turn a steer arrived too late to
            // join. Our message is still to be read and answered — this turn
            // goes on, and its own `result` ends it.
          } else if (liveBackgroundTasks.size > 0) {
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
        // While the input is open the CLI waits for background work however
        // long it takes, so a task `stopped` then was ended on purpose (the
        // model or the user did it). After it closes, the CLI is the one
        // ending it.
        if (event.taskStatus === 'stopped' && inputClosed) interruptedTasks += 1;
        // Deliberately NOT completing here even when the last task resolves: a
        // task ending is exactly when the CLI wakes the model, and the wake-up
        // turn's own `result` decides — complete if nothing is left running, or
        // stay held if the wake-up started more background work.
        //
        // Nor closing the input. It once was, to let the CLI exit, and that cut
        // every wake-up after the first: the CLI only waits for background work
        // while its input is open, so work the wake-up started was stopped
        // ~5 s later and the model never came back to report it. The input
        // closes when the turn completes; it closes here only if no wake-up
        // shows within the grace period, so a CLI that does not wake cannot
        // hang the turn.
        if (
          deferredCompletion &&
          liveBackgroundTasks.size === 0 &&
          !inputClosed &&
          wakeTimer === undefined
        ) {
          wakeTimer = setTimeout(() => {
            wakeTimer = undefined;
            endInput();
          }, this.#wakeGraceMs);
        }
      }
    });

    child.on('error', (err) => {
      stopWaitingForWake();
      reader.close();
      returnUnreadFollowUps();
      run.finished = true;
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

    child.on('close', (code) => {
      stopWaitingForWake();
      reader.close();
      // First, before any early return: a stopped turn must not leave a
      // delivery waiting on a read that will never come.
      returnUnreadFollowUps();
      run.finished = true;
      this.#active.delete(turnId);
      if (completed || errored) return;
      // `cancelTurn` already reported the turn as stopped.
      if (run.ending === 'cancelled') return;
      // A background task still open at exit was killed with the process, even
      // if its `task_notification` never arrived.
      interruptedTasks += liveBackgroundTasks.size;
      liveBackgroundTasks.clear();
      const failWith = (text: string): void => {
        errored = true;
        const detail = stderrTail.trim().split('\n').slice(-3).join('\n');
        this.emit({
          type: 'turn_error',
          threadId,
          turnId,
          data: { text: detail ? `${text}\n${detail}` : text },
        });
      };
      if (run.ending === 'stopping') {
        failWith('The bridge stopped while the agent was working; the turn did not finish.');
        return;
      }
      if (unread.size > 0) {
        // The prompt itself was never read: the CLI came down before it got
        // to it. The turn did not answer it — say so rather than pass off
        // whatever came before as its reply.
        failWith('Claude Code ended before it read the message.');
        return;
      }
      if (!sawResult) {
        failWith(
          code === 0
            ? 'Claude Code exited without answering.'
            : `Claude Code exited without answering (exit code ${code ?? 'unknown'}).`,
        );
        return;
      }
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
      // Every message was read and answered, and the CLI came down on its
      // own: complete with what it said.
      completeOnce({ ...pendingCompletion, text: full.length > 0 ? full : pendingCompletion.text });
    });

    return Promise.resolve();
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const run = this.#active.get(turnId);
    if (run) {
      run.finished = true;
      run.ending = 'cancelled';
      run.child.kill();
      this.#active.delete(turnId);
      this.emit({ type: 'turn_aborted', threadId, turnId });
    }
    return Promise.resolve();
  }

  /**
   * Name a conversation with `haiku`, the cheapest tier — a side errand, not a
   * turn: a fresh one-shot with **no `--resume`**, so it neither joins the
   * thread's session nor shows up in its history — and with
   * `--no-session-persistence`, so it leaves no session in Claude's own
   * history either (verified against claude 2.1.283: no transcript is written).
   *
   * Text in, text out (`--output-format text`): there is nothing to stream, and
   * parsing one line beats decoding a JSON event stream for it.
   */
  async generateTitle(options: GenerateTitleOptions): Promise<string | undefined> {
    const prompt = buildTitlePrompt(options.userText, options.assistantText);
    const args = [
      '-p',
      '--no-session-persistence',
      '--output-format',
      'text',
      '--model',
      TITLE_MODEL,
      prompt,
    ];
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
   * Write a follow-up into the turn `activeTurnId` is already running. Claude
   * Code reads it off the open stdin stream and takes it at the next tool
   * boundary, inside the same turn — no second process, no second `--resume`.
   *
   * Returns false rather than throwing for every ordinary "too late": the turn
   * is unknown to this adapter, it has already emitted its terminal event, or
   * the pipe closed underneath us. The manager then simply leaves the message
   * queued.
   */
  steerTurn(options: SendTurnOptions & { activeTurnId: string }): Promise<boolean> {
    const run = this.#active.get(options.activeTurnId);
    // `finished` matters as much as the map lookup: between `result` and the
    // process actually closing, the CLI would read a late write as a NEW turn
    // and stream a second reply into a turn the bridge has already closed.
    if (!run || run.finished) return Promise.resolve(false);
    if (run.threadId !== options.threadId) return Promise.resolve(false);
    return run.send(options.text);
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

    // The same `--effort` levels on every model that takes one.
    return Promise.resolve(
      [...aliasModels, ...pinnedModels].map((model) =>
        claudeTakesEffort(model.id) ? { ...model, options: [CLAUDE_REASONING_OPTION] } : model,
      ),
    );
  }

  /**
   * The commands Claude Code has in [cwd], as the CLI itself lists them: a
   * stream-json `initialize` control request answers with every command it
   * knows there — built-ins, custom commands (`.claude/commands`, project and
   * user), skills and plugins — with descriptions and argument hints, without
   * running a turn or spending a token (verified on claude 2.1.282). Left out:
   * what only its terminal runs (its own `terminal_slash_commands`) and what
   * the bridge owns ({@link CLAUDE_BRIDGE_OWNED_COMMANDS}). A picked command
   * is sent as `/name args`, which Claude expands natively against the
   * thread's `--resume` session — no {@link expandCommand}. Reused per folder
   * for a minute; an unanswered request yields no commands.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const cached = this.#commandsByCwd.get(dir);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
    const reported = await this.#askCommands(dir);
    const hidden = new Set([...this.#terminalCommands, ...CLAUDE_BRIDGE_OWNED_COMMANDS]);
    const commands: AgentCommand[] = [];
    const seen = new Set<string>();
    for (const raw of reported) {
      const name = raw.name.replace(/^\//, '');
      if (!name || name.startsWith('_') || hidden.has(name) || seen.has(name)) continue;
      // A retired built-in says so in its description ("(removed) …").
      if (raw.description?.startsWith('(removed)')) continue;
      seen.add(name);
      commands.push({
        name,
        ...(raw.description ? { description: raw.description } : {}),
        ...(raw.argumentHint ? { argumentHint: raw.argumentHint } : {}),
        source: raw.builtin ? 'builtin' : 'custom',
        headlessSupported: true,
      });
    }
    if (reported.length > 0) this.#commandsByCwd.set(dir, { at: Date.now(), commands });
    return commands;
  }

  /** Ask the CLI in [cwd] for its commands (`initialize`); [] if it will not say. */
  #askCommands(cwd: string): Promise<ClaudeReportedCommand[]> {
    return new Promise((resolve) => {
      const args = [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
      ];
      let child: SpawnedProcess;
      try {
        child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, {
          stdin: 'pipe',
        });
      } catch {
        resolve([]);
        return;
      }
      let settled = false;
      const finish = (commands: ClaudeReportedCommand[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        resolve(commands);
      };
      const timer = setTimeout(() => finish([]), COMMANDS_TIMEOUT_MS);
      const reader = createInterface({ input: child.stdout });
      reader.on('line', (line) => {
        const commands = parseInitializeCommands(line);
        if (commands) finish(commands);
      });
      child.on('close', () => finish([]));
      child.on('error', () => finish([]));
      child.stdin?.write(
        `${JSON.stringify({ type: 'control_request', request_id: 'uxnan-commands', request: { subtype: 'initialize' } })}\n`,
      );
    });
  }
}

/** One command as `initialize` reports it. */
interface ClaudeReportedCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  builtin?: boolean;
}

/**
 * The commands in a stream-json `control_response` to `initialize`, or
 * `undefined` for any other line.
 */
export function parseInitializeCommands(line: string): ClaudeReportedCommand[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed['type'] !== 'control_response') return undefined;
  const outer = parsed['response'];
  const inner = isRecord(outer) && isRecord(outer['response']) ? outer['response'] : outer;
  if (!isRecord(inner) || !Array.isArray(inner['commands'])) return [];
  const commands: ClaudeReportedCommand[] = [];
  for (const c of inner['commands']) {
    if (!isRecord(c) || typeof c['name'] !== 'string') continue;
    commands.push({
      name: c['name'],
      ...(typeof c['description'] === 'string' ? { description: c['description'] } : {}),
      ...(typeof c['argumentHint'] === 'string' ? { argumentHint: c['argumentHint'] } : {}),
      ...(c['builtin'] === true ? { builtin: true } : {}),
    });
  }
  return commands;
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
