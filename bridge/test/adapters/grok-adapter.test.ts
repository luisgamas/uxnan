import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { GrokAdapter, mapGrokModels, type SpawnedAcp } from '../../src/index.js';
import {
  effortOptionId,
  grokPermissionNotice,
  grokPermissionSource,
  parseGrokCommands,
} from '../../src/adapters/grok-adapter.js';
import type { AgentStreamEvent } from '@uxnan/shared';

// A fake `grok agent stdio` process: an ndjson JSON-RPC peer over PassThrough
// streams. The handshake (initialize / session/new / session/set_model /
// session/set_config_option / session/load) is auto-answered; a per-test handler drives
// the prompt turn. `initialize` returns Grok's `_meta.modelState` so the adapter
// can discover models from the handshake.
class FakeAcp {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly sent: any[] = [];
  private closeCbs: ((code: number | null) => void)[] = [];
  private handlers: Array<(m: any) => void> = [];
  sessionId = 'grok_sess_1';
  /** `agentCapabilities` the handshake advertises (none by default). */
  agentCapabilities: unknown = undefined;

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
      if (m.method === 'initialize') {
        this.reply(m.id, {
          protocolVersion: 1,
          authMethods: [],
          ...(this.agentCapabilities ? { agentCapabilities: this.agentCapabilities } : {}),
          _meta: {
            modelState: {
              currentModelId: 'grok-4.5',
              availableModels: [
                {
                  modelId: 'grok-4.5',
                  name: 'Grok 4.5',
                  description: 'frontier',
                  _meta: {
                    totalContextTokens: 500000,
                    supportsReasoningEffort: true,
                    reasoningEfforts: [
                      { id: 'high', value: 'high', label: 'High Effort', default: true },
                      { id: 'low', value: 'low', label: 'Low Effort', default: false },
                    ],
                  },
                },
                {
                  modelId: 'grok-composer-2.5-fast',
                  name: 'Composer 2.5',
                  _meta: { totalContextTokens: 200000 },
                },
              ],
            },
          },
        });
      } else if (m.method === 'session/new')
        this.reply(m.id, {
          sessionId: this.sessionId,
          // As Grok answers: effort is a `thought_level` config option.
          configOptions: [
            { id: 'model', category: 'model', type: 'select', currentValue: 'grok-4.5' },
            {
              id: 'reasoning_effort',
              category: 'thought_level',
              type: 'select',
              currentValue: 'high',
            },
          ],
        });
      else if (m.method === 'session/load') this.reply(m.id, {});
      else if (m.method === 'session/set_config_option') this.reply(m.id, { configOptions: [] });
      else if (m.method === 'session/set_model')
        this.reply(m.id, { _meta: { model: { Ok: m.params?.modelId } } });
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
const adapters: GrokAdapter[] = [];
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
    permissionSource?: (cwd: string) => { mode: string; file: string } | undefined;
  } = {},
): { adapter: GrokAdapter; server: FakeAcp } {
  const server = new FakeAcp();
  servers.push(server);
  const adapter = new GrokAdapter({
    binaryPath: 'grok',
    spawnAcp: () => server.spawn(),
    // Never the user's own settings: a test sees only what it sets.
    permissionSource: opts.permissionSource ?? (() => undefined),
    ...(opts.onApprovalRequest ? { onApprovalRequest: opts.onApprovalRequest } : {}),
  });
  adapters.push(adapter);
  return { adapter, server };
}

