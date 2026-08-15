import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  AntigravityAdapter,
  antigravityPermissionMode,
  antigravityPermissionArgs,
  normalizeAntigravityModel,
  parseAntigravityModelList,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `agy` process: plain-text stdout (the answer) + stderr (errors) ---
interface FakeSpawn {
  args: string[];
  cwd: string;
  /** Write plain-text chunks to STDOUT (the answer), then close. */
  feed(chunks: string[]): void;
  /** Write error lines to STDERR, then close with no stdout (the headless auto-deny). */
  feedError(lines: string[]): void;
}

function fakeSpawner(): {
  spawnFn: (command: string, args: string[], cwd: string) => SpawnedProcess;
  last(): FakeSpawn;
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (_command: string, args: string[], cwd: string): SpawnedProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    stdout.on('end', () => emitter.emit('close', 0));
    const proc: SpawnedProcess = {
      stdout,
      stderr,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
    spawns.push({
      args,
      cwd,
      feed: (chunks) => {
        for (const chunk of chunks) stdout.write(chunk);
        stdout.end();
      },
      feedError: (lines) => {
        for (const line of lines) stderr.write(`${line}\n`);
        // End stderr first, then stdout, so all stderr data is delivered before
        // the adapter reads it on the stdout `close` (deterministic ordering).
        stderr.on('end', () => stdout.end());
        stderr.end();
      },
    });
    return proc;
  };
  return { spawnFn, last: () => spawns[spawns.length - 1]! };
}

function collect(adapter: AntigravityAdapter): { done: Promise<AgentStreamEvent[]> } {
  const events: AgentStreamEvent[] = [];
  let resolve!: (e: AgentStreamEvent[]) => void;
  const done = new Promise<AgentStreamEvent[]>((r) => (resolve = r));
  adapter.onEvent((event) => {
    events.push(event);
    if (event.type === 'turn_completed' || event.type === 'turn_error') resolve(events);
  });
  return { done };
}

test('parseAntigravityModelList splits id + label, marks a default, skips dupes', () => {
  // Captured verbatim from `agy models` (1.1.13) on a signed-in machine: a
  // progress line, then `<id>⟨TAB⟩<label>` rows.
  const output = [
    'Fetching available models...',
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
    '',
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)', // duplicate → dropped
    'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  ].join('\r\n');
  const models = parseAntigravityModelList(output);
  // The progress line is NOT a model: taking it made it the default, and the
  // phone then sent `--model "Fetching available models..."`, failing every turn.
  assert.deepEqual(
    models.map((m) => m.id),
    ['gemini-3.7-flash-high', 'gemini-3.7-flash-low', 'claude-opus-4-6-thinking'],
  );
  // The id is the routing key; the label is what the phone shows.
  assert.equal(models[0]?.displayName, 'Gemini 3.7 Flash (High)');
  assert.equal(models[0]?.isDefault, true);
  assert.equal(models[1]?.isDefault, undefined);
});

test('parseAntigravityModelList keeps bare ids and drops prose', () => {
  // Older `agy` printed one bare id per line, and a signed-out CLI answers in
  // sentences — which must never be minted into a phantom model.
  const models = parseAntigravityModelList(
    ['Available models:', 'gemini-3.1-pro-high', 'Please sign in to continue.', ''].join('\n'),
  );
  assert.deepEqual(
    models.map((m) => m.id),
    ['gemini-3.1-pro-high'],
  );
  assert.equal(models[0]?.displayName, 'gemini-3.1-pro-high');
});

test('parseAntigravityModelList marks a configured default when it matches', () => {
  const output =
    'gemini-3.5-flash-medium\tGemini 3.5 Flash (Medium)\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)';
  const models = parseAntigravityModelList(output, 'gemini-3.1-pro-high');
  assert.equal(models[0]?.isDefault, undefined);
  assert.equal(models[1]?.isDefault, true);
});

test('normalizeAntigravityModel recovers a selection stored as the whole list line', () => {
  // What the previous parser handed the phone; `agy` rejects it outright.
  assert.equal(
    normalizeAntigravityModel('gemini-3.6-flash-low\tGemini 3.6 Flash (Low)'),
    'gemini-3.6-flash-low',
  );
  // A plain id (and a label, which `agy` also accepts) passes through untouched.
  assert.equal(normalizeAntigravityModel('gemini-3.6-flash-low'), 'gemini-3.6-flash-low');
  assert.equal(normalizeAntigravityModel('Gemini 3.6 Flash (Low)'), 'Gemini 3.6 Flash (Low)');
  // Nothing usable → no `--model` at all, so `agy` runs on its own default.
  assert.equal(normalizeAntigravityModel(undefined), undefined);
  assert.equal(normalizeAntigravityModel('  '), undefined);
});

test('antigravityPermissionArgs maps posture to the right flags', () => {
  assert.deepEqual(antigravityPermissionArgs('plan'), ['--mode', 'plan']);
  assert.deepEqual(antigravityPermissionArgs('acceptEdits'), ['--dangerously-skip-permissions']);
  assert.deepEqual(antigravityPermissionArgs('bypassPermissions'), [
    '--dangerously-skip-permissions',
  ]);
});

