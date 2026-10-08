import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import {
  ClaudeCodeAdapter,
  claudeContextWindow,
  claudeModels,
  claudeUsageTokens,
  parseClaudeLine,
  type SpawnedProcess,
} from '../../src/index.js';
import {
  parseInitializeCommands,
  parseInitializeModels,
} from '../../src/adapters/claude-adapter.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `claude` process whose stdout we feed with stream-json lines ---
interface FakeSpawn {
  args: string[];
  env?: Record<string, string>;
  /** Whether the spawn asked for a writable stdin (`--input-format stream-json`). */
  pipedStdin: boolean;
  /** User message texts written to stdin, in order — the prompt, then any follow-up. */
  sent: string[];
  /** True once the adapter closed the pipe; the CLI only exits after this. */
  stdinEnded: boolean;
  feed(lines: string[]): void;
  /** Feed lines WITHOUT ending stdout, so the turn stays open (steering tests). */
  feedOpen(lines: string[]): void;
  /**
   * Stop echoing messages as they are written (the real CLI echoes each one
   * when it READS it, which can be after a `result` it was running already).
   */
  holdEcho(): void;
  /** Echo every held message now, in order. */
  releaseEcho(): void;
}

function fakeSpawner(options: { holdEcho?: boolean } = {}): {
  spawnFn: (
    command: string,
    args: string[],
    cwd: string,
    extra?: { env?: Record<string, string>; stdin?: 'pipe' | 'ignore' },
  ) => SpawnedProcess;
  last(): FakeSpawn;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (
    _command: string,
    args: string[],
    _cwd: string,
    extra?: { env?: Record<string, string>; stdin?: 'pipe' | 'ignore' },
  ): SpawnedProcess => {
    const stdout = new PassThrough();
    const emitter = new EventEmitter();
    stdout.on('end', () => emitter.emit('close', 0));
    // Like `claude --replay-user-messages`: each message written to stdin comes
    // back on stdout with its uuid and `isReplay: true` once the CLI reads it.
    let holding = options.holdEcho === true;
    const held: string[] = [];
    const echo = (uuid: string) => {
      const line = JSON.stringify({ type: 'user', uuid, isReplay: true, session_id: 's' });
      if (holding) held.push(line);
      else if (!stdout.writableEnded) stdout.write(`${line}\n`);
    };
    const record: FakeSpawn = {
      args,
      ...(extra?.env ? { env: extra.env } : {}),
      pipedStdin: extra?.stdin === 'pipe',
      sent: [],
      stdinEnded: false,
      feed: (lines) => {
        for (const line of lines) stdout.write(`${line}\n`);
        stdout.end();
      },
      feedOpen: (lines) => {
        for (const line of lines) stdout.write(`${line}\n`);
      },
      holdEcho: () => {
        holding = true;
      },
      releaseEcho: () => {
        holding = false;
        for (const line of held.splice(0)) stdout.write(`${line}\n`);
      },
    };
    // Mirrors the real pipe: each line is one stream-json user message, and
    // `end()` is what lets the CLI finish (it waits for more input otherwise).
    // Read synchronously, so the echo lands before any line a test feeds next.
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line) as {
            uuid?: string;
            message?: { content?: { type: string; text?: string }[] };
          };
          const text = (parsed.message?.content ?? [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('');
          record.sent.push(text);
          if (parsed.uuid) echo(parsed.uuid);
        }
        callback();
      },
      final(callback) {
        record.stdinEnded = true;
        callback();
      },
    });
    const proc: SpawnedProcess = {
      stdout,
      ...(extra?.stdin === 'pipe' ? { stdin } : {}),
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
    spawns.push(record);
    return proc;
  };
  return { spawnFn, last: () => spawns[spawns.length - 1]! };
}

