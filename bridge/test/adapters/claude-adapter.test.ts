import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  ClaudeCodeAdapter,
  claudeContextWindow,
  claudeUsageTokens,
  parseClaudeLine,
  type SpawnedProcess,
} from '../../src/index.js';
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
}

function fakeSpawner(): {
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
    };
    // Mirrors the real pipe: each line is one stream-json user message, and
    // `end()` is what lets the CLI finish (it waits for more input otherwise).
    const stdin = new PassThrough();
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as {
          message?: { content?: { type: string; text?: string }[] };
        };
        const text = (parsed.message?.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('');
        record.sent.push(text);
      }
    });
    stdin.on('finish', () => {
      record.stdinEnded = true;
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
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    type: 'command_execution',
    command: 'type a.txt',
    status: 'completed',
    output: 'hello',
  });
  assert.equal(blocks[1]?.['type'], 'diff');
  assert.equal(blocks[1]?.['filename'], 'a.dart');
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

test('ClaudeCodeAdapter maps the permission posture to the right CLI flag', async () => {
  const cases = [
    { mode: 'acceptEdits' as const, hasPermFlag: true, hasBypass: false },
    { mode: 'bypassPermissions' as const, hasPermFlag: false, hasBypass: true },
    { mode: 'default' as const, hasPermFlag: false, hasBypass: false },
  ];
  for (const { mode, hasPermFlag, hasBypass } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', permissionMode: mode, spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
    last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
    await done;

    const args = last().args;
    assert.equal(args.includes('--permission-mode'), hasPermFlag);
    if (hasPermFlag) assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
    assert.equal(args.includes('--dangerously-skip-permissions'), hasBypass);
  }
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

test('ClaudeCodeAdapter advertises the reasoning knob on every model', async () => {
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude' });
  const models = await adapter.listModels();
  assert.ok(models.length > 0);
  for (const model of models) {
    const opt = model.options?.find((o) => o.key === 'reasoning');
    assert.ok(opt, `model ${model.id} advertises the reasoning knob`);
    assert.equal(opt?.kind, 'enum');
    assert.deepEqual(
      opt?.values?.map((v) => v.value),
      ['low', 'medium', 'high', 'xhigh', 'max'],
    );
  }
});

test('ClaudeCodeAdapter lists the stable aliases as "latest" labelled models', async () => {
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', defaultModel: 'sonnet' });
  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((m) => m.id),
    ['fable', 'opus', 'sonnet', 'haiku'],
  );
  assert.deepEqual(
    models.map((m) => m.displayName),
    ['Fable (latest)', 'Opus (latest)', 'Sonnet (latest)', 'Haiku (latest)'],
  );
  assert.equal(models.find((m) => m.id === 'sonnet')?.isDefault, true);
  assert.equal(models.find((m) => m.id === 'opus')?.isDefault, false);
  // Every alias is flagged as a moving-target "latest" model.
  assert.ok(models.every((m) => m.isLatestAlias === true));
});

test('ClaudeCodeAdapter appends pinned concrete models after the aliases', async () => {
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    defaultModel: 'claude-opus-4-7',
    pinnedModels: [
      { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
      { id: 'claude-opus-4-7' },
      // collides with an alias → dropped (the alias is the "latest" entry)
      { id: 'opus' },
      { id: '   ' }, // blank → skipped
    ],
  });
  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((m) => m.id),
    ['fable', 'opus', 'sonnet', 'haiku', 'claude-opus-4-8', 'claude-opus-4-7'],
  );
  // explicit displayName kept; missing one falls back to the id
  assert.equal(models.find((m) => m.id === 'claude-opus-4-8')?.displayName, 'Opus 4.8');
  assert.equal(models.find((m) => m.id === 'claude-opus-4-7')?.displayName, 'claude-opus-4-7');
  // the pinned id matching defaultModel is the default, not an alias
  assert.equal(models.find((m) => m.id === 'claude-opus-4-7')?.isDefault, true);
  assert.equal(models.find((m) => m.id === 'opus')?.isDefault, false);
  // only the aliases are flagged "latest"; the pinned concrete versions are not
  assert.equal(models.find((m) => m.id === 'opus')?.isLatestAlias, true);
  assert.equal(models.find((m) => m.id === 'claude-opus-4-8')?.isLatestAlias, undefined);
});

