/**
 * Conversation models: Thread, Turn, Message.
 *
 * The Dart equivalents live in `uxnanmobile/lib/domain/entities/{thread,turn,message}.dart`
 * and are kept in sync manually (see 02e-bridge-integration.md §4.2).
 */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Lifecycle of a turn.
 * - `queued` — accepted while another turn was in flight; it holds its place in
 *   the thread's queue and starts on its own once the queue drains to it. The
 *   user message is already stored, the assistant one is still empty.
 * - `pending` / `streaming` — the agent is producing it.
 * - `completed` / `error` — it ran and ended.
 * - `aborted` — it was RUNNING and the user stopped it mid-flight.
 * - `cancelled` — it was QUEUED and removed before it ever started. Kept in the
 *   thread (never deleted) so the user's message stays visible with a "cancelled"
 *   mark instead of silently vanishing; distinct from `aborted` precisely so a
 *   client can tell "never ran" from "interrupted".
 *
 * A queued turn the agent takes **into the turn already running** (see
 * `AgentCapabilities.steering`) goes straight to `streaming`: the running turn
 * completes there and this one carries the rest of the agent's run, so what the
 * agent says after taking the message is shown under it.
 */
export type TurnStatus =
  | 'queued'
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'aborted'
  | 'cancelled';

export type ThreadStatus = 'active' | 'idle' | 'archived';

/**
 * Why a thread's message queue is held instead of draining:
 * - `turnAborted` — the user stopped the running turn.
 * - `turnError` — the running turn failed.
 *
 * In both cases the remaining queued turns are kept, not discarded: the user
 * stopped (or the agent broke) for a reason, and firing the follow-ups at it
 * anyway is the one outcome nobody wants. Draining resumes on `queue/resume`.
 */
export type QueuePausedReason = 'turnAborted' | 'turnError';

export interface Message {
  id: string;
  turnId: string;
  role: MessageRole;
  /** The message's full text: for an assistant message, its text runs concatenated. */
  content: unknown;
  /**
   * The assistant message's text runs, reasoning and blocks **in the exact
   * order the agent produced them** — text runs as `{ type:'text', text }`,
   * each stretch of reasoning as a `ThinkingSegment` (`{ type:'thinking',
   * text }`, see `models/history.ts`), every other block as its own type.
   * Always present on an assistant message (empty while it has said
   * nothing), never on any other. The text runs concatenate to `content`.
   *
   * As the bridge STORES it, a step (`command_execution`, `diff`, `tool`,
   * `thinking`) is one entry here, and its index is how a client addresses
   * it. As a page
   * (`turn/list`, `turn/read`, `stream/turn/created`) SERVES it, every run of
   * consecutive steps is one `WorkRunSegment` (`type: 'work'`, see
   * `models/history.ts`) carrying its stored index range, counts, changed
   * files and a preview of its last step; the steps themselves come from
   * `turn/steps` (previews) and `turn/step` (one, whole — a thought's full
   * text too). Everything else is
   * served as stored.
   */
  segments?: unknown[];
  /** Token usage for this turn, so the phone restores the context meter on re-sync. */
  usage?: { tokens: number; contextWindow?: number };
  /**
   * The images and files the user attached to this message, kept by the bridge
   * with the turn (user messages only). They are named here, not inlined — a page of
   * history stays small — and each client fetches the bytes it shows with
   * `turn/attachment`.
   */
  attachments?: MessageAttachment[];
  createdAt: number;
}

/** An image or a file attached to a user message, as `turn/list` names it. */
export interface MessageAttachment {
  /** Opaque id, unique in its thread; the key for `turn/attachment`. */
  id: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Size of the stored image or file in bytes. */
  bytes: number;
  /** A file's name, as it was sent (absent for an image). */
  name?: string;
  /** Pixel width, when the sender knew it. */
  width?: number;
  /** Pixel height, when the sender knew it. */
  height?: number;
}

/**
 * One exchange: at most one user message (absent when the agent spoke on its
 * own) and ONE assistant message, whose `segments` carry its prose and steps
 * in order. Every turn the bridge serves has this shape, including turns read
 * from an agent's own transcript.
 */
