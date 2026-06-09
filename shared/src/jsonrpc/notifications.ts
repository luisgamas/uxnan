/**
 * Bridge → phone streaming notifications (JSON-RPC notifications, no `id`).
 *
 * Source: architecture/02b-contracts-and-requirements.md (streaming events).
 */

export const StreamNotification = {
  TurnStarted: 'stream/turn/started',
  MessageDelta: 'stream/message/delta',
  TurnCompleted: 'stream/turn/completed',
  TurnError: 'stream/turn/error',
  TurnAborted: 'stream/turn/aborted',
  /** The agent resolved an alias (e.g. `opus`) to a concrete model id for this turn. */
  ModelResolved: 'stream/model/resolved',
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

export interface TurnCompletedParams {
  threadId: string;
  turnId: string;
  messageId: string;
  text: string;
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

export interface ModelResolvedParams {
  threadId: string;
  turnId: string;
  /** Concrete model id the agent resolved for this turn (e.g. `claude-opus-4-8`). */
  model: string;
}
