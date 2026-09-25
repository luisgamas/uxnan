/**
 * Persistent conversation store (threads → turns → messages), one file per
 * conversation under `~/.uxnan/threads/<threadId>.json`. Mutations are
 * serialized through a mutex so concurrent turn/delta updates don't corrupt the
 * read-modify-write cycle, and the conversations are held in memory between
 * them (this process is their only reader and writer).
 *
 * The layout is load-bearing, not housekeeping. Every streamed token mutates a
 * conversation, and while all of them shared one `threads.json` each token
 * re-read, re-serialized and rewrote the entire store: 93 ms per delta on a
 * real 8.4 MB one, which queued up behind the mutex and throttled a reply to a
 * quarter of its natural speed (measured: the same answer took 116 s against
 * that store and 26 s against an empty one). Per conversation the median write
 * is a few KB, and one conversation's size no longer taxes every other.
 *
 * Source: architecture/02a-system-architecture.md §6 (domain models).
 */
import { randomUUID } from 'node:crypto';
import type {
  AccessMode,
  Message,
  MessageRole,
  Thread,
  ThreadList,
  ThreadOrigin,
  ThreadStatus,
  ThreadTitleSource,
  Turn,
  TurnList,
  TurnStatus,
} from '@uxnan/shared';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { provisionalTitle } from '../agents/thread-title.js';
import { SyncLedger } from '../sync/sync-ledger.js';
import { utcDayKey } from '../metrics/day.js';
import type { ConversationMetricEvent, TurnMetricEvent } from '../metrics/metrics-store.js';

/**
 * What a mutation changed, so only those conversation files are rewritten.
 * Both lists are thread ids; omitting them writes nothing.
 */
interface MutationScope<T> {
  result: T;
  /** Conversations whose file must be (re)written. */
  write?: readonly string[];
  /** Conversations whose file must be deleted. */
  remove?: readonly string[];
}

/**
 * A change to a thread's summary, announced after it is on disk. The store is
 * the ONE place these come from, so no caller can change a thread and forget to
 * tell the clients (architecture/02a §5.8.17).
 */
export type ThreadChange =
  | { type: 'updated'; thread: Thread }
  | { type: 'deleted'; threadId: string; rev: number };

/** The name a thread has before anyone named it. */
export const PLACEHOLDER_THREAD_TITLE = 'New thread';

/** How many times the bridge asks an agent for a title before giving up. */
export const MAX_TITLE_ATTEMPTS = 2;

interface StoredMessage {
  id: string;
  turnId: string;
  role: MessageRole;
  text: string;
  /** The agent's accumulated reasoning ("thinking") for this message, if any. */
  thinking?: string;
  /** Structured content blocks (command_execution/diff/tool) for this message. */
  blocks?: unknown[];
  /**
   * The message's text runs and structured blocks **in the order they streamed
   * in** (text runs as `{ type:'text', text }`, blocks verbatim). This preserves
   * the interleave that `text` + `blocks` lose when stored separately, so a
   * `turn/list` re-sync can render the work log inline with the response instead
   * of stacking all activity above one merged paragraph. Maintained from the
   * first delta/block alongside `text`/`blocks` (the text runs concatenate to
   * `text`; the non-text entries are exactly `blocks`). Emitted on the wire only
   * when it carries a structured block — see {@link toMessage} — so plain-text
   * turns keep the lean shape and need no client interleaving.
   */
  segments?: unknown[];
  /** Token usage for this turn (so the phone restores the context meter). */
  usage?: { tokens: number; contextWindow?: number };
  createdAt: number;
}

interface StoredTurn {
  id: string;
  threadId: string;
  /** Position in the thread, 1-based, never reused (see `Turn.seq`). */
  seq?: number;
  status: TurnStatus;
  messages: StoredMessage[];
  createdAt: number;
  completedAt?: number;
  /**
   * Deterministic id assigned by {@link SessionHistoryReader} to the matching
   * turn in the agent's native transcript. Bridge-created turns retain their
   * public UUID; this private link prevents a later native-history refresh from
   * importing the same turn a second time.
   */
  nativeHistoryTurnId?: string;
  /**
   * For a `delivered` turn: the turn its message was folded into (see
   * {@link ThreadStore.deliverQueuedTurn}). Absent for every other status.
   */
  deliveredIntoTurnId?: string;
}

interface StoredThread {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
  agentId?: string;
  model?: string;
  cwd?: string;
  /**
   * The agent CLI's NATIVE session id (Claude `session_id`, Codex `thread_id`,
   * OpenCode `sessionID`, pi session id). Persisted so the on-disk session log can
   * be located for the `turn/list` history fallback after a bridge restart.
   */
  agentSessionId?: string;
  /** Per-thread access (approval) mode; persisted so the phone's choice sticks. */
  accessMode?: AccessMode;
  /**
   * Who named this thread (see {@link Thread.titleSource}). Absent on threads
   * stored before titles had a source — those all came from the opening
   * message, so absent is read as `prompt` and a generated title may replace it.
   */
  titleSource?: ThreadTitleSource;
  /** Titles requested from the agent so far (see {@link MAX_TITLE_ATTEMPTS}). */
  titleAttempts?: number;
  /** Which client started it. */
  origin?: ThreadOrigin;
  /** Sync revision of the last change to its summary. */
  rev?: number;
  /**
   * When someone last DECIDED its title (a hand rename) and its status
   * (archive / unarchive), on the bridge's clock. Private: what lets an action
   * a client took offline lose to a later one taken elsewhere
   * (architecture/02a §5.8.17) — the latest decision wins, whoever made it.
   */
  decidedAt?: { title?: number; status?: number };
}

/**
 * When an action a client reports happened, on the bridge's clock. A client
 * that could not send it at the time says how long ago it was (`ageMs`, by its
 * own clock — an age, so the two clocks never have to agree); one sent live
 * happened now.
 */
export function decisionTime(now: number, ageMs?: number): number {
  return ageMs === undefined ? now : now - Math.max(0, ageMs);
}

/** Whether a decision dated [at] comes after [previous] (none yet: it does). */
function isLatest(at: number, previous: number | undefined): boolean {
  return previous === undefined || at >= previous;
}

const DEFAULT_TURN_LIMIT = 20;

/** Statuses that end a turn — the only ones that stamp `completedAt`. */
const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  'completed',
  'error',
  'aborted',
  'cancelled',
]);

