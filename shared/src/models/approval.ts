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
  /**
   * The request's own id again (`approvalId`), as the `LiveBlock` id: a copy
   * of the same request delivered twice — the stored one a client just
   * reloaded and the live one that follows it — replaces the first in place
   * instead of showing as a second card.
   */
  blockId?: string;
  /**
   * How the request ended, once it has: the bridge writes it over the stored
   * block (by `blockId`) as it announces `stream/approval/resolved`, so a
   * client that missed the notification — offline, restarted, paired later —
   * reads the same outcome from `turn/list`. Absent while it is pending.
   */
  outcome?: ApprovalOutcome;
}

/**
 * How an approval ended. `withdrawn` means no person answered it: the agent
 * settled the request itself, or the run that asked ended (stopped, failed,
 * its CLI exited). `decision` is then what the bridge answered the adapter
 * with — never a person's choice, so a client shows the withdrawal instead.
 * A pending approval never ends on a clock: it waits until a person answers.
 */
export interface ApprovalOutcome {
  decision: ApprovalDecision;
  withdrawn?: boolean;
}
