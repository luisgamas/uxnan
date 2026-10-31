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

import { getContext, setContext, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type {
  AccessMode,
  Thread,
  ThreadSearchParams,
  ThreadSearchResult,
  TransferStrategy,
  TurnList,
} from '$shared/models/thread';
import type { ApprovalDecision } from '$shared/models/approval';
import type {
  AgentCommand,
  AgentCommandInvocation,
  AgentDescriptor,
  AgentModel,
} from '$shared/agents/agent-capabilities';
import type { TurnAttachment } from '$shared/models/workspace';
import type {
  ThreadTransferContextResult,
  ThreadTransferResult,
  TurnAttachmentData,
} from '$shared/jsonrpc/methods';
import type { Project } from '$shared/models/project';
import type { BridgeSettings, ClientPresence, SyncChanges } from '$shared/models/sync';
import type { TrustedDevice } from '$shared/models/session';
import type {
  AgentSessionHandoffOutcome,
  AgentSessionHandoffResult,
  AgentSessionHeldParams,
  AgentSessionHold,
  AgentSessionHoldsResult,
  AgentSessionKey,
  AgentSessionListResult,
  AgentSessionSummary,
} from '$shared/models/agent-session';
import type {
  AgentsUpdatedParams,
  ContentBlockParams,
  DevicesUpdatedParams,
  PresenceUpdatedParams,
  ProjectRemovedParams,
  ProjectUpdatedParams,
  SettingsUpdatedParams,
  ThreadDeletedParams,
  ThreadUpdatedParams,
} from '$shared/jsonrpc/notifications';
import { bridge, bridges, type BridgeClientStore, type BridgeNotification } from './client.svelte';
import { isLocalTarget, type TargetId } from '$lib/target';
import { Conversation, isTimelineMethod, threadIdOf } from './conversation.svelte';
import { isUserFacingAgent } from './agents';
import { requestIdOf } from './timeline';
import { outboxKey, writeOutbox, type SendRequest } from './outbox';
import { hostSeenStore, ThreadActivity, type ChatActivity, type SeenStore } from './activity.svelte';

/** An agent session as the replica keeps it: the bridge's summary and the
 *  moment it last changed on this clock. */
export type AgentSessionRow = AgentSessionSummary & { updatedAt: number };

/** A folder's agent sessions that no conversation continues. */
export interface FolderAgentSessions {
  /** Most recently changed first. */
  sessions: AgentSessionRow[];
  /** Agents installed here whose CLI cannot list its sessions. */
  unlisted: string[];
}

/** How long to wait before asking again while the bridge names sessions. */
export const TITLE_FOLLOW_UP_MS = 5_000;
/** How many times to ask again (about a minute and a half), then leave it to the next visit. */
export const TITLE_FOLLOW_UP_ROUNDS = 18;

/** How a session is known across agents: `agentId:sessionId`. */
export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

/** One spelling for comparing directories: forward slashes, no trailing slash. */
export function normalizeCwd(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** What a chat tab sends with a message. */
export interface SendOptions {
  /** Per-model run options (`AgentModel.options` knobs), e.g. reasoning effort. */
  options?: Record<string, string | boolean>;
  /**
   * One of the agent's commands (`agent/commands`) instead of free text: the
   * bridge runs it natively or expands it (`turn/send { command }`), as it does
   * for the phone.
   */
  command?: AgentCommandInvocation;
  /** The message's images and files, in the order of the markers in its text. */
  attachments?: TurnAttachment[];
}

/** How long an agent's command list for a folder is reused. */
const COMMANDS_TTL_MS = 60_000;

/** Something the replica changed, for listeners that mirror it (projects). */
export type ReplicaChange =
  | {
      type: 'projects';
      projects: Project[];
      removed: Project[];
      reset: boolean;
      /** `sync`: a whole `sync/changes` answer (the replica now matches the
       *  bridge at `storeId`); `notification`: one change as it happened. */
      source: 'sync' | 'notification';
      /** The bridge state the replica belongs to (`SyncChanges.storeId`). */
      storeId?: string;
    };

/** An agent started waiting on the person in one of this bridge's threads. */
export interface ChatRequestRaised {
  threadId: string;
  /** The `approvalId` / `questionId`: one alert per request. */
  requestId: string;
  kind: 'approval' | 'question';
  /** The approval's action, or the first question's text. */
  text: string;
}

export class ChatStore {
  readonly #client: BridgeClientStore;
  /** Every thread the bridge knows, by id. */
  threads = new SvelteMap<string, Thread>();
  threadsLoaded = $state(false);
  /** The bridge's project registry, by id — the list the phone shows too. */
  projects = new SvelteMap<string, Project>();
  /** Settings shared with every client (the start folder, the PC's name). */
  settings = $state<BridgeSettings | null>(null);
  /** Who is connected to the bridge right now (phones, this desktop). */
  clients = $state<ClientPresence[]>([]);
  /** Every phone paired to this PC, as the bridge names them. */
  devices = $state<TrustedDevice[]>([]);
  agents = $state<AgentDescriptor[]>([]);
  /** The agent sessions a desktop terminal holds, by `agentId:sessionId`
   *  (architecture/02a §5.8.19): no turn runs in one of those here until its
   *  terminal lets it go. Live, not revisioned: reloaded on every reconnect. */
  holds = new SvelteMap<string, AgentSessionHold>();
  /** The agents' own sessions that no conversation continues yet, by folder
   *  (architecture/02a §5.8.19). The one place they are loaded: the new-chat
   *  screen reads how many there are, the Conversations tab lists them. Asked
   *  of the bridge by whatever shows them (`refreshAgentSessions`, again after
   *  a reconnect: nothing announces a session a terminal started), and
   *  replaced when the answer comes, never emptied meanwhile. */
  agentSessions = new SvelteMap<string, FolderAgentSessions>();
  /** `agent/sessions` requests in flight, by folder. */
  readonly #sessionRequests = new Map<string, Promise<void>>();
  /** The re-ask scheduled while the bridge names sessions, by folder. */
  readonly #titleFollowUps = new Map<string, ReturnType<typeof setTimeout>>();
  /** The last sync revision applied, and the store it belongs to. */
  #rev: number | undefined;
  #storeId: string | undefined;
  #syncing: Promise<void> | undefined;
  #syncAgain = false;
  readonly #replicaListeners = new Set<(change: ReplicaChange) => void>();
  readonly #requestListeners = new Set<(raised: ChatRequestRaised) => void>();
  /** Requests already announced, so a card delivered twice alerts once. */
  readonly #raised = new Set<string>();
  readonly #commands = new Map<string, { at: number; commands: AgentCommand[] }>();
  /** What every thread is doing now (tab chips, sidebar rows). */
  readonly activity: ThreadActivity;
  #models = new SvelteMap<string, AgentModel[]>();
  /** `agent/models` requests in flight, by agent. */
  readonly #modelRequests = new Map<string, Promise<AgentModel[]>>();
  #prefetching = false;
  #conversations = new SvelteMap<string, Conversation>();
  /** How many mounted chats show each thread (`open` / `release`). */
  readonly #shown = new Map<string, number>();
  /** Images of user messages already fetched (`attachment`), by thread and id. */
  readonly #attachments = new Map<string, Promise<string>>();
  #started = false;

  /** The machine whose bridge this replicates. */
  get target(): TargetId {
    return this.#client.target;
  }

  /** The bridge this replicates — for a component that calls it directly. */
  get client(): BridgeClientStore {
    return this.#client;
  }

  constructor(client: BridgeClientStore, seenStore?: SeenStore) {
    this.#client = client;
    this.activity = new ThreadActivity({
      ...(seenStore ? { store: seenStore } : {}),
      // Only the newest turn: whether it finished or failed, and when.
      lastTurn: async (threadId) => {
        const page = await client.call<TurnList>('turn/list', { threadId, limit: 1, fromEnd: true });
        const turns = Array.isArray(page?.turns) ? page.turns : [];
        return turns[turns.length - 1];
      },
    });
  }

  /** The user is looking at a thread as the bridge last described it: what
   *  ended there is no longer news, here or after a restart. */
  markSeen(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (thread) this.activity.seen(threadId, thread.updatedAt);
  }

  /** Subscribe to the bridge (once). Safe to call before it is connected. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#client.onNotification((n) => this.apply(n));
    this.#client.onConnected(() => void this.resync());
    if (this.#client.connected) void this.resync();
  }

  /** Listen for agents starting to wait on the person (`chatAlerts`): once
   *  per approval or question, as its card arrives. */
  onRequest(listener: (raised: ChatRequestRaised) => void): () => void {
    this.#requestListeners.add(listener);
    return () => this.#requestListeners.delete(listener);
  }

  /** A card arrived: tell the listeners once, while it is still open. */
  #raiseRequest(threadId: string, content: unknown): void {
    const requestId = requestIdOf(content);
    if (!requestId || this.#raised.has(requestId)) return;
    const block = content as Record<string, unknown>;
    if (block.outcome !== undefined) return; // already settled
    this.#raised.add(requestId);
    const req =
      block.request && typeof block.request === 'object'
        ? (block.request as Record<string, unknown>)
        : block;
    const first = Array.isArray(req.questions) ? (req.questions[0] as Record<string, unknown>) : {};
    const kind = block.type === 'approval' ? 'approval' : 'question';
    const text = kind === 'approval' ? req.action : first?.question;
    const raised: ChatRequestRaised = {
      threadId,
      requestId,
      kind,
      text: typeof text === 'string' ? text : '',
    };
    for (const listener of this.#requestListeners) listener(raised);
  }

  /** Listen for what the replica changed (the project mirror). */
  onReplicaChange(listener: (change: ReplicaChange) => void): () => void {
    this.#replicaListeners.add(listener);
    return () => this.#replicaListeners.delete(listener);
  }

  /** After (re)connecting: catch up on everything, reload the agents, the
   *  models already shown and every open thread. The bridge on the other end
   *  may be a newer one (it updated itself, or the user did) whose agents
   *  list other models, so what was cached is asked again — replaced when the
   *  answer comes, never emptied meanwhile — and the commands are dropped. */
  async resync(): Promise<void> {
    this.#commands.clear();
    await Promise.allSettled([
      this.sync(),
      this.loadAgents(),
      this.loadHolds(),
      ...[...this.#models.keys()].map((id) => this.modelsFor(id, { fresh: true })),
      // Only what a chat shows: the rest loads when it is opened again.
      ...[...this.#conversations.entries()]
        .filter(([id]) => this.#shown.has(id))
        .map(([, c]) => c.load()),
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
    if (Array.isArray(changes.devices)) this.devices = changes.devices;
    this.activity.adoptList([...this.threads.values()]);
    // The live set comes whole on every answer: it corrects what the replica's
    // own `activeTurnId`s, unchanged since the cursor, no longer tell.
    if (Array.isArray(changes.live)) this.activity.adoptLive(changes.live);
    this.#rev = changes.rev;
    this.#storeId = changes.storeId;
    this.threadsLoaded = true;
    this.#emitReplica({
      type: 'projects',
      projects: [...this.projects.values()],
      removed: removedProjects,
      reset: changes.reset,
      source: 'sync',
      storeId: changes.storeId,
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

  /** Rename this PC for every client; empty restores the machine's name. */
  async setPcName(name: string): Promise<void> {
    this.settings = await this.#client.call<BridgeSettings>('settings/set', { name });
  }

  /** Name a paired phone for every client; empty restores its own name. */
  async renamePhone(deviceId: string, name: string): Promise<void> {
    const renamed = await this.#client.call<TrustedDevice>('device/rename', { deviceId, name });
    this.devices = this.devices.map((d) => (d.deviceId === renamed.deviceId ? renamed : d));
  }

  /** Unpair a phone: it can no longer reconnect until it is paired again. */
  async removePhone(deviceId: string): Promise<void> {
    await this.#client.call('bridge/removeTrustedDevice', { deviceId });
    this.devices = this.devices.filter((d) => d.deviceId !== deviceId);
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
   *  the same agent share one request). `fresh` asks the bridge again even
   *  with a cached list, which stays until the answer replaces it. */
  modelsFor(agentId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<AgentModel[]> {
    const cached = this.#models.get(agentId);
    if (cached && !fresh) return Promise.resolve(cached);
    const inFlight = this.#modelRequests.get(agentId);
    if (inFlight) return inFlight;
    const request = this.#client
      .call<{ models: AgentModel[] }>('agent/models', { agentId })
      .then((result) => {
        const models = result?.models ?? [];
        this.#models.set(agentId, models);
        return models;
      })
      .catch(() => cached ?? ([] as AgentModel[]))
      .finally(() => this.#modelRequests.delete(agentId));
    this.#modelRequests.set(agentId, request);
    return request;
  }

  /** Models already loaded for an agent (reactive; empty until `modelsFor`). */
  /**
   * The commands [agentId] has in [cwd] (`agent/commands`) — its built-ins,
   * custom commands and skills, as the bridge learns them from the agent.
   * Reused for a minute per agent and folder; none when the bridge cannot say.
   */
  async commandsFor(agentId: string, cwd?: string): Promise<AgentCommand[]> {
    const key = `${agentId}\n${cwd ?? ''}`;
    const cached = this.#commands.get(key);
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
    try {
      const result = await this.#client.call<{ commands: AgentCommand[] }>('agent/commands', {
        agentId,
        ...(cwd ? { cwd } : {}),
      });
      const commands = Array.isArray(result?.commands) ? result.commands : [];
      this.#commands.set(key, { at: Date.now(), commands });
      return commands;
    } catch {
      return cached?.commands ?? [];
    }
  }

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

  /** The live view of one thread, created (and loaded) on first use. Kept
   *  while a chat shows it ({@link open}) or it holds a message the bridge has
   *  not confirmed; see {@link release}. */
  conversation(threadId: string): Conversation {
    let conversation = this.#conversations.get(threadId);
    if (!conversation) {
      conversation = new Conversation(
        threadId,
        (method, params) => this.#client.call(method, params),
        outboxKey(this.target, threadId),
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

  /** A mounted chat starts showing [threadId]: its conversation is kept and
   *  re-synced on every reconnect until the matching {@link release}. */
  open(threadId: string): Conversation {
    this.#shown.set(threadId, (this.#shown.get(threadId) ?? 0) + 1);
    return this.conversation(threadId);
  }

  /** A chat stopped showing [threadId]. Once none does, its conversation goes:
   *  every one ever opened used to stay for the whole session — each a full
   *  copy of its history — and every reconnect loaded all of them again.
   *  Opening it again loads it fresh. */
  release(threadId: string): void {
    const left = (this.#shown.get(threadId) ?? 0) - 1;
    if (left > 0) this.#shown.set(threadId, left);
    else this.#shown.delete(threadId);
    this.#dropIfUnused(threadId);
  }

  /** Forget a conversation no chat shows, unless it still holds a message the
   *  bridge has not confirmed: the echo that confirms it is applied there. */
  #dropIfUnused(threadId: string): void {
    if (this.#shown.has(threadId)) return;
    const conversation = this.#conversations.get(threadId);
    if (conversation && conversation.pending.length === 0) this.#conversations.delete(threadId);
  }

  /** Every session a terminal holds now — after a reconnect, when some
   *  `stream/agent/held` may have been missed. */
  async loadHolds(): Promise<void> {
    const { holds } = await this.#client.call<AgentSessionHoldsResult>('agent/holds', {});
    this.holds.clear();
    for (const hold of holds) this.holds.set(sessionKey(hold.agentId, hold.sessionId), hold);
  }

  /** The terminal holding a conversation's session, if one does. */
  holdOf(thread: Pick<Thread, 'agentId' | 'agentSessionId'> | undefined): AgentSessionHold | undefined {
    if (!thread?.agentId || !thread.agentSessionId) return undefined;
    return this.holds.get(sessionKey(thread.agentId, thread.agentSessionId));
  }

  /**
   * Ask the bridge for a folder's agent sessions that no conversation continues
   * and keep the answer in `agentSessions`. Calls for a folder already being
   * asked share the one request; a failure leaves what was there.
   */
  refreshAgentSessions(folder: string): Promise<void> {
    // Someone asked: the bridge naming sessions is followed afresh from here.
    const cwd = normalizeCwd(folder);
    clearTimeout(this.#titleFollowUps.get(cwd));
    this.#titleFollowUps.delete(cwd);
    return this.#loadAgentSessions(folder, 0);
  }

  /**
   * One `agent/sessions` request. A session its CLI keeps no title for is named
   * by the bridge in the background (`titlePending`), so the answer is asked
   * again every `TITLE_FOLLOW_UP_MS` while any is — at most
   * `TITLE_FOLLOW_UP_ROUNDS` times — instead of waiting for a notification no
   * one sends: the replica converges by asking its owner.
   */
  #loadAgentSessions(folder: string, rounds: number): Promise<void> {
    const cwd = normalizeCwd(folder);
    const running = this.#sessionRequests.get(cwd);
    if (running) return running;
    const request = this.#client
      .call<AgentSessionListResult>('agent/sessions', { cwd: folder })
      .then((result) => {
        const askedAt = Date.now();
        this.agentSessions.set(cwd, {
          // An age travels, not a time: the moment is rebuilt against this
          // clock, once, so it does not slide while the list is kept.
          sessions: result.sessions
            .filter((s) => !s.threadId)
            .map((s) => ({ ...s, updatedAt: askedAt - s.updatedAgoMs })),
          unlisted: result.unlisted,
        });
        if (rounds < TITLE_FOLLOW_UP_ROUNDS && result.sessions.some((s) => s.titlePending)) {
          const timer = setTimeout(() => {
            this.#titleFollowUps.delete(cwd);
            void this.#loadAgentSessions(folder, rounds + 1).catch(() => undefined);
          }, TITLE_FOLLOW_UP_MS);
          this.#titleFollowUps.set(cwd, timer);
        }
      })
      .finally(() => this.#sessionRequests.delete(cwd));
    this.#sessionRequests.set(cwd, request);
    return request;
  }

  /** A folder's agent sessions as last loaded; `undefined` until the first answer. */
  agentSessionsOf(cwd: string): FolderAgentSessions | undefined {
    return this.agentSessions.get(normalizeCwd(cwd));
  }

  /** Ask the terminal holding a session to let it go. */
  async requestHandoff(key: AgentSessionKey): Promise<AgentSessionHandoffOutcome> {
    const { outcome } = await this.#client.call<AgentSessionHandoffResult>(
      'agent/requestHandoff',
      key,
    );
    return outcome;
  }

  /** Route one bridge notification. */
  apply(notification: BridgeNotification): void {
    this.activity.apply(notification);
    switch (notification.method) {
      case 'stream/content/block': {
        const params = notification.params as ContentBlockParams | undefined;
        if (typeof params?.threadId === 'string') this.#raiseRequest(params.threadId, params.content);
        break;
      }
      case 'stream/approval/resolved':
      case 'stream/question/resolved': {
        const p = notification.params as { approvalId?: unknown; questionId?: unknown } | undefined;
        const id = p?.approvalId ?? p?.questionId;
        if (typeof id === 'string') this.#raised.delete(id);
        break;
      }
      case 'stream/agent/held': {
        const params = notification.params as AgentSessionHeldParams | undefined;
        if (typeof params?.agentId !== 'string' || typeof params.sessionId !== 'string') return;
        const key = sessionKey(params.agentId, params.sessionId);
        if (params.hold) this.holds.set(key, params.hold);
        else this.holds.delete(key);
        return;
      }
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
          this.#forgetUnsent(params.threadId);
        }
        return;
      }
      case 'stream/project/updated': {
        const project = (notification.params as ProjectUpdatedParams | undefined)?.project;
        if (project && typeof project.id === 'string' && this.#admit(project.rev)) {
          this.projects.set(project.id, project);
          this.#emitReplica({
            type: 'projects',
            projects: [project],
            removed: [],
            reset: false,
            source: 'notification',
            ...(this.#storeId !== undefined ? { storeId: this.#storeId } : {}),
          });
        }
        return;
      }
      case 'stream/project/removed': {
        const params = notification.params as ProjectRemovedParams | undefined;
        if (typeof params?.projectId === 'string' && this.#admit(params.rev)) {
          const gone = this.projects.get(params.projectId);
          this.projects.delete(params.projectId);
          if (gone) {
            this.#emitReplica({
              type: 'projects',
              projects: [],
              removed: [gone],
              reset: false,
              source: 'notification',
              ...(this.#storeId !== undefined ? { storeId: this.#storeId } : {}),
            });
          }
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
      case 'stream/devices/updated': {
        const devices = (notification.params as DevicesUpdatedParams | undefined)?.devices;
        if (Array.isArray(devices)) this.devices = devices;
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
    this.#dropIfUnused(threadId);
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
    /** Continue this session of the agent (`agent/sessions`, or a
     *  terminal's): the bridge returns the conversation that already
     *  continues it, when one does. */
    agentSessionId?: string;
    /** Start it as the continuation of this conversation (architecture/02a
     *  §5.8.21): its first message carries that one's context. */
    continueFrom?: { threadId: string; strategy?: TransferStrategy };
  }): Promise<Thread> {
    const title = input.title?.trim();
    const thread = await this.#client.call<Thread>('thread/start', {
      agentId: input.agentId,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(title ? { title } : {}),
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.continueFrom ? { continueFrom: input.continueFrom } : {}),
    });
    this.threads.set(thread.id, thread);
    // It starts in its agent's default mode, set by the bridge — the desktop
    // does not choose one for it.
    return this.threads.get(thread.id) ?? thread;
  }

  /** Send a user message. The bubble shows at once and waits in the outbox;
   *  the bridge's `stream/turn/created` echo (matched by `clientTurnId`)
   *  replaces it. */
  async send(threadId: string, text: string, opts: SendOptions = {}): Promise<void> {
    const trimmed = text.trim();
    const attachments = opts.attachments ?? [];
    const command = opts.command;
    if (trimmed.length === 0 && attachments.length === 0 && !command) return;
    const conversation = this.conversation(threadId);
    const clientTurnId = crypto.randomUUID();
    // The bubble shows what history will: the command as typed or the text,
    // with its images and files where they sit — the bridge stores the same.
    const shown = command ? `/${command.name}${command.args ? ` ${command.args}` : ''}` : trimmed;
    // The bridge names the conversation from its first message itself. A
    // command carries no text: the bridge resolves it (as for the phone).
    const request: SendRequest = {
      ...(command ? { command } : { text: trimmed }),
      ...(opts.options && Object.keys(opts.options).length > 0 ? { options: opts.options } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    conversation.addPending({ clientTurnId, text: shown, request });
    await this.#deliver(threadId, clientTurnId, request);
  }

  /** Send a message that did not get through again, as it was written. */
  async retry(threadId: string, clientTurnId: string): Promise<void> {
    const send = this.conversation(threadId).retryPending(clientTurnId);
    if (send) await this.#deliver(threadId, clientTurnId, send.request);
  }

  async #deliver(threadId: string, clientTurnId: string, request: SendRequest): Promise<void> {
    try {
      await this.#client.call('turn/send', { threadId, ...request, clientTurnId });
    } catch (err) {
      this.conversation(threadId).failPending(
        clientTurnId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** A thread deleted for every device takes what it had waiting with it. */
  #forgetUnsent(threadId: string): void {
    const open = this.#conversations.get(threadId);
    if (open) open.forgetPending();
    else writeOutbox(outboxKey(this.target, threadId), []);
  }

  /**
   * An image a user message carries (`Message.attachments`) as a `data:` URL,
   * asked of the bridge once and then kept: a message's images never change.
   */
  attachment(threadId: string, attachmentId: string): Promise<string> {
    const key = `${threadId}/${attachmentId}`;
    let image = this.#attachments.get(key);
    if (!image) {
      image = this.#client
        .call<TurnAttachmentData>('turn/attachment', { threadId, attachmentId })
        .then((data) => `data:${data.mimeType};base64,${data.base64Data}`);
      // A failed fetch is not kept: the next view of the message asks again.
      image.catch(() => this.#attachments.delete(key));
      this.#attachments.set(key, image);
    }
    return image;
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
    this.#forgetUnsent(threadId);
  }

  /** Continue a conversation with another agent (or the same) as a NEW one —
   *  the bridge prepares the context its first message carries and records
   *  both ends (architecture/02a §5.8.21). Adopted at once. */
  async transfer(input: {
    sourceThreadId: string;
    agentId: string;
    model?: string;
    strategy?: TransferStrategy;
    message?: string;
    clientTransferId?: string;
  }): Promise<ThreadTransferResult> {
    const made = await this.#client.call<ThreadTransferResult>('thread/transfer', {
      sourceThreadId: input.sourceThreadId,
      agentId: input.agentId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.strategy ? { strategy: input.strategy } : {}),
      ...(input.message?.trim() ? { message: input.message } : {}),
      ...(input.clientTransferId ? { clientTransferId: input.clientTransferId } : {}),
    });
    this.#adopt(made.thread);
    return made;
  }

  /** A copy with the same agent: the history copied, its first message
   *  carrying a selection of it (the fork's agent session starts empty). */
  async fork(threadId: string): Promise<Thread> {
    const thread = await this.#client.call<Thread>('thread/fork', {
      threadId,
      clientTransferId: crypto.randomUUID(),
    });
    this.#adopt(thread);
    return this.threads.get(thread.id) ?? thread;
  }

  /** What a continuation carries over, exactly as its agent reads it. */
  transferContext(threadId: string): Promise<ThreadTransferContextResult> {
    return this.#client.call<ThreadTransferContextResult>('thread/transferContext', { threadId });
  }

  /** What was said in the conversations: answered by the bridge, which owns
   *  the history (a replica holds no turns of most of them). One page. */
  search(params: ThreadSearchParams): Promise<ThreadSearchResult> {
    return this.#client.call<ThreadSearchResult>('thread/search', params);
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

  /** Sends one queued message now (`queue/sendNow`): into the running turn
   *  when its agent takes input mid-turn, else as the next turn at once. The
   *  bridge's queue notification moves it; a refusal throws with its reason. */
  async sendQueuedNow(threadId: string, turnId: string): Promise<void> {
    await this.#client.call('queue/sendNow', { threadId, turnId });
  }
}

export const chat = new ChatStore(bridge);

/** A replica per host bridge, created with its store and started at once so
 *  it converges the moment that bridge connects. */
const hostChats = new Map<string, ChatStore>();
const storeListeners = new Set<(store: ChatStore) => void>();
bridges.onHostStore((client) => {
  if (hostChats.has(client.target)) return;
  const store = new ChatStore(client, hostSeenStore(client.target));
  hostChats.set(client.target, store);
  for (const listener of storeListeners) listener(store);
  store.start();
});

/** Run [listener] for every replica: this machine's and each host's, those
 *  that exist now and those created later (a host bridge first heard from). */
export function onChatStore(listener: (store: ChatStore) => void): () => void {
  storeListeners.add(listener);
  listener(chat);
  for (const store of hostChats.values()) listener(store);
  return () => storeListeners.delete(listener);
}

/** The conversations of the machine `target` names: this one's bridge, or a
 *  host's own (`02g` §5.18). */
export function chatFor(target: TargetId | null | undefined): ChatStore {
  if (!target || isLocalTarget(target)) return chat;
  bridges.for(target);
  return hostChats.get(target) ?? chat;
}

/** The replica of the machine `target` names, if it has one — this machine's
 *  always does. Never creates one, so it is safe in a derived value. */
export function chatIfAny(target: TargetId | null | undefined): ChatStore | undefined {
  return !target || isLocalTarget(target) ? chat : hostChats.get(target);
}

/** What the conversations in `path` on the machine `target` names are doing.
 *  Never creates a replica (it is read from derived values): a host whose
 *  bridge has not been heard from has none, and so no conversations. */
export function chatStatusesAt(
  target: TargetId | null | undefined,
  path: string,
): { status: ChatActivity; at: number }[] {
  const store = !target || isLocalTarget(target) ? chat : hostChats.get(target);
  return store?.statusesAt(path) ?? [];
}

/** What one thread on the machine `target` names is doing — `idle` when that
 *  machine has no replica. Like {@link chatStatusesAt}, never creates one. */
export function chatStatusOf(
  target: TargetId | null | undefined,
  threadId: string | undefined,
): ChatActivity {
  const store = !target || isLocalTarget(target) ? chat : hostChats.get(target);
  return threadId && store ? store.activity.of(threadId) : 'idle';
}

const CHAT_CONTEXT = Symbol('uxnan.chat');

/** Make `store` the replica every chat component below reads — a chat tab's
 *  pane provides the one of the machine its thread lives on. */
export function provideChat(store: ChatStore): ChatStore {
  setContext(CHAT_CONTEXT, store);
  return store;
}

/** The replica this component is under: its chat tab's machine's, or this
 *  machine's when nothing provided one (the sidebar, the launcher). */
export function useChat(): ChatStore {
  return getContext<ChatStore | undefined>(CHAT_CONTEXT) ?? chat;
}

/** Every replica that exists — this machine's first. */
export function allChats(): ChatStore[] {
  return [chat, ...hostChats.values()];
}

/** The replica that holds `threadId`, if any does. */
export function chatOfThread(threadId: string, target?: TargetId | null): ChatStore {
  if (target) return chatFor(target);
  return allChats().find((c) => c.threads.has(threadId)) ?? chat;
}
