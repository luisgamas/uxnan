import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  ZeroAdapter,
  parseZeroModels,
  mergeZeroProviderModels,
  zeroToolBlock,
  type SpawnedAcp,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// A fake `zero acp` process: an ndjson JSON-RPC peer over PassThrough streams.
// The handshake (initialize / session/new / session/set_mode / _zero/set_model /
// session/load) is auto-answered; a per-test handler drives the prompt turn.
class FakeAcp {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly sent: any[] = [];
  private closeCbs: ((code: number | null) => void)[] = [];
  private handlers: Array<(m: any) => void> = [];
  sessionId = 'zero_sess_1';

  constructor() {
    let buf = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        this.sent.push(m);
        for (const h of this.handlers) h(m);
      }
    });
    // Auto-handshake.
    this.handle((m) => {
      if (m.method === 'initialize') this.reply(m.id, { protocolVersion: 1, authMethods: [] });
      else if (m.method === 'session/new')
        this.reply(m.id, { sessionId: this.sessionId, modes: { currentModeId: 'auto' } });
      else if (m.method === 'session/load') this.reply(m.id, {});
      else if (m.method === 'session/set_mode') this.reply(m.id, {});
      else if (m.method === '_zero/set_model') this.reply(m.id, { model: m.params?.model });
    });
  }

  handle(h: (m: any) => void): void {
    this.handlers.push(h);
  }
  feed(obj: unknown): void {
    this.stdout.write(`${JSON.stringify(obj)}\n`);
  }
  reply(id: number | string, result: unknown): void {
    this.feed({ jsonrpc: '2.0', id, result });
  }
  /** Push a `session/update` notification. */
  update(update: unknown): void {
    this.feed({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: this.sessionId, update },
    });
  }
  /** Push a `session/request_permission` server request (adapter must reply). */
  requestPermission(id: number, toolCall: unknown, options: unknown): void {
    this.feed({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: { sessionId: this.sessionId, toolCall, options },
    });
  }
  close(code: number | null = 0): void {
    for (const cb of this.closeCbs) cb(code);
    this.stdout.end();
  }
  spawn(): SpawnedAcp {
    return {
      stdin: this.stdin,
      stdout: this.stdout,
      onClose: (cb) => this.closeCbs.push(cb),
      kill: () => this.close(),
    };
  }
}

const servers: FakeAcp[] = [];
const adapters: ZeroAdapter[] = [];
after(async () => {
  for (const s of servers) s.close();
  for (const a of adapters) await a.stop();
});

function setup(
  opts: {
    onApprovalRequest?: (
      threadId: string,
      info: { toolName: string; input: Record<string, unknown> },
    ) => Promise<'approve' | 'reject' | 'approveSession'>;
  } = {},
): { adapter: ZeroAdapter; server: FakeAcp } {
  const server = new FakeAcp();
  servers.push(server);
  const adapter = new ZeroAdapter({
    binaryPath: 'zero',
    spawnAcp: () => server.spawn(),
    ...(opts.onApprovalRequest ? { onApprovalRequest: opts.onApprovalRequest } : {}),
  });
  adapters.push(adapter);
  return { adapter, server };
}

function collect(adapter: ZeroAdapter): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  return new Promise((resolve) => {
    adapter.onEvent((e) => {
      events.push(e);
      if (e.type === 'turn_completed' || e.type === 'turn_error' || e.type === 'turn_aborted')
        resolve(events);
    });
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test('zeroToolBlock renders an ask_user tool call as readable questions', () => {
  const block = zeroToolBlock({
    toolCallId: 't1',
    title: 'ask_user',
    kind: 'other',
    status: 'completed',
    rawInput: {
      questions: [
        { question: 'Which language?', options: ['Python', 'JavaScript'], recommended: 'Python' },
      ],
    },
    content: [
      { type: 'content', content: { type: 'text', text: 'No interactive user is available.' } },
    ],
  });
  assert.equal(block['type'], 'tool');
  assert.equal(block['toolName'], 'ask_user');
  // The raw args are replaced by a formatted prompt in `output`, not dumped.
  assert.deepEqual(block['input'], {});
  const output = block['output'] as string;
  assert.match(output, /Which language\?/);
  assert.match(output, /Python · JavaScript/);
  assert.match(output, /suggested: Python/);
  assert.match(output, /No interactive user is available\./);
});

test('parseZeroModels parses id/provider/ctx/name lines', () => {
  const out = [
    'Models',
    '  claude-sonnet-4.5 [anthropic] ctx=1000000 out=64000 - Claude Sonnet 4.5',
    '  gpt-4.1 [openai] ctx=1047576 out=32768 - GPT-4.1',
    '  tencent/hy3 [openai-compatible] ctx=128000 out=8192 - HY3',
    '', // blank
  ].join('\n');
  assert.deepEqual(parseZeroModels(out), [
    { id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', contextWindow: 1000000 },
    { id: 'gpt-4.1', displayName: 'GPT-4.1', contextWindow: 1047576 },
    { id: 'tencent/hy3', displayName: 'HY3', contextWindow: 128000 },
  ]);
});

test('mergeZeroProviderModels unions live probes + configured-model fallback, deduped', () => {
  const providers = [
    { name: 'gateway', active: true, apiKeySet: true, status: 'ok', model: 'tencent/hy3' },
    { name: 'opencode', apiKeySet: true, status: 'ok', model: 'big-pickle' },
  ];
  // gateway can't be probed (custom endpoint) → falls back to its configured model;
  // opencode was probed live (2 models, one shared id).
  const probes = { opencode: ['big-pickle', 'claude-fable-5'] };
  const models = mergeZeroProviderModels(providers, probes);
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(byId).sort(), ['big-pickle', 'claude-fable-5', 'tencent/hy3']);
  // The active provider's configured model is the default.
  assert.equal(byId['tencent/hy3']?.isDefault, true);
  assert.equal(byId['tencent/hy3']?.description, 'gateway');
  // A live-probed model carries its provider as description.
  assert.equal(byId['claude-fable-5']?.description, 'opencode');
  // No live probe for gateway → only its configured model surfaced.
  assert.equal(byId['big-pickle']?.description, 'opencode');
});

test('ZeroAdapter streams thinking/text/blocks and completes on prompt result', async () => {
  const { adapter, server } = setup();
  const done = collect(adapter);

  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    server.update({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Thinking…' },
    });
    server.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello ' },
    });
    server.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world' },
    });
    server.update({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'exec_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { cmd: 'ls' },
    });
    server.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
    });
    server.reply(m.id, { stopReason: 'end_turn' });
  });

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', service: 'gpt-4.1' });
  const events = await done;

  const thinking = events.filter((e) => e.type === 'thinking').map((e) => (e.data as any).text);
  assert.deepEqual(thinking, ['Thinking…']);
  const deltas = events.filter((e) => e.type === 'delta').map((e) => (e.data as any).text);
  assert.deepEqual(deltas, ['Hello ', 'world']);
  const blocks = events.filter((e) => e.type === 'block').map((e) => (e.data as any).content);
  assert.deepEqual(blocks[0], {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a.txt',
  });
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as any).text, 'Hello world');
  // The model was set for the session.
  assert.ok(
    server.sent.some((m) => m.method === '_zero/set_model' && m.params.model === 'gpt-4.1'),
  );
});

