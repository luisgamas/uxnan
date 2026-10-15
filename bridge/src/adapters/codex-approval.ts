/**
 * Maps the Codex app-server approval-elicitation shapes onto the bridge's
 * generic approval request (`ApprovalRequestInfo`), so the caller can use a
 * single `requestApproval(...)` call regardless of which approval type the
 * server sent.
 *
 * Codex has accumulated several approval channel names over the codex-cli
 * versions, and the app-server protocol surfaces BOTH the new `v2` names and
 * the legacy ones. Every approval channel is routed through this module:
 *
 *  v2 (current):
 *    - `item/commandExecution/requestApproval` (params: { command (a string, or null),
 *                                                kind: 'command' | 'writeStdin', cwd, ... })
 *    - `item/fileChange/requestApproval`        (params: { itemId, reason?, grantRoot? } —
 *                                                the changes ride on the item itself)
 *    - `item/permissions/requestApproval`       (params: { reason, permissions })
 *    - `mcpServer/elicitation/request`           (params: { serverName, message, ... })
 *
 *  v1 (legacy, still emitted by older `codex-cli` releases):
 *    - `execCommandApproval`                    (params: { command, parsedCmd, ... })
 *    - `applyPatchApproval`                     (params: { fileChanges, grantRoot?, reason? })
 *
 * The bridge treats them all as a tool to gate; the user replies with one of
 * `approve | reject | approveSession` and the caller maps it back to the
 * right JSON-RPC decision shape for THIS method.
 *
 * `item/tool/requestUserInput` is not an approval: it is a question Codex asks
 * the person, mapped by {@link describeUserInputRequest} and answered by
 * {@link questionReply}.
 */
import type { ApprovalDecision, QuestionItem, QuestionOption } from '@uxnan/shared';
import type { ApprovalRequestInfo } from './user-input.js';

/** The bridge's approval request for `AgentManager.requestApproval`. */
export type ApprovalDescriptor = ApprovalRequestInfo;

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
    case 'execCommandApproval':
      return describeLegacyExecCommand(params, id);
    case 'applyPatchApproval':
      return describeLegacyApplyPatch(params, id);
    default:
      return undefined;
  }
}

/**
 * The JSON-RPC `result` that answers an approval request with the person's
 * [decision], in the shape that request's method expects (codex-cli 0.157.1
 * schema). The v2 item approvals take `accept` / `acceptForSession` /
 * `decline`; the legacy v1 names take the older `ReviewDecision` strings; a
 * permissions request is answered by granting (or not) what it asked for; an
 * MCP elicitation by its action. A reply in another method's shape is
 * ignored by Codex, which then asks again — the loop "request approval" ran
 * into before this kept them apart.
 */
export function approvalReply(
  approval: Pick<PendingCodexApproval, 'kind' | 'descriptor'>,
  decision: ApprovalDecision,
): Record<string, unknown> {
  const approve = decision !== 'reject';
  const forSession = decision === 'approveSession';
  switch (approval.kind) {
    case 'commandExecution':
    case 'fileChange':
      return { decision: forSession ? 'acceptForSession' : approve ? 'accept' : 'decline' };
    case 'permissions':
      return approve
        ? {
            permissions: approval.descriptor.input['permissions'] ?? {},
            scope: forSession ? 'session' : 'turn',
          }
        : { permissions: {} };
    case 'mcpElicitation':
      return { action: approve ? 'accept' : 'decline', content: null };
    case 'legacyExecCommand':
    case 'legacyApplyPatch':
      return { decision: forSession ? 'approved_for_session' : approve ? 'approved' : 'denied' };
  }
}

