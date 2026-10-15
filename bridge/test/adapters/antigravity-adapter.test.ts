import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AntigravityAdapter,
  antigravityPermissionMode,
  antigravityPermissionArgs,
  normalizeAntigravityModel,
  parseAntigravityModelList,
  parseAntigravityLine,
  buildAntigravityToolBlock,
  antigravityContextTokens,
  DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS,
  type AntigravityUsage,
  type SpawnedProcess,
} from '../../src/index.js';
import type { SpawnExtra } from '../../src/adapters/spawn.js';
import {
  antigravityRunModel,
  chooseAntigravityTitleModel,
  expandAntigravityModels,
  groupAntigravityModels,
  parseAntigravityAccountModel,
  parseAntigravityChecklist,
  parseAntigravitySkills,
} from '../../src/adapters/antigravity-adapter.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// Fixtures mirror `agy` 1.2.7's stream-json, captured live (see the adapter header).

/** The per-process `init` event: `agy` announces the conversation it created or resumed. */
function initEvent(conversationId: string): string {
  return JSON.stringify({
    event: 'init',
    conversation_id: conversationId,
    init: { model: 'gemini-3.6-flash-low', cwd: '/proj', tools: ['run_command'] },
  });
}

/** An `ACTIVE` `agent_response` step streaming a fragment of the answer. */
function stepUpdate(delta: string, stepIndex = 1): string {
  return JSON.stringify({
    event: 'step_update',
    step_update: {
      step_index: stepIndex,
      state: 'ACTIVE',
      step_type: 'agent_response',
      text_delta: delta,
    },
  });
}