function collect(adapter: GrokAdapter): Promise<AgentStreamEvent[]> {
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

test('mapGrokModels maps context window, default flag, and reasoning knob', () => {
  const models = mapGrokModels({
    currentModelId: 'grok-4.5',
    availableModels: [
      {
        modelId: 'grok-4.5',
        name: 'Grok 4.5',
        description: 'frontier',
        _meta: {
          totalContextTokens: 500000,
          supportsReasoningEffort: true,
          reasoningEfforts: [
            { id: 'high', value: 'high', label: 'High Effort', default: true },
            { id: 'low', value: 'low', label: 'Low Effort', default: false },
          ],
        },
      },
      {
        modelId: 'grok-composer-2.5-fast',
        name: 'Composer 2.5',
        _meta: { totalContextTokens: 200000 },
      },
    ],
  });
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.equal(byId['grok-4.5']?.displayName, 'Grok 4.5');
  assert.equal(byId['grok-4.5']?.contextWindow, 500000);
  assert.equal(byId['grok-4.5']?.isDefault, true);
  // The reasoning knob is advertised with Grok's own labels + default.
  const opt = byId['grok-4.5']?.options?.[0];
  assert.equal(opt?.key, 'reasoning');
  assert.equal(opt?.kind, 'enum');
  assert.deepEqual(opt?.values, [
    { value: 'high', label: 'High Effort' },
    { value: 'low', label: 'Low Effort' },
  ]);
  assert.equal(opt?.default, 'high');
  // A model with no reasoning-effort support advertises no knob.
  assert.equal(byId['grok-composer-2.5-fast']?.options, undefined);
  assert.equal(byId['grok-composer-2.5-fast']?.contextWindow, 200000);
  assert.equal(byId['grok-composer-2.5-fast']?.isDefault, undefined);
});

test('a config-pinned default overrides Grok’s own current model', () => {
  const models = mapGrokModels(
    { currentModelId: 'grok-4.5', availableModels: [{ modelId: 'grok-4.5' }, { modelId: 'x' }] },
    'x',
  );
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.equal(byId['x']?.isDefault, true);
  assert.equal(byId['grok-4.5']?.isDefault, undefined);
});

test('GrokAdapter discovers models from the initialize handshake', async () => {
  const { adapter } = setup();
  const models = await adapter.listModels();
  const ids = models.map((m) => m.id).sort();
  assert.deepEqual(ids, ['grok-4.5', 'grok-composer-2.5-fast']);
  assert.equal(models.find((m) => m.id === 'grok-4.5')?.contextWindow, 500000);
});

test('GrokAdapter hands a session the desktop tools only when Grok takes HTTP MCP servers', async () => {
  const desktopTools = { mcpUrl: 'http://127.0.0.1:51234/mcp', token: 'k'.repeat(43) };
  for (const http of [true, false]) {
    const { adapter, server } = setup();
    if (http) server.agentCapabilities = { mcpCapabilities: { http: true } };
    server.handle((m) => {
      if (m.method === 'session/prompt') server.reply(m.id, { stopReason: 'end_turn' });
    });
    const done = collect(adapter);
    await adapter.sendTurn({
      threadId: `mcp-${http}`,
      turnId: 'u1',
      text: 'hi',
      cwd: '/w/a b',
      desktopTools,
    });
    await done;
    const created = server.sent.find((m) => m.method === 'session/new');
    if (http) {
      assert.deepEqual(created.params.mcpServers, [
        {
          type: 'http',
          name: 'uxnan-browser',
          url: desktopTools.mcpUrl,
          headers: [
            { name: 'Authorization', value: `Bearer ${desktopTools.token}` },
            { name: 'x-uxnan-cwd', value: '%2Fw%2Fa%20b' },
          ],
        },
      ]);
    } else {
      assert.deepEqual(created.params.mcpServers, []);
    }
  }
});

test('GrokAdapter streams thinking/text/blocks and completes on prompt result', async () => {
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
      title: 'shell',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'ls' },
    });
    server.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
    });
    server.reply(m.id, { stopReason: 'end_turn' });
  });

  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', service: 'grok-4.5' });
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
  // The model was set for the session via the standard ACP method.
  assert.ok(
    server.sent.some((m) => m.method === 'session/set_model' && m.params.modelId === 'grok-4.5'),
  );
});

