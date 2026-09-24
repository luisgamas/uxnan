// The bridge's conversations, as the desktop's chat tabs see them.
//
// "One owner, two views" (plan 030): the bridge owns every thread — its agent
// process, queue, approvals and history — and this window is a client of it
// exactly like the phone. Whatever either client does reaches the other
// through the bridge's broadcast (architecture/02a §5.8.16), so this store
// keeps no private truth: the thread list is the bridge's `thread/list` kept
// current by `stream/thread/updated|deleted`, and each open conversation is a
// `Conversation` fed by the timeline notifications.
//
// Agent fixed, model free: a thread's agent is chosen at `thread/start` and
// never changes (another CLI cannot continue a native session); its model can
// (`thread/setModel`), and every client sees it.

import { SvelteMap } from 'svelte/reactivity';
import type { AccessMode, Thread, ThreadList } from '$shared/models/thread';
import type { ApprovalDecision } from '$shared/models/approval';
import type { AgentDescriptor, AgentModel } from '$shared/agents/agent-capabilities';
import type { Project } from '$shared/models/project';
import type { ThreadDeletedParams, ThreadUpdatedParams } from '$shared/jsonrpc/notifications';
import { bridge, type BridgeClientStore, type BridgeNotification } from './client.svelte';
import { Conversation, isTimelineMethod, threadIdOf } from './conversation.svelte';
import { isUserFacingAgent } from './agents';

/** Longest provisional title (the bridge's `TITLE_MAX_LENGTH`). */
const TITLE_MAX_LENGTH = 72;

/** The provisional title of a new thread: its opening message, collapsed and
 *  clipped — the same rule the phone applies (`thread/rename` with
 *  `source: 'prompt'`, so the agent's generated name can still replace it). */