/** The `DONE` `agent_response` step that closes one model call, with its usage. */
function stepDone(usage: AntigravityUsage, stepIndex = 1): string {
  return JSON.stringify({
    event: 'step_update',
    step_update: {
      step_index: stepIndex,
      state: 'DONE',
      step_type: 'agent_response',
      text_delta: '\n',
      duration_seconds: 0.7,
      usage,
    },
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
  env?: Record<string, string>;
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
      ...(extra?.env ? { env: extra.env } : {}),
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

test('parseAntigravityModelList splits id + label and skips dupes, marking no default', () => {
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
  // The id is the routing key; the label is what the phone shows. The first row
  // is NOT the default: the account's own default comes from `agy -p /model`.
  assert.equal(models[0]?.displayName, 'Gemini 3.7 Flash (High)');
  assert.equal(
    models.some((m) => m.isDefault),
    false,
  );
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

/** The real `agy models` listing of `agy` 1.3.5, captured verbatim. */
const AGY_LISTING = [
  'Fetching available models...',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n');

/** The `agy -p /model --output-format json` payload of `agy` 1.3.5, trimmed. */
function accountPayload(id: string): string {
  return JSON.stringify({
    conversation_id: '',
    status: 'SUCCESS',
    response: `${id}\tGemini 3.8 Flash (Medium)\n`,
    num_turns: 0,
    command: {
      name: 'model',
      data: { id, label: 'Gemini 3.8 Flash (Medium)', effort: 'medium', is_default: false },
    },
  });
}

test('groupAntigravityModels folds one family’s tiers into one model, lowest tier first', () => {
  const models = groupAntigravityModels(parseAntigravityModelList(AGY_LISTING));
  assert.deepEqual(
    models.map((m) => m.id),
    ['gemini-3.8-flash', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'],
  );
  const family = models[0]!;
  assert.equal(family.displayName, 'Gemini 3.8 Flash');
  assert.deepEqual(family.options, [
    {
      key: 'reasoning',
      kind: 'enum',
      label: 'Reasoning effort',
      values: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      // No account default known: the middle listed tier.
      default: 'medium',
    },
  ]);
  // Ungrouped ids keep their listed id and label, with no options.
  assert.equal(models[1]?.displayName, 'Claude Sonnet 4.6 (Thinking)');
  assert.equal(models[1]?.options, undefined);
  assert.equal(models[3]?.id, 'gpt-oss-120b-medium');
});

test('groupAntigravityModels marks the account default and takes its tier', () => {
  const account = parseAntigravityAccountModel(accountPayload('gemini-3.8-flash-high'));
  assert.equal(account, 'gemini-3.8-flash-high');
  const models = groupAntigravityModels(parseAntigravityModelList(AGY_LISTING), account);
  assert.equal(models[0]?.isDefault, true);
  assert.equal(models[0]?.options?.[0]?.default, 'high');
  assert.equal(models[1]?.isDefault, undefined);
});

test('groupAntigravityModels marks the family of an untiered account default', () => {
  const models = groupAntigravityModels(
    parseAntigravityModelList(AGY_LISTING),
    'claude-sonnet-4-6',
  );
  assert.equal(models[1]?.isDefault, true);
  assert.equal(models[0]?.isDefault, undefined);
  assert.equal(models[0]?.options?.[0]?.default, 'medium');
});

test('groupAntigravityModels never marks a default it cannot place', () => {
  const models = groupAntigravityModels(
    parseAntigravityModelList(AGY_LISTING),
    'gemini-9-missing-high',
  );
  assert.equal(
    models.some((m) => m.isDefault),
    false,
  );
});

test('parseAntigravityAccountModel reads command.data.id and nothing else', () => {
  assert.equal(
    parseAntigravityAccountModel(accountPayload('gemini-3.8-flash-medium')),
    'gemini-3.8-flash-medium',
  );
  assert.equal(parseAntigravityAccountModel(''), undefined);
  assert.equal(parseAntigravityAccountModel('not json'), undefined);
  assert.equal(parseAntigravityAccountModel('{"command":{"name":"model"}}'), undefined);
  assert.equal(parseAntigravityAccountModel('{"command":{"data":{"id":"two words"}}}'), undefined);
});

test('expandAntigravityModels lists every tier a family runs as', () => {
  const ids = expandAntigravityModels(
    groupAntigravityModels(parseAntigravityModelList(AGY_LISTING)),
  );
  assert.deepEqual(ids, [
    'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'gpt-oss-120b-medium',
  ]);
});

test('antigravityRunModel runs a family as its tiered id, at the chosen or default tier', () => {
  const listing = groupAntigravityModels(
    parseAntigravityModelList(AGY_LISTING),
    'gemini-3.8-flash-medium',
  );
  assert.equal(antigravityRunModel('gemini-3.8-flash', 'low', listing), 'gemini-3.8-flash-low');
  assert.equal(
    antigravityRunModel('gemini-3.8-flash', undefined, listing),
    'gemini-3.8-flash-medium',
  );
  // A level the family does not list runs the default, never an invented tier.
  assert.equal(antigravityRunModel('gemini-3.8-flash', 'max', listing), 'gemini-3.8-flash-medium');
  // A stored tiered id (threads made before the grouping) runs unchanged.
  assert.equal(
    antigravityRunModel('gemini-3.8-flash-high', 'low', listing),
    'gemini-3.8-flash-high',
  );
  // Ungrouped ids are not tiers of anything.
  assert.equal(antigravityRunModel('claude-sonnet-4-6', undefined, listing), 'claude-sonnet-4-6');
  // With no listing yet a chosen level still names its tier; with none the
  // base goes as it is (agy >= 1.3.4 takes it alone).
  assert.equal(antigravityRunModel('gemini-3.8-flash', 'low', []), 'gemini-3.8-flash-low');
  assert.equal(antigravityRunModel('gemini-3.8-flash', undefined, []), 'gemini-3.8-flash');
  assert.equal(antigravityRunModel('gemini-3.8-flash-high', 'low', []), 'gemini-3.8-flash-high');
  assert.equal(
    antigravityRunModel('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)', undefined, listing),
    'gemini-3.8-flash-low',
  );
  assert.equal(antigravityRunModel(undefined, 'low', listing), undefined);
});

test('chooseAntigravityTitleModel takes the cheapest flash tier, else any -low id, else none', () => {
  const listed = expandAntigravityModels(
    groupAntigravityModels(parseAntigravityModelList(AGY_LISTING)),
  );
  assert.equal(chooseAntigravityTitleModel(listed), 'gemini-3.8-flash-low');
  // A flash family wins over a -low id of another family.
  assert.equal(
    chooseAntigravityTitleModel(['gemini-3.8-pro-low', 'gemini-3.8-flash-high']),
    'gemini-3.8-flash-high',
  );
  assert.equal(
    chooseAntigravityTitleModel(['claude-opus-4-6-thinking', 'gemini-3.8-pro-low']),
    'gemini-3.8-pro-low',
  );
  assert.equal(chooseAntigravityTitleModel(['claude-opus-4-6-thinking']), undefined);
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
    initEvent('c-1'),
    stepUpdate('Hello '),
    stepUpdate('world'),
    stepDone({ input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 8 }),
    resultEvent('Hello world\n', { input_tokens: 100, output_tokens: 20, total_tokens: 120 }),
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world', '\n']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world\n');
  // Context = the last model call's input + cache read + output (128), never
  // `result.usage` (120, and summed over the conversation on later turns).
  assert.deepEqual((completed?.data as { usage?: unknown }).usage, { tokens: 128 });

  // First turn: piped stdin carrying the stream-json message, workspace targeting,
  // autonomous skip-permissions, stream-json both ways, and the per-turn cap.
  assert.equal(last().pipedStdin, true);
  assert.match(last().stdinData, /"event":"user".*"text":"hi"/);

  const args = last().args;
  // No `--conversation` on a thread's first spawn: `agy` mints the id (`init`).
  assert.equal(args.includes('--conversation'), false);
  assert.equal(adapter.nativeSessionId('t1'), 'c-1');
  assert.equal(args[args.indexOf('--add-dir') + 1], '/proj');
  assert.equal(args.includes('--dangerously-skip-permissions'), true);
  assert.equal(args.includes('--input-format'), true);
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args.includes('--output-format'), true);
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(args.includes('--print-timeout'), true);
  assert.equal(args[args.indexOf('--print-timeout') + 1], '2h');
});

test('AntigravityAdapter resumes the conversation `agy` announced on a later spawn', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  // `agy` 1.2.x owns the id: a client-minted uuid is answered with "conversation
  // not found" and a NEW conversation, so the adapter adopts the `init` id.
  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one', cwd: '/p' });
  assert.equal(spawns[0]!.args.includes('--conversation'), false);
  last().feedOpen([initEvent('c-real'), stepUpdate('a'), resultEvent('a')]);
  await first.done;
  assert.equal(adapter.nativeSessionId('t1'), 'c-real');

  // A new process for the same thread (here: after an archive) resumes it.
  await adapter.closeSession('t1');
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two', cwd: '/p' });
  assert.equal(spawns.length, 2);
  const secondArgs = last().args;
  assert.equal(secondArgs[secondArgs.indexOf('--conversation') + 1], 'c-real');
  last().feed([initEvent('c-real'), stepUpdate('b'), resultEvent('b')]);
  await second.done;
  assert.equal(adapter.nativeSessionId('t1'), 'c-real');
});

// After a restart (or when a conversation takes over a terminal's) the bridge
// hands the stored id back: the first spawn resumes it. A conversation `agy`
// no longer has is answered with a new one on `init`, which then takes over.
test('AntigravityAdapter resumes an adopted conversation, and takes the one agy answers with', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  adapter.adoptNativeSession('t1', 'c-stored');

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go on', cwd: '/p' });
  const args = spawns[0]!.args;
  assert.equal(args[args.indexOf('--conversation') + 1], 'c-stored');
  last().feedOpen([initEvent('c-stored'), stepUpdate('a'), resultEvent('a')]);
  await first.done;
  assert.equal(adapter.nativeSessionId('t1'), 'c-stored');

  adapter.adoptNativeSession('t2', 'c-gone');
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't2', turnId: 'u2', text: 'hello', cwd: '/p' });
  last().feedOpen([initEvent('c-fresh'), stepUpdate('b'), resultEvent('b')]);
  await second.done;
  assert.equal(adapter.nativeSessionId('t2'), 'c-fresh');
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

test('Antigravity receives every run MCP server through the proxy environment and refreshes on change', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const servers = [
    { name: 'uxnan', url: 'http://127.0.0.1:1/mcp', token: 'bridge-token' },
    { name: 'uxnan-browser', url: 'http://127.0.0.1:2/mcp', token: 'desktop-token' },
  ];
  const first = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'first',
    cwd: '/p',
    mcpServers: servers,
  });
  assert.deepEqual(JSON.parse(last().env?.UXNAN_MCP_SERVERS ?? '[]'), servers);
  assert.ok(
    !last().args.some((arg) => arg.includes('bridge-token') || arg.includes('desktop-token')),
  );
  last().feedOpen([initEvent('c1'), resultEvent('ok')]);
  await first.done;

  const changed = [{ ...servers[0]!, token: 'new-bridge-token' }, servers[1]!];
  const second = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u2',
    text: 'second',
    cwd: '/p',
    mcpServers: changed,
  });
  assert.equal(spawns.length, 2);
  assert.deepEqual(JSON.parse(last().env?.UXNAN_MCP_SERVERS ?? '[]'), changed);
  last().feed([initEvent('c1'), resultEvent('ok')]);
  await second.done;
});

