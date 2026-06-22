/**
 * Runtime list of valid JSON-RPC method names, kept in lock-step with the
 * compile-time {@link JsonRpcMethodRegistry} via the assertion below.
 */
import type { JsonRpcMethodName } from './methods.js';

export const METHOD_NAMES = [
  // Threads & turns
  'thread/list',
  'thread/read',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'thread/setModel',
  'thread/rename',
  'thread/setAccessMode',
  'thread/archive',
  'thread/unarchive',
  'thread/delete',
  'turn/list',
  'turn/read',
  'turn/send',
  'turn/cancel',
  // Git
  'git/status',
  'git/diff',
  'git/commit',
  'git/push',
  'git/pull',
  'git/checkout',
  'git/createBranch',
  'git/createWorktree',
  'git/stage',
  'git/unstage',
  'git/discard',
  'git/createPr',
  'git/undoCommit',
  'git/branches',
  'git/switchBranch',
  'git/revert',
  'git/deleteBranch',
  'git/removeWorktree',
  'git/log',
  // Workspace
  'workspace/readFile',
  'workspace/readImage',
  'workspace/list',
  'workspace/browseDirs',
  'workspace/checkpoint',
  'workspace/diffCheckpoint',
  'workspace/applyCheckpoint',
  'workspace/applyPatch',
  'workspace/exists',
  // Projects
  'project/list',
  'project/resolve',
  // Agents
  'agent/list',
  'agent/models',
  // Auth
  'auth/status',
  'auth/login',
  'auth/logout',
  // Notifications (push)
  'notifications/register',
  'notifications/update',
  'notifications/unregister',
  // Bridge control
  'bridge/status',
  'bridge/generatePairingQr',
  'bridge/connectedPhones',
  'bridge/disconnectPhone',
  'bridge/trustedDevices',
  'bridge/removeTrustedDevice',
] as const;

/**
 * Compile-time guarantee that {@link METHOD_NAMES} and {@link JsonRpcMethodName}
 * describe exactly the same set of methods. If they drift, this fails to build.
 */
type _NamesAreMethods = (typeof METHOD_NAMES)[number] extends JsonRpcMethodName ? true : never;
type _MethodsAreNames = JsonRpcMethodName extends (typeof METHOD_NAMES)[number] ? true : never;
const _assertNamesAreMethods: _NamesAreMethods = true;
const _assertMethodsAreNames: _MethodsAreNames = true;
void _assertNamesAreMethods;
void _assertMethodsAreNames;

const METHOD_NAME_SET: ReadonlySet<string> = new Set(METHOD_NAMES);

export function isKnownMethod(method: string): method is JsonRpcMethodName {
  return METHOD_NAME_SET.has(method);
}
