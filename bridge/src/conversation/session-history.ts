/**
 * Agent-owned session history reader for `turn/list` (architecture/02a §5.8.8,
 * `native-session-history`).
 *
 * The agent's own persisted transcript remains authoritative for work performed
 * by another client attached to the same native session (Codex Desktop/CLI,
 * OpenCode Desktop, a terminal, and so on). `turn/list` reads this source and
 * merges completed native-only turns into the bridge store.
 *
 * Each agent CLI persists sessions in its own real on-disk format (verified live
 * on this machine, June 2026):
 *
 *   - **Claude Code** — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`; one
 *     JSON object per line: `{ type:'user'|'assistant', message:{ role, content:
 *     [{type:'text'|'thinking'|'tool_use'|'tool_result', ...}] }, sessionId, … }`.
 *   - **Codex** — `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<sessionId>.jsonl`;
 *     `response_item` payloads of various `type`s:
 *     - Legacy (codex-cli < 0.98): `message`, `command_execution`, `file_change`,
 *       `mcp_tool_call`, `reasoning`.
 *     - New (codex-cli 0.98+): `message`, `function_call` + `function_call_output`,
 *       `custom_tool_call` + `custom_tool_call_output`, `reasoning` (the body is
 *       encrypted into `encrypted_content`; the human-readable summary is shown
 *       as thinking when present).
 *   - **OpenCode** — JSON store, not a single file: messages at
 *     `~/.local/share/opencode/storage/message/<sessionId>/<msgId>.json` and their
 *     parts at `…/storage/part/<msgId>/<partId>.json`. Parts: `text`, `reasoning`,
 *     `tool` (with `state.status: completed|error`).
 *   - **pi** — `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl`; lines
 *     `{ type:'message', message:{ role:'user'|'assistant'|'toolResult', content:
 *     [{type:'text'|'thinking'|'toolCall', ...}], toolCallId?, toolName?, ... } }`.
 *     Reasoning is a `thinking` content block (checked on a real pi session,
 *     October 2026), or, for some models, `think` tags inside a text block.
 *   - **Zero** — `~/.local/share/zero/sessions/<sessionId>/events.jsonl`; ordered
 *     `message` events with `{ role, content }` payloads.
 *   - **Grok** — `~/.grok/sessions/<encoded-cwd>/<sessionId>/updates.jsonl`; the
 *     persisted ACP `session/update` stream, closed by `turn_completed`.
 * The session id used to locate the file is the agent's NATIVE id (Claude
 * `session_id`, Codex `thread_id`, OpenCode `sessionID`, or pi session id),
 * persisted per thread by the adapters/AgentManager so the file is
 * findable after a restart.
 *
 * Reasoning becomes thoughts (`{ type:'thinking', text }` segments) placed where
 * the transcript has them — every reader that finds reasoning finds it in
 * order: Claude Code's `thinking` content blocks, Codex's `reasoning` items,
 * OpenCode's `reasoning` parts, pi's `thinking` content blocks and `think`
 * tags, Grok's `agent_thought_chunk` updates. (Zero's transcript keeps no
 * reasoning at all.)
 *
 * Beyond text + reasoning, the reader ALSO reconstructs the structured
 * MessageContent blocks (`command_execution` / `diff` / generic `tool`) the
 * live adapter would have emitted, so the phone's Work log and Changed files
 * populate for history-fallback turns the same way they do for live turns. Each
 * agent's tool-call entries are mapped using the same `*-tools.ts` helpers the
 * live adapter uses, so the on-the-wire block shape stays in lock-step:
 *   - **Claude Code** — pairs `tool_use` (assistant) with the next `tool_result`
 *     (user) by `tool_use_id`, produces `command_execution` / `diff` / `tool`.
 *   - **Codex** — handles BOTH the OLD format (`command_execution` /
 *     `file_change` / `mcp_tool_call`) AND the NEW codex-cli 0.98+ format
 *     (`function_call` + `function_call_output` / `custom_tool_call` +
 *     `custom_tool_call_output`), pairing by `call_id`. Codex tool events +
 *     `reasoning` items precede the assistant text, so they're queued, in
 *     order, and lead the next assistant message. `shell_command` maps to
 *     `command_execution`, `apply_patch` to `diff`, others to generic `tool`.
 *   - **OpenCode** — reads each message's `tool` parts (already paired with
 *     their result in the same part) and maps the tool name to a structured
 *     block, in part order with the message's text and reasoning.
 *   - **pi** — pairs the `toolCall` content block inside an assistant message
 *     with the subsequent `role:'toolResult'` message (by `toolCallId`).
 *     `thinking` content blocks, and `think` tags embedded in the assistant
 *     text, become thoughts.
 * This is a best-effort, READ-ONLY fallback: it never writes, tolerates malformed
 * lines/files, and returns `null` when it cannot produce anything (the caller then
 * keeps the empty store result). Resolved file paths are cached per session id
 * with a 60s TTL so repeated `turn/list` calls don't re-scan the directory tree,
 * and {@link SessionHistoryReader.sourceSignature} says whether a file-backed
 * transcript changed, so an unchanged one is not read again at all.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import {
  isThinkingSegment,
  type AgentId,
  type Message,
  type MessageRole,
  type Turn,
} from '@uxnan/shared';
import {
  extractToolUses,
  extractToolResults,
  toolUseToBlock,
  type ClaudeToolUse,
} from '../adapters/claude-tools.js';
import { codexReasoningText, codexItemBlocks, codexFileChanges } from '../adapters/codex-tools.js';
import { fileChangeBlock, truncateOutput } from '../adapters/content-blocks.js';
import { opencodeToolBlock } from '../adapters/opencode-tools.js';
import type { OpenCodeHistoryMessage } from '../adapters/opencode-protocol.js';
import { piToolBlock, piResultText, type PiToolUse } from '../adapters/pi-tools.js';
import { ReplySegments } from '../adapters/reply-segments.js';

/** Where a thread's on-disk history lives, as known by the bridge. */
export interface HistorySource {
  agentId?: string;
  /** The agent's native session id (file locator). */
  agentSessionId?: string;
  /** The thread's working directory (helps disambiguate for some agents). */
  cwd?: string;
}