export interface StartTurnResult {
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export interface StartThreadInput {
  projectId: string;
  /** A name the caller chose — final, like a rename (`titleSource: 'user'`). */
  title?: string;
  agentId?: string;
  model?: string;
  cwd?: string;
  origin?: ThreadOrigin;
}

/** Runtime config the AgentManager needs to drive a thread's turns. */
export interface ThreadRuntime {
  agentId?: string;
  model?: string;
  cwd?: string;
  /** Persisted per-thread access (approval) mode, applied per turn. */
  accessMode?: AccessMode;
}

/** Result of merging an agent-owned transcript into one bridge thread. */
export interface NativeHistoryReconcileResult {
  /** Whether one or more genuinely external turns were imported or refreshed. */
  changed: boolean;
  /** Newly imported turn ids, in native transcript order. */
  importedTurnIds: string[];
}

/** Narrow persistence boundary used to project mutable thread history into the
 * bridge's durable activity ledger without making ThreadStore own that ledger. */
export interface ConversationMetricsSink {
  mergeConversationHistory(
    conversations: ConversationMetricEvent[],
    turns: TurnMetricEvent[],
  ): Promise<number>;
}

export class ThreadStore {
  readonly #state: DaemonState;
  readonly #metricsSink: ConversationMetricsSink | undefined;
  readonly #ledger: SyncLedger;
  readonly #listeners = new Set<(change: ThreadChange) => void>();
  /** Threads whose summary changed in the mutation running now (under the lock). */
  readonly #changed = new Set<string>();
  /** Threads deleted in the mutation running now, with their tombstone revision. */
  readonly #deleted: { threadId: string; rev: number }[] = [];
  #lock: Promise<void> = Promise.resolve();

  constructor(state: DaemonState, metricsSink?: ConversationMetricsSink, ledger?: SyncLedger) {
    this.#state = state;
    this.#metricsSink = metricsSink;
    this.#ledger = ledger ?? SyncLedger.memory();
  }

  /** Listen for thread changes (after they are on disk). Returns an unsubscribe. */
  onChange(listener: (change: ThreadChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async listThreads(projectId?: string): Promise<ThreadList> {
    const threads = await this.#read();
    const filtered = projectId ? threads.filter((t) => t.projectId === projectId) : threads;
    return { threads: filtered.map(toThread) };
  }

  /** Threads whose summary changed after revision [since] (all when omitted). */
  async threadsChangedSince(since?: number): Promise<Thread[]> {
    const threads = await this.#read();
    return threads.filter((t) => since === undefined || (t.rev ?? 0) > since).map(toThread);
  }

  /**
   * Point every thread at the project its folder belongs to now. Run once at
   * startup against the project registry, so threads stored before projects
   * were registered (or under a symlinked / worktree path) group under the same
   * project on every client. Returns how many moved.
   */
  async relinkProjects(
    projectIdFor: (cwd: string) => Promise<string | undefined>,
  ): Promise<number> {
    const threads = await this.#read();
    const moves = new Map<string, string>();
    for (const thread of threads) {
      if (thread.cwd === undefined) continue;
      const projectId = await projectIdFor(thread.cwd);
      if (projectId !== undefined && projectId !== thread.projectId)
        moves.set(thread.id, projectId);
    }
    if (moves.size === 0) return 0;
    return this.#mutate(async (all) => {
      for (const thread of all) {
        const projectId = moves.get(thread.id);
        if (projectId === undefined) continue;
        thread.projectId = projectId;
        this.#bump(thread);
      }
      return { result: moves.size, write: [...moves.keys()] };
    });
  }

  /** The folders conversations run in, for seeding the project registry. */
  async threadFolders(): Promise<string[]> {
    const threads = await this.#read();
    return [...new Set(threads.map((t) => t.cwd).filter((c): c is string => !!c))];
  }

  async getThread(threadId: string): Promise<Thread> {
    return toThread(await this.#requireThread(await this.#read(), threadId));
  }

  async listTurns(
    threadId: string,
    cursor?: string,
    limit?: number,
    fromEnd = false,
  ): Promise<TurnList> {
    const threads = await this.#read();
    const thread = await this.#requireThread(threads, threadId);
    const total = thread.turns.length;
    const size = limit && limit > 0 ? limit : DEFAULT_TURN_LIMIT;
    // `fromEnd` returns the last page (newest turns) so the phone can open a
    // long thread at its most recent messages and page backward from there.
    const start = fromEnd
      ? Math.max(0, total - size)
      : cursor
        ? Number.parseInt(cursor, 10) || 0
        : 0;
    const slice = thread.turns.slice(start, start + size);
    const result: TurnList = { turns: slice.map(toTurn), total };
    if (start + size < total) {
      result.nextCursor = String(start + size);
    }
    return result;
  }

  async getTurn(turnId: string): Promise<Turn> {
    const threads = await this.#read();
    for (const thread of threads) {
      const turn = thread.turns.find((t) => t.id === turnId);
      if (turn) return toTurn(turn);
    }
    throw notFound(`turn not found: ${turnId}`);
  }

  /**
   * Add completed turns that appeared in the agent's own session outside
   * Uxnan (for example in Codex Desktop or a CLI attached to the same native
   * session).
   *
   * Existing bridge turns remain authoritative: matching native turns are
   * linked to their bridge UUID and never replace queue state, usage, ordered
   * segments, or delivery status. A native-only turn keeps the reader's stable
   * id and may be refreshed on a later read. Missing native turns are never
   * deleted because compaction and temporary read failures can shorten a
   * provider transcript without meaning that the user deleted history.
   */
  async reconcileNativeHistory(
    threadId: string,
    nativeTurns: Turn[],
    now: number,
  ): Promise<NativeHistoryReconcileResult> {
    const captured = await this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      const candidates = nativeTurns.filter(
        (turn) => turn.threadId === threadId && importableNativeTurn(turn),
      );
      if (candidates.length === 0) {
        return {
          result: {
            reconcile: { changed: false, importedTurnIds: [] },
            thread: undefined,
          },
          write: [],
        };
      }

      const claimed = new Set<StoredTurn>();
      const importedTurnIds: string[] = [];
      let refreshed = false;
      let linked = false;
      let pruned = false;

      for (const native of candidates) {
        let stored = thread.turns.find(
          (turn) =>
            !claimed.has(turn) && (turn.nativeHistoryTurnId === native.id || turn.id === native.id),
        );
        // Heal a turn imported before the identity match below could recognize
        // it: that row and the bridge's own record of the same exchange are the
        // same turn, shown twice. Only ever drops an imported row (its id IS the
        // native id) that has a bridge-created twin — a genuinely external turn
        // has none, so it is never touched.
        if (stored !== undefined && stored.id === native.id) {
          const twin = findNativeTwin(thread.turns, native, claimed, stored);
          if (twin) {
            thread.turns.splice(thread.turns.indexOf(stored), 1);
            pruned = true;
            stored = twin;
          }
        }
        stored ??= findNativeTwin(thread.turns, native, claimed, undefined);

        if (stored) {
          claimed.add(stored);
          if (stored.nativeHistoryTurnId === undefined) {
            stored.nativeHistoryTurnId = native.id;
            linked = true;
          }
          // Only native-imported rows are refreshed from native history. A
          // bridge-created row may contain richer ordered segments and usage.
          if (stored.id === native.id) {
            const replacement = storedTurnFromNative(native);
            replacement.nativeHistoryTurnId = native.id;
            if (stored.seq !== undefined) replacement.seq = stored.seq;
            if (JSON.stringify(toTurn(stored)) !== JSON.stringify(toTurn(replacement))) {
              const index = thread.turns.indexOf(stored);
              thread.turns[index] = replacement;
              claimed.delete(stored);
              claimed.add(replacement);
              refreshed = true;
            }
          }
          continue;
        }

        const imported = storedTurnFromNative(native);
        imported.nativeHistoryTurnId = native.id;
        imported.seq = nextSeq(thread);
        thread.turns.push(imported);
        claimed.add(imported);
        importedTurnIds.push(imported.id);
      }

      const changed = importedTurnIds.length > 0 || refreshed || pruned;
      if (changed) {
        // An imported turn takes the next position rather than being sorted in
        // by its timestamp: every client orders the conversation by `seq`, and
        // a position, once handed out, never moves.
        thread.updatedAt = now;
        this.#bump(thread);
      }
      return {
        result: {
          reconcile: { changed, importedTurnIds },
          thread: changed ? structuredCloneThread(thread) : undefined,
        },
        write: changed || linked ? [threadId] : [],
      };
    });
    if (captured.thread) await this.#captureMetrics(captured.thread);
    return captured.reconcile;
  }

