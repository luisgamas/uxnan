/**
 * Built-in reference agent: streams the user's prompt back as deltas. It needs
 * no external CLI, so it exercises the full turn pipeline end-to-end (store +
 * streaming notifications) and is useful for mobile-side development and tests.
 *
 * It also drives the **interactive-approval** seam end-to-end without a real
 * agent: a turn whose text is exactly `approval-demo` (case-insensitive) emits
 * an `approval` content block and PAUSES until the phone replies via
 * `turn/send { approvalResponse }`, then completes with a line reflecting the
 * decision. This lets the mobile approval UI be validated against a live bridge.
 */
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  ApprovalDecision,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';
import { approvalBlock } from './content-blocks.js';

/** Text (case-insensitive, trimmed) that triggers the demo approval flow. */
const APPROVAL_DEMO_TRIGGER = 'approval-demo';

interface PendingApproval {
  threadId: string;
  turnId: string;
  approvalId: string;
}

export class EchoAgentAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities: AgentCapabilities = {
    planMode: false,
    streaming: true,
    approvals: true,
    forking: false,
    images: false,
  };

  /** threadId → the approval this thread's in-flight turn is waiting on. */
  readonly #pending = new Map<string, PendingApproval>();

  start(_config: AgentConfig): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#pending.clear();
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    this.emit({ type: 'turn_started', threadId, turnId });

    if (text.trim().toLowerCase() === APPROVAL_DEMO_TRIGGER) {
      // Demo: ask for approval, then wait for the decision (see respondApproval).
      const approvalId = `appr-${turnId}`;
      this.#pending.set(threadId, { threadId, turnId, approvalId });
      this.emit({
        type: 'block',
        threadId,
        turnId,
        data: {
          content: approvalBlock(approvalId, 'Run `rm -rf ./build` to clean the workspace', {
            risk: 'high',
            detail: 'rm -rf ./build',
          }),
        },
      });
      return Promise.resolve();
    }

    for (const chunk of text.split(/(\s+)/).filter((part) => part.length > 0)) {
      this.emit({ type: 'delta', threadId, turnId, data: { text: chunk } });
    }
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
    return Promise.resolve();
  }

  respondApproval(threadId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.#pending.get(threadId);
    if (!pending || pending.approvalId !== approvalId) {
      // No matching pending approval — a no-op, as the contract allows.
      return Promise.resolve();
    }
    this.#pending.delete(threadId);
    const { turnId } = pending;
    const outcome =
      decision === 'approve'
        ? 'Approved — running the action.'
        : decision === 'approveSession'
          ? 'Approved for this session — running the action.'
          : 'Rejected — skipping the action.';
    this.emit({ type: 'delta', threadId, turnId, data: { text: outcome } });
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text: outcome } });
    return Promise.resolve();
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    this.#pending.delete(threadId);
    this.emit({ type: 'turn_aborted', threadId, turnId });
    return Promise.resolve();
  }
}
