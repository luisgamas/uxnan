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
  Turn,
  TurnList,
  TurnStatus,
} from '@uxnan/shared';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { utcDayKey } from '../metrics/day.js';

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
}

const DEFAULT_TURN_LIMIT = 20;

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

/**
 * Conversation-derived profile metrics, computed from the store in a single read
 * (for `metrics/get`). Sessions + git actions live elsewhere; this is only what
 * the conversation history yields.
 */
export interface ConversationMetrics {
  /** Total threads. */
  conversations: number;
  /** Distinct agent ids used. */
  agents: string[];
  /** Distinct models used. */
  models: string[];
  /** Total messages across all turns (both roles). */
  messages: number;
  /** Per-agent conversation tallies (unsorted; the caller ranks them). */
  byAgent: { agentId: string; conversations: number }[];
  /** Earliest thread creation (epoch ms), or undefined when there are none. */
  memberSince?: number;
  /** Local-day activity buckets (day-start epoch ms → conversation/message counts). */
  activityByDay: { day: number; conversations: number; messages: number }[];
}

/** Runtime config the AgentManager needs to drive a thread's turns. */
export interface ThreadRuntime {
  agentId?: string;
  model?: string;
  cwd?: string;
  /** Persisted per-thread access (approval) mode, applied per turn. */
  accessMode?: AccessMode;
}

export class ThreadStore {
  readonly #state: DaemonState;
  #lock: Promise<void> = Promise.resolve();

  constructor(state: DaemonState) {
    this.#state = state;
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

  startThread(input: StartThreadInput, now: number): Promise<Thread> {
    return this.#mutate(async (threads) => {
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
      return toThread(thread);
    });
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

  setModel(threadId: string, model: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.model = model;
      thread.updatedAt = now;
    });
  }

  /** Renames a thread; returns the updated thread for the phone to echo. */
  renameThread(threadId: string, title: string, now: number): Promise<Thread> {
    return this.#mutate(async (threads) => {
      const thread = await this.#requireThread(threads, threadId);
      thread.title = title;
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

  forkThread(threadId: string, now: number): Promise<Thread> {
    return this.#mutate(async (threads) => {
      const source = await this.#requireThread(threads, threadId);
      const copy: StoredThread = {
        ...structuredCloneThread(source),
        id: randomUUID(),
        title: `${source.title} (fork)`,
        createdAt: now,
        updatedAt: now,
      };
      threads.push(copy);
      return toThread(copy);
    });
  }

  startTurn(threadId: string, userText: string, now: number): Promise<StartTurnResult> {
    return this.#mutate(async (threads) => {
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
        status: 'streaming',
        messages: [userMessage, assistantMessage],
        createdAt: now,
      });
      thread.updatedAt = now;
      return { turnId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
    });
  }

  appendDelta(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.text += delta;
      appendTextSegment(assistant, delta);
      this.#touch(threads, threadId, now);
    });
  }

  /** Appends a reasoning ("thinking") chunk to the turn's assistant message. */
  appendThinking(threadId: string, turnId: string, delta: string, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.thinking = (assistant.thinking ?? '') + delta;
      this.#touch(threads, threadId, now);
    });
  }

  /** Appends a structured content block (command/diff/tool) to the message. */
  appendBlock(threadId: string, turnId: string, content: unknown, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.blocks = [...(assistant.blocks ?? []), content];
      (assistant.segments ??= []).push(content);
      this.#touch(threads, threadId, now);
    });
  }

  /** Records a turn's token usage on its assistant message (context meter). */
  setUsage(
    threadId: string,
    turnId: string,
    usage: { tokens: number; contextWindow?: number },
    now: number,
  ): Promise<void> {
    return this.#mutate(async (threads) => {
      const assistant = this.#assistantMessage(threads, threadId, turnId);
      assistant.usage = usage;
      this.#touch(threads, threadId, now);
    });
  }

  completeTurn(
    threadId: string,
    turnId: string,
    finalText: string | undefined,
    now: number,
  ): Promise<void> {
    return this.#mutate(async (threads) => {
      const turn = this.#turn(threads, threadId, turnId);
      if (finalText !== undefined) {
        const assistant = turn.messages.find((m) => m.role === 'assistant');
        if (assistant) {
          assistant.text = finalText;
          reconcileSegmentsWithText(assistant, finalText);
        }
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

  #setTurnStatus(threadId: string, turnId: string, status: TurnStatus, now: number): Promise<void> {
    return this.#mutate(async (threads) => {
      const turn = this.#turn(threads, threadId, turnId);
      turn.status = status;
      turn.completedAt = now;
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

  /**
   * Compute the conversation-derived profile metrics in one read of the store:
   * conversation/message counts, distinct agents/models, per-agent tallies,
   * member-since and per-day activity buckets. Read-only.
   */
  async conversationMetrics(): Promise<ConversationMetrics> {
    const threads = await this.#read();
    const agents = new Set<string>();
    const models = new Set<string>();
    const byAgent = new Map<string, number>();
    const activity = new Map<number, { conversations: number; messages: number }>();
    let messages = 0;
    let memberSince: number | undefined;

    const bucket = (day: number): { conversations: number; messages: number } => {
      let entry = activity.get(day);
      if (!entry) {
        entry = { conversations: 0, messages: 0 };
        activity.set(day, entry);
      }
      return entry;
    };

    for (const thread of threads) {
      if (thread.agentId !== undefined) {
        agents.add(thread.agentId);
        byAgent.set(thread.agentId, (byAgent.get(thread.agentId) ?? 0) + 1);
      }
      if (thread.model !== undefined) models.add(thread.model);
      if (memberSince === undefined || thread.createdAt < memberSince) {
        memberSince = thread.createdAt;
      }
      bucket(utcDayKey(thread.createdAt)).conversations += 1;
      for (const turn of thread.turns) {
        for (const message of turn.messages) {
          messages += 1;
          bucket(utcDayKey(message.createdAt)).messages += 1;
        }
      }
    }

    return {
      conversations: threads.length,
      agents: [...agents],
      models: [...models],
      messages,
      byAgent: [...byAgent].map(([agentId, conversations]) => ({ agentId, conversations })),
      ...(memberSince !== undefined ? { memberSince } : {}),
      activityByDay: [...activity].map(([day, counts]) => ({ day, ...counts })),
    };
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
 * Make the ordered `segments` agree with the turn's authoritative [finalText]
 * (the `turn/completed` text, which replaces the streamed deltas). When the
 * streamed text runs already concatenate to [finalText] — the normal case — the
 * interleave is left untouched. Otherwise the text runs are dropped and a single
 * trailing text run is appended after the blocks (the best we can do when the
 * final text diverges from, or arrived without, streamed deltas). A no-op when
 * no `segments` were ever built (a plain-text turn with no blocks).
 */
function reconcileSegmentsWithText(assistant: StoredMessage, finalText: string): void {
  const segments = assistant.segments;
  if (!segments || segments.length === 0) return;
  const streamed = segments.filter(isTextSegment).reduce((acc, s) => acc + s.text, '');
  if (streamed === finalText) return;
  const blocks = segments.filter((s) => !isTextSegment(s));
  assistant.segments =
    finalText.length > 0 ? [...blocks, { type: 'text', text: finalText }] : blocks;
}
