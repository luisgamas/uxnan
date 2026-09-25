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
  DEFAULT_PI_IDLE_TIMEOUT_MS,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';
import {
  PI_DESKTOP_EXTENSION,
  parsePiCommands,
  piDesktopLaunch,
} from '../../src/adapters/pi-adapter.js';

// --- a fake `pi` process whose stdout we feed with agent-session JSON lines ---
interface FakeSpawn {
  args: string[];
  /** The environment the spawn added (`extra.env`). */
  env?: Record<string, string>;
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
    extra?: { stdin?: 'pipe' | 'ignore'; env?: Record<string, string> },
  ) => SpawnedProcess;
  last(): FakeSpawn;
  count(): number;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (
    _command: string,
    args: string[],
    _cwd?: string,
    extra?: { stdin?: 'pipe' | 'ignore'; env?: Record<string, string> },
  ): SpawnedProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
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
      kill: () => {
        record.stdinEnded = true;
        emitter.emit('close', 0);
      },
    } as SpawnedProcess;
    spawns.push(record);
    return proc;
  };
  return { spawnFn, last: () => spawns[spawns.length - 1]!, count: () => spawns.length };
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

/** `-p --mode json` only: the resident `--mode rpc` process never emits it. */
const SESSION = '{"type":"session","version":3,"id":"sess-1","cwd":"/p"}';
/** What `--mode rpc` answers to the adapter's `get_state` (captured from pi 0.85.1, trimmed). */
const STATE =
  '{"type":"response","command":"get_state","success":true,"data":{"sessionId":"sess-1","sessionFile":"/s/sess-1.jsonl","messageCount":0}}';
/** The same answer when the model reports its window (`data.model.contextWindow`). */
const STATE_WITH_WINDOW =
  '{"type":"response","command":"get_state","success":true,"data":{"sessionId":"sess-1","model":{"id":"big-pickle","contextWindow":200000,"maxTokens":32000}}}';
const AGENT_END = '{"type":"agent_end","messages":[],"willRetry":false}';
/** pi's own idle signal — what ends a turn (an `agent_end` alone does not). */
const AGENT_SETTLED = '{"type":"agent_settled"}';

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
    AGENT_SETTLED,
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
    AGENT_SETTLED,
  ]);

  const events = await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['Let me ', 'think.']);
  const blocks = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content);
  const commands = blocks.filter((block) => block['type'] === 'command_execution');
  const boundary = blocks.find((block) => block['type'] === 'assistant_response_boundary');
  // The command shows as it starts, then its result replaces it (same id).
  assert.equal(blocks.length, 3);
  const id = commands[0]?.['blockId'];
  assert.equal(typeof id, 'string');
  assert.deepEqual(commands[0], {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: id,
  });
  assert.deepEqual(commands[1], {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a.txt\nb.txt',
    blockId: id,
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
  last().feed([STATE, assistantEnd('ok', { tokens: 99 }), AGENT_END, AGENT_SETTLED]);

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

test('PiAdapter prefers the context window `get_state` reports for the session', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    service: 'opencode/big-pickle',
  });
  last().feed([STATE_WITH_WINDOW, assistantEnd('ok', { tokens: 2374 }), AGENT_END, AGENT_SETTLED]);
  const events = await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.deepEqual((completed?.data as { usage?: unknown }).usage, {
    tokens: 2374,
    contextWindow: 200000,
  });
});

test('PiAdapter streams text_delta as deltas and completes with the text + usage', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feedOpen([
    SESSION,
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello "}}',
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}',
    assistantEnd('Hello world', { tokens: 99 }),
    AGENT_END,
    AGENT_SETTLED,
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
  // The session id is asked for before the first prompt (rpc emits no `session` event).
  assert.deepEqual(last().sent, [{ type: 'get_state' }, { type: 'prompt', message: 'hi' }]);
  // In persistent mode, the stdin pipe remains open across turns.
  assert.equal(last().stdinEnded, false);
  await adapter.stop();
  assert.equal(last().stdinEnded, true);
});

