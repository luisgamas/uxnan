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
  type OpenCodeListedSession,
  type OpenCodeModel,
  type OpenCodeModelRef,
  type OpenCodePermissionPolicy,
  type OpenCodePrompt,
  type OpenCodeProtocolVersion,
  type PermissionReply,
  type SpawnedProcess,
} from '../../src/index.js';
import type { AccessMode, AgentStreamEvent } from '@uxnan/shared';

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
  /** Sessions the server holds besides the ones created here (a terminal's,
   *  or one a previous server process opened). */
  readonly known = new Set<string>();
  readonly checked: string[] = [];
  listed: OpenCodeListedSession[] = [];
  listSessions(directory: string, limit: number): Promise<OpenCodeListedSession[]> {
    return Promise.resolve(this.listed.filter((s) => s.directory === directory).slice(0, limit));
  }
  /** Each `setPermission` call, in order. */
  readonly permissionChanges: { sessionId: string; permission: OpenCodePermissionPolicy }[] = [];
  setPermission(sessionId: string, permission: OpenCodePermissionPolicy): Promise<void> {
    this.permissionChanges.push({ sessionId, permission });
    return Promise.resolve();
  }
  hasSession(sessionId: string): Promise<boolean> {
    this.checked.push(sessionId);
    return Promise.resolve(this.sessions.includes(sessionId) || this.known.has(sessionId));
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
  /** When set, `steer` waits for the test to answer (accept or refuse). */
  holdSteer = false;
  answerSteer?: (accepted: boolean) => void;
  steer(sessionId: string, text: string): Promise<void> {
    this.steered.push({ sessionId, text });
    if (!this.holdSteer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.answerSteer = (accepted) =>
        accepted ? resolve() : reject(new Error('session is not accepting messages'));
    });
  }
  commands(): Promise<OpenCodeCommand[]> {
    this.commandLists++;
    return Promise.resolve(this.commandList);
  }
  runCommand(sessionId: string, run: OpenCodeCommandRun): Promise<void> {
    this.commandRuns.push({ sessionId, run });
    return Promise.resolve();
  }
  /** What the server says after an interrupt, as OpenCode 1 does (its run's end). */
  afterInterrupt: (sessionId: string) => void = (sessionId) =>
    this.emit('session.idle', { sessionID: sessionId });
  interrupt(sessionId: string): Promise<void> {
    this.aborted.push(sessionId);
    setImmediate(() => this.afterInterrupt(sessionId));
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

const compactionBlocks = (events: AgentStreamEvent[]): unknown[] =>
  events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as { content: Record<string, unknown> }).content)
    .filter((c) => c['type'] === 'compaction');

test('OpenCodeAdapter emits session.compacted after a model step as a compaction block', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  server.emit('message.part.updated', {
    part: {
      id: 'sf',
      sessionID: 'ses_1',
      messageID: 'm1',
      type: 'step-finish',
      tokens: { input: 1200, output: 300 },
    },
  });
  server.emit('session.compacted', { sessionID: 'ses_1' });
  server.emit('session.idle', { sessionID: 'ses_1' });

  await done;
  assert.deepEqual(compactionBlocks(events), [{ type: 'compaction', reason: 'unknown' }]);
});

