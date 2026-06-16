/**
 * Interactive approval contracts.
 *
 * An agent that needs the user to authorize an action emits an `approval`
 * content block (on `stream/content/block`); the phone renders an interactive
 * card and replies via `turn/send { approvalResponse }`. The bridge routes the
 * decision back to the agent adapter.
 *
 * Source: architecture/02a-system-architecture.md §6.2.
 */

/** Risk level the agent assigns to an action awaiting approval. */
export type ApprovalRisk = 'low' | 'medium' | 'high' | 'unknown';

/** The user's decision for a pending approval. */
export type ApprovalDecision = 'approve' | 'reject' | 'approveSession';

/** The user's reply to a pending approval, carried on `turn/send`. */
export interface ApprovalResponse {
  /** The id from the approval request the user is answering. */
  approvalId: string;
  /** Allow once, deny, or allow for the rest of the session. */
  decision: ApprovalDecision;
}

/**
 * Payload of an `approval` content block. The phone decodes this straight into
 * its interactive approval card (it is also tolerant of a nested
 * `{ type:'approval', request:{...} }` form).
 */
export interface ApprovalRequestBlock {
  type: 'approval';
  /** Bridge id the phone echoes back in `approvalResponse.approvalId`. */
  approvalId: string;
  /** Human description of what the agent wants to do. */
  action: string;
  /** Risk level (defaults to `unknown` on the phone if omitted). */
  risk?: ApprovalRisk;
  /** Optional extra detail (e.g. the command or affected paths). */
  detail?: string;
}