test('AntigravityAdapter recycles session when workspace cwd changes', async () => {
  const { spawnFn, last, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'p1', cwd: '/proj1' });
  last().feedOpen([initEvent('c-1'), resultEvent('done 1')]);
  await first.done;
  assert.equal(spawns.length, 1);
  assert.equal(last().cwd, '/proj1');

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'p2', cwd: '/proj2' });
  last().feedOpen([initEvent('c-1'), resultEvent('done 2')]);
  await second.done;

  // New process for the new workspace directory — `--add-dir` is a process
  // argument — resuming the same conversation.
  assert.equal(spawns.length, 2);
  assert.equal(last().cwd, '/proj2');
  assert.equal(spawns[0]!.args.includes('--conversation'), false);
  assert.equal(spawns[1]!.args[spawns[1]!.args.indexOf('--conversation') + 1], 'c-1');
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
  assert.equal(DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS, 24 * 60 * 60 * 1000);
});

test('AntigravityAdapter closeSession tears down active persistent session immediately', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/proj' });
  spawns[0]!.feedOpen([resultEvent('ok')]);
  await done;

  assert.equal(adapter.hasActiveSession('t1'), true);
  await adapter.closeSession('t1');
  assert.equal(adapter.hasActiveSession('t1'), false);
});

test('AntigravityAdapter interaction refreshes the idle timeout countdown', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn, idleTimeoutMs: 50 });

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'turn 1', cwd: '/proj' });
  spawns[0]!.feedOpen([resultEvent('reply 1')]);
  await first.done;
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Advance 30ms (timer has 20ms left)
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(adapter.hasActiveSession('t1'), true);

  // Turn 2 completed -> refreshes the 50ms countdown!
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'turn 2', cwd: '/proj' });
  spawns[0]!.feedOpen([resultEvent('reply 2')]);
  await second.done;

  // Another 30ms -> total elapsed since turn 1 is 60ms (>50ms), but session is still alive
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    adapter.hasActiveSession('t1'),
    true,
    'session must still be alive because timer was refreshed',
  );

  // Wait remaining 30ms to exceed refreshed 50ms window
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(
    adapter.hasActiveSession('t1'),
    false,
    'session now dismantled after refreshed timeout expires',
  );
  await adapter.stop();
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

  // Only the fields the adapter models survive, with their captured types.
  const tool = parseAntigravityLine(
    JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 2,
        state: 'ERROR',
        step_type: 'tool',
        tool_name: 'run_command',
        duration_seconds: 0.09,
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'wc -c note.txt' },
          error: { type: 'TOOL_ERROR', message: 'tool call denied by pre-tool hook:' },
        },
        surprise: true,
      },
    }),
  );
  assert.deepEqual(tool, {
    kind: 'step_update',
    update: {
      conversation_id: 'c1',
      step_index: 2,
      state: 'ERROR',
      step_type: 'tool',
      tool_name: 'run_command',
      duration_seconds: 0.09,
      tool_info: {
        name: 'run_command',
        parameters: { CommandLine: 'wc -c note.txt' },
        error: { type: 'TOOL_ERROR', message: 'tool call denied by pre-tool hook:' },
      },
    },
  });

  assert.deepEqual(parseAntigravityLine(JSON.stringify({ event: 'agent_settled' })), {
    kind: 'unrecognized',
    raw: { event: 'agent_settled' },
  });

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
  last().feed([resultEvent('ok')]);
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
  last().feed([resultEvent('ok')]);
  await done;
  const args = last().args;
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.1-pro-high');
});

