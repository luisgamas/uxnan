import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  PiAdapter,
  parsePiLine,
  parsePiModelList,
  parsePiUsageTokens,
  parsePiContextWindow,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `pi` process whose stdout we feed with agent-session JSON lines ---
interface FakeSpawn {
  args: string[];
  /** Whether the spawn asked for a writable stdin (`--mode rpc`). */
  pipedStdin: boolean;
  /** RPC commands written to stdin, in order — the prompt, then any steer. */
  sent: { type: string; message?: string }[];
  /** True once the adapter closed the pipe; pi only exits after this. */
  stdinEnded: boolean;
  feed(lines: string[]): void;
  /** Feed lines WITHOUT closing stdout, so the turn stays open. */
  feedOpen(lines: string[]): void;
  /** Write lines to STDERR (where `pi --list-models` prints its table), then close. */
  feedStderr(lines: string[]): void;
}

function fakeSpawner(): {
  spawnFn: (
    command: string,
    args: string[],
    cwd: string,
    extra?: { stdin?: 'pipe' | 'ignore' },
  ) => SpawnedProcess;
  last(): FakeSpawn;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (
    _command: string,
    args: string[],
    _cwd?: string,
    extra?: { stdin?: 'pipe' | 'ignore' },
  ): SpawnedProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    stdout.on('end', () => emitter.emit('close', 0));
    const record: FakeSpawn = {
      args,
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
      feedStderr: (lines) => {
        for (const line of lines) stderr.write(`${line}\n`);
        stderr.end();
        stdout.end();
      },
    };
    // Mirrors the real pipe: one RPC command per line, and `end()` is what lets
    // pi shut down (it waits for the next command otherwise).
    const stdin = new PassThrough();
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        record.sent.push(JSON.parse(line) as { type: string; message?: string });
      }
    });
    stdin.on('finish', () => {
      record.stdinEnded = true;
    });
    const proc: SpawnedProcess = {
      stdout,
      stderr,
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
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function collect(adapter: PiAdapter): {
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

const SESSION = '{"type":"session","version":3,"id":"sess-1","cwd":"/p"}';
const AGENT_END = '{"type":"agent_end","messages":[],"willRetry":false}';

function assistantEnd(text: string, opts: { tokens?: number; error?: string } = {}): string {
  const usage = { input: 10, output: 5, totalTokens: opts.tokens ?? 15 };
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    usage,
    stopReason: opts.error ? 'error' : 'stop',
  };
  if (opts.error) message['errorMessage'] = opts.error;
  return JSON.stringify({ type: 'message_end', message });
}

test('parsePiLine maps the documented event shapes', () => {
  assert.equal(parsePiLine('not json'), null);
  assert.deepEqual(parsePiLine(SESSION), { kind: 'session', sessionId: 'sess-1' });
  assert.deepEqual(
    parsePiLine(
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hi"}}',
    ),
    { kind: 'delta', text: 'hi' },
  );
  // thinking deltas become thinking events (not answer text)
  assert.deepEqual(
    parsePiLine(
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"hmm"}}',
    ),
    { kind: 'thinking', text: 'hmm' },
  );
  const final = parsePiLine(assistantEnd('hello', { tokens: 42 }));
  assert.equal(final?.kind, 'final');
  assert.equal(final?.text, 'hello');
  assert.equal(final?.tokens, 42);
  assert.equal(final?.isError, false);
  const errored = parsePiLine(assistantEnd('', { error: 'boom' }));
  assert.equal(errored?.isError, true);
  assert.equal(errored?.errorText, 'boom');
  assert.equal(parsePiLine(AGENT_END)?.kind, 'end');
  assert.deepEqual(
    parsePiLine(
      '{"type":"compaction_end","reason":"threshold","aborted":false,"result":{"tokensBefore":90000,"estimatedTokensAfter":32000}}',
    ),
    {
      kind: 'compaction',
      compactionReason: 'threshold',
      tokensBefore: 90000,
      tokensAfter: 32000,
    },
  );
});

