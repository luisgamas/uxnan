/**
 * Base class for agent CLI adapters: event fan-out plus the {@link IAgentAdapter}
 * surface. Concrete adapters implement the lifecycle and turn methods.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters/base-adapter).
 */
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentStreamEvent,
  IAgentAdapter,
  SendTurnOptions,
} from '@uxnan/shared';

export abstract class BaseAgentAdapter implements IAgentAdapter {
  abstract readonly agentId: AgentId;
  abstract readonly capabilities: AgentCapabilities;

  readonly #listeners = new Set<(event: AgentStreamEvent) => void>();

  onEvent(listener: (event: AgentStreamEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  protected emit(event: AgentStreamEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  abstract start(config: AgentConfig): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendTurn(options: SendTurnOptions): Promise<void>;
  abstract cancelTurn(threadId: string, turnId: string): Promise<void>;
}
