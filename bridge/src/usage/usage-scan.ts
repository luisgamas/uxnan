/**
 * `usage/summary`: every model response the agent CLIs on this PC recorded,
 * by local day, agent and model (parsers in `transcript-usage.ts`).
 *
 * Transcripts only grow, and a busy machine holds gigabytes of them, so the
 * scan is incremental: each file's contribution is kept in
 * `~/.uxnan/usage-scan.json` with how far it was read, and only what was
 * appended since is parsed again (a file that shrank, or was rewritten, is
 * read again from the start). Claude Code copies earlier responses into the
 * file of a resumed or forked session, so its responses are counted once
 * across files: the first file seen owns each response.
 *
 * OpenCode keeps its messages in a SQLite database, read directly each time
 * (`node:sqlite`, read-only) — it answers in milliseconds.
 *
 * The raw records never leave this module: a summary carries sums only.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  UsageAgentSource,
  UsageBucket,
  UsageDay,
  UsageSpend,
  UsageSummary,
} from '@uxnan/shared';
import type { DaemonState } from '../daemon-state.js';
import type { Logger } from '../logger.js';
import {
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  parseOpenCodeMessage,
  parsePiLine,
  parseZeroLine,
  type CodexParseState,
  type UsageRecord,
} from './transcript-usage.js';
import { estimateCost } from './usage-prices.js';

/** The cache file, in the bridge's state directory. */
export const USAGE_SCAN_FILE = 'usage-scan.json';

/** A scan newer than this answers a summary without reading the disk again. */
const RESCAN_AFTER_MS = 30_000;

/** Files untouched for longer than this cannot hold spend any summary asks for. */
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

/** The kinds of transcript file, each with its parser. */
type FileKind = 'claude' | 'codex' | 'pi' | 'grok' | 'zero';

/** Where each CLI keeps its transcripts on this machine. */
export interface UsageLocations {
  claude: string;
  codex: string[];
  pi: string;
  grok: string;
  zero: string;
  openCodeDb: string;
}

/** The stores' places, honouring each CLI's own override variable. */
export function usageLocations(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): UsageLocations {
  const codexHome = env['CODEX_HOME'] || join(home, '.codex');
  const xdgData = env['XDG_DATA_HOME'] || join(home, '.local', 'share');
  return {
    claude: join(env['CLAUDE_CONFIG_DIR'] || join(home, '.claude'), 'projects'),
    codex: [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')],
    pi: join(env['PI_CODING_AGENT_DIR'] || join(home, '.pi', 'agent'), 'sessions'),
    grok: join(env['GROK_HOME'] || join(home, '.grok'), 'sessions'),
    zero: join(xdgData, 'zero', 'sessions'),
    openCodeDb: join(xdgData, 'opencode', 'opencode.db'),
  };
}

const AGENT_OF: Record<FileKind, string> = {
  claude: 'claude-code',
  codex: 'codex',
  pi: 'pi-agent',
  grok: 'grok',
  zero: 'zero',
};

/** A day's spend per `agent\tmodel`. */
type DaySpend = Record<string, UsageSpend>;

interface FileEntry {
  id: number;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  /** Bytes read, up to the end of the last complete line. */
  offset: number;
  codex?: CodexParseState;
  /** Spend per local day. */
  days: Record<string, DaySpend>;
}

interface CacheFile {
  version: 1;
  nextId: number;
  files: Record<string, FileEntry>;
  /** Claude response key → id of the file that owns it. */
  claudeOwner: Record<string, number>;
}

function emptyCache(): CacheFile {
  return { version: 1, nextId: 1, files: {}, claudeOwner: {} };
}

/** A fresh spend record. */
export function emptySpend(): UsageSpend {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    estimatedCostUsd: 0,
    unpricedTokens: 0,
    responses: 0,
  };
}

/** [into] += [from]. */
export function addSpend(into: UsageSpend, from: UsageSpend): void {
  into.inputTokens += from.inputTokens;
  into.cachedInputTokens += from.cachedInputTokens;
  into.cacheWriteTokens += from.cacheWriteTokens;
  into.outputTokens += from.outputTokens;
  into.reasoningTokens += from.reasoningTokens;
  into.costUsd += from.costUsd;
  into.estimatedCostUsd += from.estimatedCostUsd;
  into.unpricedTokens += from.unpricedTokens;
  into.responses += from.responses;
}

/** One record as spend: billed cost where recorded, else the API estimate. */
export function spendOf(r: UsageRecord): UsageSpend {
  const tokens = r.inputTokens + r.cachedInputTokens + r.cacheWriteTokens + r.outputTokens;
  const estimate = r.costUsd === undefined ? estimateCost(r) : undefined;
  return {
    inputTokens: r.inputTokens,
    cachedInputTokens: r.cachedInputTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    costUsd: r.costUsd ?? estimate ?? 0,
    estimatedCostUsd: estimate ?? 0,
    unpricedTokens: r.costUsd === undefined && estimate === undefined ? tokens : 0,
    responses: 1,
  };
}