test('PiAdapter emits successful compaction_end as a compaction block', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"compaction_end","reason":"overflow","aborted":false,"result":{"tokensBefore":90000,"estimatedTokensAfter":32000}}',
    assistantEnd('done'),
    AGENT_END,
  ]);

  const events = await done;
  const block = events.find((event) => event.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.deepEqual(block?.content, {
    type: 'compaction',
    reason: 'overflow',
    tokensBefore: 90000,
    tokensAfter: 32000,
  });
});

test('PiAdapter emits thinking deltas and pairs tool_execution start/end into a block', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"Let me "}}',
    '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"think."}}',
    '{"type":"tool_execution_start","toolCallId":"bash_1","toolName":"bash","args":{"command":"ls"}}',
    '{"type":"tool_execution_end","toolCallId":"bash_1","toolName":"bash","result":{"content":[{"type":"text","text":"a.txt\\nb.txt"}]},"isError":false}',
    assistantEnd('done', { tokens: 20 }),
    AGENT_END,
  ]);

  const events = await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['Let me ', 'think.']);
  const blocks = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content);
  const command = blocks.find((block) => block['type'] === 'command_execution');
  const boundary = blocks.find((block) => block['type'] === 'assistant_response_boundary');
  assert.equal(blocks.length, 2);
  assert.deepEqual(command, {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a.txt\nb.txt',
  });
  assert.deepEqual(boundary, {
    type: 'assistant_response_boundary',
    phase: 'unknown',
  });
});

test('parsePiUsageTokens prefers totalTokens, falls back to input+output', () => {
  assert.equal(parsePiUsageTokens({ input: 10, output: 5, totalTokens: 15 }), 15);
  assert.equal(parsePiUsageTokens({ input: 10, output: 5 }), 15);
  assert.equal(parsePiUsageTokens({}), undefined);
  assert.equal(parsePiUsageTokens('nope'), undefined);
});

test('parsePiContextWindow parses K/M suffixes and bare numbers', () => {
  assert.equal(parsePiContextWindow('1.0M'), 1_000_000);
  assert.equal(parsePiContextWindow('1M'), 1_000_000);
  assert.equal(parsePiContextWindow('384K'), 384_000);
  assert.equal(parsePiContextWindow('200000'), 200_000);
  assert.equal(parsePiContextWindow('-'), undefined);
  assert.equal(parsePiContextWindow(undefined), undefined);
});

test('PiAdapter emits usage.contextWindow from the cached model list', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  // Prime the per-model window cache from `--list-models`.
  const listing = adapter.listModels();
  last().feedStderr([
    'provider      model                    context  max-out  thinking  images',
    'google        gemini-2.5-pro           1.0M     65.5K    yes       yes',
  ]);
  await listing;

  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    service: 'google/gemini-2.5-pro',
  });
  last().feed([SESSION, assistantEnd('ok', { tokens: 99 }), AGENT_END]);

  const events = await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  const usage = (
    completed?.data as {
      usage?: { tokens: number; contextWindow?: number };
    }
  ).usage;
  assert.equal(usage?.tokens, 99);
  assert.equal(usage?.contextWindow, 1_000_000);
});

test('PiAdapter streams text_delta as deltas and completes with the text + usage', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    SESSION,
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello "}}',
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}',
    assistantEnd('Hello world', { tokens: 99 }),
    AGENT_END,
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');
  const usage = (completed?.data as { usage?: { tokens: number } }).usage;
  assert.equal(usage?.tokens, 99);
  // first turn has no --session-id yet; `--mode rpc` leads the args
  const args = last().args;
  assert.deepEqual(args.slice(0, 2), ['--mode', 'rpc']);
  assert.equal(args.includes('--session-id'), false);
  // The prompt travels on stdin as an RPC command, never as argv — that open
  // pipe is what `steerTurn` writes into.
  assert.equal(args.includes('hi'), false);
  assert.equal(last().pipedStdin, true);
  await flush();
  assert.deepEqual(last().sent, [{ type: 'prompt', message: 'hi' }]);
  // …and the pipe is closed when the turn ends, or pi would never exit.
  assert.equal(last().stdinEnded, true);
});