export interface SessionHistoryOptions {
  /** Home directory root; overridable in tests to point at a fixtures tree. */
  homeDir?: string;
  /** Injected clock for the path cache TTL (epoch ms). */
  now?: () => number;
  /** Path-cache TTL in ms (default 60s, per §5.8.8). */
  cacheTtlMs?: number;
  /**
   * OpenCode's history, read through its own server and already normalized by
   * the protocol client that speaks the installed version (`opencode-v1.ts` /
   * `opencode-v2.ts`). Newer releases keep sessions in SQLite rather than the
   * legacy JSON store, so the server is the stable cross-version boundary.
   */
  openCodeMessages?: (sessionId: string, cwd?: string) => Promise<OpenCodeHistoryMessage[]>;
}

interface CacheEntry {
  /** Resolved file/dir path, or null when a prior lookup found nothing. */
  path: string | null;
  expires: number;
}

/** A cached list of resolved file paths (or null for an empty prior lookup). */
/** A neutral, ordered message extracted from any agent's log. */
interface RawMessage {
  role: MessageRole;
  /** The prose, its runs concatenated (the message's `content`). */
  text: string;
  /**
   * An assistant message's prose runs, thoughts and structured MessageContent
   * blocks (`command_execution` / `diff` / generic `tool`, reconstructed from
   * the agent's on-disk tool-call entries) in transcript order
   * ({@link ReplySegments}), so a history turn renders like a live one. Only
   * set on assistant messages. A transcript writes most parts as lines of
   * their own, so the line order is their order: `canonicalTurn` folds the
   * lines into one assistant message whose `segments` follow it.
   */
  segments?: unknown[];
  createdAt: number;
}

export class SessionHistoryReader {
  readonly #home: string;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #openCodeMessages:
    | ((sessionId: string, cwd?: string) => Promise<OpenCodeHistoryMessage[]>)
    | undefined;

  constructor(options: SessionHistoryOptions = {}) {
    this.#home = options.homeDir ?? homedir();
    this.#now = options.now ?? (() => Date.now());
    this.#ttl = options.cacheTtlMs ?? 60_000;
    this.#openCodeMessages = options.openCodeMessages;
  }

  /**
   * Read a thread's turns from the agent's on-disk session log. Returns the full
   * ordered turn list (the caller paginates), or `null` when nothing usable was
   * found (unknown/unsupported agent, missing session id, no file, empty log).
   */
  async readTurns(source: HistorySource, threadId: string): Promise<Turn[] | null> {
    const { agentId, agentSessionId } = source;
    if (!agentId || !agentSessionId) return null;
    let messages: RawMessage[] | null;
    try {
      switch (agentId as AgentId) {
        case 'claude-code':
          messages = await this.#readClaude(agentSessionId);
          break;
        case 'codex':
          messages = await this.#readCodex(agentSessionId);
          break;
        case 'opencode':
          messages = await this.#readOpenCode(agentSessionId, source.cwd);
          break;
        case 'pi-agent':
          messages = await this.#readPi(agentSessionId);
          break;
        case 'zero':
          messages = await this.#readZero(agentSessionId);
          break;
        case 'grok':
          messages = await this.#readGrok(agentSessionId);
          break;
        default:
          return null;
      }
    } catch {
      return null;
    }
    if (!messages || messages.length === 0) return null;
    return groupIntoTurns(messages, threadId, agentSessionId);
  }

  // --- Per-agent locators + parsers ------------------------------------------

  /**
   * What the agent's transcript for [source] is right now — its file, size
   * and modification time — so a caller that remembers it can tell an
   * unchanged transcript from one worth reading again (the bridge skips
   * re-reading a 40 MB Claude Code transcript on every `turn/list` this way).
   * `undefined` when the history is not one file — OpenCode's is read through
   * its server — or none was found: then nothing is cheaper than reading it.
   */
  async sourceSignature(source: HistorySource): Promise<string | undefined> {
    const { agentId, agentSessionId } = source;
    if (!agentId || !agentSessionId) return undefined;
    let file: string | null;
    try {
      file = await this.#transcriptFile(agentId as AgentId, agentSessionId);
      if (!file) return undefined;
      const info = await stat(file);
      return JSON.stringify([file, info.size, info.mtimeMs]);
    } catch {
      return undefined;
    }
  }

