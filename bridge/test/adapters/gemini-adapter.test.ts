import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeminiAdapter, parseGeminiLine, type SpawnedProcess } from '../../src/index.js';
import { geminiToolBlock, isInternalGeminiTool } from '../../src/adapters/gemini-tools.js';
import type { AgentStreamEvent } from '@uxnan/shared';

interface FakeSpawn {
  args: string[];
  env?: Record<string, string>;
  feed(lines: string[]): void;
}

function fakeSpawner(): {
  spawnFn: (
    command: string,
    args: string[],
    cwd: string,
    extra?: { env?: Record<string, string> },
  ) => SpawnedProcess;
  last(): FakeSpawn;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (
    _command: string,
    args: string[],
    _cwd: string,
    extra?: { env?: Record<string, string> },
  ): SpawnedProcess => {
    const stdout = new PassThrough();
    const emitter = new EventEmitter();
    stdout.on('end', () => emitter.emit('close', 0));
    const proc: SpawnedProcess = {
      stdout,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
    spawns.push({
      args,
      ...(extra?.env ? { env: extra.env } : {}),
      feed: (lines) => {
        for (const line of lines) stdout.write(`${line}\n`);
        stdout.end();
      },
    });
    return proc;
  };
  return { spawnFn, last: () => spawns[spawns.length - 1]! };
}

function collect(adapter: GeminiAdapter): {
  events: AgentStreamEvent[];
  done: Promise<AgentStreamEvent[]>;
} {
  const events: AgentStreamEvent[] = [];
  let resolve!: (e: AgentStreamEvent[]) => void;
  const done = new Promise<AgentStreamEvent[]>((r) => (resolve = r));
  adapter.onEvent((event) => {
    events.push(event);
    if (event.type === 'turn_completed' || event.type === 'turn_error') resolve(events);
  });
  return { events, done };
}

test('parseGeminiLine maps the documented event shapes', () => {
  assert.equal(parseGeminiLine('not json'), null);
  assert.deepEqual(
    parseGeminiLine('{"type":"init","session_id":"s1","model":"gemini-2.5-flash"}'),
    {
      kind: 'session',
      sessionId: 's1',
      model: 'gemini-2.5-flash',
    },
  );
  assert.deepEqual(
    parseGeminiLine('{"type":"message","role":"assistant","content":"hi","delta":true}'),
    { kind: 'delta', text: 'hi', delta: true },
  );
  // a user echo is ignored
  assert.deepEqual(parseGeminiLine('{"type":"message","role":"user","content":"q"}'), {
    kind: 'other',
  });
  assert.deepEqual(
    parseGeminiLine(
      '{"type":"tool_use","tool_name":"write_file","tool_id":"t1","parameters":{"file_path":"a.txt","content":"x"}}',
    ),
    {
      kind: 'tool_use',
      tool: { name: 'write_file', id: 't1', params: { file_path: 'a.txt', content: 'x' } },
    },
  );
  assert.deepEqual(
    parseGeminiLine('{"type":"tool_result","tool_id":"t1","status":"success","output":"ok"}'),
    {
      kind: 'tool_result',
      toolId: 't1',
      status: 'success',
      output: 'ok',
    },
  );
  assert.deepEqual(
    parseGeminiLine(
      '{"type":"result","status":"success","stats":{"total_tokens":1234,"models":{"gemini-3.1-flash":{"total_tokens":1234}}}}',
    ),
    { kind: 'completed', tokens: 1234, model: 'gemini-3.1-flash' },
  );
  assert.equal(
    parseGeminiLine('{"type":"result","status":"error","error":{"message":"boom"}}')?.kind,
    'error',
  );
});

test('a full turn streams deltas, a diff block and usage', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({ binaryPath: 'gemini', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({
    threadId: 'th',
    turnId: 'tn',
    text: 'do it',
    service: 'gemini-2.5-flash-lite',
  });
  last().feed([
    '{"type":"init","session_id":"sess-1","model":"gemini-2.5-flash-lite"}',
    '{"type":"message","role":"user","content":"do it"}',
    '{"type":"tool_use","tool_name":"update_topic","tool_id":"u0","parameters":{"title":"x"}}',
    '{"type":"tool_result","tool_id":"u0","status":"success"}',
    '{"type":"tool_use","tool_name":"write_file","tool_id":"w1","parameters":{"file_path":"hi.txt","content":"hola"}}',
    '{"type":"tool_result","tool_id":"w1","status":"success"}',
    '{"type":"message","role":"assistant","content":"hello","delta":true}',
    '{"type":"message","role":"assistant","content":" world","delta":true}',
    '{"type":"result","status":"success","stats":{"total_tokens":5000,"models":{"gemini-3.1-flash-lite":{"total_tokens":5000}}}}',
  ]);
  const events = await done;

  const text = (t: string) => events.filter((e) => e.type === t);
  assert.equal(
    text('delta')
      .map((e) => (e.data as { text: string }).text)
      .join(''),
    'hello world',
  );

  // model_resolved carries the CONCRETE model the alias resolved to.
  const resolved = events.find((e) => e.type === 'model_resolved');
  assert.equal((resolved?.data as { text: string }).text, 'gemini-3.1-flash-lite');

  // one diff block for write_file; the internal update_topic tool is filtered out.
  const blocks = events.filter((e) => e.type === 'block');
  assert.equal(blocks.length, 1);
  const block = (blocks[0]!.data as { content: Record<string, unknown> }).content;
  assert.equal(block['type'], 'diff');
  assert.equal(block['filename'], 'hi.txt');

  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'hello world');
  assert.deepEqual((completed?.data as { usage: unknown }).usage, {
    tokens: 5000,
    contextWindow: 1_048_576,
  });

  // first turn opens a session under a generated UUID
  assert.ok(last().args.includes('--session-id'));
  assert.ok(last().args.includes('--output-format') && last().args.includes('stream-json'));
  // default permission posture → auto_edit
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'auto_edit');
});

