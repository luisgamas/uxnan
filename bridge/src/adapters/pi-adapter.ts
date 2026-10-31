/**
 * pi adapter (`@earendil-works/pi-coding-agent`, the `pi` CLI — real agent).
 *
 * pi does NOT speak the generic bridge agent IPC. The bridge keeps ONE resident
 * `pi --mode rpc` process per thread and drives it over JSON-RPC-style commands
 * on stdin (`prompt`, `steer`, `get_state`), reading its newline-JSON event
 * stream on stdout. Validated live against `pi` 1.2.0.
 *
 * Process shape (spawned on a thread's first turn, reused by the next ones):
 *   pi --mode rpc [--tools read,grep,find,ls | --approve] [--model <id>]
 *      [--thinking <level>] [--session-id <id>] [-e <pi-desktop-extension.js>]
 *
 * `-e` loads tools from the run's MCP server list (see {@link piMcpLaunch});
 * the bridge extension uses per-run credentials and does not write pi's
 * user-global MCP configuration.
 *
 * Why `--mode rpc` and not `-p --mode json`: print mode reads ALL of stdin as the
 * initial prompt and has no input channel while it works; RPC mode leaves stdin
 * open, which is what lets a follow-up `steer` a running turn — and, kept open
 * across turns, what makes the process resident: the next `prompt` goes to the
 * same process, with the session already in memory, instead of a fresh CLI
 * re-initializing Node and re-reading the session JSONL from disk on every turn.
 *
 * Session continuity — read this before touching `--session-id`. RPC mode emits
 * **no** `session` event (print mode `-p --mode json` does, which is how the id
 * used to be captured — and why, after the move to RPC, no id was captured at
 * all and every turn started a new session). The id is asked for instead: the
 * adapter sends `get_state` right after spawning and reads `sessionId` (and the
 * model's `contextWindow`) from its response. Later spawns for the same thread
 * (a recycle after a cwd / model / effort / posture change, or after the idle
 * teardown) pass `--session-id <id>`, which resumes the session — "creating it
 * if missing" (`pi --help`), so a stale id degrades to a fresh session, never a
 * failed turn.
 *
 * The process is torn down after {@link DEFAULT_PI_IDLE_TIMEOUT_MS} without a
 * turn, when a spawn parameter changes, on cancel, and when the thread is
 * archived or deleted. Cancelling kills the process rather than sending `abort`
 * — the next turn resumes the session on a new one, and a kill is the only
 * cancel that cannot leave a half-aborted turn streaming into the next.
 *
 * Captured `--mode rpc` event shapes (one JSON object per line):
 *   { "type":"response", "command":"get_state", "success":true,
 *       "data":{ "sessionId":"019…", "sessionFile":"…", "model":{ "contextWindow":200000, … }, … } }
 *   { "type":"response", "command":"prompt", "success":true, "data":{ "disposition":"started" } }
 *   { "type":"message_update", "assistantMessageEvent":{ "type":"text_delta", "delta":"…" } }
 *   { "type":"message_end", "message":{ "role":"assistant", "content":[{ "type":"text","text":"…" }],
 *       "usage":{ "input":…, "output":…, "cacheRead":…, "totalTokens":… },
 *       "stopReason":"stop"|"error", "errorMessage"?:"…" } }
 *   { "type":"agent_end", "messages":[…], "willRetry":false }
 *   { "type":"agent_settled" }
 * (`thinking_*` assistant events carry the model's reasoning and are NOT emitted
 * as answer text.) A startup failure (e.g. a provider with no API key) prints a
 * plain-text line instead of JSON; we surface that as the turn error.
 *
 * A turn ends on **`agent_settled`**, not on `agent_end`. `agent_end` is the end
 * of one agent *run*, and pi retries a run on its own: a retryable provider
 * error (a 5xx, a rate limit) ends the run with `willRetry: true` and starts
 * another after a backoff, so a prompt written after that `agent_end` is
 * refused with "Agent is already processing". `agent_settled` is pi's own
 * "idle" signal — the one its harness waits on — and it follows the run that
 * really was the last. A rejected `prompt` (`response … success:false`) still
 * ends the turn at once: no run started, so nothing else will arrive.
 *
 * A `prompt` answered with `data.disposition: "handled"` (pi 1.2.0: a typed
 * command the CLI resolved itself, such as `/mcp`) starts no run either, so it
 * ends the turn at that response. `started` and `queued` leave the turn open.
 * Older pi sends no disposition, and its turns end as before.
 *
 * Stdout is split into records on `\n` alone (`json-lines.ts`): pi's RPC
 * framing, not Node's `readline`, which also breaks on U+2028/U+2029.
 *
 * See bridge/FOR-DEV.md (agent adapters) and bridge/docs/agents.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { onLines } from '../json-lines.js';
import { fileURLToPath } from 'node:url';
import {
  encodeCwdHeader,
  type AgentCapabilities,
  type AgentCommand,
  type AgentConfig,
  type AgentId,
  type AgentModel,
  type AgentModelOption,
  type CompactionReason,
  type AgentMcpServer,
  type GenerateTitleOptions,
  type NativeSessionInfo,
  type SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { piImages } from './turn-input.js';
import { listPiSessions } from './native-sessions.js';
import { buildTitlePrompt, runTitleOneShot, sanitizeTitle } from '../agents/thread-title.js';
import { piResultText, piToolBlock, piToolStartBlock, type PiToolUse } from './pi-tools.js';
import { effortValues, reasoningOption, reasoningValue } from './run-options.js';
import { assistantResponseBoundaryBlock, compactionBlock, withBlockId } from './content-blocks.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/**
 * How long a thread's resident `pi` process may sit without a turn before it is
 * torn down (24 hours). Every completed turn re-arms the countdown. A later turn
 * spawns a new process on the same `--session-id`, so the timeout costs the user
 * one cold start, never any history.
 */
