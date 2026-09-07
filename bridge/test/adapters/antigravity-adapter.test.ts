import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  AntigravityAdapter,
  antigravityPermissionMode,
  antigravityPermissionArgs,
  normalizeAntigravityModel,
  parseAntigravityModelList,
  parseAntigravityLine,
  buildAntigravityToolBlock,
  getAntigravityTranscriptPath,
  DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS,
  type AntigravityUsage,
  type SpawnedProcess,
} from '../../src/index.js';
import type { SpawnExtra } from '../../src/adapters/spawn.js';
import type { AgentStreamEvent } from '@uxnan/shared';

function stepUpdate(delta: string): string {
  return JSON.stringify({
    event: 'step_update',
    step_update: { text_delta: delta },
  });
}

function resultEvent(response: string, usage?: AntigravityUsage, error?: string): string {
  return JSON.stringify({
    event: 'result',
    result: {
      status: error ? 'ERROR' : 'SUCCESS',
      response,
      ...(error ? { error } : {}),
      ...(usage ? { usage } : {}),
    },
  });
}

// --- a fake `agy` process: supports piped stdin, stdout stream-json, stderr ---
interface FakeSpawn {
  args: string[];
  cwd: string;
  pipedStdin: boolean;
  readonly stdinData: string;
  /** Write stream lines to STDOUT, then close. */
  feed(lines: string[]): void;
  /** Write stream lines to STDOUT WITHOUT closing (for persistent multi-turn sessions). */
  feedOpen(lines: string[]): void;
  /** Write error lines to STDERR, then close with no stdout. */
  feedError(lines: string[]): void;
}

function fakeSpawner(): {
  spawnFn: (command: string, args: string[], cwd: string, extra?: SpawnExtra) => SpawnedProcess;
  last(): FakeSpawn;
  spawns: FakeSpawn[];
} {
  const spawns: FakeSpawn[] = [];
  const spawnFn = (
    _command: string,
    args: string[],
    cwd: string,
    extra?: SpawnExtra,
  ): SpawnedProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const emitter = new EventEmitter();
    let stdinData = '';
    stdin.on('data', (chunk) => {
      stdinData += String(chunk);
    });
    stdout.on('end', () => emitter.emit('close', 0));
    const record: FakeSpawn = {
      args,
      cwd,
      pipedStdin: extra?.stdin === 'pipe',
      get stdinData() {
        return stdinData;
      },
      feed: (lines) => {
        for (const line of lines) stdout.write(`${line}\n`);
        stdout.end();
      },
      feedOpen: (lines) => {
        for (const line of lines) stdout.write(`${line}\n`);
      },
      feedError: (lines) => {
        for (const line of lines) stderr.write(`${line}\n`);
        stderr.on('end', () => stdout.end());
        stderr.end();
      },
    };
    spawns.push(record);
    const proc: SpawnedProcess = {
      stdout,
      stderr,
      stdin,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
    return proc;
  };
  return { spawnFn, last: () => spawns[spawns.length - 1]!, spawns };
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
  last().feed([
    stepUpdate('Hello '),
    stepUpdate('world'),
    resultEvent('Hello world', { total_tokens: 128 }),
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');
  assert.deepEqual((completed?.data as { usage?: unknown }).usage, { tokens: 128 });

  // First turn: piped stdin carrying the stream-json message, workspace targeting,
  // autonomous skip-permissions, and stream-json formats.
  assert.equal(last().pipedStdin, true);
  assert.match(last().stdinData, /"text":"hi"/);

  const args = last().args;
  const convIdx = args.indexOf('--conversation');
  assert.notEqual(convIdx, -1);
  assert.match(args[convIdx + 1]!, /^[0-9a-f-]{36}$/);
  assert.equal(args[args.indexOf('--add-dir') + 1], '/proj');
  assert.equal(args.includes('--dangerously-skip-permissions'), true);
  assert.equal(args.includes('--input-format'), true);
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args.includes('--output-format'), true);
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(args.includes('--print-timeout'), true);
  assert.equal(args[args.indexOf('--print-timeout') + 1], '2h');
});