test('PiAdapter preserves multiple assistant messages including non-streamed text', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    SESSION,
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Checking."}}',
    assistantEnd('Checking.'),
    assistantEnd('Done.'),
    AGENT_END,
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

test('PiAdapter reuses the captured session id with --session-id next turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  last().feed([SESSION, assistantEnd('a'), AGENT_END]);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const argsForSecond = last().args;
  last().feed([assistantEnd('b'), AGENT_END]);
  await second.done;

  const idx = argsForSecond.indexOf('--session-id');
  assert.notEqual(idx, -1);
  assert.equal(argsForSecond[idx + 1], 'sess-1');
});

test('PiAdapter passes the model and maps reasoning to --thinking', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    service: 'google/gemini-2.5-pro',
    options: { reasoning: 'xhigh' },
  });
  last().feed([SESSION, assistantEnd('ok'), AGENT_END]);
  await done;

  const args = last().args;
  assert.equal(args[args.indexOf('--model') + 1], 'google/gemini-2.5-pro');
  assert.equal(args[args.indexOf('--thinking') + 1], 'xhigh');
});

test('PiAdapter omits --thinking when no reasoning is set', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([SESSION, assistantEnd('ok'), AGENT_END]);
  await done;
  assert.equal(last().args.includes('--thinking'), false);
});

test('PiAdapter maps the permission posture to the right tool flags', async () => {
  const cases = [
    { mode: 'acceptEdits' as const, hasTools: false, hasApprove: false },
    { mode: 'default' as const, hasTools: true, hasApprove: false },
    { mode: 'bypassPermissions' as const, hasTools: false, hasApprove: true },
  ];
  for (const { mode, hasTools, hasApprove } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new PiAdapter({ binaryPath: 'pi', permissionMode: mode, spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
    last().feed([SESSION, assistantEnd('ok'), AGENT_END]);
    await done;
    const args = last().args;
    assert.equal(args.includes('--tools'), hasTools);
    if (hasTools) assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls');
    assert.equal(args.includes('--approve'), hasApprove);
  }
});

test('PiAdapter surfaces an error stopReason as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([SESSION, assistantEnd('', { error: 'model not found' }), AGENT_END]);
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'model not found');
});

test('PiAdapter surfaces a plain-text startup error as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  // session event then a non-JSON error line, no terminal event before close
  last().feed([SESSION, 'No API key found for xiaomi.']);
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.match((err?.data as { text: string }).text, /No API key found/);
});

test('parsePiModelList parses the --list-models table', () => {
  const table = [
    'provider      model                    context  max-out  thinking  images',
    'google        gemini-2.5-pro           1.0M     65.5K    yes       yes',
    'google        gemini-2.0-flash-lite    1.0M     8.2K     no        yes',
    'deepseek      deepseek-v4-pro          1M       384K     yes       no',
    '',
  ].join('\n');
  const models = parsePiModelList(table, 'google/gemini-2.5-pro');
  assert.deepEqual(
    models.map((m) => m.id),
    ['google/gemini-2.5-pro', 'google/gemini-2.0-flash-lite', 'deepseek/deepseek-v4-pro'],
  );
  // header skipped; displayName is the model, description the provider
  assert.equal(models[0]?.displayName, 'gemini-2.5-pro');
  assert.equal(models[0]?.description, 'google');
  assert.equal(models[0]?.isDefault, true);
  // the `context` column is parsed into a token count for usage percentages
  assert.equal(models[0]?.contextWindow, 1_000_000);
  assert.equal(models[2]?.contextWindow, 1_000_000);
  // thinking==yes advertises the reasoning knob; thinking==no does not
  assert.equal(models[0]?.options?.[0]?.key, 'reasoning');
  assert.equal(models[1]?.options, undefined);
  assert.deepEqual(
    models[0]?.options?.[0]?.values?.map((v) => v.value),
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  );
});

