/**
 * On-disk session history fallback for `turn/list` (architecture/02a §5.8.8,
 * `session-jsonl-history`).
 *
 * When the {@link ThreadStore} has no turns for a thread — e.g. the bridge was
 * offline while the agent ran, `threads.json` was lost, or the session was driven
 * from a terminal — the agent's own CLI still wrote an authoritative log to disk.
 * This reader locates and parses that log so the phone can still show history.
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
 *     [{type:'text'|'toolCall', ...}], toolCallId?, toolName?, ... } }`. Reasoning
 *     is stored inline as `think...think` inside the assistant text blocks.
 *   - **Gemini CLI** — `~/.gemini/tmp/<projectHash>/chats/session-<ts>-<shortId>.json`;
 *     one JSON object per file with `{ sessionId, projectHash, startTime, lastUpdated,
 *     messages:[{id, timestamp, type:'user'|'gemini'|'info'|'error', content, thoughts?,
 *     toolCalls?}] }`. The filename's `<shortId>` is the FIRST 8 CHARS of the full
 *     UUID session id with dashes stripped (verified against gemini-cli 0.46.0).
 *     Multiple snapshots may exist for the same session id (different CLI invocations
 *     re-using it); the reader merges them, deduplicating by message id. Each
 *     `gemini` message may also carry a `toolCalls: [{ id, name, args, result,
 *     status }]` array with BOTH the arguments AND the result inline.
 *
 * The session id used to locate the file is the agent's NATIVE id (Claude
 * `session_id`, Codex `thread_id`, OpenCode `sessionID`, pi session id, Gemini
 * `session_id`), persisted per thread by the adapters/AgentManager so the file is
 * findable after a restart.
 *
 * Beyond text + thinking, the reader ALSO reconstructs the structured
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
 *     `reasoning` items precede the assistant text, so they're queued and
 *     flushed onto the next assistant message. `shell_command` maps to
 *     `command_execution`, `apply_patch` to `diff`, others to generic `tool`.
 *   - **OpenCode** — reads each message's `tool` parts (already paired with
 *     their result in the same part) and maps the tool name to a structured
 *     block; reasoning parts become `thinking`.
 *   - **pi** — pairs the `toolCall` content block inside an assistant message
 *     with the subsequent `role:'toolResult'` message (by `toolCallId`).
 *     `think` tags embedded in the assistant text are extracted into
 *     `thinking`.
 *   - **Gemini CLI** — the `gemini` messages already include `toolCalls` with
 *     both args and result inline; each one maps to a structured block.
 *
 * This is a best-effort, READ-ONLY fallback: it never writes, tolerates malformed
 * lines/files, and returns `null` when it cannot produce anything (the caller then
 * keeps the empty store result). Resolved file paths are cached per session id
 * with a 60s TTL so repeated `turn/list` calls don't re-scan the directory tree.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { AgentId, Message, MessageRole, Turn } from '@uxnan/shared';
import {
  extractToolUses,
  extractToolResults,
  toolUseToBlock,
  type ClaudeToolUse,
} from '../adapters/claude-tools.js';
import { codexReasoningText, codexItemBlocks, codexFileChanges } from '../adapters/codex-tools.js';
import { fileChangeBlock, truncateOutput } from '../adapters/content-blocks.js';
import { opencodeToolBlock } from '../adapters/opencode-tools.js';
import { piToolBlock, piResultText, type PiToolUse } from '../adapters/pi-tools.js';
import { geminiToolBlock, isInternalGeminiTool } from '../adapters/gemini-tools.js';

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
}

interface CacheEntry {
  /** Resolved file/dir path, or null when a prior lookup found nothing. */
  path: string | null;
  expires: number;
}

/** A cached list of resolved file paths (or null for an empty prior lookup). */
interface CacheListEntry {
  paths: string[] | null;
  expires: number;
}

