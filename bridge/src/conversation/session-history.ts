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
 *     a `session_meta` line then `response_item` lines whose `payload` is
 *     `{ type:'message', role, content:[{type:'input_text'|'output_text', text}] }`.
 *   - **OpenCode** — JSON store, not a single file: messages at
 *     `~/.local/share/opencode/storage/message/<sessionId>/<msgId>.json` and their
 *     parts at `…/storage/part/<msgId>/<partId>.json` (`{ type:'text', text }`).
 *   - **pi** — `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl`; lines
 *     `{ type:'message', message:{ role, content:[{type:'text', text}] } }`.
 *   - **Gemini CLI** — `~/.gemini/tmp/<projectHash>/chats/session-<ts>-<shortId>.json`;
 *     one JSON object per file with `{ sessionId, projectHash, startTime, lastUpdated,
 *     messages:[{id, timestamp, type:'user'|'gemini'|'info'|'error', content, thoughts?}]
 *     }`. The filename's `<shortId>` is the FIRST 8 CHARS of the full UUID session
 *     id with dashes stripped (verified against gemini-cli 0.46.0). Multiple snapshots
 *     may exist for the same session id (different CLI invocations re-using it);
 *     the reader merges them, deduplicating by message id.
 *
 * The session id used to locate the file is the agent's NATIVE id (Claude
 * `session_id`, Codex `thread_id`, OpenCode `sessionID`, pi session id, Gemini
 * `session_id`), persisted per thread by the adapters/AgentManager so the file is
 * findable after a restart.
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
    for (const obj of await readJsonl(file)) {
      const type = obj['type'];
      if (type !== 'user' && type !== 'assistant') continue;
      const message = asRecord(obj['message']);
      const role = message?.['role'];
      if (role !== 'user' && role !== 'assistant') continue;
      const { text, thinking } = extractAnthropicContent(message?.['content']);
      // A `user` line whose content is only tool_result is an agent tool echo,
      // not a real user turn — skip when it yielded no plain text.
      if (role === 'user' && !text) continue;
      if (!text && !thinking) continue;
      out.push({
        role,
        text,
        ...(thinking ? { thinking } : {}),
        createdAt: parseTime(obj['timestamp']),
      });
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
    for (const obj of await readJsonl(file)) {
      if (obj['type'] !== 'response_item') continue;
      const payload = asRecord(obj['payload']);
      if (!payload || payload['type'] !== 'message') continue;
      const role = payload['role'];
      // Codex logs developer/system priming messages; only keep the conversation.
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractCodexContent(payload['content']);
      if (!text) continue;
      out.push({ role, text, createdAt: parseTime(obj['timestamp']) });
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
      const text = await this.#openCodeMessageText(join(partRoot, meta.id));
      if (!text) continue;
      out.push({ role: meta.role, text, createdAt: meta.createdAt });
    }
    return out;
  }

  async #openCodeMessageText(partDir: string): Promise<string> {
    const files = (await safeReaddir(partDir)).filter((f) => f.endsWith('.json')).sort();
    const chunks: string[] = [];
    for (const f of files) {
      const obj = await readJsonFile(join(partDir, f));
      if (obj?.['type'] === 'text' && typeof obj['text'] === 'string') chunks.push(obj['text']);
    }
    return chunks.join('').trim();
  }

  async #readPi(sessionId: string): Promise<RawMessage[] | null> {
    const sessionsRoot = join(this.#home, '.pi', 'agent', 'sessions');
    const file = await this.#cached(`pi:${sessionId}`, async () => {
      // Layout: sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl
      return findFileBySuffix(sessionsRoot, `_${sessionId}.jsonl`, 1);
    });
    if (!file) return null;
    const out: RawMessage[] = [];
    for (const obj of await readJsonl(file)) {
      if (obj['type'] !== 'message') continue;
      const message = asRecord(obj['message']);
      const role = message?.['role'];
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractPiContent(message?.['content']);
      if (!text) continue;
      out.push({ role, text, createdAt: parseTime(obj['timestamp']) });
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
        seen.add(id);
        out.push({
          role,
          text,
          ...(thinking ? { thinking } : {}),
          createdAt: parseTime(rec['timestamp']),
        });
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
