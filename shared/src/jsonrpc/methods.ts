/**
 * Typed registry of all JSON-RPC methods the mobile app can invoke and the
 * bridge must implement.
 *
 * Source: architecture/02b-contracts-and-requirements.md and
 * uxnandesktop/architecture/02e-bridge-integration.md §4.4.
 */
import type {
  AccessMode,
  QueuePausedReason,
  Thread,
  ThreadList,
  Turn,
  TurnList,
} from '../models/thread.js';
import type {
  GitBranchList,
  GitBranchResult,
  GitCommitDetails,
  GitCommitResult,
  GitCommitShowParams,
  GitDiff,
  GitLogParams,
  GitLogResult,
  GitPrResult,
  GitPullResult,
  GitPushResult,
  GitRepoStatus,
  GitWorktreeList,
  GitWorktreeResult,
} from '../models/git.js';
import type {
  ApplyResult,
  BrowseResult,
  Checkpoint,
  CheckpointDiff,
  FileContent,
  ImageContent,
  PatchChange,
  TurnAttachment,
  WorkspaceFileTarget,
  WorkspaceExistsResult,
  WorkspaceListing,
  SearchFilesParams,
  WorkspaceSearchResult,
} from '../models/workspace.js';
import type { AuthStatus, Project } from '../models/project.js';
import type { ApprovalResponse } from '../models/approval.js';
import type { QuestionResponse } from '../models/question.js';
import type { BridgeStatus, ConnectedPhone, TrustedDevice } from '../models/session.js';
import type { PairingPayload } from '../e2ee/pairing-payload.js';
import type {
  AgentCommand,
  AgentCommandInvocation,
  AgentDescriptor,
  AgentId,
  AgentModel,
} from '../agents/agent-capabilities.js';
import type { UsageStatsParams, UsageStatsResult } from '../models/usage.js';
import type {
  MetricsExportParams,
  MetricsExportResult,
  MetricsImportParams,
  MetricsImportResult,
  MetricsSnapshot,
} from '../models/metrics.js';
import type { PushPlatform } from '../notifications/push-payload.js';

// --- Param shapes -----------------------------------------------------------

export interface ListThreadsParams {
  projectId?: string;
}
export interface StartThreadParams {
  projectId: string;
  title?: string;
  /** Agent to drive the thread (defaults to the bridge's configured default). */
  agentId?: AgentId;
  /** Model the agent should use (e.g. `provider/model`). */
  model?: string;
  /** Working directory override; defaults to the project's cwd. */
  cwd?: string;
}
export interface ForkParams {
  threadId: string;
  newBranch?: string;
}
export interface TurnListParams {
  threadId: string;
  cursor?: string;
  limit?: number;
  /**
   * When true, return the newest `limit` turns (the last page) regardless of
   * `cursor`. Lets a client open a long thread at its most recent messages and
   * page backward from there using `total`.
   */
  fromEnd?: boolean;
}
export interface TurnSendParams {
  threadId: string;
  /**
   * User prompt text. Optional when `attachments` (an image-only message) is
   * present; otherwise required and non-empty. The bridge rejects a turn with
   * neither text nor attachments.
   */
  text?: string;
  service?: string;
  /**
   * Legacy flat reasoning-effort field. Still honored; new clients should send
   * the value under `options` (keyed by the advertised knob, e.g. `reasoning`).
   */
  effort?: string;
  /**
   * Chosen per-model run-option values, keyed by `AgentModelOption.key` (the
   * knobs advertised on the thread's model via `agent/models`). The bridge maps
   * each into the agent CLI's real flag; unknown keys are ignored.
   */
  options?: Record<string, string | boolean>;
  /**
   * Inline image attachments for this turn. The bridge materializes each to a
   * temp file and references it in the prompt so any file/vision-capable agent
   * CLI can open it. An image-only message (empty `text`) is allowed.
   */
  attachments?: TurnAttachment[];
  /**
   * Reply to a pending approval the agent requested (no new turn is created).
   * The bridge routes the decision to the agent adapter. When present, `text`
   * is not required.
   */
  approvalResponse?: ApprovalResponse;
  /**
   * Reply to a pending question the agent asked (no new turn is created). The
   * bridge routes the chosen answers to the agent adapter. When present, `text`
   * is not required.
   */
  questionResponse?: QuestionResponse;
  /**
   * Invoke an advertised agent command (from `agent/commands`) instead of
   * free-form `text`. The bridge resolves `{ name, args }` to the final prompt —
   * expanding a custom prompt-template file, or composing the CLI's native
   * `/name args` form — then runs a normal turn. When present, `text` is not
   * required.
   */
  command?: AgentCommandInvocation;
  /**
   * What to do when a turn is ALREADY in flight on this thread (the CLIs' own
   * "queue a follow-up while it works" behaviour):
   * - `true` — queue it explicitly; it starts when the queue drains to it.
   * - `false` — reject with `AgentBusy` instead of queueing (a client that
   *   wants to handle the busy case itself).
   * - absent — **queue it anyway**. Queueing is the safe default because the
   *   bridge can only drive ONE turn per thread: half the agents run one-shot
   *   per turn (`claude -p --resume`, pi, antigravity) and a second
   *   concurrent turn would put two CLI processes on the same session.
   *
   * Ignored when no turn is in flight — the turn simply starts.
   */
  queue?: boolean;
}
export interface ThreadSetModelParams {
  threadId: string;
  model: string;
}
export interface ThreadRenameParams {
  threadId: string;
  /** New, non-empty title for the thread. */
  title: string;
  /**
   * Who is naming it. **Absent means the user did** — the safe default, since
   * `thread/rename` is the hand-rename call and a name the user chose is final.
   *
   * A client that auto-names a new thread from its opening message MUST send
   * `'prompt'`; otherwise its throwaway title is recorded as the user's choice
   * and the real generated title is refused later. `'agent'` is not accepted
   * here — the bridge writes those itself when it generates one.
   */
  source?: 'prompt' | 'user';
}
export interface ThreadSetAccessModeParams {
  threadId: string;
  /** The per-thread access (approval) mode to persist. */
  mode: AccessMode;
}
export interface TurnSendResult {
  turnId: string;
  /**
   * True when the turn was QUEUED behind an in-flight one instead of starting
   * now. The `turnId` is real either way (the turn is stored, and `turn/cancel`
   * takes it off the queue); it just has status `queued` until it runs.
   */
  queued?: boolean;
  /** 1-based place in the queue when `queued` is true (1 = runs next). */
  queuePosition?: number;
  /**
   * True when the agent took the message **into the turn already running**
   * rather than making it wait (status `delivered`, see `TurnStatus`). It will
   * never run as a turn of its own — the reply belongs to the turn it joined —
   * so the client renders the user's message in place and stops offering to
   * edit or cancel it. Mutually exclusive with {@link queued}.
   *
   * Only ever true when the agent advertises `AgentCapabilities.steering`; on
   * every other agent a follow-up still comes back `queued`.
   */
  delivered?: boolean;
}