test('ZeroAdapter routes session/request_permission → approval → reply optionId', async () => {
  const seen: { toolName: string; input: Record<string, unknown> }[] = [];
  const { adapter, server } = setup({
    onApprovalRequest: (_t, info) => {
      seen.push(info);
      return Promise.resolve('approveSession');
    },
  });
  const done = collect(adapter);

  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    server.requestPermission(
      99,
      { toolCallId: 't1', title: 'exec_command', kind: 'execute', rawInput: { cmd: 'rm -rf x' } },
      [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
        { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
      ],
    );
  });

  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'go',
    accessMode: 'requestApproval',
  });
  await tick();
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.toolName, 'exec_command');
  // approveSession → the allow_always option ("always").
  const reply = server.sent.find((m) => m.id === 99 && m.result?.outcome);
  assert.deepEqual(reply.result.outcome, { outcome: 'selected', optionId: 'always' });
  // Interactive mode → the session was set to `ask`.
  assert.ok(server.sent.some((m) => m.method === 'session/set_mode' && m.params.modeId === 'ask'));

  server.reply(server.sent.find((m) => m.method === 'session/prompt').id, {
    stopReason: 'end_turn',
  });
  await done;
});

test('ZeroAdapter auto-approves without the phone under approveForMe', async () => {
  let called = 0;
  const { adapter, server } = setup({
    onApprovalRequest: () => {
      called += 1;
      return Promise.resolve('reject');
    },
  });
  const done = collect(adapter);
  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    server.requestPermission(7, { toolCallId: 't', title: 'exec', kind: 'execute' }, [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    ]);
    setTimeout(() => server.reply(m.id, { stopReason: 'end_turn' }), 10);
  });
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go', accessMode: 'approveForMe' });
  await done;
  assert.equal(called, 0); // phone never consulted
  const reply = server.sent.find((m) => m.id === 7 && m.result?.outcome);
  assert.deepEqual(reply.result.outcome, { outcome: 'selected', optionId: 'allow' });
  assert.ok(server.sent.some((m) => m.method === 'session/set_mode' && m.params.modeId === 'auto'));
});

test('ZeroAdapter emits a plan block from a plan update', async () => {
  const { adapter, server } = setup();
  const done = collect(adapter);
  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    server.update({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Step A', priority: 'high', status: 'completed' },
        { content: 'Step B', priority: 'medium', status: 'in_progress' },
      ],
    });
    server.reply(m.id, { stopReason: 'end_turn' });
  });
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'plan it' });
  const events = await done;
  const plan = events
    .filter((e) => e.type === 'block')
    .map((e) => (e.data as any).content)
    .find((c) => c.type === 'plan');
  assert.deepEqual(plan.state.steps, [
    { description: 'Step A', status: 'completed' },
    { description: 'Step B', status: 'in_progress' },
  ]);
});

test('ZeroAdapter reuses the session id across turns and cancels', async () => {
  const { adapter, server } = setup();
  server.handle((m) => {
    if (m.method === 'session/prompt') server.reply(m.id, { stopReason: 'end_turn' });
  });
  const first = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await first;

  const newCalls = server.sent.filter((m) => m.method === 'session/new').length;
  const second = collect(adapter);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  await second;
  // session/new is called once (turn 2 reuses via session/load).
  assert.equal(newCalls, 1);
  assert.equal(adapter.nativeSessionId('t1'), 'zero_sess_1');
});

test('ZeroAdapter cancelTurn sends session/cancel and emits turn_aborted', async () => {
  const { adapter, server } = setup();
  const events: AgentStreamEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  // Never resolve the prompt so the turn stays in-flight.
  server.handle((m) => void m);
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hang' });
  await tick();
  await adapter.cancelTurn('t1', 'u1');
  await tick();
  assert.ok(server.sent.some((m) => m.method === 'session/cancel'));
  assert.ok(events.some((e) => e.type === 'turn_aborted'));
});