  async startThread(input: StartThreadInput, now: number): Promise<Thread> {
    const created = await this.#mutate(async (threads) => {
      const created: StoredThread = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title ?? PLACEHOLDER_THREAD_TITLE,
        ...(input.title !== undefined ? { titleSource: 'user' as const } : {}),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        turns: [],
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.origin !== undefined ? { origin: { ...input.origin } } : {}),
      };
      threads.push(created);
      this.#ledger.revive('thread', created.id);
      this.#bump(created);
      return { result: structuredCloneThread(created), write: [created.id] };
    });
    await this.#captureMetrics(created);
    return toThread(created);
  }

  /** Agent/model/cwd a thread's turns run with (used by `turn/send`). */
  async getThreadRuntime(threadId: string): Promise<ThreadRuntime> {
    const thread = await this.#requireThread(await this.#read(), threadId);
    const runtime: ThreadRuntime = {};
    if (thread.agentId !== undefined) runtime.agentId = thread.agentId;
    if (thread.model !== undefined) runtime.model = thread.model;
    if (thread.cwd !== undefined) runtime.cwd = thread.cwd;
    if (thread.accessMode !== undefined) runtime.accessMode = thread.accessMode;
    return runtime;
  }

  /** Where to find a thread's on-disk session log (turn/list history fallback). */
  async getHistorySource(
    threadId: string,
  ): Promise<{ agentId?: string; agentSessionId?: string; cwd?: string }> {
    const thread = await this.#requireThread(await this.#read(), threadId);
    const source: { agentId?: string; agentSessionId?: string; cwd?: string } = {};
    if (thread.agentId !== undefined) source.agentId = thread.agentId;
    if (thread.agentSessionId !== undefined) source.agentSessionId = thread.agentSessionId;
    if (thread.cwd !== undefined) source.cwd = thread.cwd;
    return source;
  }

  /**
   * Record the agent's native session id for a thread (idempotent). Called once
   * the adapter reports it, so the on-disk history fallback can find the log.
   */
  setAgentSession(threadId: string, agentSessionId: string, now: number): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread || thread.agentSessionId === agentSessionId) return;
      thread.agentSessionId = agentSessionId;
      thread.updatedAt = now;
      this.#bump(thread);
    });
  }

  /**
   * Opening a conversation. Deliberately changes nothing: it used to flip the
   * status to `active` and bump `updatedAt` without telling anyone, so merely
   * opening an archived conversation on the phone un-archived it on the desktop
   * and reshuffled every activity-sorted list. Archiving is only ever undone by
   * `thread/unarchive`. Rejects an unknown thread.
   */
  async resumeThread(threadId: string): Promise<void> {
    await this.#requireThread(await this.#read(), threadId);
  }

  async setModel(threadId: string, model: string, now: number): Promise<void> {
    const updated = await this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.model = model;
      thread.updatedAt = now;
      this.#bump(thread);
      return structuredCloneThread(thread);
    });
    await this.#captureMetrics(updated);
  }

  /**
   * Renames a thread; returns the updated thread for the phone to echo.
   *
   * `source` records who named it (see {@link Thread.titleSource}). It defaults
   * to `user` because that is who calls `thread/rename` — a hand-picked name is
   * final and nothing generated may replace it. A `prompt` (provisional) name
   * never replaces a `user` or `agent` one: a client that had not heard of the
   * generated title yet must not be able to throw it away.
   */
  renameThread(
    threadId: string,
    title: string,
    now: number,
    source: ThreadTitleSource = 'user',
    at: number = now,
  ): Promise<Thread> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      const weaker =
        source === 'prompt' && (thread.titleSource === 'user' || thread.titleSource === 'agent');
      // A hand rename made offline loses to one made after it, elsewhere.
      const superseded = source === 'user' && !isLatest(at, thread.decidedAt?.title);
      if (weaker || superseded || (thread.title === title && thread.titleSource === source)) {
        return toThread(thread);
      }
      thread.title = title;
      thread.titleSource = source;
      if (source === 'user') thread.decidedAt = { ...thread.decidedAt, title: at };
      thread.updatedAt = Math.max(thread.updatedAt, at);
      this.#bump(thread);
      return toThread(thread);
    });
  }

  /**
   * Whether the bridge should ask the agent for a title now, counting the try.
   *
   * Yes while the name is still provisional and fewer than
   * {@link MAX_TITLE_ATTEMPTS} were made — so a first turn that failed, was
   * stopped, or was followed by a queued message still gets a real name on a
   * later turn, instead of the old "first turn only" rule that left it
   * provisional for good.
   */
  claimTitleGeneration(threadId: string): Promise<boolean> {
    return this.#mutate(async (threads) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return { result: false };
      if (thread.titleSource === 'user' || thread.titleSource === 'agent') return { result: false };
      const attempts = thread.titleAttempts ?? 0;
      if (attempts >= MAX_TITLE_ATTEMPTS) return { result: false };
      thread.titleAttempts = attempts + 1;
      return { result: true, write: [threadId] };
    });
  }

  /**
   * Store a generated title, but only over a provisional one.
   *
   * The generated name arrives after a turn the user watched for minutes, and
   * they may well have renamed the thread by hand while waiting — so this
   * refuses to overwrite a `user` title (and an `agent` one, which is already
   * as good). Returns the updated thread, or `undefined` when it declined,
   * which is also the signal not to notify anyone.
   */
  applyGeneratedTitle(threadId: string, title: string, now: number): Promise<Thread | undefined> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return undefined;
      // Absent means it predates `titleSource`, and those are all `prompt`.
      if (thread.titleSource !== undefined && thread.titleSource !== 'prompt') return undefined;
      if (thread.title === title) return undefined;
      thread.title = title;
      thread.titleSource = 'agent';
      thread.updatedAt = now;
      this.#bump(thread);
      return toThread(thread);
    });
  }

  /**
   * Persists the per-thread access (approval) [mode]. Idempotent: setting the
   * same mode is a no-op (does not bump `updatedAt`). Returns the updated Thread.
   */
  setAccessMode(threadId: string, mode: AccessMode, now: number): Promise<Thread> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      if (thread.accessMode !== mode) {
        thread.accessMode = mode;
        thread.updatedAt = now;
        this.#bump(thread);
      }
      return toThread(thread);
    });
  }

  /**
   * Archives a thread (status → `archived`). Nothing is removed; reversible.
   * [at] dates the decision (see {@link decisionTime}); one older than the
   * thread's last archive/unarchive is superseded and changes nothing.
   */
  archiveThread(threadId: string, now: number, at: number = now): Promise<Thread> {
    return this.#setStatus(threadId, 'archived', at);
  }

  /** Restores an archived thread (status → `active`); [at] as for archiving. */
  unarchiveThread(threadId: string, now: number, at: number = now): Promise<Thread> {
    return this.#setStatus(threadId, 'active', at);
  }

  /**
   * Permanently removes a thread (and its turns). Rejects if it is unknown.
   *
   * [at] dates the decision. A delete decided before the thread's last
   * activity — a turn, a rename, an archive, made after it elsewhere — is
   * superseded: nobody deletes work they had not seen. Resolves whether the
   * thread was removed.
   */
  deleteThread(threadId: string, at?: number): Promise<boolean> {
    return this.#mutate(async (threads) => {
      const index = threads.findIndex((t) => t.id === threadId);
      if (index === -1) throw notFound(`thread not found: ${threadId}`);
      const thread = threads[index];
      if (thread && at !== undefined && at < lastDecision(thread)) return { result: false };
      if (thread && this.#metricsSink) {
        const projection = metricProjection(thread);
        // This final projection is strict (not best-effort): the mutable source
        // remains available if the historical ledger cannot be persisted.
        await this.#metricsSink.mergeConversationHistory(
          [projection.conversation],
          projection.turns,
        );
      }
      threads.splice(index, 1);
      this.#deleted.push({ threadId, rev: this.#ledger.tombstone('thread', threadId) });
      return { result: true, remove: [threadId] };
    });
  }

  #setStatus(threadId: string, status: ThreadStatus, at: number): Promise<Thread> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      if (!isLatest(at, thread.decidedAt?.status)) return toThread(thread);
      thread.decidedAt = { ...thread.decidedAt, status: at };
      if (thread.status !== status) {
        thread.status = status;
        thread.updatedAt = Math.max(thread.updatedAt, at);
        this.#bump(thread);
      }
      return toThread(thread);
    });
  }

  async forkThread(threadId: string, now: number): Promise<Thread> {
    const fork = await this.#mutate(async (threads) => {
      const source = await this.#requireThread(threads, threadId);
      const copy: StoredThread = {
        ...structuredCloneThread(source),
        id: randomUUID(),
        title: `${source.title} (fork)`,
        createdAt: now,
        updatedAt: now,
      };
      threads.push(copy);
      this.#bump(copy);
      return { result: structuredCloneThread(copy), write: [copy.id] };
    });
    await this.#captureMetrics(fork);
    return toThread(fork);
  }

  async startTurn(threadId: string, userText: string, now: number): Promise<StartTurnResult> {
    return this.#createTurn(threadId, userText, 'streaming', now);
  }

  /**
   * Stores a turn the user sent while another one was in flight. Identical to
   * {@link startTurn} except for the status: the user message is persisted right
   * away (so it survives a resync and shows in the thread), the assistant one
   * stays empty, and nothing is handed to an adapter until
   * {@link beginQueuedTurn} promotes it.
   */
  async queueTurn(threadId: string, userText: string, now: number): Promise<StartTurnResult> {
    return this.#createTurn(threadId, userText, 'queued', now);
  }

  /** Promotes a `queued` turn to `streaming` as the queue drains to it. */
  beginQueuedTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'streaming', now);
  }

  /**
   * Marks a queued turn as `cancelled` — removed before it ever ran. The turn is
   * kept (not deleted) so the user's message stays in the thread with a visible
   * "cancelled" mark; `aborted` stays reserved for a turn that was running.
   */
  cancelQueuedTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'cancelled', now);
  }

  /**
   * Marks a queued turn as `delivered` — the agent took its message **into the
   * turn already running** ({@link intoTurnId}) instead of making it wait, so
   * it will never run on its own. Terminal and successful: unlike `cancelled`,
   * the message did reach the agent, and the reply is part of `intoTurnId`.
   *
   * The turn keeps its own (empty) assistant message rather than dropping it,
   * so every turn in the store has the same shape and a client that renders
   * turns generically needs no special case.
   */
  deliverQueuedTurn(
    threadId: string,
    turnId: string,
    intoTurnId: string,
    now: number,
  ): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      const turn = thread.turns.find((t) => t.id === turnId);
      if (!turn) return;
      turn.status = 'delivered';
      turn.completedAt = now;
      turn.deliveredIntoTurnId = intoTurnId;
      thread.updatedAt = now;
      this.#bump(thread);
    });
  }

  /** The ids of a thread's `queued` turns, oldest first (their run order). */
  async queuedTurnIds(threadId: string): Promise<string[]> {
    const threads = await this.#read();
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return [];
    return thread.turns.filter((t) => t.status === 'queued').map((t) => t.id);
  }

  /**
   * Marks every still-`queued` turn across all threads as `cancelled`. Called
   * once at startup: the in-memory queue does not survive a bridge restart (nor
   * does the in-flight turn it was waiting behind), so leaving turns `queued`
   * would strand them forever. Cancelling them keeps the record honest — the
   * user sees exactly which messages never went out. Returns how many it closed.
   */
  async cancelOrphanedQueuedTurns(now: number): Promise<number> {
    return this.#mutate(async (threads) => {
      let cancelled = 0;
      const write: string[] = [];
      for (const thread of threads) {
        const before = cancelled;
        for (const turn of thread.turns) {
          if (turn.status !== 'queued') continue;
          turn.status = 'cancelled';
          turn.completedAt = now;
          cancelled += 1;
        }
        if (cancelled !== before) {
          write.push(thread.id);
          this.#bump(thread);
        }
      }
      return { result: cancelled, write };
    });
  }

  async #createTurn(
    threadId: string,
    userText: string,
    status: TurnStatus,
    now: number,
  ): Promise<StartTurnResult> {
    const captured = await this.#mutateThread(threadId, async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      const turnId = randomUUID();
      const userMessage: StoredMessage = {
        id: randomUUID(),
        turnId,
        role: 'user',
        text: userText,
        createdAt: now,
      };
      const assistantMessage: StoredMessage = {
        id: randomUUID(),
        turnId,
        role: 'assistant',
        text: '',
        createdAt: now,
      };
      thread.turns.push({
        id: turnId,
        threadId,
        seq: nextSeq(thread),
        status,
        messages: [userMessage, assistantMessage],
        createdAt: now,
      });
      thread.updatedAt = now;
      // The bridge names the conversation from its opening message the moment
      // it is stored — every client sees the same provisional name, and none
      // has to (or may) invent its own. Only over the placeholder: a name the
      // caller gave at `thread/start` is the user's.
      if (thread.titleSource === undefined && isPlaceholderTitle(thread.title)) {
        const provisional = provisionalTitle(userText);
        if (provisional.length > 0) {
          thread.title = provisional;
          thread.titleSource = 'prompt';
        }
      }
      this.#bump(thread);
      return {
        result: { turnId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id },
        thread: structuredCloneThread(thread),
      };
    });
    await this.#captureMetrics(captured.thread);
    return captured.result;
  }

  appendDelta(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      if (this.#isTerminal(threads, threadId, turnId)) return;
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.text += delta;
      appendTextSegment(assistant, delta);
      this.#touch(threads, threadId, now);
    });
  }

  /** Appends a reasoning ("thinking") chunk to the turn's assistant message. */
  appendThinking(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      if (this.#isTerminal(threads, threadId, turnId)) return;
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.thinking = (assistant.thinking ?? '') + delta;
      this.#touch(threads, threadId, now);
    });
  }

  /**
   * Appends a structured content block (command/diff/tool) to the message.
   *
   * [beforeText] marks a block that arrived from a **parallel/background**
   * activity (e.g. a Claude Code subagent's tool run) while the assistant's
   * main text was still streaming: it is inserted BEFORE the trailing open
   * text run instead of after it, so the run is never severed — appending
   * would make the next delta open a new run and render the sentence split
   * mid-word by an activity card. Sequential blocks (the default) land at a
   * real text-run boundary and keep plain arrival-order append.
   */
  appendBlock(
    threadId: string,
    turnId: string,
    content: unknown,
    now: number,
    beforeText = false,
  ): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      if (this.#isTerminal(threads, threadId, turnId)) return;
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.blocks = [...(assistant.blocks ?? []), content];
      const segments = (assistant.segments ??= []);
      const last = segments[segments.length - 1];
      if (beforeText && isTextSegment(last)) {
        segments.splice(segments.length - 1, 0, content);
      } else {
        segments.push(content);
      }
      this.#touch(threads, threadId, now);
    });
  }

  /** Records a turn's token usage on its assistant message (context meter). */
  async setUsage(
    threadId: string,
    turnId: string,
    usage: { tokens: number; contextWindow?: number },
    now: number,
  ): Promise<void> {
    const updated = await this.#mutateThread(threadId, async (threads) => {
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.usage = usage;
      this.#touch(threads, threadId, now);
      return structuredCloneThread(await this.#requireThread(threads, threadId));
    });
    await this.#captureMetrics(updated);
  }

  completeTurn(
    threadId: string,
    turnId: string,
    finalText: string | undefined,
    now: number,
  ): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      const turn = this.#turn(threads, threadId, turnId);
      // A turn only ends once. An adapter whose CLI keeps running past its own
      // end-of-turn event can emit a second completion for the same turn; taking
      // it would overwrite the reply the user already read with whatever the
      // later one carried, and (in the manager) drain the message queue twice.
      if (TERMINAL_TURN_STATUSES.has(turn.status)) return;
      if (finalText !== undefined) {
        const assistant = turn.messages.find((m) => m.role === 'assistant');
        if (assistant) reconcileAssistantWithFinalText(assistant, finalText);
      }
      turn.status = 'completed';
      turn.completedAt = now;
      this.#touch(threads, threadId, now);
      this.#bumpId(threads, threadId);
    });
  }

  failTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'error', now);
  }

  abortTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'aborted', now);
  }

  /**
   * Whether a turn has already ended, so late output must not be appended to it.
   *
   * Every adapter that ends a turn on a **protocol event** (all of them except
   * Antigravity, which ends on process exit) leaves its CLI alive afterwards and
   * can therefore emit after the end — Claude Code demonstrably does, when the
   * model leaves background work running and the CLI later wakes it for another
   * turn. Appending that output to a closed turn silently rewrote a reply the
   * user had already read, so the store refuses it instead. Callers get a no-op
   * rather than a throw: late output is a normal race, not a programming error.
   *
   * A missing thread/turn is left to the caller's own lookup to report.
   */
  #isTerminal(threads: StoredThread[], threadId: string, turnId: string): boolean {
    const thread = threads.find((t) => t.id === threadId);
    const turn = thread?.turns.find((t) => t.id === turnId);
    return turn !== undefined && TERMINAL_TURN_STATUSES.has(turn.status);
  }

  #setTurnStatus(threadId: string, turnId: string, status: TurnStatus, now: number): Promise<void> {
    return this.#mutateThread(threadId, async (threads) => {
      const turn = this.#turn(threads, threadId, turnId);
      turn.status = status;
      // Only a terminal status stamps `completedAt`. `beginQueuedTurn` moves a
      // turn from `queued` to `streaming` — it is starting, not ending, and
      // stamping it there would date a live turn as finished.
      if (TERMINAL_TURN_STATUSES.has(status)) turn.completedAt = now;
      this.#touch(threads, threadId, now);
      this.#bumpId(threads, threadId);
    });
  }

  #assistantMessage(threads: StoredThread[], threadId: string, turnId: string): StoredMessage {
    const turn = this.#turn(threads, threadId, turnId);
    const assistant = turn.messages.find((m) => m.role === 'assistant');
    if (!assistant) throw notFound(`assistant message not found for turn: ${turnId}`);
    return assistant;
  }

  #turn(threads: StoredThread[], threadId: string, turnId: string): StoredTurn {
    const thread = threads.find((t) => t.id === threadId);
    const turn = thread?.turns.find((t) => t.id === turnId);
    if (!turn) throw notFound(`turn not found: ${turnId}`);
    return turn;
  }

  #touch(threads: StoredThread[], threadId: string, now: number): void {
    const thread = threads.find((t) => t.id === threadId);
    if (thread) thread.updatedAt = now;
  }

  /**
   * Stamp a thread's summary as changed: it takes the next sync revision and is
   * announced once the mutation is on disk. Only for changes a client shows in a
   * list (title, status, model, turns created or ended…) — never for streamed
   * tokens, which reach clients as their own notifications.
   */
  #bump(thread: StoredThread): void {
    thread.rev = this.#ledger.next();
    this.#changed.add(thread.id);
  }

  #bumpId(threads: StoredThread[], threadId: string): void {
    const thread = threads.find((t) => t.id === threadId);
    if (thread) this.#bump(thread);
  }

  async #requireThread(threads: StoredThread[], threadId: string): Promise<StoredThread> {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw notFound(`thread not found: ${threadId}`);
    return thread;
  }

  /** Backfills every currently stored thread/turn into the durable activity
   * ledger. Idempotent and intentionally non-destructive: ledger rows absent
   * from `threads.json` are historical records and must remain. */
  async captureAllMetrics(): Promise<number> {
    if (!this.#metricsSink) return 0;
    const threads = await this.#read();
    const conversations: ConversationMetricEvent[] = [];
    const turns: TurnMetricEvent[] = [];
    for (const thread of threads) {
      const projection = metricProjection(thread);
      conversations.push(projection.conversation);
      turns.push(...projection.turns);
    }
    return this.#metricsSink.mergeConversationHistory(conversations, turns);
  }

  /** Best-effort incremental projection. A later `captureAllMetrics` repairs any
   * transient ledger-write failure without blocking conversation operations. */
  async #captureMetrics(thread: StoredThread): Promise<void> {
    if (!this.#metricsSink) return;
    const projection = metricProjection(thread);
    await this.#metricsSink
      .mergeConversationHistory([projection.conversation], projection.turns)
      .catch(() => undefined);
  }

  /**
   * The conversations, held in memory and loaded once.
   *
   * Re-reading them from disk per call bought nothing — this process is the
   * only reader and writer of that state (a single-instance lock guarantees
   * it), and on a real 8.4 MB store the read cost 36 ms of the 93 ms every
   * streamed token spent here. The cache changes no durability guarantee:
   * every mutation still writes before it resolves.
   *
   * Memoized as the in-flight PROMISE, never as the resolved value: reads do not
   * take the write lock, so two that arrive before the first load finishes would
   * otherwise each load their own array, and every mutation applied to whichever
   * one lost the race would be silently dropped. The suite caught exactly that —
   * queue tests failing about one run in three.
   */
  #threads: Promise<StoredThread[]> | undefined;

  #read(): Promise<StoredThread[]> {
    this.#threads ??= this.#load();
    return this.#threads;
  }

  /**
   * Loads every conversation, migrating a legacy single-file store on the way.
   *
   * The old `threads.json` is read once, split into one file per conversation,
   * and then kept under `.migrated` rather than deleted — it is the user's only
   * copy of their history until the new files are proven on disk.
   */
  async #load(): Promise<StoredThread[]> {
    const threads = await this.#loadFiles();
    for (const thread of threads) {
      numberTurns(thread);
      this.#ledger.observe(thread.rev);
    }
    return threads;
  }

  async #loadFiles(): Promise<StoredThread[]> {
    const legacy = await this.#state.readJson<StoredThread[]>(DAEMON_FILES.threads);
    if (legacy === null) return this.#state.readThreadFiles<StoredThread>();
    // A legacy file alongside per-thread files means a previous migration was
    // interrupted; the per-thread files are the newer truth, so they win and
    // the legacy one is only retired.
    const migrated = await this.#state.readThreadFiles<StoredThread>();
    const known = new Set(migrated.map((thread) => thread.id));
    for (const thread of legacy) {
      if (known.has(thread.id)) continue;
      await this.#state.writeThreadFile(thread.id, thread);
      migrated.push(thread);
    }
    await this.#state.retireLegacyThreads();
    return migrated;
  }

  /**
   * Runs `fn` under the write lock with the current conversations, then writes
   * only the files it reports as touched.
   *
   * Naming them is deliberately explicit and required: writing the whole store
   * on every mutation is what made a streamed token cost 93 ms, and a mutation
   * that silently forgot to name its thread would lose that write instead —
   * so the type makes it impossible to omit.
   */
  #mutate<T>(fn: (threads: StoredThread[]) => Promise<MutationScope<T>>): Promise<T> {
    const run = this.#lock.then(async () => {
      this.#changed.clear();
      this.#deleted.length = 0;
      try {
        const threads = await this.#read();
        const scope = await fn(threads);
        for (const id of scope.remove ?? []) await this.#state.removeThreadFile(id);
        const write = new Set([...(scope.write ?? []), ...this.#changed]);
        for (const id of write) {
          const thread = threads.find((t) => t.id === id);
          if (thread) await this.#state.writeThreadFile(id, thread);
        }
        if (this.#changed.size > 0 || this.#deleted.length > 0) {
          // The revisions go to disk before anyone hears of them, so a client
          // can never hold a revision the bridge might hand out again.
          await this.#ledger.flush();
          this.#announce(threads);
        }
        return scope.result;
      } finally {
        this.#changed.clear();
        this.#deleted.length = 0;
      }
    });
    // Keep the chain alive regardless of individual failures.
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #announce(threads: StoredThread[]): void {
    const changes: ThreadChange[] = [];
    for (const id of this.#changed) {
      const thread = threads.find((t) => t.id === id);
      if (thread) changes.push({ type: 'updated', thread: toThread(thread) });
    }
    for (const { threadId, rev } of this.#deleted) changes.push({ type: 'deleted', threadId, rev });
    for (const change of changes) {
      for (const listener of this.#listeners) {
        try {
          listener(change);
        } catch {
          /* a listener's failure is its own; the change is already stored */
        }
      }
    }
  }

  /** {@link #mutate} for the common case: one conversation changed. */
  #mutateThread<T>(threadId: string, fn: (threads: StoredThread[]) => Promise<T>): Promise<T> {
    return this.#mutate(async (threads) => ({
      result: await fn(threads),
      write: [threadId],
    }));
  }
}

