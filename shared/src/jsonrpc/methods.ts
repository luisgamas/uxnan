/**
 * Typed registry of all JSON-RPC methods the mobile app can invoke and the
 * bridge must implement.
 *
 * Source: architecture/02b-contracts-and-requirements.md and
 * uxnandesktop/architecture/02e-bridge-integration.md §4.4.
 */
import type { AccessMode, Thread, ThreadList, Turn, TurnList } from '../models/thread.js';
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
  WorkspaceExistsResult,
  WorkspaceListing,
  SearchFilesParams,
  WorkspaceSearchResult,
} from '../models/workspace.js';
import type { AuthStatus, Project } from '../models/project.js';
import type { ApprovalResponse } from '../models/approval.js';
import type { BridgeStatus, ConnectedPhone, TrustedDevice } from '../models/session.js';
import type { PairingPayload } from '../e2ee/pairing-payload.js';
import type { AgentDescriptor, AgentId, AgentModel } from '../agents/agent-capabilities.js';
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
}
export interface ThreadSetModelParams {
  threadId: string;
  model: string;
}
export interface ThreadRenameParams {
  threadId: string;
  /** New, non-empty title for the thread. */
  title: string;
}
export interface ThreadSetAccessModeParams {
  threadId: string;
  /** The per-thread access (approval) mode to persist. */
  mode: AccessMode;
}
export interface TurnSendResult {
  turnId: string;
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
  path: string;
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
  'turn/cancel': { params: { threadId: string; turnId: string }; result: void };

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
  'git/log': { params: GitLogParams; result: GitLogResult };
  'git/commitShow': { params: GitCommitShowParams; result: GitCommitDetails };

  // Workspace
  'workspace/readFile': { params: { cwd: string; path: string }; result: FileContent };
  'workspace/readImage': { params: { cwd: string; path: string }; result: ImageContent };
  'workspace/list': { params: { cwd: string }; result: WorkspaceListing };
  'workspace/searchFiles': { params: SearchFilesParams; result: WorkspaceSearchResult };
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
