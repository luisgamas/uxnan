/**
 * Gemini CLI `BeforeTool` approval hook.
 *
 * Gemini CLI uses the same hook contract as Claude Code (the CLI ships a
 * `gemini hooks migrate` command that imports Claude hook settings). This
 * module ships a hook script that the bridge writes to
 * `~/.uxnan/hooks/gemini-approval-hook.cjs`, then the adapter injects a
 * matching `BeforeTool` entry in `<cwd>/.gemini/settings.json` so EVERY tool
 * Gemini wants to run is round-tripped to the bridge's local HTTP endpoint.
 *
 * The hook reads the BeforeTool payload (`{ tool_name, tool_input, ... }`) on
 * stdin, POSTs it to `POST /agent-hook/approval` on the bridge (URL + token +
 * threadId from env the adapter injects per turn), and prints the decision
 * Gemini consumes:
 *   { "decision": "deny", "reason": "..." }   — tool is denied
 *   exit 2                                     — same as deny, stderr is the reason
 *   exit 0 + (no output)                      — tool is allowed
 *
 * Fail-safe: any error (bad URL, unreachable bridge, malformed response) → deny
 * with a clear reason. The script is dependency-free (only `node:http`/`node:url`).
 *
 * Source: bridge/CHANGELOG.md (2026-06 entry) + `architecture/02a` §6.2.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes the Gemini hook script to [scriptPath] (creating its directory) and
 * returns the path. Idempotent — overwrites each call so an updated bridge
 * ships a fresh script. Best-effort caller should handle write failures.
 */
export async function writeGeminiApprovalHook(scriptPath: string): Promise<string> {
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, GEMINI_APPROVAL_HOOK_SCRIPT, 'utf-8');
  return scriptPath;
}

export const GEMINI_APPROVAL_HOOK_SCRIPT = String.raw`'use strict';
// Gemini CLI BeforeTool approval hook — the bridge writes this script under
// ~/.uxnan/hooks/ and references it from <cwd>/.gemini/settings.json when
// the user enables interactive approvals (agents.gemini-cli.interactiveApprovals).
// Fail-safe: any error → deny.
const http = require('node:http');
let data = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(data || '{}'); } catch (e) { /* default {} */ }
  const url = process.env.UXNAN_HOOK_URL;
  const token = process.env.UXNAN_HOOK_TOKEN || '';
  const threadId = process.env.UXNAN_HOOK_THREAD_ID || '';
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool';
  const toolInput = (payload.tool_input && typeof payload.tool_input === 'object')
    ? payload.tool_input
    : {};
  const toolCallId = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : '';

  // Allow the tool when the bridge has no approval endpoint wired (defensive —
  // the bridge only injects the hook when the endpoint exists, but a misconfig
  // shouldn't silently deny every tool).
  const finish = (decision, reason) => {
    if (decision === 'deny') {
      // Gemini's documented shape: exit 0 with { decision, reason }.
      process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
    } else if (decision === 'block') {
      // Exit 2 = system block; stderr is the reason the agent sees as an error.
      process.stderr.write(reason || 'blocked by bridge');
      process.exit(2);
    }
    process.exit(0);
  };
  if (!url) return finish('allow', 'no bridge approval endpoint');
  let u;
  try { u = new URL(url); } catch (e) { return finish('deny', 'bad bridge hook url'); }
  const body = JSON.stringify({
    threadId,
    toolName,
    input: toolInput,
    toolCallId,
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
          if (j && j.decision === 'allow') return finish('allow', '');
          return finish('deny', (j && j.reason) || 'rejected on your phone');
        } catch (e) {
          return finish('deny', 'bridge approval error');
        }
      });
    },
  );
  req.on('error', () => finish('deny', 'bridge unreachable'));
  // No client timeout: the bridge holds the response until the user answers
  // (or its own 5-min timeout fires, returning deny).
  req.write(body);
  req.end();
});
`;