/** Let the fake stdin's 'data' listeners run before asserting on `sent`. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function collect(adapter: ClaudeCodeAdapter): {
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

test('parseClaudeLine maps the documented event shapes', () => {
  assert.equal(parseClaudeLine('not json'), null);
  assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s"}'), {
    kind: 'init',
    sessionId: 's',
  });
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"system","subtype":"compact_boundary","session_id":"s","compact_metadata":{"trigger":"manual","pre_tokens":12345}}',
    ),
    {
      kind: 'compaction',
      sessionId: 's',
      compactionReason: 'manual',
      tokensBefore: 12345,
    },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}',
    ),
    { kind: 'delta', sessionId: 's', text: 'hi' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}}',
    ),
    { kind: 'thinking', sessionId: 's', text: 'hmm' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"done"}]}}',
    ),
    { kind: 'assistant_text', sessionId: 's', text: 'done' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"result","subtype":"success","is_error":false,"result":"final","session_id":"s"}',
    ),
    { kind: 'result', sessionId: 's', text: 'final', isError: false },
  );
  // a result with is_error or a non-success subtype is an error
  assert.equal(
    parseClaudeLine('{"type":"result","subtype":"error_during_execution","session_id":"s"}')
      ?.isError,
    true,
  );
  // message_start / content_block_start and other stream events are inert
  assert.equal(
    parseClaudeLine('{"type":"stream_event","event":{"type":"message_start"}}')?.kind,
    'other',
  );
});

test('ClaudeCodeAdapter emits compact_boundary as a compaction block', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: '/compact' });
  last().feed([
    '{"type":"system","subtype":"compact_boundary","session_id":"s","compact_metadata":{"trigger":"manual","pre_tokens":12345}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Compacted","session_id":"s"}',
  ]);

  const events = await done;
  const block = events.find((event) => event.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.deepEqual(block?.content, {
    type: 'compaction',
    reason: 'manual',
    tokensBefore: 12345,
  });
});

test('ClaudeCodeAdapter streams text_delta as deltas and completes with the result text', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', defaultModel: 'opus', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"sess_1","model":"claude-opus-4-8"}',
    '{"type":"stream_event","session_id":"sess_1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}',
    '{"type":"stream_event","session_id":"sess_1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}',
    '{"type":"assistant","session_id":"sess_1","message":{"content":[{"type":"text","text":"Hello world"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Hello world","session_id":"sess_1"}',
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  // partial deltas streamed; the complete assistant message must NOT be re-emitted
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');
  // first turn used the configured model and no --resume yet
  const args = last().args;
  assert.ok(args.includes('--model'));
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.equal(args.includes('--resume'), false);
  // The prompt travels on stdin as a stream-json message, never as argv (and so
  // never near a shell) — that open pipe is what `steerTurn` writes into.
  assert.ok(args.includes('--input-format'));
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args.includes('hi'), false);
  assert.equal(last().pipedStdin, true);
  await flush();
  assert.deepEqual(last().sent, ['hi']);
  // …and the pipe is closed once the turn ends, or the CLI would wait forever.
  assert.equal(last().stdinEnded, true);
});

test('ClaudeCodeAdapter streams thinking_delta as thinking events, separate from text', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me "}}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"think."}}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Answer","session_id":"s"}',
  ]);

  const events = await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['Let me ', 'think.']);
  // thinking is NOT mixed into the answer deltas
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Answer']);
});

test('ClaudeCodeAdapter pairs tool_use with tool_result and emits structured blocks', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'do it' });
  last().feed([
    // assistant message carries the (complete) tool_use inputs
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"type a.txt"}},{"type":"tool_use","id":"tu_2","name":"Edit","input":{"file_path":"a.dart","old_string":"x","new_string":"y"}}]}}',
    // the tool results come back in user messages
    '{"type":"user","session_id":"s","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"hello"}]}}',
    '{"type":"user","session_id":"s","message":{"content":[{"type":"tool_result","tool_use_id":"tu_2","content":""}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"s"}',
  ]);

  const events = await done;
  const blocks = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content);
  // The command shows as it starts (the edit only once done: its diff), and
  // each result replaces its step by the tool_use id.
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], {
    type: 'command_execution',
    command: 'type a.txt',
    status: 'running',
    blockId: 'tu_1',
  });
  assert.deepEqual(blocks[1], {
    type: 'command_execution',
    command: 'type a.txt',
    status: 'completed',
    output: 'hello',
    blockId: 'tu_1',
  });
  assert.equal(blocks[2]?.['type'], 'diff');
  assert.equal(blocks[2]?.['filename'], 'a.dart');
  assert.equal(blocks[2]?.['blockId'], 'tu_2');
});

test('ClaudeCodeAdapter falls back to the assistant message when no token deltas stream', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"assistant","session_id":"sess_2","message":{"content":[{"type":"text","text":"only chunk"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"only chunk","session_id":"sess_2"}',
  ]);

  const events = await done;
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['only chunk']);
});

test('ClaudeCodeAdapter reuses the captured session id on the next turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  last().feed(['{"type":"result","subtype":"success","result":"a","session_id":"sess_42"}']);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const argsForSecond = last().args;
  last().feed(['{"type":"result","subtype":"success","result":"b","session_id":"sess_42"}']);
  await second.done;

  const idx = argsForSecond.indexOf('--resume');
  assert.notEqual(idx, -1);
  assert.equal(argsForSecond[idx + 1], 'sess_42');
});

// After a restart (or when a conversation takes over a terminal's session) the
// bridge hands the stored id back: the very first turn resumes it.
test('ClaudeCodeAdapter resumes an adopted session on its first turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  adapter.adoptNativeSession('t1', 'sess_stored');

  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go on' });
  const args = last().args;
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"sess_stored"}']);
  await done;

  assert.equal(args[args.indexOf('--resume') + 1], 'sess_stored');
  assert.equal(adapter.nativeSessionId('t1'), 'sess_stored');
});

// The CLI's own answer for a session that no longer exists (verified against
// claude 2.1.283). Nothing ran, so the same turn runs again in a new session
// instead of failing — and the gone id is never adopted again.
test('ClaudeCodeAdapter runs the turn in a fresh session when the stored one is gone', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  adapter.adoptNativeSession('t1', 'sess_gone');

  const { events, done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'still there?' });
  const refused = last();
  assert.equal(refused.args[refused.args.indexOf('--resume') + 1], 'sess_gone');
  refused.feed([
    '{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"session_id":"sess_gone","errors":["No conversation found with session ID: sess_gone"]}',
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  const retried = last();
  assert.notEqual(retried, refused);
  assert.equal(retried.args.includes('--resume'), false);
  await flush();
  assert.deepEqual(retried.sent, ['still there?']);
  retried.feed(['{"type":"result","subtype":"success","result":"yes","session_id":"sess_new"}']);
  await done;

  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
  );
  assert.equal(events.at(-1)?.type, 'turn_completed');
  assert.equal(adapter.nativeSessionId('t1'), 'sess_new');
  // The store still holds the gone id until the new one is persisted: offering
  // it again changes nothing.
  adapter.adoptNativeSession('t1', 'sess_gone');
  assert.equal(adapter.nativeSessionId('t1'), 'sess_new');
});

test('ClaudeCodeAdapter surfaces an error result as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom","session_id":"sess_1"}',
  ]);

  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'boom');
});

test('every access mode runs on its own CLI flag, the same on every turn', async () => {
  const hook = {
    token: 't',
    scriptPath: 'C:/h.cjs',
    url: () => 'http://127.0.0.1:19850/agent-hook/approval',
  };
  const cases = [
    { accessMode: 'approveForMe' as const, flags: ['--permission-mode', 'auto'] },
    { accessMode: 'fullAccess' as const, flags: ['--dangerously-skip-permissions'] },
    { accessMode: 'plan' as const, flags: ['--permission-mode', 'plan'] },
  ];
  for (const { accessMode, flags } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn, approvalHook: hook });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', accessMode });
    last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
    await done;
    const args = last().args;
    const at = args.indexOf(flags[0]!);
    assert.ok(at >= 0, `${accessMode} passes ${flags.join(' ')}`);
    assert.deepEqual(args.slice(at, at + flags.length), flags);
    // Only "request approval" asks the person, through the hook.
    assert.equal(args.includes('--settings'), false, `${accessMode} carries no hook`);
  }
});

test('Claude Code offers "request approval" only when the bridge can serve its hook', () => {
  const withHook = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    approvalHook: { token: 't', scriptPath: 'C:/h.cjs', url: () => undefined },
  });
  assert.deepEqual(withHook.capabilities.accessModes, [
    'requestApproval',
    'approveForMe',
    'fullAccess',
    'plan',
  ]);
  const without = new ClaudeCodeAdapter({ binaryPath: 'claude' });
  assert.deepEqual(without.capabilities.accessModes, ['approveForMe', 'fullAccess', 'plan']);
  assert.equal(without.capabilities.defaultAccessMode, 'fullAccess');
});

test('a turn the CLI runs in another mode than asked says so', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', accessMode: 'approveForMe' });
  // Measured on claude 2.1.287: `--permission-mode auto` with haiku starts in
  // `default`, which declines anything needing approval.
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s","model":"claude-haiku-4-5","permissionMode":"default"}',
    '{"type":"system","subtype":"init","session_id":"s","permissionMode":"default"}',
    '{"type":"result","subtype":"success","result":"ok","session_id":"s"}',
  ]);
  const events = await done;
  const warnings = events.filter(
    (e) =>
      e.type === 'block' && (e.data as { content?: { kind?: string } }).content?.kind === 'warning',
  );
  assert.equal(warnings.length, 1, 'once per turn');
  assert.match(
    (warnings[0]?.data as { content: { text: string } }).content.text,
    /"default" mode, not "auto" — automatic review is not available/,
  );
});

test('ClaudeCodeAdapter passes the reasoning effort as --effort', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', effort: 'high' });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.ok(args.includes('--effort'));
  assert.equal(args[args.indexOf('--effort') + 1], 'high');
});

test('ClaudeCodeAdapter omits --effort when none is set', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  assert.equal(last().args.includes('--effort'), false);
});

test('ClaudeCodeAdapter maps the reasoning knob (options) to --effort', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    options: { reasoning: 'max' },
  });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.equal(args[args.indexOf('--effort') + 1], 'max');
});

/**
 * The `models` claude 2.1.293 answered `initialize` with on a Max account,
 * verbatim (captured 2026-10-07 with `claude -p --input-format stream-json
 * --output-format stream-json --verbose` and a bare `initialize` request).
 */