test('PiAdapter preserves multiple assistant messages including non-streamed text', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    STATE,
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Checking."}}',
    assistantEnd('Checking.'),
    assistantEnd('Done.'),
    AGENT_END,
    AGENT_SETTLED,
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

test('PiAdapter reuses the captured session id with --session-id across session restarts', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  last().feed([STATE, assistantEnd('a'), AGENT_END, AGENT_SETTLED]);
  await first.done;
  await adapter.stop();

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const argsForSecond = last().args;
  last().feed([assistantEnd('b'), AGENT_END, AGENT_SETTLED]);
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
  last().feed([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
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
  last().feed([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
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
    last().feed([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
    await done;
    const args = last().args;
    assert.equal(args.includes('--tools'), hasTools);
    if (hasTools) assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls');
    assert.equal(args.includes('--approve'), hasApprove);
  }
});

test('PiAdapter loads the desktop-tools extension while the desktop is attached', async () => {
  const { spawnFn, last, count } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const desktopTools = { mcpUrl: 'http://127.0.0.1:51234/mcp', token: 'k'.repeat(43) };
  const turn = async (turnId: string, tools?: typeof desktopTools): Promise<void> => {
    const { done } = collect(adapter);
    await adapter.sendTurn({
      threadId: 't1',
      turnId,
      text: 'hi',
      cwd: '/w/a b',
      ...(tools ? { desktopTools: tools } : {}),
    });
    // Keep stdout open: the process stays resident, as the real one does.
    last().feedOpen([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
    await done;
  };

  await turn('u1', desktopTools);
  const args = last().args;
  assert.equal(args[args.indexOf('-e') + 1], PI_DESKTOP_EXTENSION);
  assert.deepEqual(last().env, {
    UXNAN_MCP_URL: desktopTools.mcpUrl,
    UXNAN_MCP_TOKEN: desktopTools.token,
    UXNAN_THREAD_CWD: '%2Fw%2Fa%20b',
  });
  assert.ok(!args.some((a) => a.includes(desktopTools.token)), 'the token never reaches argv');

  // Same attachment: the resident process is reused.
  await turn('u2', desktopTools);
  assert.equal(count(), 1);

  // Detached: pi restarts (on the same session) without the extension.
  await turn('u3');
  assert.equal(count(), 2);
  assert.equal(last().args.includes('-e'), false);
  assert.equal(last().env, undefined);
  await adapter.stop();
});

test('piDesktopLaunch offers nothing in the read-only posture or without the desktop', () => {
  const desktop = { mcpUrl: 'http://127.0.0.1:1/mcp', token: 'k'.repeat(43) };
  assert.deepEqual(piDesktopLaunch(desktop, '/w', 'default'), { args: [], env: {}, key: '' });
  assert.deepEqual(piDesktopLaunch(undefined, '/w', 'acceptEdits'), { args: [], env: {}, key: '' });
  const launch = piDesktopLaunch(desktop, '/w', 'bypassPermissions');
  assert.deepEqual(launch.args, ['-e', PI_DESKTOP_EXTENSION]);
  assert.ok(launch.key.startsWith(desktop.mcpUrl));
  assert.ok(!launch.key.includes(desktop.token));
  assert.notEqual(
    piDesktopLaunch({ ...desktop, token: 'j'.repeat(43) }, '/w', 'acceptEdits').key,
    launch.key,
  );
});

test('PiAdapter surfaces an error stopReason as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([STATE, assistantEnd('', { error: 'model not found' }), AGENT_END, AGENT_SETTLED]);
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
  last().feed([STATE, 'No API key found for xiaomi.']);
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
    { type: 'get_state' },
    { type: 'prompt', message: 'first' },
    { type: 'steer', message: 'actually, do this instead' },
  ]);
  // Same process, same turn: no second spawn, no second --session-id.
  assert.equal(last(), proc);
  assert.equal(proc.stdinEnded, false, 'the pipe stays open while the turn runs');

  proc.feedOpen([AGENT_END, AGENT_SETTLED]);
  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  await flush();
  assert.equal(proc.stdinEnded, false);
  await adapter.stop();
  assert.equal(proc.stdinEnded, true);
});

test("an extension's dialog is declined at once, so the turn can end", async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'deploy' });
  const proc = last();
  proc.feedOpen([
    '{"type":"extension_ui_request","id":"d1","method":"confirm","title":"Deploy?"}',
    // Fire-and-forget UI needs no answer.
    '{"type":"extension_ui_request","id":"n1","method":"notify","message":"hi"}',
  ]);
  await flush();
  assert.deepEqual(proc.sent.slice(2), [
    { type: 'extension_ui_response', id: 'd1', cancelled: true },
  ]);
  proc.feedOpen([AGENT_END, AGENT_SETTLED]);
  const events = await done;
  assert.equal(events.filter((e) => e.type === 'turn_completed').length, 1);
  await adapter.stop();
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

  proc.feed([AGENT_END, AGENT_SETTLED]);
  await done;
  // Writing now would be read as a NEW turn on the same process.
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'u1', text: 'late' }),
    false,
  );
  await flush();
  assert.deepEqual(proc.sent, [{ type: 'get_state' }, { type: 'prompt', message: 'first' }]);
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