test('PiAdapter.listModels parses the table pi prints to stderr', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({
    binaryPath: 'pi',
    spawnFn,
    defaultModel: 'google/gemini-2.5-pro',
  });
  const promise = adapter.listModels();
  // pi prints the --list-models table to STDERR, not stdout.
  last().feedStderr([
    'provider      model                    context  max-out  thinking  images',
    'google        gemini-2.5-pro           1.0M     65.5K    yes       yes',
    'deepseek      deepseek-v4-pro          1M       384K     yes       no',
  ]);
  const models = await promise;
  assert.deepEqual(
    models.map((m) => m.id),
    ['google/gemini-2.5-pro', 'deepseek/deepseek-v4-pro'],
  );
  assert.equal(last().args.includes('--list-models'), true);
  assert.equal(models[0]?.isDefault, true);
});

// --- mid-turn delivery (steering) -----------------------------------------
// pi's RPC protocol has a first-class `steer` command, drained by the agent
// loop at its next boundary — which is why the adapter runs `--mode rpc`
// instead of `-p --mode json` (print mode reads ALL of stdin as the prompt).

test('steerTurn sends a steer command into the running turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feedOpen(['{"type":"response","command":"prompt","success":true}']);

  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'actually, do this instead',
  });
  await flush();

  assert.equal(taken, true);
  assert.deepEqual(proc.sent, [
    { type: 'prompt', message: 'first' },
    { type: 'steer', message: 'actually, do this instead' },
  ]);
  // Same process, same turn: no second spawn, no second --session-id.
  assert.equal(last(), proc);
  assert.equal(proc.stdinEnded, false, 'the pipe stays open while the turn runs');

  proc.feed(['{"type":"agent_end","messages":[],"willRetry":false}']);
  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  await flush();
  assert.equal(proc.stdinEnded, true);
});

test('steerTurn declines once the turn ended, or for an unknown turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'nope', text: 'x' }),
    false,
  );
  assert.equal(
    await adapter.steerTurn({ threadId: 'other', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    false,
  );

  proc.feed(['{"type":"agent_end","messages":[],"willRetry":false}']);
  await done;
  // Writing now would be read as a NEW turn on the same process.
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'u1', text: 'late' }),
    false,
  );
  await flush();
  assert.deepEqual(proc.sent, [{ type: 'prompt', message: 'first' }]);
});

test('a rejected prompt fails the turn, but a rejected steer does not', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  // A refused follow-up is not the turn's problem: the manager already treats
  // it as "leave it queued", so the running turn must survive it.
  last().feedOpen([
    '{"type":"response","command":"steer","success":false,"error":"nothing to steer"}',
  ]);
  await flush();
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    true,
    'the turn is still live, so the write itself succeeds',
  );

  // A refused PROMPT means the agent never started — nothing else will arrive.
  last().feedOpen([
    '{"type":"response","command":"prompt","success":false,"error":"no API key found"}',
  ]);
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.match(String((err?.data as { text: string }).text), /no API key found/);
});

test('parsePiLine maps a failed RPC response, and ignores a successful one', () => {
  assert.deepEqual(parsePiLine('{"type":"response","command":"prompt","success":true}'), {
    kind: 'other',
  });
  assert.deepEqual(
    parsePiLine('{"type":"response","command":"prompt","success":false,"error":"boom"}'),
    { kind: 'command_failed', commandName: 'prompt', errorText: 'boom' },
  );
});

test('PiAdapter advertises steering', () => {
  const adapter = new PiAdapter({ binaryPath: 'pi' });
  assert.equal(adapter.capabilities.steering, true);
});
