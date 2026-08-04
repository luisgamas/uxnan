/** Why an agent compacted its conversation context, when it reports one. */
export type CompactionReason = 'manual' | 'threshold' | 'overflow' | 'automatic' | 'unknown';

/**
 * A durable timeline marker emitted when the agent really compacted context.
 * It travels as a `stream/content/block` and is persisted with the assistant
 * message, so live rendering and `turn/list` reconciliation stay identical.
 */
export interface CompactionContentBlock {
  type: 'compaction';
  reason?: CompactionReason;
  /** Context tokens immediately before compaction, when reported. */
  tokensBefore?: number;
  /** Estimated context tokens immediately after compaction, when reported. */
  tokensAfter?: number;
}