const INITIALIZE_MODELS_2_1_293 = [
  {
    value: 'default',
    resolvedModel: 'claude-sonnet-5-5',
    displayName: 'Default (recommended)',
    description: 'Sonnet 5.5 · Efficient for routine tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    description: 'For complex work and everyday tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'fable',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable 5.1',
    description: 'For your toughest challenges',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5-5',
    displayName: 'Sonnet 5.5',
    description: 'Most efficient for simpler tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-5-5',
    displayName: 'Haiku 5.5',
    description: 'Fastest for quick answers',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-haiku-4-5-20251001',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    description: 'Fastest for quick answers',
  },
  {
    value: 'claude-sonnet-5',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet 5',
    description: 'Efficient for routine tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-opus-5',
    resolvedModel: 'claude-opus-5',
    displayName: 'Opus 5',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-fable-5',
    resolvedModel: 'claude-fable-5',
    displayName: 'Fable 5',
    description: 'Most capable for your hardest and longest-running tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-opus-4-8',
    resolvedModel: 'claude-opus-4-8',
    displayName: 'Opus 4.8',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-opus-4-7',
    resolvedModel: 'claude-opus-4-7',
    displayName: 'Opus 4.7',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-opus-4-6',
    resolvedModel: 'claude-opus-4-6',
    displayName: 'Opus 4.6',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-sonnet-4-6',
    resolvedModel: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    description: 'Efficient for routine tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
];

/** A spawner whose CLI answers `initialize` with [models] (and counts the asks). */
function initializeSpawner(models: unknown[] = INITIALIZE_MODELS_2_1_293): {
  spawnFn: (command: string, args: string[], cwd: string) => SpawnedProcess;
  calls: { args: string[]; cwd: string; written: string[] }[];
} {
  return commandsSpawner({
    subtype: 'success',
    request_id: 'uxnan-initialize',
    response: { commands: [], models },
  });
}

test('ClaudeCodeAdapter lists the models as the CLI does: current ones by alias, older ids after', async () => {
  const { spawnFn, calls } = initializeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((m) => [m.id, m.displayName]),
    [
      ['opus', 'Opus 5.5'],
      ['fable', 'Fable 5.1'],
      ['sonnet', 'Sonnet 5.5'],
      ['haiku', 'Haiku 5.5'],
      ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
      ['claude-sonnet-5', 'Sonnet 5'],
      ['claude-opus-5', 'Opus 5'],
      ['claude-fable-5', 'Fable 5'],
      ['claude-opus-4-8', 'Opus 4.8'],
      ['claude-opus-4-7', 'Opus 4.7'],
      ['claude-opus-4-6', 'Opus 4.6'],
      ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ],
  );
  const opus = models.find((m) => m.id === 'opus');
  // An alias is the moving target, and says what it runs today.
  assert.equal(opus?.isLatestAlias, true);
  assert.equal(opus?.version, 'claude-opus-5-5');
  assert.equal(opus?.description, 'For complex work and everyday tasks');
  // Each model once: the current ones only through their alias.
  assert.equal(
    models.some((m) => m.id === 'claude-opus-5-5'),
    false,
  );
  // What no alias runs today is an older model; what an alias runs is current.
  assert.deepEqual(
    models.filter((m) => m.isLegacy).map((m) => m.id),
    [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ],
  );
  // The CLI's own `default` is what picking nothing runs, not a row.
  assert.equal(
    models.some((m) => m.id === 'default'),
    false,
  );
  // Asked once, with the same `initialize` the commands come from.
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.written.join(''), /"subtype":"initialize"/);
});

test('ClaudeCodeAdapter marks as default what a turn with no model runs', async () => {
  const { spawnFn } = initializeSpawner();
  const models = await new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn }).listModels();
  // `default` resolves to Sonnet 5.5: the first entry that runs it is the alias.
  assert.deepEqual(
    models.filter((m) => m.isDefault).map((m) => m.id),
    ['sonnet'],
  );
  // A default the bridge is configured with wins over the CLI's.
  const configured = await new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn: initializeSpawner().spawnFn,
    defaultModel: 'claude-opus-4-8',
  }).listModels();
  assert.deepEqual(
    configured.filter((m) => m.isDefault).map((m) => m.id),
    ['claude-opus-4-8'],
  );
});

test('ClaudeCodeAdapter offers each model exactly the effort levels it reports', async () => {
  const { spawnFn } = initializeSpawner();
  const models = await new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn }).listModels();
  const levels = (id: string): string[] | undefined =>
    models
      .find((m) => m.id === id)
      ?.options?.find((o) => o.key === 'reasoning')
      ?.values?.map((v) => v.value);
  assert.deepEqual(levels('opus'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levels('haiku'), ['low', 'medium', 'high', 'xhigh', 'max']);
  // Opus 4.6 and Sonnet 4.6 stop short of `xhigh`.
  assert.deepEqual(levels('claude-opus-4-6'), ['low', 'medium', 'high', 'max']);
  assert.deepEqual(levels('claude-sonnet-4-6'), ['low', 'medium', 'high', 'max']);
  // Haiku 4.5 reports no effort at all, so it gets no knob.
  assert.equal(models.find((m) => m.id === 'claude-haiku-4-5-20251001')?.options, undefined);
  // The default the bridge sends is the one the knob shows.
  const knob = models.find((m) => m.id === 'opus')?.options?.[0];
  assert.equal(knob?.kind, 'enum');
  assert.equal(knob?.default, 'high');
});

test('claudeModels leaves the default unset when the model offers no `high`', () => {
  const [model] = claudeModels([
    {
      value: 'claude-x',
      resolvedModel: 'claude-x',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium'],
    },
  ]);
  assert.equal(model?.options?.[0]?.default, undefined);
  // With no alias to compare against, nothing is called older.
  assert.equal(model?.isLegacy, undefined);
  assert.deepEqual(
    model?.options?.[0]?.values?.map((v) => v.value),
    ['low', 'medium'],
  );
});

