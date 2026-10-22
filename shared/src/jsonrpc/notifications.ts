/**
 * Bridge → client streaming notifications (JSON-RPC notifications, no `id`).
 *
 * Every notification is broadcast to **every** connected client — each paired
 * phone and the desktop on the local control channel — so any of them can
 * drive a thread and all of them converge on the same state (architecture/02a
 * §5.8.16). A client must therefore expect notifications about threads and
 * turns it did not start itself.
 *
 * Source: architecture/02b-contracts-and-requirements.md (streaming events).
 */
import type { ApprovalDecision } from '../models/approval.js';
import type { QueuePausedReason, Thread, Turn } from '../models/thread.js';
import type { StepPreview } from '../models/history.js';
import type { Project } from '../models/project.js';
import type { BridgeSettings, ClientPresence } from '../models/sync.js';
import type { BridgeUpdate, TrustedDevice } from '../models/session.js';
import type { AgentDescriptor } from '../agents/agent-capabilities.js';

export const StreamNotification = {
  TurnStarted: 'stream/turn/started',
  MessageDelta: 'stream/message/delta',
  /** A chunk of the agent's reasoning for this turn — a `thinking` segment grows (`ThinkingDeltaParams`). */
  ThinkingDelta: 'stream/thinking/delta',
  /** A structured content block (command/diff/tool) the agent produced this turn. */
  ContentBlock: 'stream/content/block',
  TurnCompleted: 'stream/turn/completed',
  TurnError: 'stream/turn/error',
  TurnAborted: 'stream/turn/aborted',
  /** A queued turn was removed before it ever ran (status → `cancelled`). */
  TurnCancelled: 'stream/turn/cancelled',
  /** The thread's message queue changed (queued, drained, cancelled, paused). */
  QueueUpdated: 'stream/queue/updated',
  /** The agent resolved an alias (e.g. `opus`) to a concrete model id for this turn. */
  ModelResolved: 'stream/model/resolved',
  /**
   * A thread was created or its stored metadata changed (title, model, access
   * mode, archive state) — by any client or by the bridge itself (a generated
   * title). Carries the whole {@link Thread}, so it is idempotent.
   */
  ThreadUpdated: 'stream/thread/updated',
  /** A thread was deleted. */
  ThreadDeleted: 'stream/thread/deleted',
  /**
   * The stored history of a thread changed outside a live turn: the bridge
   * merged turns from the agent's own transcript (written in the agent's app
   * or terminal) — imported, refreshed or dropped rows. A client showing that
   * conversation re-reads its newest page (`turn/list { fromEnd: true }`);
   * none of them polls for it (architecture/02a §5.8.8).
   */
  HistoryChanged: 'stream/history/changed',
  /**
   * A user turn was stored (started or queued), carrying the user's message —
   * so a client sees a message another client sent, in order, before the
   * agent's answer to it starts streaming.
   */
  TurnCreated: 'stream/turn/created',
  /** A pending approval was answered (on any client) or timed out. */
  ApprovalResolved: 'stream/approval/resolved',
  /** A pending question was answered (on any client), skipped or timed out. */
  QuestionResolved: 'stream/question/resolved',
  /** A project was registered or its entry changed. */
  ProjectUpdated: 'stream/project/updated',
  /** A project was removed from the registry (its conversations stay). */
  ProjectRemoved: 'stream/project/removed',
  /** The shared settings changed (`settings/set`, or the bridge's CLI). */
  SettingsUpdated: 'stream/settings/updated',
  /** A client connected or disconnected. */
  PresenceUpdated: 'stream/presence/updated',
  /** A phone was paired, named, described or removed. */
  DevicesUpdated: 'stream/devices/updated',
  /** An agent became available or unavailable (installed, removed). */
  AgentsUpdated: 'stream/agents/updated',
  /**
   * The bridge's own update changed: a newer version was published, or an
   * update started or failed. The whole state, as `bridge/status` → `update`
   * would answer now (idempotent).
   */
  BridgeUpdated: 'stream/bridge/updated',
  /** The relay's state changed (set up, connected, dropped, removed). */
  RelayUpdated: 'stream/relay/updated',
  /**
   * A session's hold changed: a desktop terminal took it, its agent started or
   * stopped working, or the terminal let it go (`hold` absent).
   */
  AgentSessionHeld: 'stream/agent/held',
  /**
   * Someone asked the holding desktop to let a session go (sent to that
   * desktop only); it answers with `agent/handoffAnswer`.
   */
  AgentSessionHandoffRequested: 'stream/agent/handoffRequested',
} as const;

