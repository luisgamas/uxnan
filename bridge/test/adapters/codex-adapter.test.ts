import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  CodexAdapter,
  codexUsageTokens,
  parseCodexConfigModels,
  parseCodexModelList,
  parseCodexReasoning,
  type SpawnedAppServer,
} from '../../src/index.js';
import type { AgentStreamEvent } from '@uxnan/shared';
import { codexFileChanges } from '../../src/adapters/codex-tools.js';
import { unifiedDiffBlock } from '../../src/adapters/content-blocks.js';

// --- a fake `codex app-server` whose stdio we drive from the test ---
//
// The adapter spawns a child and speaks JSON-RPC over its stdio. We expose a
// `spawnAppServer` factory that returns PassThrough streams + a manual
// `close()`/`feed()` interface, so tests can:
//   1. drive the `initialize` handshake
//   2. respond to `thread/start` / `turn/start` / `turn/interrupt`
//   3. push notifications (turn/started, item/*, turn/completed, …)
//   4. push server requests (approvals)
class FakeAppServer {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  private closeCallbacks: ((code: number | null) => void)[] = [];
  /** Handlers are called in install-order; each one may act and pass through. */
  private handlers: Array<(msg: any) => void> = [];
  /** Captures every JSON line written to stdin, for assertions. */
  readonly sent: unknown[] = [];

  constructor() {
    let buffer = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          this.sent.push(parsed);
          for (const h of this.handlers) h(parsed);
        } catch {
          /* not JSON */
        }
      }
    });
  }

  /** Drive incoming messages. */
  feed(lines: string[]): void {
    for (const line of lines) this.stdout.write(`${line}\n`);
  }

  /** Append a handler. Multiple handlers may be installed; each is called for
   *  every message and may choose to act (or not). The list survives for the
   *  whole test, so a test that needs to respond to approvals after
   *  `driveStartup` can just `handle()` again without clobbering the handshake. */
  handle(handler: (msg: any) => void): void {
    this.handlers.push(handler);
  }

  /** Simulate the process exiting. */
  close(code: number | null = 0): void {
    for (const cb of this.closeCallbacks) cb(code);
    this.stdout.end();
  }

  /** Adapter-facing factory: returns the streams + lifecycle. */
  spawn(): SpawnedAppServer {
    return {
      stdin: this.stdin,
      stdout: this.stdout,
      onClose: (cb) => this.closeCallbacks.push(cb),
      kill: () => this.close(),
    };
  }
}

function collect(adapter: CodexAdapter): {
  events: AgentStreamEvent[];
  done: Promise<AgentStreamEvent[]>;
  /** Wait until the next terminal event (completed | error | aborted). */
  until: (predicate: (e: AgentStreamEvent) => boolean) => Promise<AgentStreamEvent[]>;
} {
  const events: AgentStreamEvent[] = [];
  const resolvers: Array<{
    predicate: (e: AgentStreamEvent) => boolean;
    resolve: (es: AgentStreamEvent[]) => void;
  }> = [];
  adapter.onEvent((event) => {
    events.push(event);
    for (let i = resolvers.length - 1; i >= 0; i--) {
      if (resolvers[i]!.predicate(event)) {
        resolvers[i]!.resolve(events);
        resolvers.splice(i, 1);
      }
    }
  });
  return {
    events,
    done: new Promise<AgentStreamEvent[]>((resolve) => {
      resolvers.push({
        predicate: (e) => e.type === 'turn_completed' || e.type === 'turn_error',
        resolve,
      });
    }),
    until: (predicate) =>
      new Promise<AgentStreamEvent[]>((resolve) => {
        resolvers.push({ predicate, resolve });
      }),
  };
}

/** All fake servers + adapters created by `setup`; cleaned in an `after` hook
 *  so the test process doesn't hang on open handles (NDJSON streams +
 *  readline interface attached to the fake app-server's stdout). */
const allServers: FakeAppServer[] = [];
const allAdapters: CodexAdapter[] = [];

/** Create a new adapter wired to a fresh fake app-server, plus a controller.
 *
 * Installs the JSON-RPC handshake handler synchronously (before any turn is
 * sent) so the adapter's `initialize` → `thread/start` → `turn/start` always
 * has a responder. Tests that need to react to further messages (approvals,
 * `turn/interrupt`, …) add a SECOND handler via `server.handle(...)` — the
 * fake server's handler list is append-only, so the handshake is never
 * clobbered. */