export const DEFAULT_PI_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** The extension that registers the run's MCP tools (compiled beside this file). */
export const PI_MCP_EXTENSION = fileURLToPath(
  new URL('./pi-desktop-extension.js', import.meta.url),
);

/**
 * How a pi process is handed its MCP server list: the extension on `-e`, and
 * the endpoint, token and folder in its environment — never argv or a file.
 * `key` tells a resident process whether its server list changed.
 */
export function piMcpLaunch(
  servers: AgentMcpServer[] | undefined,
  cwd: string,
): { args: string[]; env: Record<string, string>; key: string } {
  if (!servers?.length) return { args: [], env: {}, key: '' };
  return {
    args: ['-e', PI_MCP_EXTENSION],
    env: {
      UXNAN_MCP_SERVERS: JSON.stringify(servers),
      UXNAN_THREAD_CWD: encodeCwdHeader(cwd),
    },
    key: createHash('sha256')
      .update(JSON.stringify(servers.map((s) => [s.name, s.url, s.token])))
      .digest('hex')
      .slice(0, 16),
  };
}

/** Hard cap on the `get_available_models` ask before giving up. */
const MODEL_LIST_TIMEOUT_MS = 8000;

/** How long a folder's command list is reused before pi is asked again. */
const COMMANDS_TTL_MS = 60_000;

/** How long a `get_commands` answer may take. */
const COMMANDS_TIMEOUT_MS = 10_000;

/**
 * The tool posture as `pi` flags: read-only tools, pi's defaults, or pi's
 * defaults plus `--approve` — which also decides whether pi trusts the
 * project's own files (its `.pi` prompts, `.agents/skills`, settings and
 * extensions; see `docs/security.md` → *Project Trust*). A turn and a command
 * listing take the same flags, so what is listed is what a turn can run.
 */
export function piPostureArgs(permissionMode: PiPermissionMode): string[] {
  if (permissionMode === 'default') return ['--tools', 'read,grep,find,ls'];
  if (permissionMode === 'bypassPermissions') return ['--approve'];
  return [];
}

/** One command as pi's `get_commands` reports it. */
export interface PiReportedCommand {
  name: string;
  description?: string;
  source: string;
}

/**
 * The commands in a `get_commands` response line, or `undefined` for any other
 * line (pi 0.85.1: `{ type: "response", command: "get_commands", success,
 * data: { commands: [{ name, description?, source, location?, path? }] } }`).
 */
export function parsePiCommands(line: string): PiReportedCommand[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed['type'] !== 'response' || parsed['command'] !== 'get_commands') {
    return undefined;
  }
  const data = parsed['data'];
  if (parsed['success'] !== true || !isRecord(data) || !Array.isArray(data['commands'])) return [];
  const commands: PiReportedCommand[] = [];
  for (const c of data['commands']) {
    if (!isRecord(c) || typeof c['name'] !== 'string' || typeof c['source'] !== 'string') continue;
    commands.push({
      name: c['name'],
      source: c['source'],
      ...(typeof c['description'] === 'string' ? { description: c['description'] } : {}),
    });
  }
  return commands;
}

/**
 * What the bridge advertises of pi's commands. Prompt templates (`custom`) and
 * skills (`skill`, named `skill:<name>` — the form pi expects after the `/`)
 * run headless: pi expands them from the `prompt` command. Extension commands
 * are left out: they exist to drive pi's TUI, and one that opens a dialog
 * (`select`, `confirm`, `input`) is declined at once on this surface (see the
 * resident process's `dialog` handling), so it could not do its job. pi's TUI
 * built-ins are never in the list (rpc.md).
 */