test('AntigravityAdapter reuses the same conversation id across turns', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one', cwd: '/p' });
  const firstArgs = last().args;
  last().feedOpen([stepUpdate('a'), resultEvent('a')]);
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two', cwd: '/p' });
  const secondArgs = last().args;
  last().feed([stepUpdate('b'), resultEvent('b')]);
  await second.done;

  const id1 = firstArgs[firstArgs.indexOf('--conversation') + 1];
  const id2 = secondArgs[secondArgs.indexOf('--conversation') + 1];
  assert.equal(id1, id2);
  assert.equal(adapter.nativeSessionId('t1'), id1);
});

test('AntigravityAdapter maintains persistent session across multiple turns without re-spawning', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'turn one', cwd: '/proj' });
  last().feedOpen([stepUpdate('Reply 1'), resultEvent('Reply 1')]);
  await first.done;
  assert.equal(spawns.length, 1);

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'turn two', cwd: '/proj' });
  last().feedOpen([stepUpdate('Reply 2'), resultEvent('Reply 2')]);
  await second.done;

  // Single persistent process reused!
  assert.equal(spawns.length, 1);
  assert.match(last().stdinData, /"text":"turn one"/);
  assert.match(last().stdinData, /"text":"turn two"/);
});

test('AntigravityAdapter recycles session when workspace cwd changes', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'p1', cwd: '/proj1' });
  last().feedOpen([resultEvent('done 1')]);
  await first.done;
  assert.equal(spawns.length, 1);
  assert.equal(last().cwd, '/proj1');

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'p2', cwd: '/proj2' });
  last().feedOpen([resultEvent('done 2')]);
  await second.done;

  // New session spawned for the new workspace directory
  assert.equal(spawns.length, 2);
  assert.equal(last().cwd, '/proj2');
  // Conversation continuity preserved
  const id1 = spawns[0]!.args[spawns[0]!.args.indexOf('--conversation') + 1];
  const id2 = spawns[1]!.args[spawns[1]!.args.indexOf('--conversation') + 1];
  assert.equal(id1, id2);
});

test('AntigravityAdapter tears down session after idle timeout', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  // Fast 50ms timeout for test
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn, idleTimeoutMs: 50 });

  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/proj' });
  spawns[0]!.feedOpen([resultEvent('ok')]);
  await done;

  assert.equal(adapter.hasActiveSession('t1'), true);
  // Wait past idle timeout
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(adapter.hasActiveSession('t1'), false);
});

test('AntigravityAdapter capabilities reportsContextUsage is true', () => {
  const adapter = new AntigravityAdapter();
  assert.equal(adapter.capabilities.reportsContextUsage, true);
  assert.equal(adapter.idleTimeoutMs, DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS);
  assert.equal(DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS, 2 * 60 * 60 * 1000);
});

test('parseAntigravityLine correctly parses stream-json events', () => {
  assert.equal(parseAntigravityLine(''), null);
  assert.equal(parseAntigravityLine('not json'), null);

  const init = parseAntigravityLine(
    JSON.stringify({ event: 'init', conversation_id: 'c1', init: { cwd: '/workspace' } }),
  );
  assert.deepEqual(init, { kind: 'init', conversationId: 'c1', cwd: '/workspace' });

  const step = parseAntigravityLine(
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'chunk' } }),
  );
  assert.deepEqual(step, { kind: 'step_update', update: { text_delta: 'chunk' } });

  const res = parseAntigravityLine(
    JSON.stringify({
      event: 'result',
      result: { status: 'SUCCESS', response: 'all done', usage: { total_tokens: 100 } },
    }),
  );
  assert.deepEqual(res, {
    kind: 'result',
    result: { status: 'SUCCESS', response: 'all done', usage: { total_tokens: 100 } },
  });
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