export function provisionalTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/** One spelling for comparing directories: forward slashes, no trailing slash. */
export function normalizeCwd(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** What a chat tab sends with a message. */
export interface SendOptions {
  /** Per-model run options (`AgentModel.options` knobs), e.g. reasoning effort. */
  options?: Record<string, string | boolean>;
}

export class ChatStore {
  readonly #client: BridgeClientStore;
  /** Every thread the bridge knows, by id. */
  threads = new SvelteMap<string, Thread>();
  threadsLoaded = $state(false);
  agents = $state<AgentDescriptor[]>([]);
  #models = new SvelteMap<string, AgentModel[]>();
  #conversations = new Map<string, Conversation>();
  #started = false;

  constructor(client: BridgeClientStore) {
    this.#client = client;
  }

  /** Subscribe to the bridge (once). Safe to call before it is connected. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#client.onNotification((n) => this.apply(n));
    this.#client.onConnected(() => void this.resync());
    if (this.#client.connected) void this.resync();
  }

  /** After (re)connecting: reload the list, the agents, and every open thread. */
  async resync(): Promise<void> {
    await Promise.allSettled([
      this.loadThreads(),
      this.loadAgents(),
      ...[...this.#conversations.values()].map((c) => c.load()),
    ]);
  }

  async loadThreads(): Promise<void> {
    try {
      const list = await this.#client.call<ThreadList>('thread/list', {});
      const next = new Map<string, Thread>();
      for (const thread of list?.threads ?? []) {
        if (thread && typeof thread.id === 'string') next.set(thread.id, thread);
      }
      for (const id of [...this.threads.keys()]) if (!next.has(id)) this.threads.delete(id);
      for (const [id, thread] of next) this.threads.set(id, thread);
      this.threadsLoaded = true;
    } catch {
      /* not connected; the next connect resyncs */
    }
  }

  async loadAgents(): Promise<void> {
    try {
      const result = await this.#client.call<{ agents: AgentDescriptor[] }>('agent/list');
      this.agents = (result?.agents ?? []).filter(
        (a) => !a.deprecated && isUserFacingAgent(a.agentId),
      );
    } catch {
      /* not connected */
    }
  }

  /** The models an agent's CLI reports (cached per agent). */
  async modelsFor(agentId: string): Promise<AgentModel[]> {
    const cached = this.#models.get(agentId);
    if (cached) return cached;
    try {
      const result = await this.#client.call<{ models: AgentModel[] }>('agent/models', {
        agentId,
      });
      const models = result?.models ?? [];
      this.#models.set(agentId, models);
      return models;
    } catch {
      return [];
    }
  }

  /** Models already loaded for an agent (reactive; empty until `modelsFor`). */
  cachedModels(agentId: string | undefined): AgentModel[] {
    return agentId ? (this.#models.get(agentId) ?? []) : [];
  }

  agent(agentId: string | undefined): AgentDescriptor | undefined {
    return agentId ? this.agents.find((a) => a.agentId === agentId) : undefined;
  }

  /** Threads that run in `cwd`, newest activity first, archived ones last. */
  threadsFor(cwd: string): Thread[] {
    const target = normalizeCwd(cwd);
    return [...this.threads.values()]
      .filter((t) => t.cwd !== undefined && normalizeCwd(t.cwd) === target)
      .sort((a, b) => {
        const archived = Number(a.status === 'archived') - Number(b.status === 'archived');
        return archived !== 0 ? archived : b.updatedAt - a.updatedAt;
      });
  }

  /** The live view of one thread, created (and loaded) on first use. */
  conversation(threadId: string): Conversation {
    let conversation = this.#conversations.get(threadId);
    if (!conversation) {
      conversation = new Conversation(threadId, (method, params) =>
        this.#client.call(method, params),
      );
      this.#conversations.set(threadId, conversation);
      if (this.#client.connected) void conversation.load();
    }
    return conversation;
  }

  /** Stop tracking a thread no tab shows anymore. */
  release(threadId: string): void {
    this.#conversations.delete(threadId);
  }

  /** Route one bridge notification. */
  apply(notification: BridgeNotification): void {
    switch (notification.method) {
      case 'stream/thread/updated': {
        const thread = (notification.params as ThreadUpdatedParams | undefined)?.thread;
        if (thread && typeof thread.id === 'string') this.threads.set(thread.id, thread);
        return;
      }
      case 'stream/thread/deleted': {
        const threadId = (notification.params as ThreadDeletedParams | undefined)?.threadId;
        if (typeof threadId === 'string') this.threads.delete(threadId);
        return;
      }
    }
    if (!isTimelineMethod(notification.method)) return;
    const threadId = threadIdOf(notification);
    if (!threadId) return;
    this.#conversations.get(threadId)?.apply(notification);
    // A turn starting or ending is activity: keep the list's order honest
    // without a refetch.
    if (notification.method === 'stream/turn/created') {
      const thread = this.threads.get(threadId);
      if (thread) this.threads.set(threadId, { ...thread, updatedAt: Date.now() });
    }
  }

  /** Start a thread in `cwd` with `agentId` (fixed from now on) and `model`. */
  async startThread(input: { cwd: string; agentId: string; model?: string }): Promise<Thread> {
    const project = await this.#client.call<Project>('project/resolve', { cwd: input.cwd });
    const thread = await this.#client.call<Thread>('thread/start', {
      projectId: project.id,
      agentId: input.agentId,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
    });
    this.threads.set(thread.id, thread);
    // Same starting posture as a thread started on the phone, so a
    // conversation behaves alike whichever client opened it.
    void this.setAccessMode(thread.id, 'fullAccess').catch(() => undefined);
    return thread;
  }

  /** Send a user message. The bubble shows at once; the bridge's
   *  `stream/turn/created` echo (matched by `clientTurnId`) replaces it. */
  async send(threadId: string, text: string, opts: SendOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const conversation = this.conversation(threadId);
    const clientTurnId = crypto.randomUUID();
    const firstMessage = conversation.loaded && conversation.turns.length === 0;
    conversation.addPending({ clientTurnId, text: trimmed });
    try {
      await this.#client.call('turn/send', {
        threadId,
        text: trimmed,
        clientTurnId,
        ...(opts.options && Object.keys(opts.options).length > 0 ? { options: opts.options } : {}),
      });
      if (firstMessage) void this.#nameFromPrompt(threadId, trimmed);
    } catch (err) {
      conversation.failPending(clientTurnId, err instanceof Error ? err.message : String(err));
    }
  }

  /** A new thread is titled by its opening message until the agent names it. */
  async #nameFromPrompt(threadId: string, text: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread?.titleSource && thread.titleSource !== 'prompt') return;
    try {
      await this.#client.call('thread/rename', {
        threadId,
        title: provisionalTitle(text),
        source: 'prompt',
      });
    } catch {
      /* cosmetic */
    }
  }

  /** Stop the running turn, or take a queued one off the queue. */
  async cancel(threadId: string, turnId: string): Promise<void> {
    await this.#client.call('turn/cancel', { threadId, turnId });
  }

  async answerApproval(threadId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    this.conversation(threadId).settleApprovalLocally(approvalId, decision);
    await this.#client.call('turn/send', {
      threadId,
      approvalResponse: { approvalId, decision },
    });
  }

  async answerQuestion(threadId: string, questionId: string, answers: string[][]): Promise<void> {
    this.conversation(threadId).settleQuestionLocally(questionId, answers);
    await this.#client.call('turn/send', {
      threadId,
      questionResponse: { questionId, answers },
    });
  }

  async setModel(threadId: string, model: string): Promise<void> {
    await this.#client.call('thread/setModel', { threadId, model });
  }

  async setAccessMode(threadId: string, mode: AccessMode): Promise<void> {
    await this.#client.call('thread/setAccessMode', { threadId, mode });
  }

  async rename(threadId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    await this.#client.call('thread/rename', { threadId, title: trimmed });
  }

  async archive(threadId: string): Promise<void> {
    await this.#client.call('thread/archive', { threadId });
  }

  async resumeQueue(threadId: string): Promise<void> {
    await this.#client.call('queue/resume', { threadId });
  }

  async clearQueue(threadId: string): Promise<void> {
    await this.#client.call('queue/clear', { threadId });
  }
}

export const chat = new ChatStore(bridge);