test('ClaudeCodeAdapter appends pinned models the CLI does not list', async () => {
  const { spawnFn } = initializeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    defaultModel: 'claude-opus-4-5',
    pinnedModels: [
      { id: 'claude-opus-4-5', displayName: 'Opus 4.5' },
      { id: 'claude-sonnet-4-5' },
      // already listed by the CLI → its entry wins
      { id: 'claude-opus-4-8', displayName: 'My Opus' },
      { id: '   ' }, // blank → skipped
    ],
  });
  const models = await adapter.listModels();
  assert.deepEqual(
    models.slice(-2).map((m) => [m.id, m.displayName]),
    [
      ['claude-opus-4-5', 'Opus 4.5'],
      ['claude-sonnet-4-5', 'claude-sonnet-4-5'],
    ],
  );
  assert.equal(models.find((m) => m.id === 'claude-opus-4-8')?.displayName, 'Opus 4.8');
  assert.equal(models.find((m) => m.id === 'claude-opus-4-5')?.isDefault, true);
  // Nothing is known of a pinned model's effort, so none is offered.
  assert.equal(models.find((m) => m.id === 'claude-opus-4-5')?.options, undefined);
});

test('ClaudeCodeAdapter reuses the model list, and a CLI that will not say leaves the pins', async () => {
  const { spawnFn, calls } = initializeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  await Promise.all([adapter.listModels(), adapter.listModels()]);
  await adapter.listModels();
  assert.equal(calls.length, 1);

  const silent = (): SpawnedProcess => {
    const emitter = new EventEmitter();
    setImmediate(() => emitter.emit('close', 1));
    return {
      stdout: new PassThrough(),
      stdin: new PassThrough(),
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => undefined,
    } as SpawnedProcess;
  };
  const broken = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn: silent,
    pinnedModels: [{ id: 'claude-opus-4-8' }],
  });
  assert.deepEqual(
    (await broken.listModels()).map((m) => m.id),
    ['claude-opus-4-8'],
  );
});

test('ClaudeCodeAdapter keeps the models a command listing brought along', async () => {
  const { spawnFn, calls } = initializeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  await adapter.listCommands('/repo');
  assert.ok((await adapter.listModels()).some((m) => m.id === 'opus'));
  // One `initialize` answered both.
  assert.equal(calls.length, 1);
});

test('parseInitializeModels reads only the initialize answer', () => {
  assert.equal(parseInitializeModels('{"type":"system","subtype":"init"}'), undefined);
  assert.equal(parseInitializeModels('not json'), undefined);
  assert.deepEqual(
    parseInitializeModels(
      JSON.stringify({
        type: 'control_response',
        response: {
          response: {
            models: [
              { value: 'opus', resolvedModel: 'claude-opus-5-5', supportsEffort: true },
              { displayName: 'no value' },
              { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
            ],
          },
        },
      }),
    ),
    [
      { value: 'opus', resolvedModel: 'claude-opus-5-5', supportsEffort: true },
      { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
    ],
  );
});

test('claudeContextWindow takes the window the turn reported for its own model', () => {
  const windows = { 'claude-opus-5-5': 1_000_000, 'claude-haiku-4-5-20251001': 200_000 };
  assert.equal(claudeContextWindow(windows, 'claude-opus-5-5'), 1_000_000);
  assert.equal(claudeContextWindow(windows, 'claude-haiku-4-5-20251001'), 200_000);
  // A routing suffix on either side still names the same model.
  assert.equal(claudeContextWindow(windows, 'claude-opus-5-5[1m]'), 1_000_000);
  assert.equal(claudeContextWindow({ 'claude-opus-5[1m]': 1_000_000 }, 'claude-opus-5'), 1_000_000);
  // Two models and none of them the turn's: no guess.
  assert.equal(claudeContextWindow(windows, 'claude-sonnet-5'), undefined);
  // A lone entry is the turn's.
  assert.equal(claudeContextWindow({ 'claude-haiku-5-5': 1_000_000 }, undefined), 1_000_000);
  assert.equal(claudeContextWindow(undefined, 'claude-opus-5-5'), undefined);
});

test('claudeUsageTokens sums input, cache and output tokens', () => {
  assert.equal(
    claudeUsageTokens({
      input_tokens: 100,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
      output_tokens: 30,
    }),
    155,
  );
  assert.equal(claudeUsageTokens({}), undefined);
  assert.equal(claudeUsageTokens('nope'), undefined);
});

test('ClaudeCodeAdapter reports usage with a context window on completion', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s","model":"claude-opus-4-8"}',
    '{"type":"result","subtype":"success","result":"ok","session_id":"s","usage":' +
      '{"input_tokens":1000,"cache_read_input_tokens":200,"output_tokens":50},' +
      '"modelUsage":{"claude-opus-4-8":{"inputTokens":1000,"contextWindow":1000000},' +
      '"claude-haiku-4-5-20251001":{"inputTokens":10,"contextWindow":200000}}}',
  ]);

  const events = await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  const usage = (completed?.data as { usage?: { tokens: number; contextWindow?: number } }).usage;
  assert.equal(usage?.tokens, 1250);
  assert.equal(usage?.contextWindow, 1_000_000);
});

test('ClaudeCodeAdapter falls back to assistant usage when the result omits it', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s","model":"claude-sonnet-4-6"}',
    // assistant message carries usage; the result event below omits it
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":12000,"output_tokens":300}}}',
    '{"type":"result","subtype":"success","result":"hi","session_id":"s"}',
  ]);

  const events = await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  const usage = (completed?.data as { usage?: { tokens: number } }).usage;
  assert.equal(usage?.tokens, 12300);
});

test('ClaudeCodeAdapter keeps the full streamed text when result.result is only the final part', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Let me check. "}}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"The answer is 42."}}}',
    // result.result is only the final segment — the streamed narration is longer
    '{"type":"result","subtype":"success","result":"The answer is 42.","session_id":"s"}',
  ]);

  const events = await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  // The full streamed text is kept (not shrunk to result.result), so it can't
  // disappear on a later re-sync.
  assert.equal((completed?.data as { text: string }).text, 'Let me check. The answer is 42.');
});

test('ClaudeCodeAdapter preserves every assistant envelope and its boundary', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Checking."}}}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Checking."}]}}',
    // This second envelope has no partial event: it must not be skipped merely
    // because the first envelope streamed.
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Done."}]}}',
    '{"type":"result","subtype":"success","result":"Done.","session_id":"s"}',
  ]);

  const events = await done;
  assert.deepEqual(
    events.filter((event) => event.type === 'delta').map((event) => (event.data as any).text),
    ['Checking.', 'Done.'],
  );
  assert.equal(events.filter((event) => event.type === 'block').length, 2);
  assert.equal(
    (events.find((event) => event.type === 'turn_completed')?.data as { text: string }).text,
    'Checking.Done.',
  );
});