  /** The one file holding an agent's transcript, for agents that keep one. */
  #transcriptFile(agentId: AgentId, sessionId: string): Promise<string | null> {
    switch (agentId) {
      case 'claude-code':
        return this.#claudeFile(sessionId);
      case 'codex':
        return this.#codexFile(sessionId);
      case 'pi-agent':
        return this.#piFile(sessionId);
      case 'zero':
        return this.#zeroFile(sessionId);
      case 'grok':
        return this.#grokFile(sessionId);
      default:
        return Promise.resolve(null);
    }
  }

  #claudeFile(sessionId: string): Promise<string | null> {
    const projects = join(this.#home, '.claude', 'projects');
    return this.#cached(`claude:${sessionId}`, async () => {
      // The session id is the file name; scan project dirs rather than reproduce
      // Claude's cwd-encoding (which is lossy). Session ids are UUIDs → unique.
      const dirs = await safeReaddir(projects);
      for (const dir of dirs) {
        const candidate = join(projects, dir, `${sessionId}.jsonl`);
        if (await isFile(candidate)) return candidate;
      }
      return null;
    });
  }

  #codexFile(sessionId: string): Promise<string | null> {
    const sessionsRoot = join(this.#home, '.codex', 'sessions');
    return this.#cached(`codex:${sessionId}`, async () => {
      // Layout: sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<sessionId>.jsonl
      const suffix = `-${sessionId}.jsonl`;
      return findFileBySuffix(sessionsRoot, suffix, 3);
    });
  }

  #piFile(sessionId: string): Promise<string | null> {
    const sessionsRoot = join(this.#home, '.pi', 'agent', 'sessions');
    return this.#cached(`pi:${sessionId}`, async () => {
      // Layout: sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl
      return findFileBySuffix(sessionsRoot, `_${sessionId}.jsonl`, 1);
    });
  }

  async #zeroFile(sessionId: string): Promise<string | null> {
    const file = join(this.#home, '.local', 'share', 'zero', 'sessions', sessionId, 'events.jsonl');
    return (await isFile(file)) ? file : null;
  }

  async #grokFile(sessionId: string): Promise<string | null> {
    const sessionsRoot = join(this.#home, '.grok', 'sessions');
    const sessionDir = await this.#cached(`grok:${sessionId}`, () =>
      findDirByName(sessionsRoot, sessionId, 2),
    );
    return sessionDir ? join(sessionDir, 'updates.jsonl') : null;
  }

  async #readClaude(sessionId: string): Promise<RawMessage[] | null> {
    const file = await this.#claudeFile(sessionId);
    if (!file) return null;
    const out: RawMessage[] = [];
    // Track the assistant's pending `tool_use` invocations so we can pair each
    // with the matching `tool_result` from the following user message and emit
    // structured blocks (attached to the assistant message that initiated them).
    let pendingToolUses: ClaudeToolUse[] | null = null;
    for (const obj of await readJsonl(file)) {
      const type = obj['type'];
      if (type !== 'user' && type !== 'assistant') continue;
      const message = asRecord(obj['message']);
      const role = message?.['role'];
      if (role !== 'user' && role !== 'assistant') continue;
      const content = message?.['content'];
      if (role === 'assistant') {
        const { text, segments } = anthropicReply(content).build();
        out.push({ role, text, segments, createdAt: parseTime(obj['timestamp']) });
        const tools = extractToolUses(content);
        if (tools.length > 0) pendingToolUses = tools;
      } else {
        const text = anthropicText(content);
        // user message — may carry tool_results AND/OR plain text
        const results = extractToolResults(content);
        if (results.length > 0 && pendingToolUses) {
          const blocks: unknown[] = [];
          for (const use of pendingToolUses) {
            const result = results.find((r) => r.toolUseId === use.id);
            const block = result ? toolUseToBlock(use, result) : null;
            if (block) blocks.push(block);
          }
          attachBlocksToLastAssistant(out, blocks);
          pendingToolUses = null;
        }
        if (!text) continue; // pure tool_result echo — skip per existing behavior
        // Not a prompt: what Claude Code adds to the conversation on its own —
        // an image's size note, a loaded skill, a hook's context (`isMeta`),
        // or the summary a compaction leaves (`isCompactSummary`). Each is
        // written as a "user" line of the prompt it belongs to; taken as a
        // prompt, one run became a turn per line, imported next to the
        // bridge's own record of that run and shown as bubbles on the phone.
        if (obj['isMeta'] === true || obj['isCompactSummary'] === true) continue;
        out.push({ role, text, createdAt: parseTime(obj['timestamp']) });
      }
    }
    return out;
  }

  async #readCodex(sessionId: string): Promise<RawMessage[] | null> {
    const file = await this.#codexFile(sessionId);
    if (!file) return null;
    const out: RawMessage[] = [];
    // Reasoning and tool events waiting, in rollout order, for the assistant
    // message they lead to: Codex's on-disk order is `user → reasoning / tool
    // events → assistant`, so they open that message's segments, before its
    // text. What no assistant message followed (a run stopped before it
    // answered, or still going) is a reply of its own, in its own turn.
    let pending = new ReplySegments();
    let pendingAt = 0;
    const flushPending = (): void => {
      if (pending.empty) return;
      const { text, segments } = pending.build();
      if (segments.length > 0)
        out.push({ role: 'assistant', text, segments, createdAt: pendingAt });
      pending = new ReplySegments();
    };
    // Pending tool invocations awaiting their `*_output` sibling (newer
    // codex-cli 0.98+ format), keyed by call_id.
    const pendingToolCalls = new Map<
      string,
      { name: string; arguments: Record<string, unknown>; kind: 'function' | 'custom' }
    >();
    for (const obj of await readJsonl(file)) {
      if (obj['type'] !== 'response_item') continue;
      const payload = asRecord(obj['payload']);
      if (!payload) continue;
      const ptype = payload['type'];
      // ---- Newer format (codex-cli 0.98+): function_call + function_call_output
      //      / custom_tool_call + custom_tool_call_output (paired by call_id) ----
      if (ptype === 'function_call' || ptype === 'custom_tool_call') {
        const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : '';
        const name = typeof payload['name'] === 'string' ? payload['name'] : '';
        if (!callId || !name) continue;
        const args = parseCodexArguments(payload);
        pendingToolCalls.set(callId, {
          name,
          arguments: args,
          kind: ptype === 'function_call' ? 'function' : 'custom',
        });
        continue;
      }
      if (ptype === 'function_call_output' || ptype === 'custom_tool_call_output') {
        const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : '';
        const call = callId ? pendingToolCalls.get(callId) : undefined;
        if (!call) continue;
        pendingToolCalls.delete(callId);
        const output = extractCodexOutputText(payload['output']);
        const isError = codexOutputIsError(payload['output']);
        const block = codexToolCallBlock(call, output, isError);
        if (block) {
          pending.block(block);
          pendingAt = parseTime(obj['timestamp']);
        }
        continue;
      }
      // ---- Legacy format (pre-0.98): standalone items per event ----
      if (ptype === 'command_execution' || ptype === 'mcp_tool_call') {
        for (const b of codexItemBlocks(payload)) pending.block(b);
        pendingAt = parseTime(obj['timestamp']);
        continue;
      }
      if (ptype === 'file_change') {
        for (const c of codexFileChanges(payload)) pending.block(fileChangeBlock(c.path));
        pendingAt = parseTime(obj['timestamp']);
        continue;
      }
      // ---- Reasoning (either format): a thought, queued in order with the
      //      tool events. codex-cli encrypts the long-form reasoning body into
      //      `encrypted_content`; the human-readable summary (when present)
      //      is the best we can show. ----
      if (ptype === 'reasoning') {
        const text = codexReasoningText(payload);
        if (text) {
          pending.thought(text);
          pendingAt = parseTime(obj['timestamp']);
        }
        continue;
      }
      // ---- Conversation message ----
      if (ptype === 'message') {
        const role = payload['role'];
        // Codex logs developer/system priming messages; only keep the conversation.
        if (role !== 'user' && role !== 'assistant') continue;
        const text = extractCodexContent(payload['content']);
        if (!text) continue;
        const createdAt = parseTime(obj['timestamp']);
        if (role === 'user') {
          // What waited belongs to the turn this prompt closes.
          flushPending();
          out.push({ role, text, createdAt });
          continue;
        }
        // The reasoning and tool events that led here open this message.
        const reply = pending.text(text).build();
        pending = new ReplySegments();
        out.push({ role, text: reply.text, segments: reply.segments, createdAt });
      }
    }
    flushPending();
    return out;
  }

  async #readOpenCode(sessionId: string, cwd?: string): Promise<RawMessage[] | null> {
    if (this.#openCodeMessages) {
      try {
        const parsed = await this.#openCodeMessages(sessionId, cwd);
        if (parsed.length > 0) return parsed;
      } catch {
        // Fall through to the legacy JSON store. This keeps history readable
        // when the local serve process is unavailable or on older installs.
      }
    }
    const storage = join(this.#home, '.local', 'share', 'opencode', 'storage');
    const messageDir = join(storage, 'message', sessionId);
    const partRoot = join(storage, 'part');
    const dirPath = await this.#cached(`opencode:${sessionId}`, async () =>
      (await isDir(messageDir)) ? messageDir : null,
    );
    if (!dirPath) return null;
    const files = (await safeReaddir(dirPath)).filter((f) => f.endsWith('.json'));
    const metas: { id: string; role: MessageRole; createdAt: number }[] = [];
    for (const f of files) {
      const obj = await readJsonFile(join(dirPath, f));
      const role = obj?.['role'];
      const id = obj?.['id'];
      if ((role !== 'user' && role !== 'assistant') || typeof id !== 'string') continue;
      metas.push({ id, role, createdAt: parseOpenCodeTime(obj?.['time']) });
    }
    metas.sort((a, b) => a.createdAt - b.createdAt);
    const out: RawMessage[] = [];
    for (const meta of metas) {
      const partDir = join(partRoot, meta.id);
      const { text, segments } = await this.#openCodeMessageParts(partDir);
      if (segments.length === 0) continue;
      out.push({
        role: meta.role,
        text,
        ...(meta.role === 'assistant' ? { segments } : {}),
        createdAt: meta.createdAt,
      });
    }
    return out;
  }

  /**
   * Read the parts of one OpenCode message, in their order (part ids sort as
   * they were written): `text` parts as prose, `reasoning` parts as thoughts,
   * one structured block per `tool` part in a terminal state (matched by
   * tool name).
   */
  async #openCodeMessageParts(partDir: string): Promise<{ text: string; segments: unknown[] }> {
    const files = (await safeReaddir(partDir)).filter((f) => f.endsWith('.json')).sort();
    const reply = new ReplySegments();
    for (const f of files) {
      const obj = await readJsonFile(join(partDir, f));
      if (!obj) continue;
      if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
        reply.text(obj['text']);
      } else if (obj['type'] === 'reasoning' && typeof obj['text'] === 'string') {
        reply.thought(obj['text']);
      } else if (obj['type'] === 'tool') {
        const state = isRecord(obj['state']) ? obj['state'] : {};
        const status = typeof state['status'] === 'string' ? state['status'] : '';
        if (status === 'completed' || status === 'error') {
          const toolName = typeof obj['tool'] === 'string' ? obj['tool'] : '';
          const partId = typeof obj['id'] === 'string' ? obj['id'] : '';
          const input = isRecord(state['input']) ? state['input'] : {};
          // `state.output` is set on success; `state.error` on error. Mirror the
          // live adapter (which reads `state.output`) by checking both.
          const output =
            typeof state['output'] === 'string'
              ? state['output']
              : typeof state['error'] === 'string'
                ? state['error']
                : '';
          reply.block(opencodeToolBlock(toolName, partId, input, output, status === 'error'));
        }
      }
    }
    return reply.build();
  }

  async #readPi(sessionId: string): Promise<RawMessage[] | null> {
    const file = await this.#piFile(sessionId);
    if (!file) return null;
    const out: RawMessage[] = [];
    // Pending `toolCall` content blocks from the most recent assistant message,
    // keyed by `id` so the next matching `role:'toolResult'` message can pair
    // with them and produce structured blocks.
    let pendingToolCalls: PiToolUse[] | null = null;
    for (const obj of await readJsonl(file)) {
      if (obj['type'] !== 'message') continue;
      const message = asRecord(obj['message']);
      const role = message?.['role'];
      if (role === 'user') {
        const text = extractPiContent(message?.['content']);
        if (!text) continue;
        out.push({ role, text, createdAt: parseTime(obj['timestamp']) });
        continue;
      }
      if (role === 'assistant') {
        const content = message?.['content'];
        // Assistant messages carry plain `text` AND `toolCall` blocks in the
        // same content array; remember the toolCalls so the next `toolResult`
        // message can pair with them.
        const { text, segments } = piReply(content).build();
        out.push({ role, text, segments, createdAt: parseTime(obj['timestamp']) });
        const toolCalls = extractPiToolCalls(content);
        if (toolCalls.length > 0) pendingToolCalls = toolCalls;
        continue;
      }
      if (role === 'toolResult') {
        const callId =
          typeof message?.['toolCallId'] === 'string' ? (message['toolCallId'] as string) : '';
        const toolName =
          typeof message?.['toolName'] === 'string' ? (message['toolName'] as string) : '';
        // pi's on-disk `toolResult.content` is the array of {type,text} parts
        // directly (unlike the live adapter which wraps in a `result` object).
        // `piResultText` expects a `{content: [...]}` wrapper, so unwrap if
        // needed.
        const rawContent = message?.['content'];
        const output = Array.isArray(rawContent)
          ? piResultText({ content: rawContent })
          : piResultText(rawContent);
        // pi uses `isError: true` on a failed result, but the field can also be
        // absent (success) — default to false.
        const isError = message?.['isError'] === true;
        if (pendingToolCalls) {
          const tool =
            pendingToolCalls.find((t) => t.id === callId) ??
            // Tolerate missing/empty callIds: match by tool name as a fallback.
            pendingToolCalls.find((t) => !t.id || t.name === toolName);
          if (tool) {
            attachBlocksToLastAssistant(out, [piToolBlock(tool, output, isError)]);
          }
          // Drop the matched call so a later toolResult with the same id
          // doesn't re-attach. Tolerate ambiguous matches by clearing only
          // when the id matched exactly.
          if (tool && tool.id && tool.id === callId) {
            pendingToolCalls = pendingToolCalls.filter((t) => t.id !== callId);
          }
        }
        continue;
      }
      // Unknown role — skip.
    }
    return out;
  }

  async #readZero(sessionId: string): Promise<RawMessage[] | null> {
    const file = await this.#zeroFile(sessionId);
    if (!file) return null;
    const out: RawMessage[] = [];
    for (const event of await readJsonl(file)) {
      if (event['type'] !== 'message') continue;
      const payload = asRecord(event['payload']);
      const role = payload?.['role'];
      const text = typeof payload?.['content'] === 'string' ? payload['content'].trim() : '';
      if ((role !== 'user' && role !== 'assistant') || !text) continue;
      out.push({ role, text, createdAt: parseTime(event['createdAt']) });
    }
    return out;
  }

  async #readGrok(sessionId: string): Promise<RawMessage[] | null> {
    const file = await this.#grokFile(sessionId);
    if (!file) return null;
    const out: RawMessage[] = [];
    let user = '';
    // The agent's prose and reasoning chunks, in the order they streamed.
    let reply = new ReplySegments();
    let userAt = 0;
    let completedAt = 0;
    for (const event of await readJsonl(file)) {
      const params = asRecord(event['params']);
      if (params?.['sessionId'] !== sessionId) continue;
      const update = asRecord(params['update']);
      const kind = update?.['sessionUpdate'];
      const text = acpContentText(update?.['content']);
      const at = parseTime(event['timestamp']);
      if (kind === 'user_message_chunk') {
        if (!user) userAt = at;
        user += text;
      } else if (kind === 'agent_message_chunk') {
        reply.text(text);
      } else if (kind === 'agent_thought_chunk') {
        // Chunks of one stream of reasoning: joined with nothing between.
        reply.thought(text, '');
      } else if (kind === 'turn_completed') {
        completedAt = at;
        if (user.trim()) out.push({ role: 'user', text: user.trim(), createdAt: userAt });
        const built = reply.build();
        if (built.segments.length > 0) {
          out.push({ role: 'assistant', ...built, createdAt: completedAt });
        }
        user = '';
        reply = new ReplySegments();
        userAt = 0;
      }
    }
    // Deliberately ignore a trailing uncompleted turn. Polling `turn/list`
    // will pick it up after Grok persists `turn_completed`.
    return out;
  }

  // --- Path cache (TTL) -------------------------------------------------------

  async #cached(key: string, resolve: () => Promise<string | null>): Promise<string | null> {
    const now = this.#now();
    const hit = this.#cache.get(key);
    if (hit && hit.expires > now) return hit.path;
    const path = await resolve();
    this.#cache.set(key, { path, expires: now + this.#ttl });
    return path;
  }
}

