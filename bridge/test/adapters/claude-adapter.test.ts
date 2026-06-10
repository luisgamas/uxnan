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
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}',
    ),
    { kind: 'delta', sessionId: 's', text: 'hi' },
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
  // prompt is the final argv element, never shell-interpolated
  assert.equal(args[args.length - 1], 'hi');
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

test('ClaudeCodeAdapter lists the stable aliases as "latest" labelled models', async () => {
  const adapter = new ClaudeCodeAdapter({ binaryPath: 'claude', defaultModel: 'sonnet' });
  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((m) => m.id),
    ['opus', 'sonnet', 'haiku'],
  );
  assert.deepEqual(
    models.map((m) => m.displayName),
    ['Opus (latest)', 'Sonnet (latest)', 'Haiku (latest)'],
  );
  assert.equal(models.find((m) => m.id === 'sonnet')?.isDefault, true);
  assert.equal(models.find((m) => m.id === 'opus')?.isDefault, false);
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
    ['opus', 'sonnet', 'haiku', 'claude-opus-4-8', 'claude-opus-4-7'],
  );
  // explicit displayName kept; missing one falls back to the id
  assert.equal(models.find((m) => m.id === 'claude-opus-4-8')?.displayName, 'Opus 4.8');
  assert.equal(models.find((m) => m.id === 'claude-opus-4-7')?.displayName, 'claude-opus-4-7');
  // the pinned id matching defaultModel is the default, not an alias
  assert.equal(models.find((m) => m.id === 'claude-opus-4-7')?.isDefault, true);
  assert.equal(models.find((m) => m.id === 'opus')?.isDefault, false);
});

test('claudeContextWindow maps tiers and ids to window sizes', () => {
  assert.equal(claudeContextWindow('fable'), 1_000_000);
  assert.equal(claudeContextWindow('opus'), 1_000_000);
  assert.equal(claudeContextWindow('sonnet'), 1_000_000);
  assert.equal(claudeContextWindow('haiku'), 200_000);
  assert.equal(claudeContextWindow('claude-fable-5'), 1_000_000);
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