/** A neutral, ordered message extracted from any agent's log. */
interface RawMessage {
  role: MessageRole;
  text: string;
  thinking?: string;
  /**
   * Structured MessageContent blocks (`command_execution` / `diff` / generic
   * `tool`) that this assistant message produced. Reconstructed from the
   * agent's on-disk tool-call entries so the phone renders Work log / Changed
   * files for history-fallback turns the same way it does for live turns.
   * Only set on assistant messages.
   */
  blocks?: unknown[];
  createdAt: number;
}

export class SessionHistoryReader {
  readonly #home: string;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #cache = new Map<string, CacheEntry>();
  /** Multi-file cache for agents that may have several snapshot files per session. */
  readonly #cacheList = new Map<string, CacheListEntry>();

  constructor(options: SessionHistoryOptions = {}) {
    this.#home = options.homeDir ?? homedir();
    this.#now = options.now ?? (() => Date.now());
    this.#ttl = options.cacheTtlMs ?? 60_000;
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
          messages = await this.#readOpenCode(agentSessionId);
          break;
        case 'pi-agent':
          messages = await this.#readPi(agentSessionId);
          break;
        case 'gemini-cli':
          messages = await this.#readGemini(agentSessionId);
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

  async #readClaude(sessionId: string): Promise<RawMessage[] | null> {
    const projects = join(this.#home, '.claude', 'projects');
    const file = await this.#cached(`claude:${sessionId}`, async () => {
      // The session id is the file name; scan project dirs rather than reproduce
      // Claude's cwd-encoding (which is lossy). Session ids are UUIDs → unique.
      const dirs = await safeReaddir(projects);
      for (const dir of dirs) {
        const candidate = join(projects, dir, `${sessionId}.jsonl`);
        if (await isFile(candidate)) return candidate;
      }
      return null;
    });
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
      const { text, thinking } = extractAnthropicContent(content);
      if (role === 'assistant') {
        const raw: RawMessage = { role, text, createdAt: parseTime(obj['timestamp']) };
        if (thinking) raw.thinking = thinking;
        const tools = extractToolUses(content);
        if (tools.length > 0) pendingToolUses = tools;
        out.push(raw);
      } else {
        // user message — may carry tool_results AND/OR plain text
        const results = extractToolResults(content);
        if (results.length > 0 && pendingToolUses) {
          const blocks: unknown[] = [];
          for (const use of pendingToolUses) {
            const result = results.find((r) => r.toolUseId === use.id);
            if (result) blocks.push(toolUseToBlock(use, result));
          }
          attachBlocksToLastAssistant(out, blocks);
          pendingToolUses = null;
        }
        if (!text) continue; // pure tool_result echo — skip per existing behavior
        out.push({ role, text, createdAt: parseTime(obj['timestamp']) });
      }
    }
    return out;
  }

  async #readCodex(sessionId: string): Promise<RawMessage[] | null> {
    const sessionsRoot = join(this.#home, '.codex', 'sessions');
    const file = await this.#cached(`codex:${sessionId}`, async () => {
      // Layout: sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<sessionId>.jsonl
      const suffix = `-${sessionId}.jsonl`;
      return findFileBySuffix(sessionsRoot, suffix, 3);
    });
    if (!file) return null;
    const out: RawMessage[] = [];
    // Track the most recent assistant message so we can attach reasoning text
    // to it as we walk the rollout. (Tool-call blocks attach to the NEXT
    // assistant message — see `pendingBlocks` below — because Codex's on-disk
    // order is `user → tool_events → assistant`.)
    let lastAssistant: RawMessage | null = null;
    // Blocks waiting for the next assistant message to land (Codex tool events
    // precede the assistant text that triggered them). When an assistant
    // message is added, this list is drained into its `blocks` field.
    const pendingBlocks: unknown[] = [];
    // Same idea for reasoning text: it may arrive before the assistant message
    // (codex-cli logs reasoning as its own item, before the final reply). The
    // queue is flushed onto the next assistant message's `thinking` field.
    let pendingThinking = '';
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
        const pending = callId ? pendingToolCalls.get(callId) : undefined;
        if (!pending) continue;
        pendingToolCalls.delete(callId);
        const output = extractCodexOutputText(payload['output']);
        const isError = codexOutputIsError(payload['output']);
        const block = codexToolCallBlock(pending, output, isError);
        if (block) pendingBlocks.push(block);
        continue;
      }
      // ---- Legacy format (pre-0.98): standalone items per event ----
      if (ptype === 'command_execution') {
        const blocks = codexItemBlocks(payload);
        for (const b of blocks) pendingBlocks.push(b);
        continue;
      }
      if (ptype === 'file_change') {
        const blocks = codexFileChanges(payload).map((c) => fileChangeBlock(c.path));
        for (const b of blocks) pendingBlocks.push(b);
        continue;
      }
      if (ptype === 'mcp_tool_call') {
        const blocks = codexItemBlocks(payload);
        for (const b of blocks) pendingBlocks.push(b);
        continue;
      }
      // ---- Reasoning (either format): attach text to the last assistant
      //      message when one exists, otherwise queue for the NEXT assistant
      //      message. codex-cli encrypts the long-form reasoning body into
      //      `encrypted_content`; the human-readable summary (when present)
      //      is the best we can show. ----
      if (ptype === 'reasoning') {
        const text = codexReasoningText(payload);
        if (text) {
          if (lastAssistant) {
            lastAssistant.thinking = (lastAssistant.thinking ?? '') + text;
          } else {
            pendingThinking += text;
          }
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
        const raw: RawMessage = { role, text, createdAt: parseTime(obj['timestamp']) };
        // Drain any queued tool blocks and reasoning text (Codex tool events
        // and reasoning items precede the assistant text that initiated them,
        // so the assistant that closes the turn owns them).
        if (role === 'assistant') {
          if (pendingBlocks.length > 0) raw.blocks = pendingBlocks.splice(0, pendingBlocks.length);
          if (pendingThinking.length > 0) {
            raw.thinking = pendingThinking;
            pendingThinking = '';
          }
        }
        out.push(raw);
        if (role === 'assistant') lastAssistant = raw;
      }
    }
    // Tolerate trailing tool events / reasoning with no following assistant:
    // attach them to the most recent assistant (e.g. when the run ended
    // without a closing text reply).
    if (lastAssistant) {
      if (pendingBlocks.length > 0) {
        lastAssistant.blocks = (lastAssistant.blocks ?? []).concat(pendingBlocks);
      }
      if (pendingThinking.length > 0) {
        lastAssistant.thinking = (lastAssistant.thinking ?? '') + pendingThinking;
      }
    }
    return out;
  }

  async #readOpenCode(sessionId: string): Promise<RawMessage[] | null> {
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
      const { text, thinking, blocks } = await this.#openCodeMessageParts(partDir);
      if (!text && !thinking && blocks.length === 0) continue;
      const raw: RawMessage = { role: meta.role, text, createdAt: meta.createdAt };
      if (thinking) raw.thinking = thinking;
      if (blocks.length > 0) raw.blocks = blocks;
      out.push(raw);
    }
    return out;
  }

  /**
   * Read the parts of one OpenCode message: joined `text` for the body,
   * joined `reasoning` text for the `thinking` field, and one structured
   * block per `tool` part in a terminal state (matched by tool name).
   */
  async #openCodeMessageParts(
    partDir: string,
  ): Promise<{ text: string; thinking?: string; blocks: unknown[] }> {
    const files = (await safeReaddir(partDir)).filter((f) => f.endsWith('.json')).sort();
    const textChunks: string[] = [];
    const thinkChunks: string[] = [];
    const blocks: unknown[] = [];
    for (const f of files) {
      const obj = await readJsonFile(join(partDir, f));
      if (!obj) continue;
      if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
        textChunks.push(obj['text']);
      } else if (obj['type'] === 'reasoning' && typeof obj['text'] === 'string') {
        thinkChunks.push(obj['text']);
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
          blocks.push(opencodeToolBlock(toolName, partId, input, output, status === 'error'));
        }
      }
    }
    const text = textChunks.join('').trim();
    const thinking = thinkChunks.join('').trim();
    return {
      text,
      ...(thinking ? { thinking } : {}),
      blocks,
    };
  }

  async #readPi(sessionId: string): Promise<RawMessage[] | null> {
    const sessionsRoot = join(this.#home, '.pi', 'agent', 'sessions');
    const file = await this.#cached(`pi:${sessionId}`, async () => {
      // Layout: sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl
      return findFileBySuffix(sessionsRoot, `_${sessionId}.jsonl`, 1);
    });
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
        const { text, thinking } = extractPiAssistantContent(content);
        const raw: RawMessage = { role, text, createdAt: parseTime(obj['timestamp']) };
        if (thinking) raw.thinking = thinking;
        const toolCalls = extractPiToolCalls(content);
        if (toolCalls.length > 0) pendingToolCalls = toolCalls;
        out.push(raw);
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

  /**
   * Read a Gemini CLI session. The CLI writes one JSON file per snapshot under
   * `~/.gemini/tmp/<projectHash>/chats/session-<ts>-<shortId>.json` where
   * `<shortId>` is the first 8 hex chars of the UUID session id (dashes removed).
   *
   * The CLI MAY write multiple snapshots for the same session id (different
   * invocations / re-opens) so we collect every file whose name ends with the
   * short id, parse each, keep only the ones whose top-level `sessionId` exactly
   * matches, and merge messages — deduplicating by message id and sorting by
   * timestamp. `info` and `error` entries are skipped (they are system/meta
   * records, not conversation turns). `toolCalls` are ignored for now (the
   * live adapter path reconstructs structured blocks; the fallback keeps
   * text + thinking).
   */
  async #readGemini(sessionId: string): Promise<RawMessage[] | null> {
    const tmpRoot = join(this.#home, '.gemini', 'tmp');
    const shortId = deriveGeminiShortId(sessionId);
    if (!shortId) return null;
    const files = await this.#cachedList(`gemini:${sessionId}`, async () =>
      findGeminiSessionFiles(tmpRoot, shortId),
    );
    if (!files || files.length === 0) return null;
    // Dedup across snapshots by message id; sort by timestamp.
    const seen = new Set<string>();
    const out: RawMessage[] = [];
    for (const file of files) {
      const obj = await readJsonFile(file);
      if (!obj || obj['sessionId'] !== sessionId) continue;
      const msgs = Array.isArray(obj['messages']) ? (obj['messages'] as unknown[]) : [];
      for (const item of msgs) {
        const rec = asRecord(item);
        if (!rec) continue;
        const id = typeof rec['id'] === 'string' ? rec['id'] : undefined;
        if (!id || seen.has(id)) continue;
        const text = extractGeminiContent(rec);
        if (!text) continue;
        // Map Gemini's `gemini` type to assistant; skip `info`/`error`.
        const type = rec['type'];
        let role: MessageRole;
        if (type === 'gemini') role = 'assistant';
        else if (type === 'user') role = 'user';
        else continue;
        const thinking = role === 'assistant' ? extractGeminiThinking(rec) : undefined;
        // Each `gemini` message may carry a `toolCalls` array; map each call
        // (whose result is inlined in the same entry) to a structured block.
        const blocks = role === 'assistant' ? extractGeminiBlocks(rec) : [];
        const raw: RawMessage = {
          role,
          text,
          createdAt: parseTime(rec['timestamp']),
        };
        if (thinking) raw.thinking = thinking;
        if (blocks.length > 0) raw.blocks = blocks;
        seen.add(id);
        out.push(raw);
      }
    }
    if (out.length === 0) return null;
    out.sort((a, b) => a.createdAt - b.createdAt);
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

  /**
   * Like {@link #cached} but for a list of paths (used by agents that may
   * produce several snapshot files per session, e.g. Gemini CLI). `null` is
   * cached as an explicit "found nothing" marker, so repeated lookups within
   * the TTL don't re-scan the directory tree.
   */
  async #cachedList(
    key: string,
    resolve: () => Promise<string[] | null>,
  ): Promise<string[] | null> {
    const now = this.#now();
    const hit = this.#cacheList.get(key);
    if (hit && hit.expires > now) return hit.paths;
    const paths = await resolve();
    this.#cacheList.set(key, { paths, expires: now + this.#ttl });
    return paths;
  }
}

