/**
 * Contract every agent CLI adapter must implement.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters/base-adapter).
 */
import type { AgentCapabilities, AgentId, AgentModel } from './agent-capabilities.js';
import type { AgentConfig } from './agent-config.js';

/** A single streamed event produced by a running agent turn. */
export interface AgentStreamEvent {
  type:
    | 'delta'
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
  /** Reasoning effort / variant (e.g. `high`, `max`, `minimal`). */
  effort?: string;
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

  /** Subscribe to streaming events. Returns an unsubscribe function. */
  onEvent(listener: (event: AgentStreamEvent) => void): () => void;

  /** List the models this agent's CLI reports as available (optional). */
  listModels?(): Promise<AgentModel[]>;
}
