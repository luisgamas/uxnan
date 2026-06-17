import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { GeminiAdapter, parseGeminiLine, type SpawnedProcess } from '../../src/index.js';
import { geminiToolBlock, isInternalGeminiTool } from '../../src/adapters/gemini-tools.js';
import type { AgentStreamEvent } from '@uxnan/shared';

interface FakeSpawn {
  args: string[];
  feed(lines: string[]): void;
}

function fakeSpawner(): {
  spawnFn: (command: string, args: string[], cwd: string) => SpawnedProcess;
  last(): FakeSpawn;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (_command: string, args: string[]): SpawnedProcess => {
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
