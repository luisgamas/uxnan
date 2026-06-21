/**
 * Maps the various Codex app-server approval-elicitation shapes onto the
 * bridge's generic approval tool descriptor (`{ toolName, input }`), so the
 * caller can use a single `agentManager.requestApproval(...)` call regardless
 * of which approval type the server sent.
 *
 * Codex has accumulated several approval channel names over the codebasex-cli
 * versions, and the app-server protocol surfaces BOTH the new `v2` names and
 * the legacy ones. Every one of them is routed through this module:
 *
 *  v2 (current):
 *    - `item/commandExecution/requestApproval` (params: { command, parsedCmd, ... })
 *    - `item/fileChange/requestApproval`        (params: { fileChanges, grantRoot?, reason? })
 *    - `item/permissions/requestApproval`       (params: { reason, permissions })
 *    - `mcpServer/elicitation/request`           (params: { serverName, message, ... })
 *    - `item/tool/requestUserInput`             (params: { toolName, question, ... })
 *
 *  v1 (legacy, still emitted by older `codex-cli` releases):
 *    - `execCommandApproval`                    (params: { command, parsedCmd, ... })
 *    - `applyPatchApproval`                     (params: { fileChanges, grantRoot?, reason? })
 *
 * See `/tmp/codex-schema/ServerRequest.json` for the full schema. The bridge
 * treats them all as a tool to gate; the user replies with one of
 * `approve | reject | approveSession` and the caller maps it back to the
 * right JSON-RPC decision shape for THIS method.
 */
import type { ApprovalDecision } from '@uxnan/shared';

/** The bridge's tool descriptor for `AgentManager.requestApproval`. */
export interface ApprovalDescriptor {
  toolName: string;
  input: Record<string, unknown>;
  /** Optional human-readable one-liner shown as the card's "action" subtitle. */
  detail?: string;
}

/** Identify the elicitation shape so the reply can be shaped correctly. */
export type ApprovalKind =
  /** `item/commandExecution/requestApproval` (v2). */
  | 'commandExecution'
  /** `item/fileChange/requestApproval` (v2). */
  | 'fileChange'
  /** `item/permissions/requestApproval` (v2). */
  | 'permissions'
  /** `mcpServer/elicitation/request` (v2 MCP server). */
  | 'mcpElicitation'
  /** `item/tool/requestUserInput` (v2, EXPERIMENTAL — treat as approval). */
  | 'toolUserInput'
  /** Legacy `execCommandApproval` (v1). */
  | 'legacyExecCommand'
  /** Legacy `applyPatchApproval` (v1). */
  | 'legacyApplyPatch';

/** A pending approval extracted from one server request. */
export interface PendingCodexApproval {
  kind: ApprovalKind;
  serverRequestId: number | string;
  descriptor: ApprovalDescriptor;
}

/** A JSON-RPC reply shape for a given approval kind. */
export type ApprovalReply =
  | { kind: 'approved' }
  | { kind: 'approved_for_session' }
  | { kind: 'denied' }
  | { kind: 'abort' }
  | { kind: 'timed_out' };

/**
 * Map a user-facing decision onto the wire reply. `approveSession` becomes
 * `approved_for_session` (Codex caches the approval for the rest of the
 * session), `approve` → `approved`, `reject` → `denied`.
 */
export function decisionToReply(decision: ApprovalDecision): ApprovalReply {
  if (decision === 'approveSession') return { kind: 'approved_for_session' };
  if (decision === 'reject') return { kind: 'denied' };
  return { kind: 'approved' };
}

/**
 * Inspect a server request and pull out the kind + descriptor. Returns
 * `undefined` for methods the bridge does not treat as a gateable approval
 * (e.g. `account/chatgptAuthTokens/refresh` — handled separately).
 */