test('parseClaudeLine extracts the resolved model from the init event', () => {
  assert.equal(
    parseClaudeLine('{"type":"system","subtype":"init","session_id":"s","model":"claude-opus-4-8"}')
      ?.model,
    'claude-opus-4-8',
  );
});

test('ClaudeCodeAdapter emits model_resolved from the init event', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s","model":"claude-opus-4-8"}',
    '{"type":"result","subtype":"success","result":"ok","session_id":"s"}',
  ]);

  const events = await done;
  const resolved = events.find((e) => e.type === 'model_resolved');
  assert.equal((resolved?.data as { text: string }).text, 'claude-opus-4-8');
});

test('request approval injects the PreToolUse hook (--settings + --permission-mode) and env', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    approvalHook: {
      token: 'tok-123',
      scriptPath: 'C:/Users/x/.uxnan/hooks/claude-approval-hook.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 'thread-1',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  last().feed([
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s"}',
  ]);
  await done;

  const args = last().args;
  // The hook settings are injected, and default permission mode lets the hook run.
  const settingsIdx = args.indexOf('--settings');
  assert.ok(settingsIdx >= 0);
  assert.match(args[settingsIdx + 1]!, /PreToolUse/);
  assert.match(args[settingsIdx + 1]!, /claude-approval-hook\.cjs/);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
  // The per-turn env carries the endpoint URL, token and threadId for the hook.
  assert.equal(last().env?.UXNAN_HOOK_THREAD_ID, 'thread-1');
  assert.equal(last().env?.UXNAN_HOOK_TOKEN, 'tok-123');
  assert.match(last().env?.UXNAN_HOOK_URL ?? '', /agent-hook\/approval/);
});

test('request approval before the hook endpoint exists fails the turn instead of running unasked', async () => {
  const fake = fakeSpawner();
  let spawned = 0;
  const spawnFn: typeof fake.spawnFn = (...args) => {
    spawned += 1;
    return fake.spawnFn(...args);
  };
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    approvalHook: { token: 't', scriptPath: 'C:/h.cjs', url: () => undefined },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'go', accessMode: 'requestApproval' });
  const events = await done;
  assert.equal(spawned, 0, 'nothing ran');
  assert.match(
    String((events.find((e) => e.type === 'turn_error')?.data as { text: string }).text),
    /cannot ask for approval yet/,
  );
});

test('parseClaudeLine surfaces subagent parentage and content-block boundaries', () => {
  // subagent lines carry parent_tool_use_id
  assert.equal(
    parseClaudeLine(
      '{"type":"user","session_id":"s","parent_tool_use_id":"task_1","message":{"content":[{"type":"tool_result","tool_use_id":"tu_9","content":"x"}]}}',
    )?.parentToolUseId,
    'task_1',
  );
  // content_block_start/stop expose the index + block type for text-run tracking
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}}',
    ),
    {
      kind: 'other',
      sessionId: 's',
      streamType: 'content_block_start',
      blockIndex: 1,
      blockType: 'text',
    },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_stop","index":1}}',
    ),
    { kind: 'other', sessionId: 's', streamType: 'content_block_stop', blockIndex: 1 },
  );
  // delta events carry their content-block index
  assert.equal(
    parseClaudeLine(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hi"}}}',
    )?.blockIndex,
    1,
  );
});

test('ClaudeCodeAdapter flags a subagent block landing mid-text as beforeText', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go' });
  last().feed([
    // a parallel subagent (Task) registers its own tool_use…
    '{"type":"assistant","session_id":"s","parent_tool_use_id":"task_1","message":{"content":[{"type":"tool_use","id":"tu_sub","name":"Bash","input":{"command":"ls"}}]}}',
    // …the main text starts streaming
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"y si re"}}}',
    // …and the subagent result arrives MID-RUN (parallel activity)
    '{"type":"user","session_id":"s","parent_tool_use_id":"task_1","message":{"content":[{"type":"tool_result","tool_use_id":"tu_sub","content":"ok"}]}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"porta"}}}',
    '{"type":"stream_event","session_id":"s","event":{"type":"content_block_stop","index":0}}',
    // a sequential MAIN tool after the text closed keeps plain arrival order
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"y si reporta"},{"type":"tool_use","id":"tu_main","name":"Bash","input":{"command":"pwd"}}]}}',
    '{"type":"user","session_id":"s","message":{"content":[{"type":"tool_result","tool_use_id":"tu_main","content":"/"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"y si reporta","session_id":"s"}',
  ]);

  const events = await done;
  const blocks = events.filter((e) => e.type === 'block');
  // The finished steps (each also showed as running when it started).
  const activityBlocks = blocks.filter((event) => {
    const content = (event.data as { content: { type?: string; status?: string } }).content;
    return content.type !== 'assistant_response_boundary' && content.status !== 'running';
  });
  const boundaries = blocks.filter(
    (event) =>
      (event.data as { content: { type?: string } }).content.type === 'assistant_response_boundary',
  );
  assert.equal(activityBlocks.length, 2);
  assert.equal(boundaries.length, 1);
  // the subagent block that landed mid-run is flagged beforeText…
  assert.equal((activityBlocks[0]!.data as { beforeText?: boolean }).beforeText, true);
  // …the sequential main block is not
  assert.equal((activityBlocks[1]!.data as { beforeText?: boolean }).beforeText, undefined);
  // and the main text run streamed whole, never polluted by subagent content
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['y si re', 'porta']);
});

test('ClaudeCodeAdapter never folds subagent text or usage into the main message', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go' });
  last().feed([
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"main answer"}],"usage":{"input_tokens":10,"output_tokens":5}}}',
    // subagent narration + usage after the main message: neither may leak into
    // the main deltas (the no-partials fallback) or the usage fallback
    '{"type":"assistant","session_id":"s","parent_tool_use_id":"task_1","message":{"content":[{"type":"text","text":"subagent inner monologue"}],"usage":{"input_tokens":999999}}}',
    '{"type":"result","subtype":"success","is_error":false,"session_id":"s"}',
  ]);

  const events = await done;
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['main answer']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { usage?: { tokens: number } }).usage?.tokens, 15);
});

// --- background tasks: the turn is not over while the CLI still has work ---
//
// The shapes below are the ones a real `claude -p --output-format stream-json`
// emits when the model starts a background task (`Bash` with
// `run_in_background`) and then ends its turn: while its input stays open the
// CLI keeps running for as long as that work takes, and when it finishes it
// WAKES THE MODEL and a second complete turn follows on the same process. A
// task ends `completed` (exit 0), `failed` (exit ≠ 0 — its work did finish) or
// `stopped`: by the model or the user while the run goes on, or by the CLI
// itself once its input is closed — the only case where work is lost.

