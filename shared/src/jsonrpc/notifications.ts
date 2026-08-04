/**
 * Bridge → phone streaming notifications (JSON-RPC notifications, no `id`).
 *
 * Source: architecture/02b-contracts-and-requirements.md (streaming events).
 */
import type { QueuePausedReason, ThreadTitleSource } from '../models/thread.js';

export const StreamNotification = {
  TurnStarted: 'stream/turn/started',
  MessageDelta: 'stream/message/delta',
  /** A chunk of the agent's reasoning / "thinking" for this turn (`data.delta`). */
  ThinkingDelta: 'stream/thinking/delta',
  /** A structured content block (command/diff/tool) the agent produced this turn. */
  ContentBlock: 'stream/content/block',
  TurnCompleted: 'stream/turn/completed',
  TurnError: 'stream/turn/error',
  TurnAborted: 'stream/turn/aborted',
  /** A queued turn was removed before it ever ran (status → `cancelled`). */
  TurnCancelled: 'stream/turn/cancelled',
  /** The thread's message queue changed (queued, drained, cancelled, paused). */
  QueueUpdated: 'stream/queue/updated',
  /** The agent resolved an alias (e.g. `opus`) to a concrete model id for this turn. */
  ModelResolved: 'stream/model/resolved',
  /** A thread's title changed on the bridge (a generated title, or another device's rename). */
  ThreadRenamed: 'stream/thread/renamed',
} as const;

export type StreamNotification = (typeof StreamNotification)[keyof typeof StreamNotification];

export interface TurnStartedParams {
  threadId: string;
  turnId: string;
}

export interface MessageDeltaParams {
  threadId: string;
  turnId: string;
  messageId: string;
  delta: string;
}

/** A chunk of the agent's reasoning ("thinking") for a turn. */
export interface ThinkingDeltaParams {
  threadId: string;
  turnId: string;
  messageId: string;
  delta: string;
}

/**
 * A structured content block (a serialized MessageContent: `command_execution`,
 * `diff`, `tool`, …) the agent produced during a turn. The phone decodes
 * `content` straight into a MessageContent and folds it into the streaming
 * message (Work log / Changed files).
 */
export interface ContentBlockParams {
  threadId: string;
  turnId: string;
  messageId: string;
  content: unknown;
  /**
   * `true` when the block arrived from a **parallel/background** activity (e.g.
   * a Claude Code subagent's tool run) while the assistant's main text was
   * still streaming. The client must then insert the block BEFORE the
   * currently-open text run instead of appending it after — appending would
   * sever the run and render the sentence split mid-word by an activity card.
   * Absent/false for the sequential case (the block lands at a real text-run
   * boundary and is appended in arrival order). Mirrors how the bridge itself
   * orders the block inside the persisted `Message.segments`, so the live view
   * and a later `turn/list` re-sync render the identical interleave.
   */
  beforeText?: boolean;
}

/**
 * Token usage for a completed turn, as reported by the agent's CLI.
 * `tokens` is the context the conversation now occupies (≈ the latest turn's
 * input + the output it produced). `contextWindow` is the model's limit when
 * known (Claude tiers); omitted when the CLI doesn't expose it (Codex), in
 * which case the phone shows the raw token count instead of a percentage.
 */
export interface TurnUsage {
  tokens: number;
  contextWindow?: number;
}

export interface TurnCompletedParams {
  threadId: string;
  turnId: string;
  messageId: string;
  text: string;
  /** Token usage for this turn, when the agent reported it. */
  usage?: TurnUsage;
}

export interface TurnErrorParams {
  threadId: string;
  turnId: string;
  error: { code: number; message: string };
}

export interface TurnAbortedParams {
  threadId: string;
  turnId: string;
}

/**
 * A queued turn was removed before it ever started (its status is now
 * `cancelled`). The turn is NOT deleted — the user's message stays in the
 * thread, marked as cancelled, so the history shows what was asked and dropped.
 */
export interface TurnCancelledParams {
  threadId: string;
  turnId: string;
}

/**
 * The thread's message queue changed. Carries the WHOLE state rather than a
 * delta, so it is idempotent: a client that missed one (backgrounded, mid-
 * reconnect) converges on the next one it receives instead of drifting.
 *
 * A client that sees an id it does not know about yet (another device queued
 * it) resyncs the thread the same way it does for any unknown turn.
 */
export interface QueueUpdatedParams {
  threadId: string;
  /** Queued turn ids in drain order; empty when the queue just emptied. */
  queuedTurnIds: string[];
  /** True while draining is held after a stop/failure (see `TurnList.queuePaused`). */
  paused: boolean;
  /** Why it is held; absent when it is not paused. */
  pausedReason?: QueuePausedReason;
}

export interface ModelResolvedParams {
  threadId: string;
  turnId: string;
  /** Concrete model id the agent resolved for this turn (e.g. `claude-opus-4-8`). */
  model: string;
}

/**
 * A thread's title changed **on the bridge**, so every client converges without
 * refetching the list. Emitted when a generated title replaces the provisional
 * one taken from the opening message, and when another device renames a thread.
 *
 * `titleSource` says how much to trust it: `user` is final, `agent` is the
 * generated name, `prompt` the weak fallback. A client MUST NOT let an `agent`
 * title overwrite a `user` one — the bridge already enforces that, and this
 * field is what lets a client reason about it too.
 */
export interface ThreadRenamedParams {
  threadId: string;
  title: string;
  titleSource: ThreadTitleSource;
}
