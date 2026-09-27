/**
 * `agentSession/*` on a real bridge: the folder's sessions with what the
 * bridge knows about each, conversations that continue one, and the holds a
 * desktop terminal takes — which keep every other client from writing into
 * the session until the terminal lets it go.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StreamNotification,
  makeRequest,
  type AgentCapabilities,
  type AgentId,
  type AgentSessionHold,
  type AgentSessionListResult,
  type NativeSessionInfo,
  type Thread,
} from '@uxnan/shared';
import {
  BaseAgentAdapter,
  InMemorySecretStore,
  startBridge,
  type Bridge,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const LOCAL = { sessionId: 'local:desktop', deviceId: 'local:desktop', local: 'desktop' };
const PHONE = { sessionId: 'relay-1', deviceId: 'phone-1' };
const CWD = '/work/app';
const NOW = Date.now();

class ListingAdapter extends BaseAgentAdapter {
  readonly capabilities = {} as AgentCapabilities;
  sessions: NativeSessionInfo[] = [];
  readonly sent: string[] = [];
  constructor(readonly agentId: AgentId) {
    super();
  }
  listNativeSessions(): Promise<NativeSessionInfo[]> {
    return Promise.resolve(this.sessions);
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(options: { threadId: string; turnId: string; text: string }): Promise<void> {
    this.sent.push(options.text);
    this.emit({ type: 'turn_started', threadId: options.threadId, turnId: options.turnId });
    this.emit({
      type: 'turn_completed',
      threadId: options.threadId,
      turnId: options.turnId,
      data: { text: 'ok' },
    });
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
}

/** An agent whose CLI cannot list its sessions (like Antigravity). */
class UnlistedAdapter extends ListingAdapter {
  declare listNativeSessions: never;
}
Object.defineProperty(UnlistedAdapter.prototype, 'listNativeSessions', { value: undefined });

async function boot(): Promise<{ bridge: Bridge; baseDir: string; claude: ListingAdapter }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'uxnan-sessions-'));
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const claude = new ListingAdapter('claude-code');
  bridge.context.agentManager.register(claude, { available: true });
  bridge.context.agentManager.register(new UnlistedAdapter('antigravity-cli'), { available: true });
  for (const id of ['codex', 'opencode', 'pi-agent', 'grok', 'zero'] as AgentId[]) {
    bridge.context.agentManager.setAvailable(id, false);
  }
  return { bridge, baseDir, claude };
}

async function call<T>(bridge: Bridge, method: string, params: unknown, session: object = PHONE) {
  return (await bridge.router.dispatch(
    makeRequest('1', method as never, params as never),
    session as never,
  )) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
}