test('Antigravity offers no access mode and runs in its configured posture', async () => {
  const adapter = new AntigravityAdapter({ binaryPath: 'agy' });
  assert.equal(adapter.capabilities.accessModes, undefined);
  const cases = [
    { permissionMode: 'bypassPermissions' as const, flag: '--dangerously-skip-permissions' },
    { permissionMode: 'plan' as const, flag: '--mode' },
  ];
  for (const { permissionMode, flag } of cases) {
    const { spawnFn, last } = fakeSpawner();
    const configured = new AntigravityAdapter({ binaryPath: 'agy', spawnFn, permissionMode });
    const { done } = collect(configured);
    await configured.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
    last().feed([resultEvent('ok')]);
    await done;
    assert.ok(last().args.includes(flag), `${permissionMode} passes ${flag}`);
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

/** Answer the two reads `listModels` makes: the listing and the account default. */
function answerListing(spawns: FakeSpawn[], listing: string, account: string): void {
  const byArg = (arg: string): FakeSpawn => spawns.find((s) => s.args.includes(arg))!;
  byArg('models').feed([listing]);
  byArg('/model').feed([account]);
}

/** Wait until the adapter has spawned `count` processes (its reads are async). */
async function spawnedAtLeast(spawns: FakeSpawn[], count: number): Promise<void> {
  for (let i = 0; i < 100 && spawns.length < count; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(spawns.length >= count, `expected ${count} spawns, saw ${spawns.length}`);
}

test('AntigravityAdapter.listModels reads the listing and the account default, grouped', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const listing = adapter.listModels();
  assert.equal(spawns.length, 2, 'both reads start together');
  answerListing(spawns, AGY_LISTING, accountPayload('gemini-3.8-flash-medium'));
  const models = await listing;
  assert.deepEqual(
    models.map((m) => m.id),
    ['gemini-3.8-flash', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'],
  );
  assert.equal(models[0]?.isDefault, true);
  assert.deepEqual(
    spawns.map((s) => s.args),
    [['models'], ['-p', '/model', '--output-format', 'json']],
  );
});

test('AntigravityAdapter.listModels shows no default when the account read fails', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const listing = adapter.listModels();
  answerListing(spawns, AGY_LISTING, 'signed out');
  const models = await listing;
  assert.equal(models.length, 4);
  assert.equal(
    models.some((m) => m.isDefault),
    false,
  );
});

test('AntigravityAdapter runs the family at the level the turn picks, else the default', async () => {
  const { spawnFn, spawns, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const listing = adapter.listModels();
  answerListing(spawns, AGY_LISTING, accountPayload('gemini-3.8-flash-medium'));
  await listing;

  const { done } = collect(adapter);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    cwd: '/p',
    service: 'gemini-3.8-flash',
    options: { reasoning: 'low' },
  });
  last().feed([resultEvent('ok')]);
  await done;
  assert.equal(last().args[last().args.indexOf('--model') + 1], 'gemini-3.8-flash-low');
  assert.equal(last().args.includes('--effort'), false, 'the tiered id carries the tier');

  const next = collect(adapter);
  await adapter.sendTurn({
    threadId: 't2',
    turnId: 'u2',
    text: 'hi',
    cwd: '/p',
    service: 'gemini-3.8-flash',
  });
  last().feed([resultEvent('ok')]);
  await next.done;
  assert.equal(last().args[last().args.indexOf('--model') + 1], 'gemini-3.8-flash-medium');
});

test('AntigravityAdapter names a conversation on the cheapest tier the listing offers', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const listing = adapter.listModels();
  answerListing(spawns, AGY_LISTING, accountPayload('gemini-3.8-flash-medium'));
  await listing;

  const titling = adapter.generateTitle({ userText: 'hi', assistantText: 'ok', cwd: '/p' });
  await spawnedAtLeast(spawns, 3);
  const title = spawns[spawns.length - 1]!;
  title.feed(['Fix the model list']);
  assert.equal(await titling, 'Fix the model list');

  const args = title.args;
  // Never a pinned id: the cheapest one this account's listing reports.
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.8-flash-low');
  // And it must never join the conversation the thread resumes.
  assert.equal(args.includes('--conversation'), false);
});

test('AntigravityAdapter lists the models before naming when none are known yet', async () => {
  const { spawnFn, spawns } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });

  const titling = adapter.generateTitle({ userText: 'hi', assistantText: 'ok', cwd: '/p' });
  await spawnedAtLeast(spawns, 2);
  answerListing(spawns, 'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n', '');
  await spawnedAtLeast(spawns, 3);
  const title = spawns[spawns.length - 1]!;
  title.feed(['Fix the model list']);
  assert.equal(await titling, 'Fix the model list');

  // No cheap tier listed: no `--model`, so agy names it on its own default.
  assert.equal(title.args.includes('--model'), false);
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
    kind: 'search',
    target: 'hello',
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

test('AntigravityAdapter emits a tool block for a finished tool step, and no thinking', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run tool', cwd: '/proj' });
  last().feed([
    initEvent('c-1'),
    // The model call that decided to run a tool: usage, no text — and no
    // reasoning text anywhere on this surface, only a `thinking_tokens` count.
    stepDone({ input_tokens: 13210, output_tokens: 897, thinking_tokens: 782 }, 1),
    // The tool step goes ACTIVE (a running row) and then DONE (its result, same id).
    JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 2,
        step_type: 'tool',
        tool_name: 'run_command',
        state: 'ACTIVE',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'ls' } },
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
    stepUpdate('Directory checked.', 3),
    stepDone({ input_tokens: 6065, output_tokens: 425, cache_read_tokens: 8133 }, 3),
    resultEvent('Directory checked.\n', { input_tokens: 19275, output_tokens: 1322 }),
  ]);

  const events = await done;
  assert.equal(events.filter((e) => e.type === 'thinking').length, 0);

  const blockEvents = events.filter((e) => e.type === 'block');
  assert.equal(blockEvents.length, 2);
  assert.deepEqual((blockEvents[0]?.data as { content: unknown }).content, {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: 'run_command_2',
  });
  assert.deepEqual((blockEvents[1]?.data as { content: unknown }).content, {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'file1\nfile2\n',
    blockId: 'run_command_2',
  });
  // The meter shows the LAST model call's context, not the turn's sum.
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.deepEqual((completed?.data as { usage?: unknown }).usage, {
    tokens: 6065 + 425 + 8133,
  });
});