export function describeServerRequest(
  method: string,
  params: unknown,
  id: number | string,
): PendingCodexApproval | undefined {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return describeCommandExecution(params, id);
    case 'item/fileChange/requestApproval':
      return describeFileChange(params, id);
    case 'item/permissions/requestApproval':
      return describePermissions(params, id);
    case 'mcpServer/elicitation/request':
      return describeMcpElicitation(params, id);
    case 'item/tool/requestUserInput':
      return describeToolUserInput(params, id);
    case 'execCommandApproval':
      return describeLegacyExecCommand(params, id);
    case 'applyPatchApproval':
      return describeLegacyApplyPatch(params, id);
    default:
      return undefined;
  }
}

/**
 * Build the JSON-RPC `result` payload for a given kind + reply. The shape
 * differs per method: the v2 names use `{ decision: ... }` with a
 * `ReviewDecision` oneOf; the v1 names use the SAME `ReviewDecision` oneOf
 * directly. The bridge keeps it simple and only emits the string forms it
 * understands (Codex ignores unknown forms).
 */
export function buildReplyResult(
  _kind: ApprovalKind,
  reply: ApprovalReply,
): Record<string, unknown> {
  return { decision: reply.kind };
}

function describeCommandExecution(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  // `command` is a string[] (argv); `parsedCmd` is a best-effort parse.
  const command = Array.isArray(p['command'])
    ? (p['command'] as unknown[]).filter((c): c is string => typeof c === 'string').join(' ')
    : '';
  const detail =
    command ||
    (typeof p['reason'] === 'string' ? (p['reason'] as string) : 'codex wants to run a command');
  return {
    kind: 'commandExecution',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.command',
      input: {
        command,
        ...(Array.isArray(p['parsedCmd']) ? { parsedCmd: p['parsedCmd'] } : {}),
        ...(typeof p['cwd'] === 'string' ? { cwd: p['cwd'] } : {}),
      },
      detail,
    },
  };
}

function describeFileChange(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const fileChanges = asRecord(p['fileChanges']) ?? {};
  const paths = Object.keys(fileChanges);
  const detail = paths.length > 0 ? paths.join(', ') : 'codex wants to edit files';
  return {
    kind: 'fileChange',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.applyPatch',
      input: { fileChanges, ...(typeof p['reason'] === 'string' ? { reason: p['reason'] } : {}) },
      detail,
    },
  };
}

function describePermissions(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const reason =
    typeof p['reason'] === 'string' ? (p['reason'] as string) : 'codex wants extra permissions';
  return {
    kind: 'permissions',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.permissions',
      input: { reason, permissions: p['permissions'] },
      detail: reason,
    },
  };
}

function describeMcpElicitation(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const serverName = typeof p['serverName'] === 'string' ? (p['serverName'] as string) : 'mcp';
  const message =
    typeof p['message'] === 'string' ? (p['message'] as string) : 'mcp server needs input';
  return {
    kind: 'mcpElicitation',
    serverRequestId: id,
    descriptor: {
      toolName: `mcp.${serverName}`,
      input: p,
      detail: message,
    },
  };
}

function describeToolUserInput(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const toolName = typeof p['toolName'] === 'string' ? (p['toolName'] as string) : 'codex tool';
  const question =
    typeof p['question'] === 'string' ? (p['question'] as string) : 'codex needs input';
  return {
    kind: 'toolUserInput',
    serverRequestId: id,
    descriptor: {
      toolName: `codex.${toolName}`,
      input: p,
      detail: question,
    },
  };
}

function describeLegacyExecCommand(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const command = Array.isArray(p['command'])
    ? (p['command'] as unknown[]).filter((c): c is string => typeof c === 'string').join(' ')
    : '';
  return {
    kind: 'legacyExecCommand',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.command',
      input: { command, ...(typeof p['cwd'] === 'string' ? { cwd: p['cwd'] } : {}) },
      detail: command || 'codex wants to run a command',
    },
  };
}

function describeLegacyApplyPatch(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const fileChanges = asRecord(p['fileChanges']) ?? {};
  const paths = Object.keys(fileChanges);
  return {
    kind: 'legacyApplyPatch',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.applyPatch',
      input: { fileChanges, ...(typeof p['reason'] === 'string' ? { reason: p['reason'] } : {}) },
      detail: paths.length > 0 ? paths.join(', ') : 'codex wants to edit files',
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