export interface QueueStateResult {
  /** Queued turn ids in drain order. */
  queuedTurnIds: string[];
  /** True while draining is held after a stop/failure. */
  paused: boolean;
  /** Why it is held; absent when it is not paused. */
  pausedReason?: QueuePausedReason;
}

export interface GitCommitParams {
  cwd: string;
  message: string;
  /**
   * Repository-relative paths to stage before committing. When omitted or
   * empty the whole working tree is staged (`git add -A`), preserving the
   * previous behaviour. Any co-author trailer is already part of `message`.
   */
  paths?: string[];
}

export interface GitPathsParams {
  cwd: string;
  /** Repository-relative paths to act on. */
  paths: string[];
}

export interface GitDiffParams {
  cwd: string;
  /** When set, returns the diff for this single file (handles untracked). */
  path?: string;
}

export interface GitPrParams {
  cwd: string;
  title: string;
  body?: string;
  /** Base branch for the PR (defaults to the host's default branch). */
  base?: string;
  /**
   * Head branch the PR is opened from (defaults to the current branch). The
   * bridge pushes it to the remote before opening the PR.
   */
  head?: string;
}
export interface GitPushParams {
  cwd: string;
  remote: string;
  branch: string;
}
export interface GitPullParams {
  cwd: string;
  remote?: string;
  branch?: string;
}
export interface GitCheckoutParams {
  cwd: string;
  branch: string;
}

