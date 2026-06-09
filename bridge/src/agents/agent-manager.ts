/**
 * Orchestrates agent turns: routes `turn/send` to the right adapter, persists the
 * streamed output to the {@link ThreadStore}, and pushes streaming notifications
 * to connected phones.
 *
 * Source: architecture/02a-system-architecture.md §5.2 / §5.8.
 *
 * FOR-DEV: the agent is currently chosen by a single `defaultAgent`; resolve it
 * per project/thread from the project's AgentConfig once project management lands
 * (src/agents/agent-manager.ts).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  StreamNotification,
  makeNotification,
  type AgentDescriptor,
  type AgentId,
  type AgentModel,
  type AgentStreamEvent,
  type IAgentAdapter,
} from '@uxnan/shared';
import type { ThreadStore } from '../conversation/thread-store.js';
import type { Logger } from '../logger.js';

/** Display metadata + availability for a registered adapter, surfaced by `agent/list`. */
export interface AgentMeta {
  displayName: string;
  available: boolean;
  defaultModel?: string;
}

export interface TurnEndInfo {
  threadId: string;
  turnId: string;
  status: 'completed' | 'error';
  text?: string;
}

export interface AgentManagerOptions {
  store: ThreadStore;
  /** Broadcast a JSON-RPC notification to connected phones. */
  notify: (message: unknown) => void;
  now: () => number;
  logger: Logger;
  defaultAgent: AgentId;
  /** Optional hook fired when a turn completes or errors (e.g. push notifications). */
  onTurnEnd?: (info: TurnEndInfo) => void;
}

export interface SendTurnOptions {
  agentId?: AgentId;
  service?: string;
  effort?: string;
  cwd?: string;
}

export class AgentManager {
  readonly #adapters = new Map<AgentId, IAgentAdapter>();
  readonly #meta = new Map<AgentId, AgentMeta>();
  readonly #started = new Set<AgentId>();
  readonly #assistantByTurn = new Map<string, string>();
  readonly #options: AgentManagerOptions;

  constructor(options: AgentManagerOptions) {
    this.#options = options;
  }

  register(adapter: IAgentAdapter, meta?: Partial<AgentMeta>): void {
    this.#adapters.set(adapter.agentId, adapter);
    this.#meta.set(adapter.agentId, {
      displayName: meta?.displayName ?? adapter.agentId,
      available: meta?.available ?? true,
      ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
    });
    adapter.onEvent((event) => {
      void this.#onEvent(event);
    });
  }

  hasAdapter(agentId: AgentId): boolean {
    return this.#adapters.has(agentId);
  }

  /** Registered agents the phone can pick, with capabilities + availability. */
  listAgents(): AgentDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => {
      const meta = this.#meta.get(adapter.agentId);
      return {
        agentId: adapter.agentId,
        displayName: meta?.displayName ?? adapter.agentId,
        available: meta?.available ?? true,
        capabilities: adapter.capabilities,
        ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
      };
    });
  }

  /** The bridge's configured default agent. */
  get defaultAgent(): AgentId {
    return this.#options.defaultAgent;
  }

  /** Models the given agent's CLI reports (empty if it can't enumerate them). */
  async getModels(agentId: AgentId): Promise<AgentModel[]> {
    const adapter = this.#adapters.get(agentId);
    if (!adapter?.listModels) return [];
    try {
      return await adapter.listModels();
    } catch {
      return [];
    }
  }

  /** Start a turn: persist the user message, drive the adapter, return the turn id. */
  async sendTurn(
    threadId: string,
    userText: string,
    options: SendTurnOptions = {},
  ): Promise<{ turnId: string }> {
    const agentId = options.agentId ?? this.#options.defaultAgent;
    const adapter = this.#adapters.get(agentId);
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no adapter registered for agent '${agentId}'`,
      );
    }

    const started = await this.#options.store.startTurn(threadId, userText, this.#options.now());
    this.#assistantByTurn.set(started.turnId, started.assistantMessageId);

    if (!this.#started.has(agentId)) {
      await adapter.start({ agentId, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
      this.#started.add(agentId);
    }

    await adapter.sendTurn({
      threadId,
      turnId: started.turnId,
      text: userText,
      ...(options.service !== undefined ? { service: options.service } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    });
    return { turnId: started.turnId };
  }

  async cancelTurn(threadId: string, turnId: string, agentId?: AgentId): Promise<void> {
    const adapter = this.#adapters.get(agentId ?? this.#options.defaultAgent);
    if (adapter) {
      await adapter.cancelTurn(threadId, turnId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [agentId, adapter] of this.#adapters) {
      if (this.#started.has(agentId)) {
        await adapter.stop().catch(() => undefined);
      }
    }
    this.#started.clear();
  }

  async #onEvent(event: AgentStreamEvent): Promise<void> {
    const { threadId, turnId } = event;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const now = this.#options.now();
    try {
      switch (event.type) {
        case 'turn_started':
          this.#options.notify(
            makeNotification(StreamNotification.TurnStarted, { threadId, turnId }),
          );
          break;
        case 'model_resolved': {
          const model = readText(event.data);
          if (model) {
            this.#options.notify(
              makeNotification(StreamNotification.ModelResolved, { threadId, turnId, model }),
            );
          }
          break;
        }
        case 'delta': {
          const delta = readText(event.data);
          await this.#options.store.appendDelta(threadId, turnId, delta, now);
          this.#options.notify(
            makeNotification(StreamNotification.MessageDelta, {
              threadId,
              turnId,
              messageId,
              delta,
            }),
          );
          break;
        }
        case 'turn_completed': {
          const provided = readOptionalText(event.data);
          await this.#options.store.completeTurn(threadId, turnId, provided, now);
          const text = await this.#assistantText(turnId, provided);
          const usage = readUsage(event.data);
          this.#options.notify(
            makeNotification(StreamNotification.TurnCompleted, {
              threadId,
              turnId,
              messageId,
              text,
              ...(usage !== undefined ? { usage } : {}),
            }),
          );
          this.#assistantByTurn.delete(turnId);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'completed', text });
          break;
        }
        case 'turn_error': {
          const message = readOptionalText(event.data) ?? 'agent error';
          await this.#options.store.failTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnError, {
              threadId,
              turnId,
              error: { code: JsonRpcErrorCode.BridgeError, message },
            }),
          );
          this.#assistantByTurn.delete(turnId);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'error', text: message });
          break;
        }
        case 'turn_aborted':
          await this.#options.store.abortTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnAborted, { threadId, turnId }),
          );
          this.#assistantByTurn.delete(turnId);
          break;
      }
    } catch (err) {
      this.#options.logger.warn(
        `agent event handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async #assistantText(turnId: string, provided: string | undefined): Promise<string> {
    if (provided !== undefined) return provided;
    try {
      const turn = await this.#options.store.getTurn(turnId);
      const assistant = turn.messages.find((m) => m.role === 'assistant');
      return typeof assistant?.content === 'string' ? assistant.content : '';
    } catch {
      return '';
    }
  }
}

function readText(data: unknown): string {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function readOptionalText(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

/** Extract `{ tokens, contextWindow? }` from a turn_completed event's data. */
function readUsage(data: unknown): { tokens: number; contextWindow?: number } | undefined {
  if (!data || typeof data !== 'object' || !('usage' in data)) return undefined;
  const usage = (data as { usage: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const tokens = (usage as { tokens?: unknown }).tokens;
  if (typeof tokens !== 'number') return undefined;
  const window = (usage as { contextWindow?: unknown }).contextWindow;
  return {
    tokens,
    ...(typeof window === 'number' ? { contextWindow: window } : {}),
  };
}