// --- Turn assembly -----------------------------------------------------------

/**
 * Fold an ordered message list into turns: a real user message opens a turn; the
 * assistant reply (and any further messages) attach to it until the next user
 * message. Ids are synthetic but deterministic so they're stable across reads.
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
      ...(raw.thinking ? { thinking: raw.thinking } : {}),
      ...(raw.blocks && raw.blocks.length > 0 ? { blocks: raw.blocks } : {}),
      createdAt: raw.createdAt,
    };
    turn.messages.push(message);
  };
  for (const raw of messages) {
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
  return turns;
}

// --- Content extraction (per-agent message shapes) ---------------------------

function extractAnthropicContent(content: unknown): { text: string; thinking?: string } {
  if (typeof content === 'string') return { text: content.trim() };
  if (!Array.isArray(content)) return { text: '' };
  const texts: string[] = [];
  const thinks: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec['type'] === 'text' && typeof rec['text'] === 'string') texts.push(rec['text']);
    else if (rec['type'] === 'thinking' && typeof rec['thinking'] === 'string')
      thinks.push(rec['thinking']);
  }
  const thinking = thinks.join('').trim();
  return { text: texts.join('').trim(), ...(thinking ? { thinking } : {}) };
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

// --- Gemini content extraction ----------------------------------------------

/**
 * Derive the 8-char short id the Gemini CLI uses in its session file name
 * (`session-<ts>-<shortId>.json`) from a full UUID session id — strip the
 * dashes and take the first 8 hex chars. Returns `null` when the input does
 * not look like a UUID (so a non-Gemini-style session id short-circuits to
 * "not found" instead of producing a wrong suffix).
 */
