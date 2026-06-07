import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  OpenCodeAdapter,
  parseOpenCodeLine,
  parseModelList,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `opencode` process whose stdout we feed with --format json lines ---
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

function collect(adapter: OpenCodeAdapter): {
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

test('parseModelList extracts unique provider/model ids', () => {
  const out = [
    'opencode/big-pickle',
    'opencode/deepseek-v4-flash-free',
    'opencode/big-pickle', // duplicate
    '', // blank
    'Available models:', // header (has a space)
    'ollama-cloud/gemma4:31b',
  ].join('\n');
  assert.deepEqual(parseModelList(out), [
    'opencode/big-pickle',
    'opencode/deepseek-v4-flash-free',
    'ollama-cloud/gemma4:31b',
  ]);
});

test('parseOpenCodeLine maps the documented event shapes', () => {
  assert.equal(parseOpenCodeLine('not json'), null);
  assert.deepEqual(
    parseOpenCodeLine('{"type":"text","sessionID":"s","part":{"id":"p","text":"hi"}}'),
    {
      kind: 'text',
      sessionId: 's',
      partId: 'p',
      text: 'hi',
    },
  );
  assert.equal(
    parseOpenCodeLine('{"type":"step_finish","sessionID":"s","part":{}}')?.kind,
    'finish',
  );
  assert.equal(
    parseOpenCodeLine('{"type":"error","error":{"data":{"message":"boom"}}}')?.text,
    'boom',
  );
});

test('OpenCodeAdapter streams text parts as deltas and completes', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new OpenCodeAdapter({ binaryPath: 'opencode', defaultModel: 'm', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"step_start","sessionID":"ses_1","part":{"id":"p0","type":"step-start"}}',
    '{"type":"text","sessionID":"ses_1","part":{"id":"p1","type":"text","text":"Hello "}}',
    '{"type":"text","sessionID":"ses_1","part":{"id":"p2","type":"text","text":"world"}}',
    '{"type":"step_finish","sessionID":"ses_1","part":{"reason":"stop"}}',
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');
  // first turn used the configured model and no --session yet
  assert.ok(last().args.includes('--model'));
  assert.equal(last().args.includes('--session'), false);
});

test('OpenCodeAdapter reuses the captured session id on the next turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new OpenCodeAdapter({ binaryPath: 'opencode', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  last().feed(['{"type":"text","sessionID":"ses_42","part":{"id":"p1","text":"a"}}']);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const argsForSecond = last().args;
  last().feed(['{"type":"text","sessionID":"ses_42","part":{"id":"p9","text":"b"}}']);
  await second.done;

  const idx = argsForSecond.indexOf('--session');
  assert.notEqual(idx, -1);
  assert.equal(argsForSecond[idx + 1], 'ses_42');
});

test('OpenCodeAdapter surfaces an error event as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new OpenCodeAdapter({ binaryPath: 'opencode', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed(['{"type":"error","sessionID":"ses_1","error":{"data":{"message":"no credits"}}}']);

  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'no credits');
});