function setup(
  options: {
    onApprovalRequest?: (
      threadId: string,
      info: { toolName: string; input: Record<string, unknown> },
    ) => Promise<'approve' | 'reject' | 'approveSession'>;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'interactive';
    defaultModel?: string;
  } = {},
): { adapter: CodexAdapter; server: FakeAppServer } {
  const server = new FakeAppServer();
  allServers.push(server);
  let turnSeq = 0;
  // Stable, recognizable ids so assertions can match against them.
  const THREAD_ID = '019codex-thread-aaaa-bbbb-cccccccccccc';
  server.handle((msg) => {
    if (msg.method === 'initialize') {
      server.feed([JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } })]);
    } else if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
      server.feed([JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: THREAD_ID } } })]);
    } else if (msg.method === 'turn/start') {
      turnSeq += 1;
      const id = `codex-turn-${turnSeq}`;
      server.feed([JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn: { id } } })]);
    } else if (msg.method === 'turn/interrupt') {
      server.feed([JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } })]);
    }
  });
  const adapter = new CodexAdapter({
    binaryPath: 'codex',
    ...(options.defaultModel ? { defaultModel: options.defaultModel } : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.onApprovalRequest ? { onApprovalRequest: options.onApprovalRequest } : {}),
    spawnAppServer: () => server.spawn(),
  });
  allAdapters.push(adapter);
  return { adapter, server };
}

/** Wait for the adapter to have emitted `turn_started` (handshake complete). */
async function waitForTurnStarted(
  until: (predicate: (e: AgentStreamEvent) => boolean) => Promise<AgentStreamEvent[]>,
): Promise<void> {
  await until((e) => e.type === 'turn_started');
}

/** Close every fake app-server + stop every adapter so the test file's
 *  process can exit (otherwise the readline interface on the fake stream
 *  keeps the event loop alive). The PassThrough streams + readline
 *  interfaces on the rpc clients don't always release their listeners
 *  cleanly, so we force-exit the process after the cleanup completes. */
test.after(async () => {
  for (const a of allAdapters) await a.stop();
  for (const s of allServers) s.close(0);
  // Give the event loop one tick to settle (rpc.close() is sync; stream
  // end() is async), then exit. The tests have all passed by this point —
  // this is purely a "process is still alive because of dangling handles"
  // workaround for the Node test runner.
  setImmediate(() => process.exit(0));
});


// ============================================================================
// Pure parsers / utilities (kept — they are the public surface the history
// fallback in `session-history.ts` also uses).
// ============================================================================

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
  assert.equal(models[1]?.description, undefined);
  assert.equal(models[2]?.displayName, 'fallback-id');
  const reasoning = models[0]?.options?.find((o) => o.key === 'reasoning');
  assert.deepEqual(
    reasoning?.values?.map((v) => v.value),
    ['low', 'high', 'xhigh'],
  );
  assert.equal(reasoning?.values?.find((v) => v.value === 'xhigh')?.label, 'Extra high');
  assert.equal(reasoning?.default, 'high');
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

test('codexFileChanges extracts changed paths/kinds (adapter reads the content)', () => {
  const changes = codexFileChanges({
    type: 'file_change',
    changes: [{ path: 'a.dart', kind: 'update' }, { path: 'b.dart', kind: 'add' }],
  });
  assert.deepEqual(changes, [
    { path: 'a.dart', kind: 'update' },
    { path: 'b.dart', kind: 'add' },
  ]);
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
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 1);
  assert.equal(
    block['diff'],
    '@@ -1,3 +1,4 @@\n line one\n-line two\n+line two edited\n+brand new line\n line three',
  );
});

// ============================================================================
// Adapter behavior — driven through a fake app-server.
// ============================================================================

test('CodexAdapter initializes the app-server and runs the thread/turn handshake', async () => {
  const { adapter, server } = setup({ defaultModel: 'gpt-5.4-mini' });
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'hello ' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'world' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: { item: { type: 'agentMessage', text: 'hello world' } },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        turn: { status: 'completed', tokenUsage: { input_tokens: 10, output_tokens: 2 } },
      },
    }),
  ]);

  const events = await done;
  assert.equal(events[0]?.type, 'turn_started');
  const deltas = events
    .filter((e) => e.type === 'delta')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(deltas, ['hello ', 'world']);
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'hello world');
  const usage = (completed?.data as { usage?: { tokens: number } }).usage;
  assert.equal(usage?.tokens, 12);

  // Handshake — initialize, then thread/start (no resume), then turn/start
  const methods = server.sent.map((m: any) => m.method);
  assert.deepEqual(methods.slice(0, 3), ['initialize', 'thread/start', 'turn/start']);
  const threadStart = server.sent[1] as any;
  assert.equal(threadStart.params.cwd, process.cwd());
  assert.equal(threadStart.params.model, 'gpt-5.4-mini');
  // Default permission mode is `interactive` → approvalPolicy on-request, sandbox workspace-write
  assert.equal(threadStart.params.approvalPolicy, 'on-request');
  assert.equal(threadStart.params.sandbox, 'workspace-write');
});