test('antigravityContextTokens sums input, cache read and output; never total_tokens', () => {
  // Captured: turn 2 of a conversation — `total_tokens` omits the cache part.
  assert.equal(
    antigravityContextTokens({
      input_tokens: 5140,
      output_tokens: 14,
      thinking_tokens: 0,
      cache_read_tokens: 8128,
      total_tokens: 5154,
    }),
    13282,
  );
  assert.equal(antigravityContextTokens({ total_tokens: 99 }), undefined);
  assert.equal(antigravityContextTokens(undefined), undefined);
});

test('AntigravityAdapter keeps a non-JSON stdout line out of the answer', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  last().feed([
    initEvent('c-1'),
    'Fetching something...',
    stepUpdate('answer'),
    resultEvent('answer'),
  ]);
  const events = await done;
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['answer']);
  assert.equal((events.at(-1)?.data as { text: string }).text, 'answer');
});

test('AntigravityAdapter surfaces a non-JSON line as the diagnostic of an empty turn', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  last().feed(['Error: not signed in']);
  const events = await done;
  const error = events.find((e) => e.type === 'turn_error');
  assert.equal((error?.data as { text: string }).text, 'Error: not signed in');
});

test('AntigravityAdapter reports `result.status` when a turn ends with no answer and no diagnostic', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  last().feed([
    initEvent('c-1'),
    JSON.stringify({ event: 'result', result: { status: 'TIMEOUT' } }),
  ]);
  const events = await done;
  const error = events.find((e) => e.type === 'turn_error');
  assert.equal((error?.data as { text: string }).text, 'Antigravity TIMEOUT');
});