function deriveGeminiShortId(sessionId: string): string | null {
  const stripped = sessionId.replace(/-/g, '');
  // RFC 4122 lowercase hex: 8-4-4-4-12 → 32 hex chars after stripping dashes.
  if (stripped.length !== 32 || !/^[0-9a-f]{32}$/.test(stripped)) return null;
  return stripped.slice(0, 8);
}

/**
 * Walk `~/.gemini/tmp` for files under any `<hash>/chats/session-*-<shortId>.json`.
 * Returns every match — Gemini may write several snapshots per session id.
 */
async function findGeminiSessionFiles(tmpRoot: string, shortId: string): Promise<string[] | null> {
  const suffix = `-${shortId}.json`;
  const hashDirs = await safeReaddirTyped(tmpRoot);
  if (hashDirs.length === 0) return null;
  const out: string[] = [];
  for (const hashDir of hashDirs) {
    if (!hashDir.isDirectory()) continue;
    const chatsDir = join(tmpRoot, hashDir.name, 'chats');
    const files = await safeReaddirTyped(chatsDir);
    for (const f of files) {
      if (f.isFile() && f.name.startsWith('session-') && f.name.endsWith(suffix)) {
        out.push(join(chatsDir, f.name));
      }
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Pull plain text out of a Gemini message's `content` field. Gemini logs the
 * field as EITHER a plain string (the common case) OR an array of
 * `{ text: string }` parts (multi-part content, e.g. when the message bundles
 * a referenced file). We join whatever we find; the live adapter path
 * reconstructs structured blocks.
 */
function extractGeminiContent(message: Record<string, unknown>): string {
  const content = message['content'];
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      const rec = asRecord(part);
      if (rec && typeof rec['text'] === 'string') chunks.push(rec['text']);
    }
    return chunks.join('').trim();
  }
  return '';
}

/**
 * Join Gemini's `thoughts: [{ subject, description, timestamp }, ...]` array
 * into a single reasoning string (each thought becomes one paragraph). Returns
 * `undefined` when there are no thoughts. The Gemini CLI's reasoning stream
 * is structured per-thought (subject + description), so we use the description
 * as the body — the subject is a short heading that's noisy when concatenated.
 */
function extractGeminiThinking(message: Record<string, unknown>): string | undefined {
  const thoughts = message['thoughts'];
  if (!Array.isArray(thoughts) || thoughts.length === 0) return undefined;
  const chunks: string[] = [];
  for (const thought of thoughts) {
    const rec = asRecord(thought);
    if (!rec) continue;
    if (typeof rec['description'] === 'string') chunks.push(rec['description']);
  }
  const joined = chunks.join('\n\n').trim();
  return joined.length > 0 ? joined : undefined;
}

/**
 * Map a Gemini message's `toolCalls: [{ id, name, args, result, status }, ...]`
 * to structured MessageContent blocks. Each entry already carries BOTH the
 * arguments (`args`) and the result (`result`) inline, so no pairing is needed.
 * Internal tools (`update_topic` etc.) are filtered out via {@link isInternalGeminiTool}.
 */
function extractGeminiBlocks(message: Record<string, unknown>): unknown[] {
  const calls = message['toolCalls'];
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const out: unknown[] = [];
  for (const call of calls) {
    const rec = asRecord(call);
    if (!rec) continue;
    const name = typeof rec['name'] === 'string' ? rec['name'] : '';
    if (!name || isInternalGeminiTool(name)) continue;
    const toolId = typeof rec['id'] === 'string' ? rec['id'] : '';
    const args = isRecord(rec['args']) ? rec['args'] : {};
    // The result can be an array of function-response parts (most common) or a
    // plain string. Join the `output` from each `functionResponse.response`.
    const output = extractGeminiResultOutput(rec['result']);
    const isError = rec['status'] === 'error' || rec['status'] === 'failed';
    out.push(geminiToolBlock(name, toolId, args, output, isError));
  }
  return out;
}

/** Read the tool result text from a Gemini `toolCalls[].result` payload. */
function extractGeminiResultOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!Array.isArray(result)) return '';
  const chunks: string[] = [];
  for (const part of result) {
    const rec = asRecord(part);
    if (!rec) continue;
    const fr = isRecord(rec['functionResponse']) ? rec['functionResponse'] : undefined;
    const response = fr && isRecord(fr['response']) ? fr['response'] : undefined;
    if (response && typeof response['output'] === 'string') {
      chunks.push(response['output']);
    } else if (typeof rec['text'] === 'string') {
      chunks.push(rec['text']);
    }
  }
  return chunks.join('\n').trim();
}