test('CodexAdapter routes reasoning-summaryTextDelta to thinking events', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/reasoning/summaryTextDelta',
      params: { delta: 'thinking it ' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/reasoning/summaryTextDelta',
      params: { delta: 'through' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);

  const events = await done;
  const thinking = events
    .filter((e) => e.type === 'thinking')
    .map((e) => (e.data as { text: string }).text);
  assert.deepEqual(thinking, ['thinking it ', 'through']);
});

test('CodexAdapter maps a commandExecution item to a command_execution block', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          command: 'ls',
          aggregatedOutput: 'a\nb',
          exitCode: 0,
          status: 'completed',
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);

  const events = await done;
  const block = events.find((e) => e.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.equal(block?.content['type'], 'command_execution');
  assert.equal(block?.content['command'], 'ls');
  assert.equal(block?.content['status'], 'completed');
  assert.equal(block?.content['output'], 'a\nb');
});

test('CodexAdapter maps a fileChange item to a diff block (uses the inline diff when present)', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  // The path is relative to the thread's cwd; use a path inside cwd so the
  // relative-name round-trip is short and predictable.
  const filePath = process.cwd() + '/tmp-cwd-hello.txt';
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          type: 'fileChange',
          changes: [
            {
              path: filePath,
              kind: 'update',
              diff: '@@ -1,2 +1,2 @@\n-hi\n+hello\n',
            },
          ],
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);

  const events = await done;
  const block = events.find((e) => e.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.equal(block?.content['type'], 'diff');
  assert.equal(block?.content['filename'], 'tmp-cwd-hello.txt');
  assert.ok(String(block?.content['diff']).includes('+hello'));
});

test('CodexAdapter persists the native session id from thread/start', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({ threadId: 'bridge-t1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  // Wait a tick for the adapter to receive the turn/completed
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(adapter.nativeSessionId('bridge-t1'), '019codex-thread-aaaa-bbbb-cccccccccccc');
});

test('CodexAdapter reuses the persisted thread id with thread/start on the next turn (no resume needed in the same process)', async () => {
  const { adapter, server } = setup();
  // First turn
  const { until } = collect(adapter);
  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;

  // Second turn — adapter already has the threadId in its map; expects just a turn/start
  const second = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  await new Promise<void>((resolve) => {
    server.handle((msg) => {
      if (msg.method === 'turn/start') {
        server.feed([
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { turn: { id: 'codex-turn-2' } },
          }),
        ]);
        resolve();
      }
    });
  });
  // We should NOT have seen another `thread/start` (the threadId was
  // persisted by the first turn; the second turn is just `turn/start`).
  const threadStartCount = server.sent.filter((m: any) => m.method === 'thread/start').length;
  assert.equal(threadStartCount, 1);
  const turnStart = server.sent.filter((m: any) => m.method === 'turn/start').pop() as any;
  assert.equal(turnStart.params.threadId, '019codex-thread-aaaa-bbbb-cccccccccccc');

  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await second.done;
});

test('CodexAdapter surfaces a failed turn as turn_error', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'failed', error: { message: 'no credits' } } },
    }),
  ]);

  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.equal((err?.data as { text: string }).text, 'no credits');
});

test('CodexAdapter cancelTurn sends turn/interrupt and emits turn_aborted', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  // The adapter has captured the codex threadId; `turn/start` has been sent
  // (the test's setup handler auto-replies) and the turnId is recorded on the
  // run, so cancelTurn should issue `turn/interrupt` and then turn_aborted.
  void adapter.cancelTurn('t1', 'u1');
  const events = await until((e) => e.type === 'turn_aborted');
  const aborted = events.find((e) => e.type === 'turn_aborted');
  assert.ok(aborted);
  const interrupt = server.sent.find((m: any) => m.method === 'turn/interrupt') as any;
  assert.ok(interrupt, 'adapter should have sent turn/interrupt');
  assert.equal(interrupt.params.threadId, '019codex-thread-aaaa-bbbb-cccccccccccc');
  assert.equal(interrupt.params.turnId, 'codex-turn-1');
});

test('CodexAdapter routes commandExecution requestApproval to the bridge and replies with approved', async () => {
  let approvalCall:
    | { threadId: string; toolName: string; input: Record<string, unknown> }
    | undefined;
  const { adapter, server } = setup({
    onApprovalRequest: async (threadId, info) => {
      approvalCall = { threadId, toolName: info.toolName, input: info.input };
      return 'approve';
    },
  });
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  // The app-server requests approval
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      id: 77,
      method: 'item/commandExecution/requestApproval',
      params: {
        conversationId: '019codex-thread-aaaa-bbbb-cccccccccccc',
        callId: 'call-1',
        command: ['ls', '-la'],
        cwd: 'C:/tmp',
        parsedCmd: [{ type: 'list_files', cmd: 'ls -la' }],
      },
    }),
  ]);

  // Wait for the adapter to send the reply
  await new Promise<void>((resolve) => {
    const handler = (msg: any) => {
      if (msg.id === 77) {
        // The reply to our server request
        assert.equal(msg.result?.decision, 'approved');
        resolve();
      }
    };
    server.handle(handler);
  });
  assert.equal(approvalCall?.toolName, 'codex.command');
  assert.equal(approvalCall?.input.command, 'ls -la');

  // Wrap up the turn
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await done;
});