// --- commands: the skills `agy -p /skills` lists (agy 1.2.11) ---

function skillsSpawner(
  output: string,
  code = 0,
): {
  spawnFn: (command: string, args: string[], cwd: string) => SpawnedProcess;
  calls: { args: string[]; cwd: string }[];
} {
  const calls: { args: string[]; cwd: string }[] = [];
  const spawnFn = (_command: string, args: string[], cwd: string): SpawnedProcess => {
    calls.push({ args, cwd });
    const stdout = new PassThrough();
    const emitter = new EventEmitter();
    setImmediate(() => {
      stdout.write(output);
      stdout.end();
      setImmediate(() => emitter.emit('close', code));
    });
    return {
      stdout,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => undefined,
    } as SpawnedProcess;
  };
  return { spawnFn, calls };
}

test('AntigravityAdapter completes a /compact turn as compacted, not as an error', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: '/compact', cwd: '/p' });
  // The shape `agy` 1.3.5 answers `/compact` with: a checkpoint, then a SUCCESS
  // result whose response is empty.
  last().feed([
    JSON.stringify({
      event: 'step_update',
      step_update: { step_index: 2, state: 'DONE', step_type: 'user_input' },
    }),
    JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 3,
        state: 'DONE',
        step_type: 'checkpoint',
        duration_seconds: 3.5,
      },
    }),
    JSON.stringify({
      event: 'result',
      result: { status: 'SUCCESS', response: '', num_turns: 2 },
    }),
  ]);
  const events = await done;
  const compaction = events.find(
    (e) =>
      e.type === 'block' && (e.data as { content: { type: string } }).content.type === 'compaction',
  );
  assert.ok(compaction, 'the checkpoint is a compaction block');
  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
    'an empty compaction is not "produced no output"',
  );
  assert.equal(events[events.length - 1]?.type, 'turn_completed');
});