// --- pi content extraction (toolCalls inline + toolResult as separate msg) ---

/**
 * Like `extractPiContent`, but additionally pulls `think` tags OUT of the
 * assistant's text content and returns them separately as `thinking`. The
 * saved pi log stores reasoning inline as `think...think` inside the text
 * blocks; the live adapter extracts reasoning from `thinking_delta` events
 * instead. Stripping it here keeps the assistant message's body clean and
 * mirrors the live path's `Message.thinking` separation.
 */
function extractPiAssistantContent(content: unknown): { text: string; thinking?: string } {
  if (typeof content === 'string') {
    return splitPiThinkTags(content);
  }
  if (!Array.isArray(content)) return { text: '' };
  const textChunks: string[] = [];
  const thinkChunks: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
      const split = splitPiThinkTags(rec['text']);
      if (split.text) textChunks.push(split.text);
      if (split.thinking) thinkChunks.push(split.thinking);
    }
    // `toolCall` blocks have no user-facing text and are handled separately.
  }
  const text = textChunks.join('').trim();
  const thinking = thinkChunks.join('\n\n').trim();
  return { text, ...(thinking ? { thinking } : {}) };
}

/** Strip `think...think` tags out of a pi text block into (text, thinking). */
function splitPiThinkTags(text: string): { text: string; thinking?: string } {
  const re = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  const thinks: string[] = [];
  const stripped = text.replace(re, (_match, body: string) => {
    thinks.push(body.trim());
    return '';
  });
  const thinking = thinks
    .filter((t) => t.length > 0)
    .join('\n\n')
    .trim();
  return {
    text: stripped.trim(),
    ...(thinking ? { thinking } : {}),
  };
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
    if (out[i]!.role === 'assistant') {
      const existing = out[i]!.blocks ?? [];
      out[i]!.blocks = existing.concat(blocks);
      return;
    }
  }
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
