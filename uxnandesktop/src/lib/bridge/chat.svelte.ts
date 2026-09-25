// The bridge's conversations, as the desktop's chat tabs see them.
//
// "One owner, two views": the bridge owns every thread — its agent process,
// queue, approvals and history — and this window is a client of it exactly
// like the phone. This store is a REPLICA of what the bridge shares
// (architecture/02a §5.8.17): threads, projects, the shared settings and who
// is connected. It converges through `sync/changes` — on every (re)connect,
// and whenever a notification's revision is not the one after the last
// applied — never by trusting that every notification arrived. Each open
// conversation is a `Conversation` fed by the timeline notifications and
// ordered by `Turn.seq`.
//
// Agent fixed, model free: a thread's agent is chosen at `thread/start` and
// never changes (another CLI cannot continue a native session); its model can
// (`thread/setModel`), and every client sees it.

import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { AccessMode, Thread } from '$shared/models/thread';
import type { ApprovalDecision } from '$shared/models/approval';
import type { AgentDescriptor, AgentModel } from '$shared/agents/agent-capabilities';
import type { Project } from '$shared/models/project';
import type { BridgeSettings, ClientPresence, SyncChanges } from '$shared/models/sync';
import type {
  AgentsUpdatedParams,
  PresenceUpdatedParams,
  ProjectRemovedParams,
  ProjectUpdatedParams,
  SettingsUpdatedParams,
  ThreadDeletedParams,
  ThreadUpdatedParams,
} from '$shared/jsonrpc/notifications';
import { bridge, type BridgeClientStore, type BridgeNotification } from './client.svelte';
import { Conversation, isTimelineMethod, threadIdOf } from './conversation.svelte';
import { isUserFacingAgent } from './agents';
import { ThreadActivity, type ChatActivity } from './activity.svelte';