test('CodexAdapter routes fileChange requestApproval to the bridge and replies with approved_for_session on approveSession', async () => {
  const { adapter, server } = setup({
    onApprovalRequest: async () => 'approveSession',
  });
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      id: 88,
      method: 'item/fileChange/requestApproval',
      params: {
        conversationId: '019codex-thread-aaaa-bbbb-cccccccccccc',
        callId: 'patch-1',
        fileChanges: { 'a.txt': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new\n' } },
      },
    }),
  ]);

  await new Promise<void>((resolve) => {
    const handler = (msg: any) => {
      if (msg.id === 88) {
        assert.equal(msg.result?.decision, 'approved_for_session');
        resolve();
      }
    };
    server.handle(handler);
  });
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await done;
});

test('CodexAdapter replies denied to a requestApproval when the bridge rejects', async () => {
  const { adapter, server } = setup({ onApprovalRequest: async () => 'reject' });
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'applyPatchApproval',
      params: { conversationId: 'x', callId: 'p', fileChanges: {} },
    }),
  ]);

  await new Promise<void>((resolve) => {
    const handler = (msg: any) => {
      if (msg.id === 99) {
        assert.equal(msg.result?.decision, 'denied');
        resolve();
      }
    };
    server.handle(handler);
  });
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await done;
});

test('CodexAdapter auto-denies unknown server requests (so the app-server does not hang)', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      id: 55,
      method: 'account/chatgptAuthTokens/refresh',
      params: { reason: 'expired' },
    }),
  ]);

  // The adapter replies with an error so the app-server doesn't block.
  await new Promise<void>((resolve) => {
    const handler = (msg: any) => {
      if (msg.id === 55) {
        assert.ok(msg.error);
        assert.match(String(msg.error.message), /unhandled server request/);
        resolve();
      }
    };
    server.handle(handler);
  });
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await done;
});

test('CodexAdapter maps the permission posture to the right (approvalPolicy, sandbox) pair', async () => {
  const cases = [
    { mode: 'default' as const, approvalPolicy: 'untrusted', sandbox: 'read-only' },
    { mode: 'acceptEdits' as const, approvalPolicy: 'never', sandbox: 'workspace-write' },
    { mode: 'bypassPermissions' as const, approvalPolicy: 'never', sandbox: 'danger-full-access' },
    { mode: 'interactive' as const, approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  ];
  for (const { mode, approvalPolicy, sandbox } of cases) {
    const { adapter, server } = setup({ permissionMode: mode });
    const { done, until } = collect(adapter);
    void adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'hi' });
    await waitForTurnStarted(until);
    const threadStart = server.sent.find((m: any) => m.method === 'thread/start') as any;
    assert.equal(threadStart?.params.approvalPolicy, approvalPolicy, `mode=${mode}`);
    assert.equal(threadStart?.params.sandbox, sandbox, `mode=${mode}`);
    // Wrap up the turn so the test is deterministic (await `done` per
    // iteration so previous iteration's events don't leak into the next).
    server.feed([
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      }),
    ]);
    await done;
  }
});

test('CodexAdapter emits turn_error when the app-server process dies mid-turn', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.close(1); // process dies
  const events = await done;
  const err = events.find((e) => e.type === 'turn_error');
  assert.match(String((err?.data as { text: string }).text), /app-server process exited/);
});

test('CodexAdapter maps reasoning effort to the turn/start effort field', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi', effort: 'high' });
  await waitForTurnStarted(until);
  // Find the turn/start
  const turnStart = server.sent.find((m: any) => m.method === 'turn/start') as any;
  assert.equal(turnStart.params.effort, 'high');
  // Wrap up
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await new Promise((r) => setImmediate(r));
});

test('CodexAdapter omits the effort field when no effort is set', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  const turnStart = server.sent.find((m: any) => m.method === 'turn/start') as any;
  assert.equal(turnStart.params.effort, undefined);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await new Promise((r) => setImmediate(r));
});

test('CodexAdapter maps the reasoning knob (options) to the turn/start effort field', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'hi',
    options: { reasoning: 'low' },
  });
  await waitForTurnStarted(until);
  const turnStart = server.sent.find((m: any) => m.method === 'turn/start') as any;
  assert.equal(turnStart.params.effort, 'low');
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await new Promise((r) => setImmediate(r));
});