test('claudeContextWindow maps tiers and ids to window sizes', () => {
  assert.equal(claudeContextWindow('fable'), 1_000_000);
  assert.equal(claudeContextWindow('opus'), 1_000_000);
  assert.equal(claudeContextWindow('sonnet'), 1_000_000);
  assert.equal(claudeContextWindow('haiku'), 200_000);
  assert.equal(claudeContextWindow('claude-fable-5'), 1_000_000);
  assert.equal(claudeContextWindow('claude-opus-5'), 1_000_000);
  assert.equal(claudeContextWindow('claude-opus-4-8'), 1_000_000);
  assert.equal(claudeContextWindow('claude-haiku-4-5'), 200_000);
  assert.equal(claudeContextWindow('mystery'), undefined);
  assert.equal(claudeContextWindow(undefined), undefined);
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
      '{"input_tokens":1000,"cache_read_input_tokens":200,"output_tokens":50}}',
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

test('interactive approvals inject the PreToolUse hook (--settings + --permission-mode) and env', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    interactiveApprovals: true,
    approvalHook: {
      token: 'tok-123',
      scriptPath: 'C:/Users/x/.uxnan/hooks/claude-approval-hook.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 'thread-1', turnId: 'u1', text: 'go' });
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

test('accessMode approveForMe forces acceptEdits and suppresses the hook', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    // Even with interactive approvals configured, an explicit approveForMe must
    // bypass the hook (the user chose not to be asked).
    interactiveApprovals: true,
    approvalHook: {
      token: 't',
      scriptPath: 'C:/h.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', accessMode: 'approveForMe' });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.equal(args.includes('--settings'), false);
  assert.equal(args.includes('--permission-mode'), true);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(last().env, undefined);
});

test('accessMode fullAccess maps to --dangerously-skip-permissions, no hook', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    interactiveApprovals: true,
    approvalHook: {
      token: 't',
      scriptPath: 'C:/h.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', accessMode: 'fullAccess' });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.equal(args.includes('--dangerously-skip-permissions'), true);
  assert.equal(args.includes('--settings'), false);
});

test('accessMode requestApproval keeps the interactive hook in play', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    interactiveApprovals: true,
    approvalHook: {
      token: 'tok',
      scriptPath: 'C:/Users/x/.uxnan/hooks/claude-approval-hook.cjs',
      url: () => 'http://127.0.0.1:19850/agent-hook/approval',
    },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.ok(args.includes('--settings'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
  assert.equal(last().env?.UXNAN_HOOK_THREAD_ID, 't1');
});

test('accessMode requestApproval without a hook falls back to the configured posture', async () => {
  const { spawnFn, last } = fakeSpawner();
  // No interactiveApprovals/hook → requestApproval can't route; it must NOT
  // force `--permission-mode default` (which would deny headlessly) but fall
  // back to the adapter's configured posture (acceptEdits default).
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  last().feed(['{"type":"result","subtype":"success","result":"ok","session_id":"s"}']);
  await done;

  const args = last().args;
  assert.equal(args.includes('--settings'), false);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
});

test('interactive approvals stay off until the hook URL resolves (LAN not started)', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({
    binaryPath: 'claude',
    spawnFn,
    interactiveApprovals: true,
    approvalHook: { token: 't', scriptPath: 'C:/h.cjs', url: () => undefined },
  });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'go' });
  last().feed([
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s"}',
  ]);
  await done;
  // No hook injected, falls back to the normal (acceptEdits) one-shot path.
  assert.equal(last().args.includes('--settings'), false);
  assert.equal(last().env, undefined);
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
  const activityBlocks = blocks.filter(
    (event) =>
      (event.data as { content: { type?: string } }).content.type !== 'assistant_response_boundary',
  );
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
// `run_in_background`) and then ends its turn: the CLI keeps running, and if
// that work finishes within its few seconds of grace it WAKES THE MODEL and a
// second complete turn follows on the same process. If it does not finish in
// time the CLI kills the task (`status:"stopped"`) and exits.

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

test('background work the CLI kills is reported instead of passing as a clean turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', spawnFn });
  const { done } = collectRun(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'start something long' });
  last().feed([
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"system","subtype":"task_started","task_id":"bnc","session_id":"s"}',
    '{"type":"assistant","session_id":"s","message":{"content":[{"type":"text","text":"Running in the background."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Running in the background.","session_id":"s"}',
    // The work outlived the CLI's grace period, so it was killed, not finished.
    '{"type":"system","subtype":"task_notification","status":"stopped","task_id":"bnc","session_id":"s"}',
  ]);

  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  const warning = warnings(events)[0];
  assert.ok(warning, 'the user is told the background work did not finish');
  assert.match((warning?.data as { content: { text: string } }).content.text, /interrupted/i);
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