// --- Turn assembly -----------------------------------------------------------

/**
 * Whether a "user" line of a transcript is really the agent waking itself up —
 * Claude Code writes the end of a background task (`<task-notification>…`) as
 * a user message and answers it in the same run. It is not a prompt anyone
 * typed: it opens no turn, and what the agent says after it continues the turn
 * it belongs to.
 */
export function isAgentWake(text: string): boolean {
  return /^\s*<task-notification>/.test(text);
}

/**
 * A turn in the one shape every client renders: at most one user message and
 * ONE assistant message, whose `segments` hold its prose and steps in order —
 * the shape the bridge stores for the turns it runs. A transcript splits one
 * reply into a message per text run or tool step; handed to a client as is,
 * the desktop showed only the first (often empty) of them and the phone kept
 * replacing one with the next.
 */
export function canonicalTurn(turn: Turn): Turn {
  const users = turn.messages.filter((m) => m.role === 'user');
  const replies = turn.messages.filter((m) => m.role === 'assistant');
  if (replies.length <= 1 && users.length <= 1) return turn;
  const segments: unknown[] = [];
  const texts: string[] = [];
  let usage: Message['usage'];
  for (const reply of replies) {
    const text = typeof reply.content === 'string' ? reply.content : '';
    const own = reply.segments ?? [];
    // Separate replies stay separate responses, as the live stream keeps them:
    // the boundary closes the earlier one, so it goes before any thoughts that
    // already lead into this reply (a transcript may write them on a line of
    // their own).
    if (texts.length > 0 && isTextRun(own.find((s) => !isThinkingSegment(s)))) {
      let at = segments.length;
      while (at > 0 && isThinkingSegment(segments[at - 1])) at -= 1;
      segments.splice(at, 0, { type: 'assistant_response_boundary' });
    }
    for (const segment of own) {
      // Two thoughts in a row are one thought, as the live stream builds it.
      const last = segments[segments.length - 1];
      if (isThinkingSegment(segment) && isThinkingSegment(last)) {
        segments[segments.length - 1] = {
          type: 'thinking',
          text: `${last.text}\n\n${segment.text}`,
        };
      } else segments.push(segment);
    }
    if (text.length > 0) texts.push(text);
    if (reply.usage) usage = reply.usage;
  }
  const first = replies[0];
  const merged: Message | undefined = first && {
    id: first.id,
    turnId: turn.id,
    role: 'assistant',
    content: texts.join(''),
    segments,
    ...(usage ? { usage } : {}),
    createdAt: first.createdAt,
  };
  const user = users[0];
  return { ...turn, messages: [...(user ? [user] : []), ...(merged ? [merged] : [])] };
}