export interface Turn {
  id: string;
  threadId: string;
  /**
   * The turn's position in its thread (1-based, assigned by the bridge when the
   * turn is stored, never reused). Clients order a conversation by it — never by
   * the order notifications happened to arrive — so a turn a client missed and
   * fetched later still lands in its place. Absent on an older bridge.
   */
  seq?: number;
  status: TurnStatus;
  messages: Message[];
  createdAt: number;
  completedAt?: number;
  /**
   * The later turn this one's agent run went on in. Set when a message reached
   * the agent while it was still answering here (a mid-turn delivery,
   * `AgentCapabilities.steering`): this turn ends where the message arrived —
   * what it holds is the answer so far, not a closing one — and everything the
   * agent did after it is that turn's. Absent otherwise, and on an older bridge.
   */
  continuedIn?: string;
}

/**
 * Per-thread access mode: how much the agent may do before it must pause for
 * the user. Persisted on the bridge so a choice made on any device survives a
 * restart and is the source of truth across devices. Each mode means the same
 * on every agent; an agent offers only the modes it can honor
 * (`AgentCapabilities.accessModes`), and the bridge runs a stored mode the
 * agent does not offer as that agent's `defaultAccessMode`.
 * - `requestApproval` — every action with a side effect (writing, running a
 *   command, the network, a path outside the project) waits for the person.
 * - `approveForMe` — the agent works without asking inside the project; what
 *   goes beyond it is decided by the CLI's own reviewer where it has one.
 * - `fullAccess` — no prompts and no sandbox: the CLI's own bypass.
 * - `plan` — the agent reads and plans; it writes and runs nothing.
 */
export type AccessMode = 'requestApproval' | 'approveForMe' | 'fullAccess' | 'plan';

/** Every {@link AccessMode}, in the order the apps list them. */
export const ACCESS_MODES: readonly AccessMode[] = [
  'requestApproval',
  'approveForMe',
  'fullAccess',
  'plan',
];

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  turnCount: number;
  createdAt: number;
  /**
   * When the conversation last MOVED (epoch ms): a turn started, stored or
   * ended, its history re-read, its title or status decided. Every client
   * sorts and dates its rows by it. A setting — `model`, `accessMode`,
   * `agentSessionId` — does not move it: it reaches clients as a change of its
   * own (`rev`) but never reorders a list.
   */
  updatedAt: number;
  /** Agent driving this thread (e.g. `opencode`, `echo`). */
  agentId?: string;
  /** Model the agent uses for this thread (e.g. `provider/model`). */
  model?: string;
  /** Absolute working directory the agent and git operations run in. */
  cwd?: string;
  /**
   * The agent CLI's NATIVE session id (Claude `session_id`, Codex `thread_id`,
   * OpenCode `sessionID`, pi session id), when known. Surfaced so the phone can
   * show "resume this conversation from the CLI" beyond the bridge thread id.
   */
  agentSessionId?: string;
  /** Per-thread access (approval) mode; see {@link AccessMode}. */
  accessMode?: AccessMode;
  /**
   * Live, never persisted: the turn running on this thread right now, set by
   * the bridge on `thread/list` and `thread/read` responses (the same value as
   * `TurnList.activeTurnId`). Lets a client that just connected show which
   * conversations are working without reading each one's turns. Absent when
   * nothing runs.
   */
  activeTurnId?: string;
  /**
   * Where {@link title} came from, so a better title can replace a weaker one
   * without ever overwriting a name the **user** chose.
   *
   * - `prompt` — provisional, derived from the opening message. Instant, and
   *   the weakest: two conversations that start with the same phrase collide.
   * - `agent` — written by a model that read the first exchange. Replaces
   *   `prompt`, never `user`.
   * - `user` — renamed by hand (`thread/rename`). Final; nothing overwrites it.
   *
   * Absent on threads stored before this existed; treat that as `prompt`, which
   * is what they are.
   */
  titleSource?: ThreadTitleSource;
  /** Which client started the conversation, when known. */
  origin?: ThreadOrigin;
  /**
   * The conversation this one continues, and what was carried over
   * (`thread/transfer`, `thread/fork`, `thread/start { continueFrom }`).
   * Absent on a conversation that started from nothing.
   */
  transfer?: ConversationTransfer;
  /**
   * The conversations that continue this one (newest last) — the other end of
   * {@link transfer}, so both conversations tell the same story. Absent when
   * none does.
   */
  continuations?: ThreadContinuation[];
  /** Sync revision of the thread's last change (see `SyncChanges`). */
  rev?: number;
}

