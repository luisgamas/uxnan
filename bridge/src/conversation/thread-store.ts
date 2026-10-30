/**
 * Persistent conversation store (threads → turns → messages). This process is
 * their only reader and writer (a single-instance lock guarantees it), and
 * every change runs as one transaction under a mutex, so concurrent turn and
 * delta updates never interleave inside a read-modify-write.
 *
 * The rule it is built to: no cost of an everyday operation grows with the
 * length of a conversation's history. Each streamed token used to re-serialize
 * and rewrite its whole conversation — ~100 ms of a blocked event loop per
 * delta on a real 46 MB one, for every chat and client of the bridge — and a
 * start parsed every conversation in full (207 MB, 512 MB of heap). Now:
 *
 * - On disk a conversation is a small `thread.json` (summary + one header per
 *   turn), one file per turn, and an append-only journal for the turn in
 *   flight (see {@link DaemonState.threadsDir}).
 * - A start reads only the `thread.json` files. A turn's messages are read
 *   when someone reads them, and stay in a cache bounded by bytes
 *   ({@link DEFAULT_BODY_CACHE_BYTES}) that never drops a conversation being
 *   streamed into or changed right now.
 * - A streamed event (text, reasoning, a step, a step settling) is applied in
 *   memory and appended to the journal as one line, by the same function that
 *   replays the journal. When the turn ends its file is rewritten once and the
 *   journal goes. A journal left by a crash is replayed on the next start.
 * - Any other change rewrites only the turns it reached and, when it changed,
 *   the index. What it reached is recorded by the accessors that hand state to
 *   it ({@link Tx}); nothing has to remember to name what it wrote.
 *
 * Source: architecture/02a-system-architecture.md §6 (domain models) and §5.8
 * (the `~/.uxnan/threads/` layout).
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  AccessMode,
  ConversationTransfer,
  Message,
  MessageAttachment,
  MessageRole,
  Thread,
  ThreadList,
  ThreadOrigin,
  ThreadContinuation,
  ThreadStatus,
  ThreadTitleSource,
  TransferContextSummary,
  TransferStrategy,
  Turn,
  TurnAttachment,
  TurnAttachmentData,
  TurnList,
  TurnStatus,
} from '@uxnan/shared';
import {
  JsonRpcErrorCode,
  inlineAttachmentsPlainText,
  RpcError,
  TURN_PAGE_MAX_BYTES,
  appendThinkingSegment,
  jsonBytes,
  summarizeTurn,
} from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { provisionalTitle } from '../agents/thread-title.js';
import { SyncLedger } from '../sync/sync-ledger.js';
import { blockIdOf, isRunning, settleBlock } from '../adapters/content-blocks.js';
import { canonicalTurn, isAgentWake } from './session-history.js';
import {
  digestOfTurn,
  parseDigest,
  type DigestEntry,
  type ThreadDigestFile,
  type TurnDigest,
} from './thread-digest.js';
import { utcDayKey } from '../metrics/day.js';
import type { ConversationMetricEvent, TurnMetricEvent } from '../metrics/metrics-store.js';

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

/**
 * How much of the conversations' turns, counted as the bytes of their files,
 * the store keeps in memory. Sized so the largest conversation measured on a
 * real machine (46 MB) stays loaded while it is open; past it, the conversation
 * read longest ago is dropped and read again from disk when next needed.
 */
export const DEFAULT_BODY_CACHE_BYTES = 64 * 1024 * 1024;

export interface ThreadStoreOptions {
  /** Overrides {@link DEFAULT_BODY_CACHE_BYTES} (tests use a small one). */
  bodyCacheBytes?: number;
}

interface StoredMessage {
  id: string;
  turnId: string;
  role: MessageRole;
  text: string;
  /**
   * The message's text runs, reasoning and blocks **in the order they
   * streamed in** (text runs as `{ type:'text', text }`, each stretch of
   * reasoning as `{ type:'thinking', text }`, blocks verbatim) — the one place
   * a step or a thought is kept, and its index here is how a client addresses it
   * (`turn/steps`, `turn/step`). The text runs concatenate to `text`. Absent
   * on an assistant message that has said nothing yet ({@link toMessage}
   * serves it as empty).
   */
  segments?: unknown[];
  /** Token usage for this turn (so the phone restores the context meter). */
  usage?: { tokens: number; contextWindow?: number };
  /** Images the user attached (user messages), stored beside the thread. */
  attachments?: MessageAttachment[];
  createdAt: number;
}

/** Messages a turn holds per UTC day — what the activity ledger counts. */
interface MessageDay {
  day: number;
  messages: number;
}

/**
 * A deeply read-only view, for state a caller may read but must not change:
 * a change only reaches disk when it went through an accessor that records it
 * ({@link Tx}), so the type refuses the others.
 */
type Frozen<T> = T extends (infer U)[]
  ? readonly Frozen<U>[]
  : T extends readonly (infer U)[]
    ? readonly Frozen<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Frozen<T[K]> }
      : T;

/**
 * A turn as the store holds it: its header always — what `thread.json` keeps
 * of it — and its messages only while they are loaded ({@link
 * ThreadStore.#loadTurn}). Read-only messages here: a mutation changes them
 * through {@link Tx.turn} / {@link Tx.whole}, which record that it did.
 */
interface TurnRecord {
  id: string;
  threadId: string;
  /** Position in the thread, 1-based, never reused (see `Turn.seq`). */
  seq?: number;
  status: TurnStatus;
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
   * The turn that carried the rest of this one's agent run, when the agent
   * took a message mid-turn ({@link ThreadStore.handOffTurn}). Served as
   * `Turn.continuedIn`, so a client shows this turn's reply as the answer so
   * far rather than a closing one. Also read here: the agent's own transcript
   * may record that whole run as this single exchange (Claude Code does), so
   * matching it against native history reads the reply across the chain.
   */
  handedOffTo?: string;
  /** Its messages per day, so metrics never need the messages themselves. */
  messageDays?: MessageDay[];
  /** Size of its file on disk — what the body cache counts. */
  bytes?: number;
  readonly messages?: Frozen<StoredMessage[]>;
}

/** A turn with its messages loaded, for code that may change them. */
interface StoredTurn extends Omit<TurnRecord, 'messages'> {
  messages: StoredMessage[];
}

interface ThreadMeta {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
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
  /** The conversation it continues and what was carried over (`Thread.transfer`). */
  transfer?: StoredTransfer;
  /** The conversations that continue it (`Thread.continuations`). */
  continuations?: ThreadContinuation[];
  /** Sync revision of the last change to its summary. */
  rev?: number;
  /**
   * The highest position (`Turn.seq`) ever handed out in this thread. Private
   * and persisted: a turn the store drops (a duplicate import) must not free its
   * position for a new turn, or a client still holding the old one would mix
   * the two.
   */
  lastSeq?: number;
  /**
   * When someone last DECIDED its title (a hand rename) and its status
   * (archive / unarchive), on the bridge's clock. Private: what lets an action
   * a client took offline lose to a later one taken elsewhere
   * (architecture/02a §5.8.17) — the latest decision wins, whoever made it.
   */
  decidedAt?: { title?: number; status?: number };
  /**
   * The agent transcript last merged into this thread ({@link nativeKey}): its
   * source signature together with the shape of the thread it was merged
   * into. While both are the same, merging it again cannot change anything,
   * so `turn/list` skips reading it ({@link ThreadStore.nativeHistoryCurrent}).
   */
  nativeSource?: string;
}

interface ThreadRecord extends ThreadMeta {
  turns: TurnRecord[];
}

/** A continuation's origin as stored: the wire shape plus its idempotency key. */
interface StoredTransfer extends ConversationTransfer {
  /** The caller's `clientTransferId`. Private: what makes a retry find this one. */
  key?: string;
}

/** A thread with every turn's messages loaded ({@link Tx.whole}). */
interface StoredThread extends ThreadMeta {
  turns: StoredTurn[];
}

/** What `turns/<turn>.json` holds. */
interface TurnFile {
  /** How many journal events are already folded into these messages. */
  events: number;
  messages: StoredMessage[];
}

/** What this process knows of one turn's files. */
interface TurnDisk {
  /** Hash of its file as last read or written, when known: an identical rewrite is skipped. */
  digest?: string;
  /** Size of its file. */
  bytes: number;
  /** Journal events applied to its messages so far (folded into the file or not). */
  events: number;
  /** A journal may exist beside its file. */
  journal: boolean;
  /** What this process appended to that journal, for the body cache. */
  journalBytes: number;
  /** This process is streaming into it: its conversation stays loaded. */
  live: boolean;
  /** An append failed and may have left half a line: the next event rewrites the file instead. */
  suspect: boolean;
}

interface ThreadDisk {
  /** Its `thread.json` as last read or written: an identical rewrite is skipped. */
  index?: string;
  turns: Map<string, TurnDisk>;
}

/**
 * One streamed change to a turn's assistant message — what the journal holds,
 * one per line, and what {@link applyTurnEvent} applies, live or on replay.
 * `at` is when it happened: it dates the thread's activity (`updatedAt`).
 */
type TurnEvent =
  | { op: 'delta'; text: string; at: number }
  | { op: 'thinking'; text: string; at: number }
  | { op: 'block'; content: unknown; beforeText?: true; at: number }
  | { op: 'settle'; content: unknown; at: number }
  | { op: 'usage'; usage: { tokens: number; contextWindow?: number }; at: number };

/**
 * The state one transaction may read and change. Every accessor that hands
 * out something changeable records what it handed out, and the transaction
 * writes exactly that when it ends: the thread's index for {@link find} /
 * {@link thread} / {@link all}, the turn for {@link turn}, every turn for
 * {@link whole}. A mutation cannot change a file it never asked for, nor ask
 * for one and have it left unwritten — an index or turn file that came out
 * identical is simply not rewritten.
 */
interface Tx {
  /** A thread to read only (nothing is recorded); `undefined` when unknown. */
  peek(threadId: string): Frozen<ThreadRecord> | undefined;
  /** A thread's summary and turn headers, to change; `undefined` when unknown. */
  find(threadId: string): ThreadRecord | undefined;
  /** {@link find}, rejecting an unknown thread. */
  thread(threadId: string): ThreadRecord;
  /** Every thread's summary and turn headers, to change. */
  all(): ThreadRecord[];
  /** One turn's header (status, times, links), to change. */
  header(threadId: string, turnId: string): TurnRecord;
  /** One turn with its messages, to change. */
  turn(threadId: string, turnId: string): Promise<StoredTurn>;
  /** A thread with every turn's messages, to change (its turn list too). */
  whole(threadId: string): Promise<StoredThread>;
  /** A thread with every turn's messages, to read only. */
  view(threadId: string): Promise<Frozen<StoredThread>>;
  /**
   * Applies a streamed event to a turn. While the turn is in flight the event
   * is journaled — one appended line, no file rewritten. Output arriving after
   * the turn ended is refused (`false`); a step settling or usage on an ended
   * turn rewrites that turn's file. Resolves whether anything changed.
   */
  stream(threadId: string, turnId: string, event: TurnEvent): Promise<boolean>;
  /** A new thread. */
  add(thread: StoredThread): void;
  /** Deletes a thread, its files and its attachments. */
  remove(threadId: string): void;
}

/** What one transaction reached, so its end writes exactly that. */
class Mutation {
  /** Threads whose index may have changed. */
  readonly indexes = new Set<string>();
  /** Turns whose messages may have changed ({@link turnKey}). */
  readonly bodies = new Set<string>();
  readonly removed = new Set<string>();
  /** Threads it is working on: never dropped from the cache meanwhile. */
  readonly pinned = new Set<string>();
  /** Journal lines to append, in order. */
  readonly events: { threadId: string; turnId: string; line: string }[] = [];

  touches(threadId: string): boolean {
    return this.indexes.has(threadId) || this.removed.has(threadId) || this.pinned.has(threadId);
  }
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
  /**
   * The agent session the conversation continues (`thread/start` with
   * `agentSessionId`): stored from the start, so the first turn resumes it and
   * `turn/list` imports its history.
   */
  agentSessionId?: string;
  /** Who named it, when a name comes with it: the agent's own session title. */
  titleSource?: ThreadTitleSource;
  /** The mode it starts in: its agent's default (`defaultAccessMode`). */
  accessMode?: AccessMode;
}