/** Whether a segment is a text run (`{ type:'text', text }`). */
function isTextRun(segment: unknown): boolean {
  return (
    !!segment &&
    typeof segment === 'object' &&
    (segment as { type?: unknown }).type === 'text' &&
    typeof (segment as { text?: unknown }).text === 'string'
  );
}

/**
 * Fold an ordered message list into turns: a real user message opens a turn; the
 * assistant reply (and any further messages) attach to it until the next user
 * message. An agent's own wake-up ({@link isAgentWake}) is not a user message:
 * it is left out and the reply that follows continues the turn. Each turn comes
 * out in the canonical shape ({@link canonicalTurn}). Ids are synthetic but
 * deterministic so they're stable across reads.
 */
function groupIntoTurns(messages: RawMessage[], threadId: string, sessionId: string): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let turnIndex = 0;
  let msgIndex = 0;
  const pushMessage = (turn: Turn, raw: RawMessage): void => {
    const message: Message = {
      id: `${sessionId}#m${msgIndex++}`,
      turnId: turn.id,
      role: raw.role,
      content: raw.text,
      ...(raw.role === 'assistant' ? { segments: raw.segments ?? textRuns(raw.text) } : {}),
      createdAt: raw.createdAt,
    };
    turn.messages.push(message);
  };
  for (const raw of messages) {
    if (raw.role === 'user' && isAgentWake(raw.text)) continue;
    if (raw.role === 'user' || current === null) {
      current = {
        id: `${sessionId}#t${turnIndex++}`,
        threadId,
        status: 'completed',
        messages: [],
        createdAt: raw.createdAt,
        completedAt: raw.createdAt,
      };
      turns.push(current);
    }
    pushMessage(current, raw);
    current.completedAt = raw.createdAt;
  }
  return turns.map(canonicalTurn);
}