/**
 * How a conversation's context reaches the agent of the conversation that
 * continues it (architecture/02a §5.8.21). No agent can continue another CLI's
 * native session, so a continuation is always a NEW conversation, and its
 * first message carries what the bridge — the owner of the history — selected:
 *
 * - `selection` — a deterministic, budgeted selection of the source: the
 *   opening request, the newest exchanges whole and older ones shortened,
 *   until {@link TRANSFER_CONTEXT_MAX_BYTES}; the files it changed. The default.
 * - `reference` — only a pointer: the source's title, its opening request and
 *   its last exchange, shortened. For when the new agent should start fresh.
 * - `fork` — the source's whole history is copied into the new conversation
 *   (what the person sees), and its agent gets a `selection` (what it knows).
 */
export type TransferStrategy = 'selection' | 'reference' | 'fork';

/** Every {@link TransferStrategy}, in the order the apps offer them. */
export const TRANSFER_STRATEGIES: readonly TransferStrategy[] = ['selection', 'reference', 'fork'];

/** Most bytes of carried-over context a continuation's first message holds. */
export const TRANSFER_CONTEXT_MAX_BYTES = 64_000;

/** Longest a shortened piece of a selection is (a message, a prompt), in characters. */
export const TRANSFER_PIECE_MAX_CHARS = 240;

/**
 * Where the carried-over context stands — proven against the real turn, never
 * assumed:
 * - `pending` — prepared, waiting for the conversation's first message.
 * - `sent` — went to the agent with {@link ConversationTransfer.turnId}; the
 *   turn has not ended yet.
 * - `delivered` — that turn ended with the agent answering: it has the context.
 * - `unverifiable` — the bridge stopped while that turn ran, so whether the
 *   agent read it cannot be proven; the next message carries it again.
 *
 * A turn that failed or was stopped before the agent answered puts it back to
 * `pending`: the next message carries it.
 */
export type TransferStatus = 'pending' | 'sent' | 'delivered' | 'unverifiable';

/** What a continuation carried over, measured as the bridge prepared it. */
export interface TransferContextSummary {
  /** Turns of the source the context includes (whole or shortened). */
  turns: number;
  /** Turns of the source it leaves out (the oldest). */
  omittedTurns: number;
  /** Size of the context, in bytes (UTF-8). */
  bytes: number;
  /** Rough token count of the context (`bytes / 4`, rounded up). */
  approxTokens: number;
}

/** The origin of a conversation that continues another one (`Thread.transfer`). */
export interface ConversationTransfer {
  /** Stable id of this continuation. */
  id: string;
  strategy: TransferStrategy;
  /** The conversation it continues (it may since have been deleted). */
  sourceThreadId: string;
  /** The source's title when it was continued. */
  sourceTitle: string;
  /** The source's agent, when it had one. */
  sourceAgentId?: string;
  /** `agent` when an agent asked for it through the desktop's control surface. */
  createdBy: 'user' | 'agent';
  status: TransferStatus;
  /** The turn that carried the context, once one did. */
  turnId?: string;
  context: TransferContextSummary;
}

/** A conversation that continues this one (`Thread.continuations`). */
export interface ThreadContinuation {
  threadId: string;
  /** The continuation's {@link ConversationTransfer.id}. */
  transferId: string;
  /** The agent it continues with. */
  agentId?: string;
  strategy: TransferStrategy;
}

/** Where a conversation was started. */
export interface ThreadOrigin {
  kind: 'phone' | 'desktop';
  /** The device's or machine's name. */
  name: string;
}

/** Where a thread's title came from. See {@link Thread.titleSource}. */
export type ThreadTitleSource = 'prompt' | 'agent' | 'user';

export interface ThreadList {
  threads: Thread[];
}

/**
 * One page of a thread's turns, oldest first, each as a page serves it
 * (`summarizeTurn`: steps, thoughts included, folded into `work` runs).
 *
 * The page is the window the request names — `[cursor, cursor + limit)`, or
 * the last `limit` turns with `fromEnd` — trimmed to fit
 * `TURN_PAGE_MAX_BYTES` of serialized turns: the NEWEST turns of the window
 * that fit are served (always at least the newest one), so the page always
 * ends where the window ends and may start later than it began. `offset` says
 * where it starts.
 */