export type StreamNotification = (typeof StreamNotification)[keyof typeof StreamNotification];

export interface TurnStartedParams {
  threadId: string;
  turnId: string;
}

export interface MessageDeltaParams {
  threadId: string;
  turnId: string;
  messageId: string;
  delta: string;
}

/**
 * A chunk of the agent's reasoning ("thinking") for a turn. It carries no
 * index: every receiver places it by the one rule the bridge stores it by
 * (`appendThinkingSegment`, `models/history.ts`) — the chunk extends the last
 * segment of the turn's assistant message when that segment is a thought
 * (`{ type:'thinking', text }`), and otherwise opens a new thought at the END
 * of `segments`, never before an open text run. A text delta after it opens a
 * new text run, and a block after it lands after it — at the `index` its
 * `stream/content/block` names, which already counts the thought. Notified in
 * arrival order with the text and blocks around it, so a client applying the
 * rule builds the `segments` the bridge stores.
 */
export interface ThinkingDeltaParams {
  threadId: string;
  turnId: string;
  messageId: string;
  delta: string;
}

/**
 * A block (a serialized MessageContent: `command_execution`, `diff`, `tool`,
 * a plan, an approval, a view, …) the agent produced during a turn, as the
 * bridge stored it — `index` says where. A step (`command_execution`, `diff`,
 * `tool`) arrives as its {@link StepPreview}, bounded exactly as pages bound
 * it, so a turn with thousands of steps streams no more than its previews;
 * the whole step is `turn/step { index }`. Any other block arrives as stored.
 * A thought never arrives here: it streams as `stream/thinking/delta`.
 * A block with the `blockId` of one already shown replaces it in place (the
 * same `index`).
 */
export interface ContentBlockParams {
  threadId: string;
  turnId: string;
  messageId: string;
  /** A {@link StepPreview} for a step; any other block as stored. */
  content: unknown;
  /**
   * Its index in the stored `segments` of the turn's assistant message — the
   * address `turn/steps` and `turn/step` take, and the `from`/`to` a page's
   * `work` run reports.
   */
  index: number;
  /**
   * `true` when the block arrived from a **parallel/background** activity (e.g.
   * a Claude Code subagent's tool run) while the assistant's main text was
   * still streaming. The client must then insert the block BEFORE the
   * currently-open text run instead of appending it after — appending would
   * sever the run and render the sentence split mid-word by an activity card.
   * Absent/false for the sequential case (the block lands at a real text-run
   * boundary and is appended in arrival order). Mirrors how the bridge itself
   * orders the block inside the persisted `Message.segments`, so the live view
   * and a later `turn/list` re-sync render the identical interleave.
   */
  beforeText?: boolean;
}

/**
 * Token usage for a completed turn, as reported by the agent's CLI.
 * `tokens` is the context the conversation now occupies (≈ the latest turn's
 * input + the output it produced). `contextWindow` is the model's limit when
 * known (Claude tiers); omitted when the CLI doesn't expose it (Codex), in
 * which case the phone shows the raw token count instead of a percentage.
 */
export interface TurnUsage {
  tokens: number;
  contextWindow?: number;
}

export interface TurnCompletedParams {
  threadId: string;
  turnId: string;
  messageId: string;
  text: string;
  /** Token usage for this turn, when the agent reported it. */
  usage?: TurnUsage;
  /**
   * The turn the agent's run went on in ({@link Turn.continuedIn}): this one
   * ended because a message reached the agent mid-answer, not because it was
   * done. Its `turn/started` follows at once.
   */
  continuedIn?: string;
}

export interface TurnErrorParams {
  threadId: string;
  turnId: string;
  error: { code: number; message: string };
}

export interface TurnAbortedParams {
  threadId: string;
  turnId: string;
}

/**
 * A queued turn was removed before it ever started (its status is now
 * `cancelled`). The turn is NOT deleted — the user's message stays in the
 * thread, marked as cancelled, so the history shows what was asked and dropped.
 */
export interface TurnCancelledParams {
  threadId: string;
  turnId: string;
}

/**
 * The thread's message queue changed. Carries the WHOLE state rather than a
 * delta, so it is idempotent: a client that missed one (backgrounded, mid-
 * reconnect) converges on the next one it receives instead of drifting.
 *
 * A client that sees an id it does not know about yet (another device queued
 * it) resyncs the thread the same way it does for any unknown turn.
 */
export interface QueueUpdatedParams {
  threadId: string;
  /** Queued turn ids in drain order; empty when the queue just emptied. */
  queuedTurnIds: string[];
  /** True while draining is held after a stop/failure (see `TurnList.queuePaused`). */
  paused: boolean;
  /** Why it is held; absent when it is not paused. */
  pausedReason?: QueuePausedReason;
  /** The queued turn being handed to the running agent (see `QueueStateResult.deliveringTurnId`). */
  deliveringTurnId?: string;
}