/** Collect a whole run, settling only after a terminal event has had time to be
 *  followed by another one — the duplicate completion is the bug under test. */
function collectRun(adapter: ClaudeCodeAdapter): { done: Promise<AgentStreamEvent[]> } {
  const events: AgentStreamEvent[] = [];
  let resolve!: (e: AgentStreamEvent[]) => void;
  const done = new Promise<AgentStreamEvent[]>((r) => (resolve = r));
  adapter.onEvent((event) => {
    events.push(event);
    if (event.type === 'turn_completed' || event.type === 'turn_error') {
      setTimeout(() => resolve(events), 10);
    }
  });
  return { done };
}

/** The warning blocks emitted during a run. */
function warnings(events: AgentStreamEvent[]): AgentStreamEvent[] {
  return events.filter(
    (e) =>
      e.type === 'block' && (e.data as { content?: { kind?: string } }).content?.kind === 'warning',
  );
}

test('a turn is not completed while a background task the model started is still live', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'start it' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s","model":"claude-haiku-4-5-20251001"}',
    '{"type":"system","subtype":"background_tasks_changed","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"bkm","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Started it; I will report back. "}]}}',
    // The model's turn ends here — but the work it started is still running.
    '{"type":"result","subtype":"success","is_error":false,"result":"Started it; I will report back. ","session_id":"s"}',
    // The task finishes in time, so the CLI wakes the model for a second turn.
    '{"type":"system","subtype":"task_updated","task_id":"bkm","session_id":"s"}',
    '{"type":"system","subtype":"task_notification","status":"completed","task_id":"bkm","session_id":"s"}',
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"The job finished."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"The job finished.","session_id":"s"}',
  ]);

  const events = await done;
  const completions = events.filter((e) => e.type === 'turn_completed');
  // Exactly one. Completing at the first `result` ends the turn mid-work: the
  // phone drops its "responding" state, the queue drains a follow-up into a CLI
  // that is still running, and the wake-up turn lands on a closed turn.
  assert.equal(completions.length, 1);
  // And it carries BOTH replies — `result.result` only ever holds the latest
  // turn's text, so the first reply survives only in the accumulated narration.
  const text = (completions[0]?.data as { text: string }).text;
  assert.match(text, /Started it/);
  assert.match(text, /The job finished\./);
  assert.equal(warnings(events).length, 0, 'nothing was interrupted, so nothing is reported');
});

test('a wake-up that leaves more background work keeps the turn, and the input, open for it', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);
  let completions = 0;
  adapter.onEvent((event) => {
    if (event.type === 'turn_completed') completions += 1;
  });

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'wait for CI, then cut the release',
  });
  last().feedOpen([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"ci","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Waiting for CI. "}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Waiting for CI. ","session_id":"s"}',
    // CI finishes: the CLI wakes the model, which starts the next wait.
    '{"type":"system","subtype":"task_notification","status":"completed","task_id":"ci","session_id":"s"}',
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"release","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"CI is green; cutting the release. "}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"CI is green; cutting the release. ","session_id":"s"}',
  ]);
  await new Promise((r) => setTimeout(r, 20));
  // The run that lost work: the input closed when CI finished, so the CLI
  // stopped the release wait ~5 s later and the model never came back.
  assert.equal(last().stdinEnded, false, 'the CLI must still be able to wait for the release');
  assert.equal(completions, 0, 'the turn is still held for the release');

  last().feed([
    '{"type":"system","subtype":"task_notification","status":"completed","task_id":"release","session_id":"s"}',
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Released."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Released.","session_id":"s"}',
  ]);

  const events = await done;
  assert.equal(last().stdinEnded, true, 'the input closes once the turn completes');
  const completed = events.filter((e) => e.type === 'turn_completed');
  assert.equal(completed.length, 1);
  const text = (completed[0]?.data as { text: string }).text;
  assert.match(text, /Waiting for CI\./);
  assert.match(text, /cutting the release\./);
  assert.match(text, /Released\./);
  assert.equal(warnings(events).length, 0, 'every wait ran to the end');
});

test('a held turn whose CLI does not wake closes its input after the grace period', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn, wakeGraceMs: 30 });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'start it' });
  last().feedOpen([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"a","session_id":"s"}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Started it.","session_id":"s"}',
    '{"type":"system","subtype":"task_notification","status":"completed","task_id":"a","session_id":"s"}',
    // …and no wake-up follows.
  ]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(last().stdinEnded, false, 'a wake-up is still possible');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(last().stdinEnded, true, 'without one, the input closes so the run can end');

  last().feed([]); // the CLI exits
  const events = await done;
  const completed = events.filter((e) => e.type === 'turn_completed');
  assert.equal(completed.length, 1);
  assert.equal((completed[0]?.data as { text: string }).text, 'Started it.');
  assert.equal(warnings(events).length, 0);
});

test('a background task that failed, or that the model stopped, is not reported as interrupted', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'run the tests, and start the server then stop it',
  });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"tests","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"server","session_id":"s"}',
    // The model stops the server itself, while the run goes on.
    '{"type":"system","subtype":"task_notification","status":"stopped","task_id":"server","session_id":"s"}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Waiting for the tests.","session_id":"s"}',
    // The tests exit 1: finished, with a result the model reads.
    '{"type":"system","subtype":"task_notification","status":"failed","task_id":"tests","session_id":"s"}',
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Two tests fail."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Two tests fail.","session_id":"s"}',
  ]);

  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  assert.equal(warnings(events).length, 0, 'nothing the run left behind was cut off');
});

test('a background task still open when the CLI exits counts as interrupted', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"a","session_id":"s"}',
    '{"type":"result","subtype":"success","is_error":false,"result":"started","session_id":"s"}',
    // No notification at all — the process simply goes away with the task open.
  ]);

  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  assert.equal(warnings(events).length, 1);
});

test('a turn with no background task still completes at its result, unchanged', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Answer"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Answer","session_id":"s"}',
  ]);

  const events = await done;
  const completions = events.filter((e) => e.type === 'turn_completed');
  assert.equal(completions.length, 1);
  assert.equal((completions[0]?.data as { text: string }).text, 'Answer');
  assert.equal(warnings(events).length, 0);
});