// --- Content extraction (per-agent message shapes) ---------------------------

/** A Claude Code message's prose (`text` content blocks), trimmed. */
function anthropicText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec?.['type'] === 'text' && typeof rec['text'] === 'string') texts.push(rec['text']);
  }
  return texts.join('').trim();
}

/**
 * A Claude Code assistant line's `text` and `thinking` content blocks, in
 * their order. (Its `tool_use` blocks become steps once their results are
 * read — see `#readClaude`.)
 */
function anthropicReply(content: unknown): ReplySegments {
  const reply = new ReplySegments();
  if (typeof content === 'string') return reply.text(content);
  if (!Array.isArray(content)) return reply;
  for (const item of content) {
    const rec = asRecord(item);
    if (rec?.['type'] === 'text' && typeof rec['text'] === 'string') reply.text(rec['text']);
    else if (rec?.['type'] === 'thinking' && typeof rec['thinking'] === 'string') {
      reply.thought(rec['thinking']);
    }
  }
  return reply;
}

function extractCodexContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (
      (rec['type'] === 'input_text' || rec['type'] === 'output_text') &&
      typeof rec['text'] === 'string'
    ) {
      texts.push(rec['text']);
    }
  }
  return texts.join('').trim();
}

function extractPiContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec && rec['type'] === 'text' && typeof rec['text'] === 'string') texts.push(rec['text']);
  }
  return texts.join('').trim();
}