export function piAgentCommands(reported: PiReportedCommand[]): AgentCommand[] {
  const commands: AgentCommand[] = [];
  const seen = new Set<string>();
  for (const c of reported) {
    if (c.source !== 'prompt' && c.source !== 'skill') continue;
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    commands.push({
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      source: c.source === 'skill' ? 'skill' : 'custom',
      headlessSupported: true,
    });
  }
  return commands;
}

const PI_CAPABILITIES: AgentCapabilities = {
  // No access modes: pi has no approval system (plan mode is an extension,
  // not core), so it runs in its configured posture and shows no selector.
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
  // Prompt templates and skills, as pi lists them (`get_commands`).
  commands: true,
  // pi's RPC protocol has a first-class `steer` command, drained by the agent
  // loop at its next boundary — so a follow-up joins the running turn instead
  // of waiting for it. This is why the adapter runs `--mode rpc` rather than
  // `-p --mode json`: print mode reads ALL of stdin as the initial prompt, so
  // it has no input channel while it works.
  steering: true,
};

/** Reasoning-effort levels pi's `--thinking` flag accepts (verified via `pi --help`, 0.85). */
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** pi's built-in thinking level when its settings name none (`DEFAULT_THINKING_LEVEL`). */
const PI_DEFAULT_THINKING = 'medium';

/**
 * How pi picks a model's thinking level when none is passed, from its own
 * `settings.json` (in `$PI_CODING_AGENT_DIR`, else `~/.pi/agent`): the level
 * saved for that model (`modelThinkingLevels["provider/model"]`), then
 * `defaultThinkingLevel`, then `medium` — the order pi's model resolver uses.
 */
export interface PiThinkingDefaults {
  byModel: Record<string, string>;
  fallback: string;
}

/** pi's own folder — settings and sessions: `$PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['PI_CODING_AGENT_DIR'] || join(homedir(), '.pi', 'agent');
}

/** pi's thinking defaults as its settings file states them. */
export function readPiThinkingDefaults(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf-8'),
): PiThinkingDefaults {
  const dir = piAgentDir(env);
  try {
    const settings = JSON.parse(readFile(join(dir, 'settings.json'))) as Record<string, unknown>;
    const levels = new Set<string>(PI_THINKING_LEVELS);
    const byModel: Record<string, string> = {};
    const saved = settings['modelThinkingLevels'];
    if (saved && typeof saved === 'object') {
      for (const [model, level] of Object.entries(saved as Record<string, unknown>)) {
        if (typeof level === 'string' && levels.has(level)) byModel[model] = level;
      }
    }
    const fallback = settings['defaultThinkingLevel'];
    return {
      byModel,
      fallback:
        typeof fallback === 'string' && levels.has(fallback) ? fallback : PI_DEFAULT_THINKING,
    };
  } catch {
    return { byModel: {}, fallback: PI_DEFAULT_THINKING };
  }
}

/**
 * The `reasoning` knob of a pi model that thinks: the levels it accepts, with
 * the level it runs at by default.
 */
function piReasoningOption(levels: string[], defaultLevel: string): AgentModelOption {
  return reasoningOption(effortValues(levels), defaultLevel);
}

/**
 * Tool posture passed to pi:
 *  - `default`           → `--tools read,grep,find,ls` (read-only; no bash/edit/write);
 *  - `acceptEdits`       → pi's default built-in tools (read/bash/edit/write);
 *  - `bypassPermissions` → default tools + `--approve` (trust project-local files).
 */
export type PiPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface PiAdapterOptions {
  /** pi's own folder, where its sessions are listed from (tests); {@link piAgentDir} by default. */
  agentDir?: string;
  /** Executable to spawn (found by `locateAgent`, `agents/agent-installs.ts`). */
  binaryPath?: string;
  /** Args prepended before the adapter args (e.g. `[cli.js]` when running via node). */
  prependArgs?: string[];
  /** Default model (`provider/model`) when the thread/turn doesn't pick one. */
  defaultModel?: string;
  /** Tool posture (default `acceptEdits`). */
  permissionMode?: PiPermissionMode;
  /** Injected spawn function (tests). */
  spawnFn?: SpawnFn;
  /**
   * Idle time after which a thread's resident `pi` process is torn down
   * (default {@link DEFAULT_PI_IDLE_TIMEOUT_MS}, 24 hours).
   */
  idleTimeoutMs?: number;
}

/** The turn currently running on a resident process (at most one per thread). */
interface ActiveTurn {
  turnId: string;
  /** Everything streamed as answer text (deltas + any unseen final text). */
  full: string;
  /** The current assistant message's streamed text, reset at each `message_end`. */
  currentAssistantText: string;
  /** The last assistant message's full text (fallback when nothing streamed). */
  finalText: string;
  /** Context-occupying tokens from the last `message_end`, for `usage`. */
  tokens?: number;
  errored: boolean;
  errorMsg?: string;
  /** toolCallId → its invocation (args), until the matching execution_end pairs. */
  pendingTools: Map<string, PiToolUse>;
  /** Non-JSON output (e.g. a startup "No API key found") — surfaced if no content. */
  plainLines: string[];
  /**
   * True once the turn emitted its terminal event. Nothing may be written into
   * it after that: pi would run a follow-up as a NEW turn, streaming a second
   * reply into a turn the bridge already closed.
   */
  completed: boolean;
  finish: () => void;
}

