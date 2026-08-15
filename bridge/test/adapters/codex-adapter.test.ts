import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import {
  CodexAdapter,
  codexUsageTokens,
  parseCodexConfigModels,
  parseCodexModelList,
  parseCodexModelWindows,
  parseCodexReasoning,
  type SpawnFn,
  type SpawnedAppServer,
  type SpawnedProcess,
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
// The adapter ends its app-server whenever no turn is in flight (that is how a
// Codex thread is handed back to the Codex app), so `spawn()` mints a FRESH
// stdio pair per process, exactly like the real CLI. `sent`, the handler list
// and `feed()` follow the CURRENT process, so multi-turn tests read as before.
class FakeAppServer {
  private connections: FakeConnection[] = [];
  /** Handlers are called in install-order; each one may act and pass through. */
  private handlers: Array<(msg: any) => void> = [];
  /** Captures every JSON line written to stdin (across processes), for assertions. */
  readonly sent: unknown[] = [];

  constructor() {
    this.#open();
  }

  /** How many app-server processes the adapter has spawned so far. */
  get spawnCount(): number {
    return this.connections.length;
  }

  get stdin(): PassThrough {
    return this.#current.stdin;
  }

  get stdout(): PassThrough {
    return this.#current.stdout;
  }

  get #current(): FakeConnection {
    return this.connections[this.connections.length - 1]!;
  }

  #open(): void {
    const connection: FakeConnection = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      closeCallbacks: [],
    };
    let buffer = '';
    connection.stdin.on('data', (chunk: Buffer) => {
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
    this.connections.push(connection);
  }

  /** Drive incoming messages (into the current process's stdout). */
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

  /** Simulate the current process exiting. */
  close(code: number | null = 0): void {
    const connection = this.#current;
    for (const cb of connection.closeCallbacks) cb(code);
    connection.stdout.end();
  }

  /** Adapter-facing factory: a NEW process (fresh stdio) after each exit. */
  spawn(): SpawnedAppServer {
    if (this.#current.stdout.writableEnded) this.#open();
    const connection = this.#current;
    return {
      stdin: connection.stdin,
      stdout: connection.stdout,
      onClose: (cb) => connection.closeCallbacks.push(cb),
      kill: () => {
        for (const cb of connection.closeCallbacks) cb(0);
        connection.stdout.end();
      },
    };
  }
}

interface FakeConnection {
  stdin: PassThrough;
  stdout: PassThrough;
  closeCallbacks: ((code: number | null) => void)[];
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
    /** Make every `thread/resume` fail with this message (see the handover tests). */
    resumeError?: string;
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
    } else if (msg.method === 'thread/resume' && options.resumeError) {
      // A real app-server refuses to hand over a thread another client holds,
      // and reports a deleted rollout the same way.
      server.feed([
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32600, message: options.resumeError },
        }),
      ]);
    } else if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
      server.feed([
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: THREAD_ID } } }),
      ]);
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

// ============================================================================
// Mid-turn delivery (steering) — the app-server's own `turn/steer`.
// Implemented against the published protocol schema (codex-cli 0.146.0):
// `turn/steer { threadId, expectedTurnId, input }`. NOT yet exercised against a
// live Codex turn — the account had 0 credits when this landed.
// ============================================================================

test('steerTurn sends turn/steer with the running turn as the precondition', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  let steered: any;
  server.handle((msg: any) => {
    if (msg.method === 'turn/steer') {
      steered = msg;
      server.feed([
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turnId: 'codex-turn-1' } }),
      ]);
    }
  });

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  await waitForTurnStarted(until);
  // `turn/start` must have come back before a steer can name its turn.
  await new Promise((r) => setTimeout(r, 20));

  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'actually, do this instead',
  });

  assert.equal(taken, true);
  assert.equal(steered?.params.expectedTurnId, 'codex-turn-1');
  assert.deepEqual(steered?.params.input, [{ type: 'text', text: 'actually, do this instead' }]);
  // No second turn was opened — this is a message inside the running one.
  const starts = server.sent.filter((m: any) => m.method === 'turn/start');
  assert.equal(starts.length, 1);
});