/** Project one mutable stored thread into stable ledger rows. */
function metricProjection(thread: StoredThread): {
  conversation: ConversationMetricEvent;
  turns: TurnMetricEvent[];
} {
  const conversation: ConversationMetricEvent = {
    id: thread.id,
    ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {}),
    ...(thread.model !== undefined ? { model: thread.model } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
  const turns = thread.turns.map((turn): TurnMetricEvent => {
    const messageDays = new Map<number, number>();
    let tokens = 0;
    let tokenDay = utcDayKey(turn.createdAt);
    for (const message of turn.messages) {
      const day = utcDayKey(message.createdAt);
      messageDays.set(day, (messageDays.get(day) ?? 0) + 1);
      if (message.role === 'assistant') {
        tokenDay = day;
        const reported = message.usage?.tokens;
        if (typeof reported === 'number' && reported > 0) tokens += reported;
      }
    }
    return {
      id: `${thread.id}:${turn.id}`,
      threadId: thread.id,
      ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {}),
      ...(thread.model !== undefined ? { model: thread.model } : {}),
      messageDays: [...messageDays].map(([day, messages]) => ({ day, messages })),
      tokens,
      tokenDay,
      updatedAt: thread.updatedAt,
    };
  });
  return { conversation, turns };
}

function toThread(thread: StoredThread): Thread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status: thread.status,
    turnCount: thread.turns.length,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {}),
    ...(thread.model !== undefined ? { model: thread.model } : {}),
    ...(thread.cwd !== undefined ? { cwd: thread.cwd } : {}),
    // The agent's NATIVE session id (Claude `session_id`, OpenCode `sessionID`,
    // …) so the phone can show "resume from the CLI" beyond the thread id.
    ...(thread.agentSessionId !== undefined ? { agentSessionId: thread.agentSessionId } : {}),
    ...(thread.accessMode !== undefined ? { accessMode: thread.accessMode } : {}),
    ...(thread.titleSource !== undefined ? { titleSource: thread.titleSource } : {}),
    ...(thread.origin !== undefined ? { origin: { ...thread.origin } } : {}),
    ...(thread.rev !== undefined ? { rev: thread.rev } : {}),
  };
}