test('parseClaudeLine tells background-task lines apart from an init', () => {
  // Every `system` line used to parse as `init`, which is how the background
  // signal was thrown away — and why a second `init` (the CLI waking the model)
  // was indistinguishable from a fresh session.
  assert.deepEqual(
    parseClaudeLine('{"type":"system","subtype":"task_started","task_id":"x","session_id":"s"}'),
    { kind: 'task_started', sessionId: 's', taskId: 'x' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"system","subtype":"task_notification","status":"completed","task_id":"x","session_id":"s"}',
    ),
    { kind: 'task_ended', sessionId: 's', taskId: 'x', taskStatus: 'completed' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"system","subtype":"task_notification","status":"stopped","task_id":"x","session_id":"s"}',
    ),
    { kind: 'task_ended', sessionId: 's', taskId: 'x', taskStatus: 'stopped' },
  );
  assert.deepEqual(
    parseClaudeLine(
      '{"type":"system","subtype":"task_notification","status":"failed","task_id":"x","session_id":"s"}',
    ),
    { kind: 'task_ended', sessionId: 's', taskId: 'x', taskStatus: 'failed' },
  );
  // A system line we do not act on must not masquerade as an init.
  assert.deepEqual(
    parseClaudeLine('{"type":"system","subtype":"background_tasks_changed","session_id":"s"}'),
    { kind: 'other', sessionId: 's' },
  );
  // The real init still parses exactly as before.
  assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s"}'), {
    kind: 'init',
    sessionId: 's',
  });
});

// --- mid-turn delivery (steering) -----------------------------------------
// The CLI reads follow-ups off the open stdin stream and takes them at the next
// tool boundary. Verified live against claude 2.1.220: a message sent 7s into a
// five-`sleep` turn was picked up after the first tool returned, the remaining
// sleeps were abandoned, and the run emitted a SINGLE `result`.

test('steerTurn writes a follow-up into the running turn, without a second process', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feedOpen(['{"type":"system","subtype":"init","session_id":"sess_1"}']);

  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'actually, do this instead',
  });
  await flush();

  assert.equal(taken, true);
  assert.deepEqual(proc.sent, ['first', 'actually, do this instead']);
  // Same process, same turn: no second spawn and no second --resume.
  assert.equal(last(), proc);
  assert.equal(proc.stdinEnded, false, 'the pipe stays open while the turn runs');

  proc.feed(['{"type":"result","subtype":"success","is_error":false,"result":"done"}']);
  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  await flush();
  assert.equal(proc.stdinEnded, true);
});

test('steerTurn declines once the turn has produced its result', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feed(['{"type":"result","subtype":"success","is_error":false,"result":"done"}']);
  await done;

  // Writing now would be read as a NEW turn on the same process, streaming a
  // second reply into a turn the bridge already closed.
  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'too late',
  });
  await flush();
  assert.equal(taken, false);
  assert.deepEqual(proc.sent, ['first']);
});

test('steerTurn declines for an unknown turn or a mismatched thread', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feedOpen(['{"type":"system","subtype":"init","session_id":"sess_1"}']);

  assert.equal(
    await adapter.steerTurn({
      threadId: 't1',
      turnId: 'u2',
      activeTurnId: 'nope',
      text: 'x',
    }),
    false,
  );
  assert.equal(
    await adapter.steerTurn({
      threadId: 'other-thread',
      turnId: 'u2',
      activeTurnId: 'u1',
      text: 'x',
    }),
    false,
  );
  await flush();
  assert.deepEqual(proc.sent, ['first']);
});

test('a cancelled turn takes no further follow-ups', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feedOpen(['{"type":"system","subtype":"init","session_id":"sess_1"}']);
  await adapter.cancelTurn('t1', 'u1');

  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    false,
  );
  await flush();
  assert.deepEqual(proc.sent, ['first']);
});

test('the adapter advertises steering', () => {
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude' });
  assert.equal(adapter.capabilities.steering, true);
});

test('desktop tools add one MCP server for the run, with the token only in the env', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    cwd: '/work/repo',
    desktopTools: { mcpUrl: 'http://127.0.0.1:51234/mcp', token: 'desktop-token-0123456789' },
  });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? '{}') as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  assert.deepEqual(config.mcpServers['uxnan-browser'], {
    type: 'http',
    url: 'http://127.0.0.1:51234/mcp',
    headers: { Authorization: 'Bearer ${UXNAN_MCP_TOKEN}', 'x-uxnan-cwd': '${UXNAN_THREAD_CWD}' },
  });
  // The credential is never in argv; the run's env carries it and the cwd.
  assert.equal(args.join(' ').includes('desktop-token-0123456789'), false);
  assert.equal(last().env?.UXNAN_MCP_TOKEN, 'desktop-token-0123456789');
  assert.equal(last().env?.UXNAN_THREAD_CWD, encodeURIComponent('/work/repo'));
});

test('without desktop tools a run registers no MCP server', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;
  assert.equal(last().args.includes('--mcp-config'), false);
  assert.equal(last().env, undefined);
});

// --- commands: the CLI's own list, from a stream-json `initialize` ---