function describeCommandExecution(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  if (p['kind'] === 'writeStdin') {
    // Text typed into a command that is already running, not a new command.
    // The schema carries no stdin text, and what is typed can be a secret
    // (a password prompt), so the card names the action and shows nothing else.
    return {
      kind: 'commandExecution',
      serverRequestId: id,
      descriptor: {
        toolName: 'codex.writeStdin',
        input: {},
        action: "Codex wants to write to a running command's input",
      },
    };
  }
  // A string on the v2 protocol (codex-cli 0.157.1); argv on older builds.
  const command =
    typeof p['command'] === 'string'
      ? p['command']
      : Array.isArray(p['command'])
        ? (p['command'] as unknown[]).filter((c): c is string => typeof c === 'string').join(' ')
        : '';
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
    },
  };
}

function describeFileChange(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  // v2 names only the item and why; the legacy shape listed the files.
  const fileChanges = asRecord(p['fileChanges']) ?? {};
  return {
    kind: 'fileChange',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.applyPatch',
      input: { fileChanges, ...(typeof p['reason'] === 'string' ? { reason: p['reason'] } : {}) },
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
    },
  };
}

function describeMcpElicitation(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const serverName = typeof p['serverName'] === 'string' ? (p['serverName'] as string) : 'mcp';
  return {
    kind: 'mcpElicitation',
    serverRequestId: id,
    descriptor: {
      toolName: `mcp.${serverName}`,
      input: p,
    },
  };
}

/** Codex's questions for the person (`item/tool/requestUserInput`), in the order asked. */
export interface PendingCodexQuestions {
  /** Codex's id per question: the key its answer is filed under. */
  ids: string[];
  /** The same questions, as the bridge's question card shows them. */
  questions: QuestionItem[];
}

/**
 * Read an `item/tool/requestUserInput` request (a question, not an approval).
 * A question without an id or text cannot be answered, so it is left out. A
 * question with no choices is answered in the person's own words. `isSecret`
 * questions are still asked; the bridge never logs what is answered.
 */
export function describeUserInputRequest(params: unknown): PendingCodexQuestions {
  const p = asRecord(params) ?? {};
  const ids: string[] = [];
  const questions: QuestionItem[] = [];
  for (const raw of Array.isArray(p['questions']) ? p['questions'] : []) {
    const q = asRecord(raw);
    if (!q || typeof q['id'] !== 'string' || typeof q['question'] !== 'string') continue;
    const options: QuestionOption[] = [];
    for (const rawOption of Array.isArray(q['options']) ? q['options'] : []) {
      const option = asRecord(rawOption);
      if (!option || typeof option['label'] !== 'string' || option['label'] === '') continue;
      const description = typeof option['description'] === 'string' ? option['description'] : '';
      options.push({
        label: option['label'],
        ...(description !== '' ? { description } : {}),
      });
    }
    const header = typeof q['header'] === 'string' && q['header'] !== '' ? q['header'] : undefined;
    ids.push(q['id']);
    questions.push({
      question: q['question'],
      ...(header !== undefined ? { header } : {}),
      options,
      custom: q['isOther'] === true || options.length === 0,
    });
  }
  return { ids, questions };
}

/**
 * The JSON-RPC `result` answering `item/tool/requestUserInput`: each answered
 * question's chosen labels (or the text the person typed) filed under Codex's
 * id for it. A skipped question has no entry, so Codex sees no answer for it;
 * an answer set with no entries at all means the person skipped everything.
 */
export function questionReply(
  questions: PendingCodexQuestions,
  answers: string[][],
): { answers: Record<string, { answers: string[] }> } {
  const filed: Record<string, { answers: string[] }> = {};
  questions.ids.forEach((id, index) => {
    const chosen = (answers[index] ?? []).filter((answer) => answer !== '');
    if (chosen.length > 0) filed[id] = { answers: chosen };
  });
  return { answers: filed };
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
    },
  };
}

function describeLegacyApplyPatch(params: unknown, id: number | string): PendingCodexApproval {
  const p = asRecord(params) ?? {};
  const fileChanges = asRecord(p['fileChanges']) ?? {};
  return {
    kind: 'legacyApplyPatch',
    serverRequestId: id,
    descriptor: {
      toolName: 'codex.applyPatch',
      input: { fileChanges, ...(typeof p['reason'] === 'string' ? { reason: p['reason'] } : {}) },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
