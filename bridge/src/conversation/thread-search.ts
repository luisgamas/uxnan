/**
 * `thread/search` — what was said in every conversation, answered by the owner
 * of the history (architecture/02a §5.8.21). Clients hold the list of
 * conversations, never every turn of them, so a search for words inside one
 * can only be answered here.
 *
 * It reads the conversations' digests ({@link TurnDigest}, `digest.json`), never
 * a turn, keeping each one it read folded in memory — bounded by
 * {@link SEARCH_CACHE_BYTES}, least recently searched dropped first — so typing
 * a query a letter at a time costs a scan of text already in memory. Every
 * answer is bounded twice: at most `limit` matching conversations, and a time
 * budget ({@link SEARCH_BUDGET_MS}) after which it stops where it is and
 * answers a `nextCursor`; between two conversations it yields, so a search
 * never holds up a streaming turn.
 */
import {
  THREAD_SEARCH_MAX_HITS,
  THREAD_SEARCH_MIN_QUERY_CHARS,
  RpcError,
  type Thread,
  type ThreadSearchHit,
  type ThreadSearchParams,
  type ThreadSearchResult,
} from '@uxnan/shared';
import type { ThreadStore } from './thread-store.js';
import {
  fold,
  matchesAll,
  queryTerms,
  searchTurns,
  searchableBytes,
  searchableTurns,
  type SearchableTurn,
} from './thread-digest.js';

/** Most bytes of folded digests kept in memory between searches. */
export const SEARCH_CACHE_BYTES = 32 * 1024 * 1024;

/** How long one answer may search before it answers what it found and a cursor. */
export const SEARCH_BUDGET_MS = 250;

/** Longest query, in characters. */
const MAX_QUERY_CHARS = 256;

interface CachedDigest {
  version: number;
  /** The conversation's `updatedAt` when it was read — one that moved is read again. */
  updatedAt: number;
  turns: SearchableTurn[];
  bytes: number;
}

export interface ThreadSearchOptions {
  cacheBytes?: number;
  budgetMs?: number;
  /** Clock for the time budget (tests). */
  now?: () => number;
}

export class ThreadSearch {
  readonly #store: ThreadStore;
  readonly #cacheBytes: number;
  readonly #budgetMs: number;
  readonly #now: () => number;
  /** Folded digests, least recently searched first. */
  readonly #cache = new Map<string, CachedDigest>();
  #cachedBytes = 0;

  constructor(store: ThreadStore, options: ThreadSearchOptions = {}) {
    this.#store = store;
    this.#cacheBytes = options.cacheBytes ?? SEARCH_CACHE_BYTES;
    this.#budgetMs = options.budgetMs ?? SEARCH_BUDGET_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  async search(params: ThreadSearchParams): Promise<ThreadSearchResult> {
    const query = params.query.trim();
    if (query.length < THREAD_SEARCH_MIN_QUERY_CHARS || query.length > MAX_QUERY_CHARS) {
      throw RpcError.invalidParams(
        `query must be ${THREAD_SEARCH_MIN_QUERY_CHARS}–${MAX_QUERY_CHARS} characters`,
      );
    }
    const terms = queryTerms(query);
    if (terms.length === 0) throw RpcError.invalidParams('query has no words');
    const limit = Math.min(
      THREAD_SEARCH_MAX_HITS,
      Math.max(1, Math.floor(params.limit ?? THREAD_SEARCH_MAX_HITS)),
    );
    const start = params.cursor !== undefined ? Number.parseInt(params.cursor, 10) : 0;
    if (!Number.isInteger(start) || start < 0) throw RpcError.invalidParams('invalid cursor');

    const { threads } = await this.#store.listThreads(params.projectId);
    const scope = threads
      .filter((t) => params.includeArchived === true || t.status !== 'archived')
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const deadline = this.#now() + this.#budgetMs;
    const hits: ThreadSearchHit[] = [];
    let index = start;
    for (; index < scope.length; index++) {
      if (hits.length >= limit || (index > start && this.#now() > deadline)) break;
      const hit = await this.#searchThread(scope[index]!, terms);
      if (hit) hits.push(hit);
      // Every other request gets its turn between two conversations.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return {
      hits,
      ...(index < scope.length ? { nextCursor: String(index) } : {}),
      searched: index - start,
      total: scope.length,
    };
  }

  async #searchThread(
    thread: Thread,
    terms: readonly string[],
  ): Promise<ThreadSearchHit | undefined> {
    const titleMatch = matchesAll(fold(thread.title), terms);
    let turns: SearchableTurn[];
    try {
      turns = await this.#turnsOf(thread);
    } catch {
      // A conversation deleted mid-search, or one whose files cannot be read:
      // its title still counts.
      turns = [];
    }
    const { matches, matchCount } = searchTurns(turns, terms);
    if (!titleMatch && matchCount === 0) return undefined;
    return { threadId: thread.id, titleMatch, matches, matchCount };
  }

  async #turnsOf(thread: Thread): Promise<SearchableTurn[]> {
    const version = this.#store.digestVersion(thread.id);
    const cached = this.#cache.get(thread.id);
    if (cached && cached.version === version && cached.updatedAt === thread.updatedAt) {
      // Most recently searched now.
      this.#cache.delete(thread.id);
      this.#cache.set(thread.id, cached);
      return cached.turns;
    }
    const digests = await this.#store.digestTurns(thread.id);
    const turns = searchableTurns(digests);
    this.#remember(thread.id, {
      version: this.#store.digestVersion(thread.id),
      updatedAt: thread.updatedAt,
      turns,
      bytes: searchableBytes(turns),
    });
    return turns;
  }

  #remember(threadId: string, entry: CachedDigest): void {
    const previous = this.#cache.get(threadId);
    if (previous) {
      this.#cachedBytes -= previous.bytes;
      this.#cache.delete(threadId);
    }
    this.#cache.set(threadId, entry);
    this.#cachedBytes += entry.bytes;
    for (const [id, old] of this.#cache) {
      if (this.#cachedBytes <= this.#cacheBytes || id === threadId) break;
      this.#cache.delete(id);
      this.#cachedBytes -= old.bytes;
    }
  }
}