/** `YYYY-MM-DD` of [ms] in this machine's time zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addRecord(days: Record<string, DaySpend>, r: UsageRecord): void {
  const day = (days[localDay(r.at)] ??= {});
  const key = `${r.agentId}\t${r.model}`;
  addSpend((day[key] ??= emptySpend()), spendOf(r));
}

function shortKey(key: string): string {
  return createHash('sha1').update(key).digest('base64url').slice(0, 12);
}

export interface UsageScannerOptions {
  state: DaemonState;
  locations?: UsageLocations;
  now?: () => number;
  logger?: Logger;
  /** Reads OpenCode's database (injected in tests; `node:sqlite` otherwise). */
  readOpenCode?: (dbPath: string) => Promise<{ sessionId: string; data: string }[]>;
}

export class UsageScanner {
  readonly #o: UsageScannerOptions;
  readonly #locations: UsageLocations;
  #cache: CacheFile | undefined;
  #scannedAt = 0;
  #scanning: Promise<void> | undefined;

  constructor(options: UsageScannerOptions) {
    this.#o = options;
    this.#locations = options.locations ?? usageLocations();
  }

  #now(): number {
    return this.#o.now?.() ?? Date.now();
  }

  /** The last [days] local days (today included), from the transcripts. */
  async summary(days: number): Promise<UsageSummary> {
    const span = Math.max(1, Math.min(366, Math.floor(days)));
    if (!this.#scanning && this.#now() - this.#scannedAt > RESCAN_AFTER_MS) {
      this.#scanning = this.#scan().finally(() => {
        this.#scanning = undefined;
        this.#scannedAt = this.#now();
      });
    }
    await this.#scanning;
    const cache = this.#cache ?? emptyCache();
    const first = new Date(this.#now());
    first.setHours(0, 0, 0, 0);
    first.setDate(first.getDate() - (span - 1));
    const since = localDay(first.getTime());

    const byDay = new Map<string, Map<string, UsageSpend>>();
    const sessions = new Map<string, number>();
    const merge = (day: string, spend: DaySpend) => {
      const target = byDay.get(day) ?? new Map<string, UsageSpend>();
      byDay.set(day, target);
      for (const [key, value] of Object.entries(spend)) {
        const into = target.get(key) ?? emptySpend();
        target.set(key, into);
        addSpend(into, value);
      }
    };
    for (const entry of Object.values(cache.files)) {
      let active = false;
      for (const [day, spend] of Object.entries(entry.days)) {
        if (day < since) continue;
        merge(day, spend);
        active = true;
      }
      if (active) {
        const agent = AGENT_OF[entry.kind];
        sessions.set(agent, (sessions.get(agent) ?? 0) + 1);
      }
    }

    const agents: UsageAgentSource[] = [];
    const seenStore = new Set<string>(
      Object.values(cache.files).map((entry) => AGENT_OF[entry.kind]),
    );
    const openCode = await this.#openCode(since);
    if (openCode) {
      for (const [day, spend] of openCode.days) merge(day, spend);
      if (openCode.status === 'ok') sessions.set('opencode', openCode.sessions);
      agents.push(
        openCode.status === 'ok'
          ? { agentId: 'opencode', sessions: openCode.sessions, status: 'ok' }
          : { agentId: 'opencode', sessions: 0, status: 'unreadable', message: openCode.message },
      );
    }
    for (const agentId of seenStore) {
      agents.push({ agentId, sessions: sessions.get(agentId) ?? 0, status: 'ok' });
    }

    const out: UsageDay[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, buckets]) => ({
        day,
        buckets: [...buckets.entries()].map(([key, spend]): UsageBucket => {
          const [agentId, model] = key.split('\t') as [string, string];
          return { agentId, model, ...spend };
        }),
      }));
    return { days: out, agents: agents.sort((a, b) => a.agentId.localeCompare(b.agentId)) };
  }

  async #load(): Promise<CacheFile> {
    if (this.#cache) return this.#cache;
    const raw = await this.#o.state.readJson<CacheFile>(USAGE_SCAN_FILE).catch(() => null);
    this.#cache = raw?.version === 1 && raw.files ? raw : emptyCache();
    return this.#cache;
  }

  async #scan(): Promise<void> {
    const cache = await this.#load();
    const found = new Map<string, FileKind>();
    const collect = async (dir: string, kind: FileKind, match: (name: string) => boolean) => {
      for (const path of await walk(dir, match)) found.set(path, kind);
    };
    await collect(this.#locations.claude, 'claude', (n) => n.endsWith('.jsonl'));
    for (const dir of this.#locations.codex) {
      await collect(dir, 'codex', (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
    }
    await collect(this.#locations.pi, 'pi', (n) => n.endsWith('.jsonl'));
    await collect(this.#locations.grok, 'grok', (n) => n === 'updates.jsonl');
    await collect(this.#locations.zero, 'zero', (n) => n === 'events.jsonl');

    let changed = false;
    // Gone from disk: its spend is gone from the summary too.
    for (const path of Object.keys(cache.files)) {
      if (!found.has(path)) {
        delete cache.files[path];
        changed = true;
      }
    }
    for (const [path, kind] of found) {
      try {
        if (await this.#readFile(cache, path, kind)) changed = true;
      } catch (err) {
        this.#o.logger?.debug(`usage: could not read ${path}: ${String(err)}`);
      }
    }
    if (changed) {
      await this.#o.state
        .writeJson(USAGE_SCAN_FILE, cache)
        .catch((err: unknown) => this.#o.logger?.warn(`usage: cache not saved: ${String(err)}`));
    }
  }

  /** Read what [path] gained since the last scan. Returns whether anything changed. */
  async #readFile(cache: CacheFile, path: string, kind: FileKind): Promise<boolean> {
    const info = await stat(path);
    if (this.#now() - info.mtimeMs > MAX_AGE_MS) return false;
    let entry = cache.files[path];
    if (entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs) return false;
    if (!entry || info.size < entry.offset) {
      // New, or rewritten shorter: read it whole.
      entry = { id: entry?.id ?? cache.nextId++, kind, size: 0, mtimeMs: 0, offset: 0, days: {} };
      cache.files[path] = entry;
    }
    const current = entry;
    const fromStart = current.offset === 0;
    // A response is written once per content block, each line repeating its
    // usage: within one read, it counts once.
    const seenThisRead = new Set<string>();
    const codexState: CodexParseState = current.codex ?? {};
    const zeroModel = kind === 'zero' ? await zeroSessionModel(path) : 'unknown';
    let offset = current.offset;
    const stream = createReadStream(path, { start: current.offset, encoding: 'utf-8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      // Only complete lines advance the offset: a line still being written is
      // read whole next time. `readline` drops the newline; +1 puts it back
      // (a CRLF file is read again from a line start either way).
      const bytes = Buffer.byteLength(line, 'utf-8') + 1;
      if (offset + bytes > info.size) break;
      offset += bytes;
      for (const r of parseLine(kind, line, codexState, zeroModel)) {
        if (r.dedupeKey) {
          const key = shortKey(r.dedupeKey);
          const owner = cache.claudeOwner[key];
          // Another file's response (a resumed session's copy), a repeat
          // within this read, or one this file already counted.
          if (owner !== undefined && owner !== current.id) continue;
          if (seenThisRead.has(key)) continue;
          if (owner === current.id && !fromStart) continue;
          seenThisRead.add(key);
          cache.claudeOwner[key] = current.id;
        }
        addRecord(current.days, r);
      }
    }
    current.offset = offset;
    current.size = info.size;
    current.mtimeMs = info.mtimeMs;
    if (kind === 'codex') current.codex = codexState;
    return true;
  }

  async #openCode(
    since: string,
  ): Promise<
    | { status: 'ok'; days: [string, DaySpend][]; sessions: number }
    | { status: 'unreadable'; days: []; message: string }
    | undefined
  > {
    const path = this.#locations.openCodeDb;
    try {
      await stat(path);
    } catch {
      return undefined;
    }
    try {
      const rows = await (this.#o.readOpenCode ?? readOpenCodeMessages)(path);
      const days: Record<string, DaySpend> = {};
      const sessions = new Set<string>();
      for (const row of rows) {
        const r = parseOpenCodeMessage(row.data);
        if (!r || localDay(r.at) < since) continue;
        addRecord(days, r);
        sessions.add(row.sessionId);
      }
      return { status: 'ok', days: Object.entries(days), sessions: sessions.size };
    } catch (err) {
      return { status: 'unreadable', days: [], message: String(err) };
    }
  }
}

function parseLine(
  kind: FileKind,
  line: string,
  codex: CodexParseState,
  zeroModel: string,
): UsageRecord[] {
  switch (kind) {
    case 'claude': {
      const r = parseClaudeLine(line);
      return r ? [r] : [];
    }
    case 'codex': {
      const r = parseCodexLine(line, codex);
      return r ? [r] : [];
    }
    case 'pi': {
      const r = parsePiLine(line);
      return r ? [r] : [];
    }
    case 'grok':
      return parseGrokLine(line);
    case 'zero': {
      const r = parseZeroLine(line, zeroModel);
      return r ? [r] : [];
    }
  }
}

/** The model a Zero session ran, from the `metadata.json` beside its events. */
async function zeroSessionModel(eventsPath: string): Promise<string> {
  try {
    const meta = JSON.parse(await readFile(join(dirname(eventsPath), 'metadata.json'), 'utf-8'));
    return typeof meta?.modelId === 'string' && meta.modelId ? meta.modelId : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Every file under [dir] whose name matches, depth-first; a missing dir is empty. */
async function walk(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (current: string, depth: number) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && match(entry.name)) out.push(path);
    }
  };
  await visit(dir, 0);
  return out;
}

/** OpenCode's assistant messages, from its database opened read-only. */
async function readOpenCodeMessages(
  dbPath: string,
): Promise<{ sessionId: string; data: string }[]> {
  const { DatabaseSync } = (await import('node:sqlite')) as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT session_id AS sessionId, data FROM message WHERE data LIKE '%"role":"assistant"%'`,
      )
      .all() as { sessionId: string; data: string }[];
    return rows;
  } finally {
    db.close();
  }
}
