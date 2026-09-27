/**
 * Base class for agent CLI adapters: event fan-out, the conversation → native
 * session map, plus the {@link IAgentAdapter} surface. Concrete adapters
 * implement the lifecycle and turn methods.
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

  /** threadId → the native session the conversation continues in. The one
   *  home of that mapping: every adapter reads and writes it through the
   *  methods below. */
  readonly #sessionByThread = new Map<string, string>();

  /** threadId → a stored id the CLI could not resume. Kept so the id the
   *  bridge still has on disk is not adopted again on the next turn (it is
   *  replaced once the fresh session's first turn is persisted). */
  readonly #refusedByThread = new Map<string, string>();

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

  nativeSessionId(threadId: string): string | undefined {
    return this.#sessionByThread.get(threadId);
  }

  adoptNativeSession(threadId: string, sessionId: string): void {
    if (!sessionId || this.#sessionByThread.has(threadId)) return;
    if (this.#refusedByThread.get(threadId) === sessionId) return;
    this.#sessionByThread.set(threadId, sessionId);
  }

  /** Record the session the CLI is running the conversation in (announced by
   *  the CLI, or opened by the adapter). */
  protected setNativeSession(threadId: string, sessionId: string): void {
    this.#sessionByThread.set(threadId, sessionId);
    this.#refusedByThread.delete(threadId);
  }

  /** The CLI could not resume the conversation's session (it was deleted, or
   *  a server no longer knows it): forget it, and never adopt it again for
   *  this thread. The next run opens a fresh session. */
  protected refuseNativeSession(threadId: string): void {
    const sessionId = this.#sessionByThread.get(threadId);
    this.#sessionByThread.delete(threadId);
    if (sessionId) this.#refusedByThread.set(threadId, sessionId);
  }

  abstract start(config: AgentConfig): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendTurn(options: SendTurnOptions): Promise<void>;
  abstract cancelTurn(threadId: string, turnId: string): Promise<void>;
}