// Captured from opencode 2.0.16 driven through this adapter, on a model whose
// context window cannot hold OpenCode's own prompt and tools: OpenCode compacts
// a brand-new session before its first step. That rewrites the prompt just
// sent — there is no earlier context — so the first turn carries no marker.
test('a first turn OpenCode compacts before any step shows no compaction and completes', async () => {
  const server = new FakeServer(2);
  const adapter = makeAdapter(server, { defaultModel: 'opencode/big-pickle' });
  const { events, done } = collect(adapter);
  const S = 'ses_1';
  const M = 'msg_0e65b34ad001';
  const model = { id: 'big-pickle', providerID: 'opencode', variant: 'default' };

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'Where is a pairing code expired?',
  });
  server.emitV2('session.execution.started', { sessionID: S });
  server.emitV2('session.compaction.started', { sessionID: S, reason: 'auto', recent: '' });
  server.emitV2('session.usage.updated', {
    sessionID: S,
    cost: 0,
    tokens: { input: 6592, output: 226, reasoning: 117, cache: { read: 488, write: 0 } },
  });
  server.emitV2('session.compaction.ended', {
    sessionID: S,
    reason: 'auto',
    model,
    text: '## Objective\n- Answer where a pairing code is expired.',
    recent: '',
    tokens: { input: 6592, output: 226, reasoning: 117, cache: { read: 488, write: 0 } },
  });
  server.emitV2('session.step.started', {
    sessionID: S,
    agent: 'build',
    model,
    assistantMessageID: M,
  });
  server.emitV2('session.text.started', { sessionID: S, assistantMessageID: M, ordinal: 0 });
  server.emitV2('session.text.delta', {
    sessionID: S,
    assistantMessageID: M,
    ordinal: 0,
    delta: 'Pairing codes expire after five minutes.',
  });
  server.emitV2('session.text.ended', {
    sessionID: S,
    assistantMessageID: M,
    ordinal: 0,
    text: 'Pairing codes expire after five minutes.',
  });
  server.emitV2('session.step.ended', {
    sessionID: S,
    assistantMessageID: M,
    finish: 'stop',
    tokens: { input: 376, output: 94, reasoning: 0, cache: { read: 6544, write: 0 } },
  });
  server.emitV2('session.execution.succeeded', { sessionID: S });

  await done;
  assert.deepEqual(compactionBlocks(events), []);
  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
  );
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal(
    (completed?.data as { text: string }).text,
    'Pairing codes expire after five minutes.',
  );
});

test("a compaction after the first turn's step, or on a resumed session, is marked", async () => {
  const server = new FakeServer(2);
  server.known.add('ses_stored');
  const adapter = makeAdapter(server);
  const model = { id: 'big-pickle', providerID: 'opencode', variant: 'default' };

  // A new session: the pre-step compaction is not marked, the one after the
  // step (which compacts the turn's own tool output) is.
  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'look around' });
  server.emitV2('session.compaction.ended', { sessionID: 'ses_1', reason: 'auto', model });
  server.emitV2('session.step.ended', {
    sessionID: 'ses_1',
    finish: 'tool-calls',
    tokens: { input: 280, output: 74, reasoning: 0, cache: { read: 6501, write: 0 } },
  });
  server.emitV2('session.compaction.ended', { sessionID: 'ses_1', reason: 'auto', model });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_1' });
  await first.done;
  assert.equal(compactionBlocks(first.events).length, 1);

  // A session resumed from an earlier turn holds context from the start.
  adapter.adoptNativeSession('t2', 'ses_stored');
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't2', turnId: 'u2', text: 'and then' });
  server.emitV2('session.compaction.ended', { sessionID: 'ses_stored', reason: 'auto', model });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_stored' });
  await second.done;
  assert.deepEqual(compactionBlocks(second.events), [{ type: 'compaction', reason: 'unknown' }]);
});

// Captured from opencode 2.0.16: a compaction, then an instruction update (the
// tool catalog of an MCP server that connected mid-turn), then OpenCode's next
// automatic compaction finds nothing to compact and the execution fails. The
// turn fails because OpenCode stopped — but it says why, and shows no marker.
test("OpenCode's 'Nothing to compact yet' fails the turn with a reason the user can act on", async () => {
  const server = new FakeServer(2);
  server.catalog = [{ id: 'openrouter/perceptron/perceptron-mk1.5', contextWindow: 36864 }];
  const adapter = makeAdapter(server, { defaultModel: 'openrouter/perceptron/perceptron-mk1.5' });
  await adapter.loadContextWindows();
  const { events, done } = collect(adapter);
  const S = 'ses_1';
  const model = { id: 'perceptron/perceptron-mk1.5', providerID: 'openrouter' };
  const error = { type: 'compaction.unavailable', message: 'Nothing to compact yet' };

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'Which tests cover the handshake?',
  });
  server.emitV2('session.compaction.started', { sessionID: S, reason: 'auto', recent: '' });
  server.emitV2('session.compaction.ended', { sessionID: S, reason: 'auto', model, recent: '' });
  server.emitV2('session.instructions.updated', {
    sessionID: S,
    delta: { 'core/codemode': 'b48eec48' },
    text: 'The Code Mode tool catalog has changed.',
  });
  server.emitV2('session.compaction.failed', { sessionID: S, reason: 'auto', error });
  server.emitV2('session.execution.failed', { sessionID: S, error });

  await done;
  assert.deepEqual(compactionBlocks(events), []);
  const failed = events.find((e) => e.type === 'turn_error');
  assert.equal(
    (failed?.data as { text: string }).text,
    'OpenCode stopped: Nothing to compact yet. The context window of ' +
      'openrouter/perceptron/perceptron-mk1.5 (36,864 tokens) is too small for ' +
      "OpenCode's own prompt and tools, so its automatic compaction had nothing left " +
      'to shrink. Choose a model with a larger context window.',
  );
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