/** A thread's resident `pi` process and the parameters it was spawned with. */
interface ActiveSession {
  child: SpawnedProcess;
  threadId: string;
  /** pi's session id, from `get_state`; undefined until the response arrives. */
  sessionId?: string;
  /** The model's context window as `get_state` reports it, for `usage`. */
  contextWindow?: number;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: PiPermissionMode;
  /** Which MCP server list the process was started with (`piMcpLaunch`). */
  mcpKey: string;
  idleTimer?: NodeJS.Timeout;
  activeTurn?: ActiveTurn;
  exited: boolean;
  /** Write one RPC command as a JSON line. False when the pipe is gone. */
  send: (command: Record<string, unknown>) => boolean;
  /**
   * `steer` commands waiting for pi's answer, oldest first. pi acknowledges
   * every RPC command in order (`{type:'response', command, success}`,
   * verified against pi 0.85.1: a steer is answered in ~20 ms, running or
   * idle); only its answer says whether the message landed.
   */
  steerAcks: ((accepted: boolean) => void)[];
}

/** A normalized pi event extracted from one RPC/`--mode json` line. */
export interface PiEvent {
  kind: /** `-p --mode json` only: RPC mode never emits it (see the header). */
    | 'session'
    /** RPC `get_state` answered: the session id + the model's context window. */
    | 'state'
    | 'compaction'
    | 'delta'
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'final'
    /** `agent_end`: one agent run ended; `willRetry` says pi will run again. */
    | 'end'
    /** `agent_settled`: pi is idle — the turn is over. */
    | 'settled'
    /** A `prompt` answered `disposition: "handled"`: pi resolved it itself, no run starts. */
    | 'handled'
    /** An RPC command pi rejected (`{ type:'response', success:false }`). */
    | 'command_failed'
    /** An RPC `steer` pi accepted. */
    | 'steer_accepted'
    /** An extension asked the user something (`extension_ui_request`, a dialog). */
    | 'dialog'
    | 'other';
  /** `session` / `state`: the session id (for `--session-id` continuity). */
  sessionId?: string;
  /** Only set for `state`: the model's context window in tokens, if reported. */
  contextWindow?: number;
  /** Only set for `command_failed`: which RPC command was rejected. */
  commandName?: string;
  /** Only set for `dialog`: the request id its answer must carry. */
  dialogId?: string;
  /**
   * `delta`: the streamed text chunk. `thinking`: a reasoning chunk. `final`:
   * the assistant message's full text.
   */
  text?: string;
  /** Only set for `final`: context-occupying token count, if reported. */
  tokens?: number;
  /** Only set for `final`: whether the assistant message ended in error. */
  isError?: boolean;
  /** Only set for `end`: pi will retry the run itself, so the turn goes on. */
  willRetry?: boolean;
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

/** Parse one `pi --mode rpc` (or `-p --mode json`) line, or null if it isn't JSON. */
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
      return { kind: 'end', willRetry: parsed['willRetry'] === true };
    case 'agent_settled':
      return { kind: 'settled' };
    // An extension's dialog (`select`, `confirm`, `input`, `editor`) blocks the
    // turn until a client answers it (rpc.md → Extension UI). The other
    // extension UI methods are fire-and-forget.
    case 'extension_ui_request': {
      const method = parsed['method'];
      const id = parsed['id'];
      const dialog =
        method === 'select' || method === 'confirm' || method === 'input' || method === 'editor';
      return dialog && typeof id === 'string'
        ? { kind: 'dialog', dialogId: id }
        : { kind: 'other' };
    }
    // RPC-mode command acknowledgements. A success is noise, but a FAILED one
    // is the only signal that a command never took effect — a rejected `prompt`
    // would otherwise leave the turn waiting for events that never come.
    case 'response': {
      if (parsed['success'] !== false) {
        if (parsed['command'] === 'steer') return { kind: 'steer_accepted' };
        if (parsed['command'] === 'prompt' && isRecord(parsed['data'])) {
          if (parsed['data']['disposition'] === 'handled') return { kind: 'handled' };
        }
        if (parsed['command'] !== 'get_state') return { kind: 'other' };
        const data = isRecord(parsed['data']) ? parsed['data'] : undefined;
        const sessionId = typeof data?.['sessionId'] === 'string' ? data['sessionId'] : undefined;
        const model = data && isRecord(data['model']) ? data['model'] : undefined;
        const window = model?.['contextWindow'];
        return {
          kind: 'state',
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(typeof window === 'number' && window > 0
            ? { contextWindow: Math.round(window) }
            : {}),
        };
      }
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
 * The thinking levels a pi model accepts, by pi's own rule
 * (`getSupportedThinkingLevels` in pi-ai): the five standard levels
 * (`off` … `high`) unless the model's `thinkingLevelMap` maps one to `null`;
 * `xhigh` and `max` only when the map names them with a value. A model with no
 * map (an older pi) takes the five standard levels.
 */
export function piSupportedThinkingLevels(
  thinkingLevelMap: Record<string, unknown> | undefined,
): string[] {
  return PI_THINKING_LEVELS.filter((level) => {
    const mapped = thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}

/**
 * `level` when the model accepts it; otherwise the nearest level above it that
 * it accepts, then the nearest below, as pi's `clampThinkingLevel` picks one.
 */
function clampPiThinkingLevel(supported: string[], level: string): string {
  if (supported.includes(level)) return level;
  const at = PI_THINKING_LEVELS.indexOf(level as (typeof PI_THINKING_LEVELS)[number]);
  if (at === -1) return supported[0] ?? 'off';
  const above = PI_THINKING_LEVELS.slice(at).find((l) => supported.includes(l));
  const below = PI_THINKING_LEVELS.slice(0, at)
    .reverse()
    .find((l) => supported.includes(l));
  return above ?? below ?? supported[0] ?? 'off';
}

/**
 * The models in a `get_available_models` response line, or `undefined` for any
 * other line (pi 1.2.0: `{ type:"response", command:"get_available_models",
 * success, data:{ models:[{ id, name, provider, reasoning, contextWindow,
 * thinkingLevelMap? }] } }`). Only the providers the account can use are
 * listed. `id` is `provider/id` (the `--model` routing key), `name` is the
 * display name and `provider` the description; `contextWindow` is exact.
 *
 * A reasoning model advertises the reasoning knob with the levels
 * {@link piSupportedThinkingLevels} allows, defaulting to the level pi itself
 * would use (`thinking`, see {@link readPiThinkingDefaults}) clamped to one of
 * those. A non-reasoning model has no knob.
 */
export function parsePiModels(
  line: string,
  defaultModel?: string,
  thinking: PiThinkingDefaults = { byModel: {}, fallback: PI_DEFAULT_THINKING },
): AgentModel[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed['type'] !== 'response' ||
    parsed['command'] !== 'get_available_models'
  ) {
    return undefined;
  }
  const data = parsed['data'];
  if (parsed['success'] !== true || !isRecord(data) || !Array.isArray(data['models'])) return [];
  const models: AgentModel[] = [];
  for (const entry of data['models']) {
    if (!isRecord(entry)) continue;
    const provider = entry['provider'];
    const modelId = entry['id'];
    if (typeof provider !== 'string' || typeof modelId !== 'string') continue;
    const name = entry['name'];
    const id = `${provider}/${modelId}`;
    const map = entry['thinkingLevelMap'];
    const levels =
      entry['reasoning'] === true ? piSupportedThinkingLevels(isRecord(map) ? map : undefined) : [];
    const windowTokens = entry['contextWindow'];
    models.push({
      id,
      displayName: typeof name === 'string' && name.length > 0 ? name : modelId,
      description: provider,
      isDefault: id === defaultModel,
      ...(levels.length > 0
        ? {
            options: [
              piReasoningOption(
                levels,
                clampPiThinkingLevel(levels, thinking.byModel[id] ?? thinking.fallback),
              ),
            ],
          }
        : {}),
      ...(typeof windowTokens === 'number' && windowTokens > 0
        ? { contextWindow: Math.round(windowTokens) }
        : {}),
    });
  }
  return models;
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
  readonly #agentDir: string;
  /** threadId → the thread's resident process, while one is alive. */
  readonly #sessions = new Map<string, ActiveSession>();
  /** model id → context-window tokens, cached from `get_available_models` for `usage`. */
  readonly #contextWindowByModel = new Map<string, number>();
  /** The folder's command list, briefly reused (see listCommands). */
  readonly #commandsByCwd = new Map<string, { at: number; commands: AgentCommand[] }>();
  /** Agent-wide folder, home: model catalogs and every other agent-wide work
   *  run here, so a renamed or deleted project folder cannot break them. A
   *  turn carries its own `cwd` and never writes this. */
  #defaultCwd = homedir();

  /**
   * The directory a turn without its own `cwd` runs in — where the bridge must
   * place per-turn attachment files so this CLI can open them (see
   * `agents/attachments.ts`).
   */
  defaultCwd(): string {
    return this.#defaultCwd;
  }

  /**
   * pi takes images inline: its RPC `prompt` and `steer` carry an `images`
   * list beside the message, which it hands the model after the text, in the
   * order of their labels (`piImages`).
   */
  takesInlineImages(): boolean {
    return true;
  }

  /** The configured idle timeout (observability + tests). */
  get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  /** Whether a resident process is alive for the thread (observability + tests). */
  hasActiveSession(threadId: string): boolean {
    const session = this.#sessions.get(threadId);
    return Boolean(session && !session.exited);
  }

  /** pi's sessions in a folder, from its own session store (`native-sessions.ts`). */
  listNativeSessions(cwd: string): Promise<NativeSessionInfo[]> {
    return listPiSessions(this.#agentDir, cwd);
  }

  constructor(options: PiAdapterOptions = {}) {
    super();
    this.#binaryPath = options.binaryPath ?? 'pi';
    this.#prependArgs = options.prependArgs ?? [];
    this.#agentDir = options.agentDir ?? piAgentDir();
    this.#defaultModel = options.defaultModel;
    this.#permissionMode = options.permissionMode ?? 'acceptEdits';
    this.#spawn = options.spawnFn ?? defaultSpawn;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_PI_IDLE_TIMEOUT_MS;
  }

  get defaultModel(): string | undefined {
    return this.#defaultModel;
  }

  start(_config: AgentConfig): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const threadId of Array.from(this.#sessions.keys())) {
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * Tear down the thread's resident process now (the thread was archived or
   * deleted). The session id is kept: an unarchived thread's next turn resumes
   * the same session on a fresh process.
   */
  closeSession(threadId: string): Promise<void> {
    this.#teardownSession(threadId);
    return Promise.resolve();
  }

  /** (Re)arm the idle countdown after a turn ended. */
  #scheduleIdleTeardown(session: ActiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.#teardownSession(session.threadId);
    }, this.#idleTimeoutMs);
    // A pending countdown must never keep the daemon alive on shutdown.
    session.idleTimer.unref();
  }

  /**
   * Kill the thread's process and forget it. A turn still running on it is
   * marked completed WITHOUT a terminal event — every caller emits its own
   * (`turn_aborted` on cancel; a recycle only happens between turns). Ending
   * stdin first is what tells pi no more commands are coming (its rpc mode
   * exits on stdin end); the kill covers a process that does not.
   */
  #teardownSession(threadId: string): void {
    const session = this.#sessions.get(threadId);
    if (!session) return;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.activeTurn) session.activeTurn.completed = true;
    this.#sessions.delete(threadId);
    session.exited = true;
    try {
      session.child.stdin?.end();
      session.child.kill();
    } catch {
      /* already gone */
    }
  }