/**
 * The last moment anyone acted on [thread]: a turn starting or ending, or a
 * decision on its title or status. A delete decided before it is superseded.
 */
function lastDecision(thread: StoredThread): number {
  let last = Math.max(thread.decidedAt?.title ?? 0, thread.decidedAt?.status ?? 0);
  for (const turn of thread.turns) {
    last = Math.max(last, turn.createdAt, turn.completedAt ?? 0);
  }
  return last;
}

/** The next free turn position in [thread] (see `Turn.seq`). */
function nextSeq(thread: StoredThread): number {
  let max = 0;
  for (const turn of thread.turns) if ((turn.seq ?? 0) > max) max = turn.seq ?? 0;
  return max + 1;
}

/**
 * Number the turns of a thread stored before `seq` existed, in their stored
 * order — which is the order they were shown in. Deterministic, so a thread
 * that is not rewritten gets the same numbers on every load.
 */
function numberTurns(thread: StoredThread): void {
  let next = 1;
  for (const turn of thread.turns) {
    if (turn.seq === undefined || turn.seq < next) turn.seq = next;
    next = turn.seq + 1;
  }
}

function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length === 0 || trimmed === PLACEHOLDER_THREAD_TITLE;
}

function toTurn(turn: StoredTurn): Turn {
  const result: Turn = {
    id: turn.id,
    threadId: turn.threadId,
    ...(turn.seq !== undefined ? { seq: turn.seq } : {}),
    status: turn.status,
    messages: turn.messages.map(toMessage),
    createdAt: turn.createdAt,
  };
  if (turn.completedAt !== undefined) result.completedAt = turn.completedAt;
  if (turn.deliveredIntoTurnId !== undefined) {
    result.deliveredIntoTurnId = turn.deliveredIntoTurnId;
  }
  return result;
}