test('AntigravityAdapter still reports an empty turn that was not a compaction', async () => {
  const { spawnFn, last } = fakeSpawner();
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const { done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', cwd: '/p' });
  last().feed([resultEvent('')]);
  const events = await done;
  assert.equal(events[events.length - 1]?.type, 'turn_error');
});

test('AntigravityAdapter shows a checklist the agent writes as the plan, not a diff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-brain-'));
  try {
    const brain = join(dir, 'brain', 'conv-1');
    mkdirSync(brain, { recursive: true });
    const taskFile = join(brain, 'task.md');
    writeFileSync(
      taskFile,
      '# Task\n- [x] Read the spec\n- [/] Write the adapter\n- [ ] Run the tests\n',
    );
    const { spawnFn, last } = fakeSpawner();
    const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'plan it', cwd: dir });
    const write = (state: string): string =>
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 6,
          state,
          step_type: 'tool',
          tool_name: 'write_to_file',
          tool_info: { name: 'write_to_file', parameters: { TargetFile: taskFile } },
        },
      });
    last().feed([write('ACTIVE'), write('DONE'), resultEvent('ok')]);
    const events = await done;
    const blocks = events
      .filter((e) => e.type === 'block')
      .map((e) => (e.data as { content: Record<string, unknown> }).content);
    assert.deepEqual(blocks, [
      {
        type: 'plan',
        state: {
          steps: [
            { description: 'Read the spec', status: 'completed' },
            { description: 'Write the adapter', status: 'in_progress' },
            { description: 'Run the tests', status: 'pending' },
          ],
        },
        blockId: 'write_to_file_6',
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AntigravityAdapter keeps the diff for a brain file that is not a checklist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-brain-'));
  try {
    const brain = join(dir, 'brain', 'conv-1');
    mkdirSync(brain, { recursive: true });
    const planFile = join(brain, 'plan.md');
    writeFileSync(planFile, 'Just some prose, no checklist.\n');
    const { spawnFn, last } = fakeSpawner();
    const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
    const { done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'plan it', cwd: dir });
    last().feed([
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 4,
          state: 'DONE',
          step_type: 'tool',
          tool_name: 'write_to_file',
          tool_info: { name: 'write_to_file', parameters: { TargetFile: planFile } },
        },
      }),
      resultEvent('ok'),
    ]);
    const events = await done;
    const block = events.find((e) => e.type === 'block')?.data as { content: { type: string } };
    assert.equal(block.content.type, 'diff');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseAntigravityChecklist reads pending, in-progress and done steps only', () => {
  const steps = parseAntigravityChecklist(
    [
      '# Task',
      '- [x] **Read** the spec',
      '- [/] Write the _adapter_',
      '* [ ] Run `npm test`',
      '- plain bullet',
      '- [ ]',
    ].join('\n'),
  );
  assert.deepEqual(steps, [
    { description: 'Read the spec', status: 'completed' },
    { description: 'Write the adapter', status: 'in_progress' },
    { description: 'Run `npm test`', status: 'pending' },
  ]);
});