  /**
   * The thread's resident process, spawning one when there is none or when the
   * live one was started with a different cwd / model / effort / posture /
   * MCP server list — those are process arguments, so honouring a change
   * means a new process. The new one resumes the same session via
   * `--session-id`.
   */
  #getOrCreateSession(
    threadId: string,
    cwd: string,
    model: string | undefined,
    effort: string | undefined,
    permissionMode: PiPermissionMode,
    mcpServers: AgentMcpServer[] | undefined,
  ): ActiveSession {
    const mcpLaunch = piMcpLaunch(mcpServers, cwd);
    const existing = this.#sessions.get(threadId);
    if (
      existing &&
      !existing.exited &&
      existing.cwd === cwd &&
      existing.model === model &&
      existing.effort === effort &&
      existing.permissionMode === permissionMode &&
      existing.mcpKey === mcpLaunch.key
    ) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }

    if (existing) this.#teardownSession(threadId);

    // Resume the session pi announced on this thread's first `get_state`; on the
    // very first spawn there is none yet and pi creates one.
    const sessionId = this.nativeSessionId(threadId);
    const args = ['--mode', 'rpc', ...piPostureArgs(permissionMode)];
    if (model) args.push('--model', model);
    // Reasoning effort → pi's `--thinking <off|minimal|low|medium|high|xhigh|max>`.
    if (effort) args.push('--thinking', effort);
    if (sessionId) args.push('--session-id', sessionId);
    args.push(...mcpLaunch.args);

    const child = this.#spawn(this.#binaryPath, [...this.#prependArgs, ...args], cwd, {
      stdin: 'pipe',
      ...(mcpLaunch.key ? { env: mcpLaunch.env } : {}),
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
      mcpKey: mcpLaunch.key,
      exited: false,
      send,
      steerAcks: [],
    };

    onLines(child.stdout, (line) => {
      const event = parsePiLine(line);
      if (!event) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && session.activeTurn && !session.activeTurn.completed) {
          session.activeTurn.plainLines.push(trimmed);
        }
        return;
      }
      // Nobody on the bridge's surface can answer an extension's dialog, and
      // an unanswered one never lets the turn end: decline it at once — the
      // answer pi takes for a dismissed dialog (`cancelled: true`).
      if (event.kind === 'dialog' && event.dialogId) {
        send({ type: 'extension_ui_response', id: event.dialogId, cancelled: true });
        return;
      }
      // A steer's answer settles the offer, whatever the turn is doing.
      if (event.kind === 'steer_accepted') {
        session.steerAcks.shift()?.(true);
        return;
      }
      if (event.kind === 'command_failed' && event.commandName === 'steer') {
        session.steerAcks.shift()?.(false);
        return;
      }
      if (event.kind === 'state' || event.kind === 'session') {
        if (event.sessionId) {
          session.sessionId = event.sessionId;
          this.setNativeSession(threadId, event.sessionId);
        }
        if (event.contextWindow !== undefined) session.contextWindow = event.contextWindow;
        return;
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
        this.emit({
          type: 'thinking',
          threadId,
          turnId: active.turnId,
          data: { text: event.text },
        });
      } else if (event.kind === 'tool_start' && event.tool) {
        active.pendingTools.set(event.toolCallId ?? '', event.tool);
        // Shown as it starts; its end replaces it in place.
        const started = piToolStartBlock(event.tool);
        if (started) {
          this.emit({ type: 'block', threadId, turnId: active.turnId, data: { content: started } });
        }
      } else if (event.kind === 'tool_end') {
        const tool = active.pendingTools.get(event.toolCallId ?? '');
        if (tool) {
          active.pendingTools.delete(event.toolCallId ?? '');
          this.emit({
            type: 'block',
            threadId,
            turnId: active.turnId,
            data: {
              content: withBlockId(
                piToolBlock(tool, event.toolOutput ?? '', event.toolIsError === true),
                tool.id,
              ),
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
        // Only a rejected `prompt` ends the turn: it means the agent never
        // started, so nothing else will arrive. A rejected `steer` is a
        // follow-up that did not land — the turn itself is fine, and the
        // manager already treats a `false` from `steerTurn` as "leave it
        // queued", so it must not take the turn down with it.
        if (event.commandName === 'prompt') {
          active.errored = true;
          active.errorMsg = event.errorText ?? 'pi rejected the prompt';
          active.finish();
        }
      } else if (event.kind === 'end') {
        // The run ended, but the turn only ends once pi settles (see the
        // header); a run pi will retry keeps the turn open with its state intact.
        return;
      } else if (event.kind === 'settled' || event.kind === 'handled') {
        // `handled` is a prompt pi resolved itself: no run starts, so there is
        // no `agent_settled` to wait for.
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

    // A process that is gone answers no steer: none of them landed.
    const dropSteerAcks = (): void => {
      for (const ack of session.steerAcks.splice(0)) ack(false);
    };
    child.on('error', (err: Error) => {
      session.exited = true;
      dropSteerAcks();
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
      dropSteerAcks();
      session.exited = true;
      this.#sessions.delete(threadId);
      const active = session.activeTurn;
      if (active && !active.completed) {
        active.finish();
      }
    });

    this.#sessions.set(threadId, session);
    // Ask for the session id now: pi answers commands in order, so the response
    // lands before the first prompt's events, and the id is known before any
    // recycle could need it.
    send({ type: 'get_state' });
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
      session = this.#getOrCreateSession(
        threadId,
        cwd,
        model,
        effort,
        permissionMode,
        options.mcpServers,
      );
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
        if (session.activeTurn?.turnId === turnId) session.activeTurn = undefined;
        if (!session.exited) this.#scheduleIdleTeardown(session);

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
        // The window pi reported for this very session wins; the model-list
        // cache covers a process that never answered `get_state`.
        const contextWindow =
          session.contextWindow ??
          (model !== undefined ? this.#contextWindowByModel.get(model) : undefined);
        const usage =
          activeTurn.tokens !== undefined
            ? {
                tokens: activeTurn.tokens,
                ...(contextWindow !== undefined ? { contextWindow } : {}),
              }
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

    if (!session.send({ type: 'prompt', message: text, ...piImagesField(options) })) {
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
    const model = this.#titleModel(options.model);
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
   * no cheap tier it announces and none to hard-code — a pinned id would break
   * the moment a user's provider set differs. The rule for an agent like this:
   * the conversation's own model, else the configured default, else nothing
   * (pi's own default).
   *
   * FOR-DEV: a titling model set in daemon config for this and the other
   * multi-provider CLIs — see FOR-DEV.md → *A configurable titling model*.
   */
  #titleModel(conversationModel: string | undefined): string | undefined {
    return conversationModel ?? this.#defaultModel;
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
    // Taken only once pi says so: a steer it rejects would otherwise pass as
    // delivered, the message handed off and never answered.
    return new Promise((resolve) => {
      session.steerAcks.push(resolve);
      if (!session.send({ type: 'steer', message: options.text, ...piImagesField(options) })) {
        session.steerAcks.pop();
        resolve(false);
      }
    });
  }

  /**
   * Cancel = kill the process (see the header): the next turn resumes the
   * session on a new one.
   */
  cancelTurn(threadId: string, turnId: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    if (session && session.activeTurn?.turnId === turnId) {
      session.activeTurn.completed = true;
      session.activeTurn = undefined;
      this.emit({ type: 'turn_aborted', threadId, turnId });
      this.#teardownSession(threadId);
    }
    return Promise.resolve();
  }

  /**
   * List the models pi reports via its `get_available_models` RPC command
   * (account-aware: only providers the user has configured appear), asked of a
   * short-lived `pi --mode rpc --no-session` in the agent's own folder. Each
   * model carries its exact context window and the thinking levels it accepts
   * (see {@link parsePiModels}). Resolves to `[]` if pi does not answer — a
   * spawn that fails, or a pi too old to know the command.
   */
  async listModels(): Promise<AgentModel[]> {
    const thinking = readPiThinkingDefaults();
    const models = await this.#askPi(
      this.#defaultCwd,
      [],
      { type: 'get_available_models' },
      MODEL_LIST_TIMEOUT_MS,
      (line) => parsePiModels(line, this.#defaultModel, thinking),
    );
    if (models === undefined) return [];
    // Cache each model's context window so `sendTurn` can emit `usage`
    // with a window (→ percentage on the phone) without re-listing.
    for (const m of models) {
      if (m.contextWindow !== undefined) this.#contextWindowByModel.set(m.id, m.contextWindow);
    }
    return models;
  }

  /**
   * The commands pi has in [cwd], as pi itself lists them (`get_commands`,
   * verified on pi 0.85.1): its prompt templates and skills, project and user,
   * with descriptions — see {@link piAgentCommands} for what is left out. A
   * picked one is sent as `/name args` on the `prompt` command, which pi
   * expands itself, so there is no {@link expandCommand}.
   *
   * Asked of a short-lived `pi --mode rpc --no-session` started with the same
   * posture flags as a turn ({@link piPostureArgs}): pi loads a project's own
   * prompts and skills only when it trusts the project (`--approve`, or a
   * saved decision in its `trust.json`), and a listing that trusted what the
   * turn does not would advertise commands that do not run. A thread's
   * resident process is not asked: the answer would interleave with its turn's
   * stream. Reused per folder for a minute; an unanswered request yields none.
   */
  async listCommands(cwd?: string): Promise<AgentCommand[]> {
    const dir = cwd ?? this.#defaultCwd;
    const cached = this.#commandsByCwd.get(dir);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
    const reported = await this.#askCommands(dir);
    if (reported === undefined) return [];
    const commands = piAgentCommands(reported);
    this.#commandsByCwd.set(dir, { at: Date.now(), commands });
    return commands;
  }

  /** Ask pi in [cwd] for its commands; `undefined` if it will not say. */
  #askCommands(cwd: string): Promise<PiReportedCommand[] | undefined> {
    return this.#askPi(
      cwd,
      piPostureArgs(this.#permissionMode),
      { type: 'get_commands' },
      COMMANDS_TIMEOUT_MS,
      parsePiCommands,
    );
  }

  /**
   * Ask a short-lived `pi --mode rpc --no-session` in [cwd] one RPC command and
   * read its answer with [parse]. `undefined` when pi will not say: no answer
   * within [timeoutMs], the process gone, or it could not start. The process is
   * ended as soon as it has answered (or given up).
   */
  #askPi<T>(
    cwd: string,
    extraArgs: string[],
    request: Record<string, unknown>,
    timeoutMs: number,
    parse: (line: string) => T | undefined,
  ): Promise<T | undefined> {
    return new Promise((resolve) => {
      let child: SpawnedProcess;
      try {
        child = this.#spawn(
          this.#binaryPath,
          [...this.#prependArgs, '--mode', 'rpc', '--no-session', ...extraArgs],
          cwd,
          { stdin: 'pipe' },
        );
      } catch {
        resolve(undefined);
        return;
      }
      let settled = false;
      const finish = (answer: T | undefined): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.stdin?.end();
          child.kill();
        } catch {
          /* already gone */
        }
        resolve(answer);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      onLines(child.stdout, (line) => {
        const answer = parse(line);
        if (answer !== undefined) finish(answer);
      });
      child.on('close', () => finish(undefined));
      child.on('error', () => finish(undefined));
      child.stdin?.write(`${JSON.stringify(request)}\n`);
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

/**
 * A prompt's images as pi's RPC takes them — `images`, in order, after the
 * message text (pi does not interleave; each image's label sits in the text in
 * the same order). Nothing for a text-only prompt.
 */
function piImagesField(options: Pick<SendTurnOptions, 'input'>): {
  images?: ReturnType<typeof piImages>;
} {
  const images = piImages(options);
  return images.length > 0 ? { images } : {};
}