test("a conversation's access mode reaches its session when it changes, both ways", async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const turnOn = async (turnId: string, accessMode: AccessMode) => {
    const run = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId, text: 'go', accessMode });
    server.emit('session.idle', { sessionID: 'ses_1' });
    await run.done;
  };

  await turnOn('u1', 'requestApproval');
  assert.equal(server.lastPermission, 'ask', 'created asking');
  await turnOn('u2', 'requestApproval');
  assert.deepEqual(server.permissionChanges, [], 'unchanged: nothing to set');
  // Switched to full access: the session made to ask must stop asking…
  await turnOn('u3', 'fullAccess');
  // …and set back to ask, it must ask again (the unsafe direction).
  await turnOn('u4', 'requestApproval');
  assert.deepEqual(server.permissionChanges, [
    { sessionId: 'ses_1', permission: 'allow' },
    { sessionId: 'ses_1', permission: 'ask' },
  ]);
  assert.equal(server.sessions.length, 1, 'the same session throughout');
});

test('a session this process did not create gets the conversation access mode first', async () => {
  const server = new FakeServer();
  server.known.add('ses_stored');
  const adapter = makeAdapter(server);
  adapter.adoptNativeSession('t1', 'ses_stored');
  collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go', accessMode: 'fullAccess' });
  // Its rules are whatever it was created with, days ago or in a terminal.
  assert.deepEqual(server.permissionChanges, [{ sessionId: 'ses_stored', permission: 'allow' }]);
  assert.equal(server.prompts[0]?.sessionId, 'ses_stored');
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

// After a restart (or when a conversation takes over a terminal's) the bridge
// hands the stored id back. The server is asked once whether it still has the
// session; it does, so the turn runs there and nothing new is created.
test('OpenCodeAdapter resumes an adopted session the server still has', async () => {
  const server = new FakeServer();
  server.known.add('ses_stored');
  const adapter = makeAdapter(server);
  adapter.adoptNativeSession('t1', 'ses_stored');

  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go on' });
  server.emit('session.idle', { sessionID: 'ses_stored' });
  await first.done;
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'and then' });
  server.emit('session.idle', { sessionID: 'ses_stored' });
  await second.done;

  assert.deepEqual(server.sessions, []);
  assert.deepEqual(server.checked, ['ses_stored']); // asked once, not per turn
  assert.deepEqual(
    server.prompts.map((p) => p.sessionId),
    ['ses_stored', 'ses_stored'],
  );
});

// A session deleted meanwhile: the turn opens a fresh one instead of failing,
// and the gone id is not taken back while the store still holds it.
test('OpenCodeAdapter opens a fresh session when the adopted one is gone', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  adapter.adoptNativeSession('t1', 'ses_gone');

  const { events, done } = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'still there?' });
  server.emit('session.idle', { sessionID: 'ses_1' });
  await done;

  assert.equal(
    events.some((e) => e.type === 'turn_error'),
    false,
  );
  assert.deepEqual(server.sessions, ['ses_1']);
  assert.equal(server.prompts[0]?.sessionId, 'ses_1');
  assert.equal(adapter.nativeSessionId('t1'), 'ses_1');
});