/** Text projection of an ACP content block (`{ type:'text', text }`). */
function acpContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  const content = asRecord(value);
  return content?.['type'] === 'text' && typeof content['text'] === 'string' ? content['text'] : '';
}

// --- pi content extraction (toolCalls inline + toolResult as separate msg) ---

/**
 * A pi assistant message's prose and reasoning, in their order: pi saves the
 * model's reasoning as `thinking` content blocks (`{ type:'thinking',
 * thinking }`, what the live adapter streams as `thinking_delta`), and some
 * models write it inline as `think` tags inside a text block — each tag is a
 * thought where it stands, the rest of the block prose. (`toolCall` blocks
 * become steps once their results are read — see `#readPi`.)
 */
function piReply(content: unknown): ReplySegments {
  const reply = new ReplySegments();
  if (typeof content === 'string') return splitPiThinkTags(content, reply);
  if (!Array.isArray(content)) return reply;
  for (const item of content) {
    const rec = asRecord(item);
    if (rec?.['type'] === 'text' && typeof rec['text'] === 'string') {
      splitPiThinkTags(rec['text'], reply);
    } else if (rec?.['type'] === 'thinking' && typeof rec['thinking'] === 'string') {
      reply.thought(rec['thinking']);
    }
  }
  return reply;
}

/** Hands a pi text block to [reply]: its `think` tags as thoughts, the rest as prose. */
function splitPiThinkTags(text: string, reply: ReplySegments): ReplySegments {
  const re = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  let from = 0;
  for (const match of text.matchAll(re)) {
    reply.text(text.slice(from, match.index));
    reply.thought(match[1] ?? '');
    from = match.index + match[0].length;
  }
  return reply.text(text.slice(from));
}

/** Extract `toolCall` content blocks from a pi assistant message. */
function extractPiToolCalls(content: unknown): PiToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: PiToolUse[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec || rec['type'] !== 'toolCall') continue;
    const id = typeof rec['id'] === 'string' ? rec['id'] : '';
    const name = typeof rec['name'] === 'string' ? rec['name'] : '';
    if (!name) continue;
    const args = isRecord(rec['arguments']) ? rec['arguments'] : {};
    out.push({ id, name, input: args });
  }
  return out;
}

// --- Codex argument + output extraction (newer codex-cli 0.98+ format) -----

/** Parse Codex `function_call.arguments` / `custom_tool_call.input` (JSON string). */
function parseCodexArguments(payload: Record<string, unknown>): Record<string, unknown> {
  const raw = payload['arguments'] ?? payload['input'];
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw) as unknown;
      return isRecord(obj) ? obj : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** The plain string Codex emits as `function_call_output.output` (may be multi-line). */