function toMessage(message: StoredMessage): Message {
  return {
    id: message.id,
    turnId: message.turnId,
    role: message.role,
    content: message.text,
    ...(message.thinking && message.thinking.length > 0 ? { thinking: message.thinking } : {}),
    ...(message.blocks && message.blocks.length > 0 ? { blocks: message.blocks } : {}),
    // Only surface the ordered interleave when it actually carries a structured
    // block: a plain-text turn renders identically from `content` alone, so the
    // extra field would be pure duplication. A turn with work-log/diff/tool
    // blocks ships `segments` so the phone restores the real text↔activity order.
    ...(message.segments && hasNonTextSegment(message.segments)
      ? { segments: message.segments }
      : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    createdAt: message.createdAt,
  };
}

function structuredCloneThread(thread: StoredThread): StoredThread {
  return JSON.parse(JSON.stringify(thread)) as StoredThread;
}

/** Convert a reader-owned wire turn into the private persisted shape. */
function storedTurnFromNative(turn: Turn): StoredTurn {
  const stored: StoredTurn = {
    id: turn.id,
    threadId: turn.threadId,
    status: turn.status,
    messages: turn.messages.map((message) => ({
      id: message.id,
      turnId: turn.id,
      role: message.role,
      text: typeof message.content === 'string' ? message.content : '',
      ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
      ...(message.blocks !== undefined ? { blocks: structuredCloneValue(message.blocks) } : {}),
      ...(message.segments !== undefined
        ? { segments: structuredCloneValue(message.segments) }
        : {}),
      ...(message.usage !== undefined ? { usage: { ...message.usage } } : {}),
      createdAt: message.createdAt,
    })),
    createdAt: turn.createdAt,
    ...(turn.completedAt !== undefined ? { completedAt: turn.completedAt } : {}),
  };
  return stored;
}

/** Native history is imported only once a meaningful assistant result exists. */
function importableNativeTurn(turn: Turn): boolean {
  return turn.messages.some(
    (message) =>
      message.role === 'assistant' &&
      ((typeof message.content === 'string' && message.content.trim().length > 0) ||
        (message.thinking?.trim().length ?? 0) > 0 ||
        (message.blocks?.length ?? 0) > 0),
  );
}

/**
 * Content identity of a turn: its prompt and its reply, each concatenated
 * across however many messages carry it, compared ignoring whitespace.
 *
 * Concatenating per role is what makes the two sides comparable at all. The
 * bridge accumulates ONE assistant message per turn; a native transcript splits
 * that same reply across several — one per tool step, most of them carrying no
 * prose whatsoever (OpenCode writes a text-less message per tool call, Claude
 * Code likewise). Comparing message-by-message therefore mismatched every turn
 * in which the agent used a tool, and the unmatched native turn was imported
 * beside the bridge's own record: the whole exchange, prompt included, stored
 * and shown twice on the phone.
 *
 * Whitespace is dropped rather than normalized because each native run is
 * already trimmed as it is read, so only a whitespace-insensitive comparison
 * can recover the bridge's accumulated text from those pieces.
 */
interface TurnIdentity {
  readonly user: string;
  readonly assistant: string;
}

/** Clock/rounding tolerance when testing a native turn against a run window. */
const NATIVE_TWIN_CLOCK_SLACK_MS = 5_000;

function turnIdentity(messages: readonly { role: MessageRole; text: unknown }[]): TurnIdentity {
  const joined = (role: MessageRole): string =>
    withoutWhitespace(
      messages
        .filter((message) => message.role === role)
        .map((message) => (typeof message.text === 'string' ? message.text : ''))
        .join(''),
    );
  return { user: joined('user'), assistant: joined('assistant') };
}

function nativeTurnIdentity(turn: Turn): TurnIdentity {
  return turnIdentity(turn.messages.map((m) => ({ role: m.role, text: m.content })));
}

function storedTurnIdentity(turn: StoredTurn): TurnIdentity {
  return turnIdentity(turn.messages.map((m) => ({ role: m.role, text: m.text })));
}

function withoutWhitespace(value: string): string {
  return value.replace(/\s+/gu, '');
}

/**
 * The already-stored turn that records the same exchange as [native], or
 * `undefined` when this really is a turn Uxnan has never seen.
 *
 * Queued and cancelled turns are never twins (they hold no reply yet), and a
 * turn already claimed by an earlier native turn cannot be claimed twice, so
 * two identical exchanges in one thread still reconcile one each.
 */
function findNativeTwin(
  turns: readonly StoredTurn[],
  native: Turn,
  claimed: ReadonlySet<StoredTurn>,
  exclude: StoredTurn | undefined,
): StoredTurn | undefined {
  const wanted = nativeTurnIdentity(native);
  const eligible = turns.filter(
    (turn) =>
      turn !== exclude &&
      !claimed.has(turn) &&
      turn.status !== 'queued' &&
      turn.status !== 'cancelled',
  );
  const exact = eligible.find((turn) => {
    const identity = storedTurnIdentity(turn);
    return identity.user === wanted.user && identity.assistant === wanted.assistant;
  });
  if (exact) return exact;
  // Some agents keep a different rendition of the same reply in their own log
  // than the one they streamed — Zero's transcript holds the final answer
  // without the preamble the bridge received. Same prompt, one reply containing
  // the other, AND the native turn starting inside the bridge turn's own run
  // window: only all three together identify the same turn. A turn genuinely
  // written elsewhere fails the window, so it still imports.
  return eligible.find((turn) => {
    const identity = storedTurnIdentity(turn);
    if (identity.user !== wanted.user) return false;
    if (identity.assistant.length === 0 || wanted.assistant.length === 0) return false;
    if (
      !identity.assistant.includes(wanted.assistant) &&
      !wanted.assistant.includes(identity.assistant)
    ) {
      return false;
    }
    return (
      native.createdAt >= turn.createdAt - NATIVE_TWIN_CLOCK_SLACK_MS &&
      native.createdAt <= (turn.completedAt ?? turn.createdAt) + NATIVE_TWIN_CLOCK_SLACK_MS
    );
  });
}

function structuredCloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function notFound(message: string): RpcError {
  return new RpcError(JsonRpcErrorCode.ResourceNotFound, message);
}

/** A `segments` text run: `{ type:'text', text }`. */
function isTextSegment(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

/** True once the ordered interleave holds at least one non-text (structured) block. */
function hasNonTextSegment(segments: unknown[]): boolean {
  return segments.some((s) => !isTextSegment(s));
}

/**
 * Extend the assistant message's ordered `segments` with a streamed text
 * [delta], mirroring the live mobile buffer: grow the trailing text run in
 * place, or open a new one when a structured block last landed (so text↔block
 * order is preserved). Empty deltas are ignored.
 */
function appendTextSegment(assistant: StoredMessage, delta: string): void {
  if (delta.length === 0) return;
  const segments = (assistant.segments ??= []);
  const last = segments[segments.length - 1];
  if (isTextSegment(last)) {
    last.text += delta;
  } else {
    segments.push({ type: 'text', text: delta });
  }
}

/**
 * Reconcile a terminal adapter text with prose already streamed into the
 * assistant message. Streamed text is user-visible and therefore immutable:
 * a terminal event may extend it or repeat a subset, but may never erase it.
 * When the
 * streamed text runs already concatenate to [finalText] — the normal case — the
 * interleave is left untouched. When they concatenate to a strict PREFIX of
 * [finalText] (the completion text carries a tail the deltas never streamed,
 * e.g. an adapter that reports a fuller final message), the missing tail is
 * appended as/onto the trailing text run so the interleave survives intact.
 * A genuinely divergent terminal text is retained as another response item,
 * after an explicit boundary. This deliberately favors a possible duplicate
 * over deleting content the user already saw.
 */
function reconcileAssistantWithFinalText(assistant: StoredMessage, finalText: string): void {
  const streamed = assistant.text;
  if (streamed === finalText || (finalText.length > 0 && streamed.includes(finalText))) return;

  if (streamed.length === 0) {
    assistant.text = finalText;
    appendTextSegment(assistant, finalText);
    return;
  }

  if (finalText.startsWith(streamed)) {
    const tail = finalText.slice(streamed.length);
    assistant.text = finalText;
    const segments = assistant.segments;
    if (!segments || segments.length === 0) return;
    const last = segments[segments.length - 1];
    if (isTextSegment(last)) {
      last.text += tail;
    } else {
      segments.push({ type: 'text', text: tail });
    }
    return;
  }

  const streamedAt = finalText.indexOf(streamed);
  if (streamedAt >= 0) {
    assistant.text = finalText;
    const segments = assistant.segments;
    if (!segments || segments.length === 0) return;
    const firstText = segments.find(isTextSegment);
    const lastText = [...segments].reverse().find(isTextSegment);
    if (firstText) firstText.text = finalText.slice(0, streamedAt) + firstText.text;
    if (lastText) lastText.text += finalText.slice(streamedAt + streamed.length);
    return;
  }

  if (finalText.length === 0) return;
  const boundary = { type: 'assistant_response_boundary', phase: 'final_answer' };
  assistant.blocks = [...(assistant.blocks ?? []), boundary];
  const segments = (assistant.segments ??= [{ type: 'text', text: streamed }]);
  segments.push(boundary, { type: 'text', text: finalText });
  assistant.text = streamed + finalText;
}