test('antigravityPermissionMode maps the config posture, defaulting to autonomous', () => {
  assert.equal(antigravityPermissionMode('acceptEdits'), 'acceptEdits');
  assert.equal(antigravityPermissionMode('bypassPermissions'), 'bypassPermissions');
  assert.equal(antigravityPermissionMode('default'), 'bypassPermissions');
  assert.equal(antigravityPermissionMode(undefined), 'bypassPermissions');
});

test('AntigravityAdapter streams stdout as deltas and completes with the full text', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/proj' });
  last().feed(['Hello ', 'world']);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');

  // First turn: a client-owned --conversation id, the workspace, autonomous
  // skip-permissions, and the prompt as the final positional.
  const args = last().args;
  const convIdx = args.indexOf('--conversation');
  assert.notEqual(convIdx, -1);
  assert.match(args[convIdx + 1]!, /^[0-9a-f-]{36}$/);
  assert.equal(args[args.indexOf('--add-dir') + 1], '/proj');
  assert.equal(args.includes('--dangerously-skip-permissions'), true);
  assert.equal(args[args.length - 2], '-p');
  assert.equal(args[args.length - 1], 'hi');
});

test('AntigravityAdapter reuses the same conversation id across turns', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one', cwd: '/p' });
  const firstArgs = last().args;
  last().feed(['a']);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two', cwd: '/p' });
  const secondArgs = last().args;
  last().feed(['b']);
  await second.done;

  const id1 = firstArgs[firstArgs.indexOf('--conversation') + 1];
  const id2 = secondArgs[secondArgs.indexOf('--conversation') + 1];
  assert.equal(id1, id2);
  assert.equal(adapter.nativeSessionId('t1'), id1);
});

test('AntigravityAdapter passes the selected model', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    cwd: '/p',
    service: 'gemini-3.1-pro-high',
  });
  last().feed(['ok']);
  await done;
  const args = last().args;
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.1-pro-high');
});

test('AntigravityAdapter repairs a model stored as the whole `agy models` line', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    cwd: '/p',
    // A thread picked before the parser fix carries `<id>⟨TAB⟩<label>`, which
    // `agy` rejects — it must reach the CLI as the id alone.
    service: 'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
  });
  last().feed(['ok']);
  await done;
  const args = last().args;
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.1-pro-high');
});

test('AntigravityAdapter maps accessMode to plan vs skip-permissions', async () => {
  const cases = [
    { accessMode: 'requestApproval' as const, plan: true },
    { accessMode: 'approveForMe' as const, plan: false },
    { accessMode: 'fullAccess' as const, plan: false },
  ];
  for (const { accessMode, plan } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p', accessMode });
    last().feed(['ok']);
    await done;
    const args = last().args;
    assert.equal(
      args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'plan',
      plan,
      `accessMode=${accessMode} plan=${plan}`,
    );
    assert.equal(args.includes('--dangerously-skip-permissions'), !plan);
  }
});

test('AntigravityAdapter surfaces the stderr diagnostic when stdout is empty', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  last().feedError(['jetski: no output produced — a tool required the "write_file" permission']);

  const events = await done;
  const error = events.find((e) => e.type === 'turn_error');
  assert.ok(error, 'expected a turn_error');
  assert.match((error?.data as { text: string }).text, /no output produced/);
});

test('AntigravityAdapter cancelTurn kills the run and emits turn_aborted', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  void last(); // run is in-flight
  await adapter.cancelTurn('t1', 'u1');
  assert.ok(events.some((e) => e.type === 'turn_aborted'));
});

test('AntigravityAdapter.listModels spawns `agy models` and parses the output', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const listing = adapter.listModels();
  last().feed([
    'Fetching available models...\n',
    'gemini-3.5-flash-medium\tGemini 3.5 Flash (Medium)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n',
  ]);
  const models = await listing;
  assert.equal(last().args[last().args.length - 1], 'models');
  assert.deepEqual(
    models.map((m) => m.id),
    ['gemini-3.5-flash-medium', 'claude-sonnet-4-6'],
  );
  assert.deepEqual(
    models.map((m) => m.displayName),
    ['Gemini 3.5 Flash (Medium)', 'Claude Sonnet 4.6 (Thinking)'],
  );
});

test('AntigravityAdapter names a conversation on the cheap flash tier', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const titling = adapter.generateTitle({ userText: 'hi', assistantText: 'ok', cwd: '/p' });
  last().feed(['Fix the model list']);
  assert.equal(await titling, 'Fix the model list');

  const args = last().args;
  // It used to pass no model at all, so a six-word title ran on the account's
  // default (frontier) tier — the very quota the user is working with.
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.6-flash-low');
  // And it must never join the conversation the thread resumes.
  assert.equal(args.includes('--conversation'), false);
});
