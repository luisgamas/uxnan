/**
 * Persistent conversation store (threads → turns → messages) under
 * `~/.uxnan/threads.json`. Mutations are serialized through a mutex so concurrent
 * turn/delta updates don't corrupt the read-modify-write cycle.
 *
 * Source: architecture/02a-system-architecture.md §6 (domain models).
 *
 * FOR-DEV: a single JSON file is fine for the MVP; move to a per-thread or SQLite
 * store if conversation volume grows (src/conversation/thread-store.ts).
 */
import { randomUUID } from 'node:crypto';
import type {
  AccessMode,
  Message,
  MessageRole,
  Thread,
  ThreadList,
  ThreadStatus,
  ThreadTitleSource,
  Turn,
  TurnList,
  TurnStatus,
} from '@uxnan/shared';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { utcDayKey } from '../metrics/day.js';
import type { ConversationMetricEvent, TurnMetricEvent } from '../metrics/metrics-store.js';

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
  title?: string;
  agentId?: string;
  model?: string;
  cwd?: string;
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
  #lock: Promise<void> = Promise.resolve();

  constructor(state: DaemonState, metricsSink?: ConversationMetricsSink) {
    this.#state = state;
    this.#metricsSink = metricsSink;
  }

  async listThreads(projectId?: string): Promise<ThreadList> {
    const threads = await this.#read();
    const filtered = projectId ? threads.filter((t) => t.projectId === projectId) : threads;
    return { threads: filtered.map(toThread) };
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
    const captured = await this.#mutateMaybe(async (threads) => {
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
          persist: false,
        };
      }

      const claimed = new Set<StoredTurn>();
      const importedTurnIds: string[] = [];
      let refreshed = false;
      let linked = false;

      for (const native of candidates) {
        let stored = thread.turns.find(
          (turn) =>
            !claimed.has(turn) && (turn.nativeHistoryTurnId === native.id || turn.id === native.id),
        );
        if (!stored) {
          const fingerprint = nativeTurnFingerprint(native);
          stored = thread.turns.find(
            (turn) =>
              !claimed.has(turn) &&
              turn.status !== 'queued' &&
              turn.status !== 'cancelled' &&
              storedTurnFingerprint(turn) === fingerprint,
          );
        }

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
        thread.turns.push(imported);
        claimed.add(imported);
        importedTurnIds.push(imported.id);
      }

      const changed = importedTurnIds.length > 0 || refreshed;
      if (changed) {
        // Native timestamps let an external turn land between two bridge turns
        // if both clients wrote before the next refresh. V8's stable sort keeps
        // equal/unknown timestamps in their prior order.
        thread.turns.sort((a, b) => a.createdAt - b.createdAt);
        thread.updatedAt = now;
      }
      return {
        result: {
          reconcile: { changed, importedTurnIds },
          thread: changed ? structuredCloneThread(thread) : undefined,
        },
        persist: changed || linked,
      };
    });
    if (captured.thread) await this.#captureMetrics(captured.thread);
    return captured.reconcile;
  }

  async startThread(input: StartThreadInput, now: number): Promise<Thread> {
    const created = await this.#mutate(async (threads) => {
      const thread: StoredThread = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title ?? 'New thread',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        turns: [],
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      };
      threads.push(thread);
      return structuredCloneThread(thread);
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
    return this.#mutate(async (threads) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread || thread.agentSessionId === agentSessionId) return;
      thread.agentSessionId = agentSessionId;
      thread.updatedAt = now;
    });
  }

  resumeThread(threadId: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.status = 'active';
      thread.updatedAt = now;
    });
  }

  async setModel(threadId: string, model: string, now: number): Promise<void> {
    const updated = await this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.model = model;
      thread.updatedAt = now;
      return structuredCloneThread(thread);
    });
    await this.#captureMetrics(updated);
  }

  /**
   * Renames a thread; returns the updated thread for the phone to echo.
   *
   * `source` records who named it (see {@link Thread.titleSource}). It defaults
   * to `user` because that is who calls `thread/rename` — a hand-picked name is
   * final and nothing generated may replace it.
   */
  renameThread(
    threadId: string,
    title: string,
    now: number,
    source: ThreadTitleSource = 'user',
  ): Promise<Thread> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.title = title;
      thread.titleSource = source;
      thread.updatedAt = now;
      return toThread(thread);
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
    return this.#mutate(async (threads) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return undefined;
      // Absent means it predates `titleSource`, and those are all `prompt`.
      if (thread.titleSource !== undefined && thread.titleSource !== 'prompt') return undefined;
      if (thread.title === title) return undefined;
      thread.title = title;
      thread.titleSource = 'agent';
      thread.updatedAt = now;
      return toThread(thread);
    });
  }

  /**
   * Persists the per-thread access (approval) [mode]. Idempotent: setting the
   * same mode is a no-op (does not bump `updatedAt`). Returns the updated Thread.
   */
  setAccessMode(threadId: string, mode: AccessMode, now: number): Promise<Thread> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      if (thread.accessMode !== mode) {
        thread.accessMode = mode;
        thread.updatedAt = now;
      }
      return toThread(thread);
    });
  }

  /** Archives a thread (status → `archived`). Nothing is removed; reversible. */
  archiveThread(threadId: string, now: number): Promise<Thread> {
    return this.#setStatus(threadId, 'archived', now);
  }

  /** Restores an archived thread (status → `active`). */
  unarchiveThread(threadId: string, now: number): Promise<Thread> {
    return this.#setStatus(threadId, 'active', now);
  }

  /** Permanently removes a thread (and its turns). Rejects if it is unknown. */
  deleteThread(threadId: string): Promise<void> {
    return this.#mutate(async (threads) => {
      const index = threads.findIndex((t) => t.id === threadId);
      if (index === -1) throw notFound(`thread not found: ${threadId}`);
      const thread = threads[index];
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
    });
  }

  #setStatus(threadId: string, status: ThreadStatus, now: number): Promise<Thread> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.status = status;
      thread.updatedAt = now;
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
      return structuredCloneThread(copy);
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
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      const turn = thread.turns.find((t) => t.id === turnId);
      if (!turn) return;
      turn.status = 'delivered';
      turn.completedAt = now;
      turn.deliveredIntoTurnId = intoTurnId;
      thread.updatedAt = now;
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
      for (const thread of threads) {
        for (const turn of thread.turns) {
          if (turn.status !== 'queued') continue;
          turn.status = 'cancelled';
          turn.completedAt = now;
          cancelled += 1;
        }
      }
      return cancelled;
    });
  }

  async #createTurn(
    threadId: string,
    userText: string,
    status: TurnStatus,
    now: number,
  ): Promise<StartTurnResult> {
    const captured = await this.#mutate(async (threads) => {
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
        status,
        messages: [userMessage, assistantMessage],
        createdAt: now,
      });
      thread.updatedAt = now;
      return {
        result: { turnId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id },
        thread: structuredCloneThread(thread),
      };
    });
    await this.#captureMetrics(captured.thread);
    return captured.result;
  }

  appendDelta(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      if (this.#isTerminal(threads, threadId, turnId)) return;
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.text += delta;
      appendTextSegment(assistant, delta);
      this.#touch(threads, threadId, now);
    });
  }

  /** Appends a reasoning ("thinking") chunk to the turn's assistant message. */
  appendThinking(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
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
    return this.#mutate(async (threads) => {
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
    const updated = await this.#mutate(async (threads) => {
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
    return this.#mutate(async (threads) => {
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
    return this.#mutate(async (threads) => {
      const turn = this.#turn(threads, threadId, turnId);
      turn.status = status;
      // Only a terminal status stamps `completedAt`. `beginQueuedTurn` moves a
      // turn from `queued` to `streaming` — it is starting, not ending, and
      // stamping it there would date a live turn as finished.
      if (TERMINAL_TURN_STATUSES.has(status)) turn.completedAt = now;
      this.#touch(threads, threadId, now);
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

  async #read(): Promise<StoredThread[]> {
    return (await this.#state.readJson<StoredThread[]>(DAEMON_FILES.threads)) ?? [];
  }

  /** Run `fn` under the write lock with the current threads, then persist. */
  #mutate<T>(fn: (threads: StoredThread[]) => Promise<T>): Promise<T> {
    const run = this.#lock.then(async () => {
      const threads = await this.#read();
      const result = await fn(threads);
      await this.#state.writeJson(DAEMON_FILES.threads, threads);
      return result;
    });
    // Keep the chain alive regardless of individual failures.
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Serialized mutation that may prove to be a no-op and skip the disk write. */
  #mutateMaybe<T>(
    fn: (threads: StoredThread[]) => Promise<{ result: T; persist: boolean }>,
  ): Promise<T> {
    const run = this.#lock.then(async () => {
      const threads = await this.#read();
      const outcome = await fn(threads);
      if (outcome.persist) await this.#state.writeJson(DAEMON_FILES.threads, threads);
      return outcome.result;
    });
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
  };
}

function toTurn(turn: StoredTurn): Turn {
  const result: Turn = {
    id: turn.id,
    threadId: turn.threadId,
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

/** Content identity used to link a bridge UUID to the same native-log turn. */
function nativeTurnFingerprint(turn: Turn): string {
  return turn.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role}\u0000${normalizeHistoryText(message.content)}`)
    .join('\u0001');
}

function storedTurnFingerprint(turn: StoredTurn): string {
  return turn.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role}\u0000${normalizeHistoryText(message.text)}`)
    .join('\u0001');
}

function normalizeHistoryText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n') : '';
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