test('continuity: second turn resumes the captured session id', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({ binaryPath: 'gemini', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 'th', turnId: 't1', text: 'one' });
  last().feed([
    '{"type":"init","session_id":"sess-42","model":"gemini-2.5-flash"}',
    '{"type":"message","role":"assistant","content":"ok","delta":true}',
    '{"type":"result","status":"success","stats":{"total_tokens":10}}',
  ]);
  await first.done;
  assert.equal(adapter.nativeSessionId('th'), 'sess-42');

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 'th', turnId: 't2', text: 'two' });
  // resumes, does NOT open a new session
  assert.ok(last().args.includes('--resume'));
  assert.equal(last().args[last().args.indexOf('--resume') + 1], 'sess-42');
  assert.ok(!last().args.includes('--session-id'));
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":20}}']);
  await second.done;
});

test('a failed result surfaces as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({ binaryPath: 'gemini', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 'th', turnId: 'tn', text: 'x' });
  last().feed(['{"type":"result","status":"error","error":{"message":"quota exceeded"}}']);
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.ok(err);
  assert.equal((err?.data as { text: string }).text, 'quota exceeded');
});

test('listModels returns the curated set with a default', async () => {
  const adapter = new GeminiAdapter({ binaryPath: 'gemini' });
  const models = await adapter.listModels();
  // Auto-routing alias.
  assert.ok(models.some((m) => m.id === 'auto' && m.isDefault));
  // Every id in the CLI's `VALID_GEMINI_MODELS` set.
  assert.ok(models.some((m) => m.id === 'gemini-3-pro-preview'));
  assert.ok(models.some((m) => m.id === 'gemini-3.1-pro-preview'));
  assert.ok(models.some((m) => m.id === 'gemini-3.1-pro-preview-customtools'));
  assert.ok(models.some((m) => m.id === 'gemini-3-flash-preview'));
  assert.ok(models.some((m) => m.id === 'gemini-2.5-pro'));
  assert.ok(models.some((m) => m.id === 'gemini-2.5-flash'));
  assert.ok(models.some((m) => m.id === 'gemini-3.5-flash'));
  assert.ok(models.some((m) => m.id === 'gemini-3-flash'));
  assert.ok(models.some((m) => m.id === 'gemini-3.1-flash-lite'));
  // Experimental Gemma ids are listed (CLI gates them by `experimentalGemma`).
  assert.ok(models.some((m) => m.id === 'gemma-4-31b-it'));
  assert.ok(models.some((m) => m.id === 'gemma-4-26b-a4b-it'));
  // Exactly one default.
  assert.equal(models.filter((m) => m.isDefault).length, 1);
});

test('gemini-tools maps tools and flags internal ones', () => {
  assert.equal(isInternalGeminiTool('update_topic'), true);
  assert.equal(isInternalGeminiTool('write_file'), false);

  const write = geminiToolBlock(
    'write_file',
    'w',
    { file_path: 'a.txt', content: 'l1\nl2' },
    '',
    false,
  );
  assert.equal(write['type'], 'diff');
  assert.equal(write['additions'], 2);

  const replace = geminiToolBlock(
    'replace',
    'r',
    { file_path: 'a.txt', old_string: 'a', new_string: 'b' },
    '',
    false,
  );
  assert.equal(replace['type'], 'diff');

  const shell = geminiToolBlock('run_shell_command', 's', { command: 'ls' }, 'out', false);
  assert.equal(shell['type'], 'command_execution');
  assert.equal(shell['command'], 'ls');

  const other = geminiToolBlock('read_file', 'rd', { file_path: 'a.txt' }, 'data', false);
  assert.equal(other['type'], 'tool');
  assert.equal(other['toolName'], 'read_file');
});

