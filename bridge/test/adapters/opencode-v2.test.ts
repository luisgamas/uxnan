/**
 * OpenCode 2: the event translator, the protocol helpers, the server client
 * against a fake `opencode serve` (routes, password, SSE), and the adapter end
 * to end on it. Event and payload shapes are copied from a real OpenCode 2.0.16
 * run (a turn, a permission, a question, a sub-agent, an interruption).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStreamEvent } from '@uxnan/shared';
import {
  OpenCodeAdapter,
  OpenCodeV2Server,
  OpenCodeV2Translator,
  formAnswer,
  openCodeV2History,
  openCodeV2Models,
  type OpenCodeEvent,
} from '../../src/index.js';
import { fakeOpenCode, waitUntil } from '../helpers/fake-opencode.js';

const S = 'ses_1';
const ev = (type: string, data: Record<string, unknown>) => ({ type, data });

test('V2 translator: text and reasoning stream as deltas, the ended text adds only what is new', () => {
  const t = new OpenCodeV2Translator();
  const base = { sessionID: S, assistantMessageID: 'msg_1', ordinal: 0 };
  assert.deepEqual(t.translate('session.text.delta', { ...base, delta: 'Hel' }), [
    { kind: 'text', sessionId: S, delta: 'Hel' },
  ]);
  assert.deepEqual(t.translate('session.text.ended', { ...base, text: 'Hello' }), [
    { kind: 'text', sessionId: S, delta: 'lo' },
  ]);
  assert.deepEqual(t.translate('session.reasoning.delta', { ...base, delta: 'think' }), [
    { kind: 'reasoning', sessionId: S, delta: 'think' },
  ]);
  assert.deepEqual(t.translate('session.reasoning.ended', { ...base, text: 'think' }), []);
});

test('V2 translator: a tool reports its name, input and output once it ends', () => {
  const t = new OpenCodeV2Translator();
  const id = 'call_1';
  assert.deepEqual(
    t.translate('session.tool.input.started', { sessionID: S, id, name: 'shell' }),
    [],
  );
  assert.deepEqual(
    t.translate('session.tool.called', { sessionID: S, id, input: { command: 'echo probe' } }),
    [],
  );
  assert.deepEqual(
    t.translate('session.tool.success', {
      sessionID: S,
      id,
      content: [{ type: 'text', text: 'probe\n' }],
      metadata: { exit: 0 },
    }),
    [
      {
        kind: 'tool',
        sessionId: S,
        id,
        name: 'shell',
        input: { command: 'echo probe' },
        output: 'probe\n',
        error: false,
      },
    ],
  );
  t.translate('session.tool.input.started', { sessionID: S, id: 'call_2', name: 'read' });
  const [failed] = t.translate('session.tool.failed', {
    sessionID: S,
    id: 'call_2',
    error: { type: 'aborted', message: 'Interaction cancelled' },
  });
  assert.equal((failed as { error: boolean }).error, true);
  assert.equal((failed as { output: string }).output, 'Interaction cancelled');
});

test('V2 translator: the plan tool feeds the plan, not the work log', () => {
  const t = new OpenCodeV2Translator();
  t.translate('session.tool.input.started', { sessionID: S, id: 'c', name: 'todowrite' });
  t.translate('session.tool.called', {
    sessionID: S,
    id: 'c',
    input: { todos: [{ content: 'Step A', status: 'completed' }] },
  });
  const events = t.translate('session.tool.success', { sessionID: S, id: 'c', content: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'plan');
});

test('V2 translator: usage, compaction and the three ways a turn ends', () => {
  const t = new OpenCodeV2Translator();
  assert.deepEqual(
    t.translate('session.step.ended', {
      sessionID: S,
      tokens: { input: 8754, output: 68, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
    [{ kind: 'usage', sessionId: S, tokens: 8822 }],
  );
  assert.deepEqual(t.translate('session.compaction.ended', { sessionID: S }), [
    { kind: 'compacted', sessionId: S },
  ]);
  assert.deepEqual(t.translate('session.execution.succeeded', { sessionID: S }), [
    { kind: 'idle', sessionId: S },
  ]);
  assert.deepEqual(t.translate('session.execution.interrupted', { sessionID: S, reason: 'user' }), [
    { kind: 'interrupted', sessionId: S },
  ]);
  assert.deepEqual(
    t.translate('session.execution.failed', { sessionID: S, error: { message: 'rate limited' } }),
    [{ kind: 'error', sessionId: S, message: 'rate limited' }],
  );
  // Starts, inbox moves and catalog updates carry nothing a turn needs.
  assert.deepEqual(t.translate('session.execution.started', { sessionID: S }), []);
  assert.deepEqual(t.translate('model.updated', {}), []);
});

test('V2 translator: a permission becomes an approval card, with the diff for an edit', () => {
  const t = new OpenCodeV2Translator();
  assert.deepEqual(
    t.translate('permission.asked', {
      id: 'per_1',
      sessionID: S,
      action: 'shell',
      resources: ['echo uxnan-probe'],
      save: ['echo *'],
    }),
    [
      {
        kind: 'permission',
        sessionId: S,
        requestId: 'per_1',
        toolName: 'shell',
        input: { permission: 'shell', command: 'echo uxnan-probe', pattern: 'echo uxnan-probe' },
      },
    ],
  );
  const [edit] = t.translate('permission.asked', {
    id: 'per_2',
    sessionID: S,
    action: 'edit',
    resources: ['hello.txt'],
    metadata: { files: [{ file: 'hello.txt', patch: '+hi', status: 'added' }] },
  });
  assert.deepEqual((edit as { input: unknown }).input, {
    permission: 'edit',
    file_path: 'hello.txt',
    pattern: 'hello.txt',
    diff: '+hi',
  });
});

test('V2 translator: a question form becomes question items, and its answer is keyed per field', () => {
  const t = new OpenCodeV2Translator();
  const [question] = t.translate('form.created', {
    form: {
      id: 'frm_1',
      sessionID: S,
      title: 'Questions',
      metadata: { kind: 'question' },
      fields: [
        {
          key: 'q0',
          title: 'Color preference',
          description: 'Do you prefer red or blue?',
          type: 'string',
          options: [
            { value: 'Red', label: 'Red', description: 'You prefer red.' },
            { value: 'Blue', label: 'Blue' },
          ],
          custom: true,
        },
      ],
    },
  });
  assert.deepEqual(question, {
    kind: 'question',
    sessionId: S,
    requestId: 'frm_1',
    questions: [
      {
        question: 'Do you prefer red or blue?',
        header: 'Color preference',
        options: [{ label: 'Red', description: 'You prefer red.' }, { label: 'Blue' }],
      },
    ],
  });
  const fields = t.formFields('frm_1') ?? [];
  assert.deepEqual(formAnswer(fields, [['Blue']]), { q0: 'Blue' });
  assert.deepEqual(formAnswer([{ key: 'q', multiple: true }], [['a', 'b']]), { q: ['a', 'b'] });
  assert.deepEqual(formAnswer(fields, [[]]), {});
  t.translate('form.replied', { id: 'frm_1', sessionID: S, answer: { q0: 'Blue' } });
  assert.equal(t.formFields('frm_1'), undefined);
});

test('openCodeV2Models maps the catalog to provider/model ids with their windows', () => {
  assert.deepEqual(
    openCodeV2Models([
      {
        id: 'fireworks/ember-1',
        providerID: 'openrouter',
        limit: { context: 1048576, output: 943718 },
      },
      { id: 'big-pickle', providerID: 'opencode', limit: { context: 0, output: 1 } },
      { id: 'off', providerID: 'x', enabled: false, limit: { context: 5 } },
      { id: 'no-provider' },
    ]),
    [{ id: 'openrouter/fireworks/ember-1', contextWindow: 1048576 }, { id: 'opencode/big-pickle' }],
  );
  assert.deepEqual(openCodeV2Models(undefined), []);
});

test('openCodeV2History keeps completed turns, oldest first, with tools and reasoning', () => {
  const history = openCodeV2History([
    { id: 'u', time: { created: 1 }, type: 'user', text: 'hi' },
    {
      id: 'a',
      time: { created: 2, completed: 3 },
      type: 'assistant',
      content: [
        { type: 'reasoning', text: 'r' },
        { type: 'text', text: 'hello' },
      ],
    },
    { id: 'i', time: { created: 4 }, type: 'idle', outcome: 'succeeded' },
    { id: 's', time: { created: 5 }, type: 'system', text: 'catalog changed' },
  ]);
  assert.deepEqual(history, [
    { role: 'user', text: 'hi', createdAt: 1 },
    { role: 'assistant', text: 'hello', thinking: 'r', createdAt: 2 },
  ]);
});

// --- the real client and adapter against a fake `opencode serve` -----------------

const TURN: Record<string, unknown>[] = [
  ev('session.execution.started', { sessionID: S }),
  ev('session.text.delta', { sessionID: S, assistantMessageID: 'm', ordinal: 0, delta: 'Do' }),
  ev('session.text.ended', { sessionID: S, assistantMessageID: 'm', ordinal: 0, text: 'Done.' }),
  ev('session.step.ended', { sessionID: S, tokens: { input: 100, output: 20, reasoning: 0 } }),
  ev('session.execution.succeeded', { sessionID: S }),
];

test('OpenCodeV2Server speaks /api behind the password it set, and translates the stream', async () => {
  const fake = fakeOpenCode(2, {
    onPrompt: TURN,
    models: [{ id: 'big-pickle', providerID: 'opencode', limit: { context: 200000 } }],
    page1: [{ id: 'u', time: { created: 1 }, type: 'user', text: 'one' }],
    page2: [
      {
        id: 'a',
        time: { created: 2, completed: 3 },
        type: 'assistant',
        content: [{ type: 'text', text: 'two' }],
      },
    ],
  });
  const server = new OpenCodeV2Server({
    binaryPath: 'opencode',
    cwd: process.cwd(),
    spawnFn: fake.spawnFn,
  });
  const events: OpenCodeEvent[] = [];
  server.onEvent((e) => events.push(e));
  try {
    await server.start();
    const reqs = fake.requests();
    assert.ok(
      reqs.length > 0 && reqs.every((r) => r.auth?.startsWith('Basic ')),
      'every request authenticates',
    );

    // The catalog loads a moment after boot: the first answer is empty.
    assert.deepEqual(await server.models(), [{ id: 'opencode/big-pickle', contextWindow: 200000 }]);

    const model = { providerID: 'opencode', modelID: 'big-pickle' };
    const id = await server.createSession({ title: 't', permission: 'ask', model });
    assert.equal(id, S);
    const create = fake.requests().find((r) => r.method === 'POST' && r.url === '/api/session');
    assert.deepEqual(create?.body, {
      title: 't',
      location: { directory: process.cwd() },
      model: { id: 'big-pickle', providerID: 'opencode' },
      permissions: ['shell', 'edit', 'webfetch', 'external_directory'].map((action) => ({
        action,
        resource: '*',
        effect: 'ask',
      })),
    });

    // Same model: no switch. Another: switched before the prompt.
    await server.prompt(S, { text: 'go', model });
    await server.prompt(S, { text: 'again', model: { providerID: 'openrouter', modelID: 'x/y' } });
    const turnCalls = fake
      .requests()
      .filter((r) => r.url.startsWith(`/api/session/${S}/`))
      .map((r) => `${r.method} ${r.url.replace(`/api/session/${S}`, '')}`);
    assert.deepEqual(turnCalls, ['POST /prompt', 'POST /model', 'POST /prompt']);

    await server.steer(S, 'more');
    await server.interrupt(S);
    await server.replyPermission(S, 'per_1', 'always');
    await server.answerQuestion(S, 'frm_unknown', []);
    const tail = fake.requests().slice(-4);
    assert.deepEqual(
      tail.map((r) => [r.method, r.url.replace(`/api/session/${S}`, ''), r.body]),
      [
        ['POST', '/prompt', { text: 'more', delivery: 'steer' }],
        ['POST', '/interrupt', undefined],
        ['POST', '/permission/per_1/reply', { decision: 'always' }],
        ['DELETE', '/form/frm_unknown', undefined],
      ],
    );

    // History follows the cursor, oldest first.
    assert.deepEqual(await server.messages(S), [
      { role: 'user', text: 'one', createdAt: 1 },
      { role: 'assistant', text: 'two', createdAt: 2 },
    ]);

    await waitUntil(() => events.filter((e) => e.kind === 'idle').length >= 1);
    assert.deepEqual(events.slice(0, 4), [
      { kind: 'text', sessionId: S, delta: 'Do' },
      { kind: 'text', sessionId: S, delta: 'ne.' },
      { kind: 'usage', sessionId: S, tokens: 120 },
      { kind: 'idle', sessionId: S },
    ]);
  } finally {
    await server.close();
  }
});

/** Collect an adapter's events until its turn ends. */
function collect(adapter: OpenCodeAdapter): { events: AgentStreamEvent[]; done: Promise<void> } {
  const events: AgentStreamEvent[] = [];
  const done = new Promise<void>((resolve) => {
    adapter.onEvent((e) => {
      events.push(e);
      if (e.type === 'turn_completed' || e.type === 'turn_error' || e.type === 'turn_aborted')
        resolve();
    });
  });
  return { events, done };
}

