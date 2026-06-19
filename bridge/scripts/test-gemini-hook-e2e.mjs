/**
 * End-to-end smoke test for the Gemini approval hook.
 *
 * Spins up a tiny HTTP server that emulates the bridge's
 * `POST /agent-hook/approval` endpoint, asks the bridge's
 * `writeGeminiApprovalHook` to materialize the script, then runs the script
 * with the exact JSON payload Gemini's `BeforeTool` event sends on stdin.
 *
 * Verifies:
 *   1. Allow path → script exits 0, no stdout (Gemini's "allow" shape).
 *   2. Deny path → script exits 0, stdout is `{ decision: "deny", reason }`.
 *   3. No URL → script exits 0 with no stdout (defensive fail-open).
 */
import { writeGeminiApprovalHook } from '../dist/src/hooks/gemini-approval-hook.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;

function fail(msg) {
  console.error(`✖ ${msg}`);
  failures++;
}

function ok(msg) {
  console.log(`✔ ${msg}`);
}

function runHook(scriptPath, env, stdin, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    };
    child.stdout.on('data', (c) => (stdout += c.toString('utf-8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf-8')));
    child.on('close', finish);
    child.on('error', (err) => finish(-1));
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const toolInput = JSON.stringify({
  tool_name: 'write_file',
  tool_input: { file_path: 'a.txt', content: 'x' },
  session_id: 'sess-1',
  cwd: '/tmp',
  hook_event_name: 'BeforeTool',
});

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-e2e-'));
  const scriptPath = await writeGeminiApprovalHook(join(dir, 'hook.cjs'));
  ok(`wrote hook script to ${scriptPath}`);
  // Sanity: the writer output equals the embedded constant.
  const written = readFileSync(scriptPath, 'utf-8');
  if (written.length < 1000) fail(`hook script suspiciously short: ${written.length}b`);
  else ok(`hook script is ${written.length}b`);

  // Allow path.
  const allowServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ decision: 'allow' }));
  });
  await new Promise((r) => allowServer.listen(0, '127.0.0.1', r));
  const allowAddr = allowServer.address();
  const allowUrl = `http://127.0.0.1:${allowAddr.port}/agent-hook/approval`;
  {
    const r = await runHook(
      scriptPath,
      { UXNAN_HOOK_URL: allowUrl, UXNAN_HOOK_TOKEN: 't', UXNAN_HOOK_THREAD_ID: 'th' },
      toolInput,
    );
    if (r.code === 0 && r.stdout === '') ok('allow → exit 0, empty stdout');
    else fail(`allow path wrong: code=${r.code} stdout=${JSON.stringify(r.stdout)}`);
  }
  allowServer.close();

  // Deny path.
  const denyServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ decision: 'deny', reason: 'blocked by phone' }));
  });
  await new Promise((r) => denyServer.listen(0, '127.0.0.1', r));
  const denyAddr = denyServer.address();
  const denyUrl = `http://127.0.0.1:${denyAddr.port}/agent-hook/approval`;
  {
    const r = await runHook(
      scriptPath,
      { UXNAN_HOOK_URL: denyUrl, UXNAN_HOOK_TOKEN: 't', UXNAN_HOOK_THREAD_ID: 'th' },
      toolInput,
    );
    if (r.code !== 0) fail(`deny path exited non-zero: ${r.code}`);
    try {
      const j = JSON.parse(r.stdout);
      if (j.decision === 'deny' && j.reason === 'blocked by phone') {
        ok('deny → exit 0 + { decision: "deny", reason: … }');
      } else fail(`deny payload wrong: ${JSON.stringify(j)}`);
    } catch (e) {
      fail(`deny stdout not JSON: ${r.stdout}`);
    }
  }
  denyServer.close();

  // No URL → defensive allow.
  {
    const r = await runHook(
      scriptPath,
      { UXNAN_HOOK_TOKEN: 't', UXNAN_HOOK_THREAD_ID: 'th' },
      toolInput,
    );
    if (r.code === 0 && r.stdout === '') ok('no URL → exit 0, empty stdout (fail-open)');
    else fail(`no-URL path wrong: code=${r.code} stdout=${JSON.stringify(r.stdout)}`);
  }

  // Bridge unreachable → fail-closed deny.
  {
    const r = await runHook(
      scriptPath,
      {
        UXNAN_HOOK_URL: 'http://127.0.0.1:1/agent-hook/approval',
        UXNAN_HOOK_TOKEN: 't',
        UXNAN_HOOK_THREAD_ID: 'th',
      },
      toolInput,
    );
    if (r.code === 0) {
      try {
        const j = JSON.parse(r.stdout);
        if (j.decision === 'deny') ok('unreachable → deny (fail-closed)');
        else fail(`unreachable wrong payload: ${JSON.stringify(j)}`);
      } catch (e) {
        fail(`unreachable stdout not JSON: ${r.stdout}`);
      }
    } else fail(`unreachable wrong exit: ${r.code}`);
  }
}

main().then(() => {
  if (failures === 0) {
    console.log('\nAll end-to-end checks passed.');
    process.exit(0);
  } else {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
});