test('interactive mode maps to Gemini --approval-mode default and injects the env for the hook', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({
    binaryPath: 'gemini',
    spawnFn,
    permissionMode: 'interactive',
    approvalHook: {
      token: 'tok-xyz',
      scriptPath: 'C:/Users/x/.uxnan/hooks/gemini-approval-hook.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 'thread-g', turnId: 'u1', text: 'go' });
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
  await done;
  // The CLI's "default" (prompt for approval) is what the hook intercepts.
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'default');
  // The bridge endpoint URL + token + threadId are passed to the hook via env.
  assert.equal(last().env?.UXNAN_HOOK_THREAD_ID, 'thread-g');
  assert.equal(last().env?.UXNAN_HOOK_TOKEN, 'tok-xyz');
  assert.equal(last().env?.UXNAN_HOOK_URL, 'http://127.0.0.1:19850/agent-hook/approval');
});

test('accessMode approveForMe forces --approval-mode auto_edit (overrides configured plan)', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({ binaryPath: 'gemini', spawnFn, permissionMode: 'default' });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 'th', turnId: 'u1', text: 'go', accessMode: 'approveForMe' });
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
  await done;
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'auto_edit');
  // No hook env (the access mode bypasses interactive approvals).
  assert.equal(last().env, undefined);
});

test('accessMode fullAccess forces --approval-mode yolo', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({ binaryPath: 'gemini', spawnFn, permissionMode: 'default' });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 'th', turnId: 'u1', text: 'go', accessMode: 'fullAccess' });
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
  await done;
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'yolo');
});

test('accessMode requestApproval flips to interactive when the hook is resolvable (even if configured non-interactive)', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new GeminiAdapter({
    binaryPath: 'gemini',
    spawnFn,
    // Configured posture is NON-interactive; the phone's requestApproval must
    // still turn the hook on because the bridge endpoint is resolvable.
    permissionMode: 'acceptEdits',
    approvalHook: {
      token: 'tok-xyz',
      scriptPath: 'C:/hook.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 'thread-g',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
  await done;
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'default'); // Gemini "default" == prompt → hook gates
  assert.equal(last().env?.UXNAN_HOOK_THREAD_ID, 'thread-g');
  assert.equal(last().env?.UXNAN_HOOK_TOKEN, 'tok-xyz');
});

test('accessMode requestApproval falls back to the configured posture when no hook is resolvable', async () => {
  const { spawnFn, last } = fakeSpawner();
  // No approvalHook → requestApproval can't route interactively; it must fall
  // back to the configured posture (acceptEdits → auto_edit), NOT error the turn.
  const adapter = new GeminiAdapter({
    binaryPath: 'gemini',
    spawnFn,
    permissionMode: 'acceptEdits',
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 'th',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
  const events = await done;
  // It must NOT be a turn_error and must spawn with the configured posture.
  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
  );
  const ai = last().args.indexOf('--approval-mode');
  assert.equal(last().args[ai + 1], 'auto_edit');
});

test('interactive mode without a resolvable hook URL fails the turn (no silent plan fallback)', async () => {
  const { spawnFn } = fakeSpawner();
  const adapter = new GeminiAdapter({
    binaryPath: 'gemini',
    spawnFn,
    permissionMode: 'interactive',
    // No approvalHook at all → the bridge hasn't wired the LAN server.
    approvalHook: { token: 't', scriptPath: 'C:/h.cjs', url: () => undefined },
  });
  const events: AgentStreamEvent[] = [];
  let resolve!: (e: AgentStreamEvent[]) => void;
  const done = new Promise<AgentStreamEvent[]>((r) => (resolve = r));
  adapter.onEvent((event) => {
    events.push(event);
    if (event.type === 'turn_completed' || event.type === 'turn_error') resolve(events);
  });
  await adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'go' });
  const result = await done;
  // The adapter must surface a clear turn_error (the CLI never gets spawned),
  // NOT silently fall back to a posture that may look successful.
  const err = result.find((e) => e.type === 'turn_error');
  assert.ok(err, 'expected a turn_error when the hook URL is unavailable');
  assert.match(
    (err?.data as { text: string }).text,
    /hook URL is unavailable|interactive approvals requested/,
  );
});