test('the folder’s sessions: a person’s, the continued ones, never errands or others’ headless runs', async () => {
  const { bridge, baseDir, claude } = await boot();
  try {
    const continued = await bridge.context.threadStore.startThread(
      { projectId: 'p', agentId: 'claude-code', cwd: CWD, agentSessionId: 's-bridge' },
      NOW,
    );
    claude.sessions = [
      {
        sessionId: 's-tui',
        cwd: CWD,
        title: 'Payment refactor',
        updatedAt: NOW - 60_000,
        interactive: true,
      },
      {
        sessionId: 's-bridge',
        cwd: CWD,
        title: 'go on',
        updatedAt: NOW - 1_000,
        interactive: false,
      },
      { sessionId: 's-headless', cwd: CWD, title: 'x', updatedAt: NOW, interactive: false },
      {
        sessionId: 's-name',
        cwd: CWD,
        title: 'Name this conversation in 3 to 6 words, as a short title.',
        updatedAt: NOW,
        interactive: true,
      },
    ];
    // Antigravity cannot list, but a terminal holds one of its sessions here.
    await call(
      bridge,
      'agentSession/hold',
      { agentId: 'antigravity-cli', sessionId: 'agy-1', cwd: CWD },
      LOCAL,
    );

    const res = await call<AgentSessionListResult>(bridge, 'agentSession/list', { cwd: CWD });
    const list = res.result!;
    assert.deepEqual(
      list.sessions.map((s) => [
        s.agentId,
        s.sessionId,
        s.threadId ?? null,
        s.hold ? 'held' : null,
      ]),
      [
        ['antigravity-cli', 'agy-1', null, 'held'],
        ['claude-code', 's-bridge', continued.id, null],
        ['claude-code', 's-tui', null, null],
      ],
    );
    assert.ok(list.sessions.every((s) => s.updatedAgoMs >= 0 && s.cwd === CWD));
    assert.equal(list.sessions.find((s) => s.sessionId === 's-tui')?.title, 'Payment refactor');
    assert.deepEqual(list.unlisted, ['antigravity-cli']);

    const onlyClaude = await call<AgentSessionListResult>(bridge, 'agentSession/list', {
      cwd: CWD,
      agentId: 'claude-code',
    });
    assert.deepEqual(onlyClaude.result!.unlisted, []);
    assert.ok(onlyClaude.result!.sessions.every((s) => s.agentId === 'claude-code'));
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('continuing a session makes one conversation per session, and requires its agent', async () => {
  const { bridge, baseDir } = await boot();
  try {
    const start = (params: object) => call<Thread>(bridge, 'thread/start', { cwd: CWD, ...params });
    const first = await start({
      agentId: 'claude-code',
      agentSessionId: 's-tui',
      title: 'Payment refactor',
    });
    assert.equal(first.result?.agentSessionId, 's-tui');
    assert.equal(first.result?.title, 'Payment refactor');
    assert.equal(first.result?.titleSource, 'prompt');
    const again = await start({ agentId: 'claude-code', agentSessionId: 's-tui' });
    assert.equal(again.result?.id, first.result?.id);
    const noAgent = await start({ agentSessionId: 's-tui' });
    assert.equal(noAgent.error?.code, -32602);
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('a held session takes no turn here; every client hears of the hold and its end', async () => {
  const { bridge, baseDir, claude } = await boot();
  const heard: unknown[] = [];
  bridge.context.sessionRegistry.register('phone-1', {
    send: (message) => heard.push(message),
  });
  try {
    const thread = (
      await call<Thread>(bridge, 'thread/start', {
        cwd: CWD,
        agentId: 'claude-code',
        agentSessionId: 's-1',
      })
    ).result!;

    // Only the desktop, over its local channel, may hold, release or answer.
    const fromPhone = await call(bridge, 'agentSession/hold', {
      agentId: 'claude-code',
      sessionId: 's-1',
    });
    assert.equal(fromPhone.error?.code, -32001);

    const held = await call<AgentSessionHold>(
      bridge,
      'agentSession/hold',
      { agentId: 'claude-code', sessionId: 's-1', cwd: CWD, busy: false },
      LOCAL,
    );
    assert.equal(held.result?.threadId, thread.id);
    assert.equal(held.result?.holder.kind, 'terminal');

    const refused = await call(bridge, 'turn/send', { threadId: thread.id, text: 'hello' });
    assert.equal(refused.error?.code, -32010);
    assert.equal((refused.error?.data as AgentSessionHold).sessionId, 's-1');
    assert.deepEqual(claude.sent, []);

    const holds = await call<{ holds: AgentSessionHold[] }>(bridge, 'agentSession/holds', {});
    assert.equal(holds.result?.holds.length, 1);

    await call(bridge, 'agentSession/release', { agentId: 'claude-code', sessionId: 's-1' }, LOCAL);
    const sent = await call(bridge, 'turn/send', { threadId: thread.id, text: 'hello' });
    assert.equal(sent.error, undefined);

    const heldEvents = heard.filter(
      (m) => (m as { method?: string }).method === StreamNotification.AgentSessionHeld,
    ) as { params: { hold?: AgentSessionHold } }[];
    assert.deepEqual(
      heldEvents.map((m) => (m.params.hold ? 'held' : 'released')),
      ['held', 'released'],
    );
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});

test('asking for a held session reaches the desktop that holds it, and its answer comes back', async () => {
  const { bridge, baseDir } = await boot();
  const toDesktop: { method: string; params: { requestId: string; from: string } }[] = [];
  bridge.context.sessionRegistry.register('local:desktop', {
    send: (message) => toDesktop.push(message as never),
  });
  try {
    const key = { agentId: 'claude-code', sessionId: 's-2' };
    const free = await call<{ outcome: string }>(bridge, 'agentSession/requestHandoff', key);
    assert.equal(free.result?.outcome, 'notHeld');

    await call(bridge, 'agentSession/hold', { ...key, busy: true }, LOCAL);
    const busy = await call<{ outcome: string }>(bridge, 'agentSession/requestHandoff', key);
    assert.equal(busy.result?.outcome, 'busy');

    await call(bridge, 'agentSession/hold', { ...key, busy: false }, LOCAL);
    const pending = call<{ outcome: string }>(bridge, 'agentSession/requestHandoff', key);
    await new Promise((resolve) => setImmediate(resolve));
    const request = toDesktop.find(
      (m) => m.method === StreamNotification.AgentSessionHandoffRequested,
    );
    assert.ok(request, 'the holding desktop is asked');
    assert.equal(request!.params.from, 'Phone');

    const badAnswer = await call(
      bridge,
      'agentSession/handoffAnswer',
      {
        requestId: request!.params.requestId,
        outcome: 'maybe',
      },
      LOCAL,
    );
    assert.equal(badAnswer.error?.code, -32602);
    await call(
      bridge,
      'agentSession/handoffAnswer',
      { requestId: request!.params.requestId, outcome: 'released' },
      LOCAL,
    );
    assert.equal((await pending).result?.outcome, 'released');
    assert.equal(bridge.context.sessionHolds.find('claude-code', 's-2'), undefined);
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
});
