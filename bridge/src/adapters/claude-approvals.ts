/**
 * Claude Code interactive-approval protocol translation (pure helpers).
 *
 * When `claude` runs with `--input-format stream-json --output-format
 * stream-json`, a tool that needs permission is surfaced as a `control_request`
 * with subtype `can_use_tool`; the host answers on stdin with a
 * `control_response` (`behavior: 'allow' | 'deny'`). These helpers translate
 * between that protocol and the bridge's interactive-approval seam:
 *   control_request → an `approval` content block the phone renders;
 *   the user's ApprovalDecision → the control_response line written to stdin.
 *
 * FOR-DEV: the exact field names below follow Claude Code's documented
 * stream-json control protocol but have NOT been validated against a live CLI in
 * this environment — verify `control_request`/`control_response`,
 * `tool_name`/`input` and the allow/deny `behavior` shape against the installed
 * `claude` before relying on the interactive path in production. Pure + unit
 * tested (`test/adapters/claude-approvals.test.ts`).
 */
import type { ApprovalDecision, ApprovalRequestBlock, ApprovalRisk } from '@uxnan/shared';
import { approvalBlock } from './content-blocks.js';

/** A Claude `control_request` of subtype `can_use_tool` (a permission ask). */
export interface ClaudeCanUseToolRequest {
  /** Correlation id echoed back in the control_response. */
  requestId: string;
  /** The tool the agent wants to run (e.g. `Bash`, `Edit`, `Write`). */
  toolName: string;
  /** The tool's input arguments. */
  input: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse one already-JSON-decoded stream-json line into a can_use_tool request,
 * or `null` when it isn't a permission control request.
 */
export function parseClaudeControlRequest(parsed: unknown): ClaudeCanUseToolRequest | null {
  if (!isRecord(parsed) || parsed['type'] !== 'control_request') return null;
  const requestId = typeof parsed['request_id'] === 'string' ? parsed['request_id'] : undefined;
  const request = isRecord(parsed['request']) ? parsed['request'] : undefined;
  if (!requestId || !request || request['subtype'] !== 'can_use_tool') return null;
  const toolName = typeof request['tool_name'] === 'string' ? request['tool_name'] : 'tool';
  const input = isRecord(request['input']) ? request['input'] : {};
  return { requestId, toolName, input };
}

/**
 * Build the `control_response` line the CLI expects on stdin for a decision.
 * `approve`/`approveSession` → allow (forwarding the original input);
 * `reject` → deny.
 *
 * FOR-DEV: `approveSession` currently maps to a plain allow. A true
 * session-scoped allow would return `updatedPermissions` in the response so the
 * CLI stops asking for that tool — wire it once validated against the live CLI.
 */
export function buildClaudeControlResponse(
  requestId: string,
  decision: ApprovalDecision,
  input: Record<string, unknown>,
): string {
  const allow = decision === 'approve' || decision === 'approveSession';
  const response = allow
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'Denied by the user' };
  return JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response },
  });
}

/** High-risk tools (destructive / shell) get a `high` risk tag, others `medium`. */
function riskFor(toolName: string): ApprovalRisk {
  const t = toolName.toLowerCase();
  if (t === 'bash' || t.includes('exec') || t.includes('command') || t.includes('shell')) {
    return 'high';
  }
  if (t === 'write' || t === 'edit' || t.includes('delete') || t.includes('remove')) {
    return 'high';
  }
  return 'medium';
}

/** A short human description of the tool input (command / path), for the card. */
function summarizeInput(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'url', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
  }
  return '';
}

/** Map a can_use_tool request to the `approval` content block the phone renders. */
export function claudeRequestToBlock(
  req: ClaudeCanUseToolRequest,
  approvalId: string,
): ApprovalRequestBlock {
  const detail = summarizeInput(req.input);
  const action = detail ? `Allow ${req.toolName}: ${detail}` : `Allow ${req.toolName}`;
  return approvalBlock(approvalId, action, {
    risk: riskFor(req.toolName),
    ...(detail ? { detail } : {}),
  });
}