test('interactive mode writes a <cwd>/.gemini/settings.json with the bridge hook', async () => {
  const { spawnFn, last } = fakeSpawner();
  // Real temp cwd so #installHook can write the file there.
  const cwd = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    const adapter = new GeminiAdapter({
      binaryPath: 'gemini',
      spawnFn,
      permissionMode: 'interactive',
      approvalHook: {
        token: 'tok',
        scriptPath: 'C:/hook.cjs',
        url: () => 'http://127.0.0.1:19850/agent-hook/approval',
      },
    });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 'th', turnId: 'u', text: 'go', cwd });
    // First turn installs the hook file before spawning the CLI.
    last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
    await done;
    const path = join(cwd, '.gemini', 'settings.json');
    assert.ok(existsSync(path), 'settings.json must be written');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const hooks = parsed['hooks'] as Record<string, unknown>;
    const beforeTool = hooks['BeforeTool'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(beforeTool));
    // Exactly one bridge entry (re-installs don't duplicate).
    const uxnanEntries = beforeTool.flatMap((e) => {
      const list = e['hooks'] as Array<Record<string, unknown>> | undefined;
      return list ?? [];
    });
    const ours = uxnanEntries.filter((h) => h['name'] === 'uxnan-approval');
    assert.equal(ours.length, 1);
    assert.equal(ours[0]!['type'], 'command');
    assert.match(ours[0]!['command'] as string, /hook\.cjs/);
    // Matchers catch every tool call.
    assert.equal(beforeTool[beforeTool.length - 1]!['matcher'], '.*');
  } finally {
    // Best-effort cleanup.
    try {
      const { rmSync } = await import('node:fs');
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('interactive mode preserves existing user settings when merging the bridge hook', async () => {
  const { spawnFn, last } = fakeSpawner();
  const cwd = mkdtempSync(join(tmpdir(), 'gemini-hook-'));
  try {
    // Seed the file with a theme + an unrelated hook (NOT ours).
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(cwd, '.gemini'), { recursive: true });
    writeFileSync(
      join(cwd, '.gemini', 'settings.json'),
      JSON.stringify({
        ui: { theme: 'Dracula' },
        hooks: {
          BeforeAgent: [
            {
              hooks: [{ type: 'command', name: 'user-hook', command: 'echo hi' }],
            },
          ],
          BeforeTool: [
            // a stale uxnan-approval from a previous install: should be replaced
            {
              matcher: '.*',
              hooks: [{ type: 'command', name: 'uxnan-approval', command: 'OLD' }],
            },
          ],
        },
      }),
    );
    const adapter = new GeminiAdapter({
      binaryPath: 'gemini',
      spawnFn,
      permissionMode: 'interactive',
      approvalHook: {
        token: 'tok',
        scriptPath: 'C:/hook.cjs',
        url: () => 'http://127.0.0.1:19850/agent-hook/approval',
      },
    });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 'th', turnId: 'u', text: 'go', cwd });
    last().feed(['{"type":"result","status":"success","stats":{"total_tokens":1}}']);
    await done;
    const parsed = JSON.parse(
      readFileSync(join(cwd, '.gemini', 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>;
    // User theme preserved.
    const ui = parsed['ui'] as Record<string, unknown>;
    assert.equal(ui['theme'], 'Dracula');
    // User's unrelated hook preserved.
    const hooks = parsed['hooks'] as Record<string, unknown>;
    const beforeAgent = hooks['BeforeAgent'] as Array<Record<string, unknown>>;
    assert.equal(beforeAgent.length, 1);
    // Stale uxnan-approval entry replaced (not duplicated) with the fresh one.
    const beforeTool = hooks['BeforeTool'] as Array<Record<string, unknown>>;
    const uxnanCount = beforeTool.flatMap((e) => {
      const list = e['hooks'] as Array<Record<string, unknown>> | undefined;
      return (list ?? []).filter((h) => h['name'] === 'uxnan-approval');
    }).length;
    assert.equal(uxnanCount, 1, 'stale uxnan-approval should be replaced, not duplicated');
    // The remaining entry must reference the NEW script path.
    const lastEntry = beforeTool[beforeTool.length - 1]!;
    const lastHooks = lastEntry['hooks'] as Array<Record<string, unknown>>;
    const lastUxn = lastHooks.find((h) => h['name'] === 'uxnan-approval');
    assert.equal(lastUxn?.['type'], 'command');
    assert.match(lastUxn?.['command'] as string, /C:\/hook\.cjs/);
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