/** One spelling for comparing directories: forward slashes, no trailing slash. */
export function normalizeCwd(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** What a chat tab sends with a message. */
export interface SendOptions {
  /** Per-model run options (`AgentModel.options` knobs), e.g. reasoning effort. */
  options?: Record<string, string | boolean>;
}

/** Something the replica changed, for listeners that mirror it (projects). */
export type ReplicaChange =
  | { type: 'projects'; projects: Project[]; removed: Project[]; reset: boolean };

export class ChatStore {
  readonly #client: BridgeClientStore;
  /** Every thread the bridge knows, by id. */
  threads = new SvelteMap<string, Thread>();
  threadsLoaded = $state(false);
  /** The bridge's project registry, by id — the list the phone shows too. */
  projects = new SvelteMap<string, Project>();
  /** Settings shared with every client (the start folder). */
  settings = $state<BridgeSettings | null>(null);
  /** Who is connected to the bridge right now (phones, this desktop). */
  clients = $state<ClientPresence[]>([]);
  agents = $state<AgentDescriptor[]>([]);
  /** The last sync revision applied, and the store it belongs to. */
  #rev: number | undefined;
  #storeId: string | undefined;
  #syncing: Promise<void> | undefined;
  #syncAgain = false;
  readonly #replicaListeners = new Set<(change: ReplicaChange) => void>();
  /** What every thread is doing now (tab chips, sidebar rows). */
  readonly activity = new ThreadActivity();
  #models = new SvelteMap<string, AgentModel[]>();
  /** `agent/models` requests in flight, by agent. */
  readonly #modelRequests = new Map<string, Promise<AgentModel[]>>();
  #prefetching = false;
  #conversations = new SvelteMap<string, Conversation>();
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

  /** Listen for what the replica changed (the project mirror). */
  onReplicaChange(listener: (change: ReplicaChange) => void): () => void {
    this.#replicaListeners.add(listener);
    return () => this.#replicaListeners.delete(listener);
  }

  /** After (re)connecting: catch up on everything, reload the agents and
   *  every open thread. */
  async resync(): Promise<void> {
    await Promise.allSettled([
      this.sync(),
      this.loadAgents(),
      ...[...this.#conversations.values()].map((c) => c.load()),
    ]);
  }

  /**
   * Converge with the bridge: everything that changed after the last revision
   * applied (or a full snapshot when the bridge says so). Calls that arrive
   * while one runs are folded into one more pass afterwards.
   */
  sync(): Promise<void> {
    if (this.#syncing) {
      this.#syncAgain = true;
      return this.#syncing;
    }
    this.#syncing = (async () => {
      do {
        this.#syncAgain = false;
        try {
          const changes = await this.#client.call<SyncChanges>('sync/changes', {
            ...(this.#rev !== undefined ? { since: this.#rev } : {}),
            ...(this.#storeId !== undefined ? { storeId: this.#storeId } : {}),
          });
          if (changes) this.applySync(changes);
        } catch {
          /* not connected; the next connect syncs */
        }
      } while (this.#syncAgain);
    })().finally(() => {
      this.#syncing = undefined;
    });
    return this.#syncing;
  }

  /** Apply one `sync/changes` answer to the replica. */
  applySync(changes: SyncChanges): void {
    const removedProjects: Project[] = [];
    if (changes.reset) {
      const keepThreads = new Set(changes.threads.map((t) => t.id));
      for (const id of [...this.threads.keys()]) if (!keepThreads.has(id)) this.threads.delete(id);
      const keepProjects = new Set(changes.projects.map((p) => p.id));
      for (const id of [...this.projects.keys()]) if (!keepProjects.has(id)) this.projects.delete(id);
    }
    for (const thread of changes.threads) {
      if (thread && typeof thread.id === 'string') this.threads.set(thread.id, thread);
    }
    for (const id of changes.removedThreadIds) this.threads.delete(id);
    for (const project of changes.projects) {
      if (project && typeof project.id === 'string') this.projects.set(project.id, project);
    }
    for (const id of changes.removedProjectIds) {
      const gone = this.projects.get(id);
      if (gone) removedProjects.push(gone);
      this.projects.delete(id);
    }
    this.settings = changes.settings;
    this.clients = changes.clients;
    this.activity.adoptList([...this.threads.values()]);
    this.#rev = changes.rev;
    this.#storeId = changes.storeId;
    this.threadsLoaded = true;
    this.#emitReplica({
      type: 'projects',
      projects: [...this.projects.values()],
      removed: removedProjects,
      reset: changes.reset,
    });
  }

  /**
   * A revisioned change arrived. The next one after the last applied is
   * simply taken; one further ahead means something was missed in between,
   * so the replica catches up with `sync/changes`; an older one is stale.
   * Returns whether to apply this change directly.
   */
  #admit(rev: number | undefined): boolean {
    if (rev === undefined || this.#rev === undefined) {
      if (this.#rev === undefined) void this.sync();
      return true;
    }
    if (rev <= this.#rev) return false;
    if (rev === this.#rev + 1) {
      this.#rev = rev;
      return true;
    }
    void this.sync();
    return true;
  }

  #emitReplica(change: ReplicaChange): void {
    for (const listener of this.#replicaListeners) {
      try {
        listener(change);
      } catch {
        /* a listener's failure is its own */
      }
    }
  }

  /** Projects by name (the bridge's registry). */
  projectList(): Project[] {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Change the shared start folder (every client hears it). */
  async setHome(home: string): Promise<void> {
    this.settings = await this.#client.call<BridgeSettings>('settings/set', { home });
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

  /** Loads every available agent's models in the background, one agent at a
   *  time, so a model menu opens on a full list instead of a spinner. Cheap to
   *  call again: cached agents are skipped. */
  async prefetchModels(): Promise<void> {
    if (this.#prefetching) return;
    this.#prefetching = true;
    try {
      for (const agent of untrack(() => this.agents)) {
        if (agent.available) await this.modelsFor(agent.agentId);
      }
    } finally {
      this.#prefetching = false;
    }
  }

  /** The models an agent's CLI reports (cached per agent; concurrent asks for
   *  the same agent share one request). */
  modelsFor(agentId: string): Promise<AgentModel[]> {
    const cached = this.#models.get(agentId);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.#modelRequests.get(agentId);
    if (inFlight) return inFlight;
    const request = this.#client
      .call<{ models: AgentModel[] }>('agent/models', { agentId })
      .then((result) => {
        const models = result?.models ?? [];
        this.#models.set(agentId, models);
        return models;
      })
      .catch(() => [] as AgentModel[])
      .finally(() => this.#modelRequests.delete(agentId));
    this.#modelRequests.set(agentId, request);
    return request;
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

  /** What the folder's conversations are doing — the non-idle states, each with
   *  when it last moved — for the sidebar's aggregates (needs-you count, a
   *  worktree's leading state, recency order), next to its terminal agents. */
  statusesAt(cwd: string): { status: ChatActivity; at: number }[] {
    const out: { status: ChatActivity; at: number }[] = [];
    for (const thread of this.threadsFor(cwd)) {
      const status = this.activity.of(thread.id);
      if (status !== 'idle') out.push({ status, at: thread.updatedAt });
    }
    return out;
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

  /** The live view of a thread when one is already open — never creates or
   *  loads one, so a tab chip can read it while it renders. */
  peekConversation(threadId: string | undefined): Conversation | undefined {
    return threadId ? this.#conversations.get(threadId) : undefined;
  }

  /** Stop tracking a thread no tab shows anymore. */
  release(threadId: string): void {
    this.#conversations.delete(threadId);
  }

  /** Route one bridge notification. */
  apply(notification: BridgeNotification): void {
    this.activity.apply(notification);
    switch (notification.method) {
      case 'stream/thread/updated': {
        const thread = (notification.params as ThreadUpdatedParams | undefined)?.thread;
        if (thread && typeof thread.id === 'string' && this.#admit(thread.rev)) {
          this.threads.set(thread.id, thread);
        }
        return;
      }
      case 'stream/thread/deleted': {
        const params = notification.params as ThreadDeletedParams | undefined;
        if (typeof params?.threadId === 'string' && this.#admit(params.rev)) {
          this.threads.delete(params.threadId);
        }
        return;
      }
      case 'stream/project/updated': {
        const project = (notification.params as ProjectUpdatedParams | undefined)?.project;
        if (project && typeof project.id === 'string' && this.#admit(project.rev)) {
          this.projects.set(project.id, project);
          this.#emitReplica({ type: 'projects', projects: [project], removed: [], reset: false });
        }
        return;
      }
      case 'stream/project/removed': {
        const params = notification.params as ProjectRemovedParams | undefined;
        if (typeof params?.projectId === 'string' && this.#admit(params.rev)) {
          const gone = this.projects.get(params.projectId);
          this.projects.delete(params.projectId);
          if (gone) this.#emitReplica({ type: 'projects', projects: [], removed: [gone], reset: false });
        }
        return;
      }
      case 'stream/settings/updated': {
        const params = notification.params as SettingsUpdatedParams | undefined;
        if (params?.settings && this.#admit(params.rev)) this.settings = params.settings;
        return;
      }
      case 'stream/presence/updated': {
        const clients = (notification.params as PresenceUpdatedParams | undefined)?.clients;
        if (Array.isArray(clients)) this.clients = clients;
        return;
      }
      case 'stream/agents/updated': {
        const agents = (notification.params as AgentsUpdatedParams | undefined)?.agents;
        if (Array.isArray(agents)) {
          this.agents = agents.filter((a) => !a.deprecated && isUserFacingAgent(a.agentId));
        }
        return;
      }
    }
    if (!isTimelineMethod(notification.method)) return;
    const threadId = threadIdOf(notification);
    if (!threadId) return;
    this.#conversations.get(threadId)?.apply(notification);
    // A turn arriving or starting is activity: keep the list's order honest
    // without a refetch.
    if (notification.method === 'stream/turn/created' || notification.method === 'stream/turn/started') {
      const thread = this.threads.get(threadId);
      if (thread) this.threads.set(threadId, { ...thread, updatedAt: Date.now() });
    }
  }

  /** Starts a thread in `cwd` with `agentId` (fixed from now on) and
   *  `model`. The folder decides the project (the bridge registers it). A
   *  `title` — a name the user gave the tab before its first message — is the
   *  user's, so nothing generated replaces it; otherwise the bridge names the
   *  conversation from its first message. */
  async startThread(input: {
    cwd: string;
    agentId: string;
    model?: string;
    title?: string;
  }): Promise<Thread> {
    const title = input.title?.trim();
    const thread = await this.#client.call<Thread>('thread/start', {
      agentId: input.agentId,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(title ? { title } : {}),
    });
    this.threads.set(thread.id, thread);
    // Same starting posture as a thread started on the phone, so a
    // conversation behaves alike whichever client opened it.
    void this.setAccessMode(thread.id, 'fullAccess').catch(() => undefined);
    return this.threads.get(thread.id) ?? thread;
  }

  /** Send a user message. The bubble shows at once; the bridge's
   *  `stream/turn/created` echo (matched by `clientTurnId`) replaces it. */
  async send(threadId: string, text: string, opts: SendOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const conversation = this.conversation(threadId);
    const clientTurnId = crypto.randomUUID();
    conversation.addPending({ clientTurnId, text: trimmed });
    try {
      // The bridge names the conversation from its first message itself.
      await this.#client.call('turn/send', {
        threadId,
        text: trimmed,
        clientTurnId,
        ...(opts.options && Object.keys(opts.options).length > 0 ? { options: opts.options } : {}),
      });
    } catch (err) {
      conversation.failPending(clientTurnId, err instanceof Error ? err.message : String(err));
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
    const thread = await this.#client.call<Thread>('thread/rename', { threadId, title: trimmed });
    // Adopt it now: a generated title must not race past a name just chosen.
    if (thread && typeof thread.id === 'string') this.threads.set(thread.id, thread);
  }

  /** Archive: out of every list, on every client (the bridge stops a running
   *  turn first); restorable with {@link unarchive}. Adopted at once. */
  async archive(threadId: string): Promise<void> {
    this.#adopt(await this.#client.call<Thread>('thread/archive', { threadId }));
  }

  async unarchive(threadId: string): Promise<void> {
    this.#adopt(await this.#client.call<Thread>('thread/unarchive', { threadId }));
  }

  /** Delete the conversation for every device (the bridge's `thread/delete`;
   *  every client drops it on `stream/thread/deleted`). */
  async remove(threadId: string): Promise<void> {
    await this.#client.call('thread/delete', { threadId });
    this.threads.delete(threadId);
  }

  #adopt(thread: Thread | null | undefined): void {
    if (thread && typeof thread.id === 'string') this.threads.set(thread.id, thread);
  }

  async resumeQueue(threadId: string): Promise<void> {
    await this.#client.call('queue/resume', { threadId });
  }

  async clearQueue(threadId: string): Promise<void> {
    await this.#client.call('queue/clear', { threadId });
  }
}

export const chat = new ChatStore(bridge);