export interface TurnList {
  turns: Turn[];
  /**
   * Position (0-based) of the first returned turn in the thread. When the byte
   * budget trimmed the window this is past the requested start: the turns
   * before it are still unread, and a client paging backward asks for the
   * window that ends here.
   */
  offset?: number;
  /**
   * Where the next page forward starts — the position right after the last
   * returned turn — when turns follow it. The budget never moves it: it trims
   * the start of a window, never its end.
   */
  nextCursor?: string;
  /**
   * Total number of turns available for the thread, regardless of the page
   * returned. Lets a client page from the end (newest-first) by computing
   * offsets without first pulling the whole thread.
   */
  total?: number;
  /**
   * The turn currently in-flight for this thread (an agent is actively
   * producing it RIGHT NOW in the bridge process), when one exists. This is the
   * LIVE AgentManager state, NOT a stored turn's `streaming` status — the latter
   * can be left dangling after a bridge restart (the agent child process died),
   * whereas this is cleared the moment the turn completes/errors/aborts and is
   * absent after a restart. The phone uses it on resync/reconnect to re-attach
   * its streaming view (the "responding…" indicator + Stop button) to a turn it
   * stopped tracking while backgrounded, instead of treating the turn as ended.
   */
  activeTurnId?: string;
  /**
   * The thread's queued turns (status `queued`), in the order they will run.
   * Like {@link activeTurnId} this is LIVE bridge state the phone re-attaches to
   * on resync — a client restores its "queued" bubbles from it without having to
   * scan the returned page (the queue may sit outside a narrow `turn/list` page).
   * Absent/empty when nothing is queued.
   */
  queuedTurnIds?: string[];
  /**
   * True when the queue is HELD: the previous turn was stopped by the user or
   * failed, so the bridge stopped draining and is waiting for an explicit
   * `queue/resume` (or `queue/clear`). Queued turns stay queued meanwhile.
   */
  queuePaused?: boolean;
  /** Why the queue is held; absent when it is not paused. */
  queuePausedReason?: QueuePausedReason;
  /** The queued turn being handed to the running agent (see `QueueStateResult.deliveringTurnId`). */
  queueDeliveringTurnId?: string;
}

/**
 * `thread/search`: the conversations whose words match [query] — their titles
 * and what was said in them (the person's messages and the agents' replies;
 * not the commands, outputs and edits of their steps). Answered by the bridge,
 * the owner of the history, from a small text digest it keeps beside each
 * conversation, so a search never reads a conversation's turns
 * (architecture/02a §5.8.21).
 *
 * Matching folds case and accents, and every word of the query must appear in
 * the same message. Conversations are searched newest first; each answer
 * covers at most {@link THREAD_SEARCH_MAX_HITS} matching conversations and
 * stops early when its time budget runs out — `nextCursor` continues where it
 * stopped.
 */
export interface ThreadSearchParams {
  /** What to look for; at least {@link THREAD_SEARCH_MIN_QUERY_CHARS} characters. */
  query: string;
  /** Only this project's conversations. */
  projectId?: string;
  /** Include archived conversations (default: false). */
  includeArchived?: boolean;
  /** Most matching conversations to return (default and ceiling {@link THREAD_SEARCH_MAX_HITS}). */
  limit?: number;
  /** The `nextCursor` of the previous answer. */
  cursor?: string;
}

/** Shortest query `thread/search` answers. */
export const THREAD_SEARCH_MIN_QUERY_CHARS = 2;

/** Most conversations one `thread/search` answer holds. */
export const THREAD_SEARCH_MAX_HITS = 50;

/** Most matching messages one hit names. */
export const THREAD_SEARCH_MAX_MATCHES = 3;

/** One message of a conversation that matched, with the words around it. */
export interface ThreadSearchMatch {
  turnId: string;
  /** The turn's position in its conversation (`Turn.seq`). */
  seq?: number;
  role: 'user' | 'assistant';
  /** The text around the match, on one line (at most ~160 characters). */
  snippet: string;
  /** Where the first matched word starts in [snippet] (UTF-16 offset). */
  matchStart: number;
  /** How long it is there. */
  matchLength: number;
}

/** A conversation that matched. */
export interface ThreadSearchHit {
  threadId: string;
  /** Whether its title matched. */
  titleMatch: boolean;
  /** Its matching messages, newest first (at most {@link THREAD_SEARCH_MAX_MATCHES}). */
  matches: ThreadSearchMatch[];
  /** How many of its messages matched in all. */
  matchCount: number;
}

export interface ThreadSearchResult {
  hits: ThreadSearchHit[];
  /** Continue here for more; absent when every conversation was searched. */
  nextCursor?: string;
  /** Conversations this answer searched. */
  searched: number;
  /** Conversations the search covers in all (the scope's, archived or not as asked). */
  total: number;
}