test('a rejected precondition is reported as not taken, never as an error', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  server.handle((msg: any) => {
    if (msg.method === 'turn/steer') {
      // What the app-server answers when `expectedTurnId` is no longer active.
      server.feed([
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: 'turn is not active' },
        }),
      ]);
    }
  });

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  await waitForTurnStarted(until);
  await new Promise((r) => setTimeout(r, 20));

  const taken = await adapter.steerTurn({
    threadId: 't1',
    turnId: 'u2',
    activeTurnId: 'u1',
    text: 'too late',
  });
  // The bridge leaves it queued and runs it next; nothing is lost.
  assert.equal(taken, false);
});

test('steerTurn declines for an unknown turn or a mismatched thread', async () => {
  const { adapter } = setup();
  const { until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'first' });
  await waitForTurnStarted(until);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(
    await adapter.steerTurn({ threadId: 't1', turnId: 'u2', activeTurnId: 'nope', text: 'x' }),
    false,
  );
  assert.equal(
    await adapter.steerTurn({ threadId: 'other', turnId: 'u2', activeTurnId: 'u1', text: 'x' }),
    false,
  );
});

test('CodexAdapter advertises steering', () => {
  const { adapter } = setup();
  assert.equal(adapter.capabilities.steering, true);
});

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
  assert.equal(parseCodexReasoning([{ reasoningEffort: 'low' }], 'bogus')[0]?.default, undefined);
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

test('codexUsageTokens reads the thread total, not this turn alone', () => {
  // Captured from a live `codex app-server` `thread/tokenUsage/updated`. The
  // meter shows the THREAD's context, so `total` wins over `last`; totalTokens
  // is Codex's own sum, so cachedInputTokens must not be added on top.
  assert.equal(
    codexUsageTokens({
      total: {
        totalTokens: 17770,
        inputTokens: 17765,
        cachedInputTokens: 9984,
        cacheWriteInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
      },
      last: { totalTokens: 120 },
      modelContextWindow: 258400,
    }),
    17770,
  );
  assert.equal(codexUsageTokens({}), undefined);
  assert.equal(codexUsageTokens('nope'), undefined);
  // The old shape was the ROLLOUT file's, never the app-server's: a turn that
  // reports nothing usable must leave the card's context alone.
  assert.equal(codexUsageTokens({ input_tokens: 13334, output_tokens: 15 }), undefined);
});