/** A conversation that continues another ({@link ThreadStore.transferThread}). */
export interface TransferThreadInput {
  sourceThreadId: string;
  strategy: TransferStrategy;
  /** The project and folder it runs in (the source's, unless asked otherwise). */
  projectId: string;
  cwd?: string;
  agentId: string;
  model?: string;
  /** Its name; absent → the source's (a fork's with " (fork)"), provisional. */
  title?: string;
  origin?: ThreadOrigin;
  accessMode?: AccessMode;
  createdBy: 'user' | 'agent';
  /** The caller's idempotency key (`clientTransferId`). */
  key?: string;
  /** The context its first message carries, already built from the source's digest. */
  context: { text: string; summary: TransferContextSummary };
}

export interface TransferThreadResult {
  thread: Thread;
  /** False when [TransferThreadInput.key] found the continuation already made. */
  created: boolean;
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
  /** The thread's sync revision after the merge, when it {@link changed}. */
  rev?: number;
}

/** Narrow persistence boundary used to project mutable thread history into the
 * bridge's durable activity ledger without making ThreadStore own that ledger. */
export interface ConversationMetricsSink {
  mergeConversationHistory(
    conversations: ConversationMetricEvent[],
    turns: TurnMetricEvent[],
  ): Promise<number>;
}

type MetricProjection = { conversation: ConversationMetricEvent; turns: TurnMetricEvent[] };

export class ThreadStore {
  readonly #state: DaemonState;
  readonly #metricsSink: ConversationMetricsSink | undefined;
  readonly #ledger: SyncLedger;
  readonly #bodyCacheBytes: number;
  readonly #listeners = new Set<(change: ThreadChange) => void>();
  /** Threads whose summary changed in the transaction running now (under the lock). */
  readonly #changed = new Set<string>();
  /** Threads deleted in the transaction running now, with their tombstone revision. */
  readonly #deleted: { threadId: string; rev: number }[] = [];
  #lock: Promise<void> = Promise.resolve();
  /** What is on disk for each thread, as far as this process knows. */
  readonly #disk = new Map<string, ThreadDisk>();
  /** Threads with turn messages in memory, least recently used first. */
  readonly #hot = new Set<string>();
  /** Turn files being read now ({@link turnKey}), so two readers share one copy. */
  readonly #loading = new Map<string, Promise<StoredTurn>>();
  /** The transaction running now, whose threads the cache must not drop. */
  #mutation: Mutation | undefined;
  /** The layout of each turn able to stream in this process ({@link turnKey}). */
  readonly #layouts = new Map<string, SegmentLayout>();
  /** How many times this process wrote each conversation's digest ({@link digestVersion}). */
  readonly #digestVersions = new Map<string, number>();

  constructor(
    state: DaemonState,
    metricsSink?: ConversationMetricsSink,
    ledger?: SyncLedger,
    options: ThreadStoreOptions = {},
  ) {
    this.#state = state;
    this.#metricsSink = metricsSink;
    this.#ledger = ledger ?? SyncLedger.memory();
    this.#bodyCacheBytes = options.bodyCacheBytes ?? DEFAULT_BODY_CACHE_BYTES;
  }

