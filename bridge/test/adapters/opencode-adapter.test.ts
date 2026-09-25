import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  OpenCodeAdapter,
  OpenCodeV1Translator,
  OpenCodeV2Translator,
  parseModelList,
  parseOpenCodeModelWindows,
  openCodeUsageTokens,
  splitOpenCodeModel,
  decisionToPermissionReply,
  parseSseData,
  parseServeUrl,
  type IOpenCodeServer,
  type OpenCodeCommand,
  type OpenCodeCommandRun,
  type OpenCodeEvent,
  type OpenCodeHistoryMessage,
  type OpenCodeModel,
  type OpenCodeModelRef,
  type OpenCodePermissionPolicy,
  type OpenCodePrompt,
  type OpenCodeProtocolVersion,
  type PermissionReply,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// --- a fake `opencode serve` behind the neutral contract. Raw protocol events go
// through the REAL V1 / V2 translators, so these tests cover what a live server's
// events become, not a hand-made approximation of it.
class FakeServer implements IOpenCodeServer {
  readonly protocol: OpenCodeProtocolVersion;
  readonly #listeners: ((e: OpenCodeEvent) => void)[] = [];
  readonly #v1 = new OpenCodeV1Translator();
  readonly #v2 = new OpenCodeV2Translator();
  readonly sessions: string[] = [];
  readonly prompts: { sessionId: string; body: OpenCodePrompt }[] = [];
  readonly steered: { sessionId: string; text: string }[] = [];
  readonly aborted: string[] = [];
  readonly replies: { id: string; reply: PermissionReply }[] = [];
  readonly rejectedQuestions: string[] = [];
  readonly questionReplies: { id: string; answers: string[][] }[] = [];
  history: OpenCodeHistoryMessage[] = [];
  catalog: OpenCodeModel[] = [];
  commandList: OpenCodeCommand[] = [];
  commandLists = 0;
  readonly commandRuns: { sessionId: string; run: OpenCodeCommandRun }[] = [];
  lastPermission: OpenCodePermissionPolicy | undefined;
  lastSessionModel: OpenCodeModelRef | undefined;
  nextSessionId = 'ses_1';