test('GrokAdapter applies the chosen reasoning effort through its thought_level config option', async () => {
  const { adapter, server } = setup();
  const done = collect(adapter);
  server.handle((m) => {
    if (m.method === 'session/prompt') server.reply(m.id, { stopReason: 'end_turn' });
  });
  await adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'go',
    options: { reasoning: 'low' },
  });
  await done;
  assert.ok(
    server.sent.some(
      (m) =>
        m.method === 'session/set_config_option' &&
        m.params.configId === 'reasoning_effort' &&
        m.params.value === 'low',
    ),
  );
  // `session/set_mode` accepts anything and changes nothing: never used for effort.
  assert.equal(
    server.sent.some((m) => m.method === 'session/set_mode'),
    false,
  );
});

test('GrokAdapter routes session/request_permission → approval → reply optionId', async () => {
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
      { toolCallId: 't1', title: 'shell', kind: 'execute', rawInput: { command: 'rm -rf x' } },
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
  assert.equal(seen[0]?.toolName, 'shell');
  // approveSession → the allow_always option ("always").
  const reply = server.sent.find((m) => m.id === 99 && m.result?.outcome);
  assert.deepEqual(reply.result.outcome, { outcome: 'selected', optionId: 'always' });

  server.reply(server.sent.find((m) => m.method === 'session/prompt').id, {
    stopReason: 'end_turn',
  });
  await done;
});

test('GrokAdapter auto-approves without the phone under approveForMe', async () => {
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
});