export interface ModelResolvedParams {
  threadId: string;
  turnId: string;
  /** Concrete model id the agent resolved for this turn (e.g. `claude-opus-4-8`). */
  model: string;
}

/**
 * A thread was created or its stored metadata changed, on the bridge. Emitted
 * by `thread/start`, `thread/fork`, `thread/rename`, `thread/setModel`,
 * `thread/setAccessMode`, `thread/archive`, `thread/unarchive`, and when a
 * generated title replaces the provisional one. The whole thread travels, so a
 * client upserts it and converges without refetching the list — including on
 * a thread another client just started.
 *
 * `thread.titleSource` says how much to trust the title: `user` is final,
 * `agent` is the generated name, `prompt` the weak fallback. The bridge never
 * lets an `agent` title overwrite a `user` one; the field lets a client reason
 * about it too.
 */
export interface ThreadUpdatedParams {
  thread: Thread;
}

/** A thread was deleted on the bridge (by any client). */
export interface ThreadDeletedParams {
  threadId: string;
  /** Sync revision of the deletion (see `SyncChanges`). */
  rev?: number;
}

/**
 * `stream/history/changed` — the turns stored for [threadId] changed outside a
 * live turn, because the bridge merged what the agent's own transcript holds
 * (architecture/02a §5.8.8). It says only that: a client showing the
 * conversation re-reads its newest page; one that does not show it ignores it.
 */
export interface HistoryChangedParams {
  threadId: string;
  /**
   * The thread's sync revision after the merge — the same `thread.rev` the
   * `stream/thread/updated` sent just before carries. A client that already
   * re-read the conversation at this revision or later can skip it.
   */
  rev: number;
}

/**
 * A project was registered or changed. Like `stream/thread/updated`, the whole
 * entry travels (idempotent upsert) and `project.rev` is its sync revision: a
 * client that sees a revision that is not the one after its last runs
 * `sync/changes`.
 */
export interface ProjectUpdatedParams {
  project: Project;
}

/** A project left the registry. Its conversations are untouched. */
export interface ProjectRemovedParams {
  projectId: string;
  rev: number;
}

export interface SettingsUpdatedParams {
  settings: BridgeSettings;
  rev: number;
}

/** The whole list of connected clients (idempotent; not revisioned). */
export interface PresenceUpdatedParams {
  clients: ClientPresence[];
}

/** Every paired phone, as it stands now (idempotent; not revisioned). */
export interface DevicesUpdatedParams {
  devices: TrustedDevice[];
}

/** The whole agent list, as `agent/list` would answer now. */
export interface AgentsUpdatedParams {
  agents: AgentDescriptor[];
}

/** The bridge's update, as `bridge/status` → `update` would answer now. */
export interface BridgeUpdatedParams {
  update: BridgeUpdate;
}

/**
 * A user turn was stored: it started right away (`status` `pending`) or it was
 * queued behind the running one (`queued`). `turn.messages` holds the user's
 * message (and the assistant's still-empty placeholder), so every client can
 * place the prompt in the timeline **before** the answer streams — including
 * a prompt typed on another client.
 *
 * `clientTurnId` echoes `TurnSendParams.clientTurnId` from the client that sent
 * it, so that client can match the notification to the optimistic bubble it
 * already shows instead of drawing the message twice. It may arrive before the
 * `turn/send` reply does.
 */
export interface TurnCreatedParams {
  threadId: string;
  turn: Turn;
  clientTurnId?: string;
}

/**
 * A pending approval is no longer pending. `decision` is what the agent got:
 * the answer a client sent, or `reject` when it timed out (`timedOut: true`).
 * Every client retires its card for `approvalId` — the one that answered and
 * any other showing the same request.
 */
export interface ApprovalResolvedParams {
  threadId: string;
  approvalId: string;
  decision: ApprovalDecision;
  timedOut?: boolean;
}

/**
 * A pending question is no longer pending: answered on some client, skipped
 * (empty answers), or timed out (`timedOut: true`). Every client retires its
 * card for `questionId`.
 */
export interface QuestionResolvedParams {
  threadId: string;
  questionId: string;
  /** True when no option was chosen (skipped, or timed out). */
  skipped: boolean;
  /**
   * The chosen option labels, one list per question in order — what the agent
   * received — so a client that did not answer can still show the choice.
   */
  answers: string[][];
  timedOut?: boolean;
}