test('parsePiLine maps agent_end (with willRetry) and agent_settled', () => {
  assert.deepEqual(parsePiLine(AGENT_END), { kind: 'end', willRetry: false });
  assert.deepEqual(parsePiLine('{"type":"agent_end","messages":[],"willRetry":true}'), {
    kind: 'end',
    willRetry: true,
  });
  assert.deepEqual(parsePiLine(AGENT_SETTLED), { kind: 'settled' });
});

test('parsePiLine maps a failed RPC response, get_state, and ignores other successes', () => {
  assert.deepEqual(parsePiLine('{"type":"response","command":"prompt","success":true}'), {
    kind: 'other',
  });
  assert.deepEqual(parsePiLine(STATE), { kind: 'state', sessionId: 'sess-1' });
  assert.deepEqual(parsePiLine(STATE_WITH_WINDOW), {
    kind: 'state',
    sessionId: 'sess-1',
    contextWindow: 200000,
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

test('PiAdapter reuses the persistent session process across turns on the same thread', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });

  // Turn 1
  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first question' });
  const proc = last();
  assert.equal(adapter.hasActiveSession('t1'), true);

  proc.feedOpen([STATE, assistantEnd('first reply'), AGENT_END, AGENT_SETTLED]);
  await first.done;
  await flush();

  assert.equal(proc.stdinEnded, false, 'process stays alive between turns');
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Turn 2 on the SAME session process
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'second question' });
  assert.equal(last(), proc, 'same child process is reused without re-spawn');
  await flush();
  assert.deepEqual(proc.sent, [
    { type: 'get_state' },
    { type: 'prompt', message: 'first question' },
    { type: 'prompt', message: 'second question' },
  ]);

  proc.feedOpen([assistantEnd('second reply'), AGENT_END, AGENT_SETTLED]);
  await second.done;

  // Stopping adapter tears down the persistent session
  await adapter.stop();
  assert.equal(proc.stdinEnded, true);
  assert.equal(adapter.hasActiveSession('t1'), false);
});

test('PiAdapter recycles persistent session when cwd or model changes', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });

  // Turn 1 on /dirA
  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one', cwd: '/dirA' });
  const proc1 = last();
  proc1.feedOpen([STATE, assistantEnd('a'), AGENT_END, AGENT_SETTLED]);
  await first.done;

  // Turn 2 with different cwd /dirB -> must dismantle proc1 and spawn proc2 with --session-id
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two', cwd: '/dirB' });
  const proc2 = last();
  assert.notEqual(proc1, proc2, 'new process spawned for different cwd');
  assert.equal(proc1.stdinEnded, true, 'previous session dismantled');
  const args = proc2.args;
  assert.equal(args.includes('--session-id'), true);
  assert.equal(args[args.indexOf('--session-id') + 1], 'sess-1');

  proc2.feedOpen([assistantEnd('b'), AGENT_END, AGENT_SETTLED]);
  await second.done;
  await adapter.stop();
});

test('PiAdapter cancelTurn kills the process (no abort) and emits turn_aborted', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'long job' });
  const proc = last();
  assert.equal(adapter.hasActiveSession('t1'), true);

  await adapter.cancelTurn('t1', 'u1');
  await flush();

  // A kill is the cancel: nothing is written into a process about to die.
  assert.deepEqual(proc.sent, [{ type: 'get_state' }, { type: 'prompt', message: 'long job' }]);
  assert.equal(proc.stdinEnded, true);
  assert.equal(adapter.hasActiveSession('t1'), false);
  const aborted = events.find((e) => e.type === 'turn_aborted');
  assert.notEqual(aborted, undefined);
});

test('PiAdapter idleTimeoutMs tears down inactive persistent session', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn, idleTimeoutMs: 20 });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  const proc = last();
  proc.feedOpen([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
  await first.done;
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Wait for idle timer to fire (20ms)
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(adapter.hasActiveSession('t1'), false);
  assert.equal(proc.stdinEnded, true);
});

test('DEFAULT_PI_IDLE_TIMEOUT_MS defaults to 24 hours', () => {
  assert.equal(DEFAULT_PI_IDLE_TIMEOUT_MS, 24 * 60 * 60 * 1000);
  const adapter = new PiAdapter({ binaryPath: 'pi' });
  assert.equal(adapter.idleTimeoutMs, 24 * 60 * 60 * 1000);
});

test('PiAdapter closeSession tears down active persistent session immediately', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  const proc = last();
  proc.feedOpen([STATE, assistantEnd('ok'), AGENT_END, AGENT_SETTLED]);
  await first.done;
  assert.equal(adapter.hasActiveSession('t1'), true);

  await adapter.closeSession('t1');
  assert.equal(adapter.hasActiveSession('t1'), false);
  assert.equal(proc.stdinEnded, true);
});