export interface GitSwitchBranchParams {
  cwd: string;
  /** The branch to switch to. */
  target: string;
  /**
   * When true the working-tree changes follow you to the target; when false
   * they stay on the current branch (stashed, restored on return).
   */
  carryChanges: boolean;
}
export interface GitBranchParams {
  cwd: string;
  name: string;
}
export interface GitWorktreeParams {
  cwd: string;
  branch: string;
  /**
   * Absolute directory for the new worktree. **Optional**: omit it (with
   * {@link managed}) and the bridge resolves the location itself, from its
   * `worktrees` config — by default the managed root
   * `<home>/uxnan/worktrees/<repo>/<branch>`, the same layout the desktop uses,
   * so both apps group one repository's checkouts in one place.
   *
   * A bridge that does not advertise `features.managedWorktrees` still
   * **requires** this, so a client that wants to work against an older bridge
   * has to keep deriving a path as its fallback.
   */
  path?: string;
  /**
   * Let the bridge own the location (the default when {@link path} is absent).
   * A managed worktree is recorded in the bridge's registry, so the ones uxnan
   * created can be told from the ones that were already there.
   */
  managed?: boolean;
}
export interface GitRevertParams {
  cwd: string;
  /** Commit-ish to revert (e.g. `HEAD`, a sha). Creates a new revert commit. */
  commit: string;
}
export interface GitDeleteBranchParams {
  cwd: string;
  branch: string;
  /**
   * When false, git refuses to delete a branch not fully merged (`-d`); true
   * forces it (`-D`). The phone should retry with `force: true` only after an
   * explicit user confirmation.
   */
  force: boolean;
}
export interface GitRemoveWorktreeParams {
  cwd: string;
  /** The worktree's path to remove. */
  path: string;
  /**
   * When false, git refuses to remove a worktree with uncommitted/untracked
   * changes; true forces it. Confirm with the user before forcing.
   */
  force: boolean;
}
export interface WorkspaceExistsParams {
  /** Absolute directory to probe (a thread's `cwd`). */
  cwd: string;
}

export interface BrowseDirsParams {
  /** Which configured root to browse (defaults to the first when omitted). */
  rootId?: string;
  /** Path relative to the root (`''` or omitted = the root itself). */
  path?: string;
}

export interface CheckpointParams {
  cwd: string;
  threadId?: string;
  label?: string;
}
export interface PatchParams {
  cwd: string;
  changes: PatchChange[];
}

export interface AgentListResult {
  agents: AgentDescriptor[];
}

export interface AgentModelsParams {
  agentId: AgentId;
}
export interface AgentModelsResult {
  /** Models the agent can use, with presentation metadata, as reported by its CLI. */
  models: AgentModel[];
}

export interface AgentCommandsParams {
  agentId: AgentId;
  /**
   * Thread/project directory, so project-scoped custom commands (e.g.
   * `<cwd>/.claude/commands`, `<cwd>/.opencode/command`) are discovered alongside
   * the user-level ones. Omitted → only user-level commands are returned.
   */
  cwd?: string;
}
export interface AgentCommandsResult {
  /** Special ("slash") commands the agent exposes, discovered from its CLI/disk. */
  commands: AgentCommand[];
}

/** What the phone wants to be notified about (background push). */
export interface NotificationPreferences {
  /** Push when an agent turn completes. */
  turnCompleted: boolean;
  /** Push when an agent turn errors. */
  turnError: boolean;
}

export interface RegisterNotificationsParams {
  /** FCM (Android) or APNs (iOS) device token. */
  pushToken: string;
  platform: PushPlatform;
  preferences?: NotificationPreferences;
}
export interface RegisterNotificationsResult {
  /** Whether the bridge accepted (and forwarded to the relay) the token. */
  registered: boolean;
}
export interface UpdateNotificationsParams {
  preferences: NotificationPreferences;
}

/**
 * Maps each method name to its `params` and `result` types. Use with
 * {@link JsonRpcMethodName} for end-to-end type-safety on both peers.
 */
export interface JsonRpcMethodRegistry {
  // Threads & turns
  'thread/list': { params: ListThreadsParams; result: ThreadList };
  'thread/read': { params: { threadId: string }; result: Thread };
  'thread/start': { params: StartThreadParams; result: Thread };
  'thread/resume': { params: { threadId: string }; result: void };
  'thread/fork': { params: ForkParams; result: Thread };
  'thread/setModel': { params: ThreadSetModelParams; result: void };
  'thread/rename': { params: ThreadRenameParams; result: Thread };
  'thread/setAccessMode': { params: ThreadSetAccessModeParams; result: Thread };
  'thread/archive': { params: { threadId: string }; result: Thread };
  'thread/unarchive': { params: { threadId: string }; result: Thread };
  'thread/delete': { params: { threadId: string }; result: void };
  'turn/list': { params: TurnListParams; result: TurnList };
  'turn/read': { params: { turnId: string }; result: Turn };
  'turn/send': { params: TurnSendParams; result: TurnSendResult };
  // Stops a RUNNING turn, or takes a QUEUED one off the queue (→ `cancelled`).
  'turn/cancel': { params: { threadId: string; turnId: string }; result: void };
  // Message queue (follow-ups sent while a turn is in flight)
  /** Resumes draining after a stop/failure held the queue. */
  'queue/resume': { params: { threadId: string }; result: QueueStateResult };
  /** Drops every queued turn (each → `cancelled`) and clears the paused state. */
  'queue/clear': { params: { threadId: string }; result: QueueStateResult };

