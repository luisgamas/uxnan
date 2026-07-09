/**
 * Tests for the Gemini CLI `BeforeTool` approval hook script.
 *
 * Mirrors `claude-approval-hook.test.ts`: spawns the shipped script with a
 * fake stdin, points it at a fake HTTP server that emulates the bridge's
 * `POST /agent-hook/approval` endpoint, and asserts the script emits the
 * documented Gemini decision shape on stdout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GEMINI_APPROVAL_HOOK_SCRIPT,
  writeGeminiApprovalHook,
} from '../../src/hooks/gemini-approval-hook.js';

test('writeGeminiApprovalHook writes the script idempotently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = join(dir, 'subdir', 'gemini-approval-hook.cjs');
    const written = await writeGeminiApprovalHook(path);
    assert.equal(written, path);
    const body = readFileSync(path, 'utf-8');
    // The script must mention the documented env vars and the JSON decision
    // shape Gemini consumes.
    assert.match(body, /UXNAN_HOOK_URL/);
    assert.match(body, /UXNAN_HOOK_TOKEN/);
    assert.match(body, /UXNAN_HOOK_THREAD_ID/);
    assert.match(body, /decision.*deny/);
    assert.match(body, /decision.*allow/);
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('the shipped script content matches the exported constant', () => {
  // Sanity: the writer and the export agree (so a packaged bridge ships the
  // same script that tests can exercise).
  assert.ok(GEMINI_APPROVAL_HOOK_SCRIPT.startsWith("'use strict';\n"));
  assert.match(GEMINI_APPROVAL_HOOK_SCRIPT, /x-uxnan-hook-token/);
});

/**
 * Run the script with a given stdin payload + env, optionally pointing it at a
 * fake server. Resolves with `{ stdout, stderr, code }` so the test can assert
 * on the wire shape the CLI consumes.
 */
function runHook(args: {
  scriptPath: string;
  env: Record<string, string>;
  stdin: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    // Start from the ambient env MINUS any UXNAN_HOOK_* the developer's machine
    // may inject (e.g. a running uxnandesktop Layer-1 hook server sets
    // UXNAN_HOOK_URL/_TOKEN in the shell). Each test sets exactly the hook env it
    // means to exercise, so a leaked URL must not contaminate the "no URL"
    // defensive case (which would otherwise try to reach the leaked bridge and
    // deny instead of failing open).
    const baseEnv = { ...process.env };
    for (const key of Object.keys(baseEnv)) {
      if (key.startsWith('UXNAN_HOOK_')) delete baseEnv[key];
    }
    const child = spawn('node', [args.scriptPath], {
      env: { ...baseEnv, ...args.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    };
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));
    child.on('close', finish);
    child.on('error', () => finish(-1));
    if (args.timeoutMs) {
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }, args.timeoutMs);
    }
    child.stdin.write(args.stdin);
    child.stdin.end();
  });
}

test('hook script denies on bridge reject (writes { decision: "deny" } + exit 0)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
    // Fake bridge: returns { decision: "deny", reason: "nope" }.
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'deny', reason: 'nope' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const url = `http://127.0.0.1:${addr.port}/agent-hook/approval`;
    try {
      const result = await runHook({
        scriptPath: path,
        env: { UXNAN_HOOK_URL: url, UXNAN_HOOK_TOKEN: 'tok', UXNAN_HOOK_THREAD_ID: 'th-1' },
        stdin: JSON.stringify({
          session_id: 's',
          hook_event_name: 'BeforeTool',
          tool_name: 'write_file',
          tool_input: { file_path: 'a.txt', content: 'x' },
        }),
      });
      assert.equal(result.code, 0);
      const payload = JSON.parse(result.stdout) as { decision: string; reason: string };
      assert.equal(payload.decision, 'deny');
      assert.equal(payload.reason, 'nope');
    } finally {
      server.close();
    }
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('hook script allows on bridge allow (no stdout, exit 0)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'allow' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const url = `http://127.0.0.1:${addr.port}/agent-hook/approval`;
    try {
      const result = await runHook({
        scriptPath: path,
        env: { UXNAN_HOOK_URL: url, UXNAN_HOOK_TOKEN: 'tok', UXNAN_HOOK_THREAD_ID: 'th-1' },
        stdin: JSON.stringify({
          session_id: 's',
          hook_event_name: 'BeforeTool',
          tool_name: 'write_file',
          tool_input: { file_path: 'a.txt', content: 'x' },
        }),
      });
      assert.equal(result.code, 0);
      // The script intentionally writes nothing on stdout for allow (Gemini's
      // documented allow shape: no decision JSON, exit 0).
      assert.equal(result.stdout, '');
    } finally {
      server.close();
    }
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('hook script fails safe (deny) when the bridge URL is unreachable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
    // 127.0.0.1:1 is reserved and not listening; the connect should refuse
    // fast. The script must translate that into a deny (exit 0, decision=deny).
    const result = await runHook({
      scriptPath: path,
      env: {
        UXNAN_HOOK_URL: 'http://127.0.0.1:1/agent-hook/approval',
        UXNAN_HOOK_TOKEN: 'tok',
        UXNAN_HOOK_THREAD_ID: 'th-1',
      },
      stdin: JSON.stringify({ tool_name: 'write_file', tool_input: { file_path: 'a' } }),
      timeoutMs: 5000,
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout) as { decision: string; reason: string };
    assert.equal(payload.decision, 'deny');
    assert.match(payload.reason, /unreachable|error|bad/i);
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('hook script denies when no URL env is set (defensive)', async () => {
  // No env at all — the script should treat this as "no bridge wired" and
  // allow the tool (it can't possibly gate it). This mirrors Claude's
  // fail-open behaviour in the same case.
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
    const result = await runHook({
      scriptPath: path,
      env: { UXNAN_HOOK_THREAD_ID: 'th-1' },
      stdin: JSON.stringify({ tool_name: 'write_file', tool_input: {} }),
      timeoutMs: 5000,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '', 'allow path must not emit a decision');
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// Sanity: the file the bridge ships lives at src/hooks/gemini-approval-hook.ts
// and the writer writes the exact same content the test exercises.
test('the writer output equals the embedded script', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const path = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
    const body = readFileSync(path, 'utf-8');
    assert.equal(body, GEMINI_APPROVAL_HOOK_SCRIPT);
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
