/**
 * Typed registry of all JSON-RPC methods the mobile app can invoke and the
 * bridge must implement.
 *
 * Source: architecture/02b-contracts-and-requirements.md and
 * uxnandesktop/architecture/02e-bridge-integration.md §4.4.
 */
import type { Thread, ThreadList, Turn, TurnList } from '../models/thread.js';
import type {
  GitBranchResult,
  GitCommitResult,
  GitDiff,
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
  WorkspaceListing,
} from '../models/workspace.js';
import type { AuthStatus, Project } from '../models/project.js';
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
}
export interface TurnSendParams {
  threadId: string;
  text: string;
  service?: string;
  effort?: string;
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
export interface TurnSendResult {
  turnId: string;
}

export interface GitCommitParams {
  cwd: string;
  message: string;
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
  'thread/archive': { params: { threadId: string }; result: Thread };
  'thread/unarchive': { params: { threadId: string }; result: Thread };
  'thread/delete': { params: { threadId: string }; result: void };
  'turn/list': { params: TurnListParams; result: TurnList };
  'turn/read': { params: { turnId: string }; result: Turn };
  'turn/send': { params: TurnSendParams; result: TurnSendResult };
  'turn/cancel': { params: { threadId: string; turnId: string }; result: void };

  // Git
  'git/status': { params: { cwd: string }; result: GitRepoStatus };
  'git/diff': { params: { cwd: string }; result: GitDiff };
  'git/commit': { params: GitCommitParams; result: GitCommitResult };
  'git/push': { params: GitPushParams; result: GitPushResult };
  'git/pull': { params: GitPullParams; result: GitPullResult };
  'git/checkout': { params: GitCheckoutParams; result: void };
  'git/createBranch': { params: GitBranchParams; result: GitBranchResult };
  'git/createWorktree': { params: GitWorktreeParams; result: GitWorktreeResult };

  // Workspace
  'workspace/readFile': { params: { cwd: string; path: string }; result: FileContent };
  'workspace/readImage': { params: { cwd: string; path: string }; result: ImageContent };
  'workspace/list': { params: { cwd: string }; result: WorkspaceListing };
  'workspace/browseDirs': { params: BrowseDirsParams; result: BrowseResult };
  'workspace/checkpoint': { params: CheckpointParams; result: Checkpoint };
  'workspace/diffCheckpoint': { params: { id: string }; result: CheckpointDiff };
  'workspace/applyCheckpoint': { params: { id: string }; result: void };
  'workspace/applyPatch': { params: PatchParams; result: ApplyResult };

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