  constructor(protocol: OpenCodeProtocolVersion = 1) {
    this.protocol = protocol;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }
  createSession(opts: {
    title?: string;
    permission: OpenCodePermissionPolicy;
    model?: OpenCodeModelRef;
  }): Promise<string> {
    this.lastPermission = opts.permission;
    this.lastSessionModel = opts.model;
    const id = this.nextSessionId;
    this.sessions.push(id);
    return Promise.resolve(id);
  }
  prompt(sessionId: string, body: OpenCodePrompt): Promise<void> {
    this.prompts.push({ sessionId, body });
    return Promise.resolve();
  }
  steer(sessionId: string, text: string): Promise<void> {
    this.steered.push({ sessionId, text });
    return Promise.resolve();
  }
  commands(): Promise<OpenCodeCommand[]> {
    this.commandLists++;
    return Promise.resolve(this.commandList);
  }
  runCommand(sessionId: string, run: OpenCodeCommandRun): Promise<void> {
    this.commandRuns.push({ sessionId, run });
    return Promise.resolve();
  }
  interrupt(sessionId: string): Promise<void> {
    this.aborted.push(sessionId);
    return Promise.resolve();
  }
  replyPermission(_sessionId: string, id: string, reply: PermissionReply): Promise<void> {
    this.replies.push({ id, reply });
    return Promise.resolve();
  }
  answerQuestion(_sessionId: string, id: string, answers: string[][]): Promise<void> {
    if (answers.some((a) => a.length > 0)) this.questionReplies.push({ id, answers });
    else this.rejectedQuestions.push(id);
    return Promise.resolve();
  }
  messages(): Promise<OpenCodeHistoryMessage[]> {
    return Promise.resolve(this.history);
  }
  models(): Promise<OpenCodeModel[]> {
    return Promise.resolve(this.catalog);
  }
  onEvent(listener: (e: OpenCodeEvent) => void): () => void {
    this.#listeners.push(listener);
    return () => undefined;
  }
  onClose(): void {
    /* not exercised here */
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  /** Push an OpenCode 1 bus event (`{ type, properties }`) through the V1 translator. */
  emit(type: string, properties: Record<string, unknown>): void {
    this.#push(this.#v1.translate(type, properties));
  }
  /** Push an OpenCode 2 event (`{ type, data }`) through the V2 translator. */
  emitV2(type: string, data: Record<string, unknown>): void {
    this.#push(this.#v2.translate(type, data));
  }
  #push(events: OpenCodeEvent[]): void {
    for (const e of events) for (const l of this.#listeners) l(e);
  }
}

test("readSessionMessages returns the server's normalized history", async () => {
  const server = new FakeServer();
  server.history = [{ role: 'user', text: 'hi', createdAt: 1 }];
  const adapter = makeAdapter(server);
  assert.deepEqual(await adapter.readSessionMessages('ses_external', '/repo'), server.history);
});

/** A spawnFn whose child closes immediately with empty output (for `opencode models --verbose`). */
function immediateSpawn(feed?: string[]): (command: string, args: string[]) => SpawnedProcess {
  return () => {
    const stdout = new PassThrough();
    const emitter = new EventEmitter();
    stdout.on('end', () => emitter.emit('close', 0));
    queueMicrotask(() => {
      for (const line of feed ?? []) stdout.write(`${line}\n`);
      stdout.end();
    });
    return {
      stdout,
      on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
      kill: () => emitter.emit('close', 0),
    } as SpawnedProcess;
  };
}

function makeAdapter(
  server: FakeServer,
  extra: { defaultModel?: string; spawnFeed?: string[] } = {},
): OpenCodeAdapter {
  return new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn(extra.spawnFeed) as never,
    serverFactory: () => server,
    ...(extra.defaultModel !== undefined ? { defaultModel: extra.defaultModel } : {}),
  });
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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

test('splitOpenCodeModel splits provider/model, keeping trailing slashes', () => {
  assert.deepEqual(splitOpenCodeModel('opencode/deepseek-v4-flash-free'), {
    providerID: 'opencode',
    modelID: 'deepseek-v4-flash-free',
  });
  assert.deepEqual(splitOpenCodeModel('fireworks/accounts/fireworks/models/x'), {
    providerID: 'fireworks',
    modelID: 'accounts/fireworks/models/x',
  });
  assert.equal(splitOpenCodeModel('bare-id'), undefined);
  assert.equal(splitOpenCodeModel('/leading'), undefined);
});

test('decisionToPermissionReply maps decisions to once/always/reject', () => {
  assert.equal(decisionToPermissionReply('approve'), 'once');
  assert.equal(decisionToPermissionReply('approveSession'), 'always');
  assert.equal(decisionToPermissionReply('reject'), 'reject');
});

test('parseServeUrl reads the listening URL from a serve log line', () => {
  assert.equal(
    parseServeUrl('opencode server listening on http://127.0.0.1:4599'),
    'http://127.0.0.1:4599',
  );
  assert.equal(parseServeUrl('loading config...'), undefined);
});

test('parseSseData reads a data: JSON event, tolerating blanks', () => {
  const rec = 'event: message\ndata: {"type":"session.idle","properties":{"sessionID":"ses_1"}}';
  assert.deepEqual(parseSseData(rec), {
    type: 'session.idle',
    properties: { sessionID: 'ses_1' },
  });
  assert.equal(parseSseData(': heartbeat'), null);
  assert.equal(parseSseData('data: not json'), null);
});

test('openCodeUsageTokens prefers total, then buckets, then numeric fields', () => {
  assert.equal(
    openCodeUsageTokens({
      total: 17266,
      input: 17253,
      output: 2,
      reasoning: 11,
      cache: { read: 0, write: 0 },
    }),
    17266,
  );
  assert.equal(
    openCodeUsageTokens({
      input: 1200,
      output: 300,
      reasoning: 50,
      cache: { read: 900, write: 0 },
    }),
    1550,
  );
  assert.equal(openCodeUsageTokens({ prompt: 10, completion: 5 }), 15);
  assert.equal(openCodeUsageTokens({}), undefined);
  assert.equal(openCodeUsageTokens('nope'), undefined);
});

