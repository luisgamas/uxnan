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
  type ApprovalDecision,
  type IAgentAdapter,
  type TurnAttachment,
} from '@uxnan/shared';
import { rm } from 'node:fs/promises';
import type { ThreadStore } from '../conversation/thread-store.js';
import type { Logger } from '../logger.js';
import { materializeAttachments } from './attachments.js';

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
  /** Chosen per-model run-option values keyed by `AgentModelOption.key`. */
  options?: Record<string, string | boolean>;
  /** Inline image attachments delivered to the agent for this turn. */
  attachments?: TurnAttachment[];
  cwd?: string;
}

export class AgentManager {
  readonly #adapters = new Map<AgentId, IAgentAdapter>();
  readonly #meta = new Map<AgentId, AgentMeta>();
  readonly #started = new Set<AgentId>();
  readonly #assistantByTurn = new Map<string, string>();
  /** threadId → agent driving it, so we can read its native session id on completion. */
  readonly #agentByThread = new Map<string, AgentId>();
  /** threadId → in-flight turn id, so an approval reply can name the turn it answers. */
  readonly #activeTurnByThread = new Map<string, string>();
  /** turnId → temp attachment dir to remove once the turn ends (best-effort). */
  readonly #attachmentDirByTurn = new Map<string, string>();
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

  /** Whether the agent's binary resolved (its CLI is installed/usable). */
  isAvailable(agentId: AgentId): boolean {
    return this.#meta.get(agentId)?.available ?? false;
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

    const attachments = options.attachments ?? [];
    // Persist a faithful user message (no temp paths): the original text, or a
    // short placeholder for an image-only turn so history isn't a blank bubble.
    const persistText =
      userText.length > 0
        ? userText
        : attachments.length > 0
          ? `[${attachments.length} image attachment${attachments.length > 1 ? 's' : ''}]`
          : userText;
    const started = await this.#options.store.startTurn(threadId, persistText, this.#options.now());
    this.#assistantByTurn.set(started.turnId, started.assistantMessageId);
    this.#agentByThread.set(threadId, agentId);
    this.#activeTurnByThread.set(threadId, started.turnId);

    if (!this.#started.has(agentId)) {
      await adapter.start({ agentId, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
      this.#started.add(agentId);
    }

    // Materialize image attachments to temp files and reference them in the
    // prompt so any file/vision-capable agent CLI can open them. Best-effort:
    // a failure to write degrades to a text-only turn, never aborts it.
    let agentText = userText;
    if (attachments.length > 0) {
      try {
        const materialized = await materializeAttachments(attachments, started.turnId, {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
        if (materialized.note) {
          agentText =
            userText.length > 0 ? `${userText}\n\n${materialized.note}` : materialized.note;
        }
        if (materialized.dir) this.#attachmentDirByTurn.set(started.turnId, materialized.dir);
      } catch (err) {
        this.#options.logger.warn(`attachment materialization failed: ${String(err)}`);
      }
    }

    await adapter.sendTurn({
      threadId,
      turnId: started.turnId,
      text: agentText,
      ...(options.service !== undefined ? { service: options.service } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(options.options !== undefined ? { options: options.options } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    });
    return { turnId: started.turnId };
  }

  /**
   * Route a user's approval decision to the agent driving `threadId`. No new
   * turn is created — the decision unblocks the in-flight turn that emitted the
   * approval. Returns the in-flight turn id (or `''` if none is tracked) so the
   * `turn/send` reply still carries a `turnId`.
   */
  async respondApproval(
    threadId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<{ turnId: string }> {
    const agentId = this.#agentByThread.get(threadId);
    const adapter = agentId ? this.#adapters.get(agentId) : undefined;
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no active agent for thread '${threadId}'`,
      );
    }
    if (!adapter.respondApproval) {
      throw new RpcError(
        JsonRpcErrorCode.InvalidParams,
        `agent '${agentId}' does not support approvals`,
      );
    }
    await adapter.respondApproval(threadId, approvalId, decision);
    return { turnId: this.#activeTurnByThread.get(threadId) ?? '' };
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
        case 'thinking': {
          const delta = readText(event.data);
          await this.#options.store.appendThinking(threadId, turnId, delta, now);
          this.#options.notify(
            makeNotification(StreamNotification.ThinkingDelta, {
              threadId,
              turnId,
              messageId,
              delta,
            }),
          );
          break;
        }
        case 'block': {
          const content = readContent(event.data);
          if (content !== undefined) {
            await this.#options.store.appendBlock(threadId, turnId, content, now);
            this.#options.notify(
              makeNotification(StreamNotification.ContentBlock, {
                threadId,
                turnId,
                messageId,
                content,
              }),
            );
          }
          break;
        }
        case 'turn_completed': {
          const provided = readOptionalText(event.data);
          await this.#options.store.completeTurn(threadId, turnId, provided, now);
          const text = await this.#assistantText(turnId, provided);
          const usage = readUsage(event.data);
          if (usage) await this.#options.store.setUsage(threadId, turnId, usage, now);
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
          this.#activeTurnByThread.delete(threadId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
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
          this.#activeTurnByThread.delete(threadId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'error', text: message });
          break;
        }
        case 'turn_aborted':
          await this.#options.store.abortTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnAborted, { threadId, turnId }),
          );
          this.#assistantByTurn.delete(turnId);
          this.#activeTurnByThread.delete(threadId);
          void this.#cleanupAttachments(turnId);
          break;
      }
    } catch (err) {
      this.#options.logger.warn(
        `agent event handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Remove a turn's temp attachment directory once the turn ends. Best-effort:
   * the agent has already read the files by completion, and a failure to delete
   * (e.g. the dir vanished) is non-fatal.
   */
  async #cleanupAttachments(turnId: string): Promise<void> {
    const dir = this.#attachmentDirByTurn.get(turnId);
    if (!dir) return;
    this.#attachmentDirByTurn.delete(turnId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Persist the agent's native session id for a thread so the on-disk history
   * fallback can locate its session log after a restart. Best-effort + idempotent.
   */
  async #persistAgentSession(threadId: string, now: number): Promise<void> {
    const agentId = this.#agentByThread.get(threadId);
    if (!agentId) return;
    // `nativeSessionId` is an optional adapter capability (not in the shared
    // interface), so read it through a structural type rather than a hard dep.
    const adapter = this.#adapters.get(agentId) as
      | { nativeSessionId?(threadId: string): string | undefined }
      | undefined;
    const sessionId = adapter?.nativeSessionId?.(threadId);
    if (!sessionId) return;
    try {
      await this.#options.store.setAgentSession(threadId, sessionId, now);
    } catch (err) {
      this.#options.logger.warn(
        `persist agent session failed: ${err instanceof Error ? err.message : String(err)}`,
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

/** Extract a structured `content` block (MessageContent JSON) from a block event. */
function readContent(data: unknown): unknown {
  if (data && typeof data === 'object' && 'content' in data) {
    return (data as { content: unknown }).content;
  }
  return undefined;
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
