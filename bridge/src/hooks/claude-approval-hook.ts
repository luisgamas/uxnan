/**
 * Claude Code PreToolUse approval hook.
 *
 * Headless `claude -p` has no interactive-approval channel (validated against
 * claude 2.1.177), but a **PreToolUse hook** injected via `--settings` DOES gate
 * every tool in print mode. This module ships that hook as a standalone CommonJS
 * script: the Claude adapter writes it to `~/.uxnan/hooks/` and references its
 * path in the `--settings` it passes per turn.
 *
 * The hook reads the PreToolUse payload (`{ tool_name, tool_input, ... }`) on
 * stdin, POSTs it to the bridge's `POST /agent-hook/approval` endpoint (URL +
 * token + threadId from env the adapter injects), and the bridge HOLDS the
 * response until the phone answers (`turn/send { approvalResponse }`). The hook
 * then prints the permission decision Claude consumes:
 *   { hookSpecificOutput: { hookEventName, permissionDecision: 'allow'|'deny', … } }
 *
 * Fail-safe: any error (bad URL, unreachable bridge, malformed response) → deny.
 * The script is dependency-free (only `node:http`/`node:url`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes the hook script to [scriptPath] (creating its directory) and returns
 * the path. Idempotent — overwrites each call so an updated bridge ships a fresh
 * hook. Best-effort caller should handle write failures.
 */
export async function writeClaudeApprovalHook(scriptPath: string): Promise<string> {
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, CLAUDE_APPROVAL_HOOK_SCRIPT, 'utf-8');
  return scriptPath;
}

export const CLAUDE_APPROVAL_HOOK_SCRIPT = String.raw`'use strict';
const http = require('node:http');
let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(data || '{}'); } catch (e) {}
  const url = process.env.UXNAN_HOOK_URL;
  const token = process.env.UXNAN_HOOK_TOKEN || '';
  const threadId = process.env.UXNAN_HOOK_THREAD_ID || '';
  const finish = (decision, reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }));
    process.exit(0);
  };
  // Not in approval mode (hook present but no endpoint): don't block the agent.
  if (!url) return finish('allow', 'no bridge approval endpoint');
  let u;
  try { u = new URL(url); } catch (e) { return finish('deny', 'bad bridge hook url'); }
  const body = JSON.stringify({
    threadId,
    toolName: payload.tool_name,
    input: payload.tool_input,
    toolUseId: payload.tool_use_id,
  });
  const req = http.request(
    {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-uxnan-hook-token': token,
      },
    },
    (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(out);
          if (j && j.decision === 'allow') return finish('allow', 'approved on your phone');
          return finish('deny', (j && j.reason) || 'rejected on your phone');
        } catch (e) {
          return finish('deny', 'bridge approval error');
        }
      });
    },
  );
  req.on('error', () => finish('deny', 'bridge unreachable'));
  // No client timeout: the bridge holds the response until the user answers or
  // its own timeout fires (returning deny).
  req.write(body);
  req.end();
});
`;