test('buildAntigravityToolBlock formats command, diff, and tool blocks', () => {
  const cmdBlock = buildAntigravityToolBlock({
    step_index: 1,
    step_type: 'tool',
    tool_name: 'run_command',
    state: 'DONE',
    tool_info: {
      name: 'run_command',
      parameters: { CommandLine: 'ls -la' },
      output: 'file.txt\n',
    },
  });
  assert.deepEqual(cmdBlock, {
    type: 'command_execution',
    command: 'ls -la',
    status: 'completed',
    output: 'file.txt\n',
  });

  const writeBlock = buildAntigravityToolBlock({
    step_index: 2,
    step_type: 'tool',
    tool_name: 'write_to_file',
    state: 'DONE',
    tool_info: {
      name: 'write_to_file',
      parameters: { TargetFile: 'test.ts', CodeContent: 'const a = 1;' },
      output: 'ok',
    },
  });
  assert.deepEqual(writeBlock, {
    type: 'diff',
    filename: 'test.ts',
    diff: '+const a = 1;',
    additions: 1,
    deletions: 0,
  });

  const editBlock = buildAntigravityToolBlock({
    step_index: 3,
    step_type: 'tool',
    tool_name: 'replace_file_content',
    state: 'DONE',
    tool_info: {
      name: 'replace_file_content',
      parameters: {
        TargetFile: 'test.ts',
        TargetContent: 'const a = 1;',
        ReplacementContent: 'const a = 2;',
      },
      output: 'ok',
    },
  });
  assert.deepEqual(editBlock, {
    type: 'diff',
    filename: 'test.ts',
    diff: '-const a = 1;\n+const a = 2;',
    additions: 1,
    deletions: 1,
  });

  const genericBlock = buildAntigravityToolBlock({
    step_index: 4,
    step_type: 'tool',
    tool_name: 'grep_search',
    state: 'DONE',
    tool_info: {
      name: 'grep_search',
      parameters: { Query: 'hello' },
      output: 'matched hello',
    },
  });
  assert.deepEqual(genericBlock, {
    type: 'tool',
    toolName: 'grep_search',
    toolId: 'grep_search_4',
    input: { Query: 'hello' },
    output: 'matched hello',
    isError: false,
  });

  const errorBlock = buildAntigravityToolBlock({
    step_index: 5,
    step_type: 'tool',
    tool_name: 'run_command',
    state: 'ERROR',
    tool_info: {
      name: 'run_command',
      parameters: { CommandLine: 'false' },
      error: { message: 'exit status 1' },
    },
  });
  assert.deepEqual(errorBlock, {
    type: 'command_execution',
    command: 'false',
    status: 'error',
    output: 'exit status 1',
  });
});

test('AntigravityAdapter emits tool block events and thinking events during a turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run tool', cwd: '/proj' });
  last().feed([
    JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 1,
        thinking: 'I need to check the directory contents first.',
      },
    }),
    JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 2,
        step_type: 'tool',
        tool_name: 'run_command',
        state: 'DONE',
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'ls' },
          output: 'file1\nfile2\n',
        },
      },
    }),
    stepUpdate('Directory checked.\n'),
    resultEvent('Directory checked.\n'),
  ]);

  const events = await done;
  const thinkingEvents = events.filter((e) => e.type === 'thinking');
  assert.equal(thinkingEvents.length, 1);
  assert.equal(
    (thinkingEvents[0]?.data as { text: string }).text,
    'I need to check the directory contents first.',
  );

  const blockEvents = events.filter((e) => e.type === 'block');
  assert.equal(blockEvents.length, 1);
  assert.deepEqual((blockEvents[0]?.data as { content: unknown }).content, {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'file1\nfile2\n',
  });
});

test('AntigravityAdapter streams real-time thinking from transcript.jsonl', async () => {
  const testDir = join(tmpdir(), `antigravity-test-${Date.now()}`);
  process.env.ANTIGRAVITY_APP_DATA_DIR = testDir;

  try {
    const { spawnFn, last } = fakeSpawner();
    const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
    const { done } = collect(adapter);

    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'think deep', cwd: '/proj' });
    const convId = adapter.nativeSessionId('t1')!;
    assert.ok(convId);

    const transcriptFile = getAntigravityTranscriptPath(convId);
    mkdirSync(join(testDir, 'brain', convId, '.system_generated', 'logs'), { recursive: true });

    // Simulate agy writing thinking to transcript.jsonl
    writeFileSync(
      transcriptFile,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        thinking: 'Deep step reasoning extracted from transcript log.',
      }) + '\n',
    );

    // Feed step update and finish
    last().feed([stepUpdate('Done'), resultEvent('Done')]);

    const events = await done;
    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    assert.ok(thinkingEvents.length >= 1);
    assert.equal(
      (thinkingEvents[0]?.data as { text: string }).text,
      'Deep step reasoning extracted from transcript log.',
    );
  } finally {
    delete process.env.ANTIGRAVITY_APP_DATA_DIR;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