test('GrokAdapter emits a plan block from a plan update', async () => {
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

test('GrokAdapter reuses the session id across turns and cancels', async () => {
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
  assert.equal(adapter.nativeSessionId('t1'), 'grok_sess_1');
});

test('GrokAdapter cancelTurn sends session/cancel and emits turn_aborted', async () => {
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

test('GrokAdapter surfaces the CLI error detail (not just "Internal error") on a failed prompt', async () => {
  const { adapter, server } = setup();
  const done = collect(adapter);
  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    // Grok wraps the real reason in the JSON-RPC error's `data.message` — the
    // top-level `message` is a generic "Internal error".
    server.feed({
      jsonrpc: '2.0',
      id: m.id,
      error: {
        code: -32603,
        message: 'Internal error',
        data: {
          message: 'API error (status 402 Payment Required): Grok Build usage balance exhausted',
          http_status: 402,
        },
      },
    });
  });
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go' });
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.ok(err, 'a turn_error was emitted');
  const text = (err!.data as { text: string }).text;
  // The useful detail is surfaced, not swallowed by the generic JSON-RPC message.
  assert.match(text, /usage balance exhausted/);
  assert.doesNotMatch(text, /Internal error/);
});

test('listCommands opens a short session for a new folder and reads what it announces', async () => {
  const { adapter, server } = setup();
  server.handle((m) => {
    if (m.method === 'session/new') {
      // Grok announces a session's commands right after creating it.
      setTimeout(
        () =>
          server.update({
            sessionUpdate: 'available_commands_update',
            availableCommands: [
              { name: 'compact', description: 'Compress history', input: { hint: 'what to keep' } },
              { name: 'always-approve', description: 'Toggle', input: { hint: 'on|off' } },
              { name: 'review', description: 'Review the branch', input: null },
            ],
          }),
        5,
      );
    } else if (m.method === 'session/close') server.reply(m.id, {});
  });
  const commands = await adapter.listCommands('/work/app');
  assert.deepEqual(
    commands.map((c) => [c.name, c.argumentHint]),
    [
      ['compact', 'what to keep'],
      ['review', undefined],
    ],
  );
  // The listing's own session is closed, and the folder's list is reused.
  await tick();
  assert.ok(server.sent.some((m) => m.method === 'session/close'));
  const opened = server.sent.filter((m) => m.method === 'session/new').length;
  await adapter.listCommands('/work/app');
  assert.equal(server.sent.filter((m) => m.method === 'session/new').length, opened);
});

test('parseGrokCommands labels skills and leaves out what the bridge owns', () => {
  const commands = parseGrokCommands(
    [
      { name: 'figma', description: 'Import Figma', input: null },
      { name: 'statusline', description: 'Configure', input: null },
      { name: 'goal', description: 'Set a goal', input: { hint: '<objective>' } },
      { description: 'no name' },
    ],
    '/work/app',
    (name) => name === 'figma',
  );
  assert.deepEqual(commands, [
    { name: 'figma', source: 'skill', headlessSupported: true, description: 'Import Figma' },
    {
      name: 'goal',
      source: 'acp',
      headlessSupported: true,
      description: 'Set a goal',
      argumentHint: '<objective>',
    },
  ]);
});

test('effortOptionId finds the thought_level option a session announces', () => {
  assert.equal(
    effortOptionId([
      { id: 'model', category: 'model' },
      { id: 'reasoning_effort', category: 'thought_level' },
    ]),
    'reasoning_effort',
  );
  assert.equal(effortOptionId([{ id: 'mode', category: 'mode' }]), undefined);
  assert.equal(effortOptionId(undefined), undefined);
});

test('a permission request for no turn of ours is refused, never approved', async () => {
  const { adapter, server } = setup({ onApprovalRequest: () => Promise.resolve('approve') });
  const done = collect(adapter);
  server.handle((m) => {
    if (m.method !== 'session/prompt') return;
    server.feed({
      jsonrpc: '2.0',
      id: 42,
      method: 'session/request_permission',
      params: {
        sessionId: 'someone-else',
        toolCall: { toolCallId: 't', title: 'rm -rf build', kind: 'execute' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    });
    setTimeout(() => server.reply(m.id, { stopReason: 'end_turn' }), 10);
  });
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'go', accessMode: 'fullAccess' });
  await done;
  const reply = server.sent.find((m) => m.id === 42 && m.result?.outcome);
  assert.deepEqual(reply.result.outcome, { outcome: 'cancelled' });
});

test('grokPermissionSource finds the setting that keeps Grok from asking', () => {
  const files: Record<string, string> = {
    '/home/u/.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'auto' } }),
  };
  const read = (path: string) => files[path];
  assert.deepEqual(grokPermissionSource('/home/u/work/app', '/home/u', read), {
    mode: 'auto',
    file: '~/.claude/settings.json',
  });
  // A folder's own setting wins over the user's, and one that asks means no notice.
  files['/home/u/work/app/.claude/settings.local.json'] = JSON.stringify({
    permissions: { defaultMode: 'default' },
  });
  assert.equal(grokPermissionSource('/home/u/work/app', '/home/u', read), undefined);
  // Grok's own config counts when no Claude setting names a mode.
  const grokOnly = (path: string) =>
    path === '/home/u/.grok/config.toml' ? '[ui]\npermission_mode = "always-approve"\n' : undefined;
  assert.deepEqual(grokPermissionSource('/home/u/app', '/home/u', grokOnly), {
    mode: 'always-approve',
    file: '~/.grok/config.toml',
  });
  assert.match(grokPermissionNotice({ mode: 'auto', file: '~/.claude/settings.json' }), /"auto"/);
});

test('a thread that asks first is told, once, when the mode of Grok will not ask', async () => {
  const { adapter, server } = setup({
    onApprovalRequest: () => Promise.resolve('approve'),
    permissionSource: () => ({ mode: 'auto', file: '~/.claude/settings.json' }),
  });
  server.handle((m) => {
    if (m.method === 'session/prompt') server.reply(m.id, { stopReason: 'end_turn' });
  });
  const warnings = async (turnId: string) => {
    const done = collect(adapter);
    await adapter.sendTurn({ threadId: 't1', turnId, text: 'go', accessMode: 'requestApproval' });
    return (await done).filter(
      (e) =>
        e.type === 'block' && (e.data as { content: { kind?: string } }).content.kind === 'warning',
    );
  };
  const first = await warnings('u1');
  assert.equal(first.length, 1);
  assert.match(
    (first[0]!.data as { content: { text: string } }).content.text,
    /"auto" \(from ~\/\.claude\/settings\.json\)/,
  );
  assert.equal((await warnings('u2')).length, 0);
});