test('listCommands: the skills agy lists in the thread folder, as its workspace', async () => {
  const { spawnFn, calls } = skillsSpawner(
    'probe-agy-skill\tProbe skill\ngenerative_ui\tRender rich widgets\n\n',
  );
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  const commands = await adapter.listCommands('/repo');
  assert.deepEqual(
    commands.map((c) => [c.name, c.source, c.description]),
    [
      ['compact', 'builtin', 'Summarize the conversation to free up context'],
      ['probe-agy-skill', 'skill', 'Probe skill'],
      ['generative_ui', 'skill', 'Render rich widgets'],
    ],
  );
  // The workspace's skills come from `--add-dir`, the flag a turn gets too.
  assert.deepEqual(calls[0], { args: ['-p', '/skills', '--add-dir', '/repo'], cwd: '/repo' });
  await adapter.listCommands('/repo');
  assert.equal(calls.length, 1, 'reused for the folder within the minute');
});

test('listCommands offers /compact alone when agy fails to list its skills', async () => {
  const { spawnFn } = skillsSpawner('error: not signed in\n', 1);
  const adapter = new AntigravityAdapter({ binaryPath: 'agy', spawnFn });
  assert.deepEqual(
    (await adapter.listCommands('/repo')).map((c) => c.name),
    ['compact'],
  );
});

test('parseAntigravitySkills keeps skill lines and skips anything else', () => {
  assert.deepEqual(
    parseAntigravitySkills(
      'warning: something odd happened\nautomation\tSchedule a task\r\nautomation\tdup\nbare-name\n',
    ).map((c) => [c.name, c.description ?? null]),
    [
      ['automation', 'Schedule a task'],
      ['bare-name', null],
    ],
  );
});