test('parseCodexModelWindows maps slug → context_window from models_cache.json', () => {
  // shape of the real ~/.codex/models_cache.json (verified against codex 0.141)
  const raw = JSON.stringify({
    fetched_at: '2026-06-20T01:09:52Z',
    models: [
      { slug: 'gpt-5.5', display_name: 'GPT-5.5', context_window: 272000 },
      { slug: 'gpt-5.4', context_window: 272000, max_context_window: 1000000 },
      { slug: 'no-window', display_name: 'No Window' },
      { slug: 'zero', context_window: 0 },
    ],
  });
  const windows = parseCodexModelWindows(raw);
  assert.equal(windows.get('gpt-5.5'), 272000);
  assert.equal(windows.get('gpt-5.4'), 272000);
  assert.equal(windows.has('no-window'), false);
  assert.equal(windows.has('zero'), false);
  assert.equal(parseCodexModelWindows('not json').size, 0);
  assert.equal(parseCodexModelWindows('{}').size, 0);
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
    // Usage arrives on its OWN notification — a live app-server's
    // `turn/completed` carries none, which is why Codex used to show no
    // context at all.
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'thread/tokenUsage/updated',
      params: {
        turnId: 'codex-turn-1',
        tokenUsage: {
          total: { totalTokens: 12, inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 },
          last: { totalTokens: 12 },
          modelContextWindow: 258400,
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { id: 'codex-turn-1', status: 'completed' } },
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
  const usage = (completed?.data as { usage?: { tokens: number; contextWindow?: number } }).usage;
  assert.equal(usage?.tokens, 12);
  // The window rides on the same notification, so no model-cache lookup needed.
  assert.equal(usage?.contextWindow, 258400);

  // Handshake — initialize, then thread/start (no resume), then turn/start
  const methods = server.sent.map((m: any) => m.method);
  assert.deepEqual(methods.slice(0, 3), ['initialize', 'thread/start', 'turn/start']);
  const threadStart = server.sent[1] as any;
  assert.equal(threadStart.params.cwd, process.cwd());
  assert.equal(threadStart.params.model, 'gpt-5.4-mini');
  // A person started this from their phone, so Codex classifies it like any
  // other human-started thread (its own clients all set this).
  assert.equal(threadStart.params.threadSource, 'user');
  // Default permission mode is `interactive` → approvalPolicy on-request, sandbox workspace-write
  assert.equal(threadStart.params.approvalPolicy, 'on-request');
  assert.equal(threadStart.params.sandbox, 'workspace-write');
});

test('CodexAdapter preserves commentary and final assistant items with boundaries', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'do it' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { itemId: 'msg-1', delta: 'I am checking.' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          phase: 'commentary',
          text: 'I am checking.',
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { itemId: 'msg-2', delta: 'Everything is done.' },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          id: 'msg-2',
          type: 'agentMessage',
          phase: 'final_answer',
          text: 'Everything is done.',
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
  assert.deepEqual(
    events.filter((event) => event.type === 'delta').map((event) => (event.data as any).text),
    ['I am checking.', 'Everything is done.'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'block').map((event) => (event.data as any).content),
    [
      { type: 'assistant_response_boundary', phase: 'commentary', itemId: 'msg-1' },
      { type: 'assistant_response_boundary', phase: 'final_answer', itemId: 'msg-2' },
    ],
  );
  assert.equal(
    (events.find((event) => event.type === 'turn_completed')?.data as { text: string }).text,
    'I am checking.Everything is done.',
  );
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

test('CodexAdapter maps contextCompaction to a compaction block', async () => {
  const { adapter, server } = setup();
  const { done, until } = collect(adapter);

  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi' });
  await waitForTurnStarted(until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: { item: { type: 'contextCompaction' } },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);

  const events = await done;
  const block = events.find((event) => event.type === 'block')?.data as
    | { content: Record<string, unknown> }
    | undefined;
  assert.deepEqual(block?.content, { type: 'compaction', reason: 'unknown' });
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

// ============================================================================
// Thread handover — Codex allows ONE writer per thread and holds it for as long
// as the thread is loaded in a process, so the bridge ends its app-server as
// soon as no turn is in flight and re-attaches with `thread/resume` on the next
// one. Without that, the phone's conversation cannot be opened in Codex Desktop
// or `codex resume` at all ("already has an active writer").
// ============================================================================

test('CodexAdapter releases the app-server when the turn ends and resumes the same thread on the next one', async () => {
  const { adapter, server } = setup();
  const { until } = collect(adapter);
  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(until);
  assert.equal(server.spawnCount, 1);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;
  // The turn is over → the process is gone, so no thread is held any more.
  assert.equal(server.stdout.writableEnded, true);

  // Second turn — a fresh process, re-attached to the SAME Codex thread.
  const second = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  await waitForTurnStarted(second.until);
  assert.equal(server.spawnCount, 2);
  // One `thread/start` in total (the first turn); the second turn resumed.
  assert.equal(server.sent.filter((m: any) => m.method === 'thread/start').length, 1);
  const resume = server.sent.filter((m: any) => m.method === 'thread/resume').pop() as any;
  assert.equal(resume.params.threadId, '019codex-thread-aaaa-bbbb-cccccccccccc');
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

test('CodexAdapter says who holds the conversation when another Codex client owns the thread', async () => {
  const { adapter, server } = setup({
    resumeError: 'thread 019codex-thread-aaaa-bbbb-cccccccccccc already has an active writer',
  });
  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(first.until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;

  // The Codex app opened the conversation while the phone was idle, so the
  // app-server rejects the bridge's `thread/resume` (see `resumeError` above).
  const second = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  const events = await second.until((e) => e.type === 'turn_error');
  const error = events.find((e) => e.type === 'turn_error');
  const text = (error?.data as { text: string }).text;
  assert.match(text, /open in another Codex client/i);
  // No turn was started against a thread we do not own.
  assert.equal(server.sent.filter((m: any) => m.method === 'turn/start').length, 1);
});

test('CodexAdapter starts a fresh Codex thread when the rollout is gone', async () => {
  // The session was deleted from another Codex client between turns.
  const { adapter, server } = setup({ resumeError: 'no rollout found for thread id …' });
  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(first.until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;

  const second = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two' });
  await waitForTurnStarted(second.until);
  // The conversation continues in a new Codex thread rather than dead-ending.
  assert.equal(server.sent.filter((m: any) => m.method === 'thread/start').length, 2);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await second.done;
});

test('CodexAdapter releases the app-server after a catastrophic app-server error', async () => {
  const { adapter, server } = setup();
  const run = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(run.until);
  // Register the waiter BEFORE feeding: the fake server delivers a line
  // synchronously, so a waiter added afterwards would never see the event.
  const errored = run.until((e) => e.type === 'turn_error');
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'error',
      params: { message: 'context window exceeded' },
    }),
  ]);
  const events = await errored;
  assert.equal(
    (events.find((e) => e.type === 'turn_error')?.data as { text: string }).text,
    'context window exceeded',
  );
  // The turn is over for the bridge, so the thread must not stay held here.
  assert.equal(server.stdout.writableEnded, true);
});

test('CodexAdapter resumes a thread adopted after a bridge restart instead of starting a new one', async () => {
  const { adapter, server } = setup();
  // A fresh process (empty map) is handed the id the bridge persisted before.
  adapter.adoptNativeSession('t1', '019codex-thread-aaaa-bbbb-cccccccccccc');
  assert.equal(adapter.nativeSessionId('t1'), '019codex-thread-aaaa-bbbb-cccccccccccc');

  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(first.until);
  assert.equal(server.sent.filter((m: any) => m.method === 'thread/start').length, 0);
  const resume = server.sent.filter((m: any) => m.method === 'thread/resume').pop() as any;
  assert.equal(resume.params.threadId, '019codex-thread-aaaa-bbbb-cccccccccccc');
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;
});

test('CodexAdapter mirrors the conversation name onto the Codex thread', async () => {
  const { adapter, server } = setup();
  const first = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'one' });
  await waitForTurnStarted(first.until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;

  server.handle((msg: any) => {
    if (msg.method === 'thread/name/set') {
      server.feed([JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })]);
    }
  });
  await adapter.setNativeTitle('t1', 'Fix the pairing timeout');
  const named = server.sent.filter((m: any) => m.method === 'thread/name/set').pop() as any;
  assert.equal(named.params.threadId, '019codex-thread-aaaa-bbbb-cccccccccccc');
  assert.equal(named.params.name, 'Fix the pairing timeout');
  // Naming must not leave the thread held (it runs between turns).
  assert.equal(server.stdout.writableEnded, true);
});

test('CodexAdapter re-applies the thread access mode on every resume', async () => {
  const { adapter, server } = setup();
  const first = collect(adapter);
  void adapter.sendTurn({
    threadId: 't1',
    turnId: 'u1',
    text: 'one',
    accessMode: 'requestApproval',
  });
  await waitForTurnStarted(first.until);
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await first.done;

  const second = collect(adapter);
  void adapter.sendTurn({ threadId: 't1', turnId: 'u2', text: 'two', accessMode: 'fullAccess' });
  await waitForTurnStarted(second.until);
  const resume = server.sent.filter((m: any) => m.method === 'thread/resume').pop() as any;
  // `fullAccess` → danger-full-access, applied from this turn on (verified live
  // against codex-cli 0.147.0: the rollout's `turn_context` carries the new pair).
  assert.equal(resume.params.approvalPolicy, 'never');
  assert.equal(resume.params.sandbox, 'danger-full-access');
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

test('CodexAdapter: the thread access mode overrides the configured posture on thread/start', async () => {
  // Configured posture is `default` (untrusted/read-only); the per-thread
  // accessMode chosen on the phone must win for that thread's first turn.
  const cases = [
    {
      accessMode: 'requestApproval' as const,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    },
    { accessMode: 'approveForMe' as const, approvalPolicy: 'never', sandbox: 'workspace-write' },
    {
      accessMode: 'fullAccess' as const,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    },
  ];
  for (const { accessMode, approvalPolicy, sandbox } of cases) {
    const { adapter, server } = setup({ permissionMode: 'default' });
    const { done, until } = collect(adapter);
    void adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'hi', accessMode });
    await waitForTurnStarted(until);
    const threadStart = server.sent.find((m: any) => m.method === 'thread/start') as any;
    assert.equal(threadStart?.params.approvalPolicy, approvalPolicy, `accessMode=${accessMode}`);
    assert.equal(threadStart?.params.sandbox, sandbox, `accessMode=${accessMode}`);
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

test('CodexAdapter: no accessMode keeps the configured posture on thread/start', async () => {
  const { adapter, server } = setup({ permissionMode: 'default' });
  const { done, until } = collect(adapter);
  void adapter.sendTurn({ threadId: 't', turnId: 'u', text: 'hi' });
  await waitForTurnStarted(until);
  const threadStart = server.sent.find((m: any) => m.method === 'thread/start') as any;
  assert.equal(threadStart?.params.approvalPolicy, 'untrusted');
  assert.equal(threadStart?.params.sandbox, 'read-only');
  server.feed([
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    }),
  ]);
  await done;
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

test('CodexAdapter names a conversation on the cheapest model, at the lowest effort', async () => {
  // `generateTitle` never touches the app-server: it is a one-shot `codex exec`
  // whose final message lands in the `-o` file.
  let captured: string[] = [];
  const adapter = new CodexAdapter({
    binaryPath: 'codex',
    spawnFn: ((_command: string, args: string[]) => {
      captured = args;
      const stdout = new PassThrough();
      const emitter = new EventEmitter();
      stdout.on('end', () => emitter.emit('close', 0));
      // The real CLI writes the title to the file it was pointed at.
      void writeFile(args[args.indexOf('-o') + 1]!, 'Fix the model list\n', 'utf8').then(() =>
        stdout.end(),
      );
      return {
        stdout,
        stderr: new PassThrough(),
        on: (event: string, listener: (...a: unknown[]) => void) => emitter.on(event, listener),
        kill: () => emitter.emit('close', 0),
      } as unknown as SpawnedProcess;
    }) as unknown as SpawnFn,
  });

  assert.equal(
    await adapter.generateTitle({ userText: 'hi', assistantText: 'ok', cwd: process.cwd() }),
    'Fix the model list',
  );
  // The cheap model, never the thread's own.
  assert.equal(captured[captured.indexOf('-m') + 1], 'gpt-5.6-luna');
  // Pinned explicitly: Luna's own default effort is `medium`, and reasoning
  // tokens are what would make the cheap model cost more than the mini tier.
  assert.equal(captured[captured.indexOf('-c') + 1], 'model_reasoning_effort=low');
  // Ephemeral + read-only: naming must not write a session or touch the repo.
  assert.equal(captured.includes('--ephemeral'), true);
  assert.equal(captured[captured.indexOf('-s') + 1], 'read-only');
});