test('the adapter reads the version and drives OpenCode 2 end to end', async () => {
  const fake = fakeOpenCode(2, {
    onPrompt: TURN,
    models: [{ id: 'big-pickle', providerID: 'opencode', limit: { context: 200000 } }],
  });
  const adapter = new OpenCodeAdapter({
    binaryPath: 'opencode',
    defaultModel: 'opencode/big-pickle',
    spawnFn: fake.spawnFn,
  });
  try {
    await adapter.loadContextWindows();
    const { events, done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hello', cwd: process.cwd() });
    await done;
    const completed = events.find((e) => e.type === 'turn_completed');
    assert.deepEqual(completed?.data, {
      text: 'Done.',
      usage: { tokens: 120, contextWindow: 200000 },
    });
    assert.ok(fake.requests().some((r) => r.url === `/api/session/${S}/prompt`));

    // Titles run OpenCode 2 standalone, never through the shared background service.
    assert.equal(
      await adapter.generateTitle({ userText: 'hi', assistantText: 'hello' }),
      'A Fake Title',
    );
    assert.equal(fake.runs()[0]?.[1], '--standalone');
  } finally {
    await adapter.stop();
  }
});

test('the adapter still speaks OpenCode 1 to a 1.x binary', async () => {
  const S1 = 'ses_1';
  const v1Turn = [
    {
      type: 'message.updated',
      properties: { info: { id: 'm', role: 'assistant', sessionID: S1 } },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: { id: 'p', type: 'text', messageID: 'm', sessionID: S1, text: 'V1 answer' },
      },
    },
    { type: 'session.idle', properties: { sessionID: S1 } },
  ];
  const fake = fakeOpenCode(1, { onPrompt: v1Turn });
  const adapter = new OpenCodeAdapter({ binaryPath: 'opencode', spawnFn: fake.spawnFn });
  try {
    const { events, done } = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hello', cwd: process.cwd() });
    await done;
    const done1 = events.find((e) => e.type === 'turn_completed');
    assert.equal((done1?.data as { text?: string } | undefined)?.text, 'V1 answer');
    assert.ok(fake.requests().some((r) => r.url === `/session/${S1}/prompt_async`));
    assert.ok(
      fake.requests().every((r) => r.auth === null),
      'V1 gets no password',
    );
    await adapter.generateTitle({ userText: 'hi', assistantText: 'hello' });
    assert.deepEqual(fake.runs()[0]?.slice(0, 1), ['run']);
    assert.notEqual(fake.runs()[0]?.[1], '--standalone');
  } finally {
    await adapter.stop();
  }
});