function extractCodexOutputText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  return '';
}

/** Codex signals an errored tool output with `Exit code: N` (N != 0) or an explicit failure. */
function codexOutputIsError(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const match = raw.match(/^Exit code:\s*(-?\d+)/m);
  if (!match) return false;
  const code = Number.parseInt(match[1]!, 10);
  return code !== 0;
}

/**
 * Build a structured MessageContent block for a Codex tool call (either
 * `function_call` or `custom_tool_call`). For the older pre-0.98 format the
 * standalone `command_execution` / `mcp_tool_call` items are handled by the
 * `codex-tools.ts` helpers directly.
 *
 * Mapping:
 *  - `shell_command` (function_call)        → `command_execution`
 *  - `apply_patch` (custom_tool_call)       → `diff` (best-effort; the patch
 *                                              body is a multi-file unified diff
 *                                              string, so we surface it as-is
 *                                              and let the phone render it)
 *  - any other (function or custom)         → generic `tool` block
 */
function codexToolCallBlock(
  pending: { name: string; arguments: Record<string, unknown>; kind: 'function' | 'custom' },
  output: string,
  isError: boolean,
): Record<string, unknown> | null {
  const trimmedOutput = truncateOutput(output);
  if (pending.kind === 'function' && pending.name === 'shell_command') {
    const command =
      typeof pending.arguments['command'] === 'string'
        ? (pending.arguments['command'] as string)
        : '';
    return {
      type: 'command_execution',
      command,
      status: isError ? 'error' : 'completed',
      ...(trimmedOutput ? { output: trimmedOutput } : {}),
    };
  }
  if (pending.kind === 'custom' && pending.name === 'apply_patch') {
    // `apply_patch.input` is the raw multi-file patch body. We surface the
    // filename hint from `pending.arguments.file_path` if present, else the
    // first file referenced by `*** Update File: ...` in the body.
    const filename =
      (typeof pending.arguments['file_path'] === 'string' &&
        (pending.arguments['file_path'] as string)) ||
      (output.match(/^\*\*\* Update File:\s*(.+)$/m)?.[1] ?? '');
    return {
      type: 'diff',
      filename,
      diff: trimmedOutput,
      additions: 0,
      deletions: 0,
    };
  }
  // Unknown tool → generic tool block.
  return {
    type: 'tool',
    toolName: pending.name,
    toolId: '',
    input: pending.arguments,
    ...(trimmedOutput ? { output: trimmedOutput } : {}),
    isError,
  };
}

// --- Shared helpers ----------------------------------------------------------

/**
 * Append structured blocks to the LAST assistant message in `out`. Used by
 * every per-agent reader to attach tool-call results to the assistant message
 * that initiated the tool calls. No-op when `out` has no assistant yet (the
 * tool-result arrived without a preceding assistant message — shouldn't happen
 * for well-formed logs, but we tolerate it gracefully).
 */
function attachBlocksToLastAssistant(out: RawMessage[], blocks: unknown[]): void {
  if (blocks.length === 0) return;
  for (let i = out.length - 1; i >= 0; i--) {
    const raw = out[i]!;
    if (raw.role === 'assistant') {
      // FOR-DEV: place a step where its call stands in the line — it lands
      // after the line's prose and thoughts, since it is paired with its
      // result only on a later line (bridge/FOR-DEV.md → "Native-session
      // history — order inside one transcript line").
      raw.segments = [...(raw.segments ?? textRuns(raw.text)), ...blocks];
      return;
    }
  }
}

/** The `segments` of a message that is only [text]: one run, or none. */
function textRuns(text: string): unknown[] {
  return text.length > 0 ? [{ type: 'text', text }] : [];
}

// --- Filesystem + parsing helpers (all tolerant) -----------------------------

async function readJsonl(file: string): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === 'object') out.push(obj as Record<string, unknown>);
    } catch {
      // Skip a malformed/partial line (e.g. a half-flushed final line).
    }
  }
  return out;
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const obj = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Recursively find the first file whose name ends with `suffix`, up to `depth`. */
async function findFileBySuffix(
  root: string,
  suffix: string,
  depth: number,
): Promise<string | null> {
  const entries = await safeReaddirTyped(root);
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(suffix)) return full;
    if (entry.isDirectory() && depth > 0) {
      const found = await findFileBySuffix(full, suffix, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** Recursively find a directory with an exact name, up to `depth`. */
async function findDirByName(root: string, name: string, depth: number): Promise<string | null> {
  const entries = await safeReaddirTyped(root);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(root, entry.name);
    if (entry.name === name) return full;
    if (depth > 0) {
      const found = await findDirByName(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function safeReaddirTyped(
  dir: string,
): Promise<{ name: string; isFile(): boolean; isDirectory(): boolean }[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Type guard variant of {@link asRecord}. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse an ISO-8601 or epoch-ms timestamp; 0 when absent/unparseable. */
function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/** OpenCode messages store `time: { created: <epoch ms> }`. */
function parseOpenCodeTime(time: unknown): number {
  const rec = asRecord(time);
  const created = rec?.['created'];
  return typeof created === 'number' && Number.isFinite(created) ? created : 0;
}