// The session list reads the folder's sessions from OpenCode's server. A
// session this bridge opened is titled with the conversation's id — that is
// what tells it from a person's, whose title is shown.
test('OpenCodeAdapter lists the folder’s sessions from its server', async () => {
  const server = new FakeServer();
  server.listed = [
    { id: 'ses_tui', directory: '/p', title: 'Add a dark theme', updated: 3_000 },
    { id: 'ses_untitled', directory: '/p', updated: 2_000 },
    {
      id: 'ses_bridge',
      directory: '/p',
      title: '0f4ad2c1-3b5e-4c6d-8e9f-a1b2c3d4e5f6',
      updated: 1_000,
    },
    { id: 'ses_else', directory: '/q', title: 'x', updated: 500 },
  ];
  const adapter = makeAdapter(server);
  assert.deepEqual(await adapter.listNativeSessions('/p'), [
    {
      sessionId: 'ses_tui',
      cwd: '/p',
      title: 'Add a dark theme',
      updatedAt: 3_000,
      interactive: true,
    },
    { sessionId: 'ses_untitled', cwd: '/p', updatedAt: 2_000, interactive: true },
    { sessionId: 'ses_bridge', cwd: '/p', updatedAt: 1_000, interactive: false },
  ]);
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

test('a stop waits for the stopped run to end, so the next turn starts clean', async () => {
  // Found live (OpenCode 2.0.19): a stop answered at once, the next message
  // started on the same session, and the stopped run's last events — the tool
  // it cut short, its own end — arrived after it and landed on that new turn,
  // aborting it too.
  const server = new FakeServer();
  const adapter = makeAdapter(server);
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run sleep 300' });
  server.afterInterrupt = (sessionId) => {
    // The server takes a moment to wind the run down.
    setTimeout(() => {
      server.emit('message.part.updated', {
        part: {
          id: 'b1',
          sessionID: sessionId,
          type: 'tool',
          tool: 'bash',
          state: { status: 'error', input: { command: 'sleep 300' }, error: 'aborted' },
        },
      });
      server.emit('session.idle', { sessionID: sessionId });
    }, 30);
  };
  await adapter.cancelTurn('t1', 'u1');
  // The message sent now starts at once on the same session.
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'say BANANA' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const ofU2 = events.filter((e) => e.turnId === 'u2').map((e) => e.type);
  assert.deepEqual(ofU2, ['turn_started'], 'nothing of the stopped run reached the new turn');
  assert.ok(events.some((e) => e.turnId === 'u1' && e.type === 'turn_aborted'));
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

// Verified live against OpenCode 2.0.16: a steer accepted just after the
// session went idle runs as another run — its own reply, then a second idle.
test('a message accepted as the session goes idle keeps the turn open for its answer', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  server.holdSteer = true;
  const taken = adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'and this',
  });
  // The session goes idle while the message is still being handed over...
  server.emit('session.idle', { sessionID: 'ses_1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
  );
  // ...the server takes it, and runs it.
  server.answerSteer!(true);
  assert.equal(await taken, true);
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
  );
  server.emit('message.updated', { info: { id: 'm2', sessionID: 'ses_1', role: 'assistant' } });
  server.emit('message.part.updated', {
    part: { id: 'p2', sessionID: 'ses_1', messageID: 'm2', type: 'text', text: 'LATE ANSWER' },
  });
  server.emit('session.idle', { sessionID: 'ses_1' });
  const all = await done;
  const completions = all.filter((e) => e.type === 'turn_completed');
  assert.equal(completions.length, 1);
  assert.match(String((completions[0]?.data as { text: string }).text), /LATE ANSWER/);
});

// --- background commands: OpenCode 2 wakes the model when they end ---
//
// Measured on 2.0.19: the shell tool with `background: true` returns at once,
// the execution succeeds ("I'll report back"), and when the shell exits the
// server queues a `synthetic` note and runs the model again on the same
// session — a second execution nobody prompted, whose reply is this turn's.

/** One background command started in session `ses_1`, then the step ends. */
function startBackgroundCommand(server: FakeServer, shellId: string, text: string): void {
  server.emitV2('session.tool.input.started', {
    sessionID: 'ses_1',
    id: `call_${shellId}`,
    name: 'shell',
  });
  server.emitV2('session.tool.called', {
    sessionID: 'ses_1',
    id: `call_${shellId}`,
    input: { command: 'sleep 12', background: true },
  });
  server.emitV2('session.tool.progress', {
    sessionID: 'ses_1',
    id: `call_${shellId}`,
    metadata: { shellID: shellId },
  });
  server.emitV2('session.tool.success', {
    sessionID: 'ses_1',
    id: `call_${shellId}`,
    content: [{ type: 'text', text: `Command moved to the background (shell ID: ${shellId}).` }],
  });
  server.emitV2('session.text.delta', {
    sessionID: 'ses_1',
    assistantMessageID: `m_${shellId}`,
    ordinal: 0,
    delta: text,
  });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_1' });
}

test('an OpenCode 2 turn that leaves a command running waits for the wake-up that reports it', async () => {
  const server = new FakeServer(2);
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run it in the background' });
  startBackgroundCommand(server, 'sh_1', 'WAITING');
  await tick();
  // Completing here closed the turn on "WAITING" and dropped the report.
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
    'held for the command',
  );

  server.emitV2('shell.exited', { id: 'sh_1', exit: 0, status: 'exited' });
  server.emitV2('session.execution.started', { sessionID: 'ses_1' });
  server.emitV2('session.text.delta', {
    sessionID: 'ses_1',
    assistantMessageID: 'm_wake',
    ordinal: 0,
    delta: 'BG FINISHED',
  });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_1' });

  const all = await done;
  const completions = all.filter((e) => e.type === 'turn_completed');
  assert.equal(completions.length, 1);
  assert.equal((completions[0]?.data as { text: string }).text, 'WAITINGBG FINISHED');
  const boundaries = all.filter(
    (e) =>
      e.type === 'block' &&
      (e.data as { content: { type: string } }).content.type === 'assistant_response_boundary',
  );
  assert.equal(boundaries.length, 1, 'the report is its own reply, after the first');
});

