import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  CodexAdapter,
  codexUsageTokens,
  parseCodexConfigModels,
  parseCodexLine,
  parseCodexModelList,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `codex` process whose stdout we feed with `exec --json` lines ---
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

function collect(adapter: CodexAdapter): {
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

test('parseCodexLine maps the documented event shapes', () => {
  assert.equal(parseCodexLine('not json'), null);
  assert.deepEqual(parseCodexLine('{"type":"thread.started","thread_id":"019ea9"}'), {
    kind: 'thread',
    threadId: '019ea9',
  });
  assert.deepEqual(
    parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}'),
    { kind: 'message', text: 'hi' },
  );
  assert.equal(parseCodexLine('{"type":"turn.completed","usage":{}}')?.kind, 'completed');
  assert.equal(parseCodexLine('{"type":"turn.failed","error":{"message":"boom"}}')?.text, 'boom');
  // non-agent_message items (reasoning, command execution, …) are inert
  assert.equal(
    parseCodexLine('{"type":"item.completed","item":{"type":"reasoning","text":"x"}}')?.kind,
    'other',
  );
});

test('CodexAdapter streams agent messages as deltas and completes', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', defaultModel: 'gpt-5', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"thread.started","thread_id":"019abc"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello world"}}',
    '{"type":"turn.completed","usage":{}}',
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['hello world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'hello world');
  // first turn used the configured model, the json/safety flags, and no `resume`
  const args = last().args;
  assert.deepEqual(args.slice(0, 3), ['exec', '--json', '--skip-git-repo-check']);
  assert.ok(args.includes('-m'));
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-5');
  assert.equal(args.includes('resume'), false);
  // prompt is the final argv element, never shell-interpolated
  assert.equal(args[args.length - 1], 'hi');
});

test('CodexAdapter maps reasoning effort to -c model_reasoning_effort', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', effort: 'high' });
  last().feed(['{"type":"turn.completed","usage":{}}']);
  await done;

  const args = last().args;
  const i = args.indexOf('-c');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'model_reasoning_effort=high');
});

test('CodexAdapter maps the reasoning knob (options) to -c model_reasoning_effort', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    options: { reasoning: 'low' },
  });
  last().feed(['{"type":"turn.completed","usage":{}}']);
  await done;

  const args = last().args;
  assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort=low');
});

test('CodexAdapter omits the reasoning override when no effort is set', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed(['{"type":"turn.completed","usage":{}}']);
  await done;

  assert.equal(last().args.includes('-c'), false);
});

test('CodexAdapter reuses the captured thread id with `resume` on the next turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  last().feed([
    '{"type":"thread.started","thread_id":"019xyz"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"a"}}',
    '{"type":"turn.completed","usage":{}}',
  ]);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const argsForSecond = last().args;
  last().feed([
    '{"type":"thread.started","thread_id":"019xyz"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"b"}}',
    '{"type":"turn.completed","usage":{}}',
  ]);
  await second.done;

  const idx = argsForSecond.indexOf('resume');
  assert.notEqual(idx, -1);
  assert.equal(argsForSecond[idx + 1], '019xyz');
  // the prompt still trails the resume subcommand
  assert.equal(argsForSecond[argsForSecond.length - 1], 'two');
});

test('CodexAdapter surfaces a failed turn as turn_error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"thread.started","thread_id":"019abc"}',
    '{"type":"turn.failed","error":{"message":"no credits"}}',
  ]);

  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'no credits');
});

test('CodexAdapter maps the permission posture to the right sandbox flag', async () => {
  const cases = [
    { mode: 'acceptEdits' as const, sandbox: 'workspace-write', bypass: false },
    { mode: 'default' as const, sandbox: 'read-only', bypass: false },
    { mode: 'bypassPermissions' as const, sandbox: undefined, bypass: true },
  ];
  for (const { mode, sandbox, bypass } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new CodexAdapter({ binaryPath: 'codex', permissionMode: mode, spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
    last().feed(['{"type":"turn.completed","usage":{}}']);
    await done;

    const args = last().args;
    assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), bypass);
    if (sandbox) assert.equal(args[args.indexOf('-s') + 1], sandbox);
    else assert.equal(args.includes('-s'), false);
  }
});

test('codexUsageTokens sums input, output and reasoning (not cached)', () => {
  assert.equal(
    codexUsageTokens({
      input_tokens: 13334,
      cached_input_tokens: 2432,
      output_tokens: 15,
      reasoning_output_tokens: 8,
    }),
    13357,
  );
  assert.equal(codexUsageTokens({}), undefined);
  assert.equal(codexUsageTokens('nope'), undefined);
});

test('parseCodexLine reads usage tokens from turn.completed', () => {
  const event = parseCodexLine(
    '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20,' +
      '"reasoning_output_tokens":5}}',
  );
  assert.equal(event?.kind, 'completed');
  assert.equal(event?.tokens, 125);
});

test('parseCodexModelList maps app-server models and skips hidden ones', () => {
  const data = [
    {
      id: 'gpt-5.5',
      model: 'gpt-5.5',
      displayName: 'GPT-5.5',
      description: 'Frontier model.',
      isDefault: true,
      hidden: false,
    },
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', description: '', isDefault: false },
    { id: 'secret', displayName: 'Secret', hidden: true },
    { model: 'fallback-id' },
    { displayName: 'no id here' },
  ];
  const models = parseCodexModelList(data);
  assert.deepEqual(
    models.map((m) => m.id),
    ['gpt-5.5', 'gpt-5.4-mini', 'fallback-id'],
  );
  assert.equal(models[0]?.displayName, 'GPT-5.5');
  assert.equal(models[0]?.description, 'Frontier model.');
  assert.equal(models[0]?.isDefault, true);
  // empty description is omitted; missing displayName falls back to id
  assert.equal(models[1]?.description, undefined);
  assert.equal(models[2]?.displayName, 'fallback-id');
  assert.deepEqual(parseCodexModelList('not an array'), []);
});

test('parseCodexConfigModels reads model + availability table from config.toml', () => {
  const toml = [
    'personality = "pragmatic"',
    'model = "gpt-5.5"',
    'model_reasoning_effort = "low"',
    '[tui.model_availability_nux]',
    '"gpt-5.5" = 1',
    '"gpt-5.4-mini" = 1',
    "[projects.'c:\\users\\agent']",
    'trust_level = "trusted"',
  ].join('\n');
  const models = parseCodexConfigModels(toml);
  assert.deepEqual(models.map((m) => m.id).sort(), ['gpt-5.4-mini', 'gpt-5.5']);
  assert.equal(models.find((m) => m.id === 'gpt-5.5')?.isDefault, true);
  assert.equal(models.find((m) => m.id === 'gpt-5.4-mini')?.isDefault, false);
  assert.deepEqual(parseCodexConfigModels(''), []);
});