test('parseOpenCodeModelWindows maps provider/model → limit.context', () => {
  const verbose = [
    'opencode/big-pickle',
    '{',
    '  "id": "big-pickle",',
    '  "limit": {',
    '    "context": 200000',
    '  }',
    '}',
    'opencode/claude-opus-4-8',
    '{',
    '  "limit": {',
    '    "context": 1000000',
    '  }',
    '}',
  ].join('\n');
  const windows = parseOpenCodeModelWindows(verbose);
  assert.equal(windows.get('opencode/big-pickle'), 200000);
  assert.equal(windows.get('opencode/claude-opus-4-8'), 1_000_000);
  assert.equal(windows.size, 2);
});

// ---------------------------------------------------------------------------
// Adapter behaviour (driven by a fake serve process)
// ---------------------------------------------------------------------------

test('OpenCodeAdapter streams text deltas and completes on session.idle', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  // provider/model was split for the prompt body
  assert.deepEqual(server.prompts[0]?.body.model, { providerID: 'opencode', modelID: 'm' });

  server.emit('message.updated', { info: { role: 'user', id: 'mu', sessionID: 'ses_1' } });
  server.emit('message.updated', { info: { role: 'assistant', id: 'm1', sessionID: 'ses_1' } });
  // A user text part streams first — it must NOT leak into the assistant text.
  server.emit('message.part.updated', {
    part: { id: 'up', sessionID: 'ses_1', messageID: 'mu', type: 'text', text: 'hi' },
  });
  server.emit('message.part.delta', {
    sessionID: 'ses_1',
    messageID: 'm1',
    partID: 'p1',
    field: 'text',
    delta: 'Hello ',
  });
  server.emit('message.part.delta', {
    sessionID: 'ses_1',
    messageID: 'm1',
    partID: 'p1',
    field: 'text',
    delta: 'world',
  });
  server.emit('message.part.updated', {
    part: {
      id: 'sf',
      sessionID: 'ses_1',
      messageID: 'm1',
      type: 'step-finish',
      tokens: { input: 1200, output: 300 },
    },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'Hello world');
  assert.equal((completed?.data as { usage?: { tokens: number } }).usage?.tokens, 1500);
});

test('OpenCodeAdapter emits session.compacted as a compaction block', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('session.compacted', { sessionID: 'ses_1' });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  const block = events.find((event) => event.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.deepEqual(block?.content, { type: 'compaction', reason: 'unknown' });
});

test('OpenCodeAdapter reconciles a whole-part text update without double-emitting', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('message.updated', { info: { role: 'assistant', id: 'm1', sessionID: 'ses_1' } });
  server.emit('message.part.delta', {
    sessionID: 'ses_1',
    messageID: 'm1',
    partID: 'p1',
    field: 'text',
    delta: 'Hi',
  });
  // whole-part update repeats the same prefix then adds a suffix
  server.emit('message.part.updated', {
    part: { id: 'p1', sessionID: 'ses_1', messageID: 'm1', type: 'text', text: 'Hi there' },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['Hi', ' there']);
  assert.equal(
    (events.find((e) => e.type === 'turn_completed')?.data as { text: string }).text,
    'Hi there',
  );
});