  /** Listen for thread changes (after they are on disk). Returns an unsubscribe. */
  onChange(listener: (change: ThreadChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async listThreads(projectId?: string): Promise<ThreadList> {
    const threads = [...(await this.#records()).values()];
    const filtered = projectId ? threads.filter((t) => t.projectId === projectId) : threads;
    return { threads: filtered.map(toThread) };
  }

  /** Threads whose summary changed after revision [since] (all when omitted). */
  async threadsChangedSince(since?: number): Promise<Thread[]> {
    const threads = [...(await this.#records()).values()];
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
    const moves = new Map<string, string>();
    for (const thread of (await this.#records()).values()) {
      if (thread.cwd === undefined) continue;
      const projectId = await projectIdFor(thread.cwd);
      if (projectId !== undefined && projectId !== thread.projectId)
        moves.set(thread.id, projectId);
    }
    if (moves.size === 0) return 0;
    return this.#mutate(async (tx) => {
      for (const [threadId, projectId] of moves) {
        const thread = tx.find(threadId);
        if (!thread) continue;
        thread.projectId = projectId;
        this.#bump(thread);
      }
      return moves.size;
    });
  }

  /** The folders conversations run in, for seeding the project registry. */
  async threadFolders(): Promise<string[]> {
    const threads = [...(await this.#records()).values()];
    return [...new Set(threads.map((t) => t.cwd).filter((c): c is string => !!c))];
  }

  async getThread(threadId: string): Promise<Thread> {
    return toThread(requireThread(await this.#records(), threadId));
  }

  /**
   * One page of [threadId]'s turns as `turn/list` serves it (`TurnList`): the
   * window `[cursor, cursor + limit)` — or the last [limit] turns with
   * [fromEnd] — each summarized (`summarizeTurn`), trimmed to the newest
   * turns that fit {@link TURN_PAGE_MAX_BYTES} of serialized JSON (always at
   * least the newest one). Only the turns served are read, newest first: an
   * older one stays on disk until asked for.
   */
  async listTurns(
    threadId: string,
    cursor?: string,
    limit?: number,
    fromEnd = false,
    maxBytes: number = TURN_PAGE_MAX_BYTES,
  ): Promise<TurnList> {
    await this.#afterPendingWrites();
    const thread = requireThread(await this.#records(), threadId);
    const total = thread.turns.length;
    const size = limit && limit > 0 ? limit : DEFAULT_TURN_LIMIT;
    // `fromEnd` returns the last page (newest turns) so the phone can open a
    // long thread at its most recent messages and page backward from there.
    const start = fromEnd
      ? Math.max(0, total - size)
      : cursor
        ? Number.parseInt(cursor, 10) || 0
        : 0;
    const end = Math.min(total, start + size);
    const turns: Turn[] = [];
    // `{"turns":[` … `]}` and a comma between turns.
    let used = 12;
    for (let index = end - 1; index >= start; index--) {
      const turn = summarizeTurn(toTurn(await this.#loadTurn(thread, thread.turns[index]!)));
      const bytes = jsonBytes(turn) + (turns.length > 0 ? 1 : 0);
      if (turns.length > 0 && used + bytes > maxBytes) break;
      turns.push(turn);
      used += bytes;
    }
    this.#evict();
    turns.reverse();
    const result: TurnList = { turns, offset: end - turns.length, total };
    if (end < total) result.nextCursor = String(end);
    return result;
  }

  /**
   * One turn, whole — its steps and reasoning as stored. For the bridge's own
   * readers (a title, the reply's text, whether it ended); a client reads a
   * turn through `turn/read`, which summarizes it.
   */
  async getTurn(turnId: string): Promise<Turn> {
    // Read what was already asked to be written: a client re-reading a turn the
    // moment it hears it ended must never get the copy from before (see
    // {@link #afterPendingWrites}).
    await this.#afterPendingWrites();
    for (const thread of (await this.#records()).values()) {
      const turn = thread.turns.find((t) => t.id === turnId);
      if (!turn) continue;
      const loaded = await this.#loadTurn(thread, turn);
      this.#evict();
      return toTurn(loaded);
    }
    throw notFound(`turn not found: ${turnId}`);
  }

  /**
   * The assistant message of [turnId] in [threadId], whole: the stored
   * `segments` a step's index points into, every thought in full — what
   * `turn/steps` and `turn/step` read.
   */
  async readReply(threadId: string, turnId: string): Promise<Message> {
    await this.#afterPendingWrites();
    const thread = requireThread(await this.#records(), threadId);
    const record = thread.turns.find((t) => t.id === turnId);
    if (!record) throw notFound(`turn not found: ${turnId}`);
    const turn = await this.#loadTurn(thread, record);
    this.#evict();
    const reply = turn.messages.find((m) => m.role === 'assistant');
    if (!reply) throw notFound(`turn has no reply: ${turnId}`);
    return toMessage(reply);
  }

  /**
   * Where a block handed to {@link appendBlock} right now will stand in the
   * turn's stored `segments` — its address for `turn/step` — so the live
   * notification can carry it before the write is done. Asked synchronously,
   * just before the {@link appendBlock} it describes; `undefined` when the turn
   * is not streaming in this process (the store refuses output for it).
   */
  blockIndex(
    threadId: string,
    turnId: string,
    content: unknown,
    beforeText = false,
  ): number | undefined {
    return this.#layouts.get(turnKey(threadId, turnId))?.place(content, beforeText, false);
  }

  /** The bytes of an image a user message of [threadId] carries. */
  async readAttachment(threadId: string, attachmentId: string): Promise<TurnAttachmentData> {
    const thread = requireThread(await this.#records(), threadId);
    const turns = await Promise.all(thread.turns.map((turn) => this.#loadTurn(thread, turn)));
    this.#evict();
    const attachment = turns
      .flatMap((turn) => turn.messages)
      .flatMap((message) => message.attachments ?? [])
      .find((a) => a.id === attachmentId);
    if (!attachment) throw notFound(`attachment not found: ${attachmentId}`);
    const data = await this.#state.readAttachment(threadId, attachment.id).catch(() => {
      throw notFound(`attachment not found: ${attachmentId}`);
    });
    return { mimeType: attachment.mimeType, base64Data: data.toString('base64') };
  }

  /**
   * Whether the agent transcript whose source [signature] is given
   * ({@link SessionHistoryReader.sourceSignature}) was already merged into
   * [threadId] as the thread stands now — then reading and merging it again
   * cannot change anything, and the merge (`NativeHistoryWatcher`) skips
   * both. Always `false` without a signature: a history that is not one file
   * has nothing cheaper to compare.
   */
  async nativeHistoryCurrent(threadId: string, signature: string | undefined): Promise<boolean> {
    if (signature === undefined) return false;
    const thread = requireThread(await this.#records(), threadId);
    return thread.nativeSource === nativeKey(signature, thread);
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
   *
   * One thing is never native-only: what the transcript holds from a run the
   * bridge itself was driving ({@link insideBridgeRun}) — one native session
   * runs one turn at a time, so it is that run, however the reader split it.
   * It is not imported, and a row imported that way before is dropped.
   *
   * [signature], when the transcript has one, is remembered with the result,
   * so the next merge over an unchanged transcript can skip reading it
   * ({@link nativeHistoryCurrent}). An empty [nativeTurns] merges nothing and
   * only remembers it. A merge that changed the thread reports its new `rev`,
   * which `NativeHistoryWatcher` announces (`stream/history/changed`).
   */
  async reconcileNativeHistory(
    threadId: string,
    nativeTurns: Turn[],
    now: number,
    signature?: string,
  ): Promise<NativeHistoryReconcileResult> {
    const captured = await this.#mutate(async (tx) => {
      if (nativeTurns.length === 0) {
        const thread = tx.thread(threadId);
        if (signature !== undefined) thread.nativeSource = nativeKey(signature, thread);
        return { reconcile: { changed: false, importedTurnIds: [] }, projection: undefined };
      }
      const thread = await tx.whole(threadId);
      const reconcile = mergeNativeTurns(thread, nativeTurns);
      if (reconcile.changed) {
        // An imported turn takes the next position rather than being sorted in
        // by its timestamp: every client orders the conversation by `seq`, and
        // a position, once handed out, never moves.
        thread.updatedAt = now;
        this.#bump(thread);
        reconcile.rev = thread.rev;
      }
      if (signature !== undefined) thread.nativeSource = nativeKey(signature, thread);
      return {
        reconcile,
        projection: reconcile.changed ? metricProjection(thread) : undefined,
      };
    });
    await this.#sendMetrics(captured.projection);
    return captured.reconcile;
  }

  async startThread(input: StartThreadInput, now: number): Promise<Thread> {
    const created = await this.#mutate(async (tx) => {
      const created: StoredThread = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title ?? PLACEHOLDER_THREAD_TITLE,
        ...(input.title !== undefined
          ? { titleSource: input.titleSource ?? ('user' as const) }
          : {}),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        turns: [],
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.origin !== undefined ? { origin: { ...input.origin } } : {}),
        ...(input.agentSessionId !== undefined ? { agentSessionId: input.agentSessionId } : {}),
        ...(input.accessMode !== undefined ? { accessMode: input.accessMode } : {}),
      };
      tx.add(created);
      this.#ledger.revive('thread', created.id);
      this.#bump(created);
      return { thread: toThread(created), projection: metricProjection(created) };
    });
    await this.#sendMetrics(created.projection);
    return created.thread;
  }

  /**
   * The conversation that continues an agent session, when one does — so a
   * session is never continued by two conversations (`thread/start` returns
   * this one instead) and the session catalog can point at it.
   */
  async threadForSession(agentId: string, sessionId: string): Promise<Thread | undefined> {
    for (const thread of (await this.#records()).values()) {
      if (thread.agentId === agentId && thread.agentSessionId === sessionId) {
        return toThread(thread);
      }
    }
    return undefined;
  }

  /** Every conversation's agent session, keyed `agentId:sessionId` → thread id. */
  async sessionLinks(): Promise<Map<string, string>> {
    const links = new Map<string, string>();
    for (const thread of (await this.#records()).values()) {
      if (thread.agentId !== undefined && thread.agentSessionId !== undefined) {
        links.set(sessionKey(thread.agentId, thread.agentSessionId), thread.id);
      }
    }
    return links;
  }

  /** Agent/model/cwd a thread's turns run with (used by `turn/send`). */
  async getThreadRuntime(threadId: string): Promise<ThreadRuntime> {
    const thread = requireThread(await this.#records(), threadId);
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
    const thread = requireThread(await this.#records(), threadId);
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
  setAgentSession(threadId: string, agentSessionId: string): Promise<void> {
    return this.#mutate(async (tx) => {
      const thread = tx.find(threadId);
      if (!thread || thread.agentSessionId === agentSessionId) return;
      thread.agentSessionId = agentSessionId;
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
    requireThread(await this.#records(), threadId);
  }

  async setModel(threadId: string, model: string): Promise<void> {
    const projection = await this.#mutate(async (tx) => {
      const thread = tx.thread(threadId);
      thread.model = model;
      this.#bump(thread);
      return metricProjection(thread);
    });
    await this.#sendMetrics(projection);
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
    return this.#mutate(async (tx) => {
      const thread = tx.thread(threadId);
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
    return this.#mutate(async (tx) => {
      const thread = tx.find(threadId);
      if (!thread) return false;
      if (thread.titleSource === 'user' || thread.titleSource === 'agent') return false;
      const attempts = thread.titleAttempts ?? 0;
      if (attempts >= MAX_TITLE_ATTEMPTS) return false;
      thread.titleAttempts = attempts + 1;
      return true;
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
    return this.#mutate(async (tx) => {
      const thread = tx.find(threadId);
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
   * same mode is a no-op. Returns the updated Thread.
   */
  setAccessMode(threadId: string, mode: AccessMode): Promise<Thread> {
    return this.#mutate(async (tx) => {
      const thread = tx.thread(threadId);
      if (thread.accessMode !== mode) {
        thread.accessMode = mode;
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
    return this.#mutate(async (tx) => {
      const thread = tx.peek(threadId);
      if (!thread) throw notFound(`thread not found: ${threadId}`);
      if (at !== undefined && at < lastDecision(thread)) return false;
      if (this.#metricsSink) {
        const projection = metricProjection(thread);
        // This final projection is strict (not best-effort): the mutable source
        // remains available if the historical ledger cannot be persisted.
        await this.#metricsSink.mergeConversationHistory(
          [projection.conversation],
          projection.turns,
        );
      }
      // A continuation that is gone is no longer one: its source stops naming
      // it. (A deleted source stays named by its continuations, as history.)
      const sourceId = thread.transfer?.sourceThreadId;
      const source = sourceId !== undefined ? tx.find(sourceId) : undefined;
      if (source?.continuations?.some((c) => c.threadId === threadId)) {
        source.continuations = source.continuations.filter((c) => c.threadId !== threadId);
        if (source.continuations.length === 0) delete source.continuations;
        this.#bump(source);
      }
      tx.remove(threadId);
      for (const turn of thread.turns) this.#layouts.delete(turnKey(threadId, turn.id));
      this.#deleted.push({ threadId, rev: this.#ledger.tombstone('thread', threadId) });
      return true;
    });
  }

  #setStatus(threadId: string, status: ThreadStatus, at: number): Promise<Thread> {
    return this.#mutate(async (tx) => {
      const thread = tx.thread(threadId);
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

  /**
   * Starts a conversation that continues [input.sourceThreadId]
   * (architecture/02a §5.8.21) — `thread/transfer`, `thread/fork` and
   * `thread/start { continueFrom }` all end here. One transaction makes the new
   * conversation (with the source's history copied when the strategy is
   * `fork`), records where it came from (`transfer`) and names it on the
   * source (`continuations`), so both conversations tell the same story. The
   * context its first message carries is written beside it first
   * (`transfer.md`). With a key a continuation of the same source already
   * made under it is returned instead, unchanged.
   */
  async transferThread(input: TransferThreadInput, now: number): Promise<TransferThreadResult> {
    const made = await this.#mutate(async (tx) => {
      if (input.key !== undefined) {
        // Read, not reached: a lookup must not mark every index for writing.
        const existing = [...(this.#loaded?.values() ?? [])].find(
          (t) =>
            t.transfer?.key === input.key && t.transfer?.sourceThreadId === input.sourceThreadId,
        );
        if (existing) return { thread: toThread(existing), created: false, projection: undefined };
      }
      const source = tx.thread(input.sourceThreadId);
      const id = randomUUID();
      const transfer: StoredTransfer = {
        id: randomUUID(),
        strategy: input.strategy,
        sourceThreadId: source.id,
        sourceTitle: source.title,
        ...(source.agentId !== undefined ? { sourceAgentId: source.agentId } : {}),
        createdBy: input.createdBy,
        status: 'pending',
        context: { ...input.context.summary },
        ...(input.key !== undefined ? { key: input.key } : {}),
      };
      const created: StoredThread = {
        id,
        projectId: input.projectId,
        title: input.title ?? (input.strategy === 'fork' ? `${source.title} (fork)` : source.title),
        // A name the caller chose is final; the source's is provisional, so the
        // bridge still names the continuation after its first exchange.
        titleSource: input.title !== undefined ? 'user' : 'prompt',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        turns: [],
        agentId: input.agentId,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.origin !== undefined ? { origin: { ...input.origin } } : {}),
        ...(input.accessMode !== undefined ? { accessMode: input.accessMode } : {}),
        transfer,
      };
      if (input.strategy === 'fork') {
        // The whole history, copied: what the person sees. Never the source's
        // native session — the fork's agent opens its own, and its first
        // message carries the selection that tells it what happened.
        // FOR-DEV: fork the native session instead, so the fork keeps the
        // agent's own memory (bridge/FOR-DEV.md → "A fork keeps its agent's own
        // memory"); needs each CLI's fork measured on the driven surface.
        const whole = await tx.view(source.id);
        created.turns = structuredCloneValue(whole.turns) as StoredTurn[];
        for (const turn of created.turns) {
          turn.threadId = id;
          delete turn.nativeHistoryTurnId;
        }
        created.lastSeq = whole.lastSeq ?? whole.turns.length;
      }
      // The context is on disk before anything names it.
      await this.#state.writeTransferContext(id, input.context.text);
      tx.add(created);
      this.#ledger.revive('thread', id);
      this.#bump(created);
      const continuations = source.continuations ?? [];
      source.continuations = [
        ...continuations,
        {
          threadId: id,
          transferId: transfer.id,
          agentId: input.agentId,
          strategy: input.strategy,
        },
      ];
      this.#bump(source);
      return { thread: toThread(created), created: true, projection: metricProjection(created) };
    });
    if (made.created && input.strategy === 'fork') {
      // The copied messages keep their images: they are the same messages.
      await this.#state.copyAttachments(input.sourceThreadId, made.thread.id);
    }
    await this.#sendMetrics(made.projection);
    return { thread: made.thread, created: made.created };
  }

  /**
   * The context a continuation's next turn carries, when it still has to go:
   * marks it `sent` with [turnId] and answers its text. `undefined` when the
   * conversation continues nothing, or its context already reached the agent.
   */
  claimTransferContext(threadId: string, turnId: string): Promise<string | undefined> {
    return this.#mutate(async (tx) => {
      const thread = tx.find(threadId);
      const transfer = thread?.transfer;
      if (!thread || !transfer) return undefined;
      if (transfer.status !== 'pending' && transfer.status !== 'unverifiable') return undefined;
      const text = await this.#state.readTransferContext(threadId);
      if (text === null) return undefined;
      transfer.status = 'sent';
      transfer.turnId = turnId;
      this.#bump(thread);
      return text;
    });
  }

  /**
   * After a restart: a context that went with a turn this process never saw
   * end cannot be proven read — `unverifiable`, and the next message carries
   * it again. Returns how many.
   */
  recoverInterruptedTransfers(): Promise<number> {
    return this.#mutate(async (tx) => {
      let count = 0;
      for (const candidate of [...(this.#loaded?.values() ?? [])]) {
        if (candidate.transfer?.status !== 'sent') continue;
        const thread = tx.thread(candidate.id);
        if (!thread.transfer) continue;
        thread.transfer.status = 'unverifiable';
        this.#bump(thread);
        count += 1;
      }
      return count;
    });
  }

  /** What a continuation carries over, as its agent reads it (`thread/transferContext`). */
  async transferContext(
    threadId: string,
  ): Promise<{ text: string; summary: TransferContextSummary }> {
    const thread = requireThread(await this.#records(), threadId);
    const text = thread.transfer ? await this.#state.readTransferContext(threadId) : null;
    if (!thread.transfer || text === null) {
      throw notFound(`conversation ${threadId} continues no other`);
    }
    return { text, summary: { ...thread.transfer.context } };
  }

  /**
   * The digest of each of [threadId]'s settled turns, oldest first — what a
   * search scans and a continuation selects from ({@link TurnDigest}). Read
   * from `digest.json`; a turn missing from it (a conversation stored before
   * digests existed) is read once, digested and kept. That catch-up runs
   * outside the store's lock, one turn at a time, so it never holds up a
   * streaming conversation; only merging what it found takes the lock.
   */
  async digestTurns(threadId: string): Promise<DigestEntry[]> {
    const record = requireThread(await this.#records(), threadId);
    let digest = parseDigest(await this.#state.readThreadDigest(threadId)) ?? {
      v: 1 as const,
      turns: {},
    };
    const missing = record.turns.filter(
      (turn) => TERMINAL_TURN_STATUSES.has(turn.status) && digest.turns[turn.id] === undefined,
    );
    if (missing.length > 0) {
      const found = new Map<string, TurnDigest>();
      for (const turn of missing) {
        const loaded = await this.#loadTurn(record, turn);
        found.set(turn.id, digestOfTurn(loaded, loaded.messages));
        this.#evict();
        // Give every other request its turn between two reads.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      digest = await this.#exclusive(async () => {
        const current = parseDigest(await this.#state.readThreadDigest(threadId)) ?? {
          v: 1 as const,
          turns: {},
        };
        const live = this.#loaded?.get(threadId);
        if (!live) return current;
        const kept = new Set(live.turns.map((t) => t.id));
        let changed = false;
        for (const [turnId, entry] of found) {
          if (!kept.has(turnId) || current.turns[turnId] !== undefined) continue;
          current.turns[turnId] = entry;
          changed = true;
        }
        if (changed) await this.#writeDigest(threadId, current);
        return current;
      });
    }
    const out: DigestEntry[] = [];
    for (const turn of record.turns) {
      const entry = digest.turns[turn.id];
      if (entry) out.push({ ...entry, turnId: turn.id });
    }
    return out;
  }

  /**
   * Bumps each time [threadId]'s digest is written, so a reader holding a copy
   * (the search's) knows to read it again. 0 until this process wrote one.
   */
  digestVersion(threadId: string): number {
    return this.#digestVersions.get(threadId) ?? 0;
  }

  async #writeDigest(threadId: string, digest: ThreadDigestFile): Promise<void> {
    await this.#state.writeThreadDigest(threadId, JSON.stringify(digest));
    this.#digestVersions.set(threadId, this.digestVersion(threadId) + 1);
  }

  /** Runs [fn] holding the store's lock, as a transaction would, without one. */
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn);
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async startTurn(
    threadId: string,
    userText: string,
    now: number,
    attachments: readonly TurnAttachment[] = [],
  ): Promise<StartTurnResult> {
    return this.#createTurn(threadId, userText, 'streaming', now, attachments);
  }

  /**
   * Stores a turn the user sent while another one was in flight. Identical to
   * {@link startTurn} except for the status: the user message is persisted right
   * away (so it survives a resync and shows in the thread), the assistant one
   * stays empty, and nothing is handed to an adapter until
   * {@link beginQueuedTurn} promotes it.
   */
  async queueTurn(
    threadId: string,
    userText: string,
    now: number,
    attachments: readonly TurnAttachment[] = [],
  ): Promise<StartTurnResult> {
    return this.#createTurn(threadId, userText, 'queued', now, attachments);
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
   * A message the agent took **into its running turn** (steering): the turn
   * that was answering ends here, with everything said so far, and [toTurnId]
   * — until now queued — carries the rest of the same agent run. One mutation,
   * so no reader ever sees both turns streaming or neither.
   *
   * The ended turn's running steps are settled as `completed`, as any ending
   * does; a step that really settles later is written back in place by
   * {@link settleStep}.
   */
  handOffTurn(threadId: string, fromTurnId: string, toTurnId: string, now: number): Promise<void> {
    return this.#mutate(async (tx) => {
      const from = tx.header(threadId, fromTurnId);
      const to = tx.header(threadId, toTurnId);
      if (!TERMINAL_TURN_STATUSES.has(from.status)) {
        const ended = await tx.turn(threadId, fromTurnId);
        ended.status = 'completed';
        ended.completedAt = now;
        settleRunningSteps(ended, true);
      }
      this.#layouts.delete(turnKey(threadId, fromTurnId));
      from.handedOffTo = toTurnId;
      to.status = 'streaming';
      const thread = tx.thread(threadId);
      thread.updatedAt = now;
      this.#bump(thread);
    });
  }

  /**
   * Writes a step's settled form over the running one it started as
   * (`LiveBlock`, by `blockId`), even in a turn that already ended — the step
   * was shown there, so its result belongs there. Changes nothing when the turn
   * holds no such step.
   */
  settleStep(threadId: string, turnId: string, content: unknown, now: number): Promise<void> {
    return this.#mutate(async (tx) => {
      if (blockIdOf(content) === undefined) return;
      await tx.stream(threadId, turnId, { op: 'settle', content, at: now });
    });
  }

  /** The ids of a thread's `queued` turns, oldest first (their run order). */
  async queuedTurnIds(threadId: string): Promise<string[]> {
    const thread = (await this.#records()).get(threadId);
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
    return this.#mutate(async (tx) => {
      let cancelled = 0;
      for (const thread of tx.all()) {
        const before = cancelled;
        for (const turn of thread.turns) {
          if (turn.status !== 'queued') continue;
          turn.status = 'cancelled';
          turn.completedAt = now;
          cancelled += 1;
        }
        if (cancelled !== before) this.#bump(thread);
      }
      return cancelled;
    });
  }

  async #createTurn(
    threadId: string,
    userText: string,
    status: TurnStatus,
    now: number,
    attachments: readonly TurnAttachment[],
  ): Promise<StartTurnResult> {
    const captured = await this.#mutate(async (tx) => {
      const thread = tx.thread(threadId);
      const turnId = randomUUID();
      const stored = await this.#storeAttachments(threadId, turnId, attachments);
      const userMessage: StoredMessage = {
        id: randomUUID(),
        turnId,
        role: 'user',
        text: userText,
        ...(stored.length > 0 ? { attachments: stored } : {}),
        createdAt: now,
      };
      const assistantMessage: StoredMessage = {
        id: randomUUID(),
        turnId,
        role: 'assistant',
        text: '',
        createdAt: now,
      };
      const turn: StoredTurn = {
        id: turnId,
        threadId,
        seq: nextSeq(thread),
        status,
        messages: [userMessage, assistantMessage],
        createdAt: now,
      };
      thread.turns.push(turn);
      this.#layouts.set(turnKey(threadId, turnId), new SegmentLayout());
      thread.updatedAt = now;
      // The bridge names the conversation from its opening message the moment
      // it is stored — every client sees the same provisional name, and none
      // has to (or may) invent its own. Only over the placeholder: a name the
      // caller gave at `thread/start` is the user's.
      if (thread.titleSource === undefined && isPlaceholderTitle(thread.title)) {
        const provisional = provisionalTitle(
          inlineAttachmentsPlainText(
            userText,
            stored.map((a) => a.name),
          ),
        );
        if (provisional.length > 0) {
          thread.title = provisional;
          thread.titleSource = 'prompt';
        }
      }
      this.#bump(thread);
      return {
        result: { turnId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id },
        projection: metricProjection(thread),
      };
    });
    await this.#sendMetrics(captured.projection);
    return captured.result;
  }

  /**
   * Keeps the images and files of a user message beside the thread, so every
   * client can show them in the message long after the agent's own copies are
   * gone — every one, in order, because the n-th marker in the message's text
   * is the n-th attachment (`turn/send` refuses one without bytes).
   */
  async #storeAttachments(
    threadId: string,
    turnId: string,
    attachments: readonly TurnAttachment[],
  ): Promise<MessageAttachment[]> {
    const stored: MessageAttachment[] = [];
    for (const [index, attachment] of attachments.entries()) {
      const data = Buffer.from(attachment.base64Data, 'base64');
      const isFile = attachment.type === 'file';
      const ext = isFile
        ? fileNameExtension(attachment.name)
        : attachmentExtension(attachment.mimeType);
      const id = `${turnId}-${index}.${ext}`;
      await this.#state.writeAttachment(threadId, id, data);
      stored.push({
        id,
        mimeType: attachment.mimeType,
        bytes: data.length,
        ...(attachment.name ? { name: attachment.name } : {}),
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined ? { height: attachment.height } : {}),
      });
    }
    return stored;
  }