test('PiAdapter interaction refreshes the idle timeout countdown', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn, idleTimeoutMs: 50 });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const proc = last();
  proc.feedOpen([STATE, assistantEnd('ok 1'), AGENT_END, AGENT_SETTLED]);
  await first.done;
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Advance 30ms (timer has 20ms left)
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Second interaction starts and finishes -> should refresh the 50ms countdown!
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'second' });
  proc.feedOpen([assistantEnd('ok 2'), AGENT_END, AGENT_SETTLED]);
  await second.done;

  // Another 30ms: if timer wasn't refreshed, total time would be 60ms (>50ms) and session would be dead
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    adapter.hasActiveSession('t1'),
    true,
    'session must still be alive because timer was refreshed',
  );

  // Wait remaining 30ms to exceed new 50ms window
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(
    adapter.hasActiveSession('t1'),
    false,
    'session now dismantled after refreshed timeout expires',
  );
  await adapter.stop();
});

test('PiAdapter ends the turn on agent_settled, not on an agent_end pi will retry', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const { events, done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  // A retryable provider error: the run ends, pi retries on its own …
  last().feedOpen([
    STATE,
    assistantEnd('', { error: '521: Provider returned error' }),
    '{"type":"agent_end","messages":[],"willRetry":true}',
  ]);
  await flush();
  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
    'the turn is still open',
  );
  // … and the retried run answers; only `agent_settled` closes the turn.
  last().feedOpen([assistantEnd('PING', { tokens: 2400 }), AGENT_END]);
  await flush();
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
    'agent_end alone is not the end',
  );
  last().feedOpen([AGENT_SETTLED]);
  const all = await done;
  const completed = all.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'PING');
});

// --- commands: pi's own list (`get_commands`) ---

function commandsSpawner(commands: unknown[]): {
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
      stdout.write(
        `${JSON.stringify({ type: 'response', command: 'get_commands', success: true, data: { commands } })}\n`,
      );
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

test('listCommands: prompts and skills as pi lists them; extension commands left out', async () => {
  const { spawnFn, calls } = commandsSpawner([
    { name: 'llama', description: 'Manage models', source: 'extension' },
    { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt', location: 'project' },
    { name: 'skill:brave-search', description: 'Web search', source: 'skill', location: 'user' },
  ]);
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  const commands = await adapter.listCommands('/repo');
  assert.deepEqual(
    commands.map((c) => [c.name, c.source, c.description]),
    [
      ['fix-tests', 'custom', 'Fix failing tests'],
      ['skill:brave-search', 'skill', 'Web search'],
    ],
  );
  // A throwaway process in the thread's folder that never makes a session.
  assert.equal(calls[0]!.cwd, '/repo');
  assert.deepEqual(calls[0]!.args, ['--mode', 'rpc', '--no-session']);
  assert.match(calls[0]!.written.join(''), /"type":"get_commands"/);
  // Reused for the folder within the minute.
  await adapter.listCommands('/repo');
  assert.equal(calls.length, 1);
});

test('listCommands asks with the posture a turn runs with, so it lists what runs', async () => {
  for (const [permissionMode, flags] of [
    ['default', ['--tools', 'read,grep,find,ls']],
    ['bypassPermissions', ['--approve']],
  ] as const) {
    const { spawnFn, calls } = commandsSpawner([]);
    const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn, permissionMode });
    await adapter.listCommands('/repo');
    assert.deepEqual(calls[0]!.args, ['--mode', 'rpc', '--no-session', ...flags]);
  }
});

test('listCommands yields none when pi does not answer', async () => {
  const spawnFn = (): SpawnedProcess => {
    const emitter = new EventEmitter();
    setImmediate(() => emitter.emit('close', 1));
    return {
      stdout: new PassThrough(),
      stdin: new PassThrough(),
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => undefined,
    } as SpawnedProcess;
  };
  const adapter = new PiAdapter({ binaryPath: 'pi', spawnFn });
  assert.deepEqual(await adapter.listCommands('/repo'), []);
});

test('parsePiCommands reads only the get_commands answer', () => {
  assert.equal(
    parsePiCommands('{"type":"response","command":"get_state","success":true}'),
    undefined,
  );
  assert.equal(parsePiCommands('No API key found'), undefined);
  assert.deepEqual(
    parsePiCommands(
      JSON.stringify({
        type: 'response',
        command: 'get_commands',
        success: true,
        data: { commands: [{ name: 'x', source: 'prompt' }, { nope: 1 }] },
      }),
    ),
    [{ name: 'x', source: 'prompt' }],
  );
  assert.deepEqual(
    parsePiCommands('{"type":"response","command":"get_commands","success":false}'),
    [],
  );
});