test('OpenCodeAdapter emits thinking + tool blocks; skips the todo tool part', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('message.updated', { info: { role: 'assistant', id: 'm1', sessionID: 'ses_1' } });
  // Reasoning is announced (sets partType), then streams as `field: "text"` deltas.
  server.emit('message.part.updated', {
    part: { id: 'r1', sessionID: 'ses_1', messageID: 'm1', type: 'reasoning', text: '' },
  });
  server.emit('message.part.delta', {
    sessionID: 'ses_1',
    messageID: 'm1',
    partID: 'r1',
    field: 'text',
    delta: 'Let me think.',
  });
  // to-do tool part is skipped (native todo.updated owns the plan)
  server.emit('message.part.updated', {
    part: {
      id: 'td',
      sessionID: 'ses_1',
      type: 'tool',
      tool: 'todowrite',
      state: { status: 'completed', input: { todos: [] }, output: '' },
    },
  });
  server.emit('message.part.updated', {
    part: {
      id: 'b1',
      sessionID: 'ses_1',
      type: 'tool',
      tool: 'bash',
      state: { status: 'running', input: { command: 'ls' } },
    },
  });
  server.emit('message.part.updated', {
    part: {
      id: 'b1',
      sessionID: 'ses_1',
      type: 'tool',
      tool: 'bash',
      state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt' },
    },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['Let me think.']);
  const blocks = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content);
  // Shown as it starts, then replaced by its result (same id: the part id).
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: 'b1',
  });
  assert.deepEqual(blocks[1], {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a.txt',
    blockId: 'b1',
  });
});

test('OpenCodeAdapter merges todo.updated into a single plan block at idle', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('todo.updated', {
    sessionID: 'ses_1',
    todos: [
      { content: 'Step A', status: 'in_progress' },
      { content: 'Step B', status: 'pending' },
    ],
  });
  server.emit('todo.updated', {
    sessionID: 'ses_1',
    todos: [
      { content: 'Step A', status: 'completed' },
      { content: 'Step B', status: 'in_progress' },
    ],
  });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  const plans = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content)
    .filter((c) => c['type'] === 'plan');
  assert.equal(plans.length, 1);
  assert.deepEqual((plans[0] as { state: { steps: unknown[] } }).state.steps, [
    { description: 'Step A', status: 'completed' },
    { description: 'Step B', status: 'in_progress' },
  ]);
});

test('OpenCodeAdapter routes permission.asked → approval → reply', async () => {
  const server = new FakeServer();
  const seen: { toolName: string; input: Record<string, unknown> }[] = [];
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn() as never,
    serverFactory: () => server,
    onApprovalRequest: (_threadId, info) => {
      seen.push(info);
      return Promise.resolve('approveSession');
    },
  });
  collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'edit a file' });
  // interactive by default → gated tools set to `ask`
  assert.equal(server.lastPermission, 'ask');

  server.emit('permission.asked', {
    id: 'per_1',
    sessionID: 'ses_1',
    permission: 'edit',
    patterns: ['a.txt'],
    metadata: { filepath: 'a.txt', diff: '@@' },
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.toolName, 'edit');
  assert.equal((seen[0]?.input as { file_path?: string }).file_path, 'a.txt');
  assert.deepEqual(server.replies, [{ id: 'per_1', reply: 'always' }]);
});

test('OpenCodeAdapter routes permission.v2.asked (action/resources) → approval → reply', async () => {
  const server = new FakeServer();
  const seen: { toolName: string; input: Record<string, unknown> }[] = [];
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn() as never,
    serverFactory: () => server,
    onApprovalRequest: (_threadId, info) => {
      seen.push(info);
      return Promise.resolve('approve');
    },
  });
  collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run something' });
  server.emit('permission.v2.asked', {
    id: 'per_2',
    sessionID: 'ses_1',
    action: 'bash',
    resources: ['ls -la'],
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.toolName, 'bash');
  assert.equal((seen[0]?.input as { pattern?: string }).pattern, 'ls -la');
  assert.deepEqual(server.replies, [{ id: 'per_2', reply: 'once' }]);
});

test('OpenCodeAdapter rejects a question.asked with no callback to unblock the turn', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'ask me' });
  server.emit('question.asked', { id: 'qst_1', sessionID: 'ses_1', questions: [] });
  await tick();
  assert.deepEqual(server.rejectedQuestions, ['qst_1']);
});