test('a wake-up that starts another background command keeps the OpenCode turn held', async () => {
  const server = new FakeServer(2);
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'wait for CI, then the release' });
  startBackgroundCommand(server, 'sh_ci', 'Waiting for CI. ');
  server.emitV2('shell.exited', { id: 'sh_ci', exit: 0, status: 'exited' });
  startBackgroundCommand(server, 'sh_release', 'CI is green; waiting for the release. ');
  await tick();
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
    'held for the release',
  );

  server.emitV2('shell.exited', { id: 'sh_release', exit: 0, status: 'exited' });
  server.emitV2('session.text.delta', {
    sessionID: 'ses_1',
    assistantMessageID: 'm_done',
    ordinal: 0,
    delta: 'Released.',
  });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_1' });

  const all = await done;
  assert.equal(all.filter((e) => e.type === 'turn_completed').length, 1);
  assert.match(
    (all.find((e) => e.type === 'turn_completed')?.data as { text: string }).text,
    /Waiting for CI\. CI is green; waiting for the release\. Released\./,
  );
});

test('a held OpenCode turn completes after the grace period when no wake-up comes', async () => {
  const server = new FakeServer(2);
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    spawnFn: immediateSpawn() as never,
    serverFactory: () => server,
    defaultModel: 'opencode/m',
    wakeGraceMs: 20,
  });
  const { events, done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go' });
  startBackgroundCommand(server, 'sh_1', 'WAITING');
  server.emitV2('shell.exited', { id: 'sh_1', exit: 0, status: 'exited' });
  await tick();
  assert.equal(
    events.some((e) => e.type === 'turn_completed'),
    false,
    'a wake-up may still come',
  );

  const all = await done;
  assert.equal(
    (all.find((e) => e.type === 'turn_completed')?.data as { text: string }).text,
    'WAITING',
  );
});

test('a command that ends before the step does not hold the OpenCode turn', async () => {
  const server = new FakeServer(2);
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'run it' });
  server.emitV2('session.tool.progress', {
    sessionID: 'ses_1',
    id: 'call_1',
    metadata: { shellID: 'sh_fg' },
  });
  server.emitV2('shell.exited', { id: 'sh_fg', exit: 0, status: 'exited' });
  server.emitV2('session.text.delta', {
    sessionID: 'ses_1',
    assistantMessageID: 'm1',
    ordinal: 0,
    delta: 'Done.',
  });
  server.emitV2('session.execution.succeeded', { sessionID: 'ses_1' });

  const all = await done;
  assert.equal(
    (all.find((e) => e.type === 'turn_completed')?.data as { text: string }).text,
    'Done.',
  );
});

test('a message refused as the session goes idle lets the turn end at that idle', async () => {
  const server = new FakeServer();
  const adapter = makeAdapter(server, { defaultModel: 'opencode/m' });
  const { done } = collect(adapter);

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  server.holdSteer = true;
  const taken = adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'and this',
  });
  server.emit('session.idle', { sessionID: 'ses_1' });
  await new Promise((resolve) => setImmediate(resolve));
  server.answerSteer!(false);
  assert.equal(await taken, false);
  const all = await done;
  assert.equal(all.filter((e) => e.type === 'turn_completed').length, 1);
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