function commandsSpawner(response: unknown): {
  spawnFn: (command: string, args: string[], cwd: string) => SpawnedProcess;
  calls: { args: string[]; cwd: string; written: string[] }[];
} {
  const calls: { args: string[]; cwd: string; written: string[] }[] = [];
  const spawnFn = (_command: string, args: string[], cwd: string): SpawnedProcess => {
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const emitter = new EventEmitter();
    const call = { args, cwd, written: [] as string[] };
    calls.push(call);
    stdin.on('data', (chunk: Buffer) => {
      call.written.push(chunk.toString('utf8'));
      stdout.write(`${JSON.stringify({ type: 'control_response', response })}\n`);
    });
    return {
      stdout,
      stdin,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
  };
  return { spawnFn, calls };
}

test('commands: the CLI lists them itself, minus what only its terminal or the bridge runs', async () => {
  const { spawnFn, calls } = commandsSpawner({
    subtype: 'success',
    request_id: 'uxnan-commands',
    response: {
      commands: [
        {
          name: 'compact',
          description: 'Free up context',
          argumentHint: '<instructions>',
          builtin: true,
        },
        { name: 'probecmd', description: 'Project command', argumentHint: '<word>' },
        { name: 'hyperframes', description: 'A skill' },
        { name: 'color', description: 'Prompt bar color', builtin: true },
        { name: 'model', description: 'Set the model', builtin: true },
        { name: '__remote-workflow', builtin: true },
        { name: 'agents', description: '(removed) Ask Claude to…', builtin: true },
      ],
    },
  });
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const commands = await adapter.listCommands('/repo');
  assert.deepEqual(
    commands.map((c) => [c.name, c.source, c.argumentHint ?? '']),
    [
      ['compact', 'builtin', '<instructions>'],
      ['probecmd', 'custom', '<word>'],
      ['hyperframes', 'custom', ''],
    ],
  );
  // Asked in the thread's folder, with an `initialize` control request.
  assert.equal(calls[0]!.cwd, '/repo');
  assert.ok(calls[0]!.args.includes('stream-json'));
  assert.match(calls[0]!.written.join(''), /"subtype":"initialize"/);
  // Reused for the folder: no second process within the minute.
  await adapter.listCommands('/repo');
  assert.equal(calls.length, 1);
});

test('commands: a CLI that does not answer yields none, and is asked again', async () => {
  const spawnFn = (): SpawnedProcess => {
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    setImmediate(() => emitter.emit('close', 1));
    return {
      stdout,
      stdin: new PassThrough(),
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => undefined,
    } as SpawnedProcess;
  };
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  assert.deepEqual(await adapter.listCommands('/repo'), []);
});

test('parseInitializeCommands reads only the initialize answer', () => {
  assert.equal(parseInitializeCommands('{"type":"system","subtype":"init"}'), undefined);
  assert.equal(parseInitializeCommands('not json'), undefined);
  assert.deepEqual(
    parseInitializeCommands(
      JSON.stringify({
        type: 'control_response',
        response: { response: { commands: [{ name: 'x', builtin: true }, { nope: 1 }] } },
      }),
    ),
    [{ name: 'x', builtin: true }],
  );
});

// --- A `result` ends the turn only once every message we wrote was read -----

const RESULT = (text: string) =>
  `{"type":"result","subtype":"success","is_error":false,"result":"${text}"}`;
const DELTA = (text: string) =>
  `{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}}`;

test('parseClaudeLine reads a message the CLI echoes back as it takes it in', () => {
  assert.deepEqual(
    parseClaudeLine('{"type":"user","uuid":"m-1","isReplay":true,"session_id":"s"}'),
    { kind: 'replay', sessionId: 's', uuid: 'm-1' },
  );
  // A tool result is a user line too, but never a replay.
  assert.equal(
    parseClaudeLine('{"type":"user","uuid":"m-2","message":{"content":[]}}')?.kind,
    'tool_result',
  );
});

test('every message goes out with a uuid, and the CLI is asked to echo it', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  assert.ok(last().args.includes('--replay-user-messages'));
  last().feed([RESULT('hello')]);
  assert.equal((await done).at(-1)?.type, 'turn_completed');
});

// Seen live (2026-09-27): a resumed session first answered a
// `<task-notification>` it still owed; that `result` closed the user's turn
// within a second while the real answer ran on for 13 minutes, unseen.
test('a wake-up the CLI answers before reading our message does not end the turn', async () => {
  const { spawnFn, last } = fakeSpawner({ holdEcho: true });
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'finish up please' });
  const run = last();
  run.feedOpen([RESULT('Background tasks stopped.')]);
  await flush();
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
  );

  // Now the CLI reads our message and answers it.
  run.releaseEcho();
  run.feed([DELTA('All done.'), RESULT('All done.')]);
  const settled = await done;
  const completions = settled.filter((e) => e.type === 'turn_completed');
  assert.equal(completions.length, 1);
  assert.equal((completions[0]!.data as { text: string }).text, 'All done.');
});

test('a steer read after the model turn ended keeps the turn open for its answer', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const run = last();
  run.holdEcho();
  // Written just as the model finishes: the CLI will read it after its result.
  const taken = adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'and this',
  });
  run.feedOpen([DELTA('First answer. '), RESULT('First answer.')]);
  await flush();
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
  );
  assert.equal(run.stdinEnded, false, 'the pipe stays open until the steer is answered');

  // Taken when the CLI reads it — its echo — not when it was written.
  let settledTake: boolean | undefined;
  void taken.then((value) => (settledTake = value));
  await flush();
  assert.equal(settledTake, undefined, 'not taken before the CLI read it');
  run.releaseEcho();
  assert.equal(await taken, true);
  run.feed([DELTA('Second answer.'), RESULT('Second answer.')]);
  const settled = await done;
  assert.equal(settled.filter((e) => e.type === 'turn_completed').length, 1);
  assert.equal(
    (settled.find((e) => e.type === 'turn_completed')!.data as { text: string }).text,
    'First answer. Second answer.',
  );
});

test('a CLI that exits without answering fails the turn, with what it said on stderr', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn: (...args) => {
      const proc = spawnFn(...args);
      const stderr = new PassThrough();
      setImmediate(() => stderr.write('Error: session is locked by another process\n'));
      return { ...proc, stderr } as SpawnedProcess;
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await flush();
  last().feed([]);
  const events = await done;
  const error = events.at(-1)!;
  assert.equal(error.type, 'turn_error');
  assert.match((error.data as { text: string }).text, /exited without answering/);
  assert.match((error.data as { text: string }).text, /locked by another process/);
});

test('a follow-up the CLI never read is handed back, and the turn ends as it did', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const run = last();
  run.holdEcho();
  const taken = adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'not read',
  });
  // The CLI comes down with the follow-up still unread.
  run.feed([RESULT('First answer.')]);
  // Not taken: the bridge keeps it queued, to run as a turn of its own.
  assert.equal(await taken, false);
  const events = await done;
  assert.equal(events.at(-1)?.type, 'turn_completed');
  assert.equal((events.at(-1)!.data as { text: string }).text, 'First answer.');
});

test('a prompt the CLI never read fails the turn instead of passing as answered', async () => {
  const { spawnFn, last } = fakeSpawner({ holdEcho: true });
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  last().feed([RESULT('Something else.')]);
  const events = await done;
  assert.equal(events.at(-1)?.type, 'turn_error');
  assert.match((events.at(-1)!.data as { text: string }).text, /before it read the message/);
});

test('stopping the bridge mid-turn fails the turn rather than completing it', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'long job' });
  last().feedOpen([DELTA('Working on it')]);
  await flush();
  await adapter.stop();
  const events = await done;
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
  );
  assert.match((events.at(-1)!.data as { text: string }).text, /bridge stopped/);
});

test('a cancelled turn reports only that it was stopped', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'long job' });
  last().feedOpen([DELTA('Working on it')]);
  await flush();
  await adapter.cancelTurn('t1', 'u1');
  await flush();
  assert.deepEqual(
    events
      .filter((e) => e.type.startsWith('turn_') && e.type !== 'turn_started')
      .map((e) => e.type),
    ['turn_aborted'],
  );
});

test('a gone session is refused by the id it was resumed with, not the fresh one announced', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  adapter.adoptNativeSession('t1', 'sess_gone');
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'still there?' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"sess_fresh"}',
    '{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"session_id":"sess_fresh","errors":["No conversation found with session ID: sess_gone"]}',
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  await flush();
  last().feed([RESULT('yes')]);
  await done;
  // The gone id stays refused: offering it again (the store still holds it
  // until the new one is persisted) never brings it back.
  adapter.adoptNativeSession('t1', 'sess_gone');
  assert.notEqual(adapter.nativeSessionId('t1'), 'sess_gone');
});