test('OpenCodeAdapter routes question.asked → onQuestionRequest → reply with answers', async () => {
  const server = new FakeServer();
  const seen: unknown[] = [];
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn() as never,
    serverFactory: () => server,
    onQuestionRequest: (_threadId, questions) => {
      seen.push(questions);
      return Promise.resolve([['Python']]);
    },
  });
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'ask me' });
  server.emit('question.asked', {
    id: 'qst_2',
    sessionID: 'ses_1',
    questions: [
      {
        question: 'Which language?',
        header: 'Language',
        options: [
          { label: 'Python', description: 'py' },
          { label: 'JavaScript', description: 'js' },
        ],
      },
    ],
  });
  await tick();

  assert.deepEqual(seen, [
    [
      {
        question: 'Which language?',
        header: 'Language',
        options: [
          { label: 'Python', description: 'py' },
          { label: 'JavaScript', description: 'js' },
        ],
      },
    ],
  ]);
  assert.deepEqual(server.questionReplies, [{ id: 'qst_2', answers: [['Python']] }]);
  assert.deepEqual(server.rejectedQuestions, []);
});

test('OpenCodeAdapter rejects a question when the user skips (empty answers)', async () => {
  const server = new FakeServer();
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn() as never,
    serverFactory: () => server,
    onQuestionRequest: () => Promise.resolve([[]]),
  });
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'ask me' });
  server.emit('question.asked', {
    id: 'qst_3',
    sessionID: 'ses_1',
    questions: [{ question: 'Which?', options: [{ label: 'A' }] }],
  });
  await tick();
  assert.deepEqual(server.rejectedQuestions, ['qst_3']);
  assert.deepEqual(server.questionReplies, []);
});

test('OpenCodeAdapter uses allow rules for approveForMe', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go', accessMode: 'approveForMe' });
  assert.equal(server.lastPermission, 'allow');
});

test('OpenCodeAdapter reuses the session id on the next turn', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  server.emit('session.idle', { sessionID: 'ses_1' });
  await first.done;

  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  server.emit('session.idle', { sessionID: 'ses_1' });
  await second.done;

  assert.equal(server.sessions.length, 1); // created once, reused
  assert.equal(adapter.nativeSessionId('t1'), 'ses_1');
  assert.equal(server.prompts[1]?.sessionId, 'ses_1');
});

test('OpenCodeAdapter surfaces session.error as turn_error', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('session.error', {
    sessionID: 'ses_1',
    error: { data: { message: 'no credits' } },
  });

  const evs = await done;
  const err = evs.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'no credits');
});

test('OpenCodeAdapter cancelTurn aborts the session and emits turn_aborted', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await adapter.cancelTurn('t1', 'u1');

  assert.deepEqual(server.aborted, ['ses_1']);
  assert.ok(events.some((e) => e.type === 'turn_aborted'));
});

// --- mid-turn delivery (steering) -----------------------------------------
// `opencode serve` accepts another prompt on a session that is already busy and
// folds it into the running work. Verified live against opencode 1.18.11: a
// message sent 6s into a five-`sleep` turn ended the assistant's first message
// after the first tool returned, answered the new instruction, and the whole
// thing closed with a single `session.idle`.

test('steerTurn prompts the same session without opening a second run', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'actually, do this instead',
  });

  assert.equal(taken, true);
  assert.deepEqual(
    server.prompts.map((p) => p.body.text),
    ['first'],
  );
  assert.deepEqual(server.steered, [{ sessionId: 'ses_1', text: 'actually, do this instead' }]);
  // Only the original turn was announced — a second turn_started would tell the
  // phone a new turn began when the agent is still inside the first.
  assert.equal(events.filter((e) => e.type === 'turn_started').length, 1);

  // The answer the server produces for it belongs to the SAME bridge turn.
  server.emit('message.updated', {
    info: { id: 'm2', sessionID: 'ses_1', role: 'assistant' },
  });
  server.emit('message.part.updated', {
    part: { id: 'p2', sessionID: 'ses_1', messageID: 'm2', type: 'text', text: 'BANANA' },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });

  const all = await done;
  const completions = all.filter((e) => e.type === 'turn_completed');
  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.turnId, 'u1');
  assert.match(String((completions[0]?.data as { text: string }).text), /BANANA/);
});

