/**
 * Contract every agent CLI adapter must implement.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters/base-adapter).
 */
import type { AgentCapabilities, AgentId, AgentModel } from './agent-capabilities.js';
import type { AgentConfig } from './agent-config.js';
import type { TurnAttachment } from '../models/workspace.js';
import type { ApprovalDecision } from '../models/approval.js';

/** A single streamed event produced by a running agent turn. */
export interface AgentStreamEvent {
  type:
    | 'delta'
    /** A chunk of the agent's reasoning / "thinking" (`data.text`). */
    | 'thinking'
    /** A structured content block — command/diff/tool (`data.content`). */
    | 'block'
    | 'turn_started'
    | 'turn_completed'
    | 'turn_error'
    | 'turn_aborted'
    /** The agent reported the concrete model it resolved an alias to (`data.text`). */
    | 'model_resolved';
  threadId: string;
  turnId: string;
  /** Free-form payload depending on `type`. */
  data?: unknown;
}

export interface SendTurnOptions {
  threadId: string;
  turnId: string;
  text: string;
  /** Model/service identifier (e.g. `provider/model`) for adapters that accept one. */
  service?: string;
  /** Legacy flat reasoning effort / variant (e.g. `high`, `max`, `minimal`). */
  effort?: string;
  /**
   * Chosen per-model run-option values keyed by `AgentModelOption.key` (e.g.
   * `{ reasoning: 'high' }`). Adapters translate these into CLI flags; the
   * legacy `effort` is used as a fallback for the `reasoning` knob.
   */
  options?: Record<string, string | boolean>;
  /**
   * Inline image attachments for this turn. The {@link AgentManager}
   * materializes these to temp files and appends a reference to {@link text}
   * before the adapter runs, so adapters need no per-CLI image handling.
   */
  attachments?: TurnAttachment[];
  /** Working directory the agent should run in for this turn. */
  cwd?: string;
}

export interface IAgentAdapter {
  readonly agentId: AgentId;
  readonly capabilities: AgentCapabilities;

  /** Start (or attach to) the agent runtime for the given config. */
  start(config: AgentConfig): Promise<void>;

  /** Stop the agent runtime and release resources. */
  stop(): Promise<void>;

  /** Send a user turn; streamed events are delivered via {@link onEvent}. */
  sendTurn(options: SendTurnOptions): Promise<void>;

  /** Cancel an in-flight turn. */
  cancelTurn(threadId: string, turnId: string): Promise<void>;

  /**
   * Reply to a pending approval the agent emitted (as an `approval` content
   * block) for {@link threadId}. Optional: adapters that never request approval
   * (or that run non-interactively) don't implement it. Implementations should
   * be a no-op when there is no pending approval for `approvalId`.
   */
  respondApproval?(threadId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;

  /** Subscribe to streaming events. Returns an unsubscribe function. */
  onEvent(listener: (event: AgentStreamEvent) => void): () => void;

  /** List the models this agent's CLI reports as available (optional). */
  listModels?(): Promise<AgentModel[]>;
}