  // Git
  'git/status': { params: { cwd: string }; result: GitRepoStatus };
  'git/diff': { params: GitDiffParams; result: GitDiff };
  'git/commit': { params: GitCommitParams; result: GitCommitResult };
  'git/push': { params: GitPushParams; result: GitPushResult };
  'git/pull': { params: GitPullParams; result: GitPullResult };
  'git/checkout': { params: GitCheckoutParams; result: void };
  'git/createBranch': { params: GitBranchParams; result: GitBranchResult };
  'git/createWorktree': { params: GitWorktreeParams; result: GitWorktreeResult };
  'git/stage': { params: GitPathsParams; result: void };
  'git/unstage': { params: GitPathsParams; result: void };
  'git/discard': { params: GitPathsParams; result: void };
  'git/createPr': { params: GitPrParams; result: GitPrResult };
  'git/undoCommit': { params: { cwd: string }; result: void };
  'git/branches': { params: { cwd: string }; result: GitBranchList };
  'git/switchBranch': { params: GitSwitchBranchParams; result: void };
  'git/revert': { params: GitRevertParams; result: void };
  'git/deleteBranch': { params: GitDeleteBranchParams; result: void };
  'git/removeWorktree': { params: GitRemoveWorktreeParams; result: void };
  /** Which directories are worktrees of the repository at `cwd`. */
  'git/worktrees': { params: { cwd: string }; result: GitWorktreeList };
  'git/log': { params: GitLogParams; result: GitLogResult };
  'git/commitShow': { params: GitCommitShowParams; result: GitCommitDetails };

  // Workspace
  'workspace/readFile': { params: { cwd: string; path: string }; result: FileContent };
  'workspace/readImage': { params: { cwd: string; path: string }; result: ImageContent };
  'workspace/list': { params: { cwd: string }; result: WorkspaceListing };
  'workspace/searchFiles': { params: SearchFilesParams; result: WorkspaceSearchResult };
  'workspace/resolveFileLink': {
    params: { cwd: string; href: string };
    result: WorkspaceFileTarget;
  };
  'workspace/browseDirs': { params: BrowseDirsParams; result: BrowseResult };
  'workspace/checkpoint': { params: CheckpointParams; result: Checkpoint };
  'workspace/diffCheckpoint': { params: { id: string }; result: CheckpointDiff };
  'workspace/applyCheckpoint': { params: { id: string }; result: void };
  'workspace/applyPatch': { params: PatchParams; result: ApplyResult };
  'workspace/exists': { params: WorkspaceExistsParams; result: WorkspaceExistsResult };

  // Projects
  'project/list': { params: void; result: Project[] };
  'project/resolve': { params: { cwd: string }; result: Project };

  // Agents
  'agent/list': { params: void; result: AgentListResult };
  'agent/models': { params: AgentModelsParams; result: AgentModelsResult };
  // Special ("slash") commands the agent exposes (discovery; invoked via turn/send)
  'agent/commands': { params: AgentCommandsParams; result: AgentCommandsResult };
  // Usage statistics (per-provider quota / credit / local token tally)
  'agent/usageStats': { params: UsageStatsParams; result: UsageStatsResult };

  // Metrics (bridge-owned, survivable profile stats + tamper-proof backup)
  'metrics/get': { params: void; result: MetricsSnapshot };
  'metrics/export': { params: MetricsExportParams; result: MetricsExportResult };
  'metrics/import': { params: MetricsImportParams; result: MetricsImportResult };

  // Auth (sanitized — never carries tokens/keys; see AuthStatus)
  'auth/status': { params: { agentId: AgentId }; result: AuthStatus };
  'auth/login': { params: { provider: string }; result: void };
  'auth/logout': { params: void; result: void };

  // Notifications (push)
  'notifications/register': {
    params: RegisterNotificationsParams;
    result: RegisterNotificationsResult;
  };
  'notifications/update': { params: UpdateNotificationsParams; result: void };
  'notifications/unregister': { params: void; result: void };

  // Bridge control (desktop → bridge)
  'bridge/status': { params: void; result: BridgeStatus };
  'bridge/generatePairingQr': { params: void; result: PairingPayload };
  'bridge/connectedPhones': { params: void; result: ConnectedPhone[] };
  'bridge/disconnectPhone': { params: { deviceId: string }; result: void };
  'bridge/trustedDevices': { params: void; result: TrustedDevice[] };
  'bridge/removeTrustedDevice': { params: { deviceId: string }; result: void };
}

export type JsonRpcMethodName = keyof JsonRpcMethodRegistry;

export type MethodParams<M extends JsonRpcMethodName> = JsonRpcMethodRegistry[M]['params'];
export type MethodResult<M extends JsonRpcMethodName> = JsonRpcMethodRegistry[M]['result'];