test('steerTurn keeps the running turn model, not a new one', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'more',
    service: 'opencode/some-other-model',
  });
  // A message inside a turn must not switch the model mid-answer: steering
  // carries text only.
  assert.deepEqual(server.steered, [{ sessionId: 'ses_1', text: 'more' }]);
  assert.equal(server.prompts.length, 1);
});

test('steerTurn declines for a finished, unknown or mismatched turn', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'nope', text: 'x' }),
    false,
  );
  assert.equal(
    await adapter.steerTurn({ threadId: 'other', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    false,
  );

  server.emit('session.idle', { sessionID: 'ses_1' });
  await done;
  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    false,
  );
  assert.deepEqual(
    server.prompts.map((p) => p.body.text),
    ['first'],
  );
  assert.deepEqual(server.steered, []);
});

test('a message the server accepted counts as delivered even if the turn just ended', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });

  // The turn goes idle while the prompt round-trip is in flight. Reporting "not
  // taken" would make the bridge queue it and send the SAME text again — an
  // instruction acted on twice is worse than a reply we cannot attribute.
  server.steer = (sessionId, text) => {
    server.steered.push({ sessionId, text });
    server.emit('session.idle', { sessionID: 'ses_1' });
    return Promise.resolve();
  };

  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'racy',
  });
  assert.equal(taken, true);
  assert.equal(server.steered.length, 1, 'sent exactly once');
});

test('the adapter advertises steering', () => {
  const adapter = makeAdapter(new FakeServer());
  assert.equal(adapter.capabilities.steering, true);
});

test('context windows are retried until a load brings one', async () => {
  // OpenCode 1's first `opencode models` on a fresh install prints nothing.
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  await adapter.loadContextWindows();
  server.catalog = [{ id: 'opencode/m', contextWindow: 1000 }];
  await adapter.loadContextWindows();
  const { events, done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('message.updated', {
    info: { role: 'assistant', id: 'm1', sessionID: 'ses_1', tokens: { input: 10, output: 5 } },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });
  await done;
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.deepEqual((completed?.data as { usage?: unknown }).usage, {
    tokens: 15,
    contextWindow: 1000,
  });
});

test('a picked command runs on the server, as a skill when the server lists it as one', async () => {
  const server = new FakeServer(2);
  server.commandList = [
    { name: 'review', description: 'review changes', skill: false },
    { name: 'report', description: 'Report an issue', skill: true },
  ];
  const adapter = makeAdapter(server, { defaultModel: 'opencode/big-pickle' });
  assert.deepEqual(await adapter.listCommands('/repo'), [
    { name: 'review', description: 'review changes', source: 'custom', headlessSupported: true },
    { name: 'report', description: 'Report an issue', source: 'skill', headlessSupported: true },
  ]);
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: '/report the crash',
    command: { name: 'report', args: 'the crash' },
    cwd: '/repo',
  });
  server.nextSessionId = 'ses_2';
  await adapter.sendTurn({
    threadId: 't2',
    turnId: 'u2',
    text: '/review',
    command: { name: 'review' },
    cwd: '/repo',
  });
  assert.equal(server.prompts.length, 0, 'a command is not sent as prompt text');
  assert.deepEqual(
    server.commandRuns.map((c) => [c.run.name, c.run.args, c.run.skill, c.run.model?.modelID]),
    [
      ['report', 'the crash', true, 'big-pickle'],
      ['review', '', false, 'big-pickle'],
    ],
  );
  // Reused for the folder: the server was asked once.
  assert.equal(server.commandLists, 1);
});

test('a server that cannot list its commands yields none', async () => {
  const server = new FakeServer();
  server.commands = () => Promise.reject(new Error('down'));
  assert.deepEqual(await makeAdapter(server).listCommands('/repo'), []);
});

test('the adapter no longer expands command templates itself', () => {
  const adapter = makeAdapter(new FakeServer());
  assert.equal((adapter as { expandCommand?: unknown }).expandCommand, undefined);
});
