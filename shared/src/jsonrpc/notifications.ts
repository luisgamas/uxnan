/**
 * Bridge → phone streaming notifications (JSON-RPC notifications, no `id`).
 *
 * Source: architecture/02b-contracts-and-requirements.md (streaming events).
 */

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

export interface ModelResolvedParams {
  threadId: string;
  turnId: string;
  /** Concrete model id the agent resolved for this turn (e.g. `claude-opus-4-8`). */
  model: string;
}