  /**
   * Appends a streamed text chunk to the turn's assistant message.
   *
   * Called for every delta an agent streams, so it costs one appended journal
   * line — never a rewrite — and resolves once that line is on disk: the
   * caller tells clients about the delta only after it is durable.
   */
  appendDelta(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    this.#layouts.get(turnKey(threadId, turnId))?.text(delta);
    return this.#mutate(async (tx) => {
      await tx.stream(threadId, turnId, { op: 'delta', text: delta, at: now });
    });
  }

  /**
   * Appends a reasoning ("thinking") chunk to the turn's assistant message:
   * it grows the last segment when that is a thought, otherwise it opens a new
   * one at the end ({@link appendThinkingSegment}). One journal line, like a
   * text delta.
   */
  appendThinking(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    this.#layouts.get(turnKey(threadId, turnId))?.thought(delta);
    return this.#mutate(async (tx) => {
      await tx.stream(threadId, turnId, { op: 'thinking', text: delta, at: now });
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
    this.#layouts.get(turnKey(threadId, turnId))?.place(content, beforeText, true);
    return this.#mutate(async (tx) => {
      await tx.stream(threadId, turnId, {
        op: 'block',
        content,
        ...(beforeText ? { beforeText: true as const } : {}),
        at: now,
      });
    });
  }

  /**
   * Records a turn's token usage on its assistant message (context meter).
   * Recorded before the turn ends, it rides the journal and lands with the
   * turn's one final rewrite; after, it rewrites the turn's file.
   */
  async setUsage(
    threadId: string,
    turnId: string,
    usage: { tokens: number; contextWindow?: number },
    now: number,
  ): Promise<void> {
    const projection = await this.#mutate(async (tx) => {
      await tx.stream(threadId, turnId, { op: 'usage', usage, at: now });
      const thread = tx.peek(threadId);
      return thread ? metricProjection(thread) : undefined;
    });
    await this.#sendMetrics(projection);
  }

  completeTurn(
    threadId: string,
    turnId: string,
    finalText: string | undefined,
    now: number,
  ): Promise<void> {
    return this.#mutate(async (tx) => {
      // A turn only ends once. An adapter whose CLI keeps running past its own
      // end-of-turn event can emit a second completion for the same turn; taking
      // it would overwrite the reply the user already read with whatever the
      // later one carried, and (in the manager) drain the message queue twice.
      if (TERMINAL_TURN_STATUSES.has(tx.header(threadId, turnId).status)) return;
      const turn = await tx.turn(threadId, turnId);
      if (finalText !== undefined) {
        const assistant = turn.messages.find((m) => m.role === 'assistant');
        if (assistant) reconcileAssistantWithFinalText(assistant, finalText);
      }
      turn.status = 'completed';
      turn.completedAt = now;
      settleRunningSteps(turn, true);
      this.#layouts.delete(turnKey(threadId, turnId));
      const thread = tx.thread(threadId);
      settleTransfer(thread, turn);
      thread.updatedAt = now;
      this.#bump(thread);
    });
  }

  failTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'error', now);
  }

  abortTurn(threadId: string, turnId: string, now: number): Promise<void> {
    return this.#setTurnStatus(threadId, turnId, 'aborted', now);
  }

  #setTurnStatus(threadId: string, turnId: string, status: TurnStatus, now: number): Promise<void> {
    return this.#mutate(async (tx) => {
      const header = tx.header(threadId, turnId);
      // Only a terminal status stamps `completedAt`. `beginQueuedTurn` moves a
      // turn from `queued` to `streaming` — it is starting, not ending, and
      // stamping it there would date a live turn as finished.
      if (TERMINAL_TURN_STATUSES.has(status)) {
        const turn = await tx.turn(threadId, turnId);
        turn.status = status;
        turn.completedAt = now;
        settleRunningSteps(turn, false);
        this.#layouts.delete(turnKey(threadId, turnId));
        settleTransfer(tx.thread(threadId), turn);
      } else {
        header.status = status;
      }
      const thread = tx.thread(threadId);
      thread.updatedAt = now;
      this.#bump(thread);
    });
  }

  /**
   * Stamp a thread's summary as changed: it takes the next sync revision and is
   * announced once the transaction is on disk. Only for changes a client shows
   * in a list (title, status, model, turns created or ended…) — never for
   * streamed tokens, which reach clients as their own notifications.
   */
  #bump(thread: { id: string; rev?: number }): void {
    thread.rev = this.#ledger.next();
    this.#changed.add(thread.id);
    this.#mutation?.indexes.add(thread.id);
  }

  /** Backfills every currently stored thread/turn into the durable activity
   * ledger. Idempotent and intentionally non-destructive: ledger rows absent
   * from the store are historical records and must remain. */
  async captureAllMetrics(): Promise<number> {
    if (!this.#metricsSink) return 0;
    const conversations: ConversationMetricEvent[] = [];
    const turns: TurnMetricEvent[] = [];
    for (const thread of (await this.#records()).values()) {
      const projection = metricProjection(thread);
      conversations.push(projection.conversation);
      turns.push(...projection.turns);
    }
    return this.#metricsSink.mergeConversationHistory(conversations, turns);
  }

  /** Best-effort incremental projection. A later `captureAllMetrics` repairs any
   * transient ledger-write failure without blocking conversation operations. */
  async #sendMetrics(projection: MetricProjection | undefined): Promise<void> {
    if (!this.#metricsSink || !projection) return;
    await this.#metricsSink
      .mergeConversationHistory([projection.conversation], projection.turns)
      .catch(() => undefined);
  }

  /**
   * Every thread's summary and turn headers, loaded once.
   *
   * Memoized as the in-flight PROMISE, never as the resolved value: reads do not
   * take the write lock, so two that arrive before the first load finishes would
   * otherwise each load their own copy, and every mutation applied to whichever
   * one lost the race would be silently dropped. The suite caught exactly that —
   * queue tests failing about one run in three.
   */
  #threads: Promise<Map<string, ThreadRecord>> | undefined;
  /** {@link #threads} once loaded, for the cache to walk synchronously. */
  #loaded: Map<string, ThreadRecord> | undefined;

  #records(): Promise<Map<string, ThreadRecord>> {
    this.#threads ??= this.#open();
    return this.#threads;
  }

  /**
   * Resolves once every write requested before this call has landed. A
   * notification can go out before its write does — the manager announces a
   * hand-off synchronously so no later event of the run overtakes it — and a
   * client answers it by re-reading the turn (`turn/read`, `turn/list`): that
   * read must see the write it was told about, or it would replace the client's
   * correct live copy with the one from before (a hand-off read back with no
   * end and no `continuedIn` folded the answer so far away). Never awaited from
   * inside a mutation, which already holds the lock.
   */
  #afterPendingWrites(): Promise<void> {
    return this.#lock;
  }

  /**
   * Resolves once every write requested so far has landed — what a caller that
   * is about to take the store's directory away (a test's cleanup) waits for.
   * A write still on its way then would land in a folder that is gone.
   */
  settled(): Promise<void> {
    return this.#afterPendingWrites();
  }

  /**
   * Converts what an older bridge left, then reads every `thread.json` — and
   * nothing else, unless a crash left a turn's journal behind ({@link
   * #recoverJournals}).
   */
  async #open(): Promise<Map<string, ThreadRecord>> {
    await this.#migrate();
    const records = new Map<string, ThreadRecord>();
    for (const { threadId, text } of await this.#state.readThreadIndexes()) {
      const thread = parseIndex(text);
      if (!thread || thread.id !== threadId) continue;
      records.set(thread.id, thread);
      this.#disk.set(thread.id, {
        index: text,
        turns: new Map(thread.turns.map((turn) => [turn.id, newTurnDisk(turn.bytes ?? 0)])),
      });
      this.#ledger.observe(thread.rev);
    }
    await this.#recoverJournals(records);
    this.#loaded = records;
    return records;
  }

  /**
   * Folds into its turn the journal a previous run left — it was streaming
   * when it stopped. The turn keeps everything that reached the journal (a
   * last line cut in half by the crash is ignored) and stays as it was
   * (`streaming`, as any turn a restart cut short); its conversation's time is
   * that of the last event. Only a turn that had not ended can have one: an
   * ending folds the journal before the index records it.
   */
  async #recoverJournals(records: Map<string, ThreadRecord>): Promise<void> {
    const m = new Mutation();
    for (const thread of records.values()) {
      for (const turn of thread.turns) {
        if (TERMINAL_TURN_STATUSES.has(turn.status)) continue;
        const journal = await this.#state.readTurnJournal(thread.id, turn.id);
        if (journal === null) continue;
        this.#turnDisk(thread.id, turn.id).journal = true;
        await this.#loadTurn(thread, turn);
        thread.updatedAt = Math.max(thread.updatedAt, lastEventAt(journal));
        m.indexes.add(thread.id);
        m.bodies.add(turnKey(thread.id, turn.id));
      }
    }
    if (m.indexes.size > 0) await this.#commit(m, records);
  }

  /**
   * Converts conversations stored by an older bridge into the current layout,
   * once: each `threads/<id>.json` (one file per conversation), then anything
   * still in the single `threads.json` before it. A converted file is moved out
   * of the way, never deleted (`threads.v1/`, `threads.json.migrated`).
   *
   * A conversion is finished when its `thread.json` exists — written last — so
   * one interrupted halfway is simply done again from the original, and one
   * finished but not yet moved is only moved. Between the two old layouts the
   * per-conversation file is the newer truth and wins.
   */
  async #migrate(): Promise<void> {
    for (const threadId of await this.#state.v1ThreadIds()) {
      if (!(await this.#state.hasThreadIndex(threadId))) {
        const thread = await this.#state.readV1ThreadFile<StoredThread>(threadId);
        // Unreadable: left where it is rather than lost.
        if (!thread || thread.id !== threadId || !Array.isArray(thread.turns)) continue;
        await this.#writeConverted(thread);
      }
      await this.#state.retireV1ThreadFile(threadId);
    }
    const legacy = await this.#state.readJson<StoredThread[]>(DAEMON_FILES.threads);
    if (legacy === null) return;
    for (const thread of legacy) {
      if (!(await this.#state.hasThreadIndex(thread.id))) await this.#writeConverted(thread);
    }
    await this.#state.retireLegacyThreads();
  }

  /**
   * Writes one conversation of an older layout in the current one, normalized
   * the way every load used to normalize it — which, done here once, no load
   * has to repeat: the current layout is only ever written in that shape.
   */
  async #writeConverted(thread: StoredThread): Promise<void> {
    for (const turn of thread.turns) turn.messages = turn.messages.map(currentMessage);
    numberTurns(thread);
    retireDeliveredTurns(thread);
    reshapeImportedTurns(thread);
    for (const turn of thread.turns) {
      turn.threadId = thread.id;
      const text = serializeTurn(turn.messages, 0);
      await this.#state.writeTurnFile(thread.id, turn.id, text);
      turn.messageDays = messageDaysOf(turn.messages);
      turn.bytes = Buffer.byteLength(text);
    }
    await this.#state.writeThreadIndex(thread.id, serializeIndex(thread));
  }

  /**
   * A turn with its messages, reading its file (and replaying its journal)
   * when they are not in memory. Two callers asking at once share one read,
   * so a mutation and a reader can never end up holding different copies.
   */
  #loadTurn(thread: ThreadRecord, turn: TurnRecord): Promise<StoredTurn> {
    this.#touchHot(thread.id);
    if (turn.messages) return Promise.resolve(turn as StoredTurn);
    const key = turnKey(thread.id, turn.id);
    let loading = this.#loading.get(key);
    if (!loading) {
      loading = this.#readTurn(thread, turn).finally(() => this.#loading.delete(key));
      this.#loading.set(key, loading);
    }
    return loading;
  }

  async #readTurn(thread: ThreadRecord, turn: TurnRecord): Promise<StoredTurn> {
    const disk = this.#turnDisk(thread.id, turn.id);
    const text = await this.#state.readTurnFile(thread.id, turn.id);
    let file: TurnFile = { events: 0, messages: [] };
    // The file's own text is what serializing it again would give (it was
    // written by {@link serializeTurn}), so it is hashed as read.
    let digest = digestOf(serializeTurn(file.messages, file.events));
    if (text !== null) {
      try {
        const parsed = JSON.parse(text) as Partial<TurnFile>;
        if (typeof parsed.events === 'number' && Array.isArray(parsed.messages)) {
          file = { events: parsed.events, messages: parsed.messages };
          digest = digestOf(text);
        }
      } catch {
        // A damaged turn reads as empty rather than costing the conversation;
        // its file is left as it is unless the turn really changes.
      }
    }
    const loaded = turn as StoredTurn;
    loaded.messages = file.messages;
    disk.digest = digest;
    disk.bytes = text === null ? 0 : Buffer.byteLength(text);
    disk.events = file.events;
    turn.bytes = disk.bytes;
    if (disk.journal) {
      const journal = await this.#state.readTurnJournal(thread.id, turn.id);
      if (journal !== null) {
        disk.journalBytes = Buffer.byteLength(journal);
        disk.events = replayJournal(loaded, journal, file.events);
      }
    }
    return loaded;
  }

  #threadDisk(threadId: string): ThreadDisk {
    let disk = this.#disk.get(threadId);
    if (!disk) this.#disk.set(threadId, (disk = { turns: new Map() }));
    return disk;
  }

  #turnDisk(threadId: string, turnId: string): TurnDisk {
    const thread = this.#threadDisk(threadId);
    let disk = thread.turns.get(turnId);
    if (!disk) thread.turns.set(turnId, (disk = newTurnDisk(0)));
    return disk;
  }

  /** Marks [threadId] as the most recently used conversation in memory. */
  #touchHot(threadId: string): void {
    this.#hot.delete(threadId);
    this.#hot.add(threadId);
  }

  /**
   * Drops the messages of the conversations used longest ago until what stays
   * fits the cache budget ({@link DEFAULT_BODY_CACHE_BYTES} unless the store
   * was given another). Never one a transaction is working
   * on, one being streamed into, nor the one used last (a single conversation
   * larger than the budget stays while it is the one in use). Dropping is
   * always safe: everything in memory is already on disk, journal included.
   */
  #evict(): void {
    const records = this.#loaded;
    if (!records || this.#hot.size < 2) return;
    const sizes = new Map<string, number>();
    let total = 0;
    for (const threadId of this.#hot) {
      const size = this.#loadedBytes(records.get(threadId));
      sizes.set(threadId, size);
      total += size;
    }
    if (total <= this.#bodyCacheBytes) return;
    const newest = [...this.#hot].at(-1);
    for (const [threadId, size] of sizes) {
      if (total <= this.#bodyCacheBytes) break;
      const thread = records.get(threadId);
      if (threadId === newest || (thread && this.#pinned(thread))) continue;
      for (const turn of thread?.turns ?? []) delete (turn as { messages?: unknown }).messages;
      this.#hot.delete(threadId);
      total -= size;
    }
  }

  #loadedBytes(thread: ThreadRecord | undefined): number {
    let bytes = 0;
    for (const turn of thread?.turns ?? []) {
      if (!turn.messages) continue;
      bytes +=
        (turn.bytes ?? 0) + (this.#disk.get(thread!.id)?.turns.get(turn.id)?.journalBytes ?? 0);
    }
    return bytes;
  }

  #pinned(thread: ThreadRecord): boolean {
    if (this.#mutation?.touches(thread.id)) return true;
    const disk = this.#disk.get(thread.id);
    return thread.turns.some(
      (turn) => !TERMINAL_TURN_STATUSES.has(turn.status) && disk?.turns.get(turn.id)?.live === true,
    );
  }

  /** Runs [fn] as one transaction, after every one asked for before it. */
  #mutate<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = this.#lock.then(() => this.#transact(fn));
    // Keep the chain alive regardless of individual failures.
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Runs [fn] with the state it may change ({@link Tx}), then writes what it
   * reached ({@link #commit}), then tells listeners. A transaction that throws
   * writes nothing.
   */
  async #transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const records = await this.#records();
    const m = new Mutation();
    this.#mutation = m;
    this.#changed.clear();
    this.#deleted.length = 0;
    try {
      const result = await fn(this.#txFor(m, records));
      await this.#commit(m, records);
      if (this.#changed.size > 0 || this.#deleted.length > 0) {
        // The revisions go to disk before anyone hears of them, so a client
        // can never hold a revision the bridge might hand out again.
        await this.#ledger.flush();
        this.#announce(records);
      }
      return result;
    } finally {
      this.#mutation = undefined;
      this.#changed.clear();
      this.#deleted.length = 0;
      this.#evict();
    }
  }

  #txFor(m: Mutation, records: Map<string, ThreadRecord>): Tx {
    const find = (threadId: string): ThreadRecord | undefined => {
      const thread = records.get(threadId);
      if (thread) m.indexes.add(threadId);
      return thread;
    };
    const thread = (threadId: string): ThreadRecord => {
      const found = find(threadId);
      if (!found) throw notFound(`thread not found: ${threadId}`);
      return found;
    };
    const header = (threadId: string, turnId: string): TurnRecord => {
      const turn = find(threadId)?.turns.find((t) => t.id === turnId);
      if (!turn) throw notFound(`turn not found: ${turnId}`);
      return turn;
    };
    const turn = (threadId: string, turnId: string): Promise<StoredTurn> => {
      const record = header(threadId, turnId);
      m.bodies.add(turnKey(threadId, turnId));
      return this.#loadTurn(thread(threadId), record);
    };
    const loadAll = async (threadId: string): Promise<StoredThread> => {
      const record = requireThread(records, threadId);
      m.pinned.add(threadId);
      await Promise.all(record.turns.map((t) => this.#loadTurn(record, t)));
      return record as unknown as StoredThread;
    };
    return {
      peek: (threadId) => {
        const found = records.get(threadId);
        if (found) m.pinned.add(threadId);
        return found;
      },
      find,
      thread,
      all: () => {
        for (const threadId of records.keys()) m.indexes.add(threadId);
        return [...records.values()];
      },
      header,
      turn,
      whole: (threadId) => {
        const record = thread(threadId);
        for (const t of record.turns) m.bodies.add(turnKey(threadId, t.id));
        return loadAll(threadId);
      },
      view: (threadId) => loadAll(threadId),
      stream: async (threadId, turnId, event) => {
        const record = records.get(threadId);
        const target = record?.turns.find((t) => t.id === turnId);
        if (!record || !target) throw notFound(`turn not found: ${turnId}`);
        m.pinned.add(threadId);
        if (TERMINAL_TURN_STATUSES.has(target.status)) {
          // Every adapter that ends a turn on a protocol event (all but
          // Antigravity, which ends on process exit) leaves its CLI alive and
          // can emit after the end — Claude Code does, when background work it
          // left running wakes it for another turn. Appending that to a closed
          // turn silently rewrote a reply the user had already read, so it is
          // refused; a no-op, since late output is a normal race. A step's
          // settled form and the turn's usage still belong to it.
          if (event.op === 'delta' || event.op === 'thinking' || event.op === 'block') {
            return false;
          }
          const ended = await turn(threadId, turnId);
          requireAssistant(ended);
          const changed = applyTurnEvent(ended, event);
          if (changed) thread(threadId).updatedAt = event.at;
          return changed;
        }
        const live = await this.#loadTurn(record, target);
        requireAssistant(live);
        if (!applyTurnEvent(live, event)) return false;
        record.updatedAt = event.at;
        const disk = this.#turnDisk(threadId, turnId);
        disk.events += 1;
        disk.live = true;
        m.events.push({
          threadId,
          turnId,
          line: `${JSON.stringify({ n: disk.events, ...event })}\n`,
        });
        return true;
      },
      add: (created) => {
        records.set(created.id, created);
        this.#disk.set(created.id, { turns: new Map() });
        m.indexes.add(created.id);
      },
      remove: (threadId) => {
        records.delete(threadId);
        m.indexes.delete(threadId);
        m.removed.add(threadId);
      },
    };
  }

  /**
   * Writes what a transaction reached: deleted threads go, each reached turn
   * whose messages came out different is rewritten (folding its journal), each
   * reached index that changed is rewritten, and journaled events are appended.
   *
   * The order is what makes a crash anywhere in it safe. A turn's journal is
   * removed only after the file that folds it in is written (the file records
   * how many events it folded, so a replay never applies one twice); the index
   * is written after the turns it lists; a turn the index dropped loses its
   * file only after.
   */
  async #commit(m: Mutation, records: Map<string, ThreadRecord>): Promise<void> {
    for (const threadId of m.removed) {
      await this.#state.removeThread(threadId);
      await this.#state.removeAttachments(threadId);
      this.#disk.delete(threadId);
      this.#hot.delete(threadId);
    }
    // A failed append may have left half a line: appending after it would
    // glue the next event to it. Rewrite the turn's file instead, which folds
    // every event in (this one included) and starts the journal afresh.
    for (const { threadId, turnId } of m.events) {
      if (!this.#turnDisk(threadId, turnId).suspect) continue;
      m.indexes.add(threadId);
      m.bodies.add(turnKey(threadId, turnId));
    }
    const written = new Set<string>();
    for (const threadId of m.indexes) {
      const thread = records.get(threadId);
      if (thread) await this.#persist(m, thread, written);
    }
    for (const event of m.events) {
      if (written.has(turnKey(event.threadId, event.turnId))) continue;
      const disk = this.#turnDisk(event.threadId, event.turnId);
      disk.journal = true;
      try {
        await this.#state.appendTurnJournal(event.threadId, event.turnId, event.line);
      } catch (err) {
        disk.suspect = true;
        throw err;
      }
      disk.journalBytes += Buffer.byteLength(event.line);
    }
  }

  async #persist(m: Mutation, thread: ThreadRecord, written: Set<string>): Promise<void> {
    const disk = this.#threadDisk(thread.id);
    // The digest follows the turn files: whatever rewrote a turn rewrites its
    // entry, and a turn that goes takes its entry with it.
    const digested = new Map<string, TurnDigest>();
    const dropped: string[] = [];
    // A turn that ended keeps no journal, whatever ended it: its events are
    // folded into its file here, so no mutation can leave one behind.
    for (const turn of thread.turns) {
      if (!TERMINAL_TURN_STATUSES.has(turn.status) || !disk.turns.get(turn.id)?.journal) continue;
      await this.#loadTurn(thread, turn);
      m.bodies.add(turnKey(thread.id, turn.id));
    }
    for (const turn of thread.turns) {
      const key = turnKey(thread.id, turn.id);
      let known = disk.turns.get(turn.id);
      if (known && !m.bodies.has(key)) continue;
      if (!turn.messages) {
        if (known) continue;
        throw new Error(`turn ${turn.id} has neither a file nor messages`);
      }
      const messages = turn.messages as StoredMessage[];
      turn.messageDays = messageDaysOf(messages);
      const text = serializeTurn(messages, known?.events ?? 0);
      const digest = digestOf(text);
      if (known && known.digest === digest && !known.journal) {
        turn.bytes = known.bytes;
        continue;
      }
      await this.#state.writeTurnFile(thread.id, turn.id, text);
      digested.set(turn.id, digestOfTurn(turn, messages));
      known ??= this.#turnDisk(thread.id, turn.id);
      known.digest = digest;
      known.bytes = Buffer.byteLength(text);
      turn.bytes = known.bytes;
      written.add(key);
      if (known.journal) {
        await this.#state.removeTurnJournal(thread.id, turn.id);
        known.journal = false;
        known.journalBytes = 0;
        known.suspect = false;
      }
      this.#touchHot(thread.id);
    }
    const index = serializeIndex(thread);
    if (index !== disk.index) {
      await this.#state.writeThreadIndex(thread.id, index);
      disk.index = index;
    }
    const kept = new Set(thread.turns.map((turn) => turn.id));
    for (const turnId of [...disk.turns.keys()]) {
      if (kept.has(turnId)) continue;
      await this.#state.removeTurnFiles(thread.id, turnId);
      disk.turns.delete(turnId);
      dropped.push(turnId);
    }
    if (digested.size > 0 || dropped.length > 0) {
      const digest = parseDigest(await this.#state.readThreadDigest(thread.id)) ?? {
        v: 1 as const,
        turns: {},
      };
      for (const [turnId, entry] of digested) digest.turns[turnId] = entry;
      for (const turnId of dropped) delete digest.turns[turnId];
      await this.#writeDigest(thread.id, digest);
    }
  }

  #announce(records: Map<string, ThreadRecord>): void {
    const changes: ThreadChange[] = [];
    for (const id of this.#changed) {
      const thread = records.get(id);
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
}

function requireThread(records: Map<string, ThreadRecord>, threadId: string): ThreadRecord {
  const thread = records.get(threadId);
  if (!thread) throw notFound(`thread not found: ${threadId}`);
  return thread;
}

function requireAssistant(turn: StoredTurn): StoredMessage {
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  if (!assistant) throw notFound(`assistant message not found for turn: ${turn.id}`);
  return assistant;
}

/** The key one turn is known by across a store's bookkeeping. */
function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\n${turnId}`;
}

function newTurnDisk(bytes: number): TurnDisk {
  return { bytes, events: 0, journal: false, journalBytes: 0, live: false, suspect: false };
}

function digestOf(text: string): string {
  return createHash('sha1').update(text).digest('base64');
}

/**
 * The transcript [signature] merged into [thread] as it stands: what a merge
 * depends on besides the transcript is which turns the thread holds and which
 * of them ended, so a turn created, imported, dropped or ended makes the next
 * read merge again even over an unchanged transcript.
 */
function nativeKey(signature: string, thread: Frozen<ThreadRecord>): string {
  let ended = 0;
  for (const turn of thread.turns) if (TERMINAL_TURN_STATUSES.has(turn.status)) ended += 1;
  return `${signature}|${thread.turns.length}.${thread.lastSeq ?? 0}.${ended}`;
}

/** A turn's file: its messages and the events folded in. */
function serializeTurn(messages: readonly StoredMessage[], events: number): string {
  const file: TurnFile = { events, messages: [...messages] };
  return JSON.stringify(file);
}

/** A thread's `thread.json`: its summary and a header per turn — no messages. */
function serializeIndex(thread: Frozen<ThreadRecord> | StoredThread): string {
  const index: Record<string, unknown> = { ...thread };
  index['turns'] = thread.turns.map((turn) => ({
    id: turn.id,
    ...(turn.seq !== undefined ? { seq: turn.seq } : {}),
    status: turn.status,
    createdAt: turn.createdAt,
    ...(turn.completedAt !== undefined ? { completedAt: turn.completedAt } : {}),
    ...(turn.nativeHistoryTurnId !== undefined
      ? { nativeHistoryTurnId: turn.nativeHistoryTurnId }
      : {}),
    ...(turn.handedOffTo !== undefined ? { handedOffTo: turn.handedOffTo } : {}),
    messageDays: turn.messageDays ?? [],
    bytes: turn.bytes ?? 0,
  }));
  return JSON.stringify(index);
}

function parseIndex(text: string): ThreadRecord | undefined {
  try {
    const index = JSON.parse(text) as ThreadRecord;
    if (typeof index?.id !== 'string' || !Array.isArray(index.turns)) return undefined;
    for (const turn of index.turns) turn.threadId = index.id;
    return index;
  } catch {
    return undefined;
  }
}

/**
 * Applies a journal's events after the [folded] ones its turn's file already
 * holds, in order, stopping at the first line that does not parse — the last
 * one, half-written, when a crash cut it. Returns the last event number.
 */
function replayJournal(turn: StoredTurn, journal: string, folded: number): number {
  let events = folded;
  for (const line of journal.split('\n')) {
    if (line.length === 0) continue;
    let event: TurnEvent & { n: number };
    try {
      event = JSON.parse(line) as TurnEvent & { n: number };
    } catch {
      break;
    }
    if (typeof event.n !== 'number' || event.n <= events) continue;
    applyTurnEvent(turn, event);
    events = event.n;
  }
  return events;
}

/** When the last readable event of a journal happened (0 when none). */
function lastEventAt(journal: string): number {
  let at = 0;
  for (const line of journal.split('\n')) {
    if (line.length === 0) continue;
    try {
      const event = JSON.parse(line) as { at?: unknown };
      if (typeof event.at === 'number') at = event.at;
    } catch {
      break;
    }
  }
  return at;
}

/**
 * The shape of an in-flight turn's assistant `segments` as of every event
 * already handed to the store: how many entries, whether the last is a text
 * run or a thought, where each live step (`blockId`) stands. It moves when an event is
 * QUEUED — synchronously, in the order events arrive — not when the event is
 * applied, so a block's live notification can name its index before its
 * write is done ({@link ThreadStore.blockIndex}). It places blocks by the same
 * rules {@link applyTurnEvent} applies, over counts instead of content: a
 * block with a known `blockId` stays where it stands; a `beforeText` block
 * takes the open text run's place, pushing the run one on; anything else is
 * appended. A delta opens a text run unless one is open; a reasoning chunk
 * opens a thought unless the last entry is one (a `beforeText` block after a
 * thought is simply appended: there is no open text run to slot before).
 */
class SegmentLayout {
  #length = 0;
  /** What the last entry is, when it is one a delta or a chunk would grow. */
  #endsIn: 'text' | 'thought' | undefined;
  readonly #steps = new Map<string, number>();

  text(delta: string): void {
    this.#grow('text', delta);
  }

  thought(delta: string): void {
    this.#grow('thought', delta);
  }

  #grow(kind: 'text' | 'thought', delta: string): void {
    if (delta.length === 0 || this.#endsIn === kind) return;
    this.#length += 1;
    this.#endsIn = kind;
  }

  /** Where [content] lands; [commit] records it as landed. */
  place(content: unknown, beforeText: boolean, commit: boolean): number {
    const blockId = blockIdOf(content);
    const known = blockId === undefined ? undefined : this.#steps.get(blockId);
    if (known !== undefined) return known;
    const slotted = beforeText && this.#endsIn === 'text';
    const index = slotted ? this.#length - 1 : this.#length;
    if (commit) {
      this.#length += 1;
      if (!slotted) this.#endsIn = undefined;
      if (blockId !== undefined) this.#steps.set(blockId, index);
    }
    return index;
  }
}

/**
 * Applies one streamed event to [turn]'s assistant message — the one function
 * both the live write and a journal replay go through, so a replayed turn is
 * the turn that was streamed. Returns whether it changed anything.
 */
function applyTurnEvent(turn: StoredTurn, event: TurnEvent): boolean {
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  if (!assistant) return false;
  switch (event.op) {
    case 'delta':
      if (event.text.length === 0) return false;
      assistant.text += event.text;
      appendTextSegment(assistant, event.text);
      return true;
    case 'thinking':
      return appendThinkingSegment((assistant.segments ??= []), event.text);
    case 'block': {
      // A step that settles replaces the running one it started as, in place
      // (`LiveBlock`, shared/src/models/tool.ts).
      if (replaceStep(assistant, event.content)) return true;
      const segments = (assistant.segments ??= []);
      const last = segments[segments.length - 1];
      if (event.beforeText && isTextSegment(last)) {
        segments.splice(segments.length - 1, 0, event.content);
      } else {
        segments.push(event.content);
      }
      return true;
    }
    case 'settle':
      return replaceStep(assistant, event.content);
    case 'usage':
      assistant.usage = event.usage;
      return true;
  }
}

/** Writes [content] over the step with its `blockId`, where it stands. */
function replaceStep(assistant: StoredMessage, content: unknown): boolean {
  const blockId = blockIdOf(content);
  if (blockId === undefined) return false;
  const segments = assistant.segments;
  const index = segments?.findIndex((b) => blockIdOf(b) === blockId) ?? -1;
  if (!segments || index < 0) return false;
  segments[index] = content;
  return true;
}

/** A turn's messages per UTC day of their creation. */
function messageDaysOf(messages: readonly Frozen<StoredMessage>[]): MessageDay[] {
  const days = new Map<number, number>();
  for (const message of messages) {
    const day = utcDayKey(message.createdAt);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return [...days].map(([day, count]) => ({ day, messages: count }));
}

/**
 * Project one thread into stable ledger rows — from its turn headers, so it
 * never needs a turn's messages (and never copies the thread to do it).
 */
function metricProjection(thread: Frozen<ThreadRecord>): MetricProjection {
  const conversation: ConversationMetricEvent = {
    id: thread.id,
    ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {}),
    ...(thread.model !== undefined ? { model: thread.model } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
  const turns = thread.turns.map(
    (turn): TurnMetricEvent => ({
      id: `${thread.id}:${turn.id}`,
      threadId: thread.id,
      ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {}),
      ...(thread.model !== undefined ? { model: thread.model } : {}),
      messageDays: turn.messages
        ? messageDaysOf(turn.messages)
        : (turn.messageDays ?? []).map((d) => ({ ...d })),
      updatedAt: thread.updatedAt,
    }),
  );
  return { conversation, turns };
}

function toThread(thread: Frozen<ThreadRecord>): Thread {
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
    ...(thread.transfer !== undefined ? { transfer: wireTransfer(thread.transfer) } : {}),
    ...(thread.continuations !== undefined && thread.continuations.length > 0
      ? { continuations: thread.continuations.map((c) => ({ ...c })) }
      : {}),
    ...(thread.rev !== undefined ? { rev: thread.rev } : {}),
  };
}

/** A stored continuation's origin as clients see it: without its private key. */
function wireTransfer(transfer: Frozen<StoredTransfer>): ConversationTransfer {
  const { key: _key, context, ...rest } = transfer;
  return { ...rest, context: { ...context } };
}

/**
 * Where a continuation's context stands once the turn that carried it ended
 * (`ConversationTransfer.status`): `delivered` when the agent answered — it
 * read the message — and back to `pending` when the turn failed or was
 * stopped before it said anything, so the next message carries it. Returns
 * whether it changed.
 */
function settleTransfer(thread: ThreadRecord, turn: StoredTurn): boolean {
  const transfer = thread.transfer;
  if (transfer?.status !== 'sent' || transfer.turnId !== turn.id) return false;
  if (turn.status === 'completed' || turnHasReply(turn)) {
    transfer.status = 'delivered';
  } else {
    transfer.status = 'pending';
    delete transfer.turnId;
  }
  return true;
}

/**
 * Whether the agent said or did anything in [turn] — text, a thought, a step.
 * The bridge's own notes (a failure's reason, a warning: `system` blocks) are
 * not the agent's: a turn that holds only those never reached it.
 */
function turnHasReply(turn: StoredTurn): boolean {
  return turn.messages.some(
    (m) =>
      m.role === 'assistant' &&
      (m.text.trim().length > 0 ||
        (m.segments ?? []).some(
          (segment) =>
            !isTextSegment(segment) && (segment as { type?: unknown } | null)?.type !== 'system',
        )),
  );
}

/**
 * The last moment anyone acted on [thread]: a turn starting or ending, or a
 * decision on its title or status. A delete decided before it is superseded.
 */
function lastDecision(thread: Frozen<ThreadRecord>): number {
  let last = Math.max(thread.decidedAt?.title ?? 0, thread.decidedAt?.status ?? 0);
  for (const turn of thread.turns) {
    last = Math.max(last, turn.createdAt, turn.completedAt ?? 0);
  }
  return last;
}

/**
 * A message steered into a running turn used to be stored as a turn of its own
 * with status `delivered` and no reply, the answer left in the turn before it.
 * It is now a turn that carries the rest of the run ({@link
 * ThreadStore.handOffTurn}); one stored the old way did reach the agent and
 * ended, so it reads as `completed`.
 */
function retireDeliveredTurns(thread: StoredThread): void {
  for (const turn of thread.turns) {
    const stored = turn as StoredTurn & { deliveredIntoTurnId?: unknown };
    if ((stored.status as string) === 'delivered') stored.status = 'completed';
    delete stored.deliveredIntoTurnId;
  }
}

/**
 * Turns imported from an agent's transcript before they were read in the
 * canonical shape ({@link canonicalTurn}): one row per transcript line, and a
 * Claude Code wake-up (`<task-notification>`) stored as a prompt of its own. A
 * row that is only a wake-up goes — its reply belongs to the turn before it,
 * which the next read of the transcript restores — and every other imported
 * row gets one assistant message.
 */
function reshapeImportedTurns(thread: StoredThread): void {
  thread.turns = thread.turns.filter((turn) => {
    if (turn.nativeHistoryTurnId !== turn.id) return true;
    const prompt = turn.messages.find((m) => m.role === 'user')?.text ?? '';
    return !isAgentWake(prompt);
  });
  thread.turns = thread.turns.map((turn) => {
    if (turn.messages.filter((m) => m.role === 'assistant').length <= 1) return turn;
    const reshaped = storedTurnFromNative(canonicalTurn(toTurn(turn)));
    if (turn.seq !== undefined) reshaped.seq = turn.seq;
    if (turn.nativeHistoryTurnId !== undefined) {
      reshaped.nativeHistoryTurnId = turn.nativeHistoryTurnId;
    }
    return reshaped;
  });
}

/** A segment's text, when it is a text run. */
function segmentText(segment: unknown): string | undefined {
  if (!segment || typeof segment !== 'object') return undefined;
  const s = segment as { type?: unknown; text?: unknown };
  return s.type === 'text' && typeof s.text === 'string' ? s.text : undefined;
}

/**
 * Put back where it belongs the reply to a message a bridge from before the
 * hand-off took mid-turn: it was stored as a turn with no reply while the
 * reply went on in the turn before it, so the message showed below its own
 * answer. The agent's transcript ([native]) says what that reply is; the part
 * of the previous turn from where it begins moves into [stored]. Changes
 * nothing unless [stored] is empty and the previous turn ends with exactly
 * that reply. Returns whether it moved anything.
 */
function takeBackSteeredReply(turns: StoredTurn[], stored: StoredTurn, native: Turn): boolean {
  const identity = storedTurnIdentity(stored);
  const wanted = nativeTurnIdentity(native).assistant;
  if (identity.assistant.length > 0 || wanted.length === 0) return false;
  const before = turns[turns.indexOf(stored) - 1];
  const from = before?.messages.find((m) => m.role === 'assistant');
  const segments = from?.segments;
  if (!before || !from || !segments) return false;
  // The earliest text run from which the rest of the previous reply is the
  // start of the transcript's reply to this message.
  let cut = -1;
  for (let k = 0; k < segments.length; k++) {
    if (segmentText(segments[k]) === undefined) continue;
    const tail = withoutWhitespace(
      segments
        .slice(k)
        .map((s) => segmentText(s) ?? '')
        .join(''),
    );
    if (tail.length > 0 && wanted.startsWith(tail)) {
      cut = k;
      break;
    }
  }
  if (cut <= 0) return false;
  const moved = segments.slice(cut);
  const kept = segments.slice(0, cut);
  const textOf = (list: unknown[]) => list.map((s) => segmentText(s) ?? '').join('');
  from.segments = kept;
  from.text = textOf(kept);
  const reply = stored.messages.find((m) => m.role === 'assistant');
  const target: StoredMessage = reply ?? {
    id: `${stored.id}-reply`,
    turnId: stored.id,
    role: 'assistant',
    text: '',
    createdAt: stored.createdAt,
  };
  target.segments = moved;
  target.text = textOf(moved);
  if (!reply) stored.messages.push(target);
  return true;
}

/**
 * The next turn position in [thread] (see `Turn.seq`), taken: positions only
 * ever grow, even past turns the store has since dropped.
 */
function nextSeq(thread: {
  lastSeq?: number;
  readonly turns: readonly { seq?: number }[];
}): number {
  let max = thread.lastSeq ?? 0;
  for (const turn of thread.turns) if ((turn.seq ?? 0) > max) max = turn.seq ?? 0;
  thread.lastSeq = max + 1;
  return thread.lastSeq;
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
  // Every position handed out so far — before anything on load drops a turn.
  thread.lastSeq = Math.max(thread.lastSeq ?? 0, next - 1);
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
  if (turn.handedOffTo !== undefined) result.continuedIn = turn.handedOffTo;
  return result;
}

/**
 * A stored message in the wire shape, whole — what the bridge itself reads
 * (titles, reconciliation, the detail methods). A page serves it summarized
 * (`summarizeTurn`). An assistant message always carries `segments`.
 */
function toMessage(message: StoredMessage): Message {
  return {
    id: message.id,
    turnId: message.turnId,
    role: message.role,
    content: message.text,
    ...(message.role === 'assistant'
      ? { segments: message.segments ?? textRuns(message.text) }
      : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments }
      : {}),
    createdAt: message.createdAt,
  };
}

/** The `segments` of a message that is only [text]: one run, or none. */
function textRuns(text: string): unknown[] {
  return text.length > 0 ? [{ type: 'text', text }] : [];
}

/** File extension for a stored image (no dot); `bin` for an unknown type. */
/** A stored file's extension from its name (letters and digits only), else `bin`. */
function fileNameExtension(name: string | undefined): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name ?? '');
  return match?.[1]?.toLowerCase() ?? 'bin';
}

function attachmentExtension(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split('/')[1] ?? '';
  const known: Record<string, string> = {
    png: 'png',
    jpeg: 'jpg',
    jpg: 'jpg',
    webp: 'webp',
    gif: 'gif',
    heic: 'heic',
    bmp: 'bmp',
  };
  return known[subtype] ?? 'bin';
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

/**
 * Merges an agent's transcript ([nativeTurns]) into [thread], whose every
 * turn's messages are loaded — the rules {@link ThreadStore.reconcileNativeHistory}
 * describes. Changes [thread] in place; says whether a client would see a
 * difference (a link to a native id alone is bookkeeping, not a change).
 */
function mergeNativeTurns(thread: StoredThread, nativeTurns: Turn[]): NativeHistoryReconcileResult {
  const candidates = nativeTurns.filter(
    (turn) => turn.threadId === thread.id && importableNativeTurn(turn),
  );
  // Heal what an earlier read imported from the bridge's own runs (a
  // transcript's per-line "prompts" once each became a turn of their own).
  const strays = thread.turns.filter(
    (turn) => isImportedTurn(turn) && insideBridgeRun(thread.turns, turn.createdAt),
  );
  for (const stray of strays) thread.turns.splice(thread.turns.indexOf(stray), 1);
  if (candidates.length === 0) return { changed: strays.length > 0, importedTurnIds: [] };

  const claimed = new Set<StoredTurn>();
  const importedTurnIds: string[] = [];
  let refreshed = false;
  let pruned = strays.length > 0;

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
      stored.nativeHistoryTurnId ??= native.id;
      if (takeBackSteeredReply(thread.turns, stored, native)) refreshed = true;
      if (fillEmptyReply(thread.turns, stored, native)) refreshed = true;
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

    // The bridge was driving the session then: this is (part of) that
    // run, not a turn of its own, even when no twin matched it.
    if (insideBridgeRun(thread.turns, native.createdAt)) continue;

    // Already imported under another id: a reader's ids are positions in
    // the transcript, and a fix to what counts as a prompt renumbers them.
    // The exchange is the row that holds it, not a second one.
    const known = sameExchange(thread.turns, native, claimed);
    if (known) {
      // The row may hold an earlier, shorter reading of it (imported while
      // the agent was still answering): take today's, in the same place.
      const replacement = storedTurnFromNative(native);
      replacement.nativeHistoryTurnId = native.id;
      if (known.seq !== undefined) replacement.seq = known.seq;
      if (JSON.stringify(toTurn(known)) !== JSON.stringify(toTurn(replacement))) {
        thread.turns[thread.turns.indexOf(known)] = replacement;
        claimed.add(replacement);
        refreshed = true;
      } else {
        claimed.add(known);
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

  // A row imported twice under different ids (before the rule above) is
  // a copy of one this read matched: keep that one.
  for (const turn of [...thread.turns]) {
    if (!isImportedTurn(turn) || claimed.has(turn)) continue;
    const row = { identity: storedTurnIdentity(turn), createdAt: turn.createdAt };
    const copyOf = [...claimed].some(
      (other) =>
        isImportedTurn(other) &&
        oneExchange({ identity: storedTurnIdentity(other), createdAt: other.createdAt }, row),
    );
    if (copyOf) {
      thread.turns.splice(thread.turns.indexOf(turn), 1);
      pruned = true;
    }
  }

  return { changed: importedTurnIds.length > 0 || refreshed || pruned, importedTurnIds };
}

/** Native history is imported only once a meaningful assistant result exists. */
/**
 * Whether two rows hold one exchange: the same prompt, started at the same
 * moment. The reply is no part of it — a row imported while the agent was
 * still answering holds an earlier, shorter copy of the same reply.
 */
function oneExchange(
  a: { identity: TurnIdentity; createdAt: number },
  b: { identity: TurnIdentity; createdAt: number },
): boolean {
  if (a.identity.user !== b.identity.user) return false;
  return (
    a.createdAt === b.createdAt ||
    (a.identity.assistant.length > 0 && a.identity.assistant === b.identity.assistant)
  );
}

/** An unclaimed row already imported from the transcript that holds the same
 *  exchange as [native] ({@link oneExchange}) under another id. */
function sameExchange(
  turns: readonly StoredTurn[],
  native: Turn,
  claimed: ReadonlySet<StoredTurn>,
): StoredTurn | undefined {
  const wanted = { identity: nativeTurnIdentity(native), createdAt: native.createdAt };
  return turns.find(
    (turn) =>
      isImportedTurn(turn) &&
      !claimed.has(turn) &&
      oneExchange({ identity: storedTurnIdentity(turn), createdAt: turn.createdAt }, wanted),
  );
}

/** A row imported from the agent's own transcript (its id IS the native id),
 *  as opposed to a turn the bridge ran and recorded itself. */
function isImportedTurn(turn: StoredTurn): boolean {
  return turn.nativeHistoryTurnId !== undefined && turn.id === turn.nativeHistoryTurnId;
}

/**
 * Whether [at] falls inside a run the bridge itself drove in this thread: a
 * turn it recorded (not an imported one) that started, and had not yet ended,
 * by then. The start allows for the slack between the transcript's clock and
 * the bridge's; the end does not, since an exchange typed elsewhere right
 * after the run is a turn of its own. A queued or cancelled turn never ran.
 *
 * Native history is only reconciled while no turn is running (`turn/list`), so
 * a turn with no end is one a restart cut short: all that is known of its run
 * is when it started, and a later exchange written elsewhere must still import.
 */
function insideBridgeRun(turns: readonly StoredTurn[], at: number): boolean {
  return turns.some(
    (turn) =>
      !isImportedTurn(turn) &&
      turn.status !== 'queued' &&
      turn.status !== 'cancelled' &&
      at >= turn.createdAt - NATIVE_TWIN_CLOCK_SLACK_MS &&
      at <= (turn.completedAt ?? turn.createdAt + NATIVE_TWIN_CLOCK_SLACK_MS),
  );
}

function importableNativeTurn(turn: Turn): boolean {
  return turn.messages.some(
    (message) =>
      message.role === 'assistant' &&
      ((typeof message.content === 'string' && message.content.trim().length > 0) ||
        hasBlock(message.segments)),
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

/**
 * [turn]'s prompt with the reply of its whole agent run: its own and that of
 * every turn it handed the run on to ({@link StoredTurn.handedOffTo}) — the
 * exchange an agent that records a steered message inside the running turn
 * keeps in its own transcript.
 */
function storedRunIdentity(turns: readonly StoredTurn[], turn: StoredTurn): TurnIdentity {
  const own = storedTurnIdentity(turn);
  let assistant = own.assistant;
  const seen = new Set<StoredTurn>([turn]);
  let next = turns.find((t) => t.id === turn.handedOffTo);
  while (next !== undefined && !seen.has(next)) {
    seen.add(next);
    assistant += storedTurnIdentity(next).assistant;
    next = turns.find((t) => t.id === next?.handedOffTo);
  }
  return { user: own.user, assistant };
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
  // A twin is the bridge's own record of the exchange. Two imported rows that
  // read alike (empty prompts, the same reply) are not each other's twin —
  // pairing them swapped rows back and forth and left copies behind.
  const eligible = turns.filter(
    (turn) =>
      turn !== exclude &&
      !isImportedTurn(turn) &&
      !claimed.has(turn) &&
      turn.status !== 'queued' &&
      turn.status !== 'cancelled',
  );
  const exact = eligible.find((turn) => {
    const identity = storedTurnIdentity(turn);
    if (identity.user !== wanted.user) return false;
    return (
      identity.assistant === wanted.assistant ||
      storedRunIdentity(turns, turn).assistant === wanted.assistant
    );
  });
  if (exact) return exact;
  // Some agents keep a different rendition of the same reply in their own log
  // than the one they streamed — Zero's transcript holds the final answer
  // without the preamble the bridge received. Same prompt, one reply containing
  // the other, AND the native turn starting inside the bridge turn's own run
  // window: only all three together identify the same turn. A turn genuinely
  // written elsewhere fails the window, so it still imports.
  const fuzzy = eligible.find((turn) => {
    const identity = storedRunIdentity(turns, turn);
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
  if (fuzzy) return fuzzy;
  // A message taken mid-turn by a bridge from before the hand-off was stored
  // as a turn with no reply of its own — the reply went on in the turn before
  // it. The transcript holds that message with the reply: it is the same
  // exchange when the prompt matches, the stored turn is empty and the turn
  // before it already holds the whole reply.
  const steered = eligible.find((turn) => {
    const identity = storedTurnIdentity(turn);
    if (identity.user !== wanted.user || identity.assistant.length > 0) return false;
    if (wanted.assistant.length === 0) return false;
    const before = turns[turns.indexOf(turn) - 1];
    return (
      before !== undefined && storedRunIdentity(turns, before).assistant.includes(wanted.assistant)
    );
  });
  if (steered) return steered;
  // A run that ended before the bridge received any of its reply — closed
  // early, or cut short by a crash — while the agent went on and answered in
  // its own transcript. Nothing of the reply is there to compare, so the
  // prompt and the run's window alone identify it ({@link fillEmptyReply}
  // then takes the reply in).
  return eligible.find(
    (turn) =>
      turn.status !== 'streaming' &&
      wanted.assistant.length > 0 &&
      withoutReply(turns, turn) &&
      storedTurnIdentity(turn).user === wanted.user &&
      native.createdAt >= turn.createdAt - NATIVE_TWIN_CLOCK_SLACK_MS &&
      native.createdAt <= (turn.completedAt ?? turn.createdAt) + NATIVE_TWIN_CLOCK_SLACK_MS,
  );
}

/** Whether [turn]'s whole run holds nothing of a reply: no text, reasoning or
 *  block in it or in any turn it handed the run on to. */
function withoutReply(turns: readonly StoredTurn[], turn: StoredTurn): boolean {
  if (storedRunIdentity(turns, turn).assistant.length > 0) return false;
  return !turn.messages.some((m) => m.role === 'assistant' && (m.segments?.length ?? 0) > 0);
}

/**
 * Take [native]'s reply into [stored], a turn the bridge ran whose whole run
 * holds none ({@link withoutReply}) — the agent answered after the bridge
 * stopped listening. The bridge's own turn keeps its id and place; only the
 * reply it never received is filled in, from the agent's transcript. Returns
 * whether anything changed.
 */
function fillEmptyReply(turns: StoredTurn[], stored: StoredTurn, native: Turn): boolean {
  if (isImportedTurn(stored) || !withoutReply(turns, stored)) return false;
  const reply = storedTurnFromNative(native).messages.filter((m) => m.role === 'assistant');
  if (!reply.some((m) => m.text.trim().length > 0 || hasBlock(m.segments))) return false;
  const empty = stored.messages.find((m) => m.role === 'assistant');
  reply.forEach((message, index) => {
    message.turnId = stored.id;
    if (index === 0 && empty) message.id = empty.id;
  });
  stored.messages = [...stored.messages.filter((m) => m.role !== 'assistant'), ...reply];
  if (native.completedAt !== undefined && native.completedAt > (stored.completedAt ?? 0)) {
    stored.completedAt = native.completedAt;
  }
  return true;
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

/** Whether an ordered interleave holds at least one block or thought (anything but a text run). */
function hasBlock(segments: readonly unknown[] | undefined): boolean {
  return segments?.some((s) => !isTextSegment(s)) ?? false;
}

/**
 * A message as a layout before this one stored it: its steps possibly kept a
 * second time, or only, in `blocks`, and its reasoning as one `thinking`
 * string beside `segments`, with no place in them.
 */
type LegacyMessage = StoredMessage & { blocks?: unknown[]; thinking?: string };

/**
 * Folds a message stored by an older layout into the current shape, where
 * `segments` alone keeps its steps and thoughts: a message that kept steps
 * only in `blocks` (a transcript import that gave no order) gets its text,
 * then those steps, as `segments`; one that kept both keeps `segments`, which
 * holds every step `blocks` did (and its response boundaries besides). Its
 * `thinking` becomes ONE thought at the START of `segments` — where in the
 * reply it was thought was never recorded, and before everything is where a
 * reply's reasoning mostly stands.
 *
 * (The per-turn files of the first build of this layout, which kept
 * `thinking` too, only ever existed on test machines: they are not converted.)
 */
function currentMessage(message: LegacyMessage): StoredMessage {
  const { blocks, thinking, ...stored } = message;
  if (blocks === undefined && thinking === undefined) return message;
  if (blocks !== undefined && (!stored.segments || stored.segments.length === 0)) {
    const segments = [...textRuns(stored.text), ...blocks];
    if (segments.length > 0) stored.segments = segments;
  }
  if (typeof thinking === 'string' && thinking.length > 0 && stored.role === 'assistant') {
    stored.segments = [
      { type: 'thinking', text: thinking },
      ...(stored.segments ?? textRuns(stored.text)),
    ];
  }
  return stored;
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
  const segments = (assistant.segments ??= [{ type: 'text', text: streamed }]);
  segments.push(boundary, { type: 'text', text: finalText });
  assistant.text = streamed + finalText;
}

/**
 * Closes the steps a turn left running when it ended (`LiveBlock`): a turn
 * that ended is never still working. As finished on a completed turn, as
 * failed on one that failed or was stopped.
 */
function settleRunningSteps(turn: StoredTurn, ok: boolean): void {
  const assistant = turn.messages.find((m) => m.role === 'assistant');
  if (!assistant) return;
  const settle = (list: unknown[] | undefined) =>
    list?.map((b) => (isRunning(b) ? settleBlock(b as Record<string, unknown>, ok) : b));
  if (assistant.segments) assistant.segments = settle(assistant.segments)!;
}

/** The key a session is known by across agents: `agentId:sessionId`. */
export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}
