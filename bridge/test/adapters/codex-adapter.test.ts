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
  parseCodexReasoning,
  type SpawnedProcess,
} from '../../src/index.js';
import { codexFileChanges } from '../../src/adapters/codex-tools.js';
import { unifiedDiffBlock } from '../../src/adapters/content-blocks.js';
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
  // reasoning items become thinking; command_execution items become blocks
  assert.deepEqual(
    parseCodexLine('{"type":"item.completed","item":{"type":"reasoning","text":"x"}}'),
    { kind: 'thinking', text: 'x' },
  );
  const cmd = parseCodexLine(
    '{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a","exit_code":0,"status":"completed"}}',
  );
  assert.equal(cmd?.kind, 'block');
  assert.deepEqual(cmd?.blocks?.[0], {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a',
  });
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

test('CodexAdapter emits thinking and structured blocks from items', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new CodexAdapter({ binaryPath: 'codex', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  last().feed([
    '{"type":"item.completed","item":{"type":"reasoning","text":"thinking it through"}}',
    '{"type":"item.completed","item":{"type":"command_execution","command":"type a.txt","aggregated_output":"hello","exit_code":0,"status":"completed"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    '{"type":"turn.completed","usage":{}}',
  ]);

  const events = await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['thinking it through']);
  const blocks = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.['type'], 'command_execution');
});

test('unifiedDiffBlock parses a git diff into hunks + real +/- counts', () => {
  const gitDiff = [
    'diff --git a/file.txt b/file.txt',
    'index e69de29..1234567 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,3 +1,4 @@',
    ' line one',
    '-line two',
    '+line two edited',
    '+brand new line',
    ' line three',
    '',
  ].join('\n');
  const block = unifiedDiffBlock('file.txt', gitDiff);
  assert.equal(block['type'], 'diff');
  assert.equal(block['filename'], 'file.txt');
  // one removal, two additions — not the whole file
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 1);
  // the file-level header is stripped; the @@ hunk + content kept
  assert.equal(
    block['diff'],
    '@@ -1,3 +1,4 @@\n line one\n-line two\n+line two edited\n+brand new line\n line three',
  );
});

test('codexFileChanges extracts changed paths/kinds (adapter reads the content)', () => {
  const changes = codexFileChanges({
    type: 'file_change',
    changes: [
      { path: 'a.dart', kind: 'update' },
      { path: 'b.dart', kind: 'add' },
    ],
  });
  assert.deepEqual(changes, [
    { path: 'a.dart', kind: 'update' },
    { path: 'b.dart', kind: 'add' },
  ]);
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
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'high', description: 'Deep' },
        { reasoningEffort: 'xhigh', description: 'Extra deep' },
      ],
      defaultReasoningEffort: 'high',
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
  // the model's REAL per-model reasoning efforts are advertised (incl. xhigh)
  const reasoning = models[0]?.options?.find((o) => o.key === 'reasoning');
  assert.deepEqual(
    reasoning?.values?.map((v) => v.value),
    ['low', 'high', 'xhigh'],
  );
  assert.equal(reasoning?.values?.find((v) => v.value === 'xhigh')?.label, 'Extra high');
  assert.equal(reasoning?.default, 'high');
  // a model with no efforts advertises no reasoning knob
  assert.equal(models[1]?.options, undefined);
  assert.deepEqual(parseCodexModelList('not an array'), []);
});

test('parseCodexReasoning builds a knob from supportedReasoningEfforts', () => {
  const opts = parseCodexReasoning(
    [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }],
    'high',
  );
  assert.equal(opts[0]?.key, 'reasoning');
  assert.deepEqual(
    opts[0]?.values?.map((v) => v.value),
    ['low', 'high', 'xhigh'],
  );
  assert.equal(opts[0]?.default, 'high');
  // no efforts → no knob; a default outside the list is dropped
  assert.deepEqual(parseCodexReasoning(undefined, 'high'), []);
  assert.equal(
    parseCodexReasoning([{ reasoningEffort: 'low' }], 'bogus')[0]?.default,
    undefined,
  );
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
