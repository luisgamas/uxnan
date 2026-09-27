/**
 * The terminals as writers of their agents' sessions: what the bridge is told
 * they hold, how a session is let go when someone asks, and how a terminal's
 * session goes on as a chat — or a chat's back into a terminal.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import type { Thread } from '$shared/models/thread';
import type { AgentSessionHold } from '$shared/models/agent-session';
import { installFakeBackend } from '../../test/tauri';
import { BridgeClientStore } from '$lib/bridge/client.svelte';
import { ChatStore } from '$lib/bridge/chat.svelte';
import { terminals, GLOBAL_WORKSPACE, type TerminalTab } from '$lib/state/terminals.svelte';
import { TerminalSessions, heldSessionOf } from '$lib/state/terminalSessions.svelte';
import type { CapturedAgentSession } from '$lib/agentResume';
import { app } from '$lib/state/app.svelte';

const settle = async () => {
  flushSync();
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function session(extra: Partial<CapturedAgentSession> = {}): CapturedAgentSession {
  return { agent: 'claude', id: 's-1', live: true, capturedAt: 1, ...extra };
}

function terminal(extra: Partial<TerminalTab> = {}): TerminalTab {
  const id = terminals.create({ cwd: '/repo', agentSession: session() });
  const tab = terminals.findTab(id) as TerminalTab;
  Object.assign(tab, extra);
  return tab;
}

/** Every terminal's shell runs. */
const running = () => true;

/** What the bridge still keeps as held when the harness starts. */
let bridgeHolds: AgentSessionHold[] = [];

function hold(sessionId: string, kind: AgentSessionHold['holder']['kind'] = 'terminal'): AgentSessionHold {
  return { agentId: 'claude-code', sessionId, holder: { kind, name: 'Mac' }, heldAgoMs: 0, busy: false };
}

function harness() {
  const client = new BridgeClientStore();
  client.status = { state: 'connected' } as BridgeClientStore['status'];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  client.call = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'agent/holds') return { holds: bridgeHolds } as never;
    calls.push({ method, params: params as Record<string, unknown> });
    if (method === 'thread/start') {
      return { id: 'th-1', projectId: 'p', title: 't', status: 'active', turnCount: 0, createdAt: 1, updatedAt: 1 } as never;
    }
    return {} as never;
  }) as BridgeClientStore['call'];
  const chatStore = new ChatStore(client);
  const stopped: string[] = [];
  const sessions = new TerminalSessions({
    client,
    chatStore,
    stopAgent: async (tabId) => {
      stopped.push(tabId);
    },
    ptyRunning: running,
  });
  return { client, chatStore, calls, stopped, sessions };
}

beforeEach(() => {
  bridgeHolds = [];
  installFakeBackend();
  terminals.root = null;
  terminals.setWorkspace(GLOBAL_WORKSPACE);
});

describe('which sessions the terminals hold', () => {
  it('a live local terminal whose agent the bridge drives, with a session it wrote', () => {
    const tab = terminal();
    expect(heldSessionOf(tab, running)).toEqual({
      agentId: 'claude-code',
      sessionId: 's-1',
      cwd: '/repo',
      busy: false,
      tabId: tab.id,
    });
    tab.working = true;
    expect(heldSessionOf(tab, running)?.busy).toBe(true);
  });

  it('not a session nothing was said to, an exited agent, a remote or sleeping tab, or another CLI', () => {
    expect(heldSessionOf(terminal({ agentSession: session({ pending: true }) }), running)).toBeNull();
    expect(heldSessionOf(terminal({ agentSession: session({ live: false }) }), running)).toBeNull();
    expect(heldSessionOf(terminal({ target: 'ssh:box' }), running)).toBeNull();
    expect(heldSessionOf(terminal({ asleep: true }), running)).toBeNull();
    expect(heldSessionOf(terminal({ exited: true }), running)).toBeNull();
    expect(heldSessionOf(terminal({ agentSession: session({ agent: 'goose' }) }), running)).toBeNull();
  });

  // A tab restored from the saved layout keeps its session's `live` flag, but
  // nothing runs in it until its workspace is shown: it holds nothing yet.
  it('not a restored tab whose shell is not running', () => {
    const tab = terminal();
    expect(heldSessionOf(tab, () => false)).toBeNull();
    expect(heldSessionOf(tab)).toBeNull();
  });
});

describe('telling the bridge', () => {
  it('holds what a tab opens, updates it when the agent works, releases it when it exits', async () => {
    const { calls, sessions } = harness();
    const tab = terminal();
    sessions.start();
    await settle();
    expect(calls.map((c) => c.method)).toEqual(['agent/hold']);
    expect(calls[0]!.params).toMatchObject({ agentId: 'claude-code', sessionId: 's-1', cwd: '/repo', busy: false });

    tab.working = true;
    terminals.workspaces = { ...terminals.workspaces };
    await settle();
    expect(calls.at(-1)).toMatchObject({ method: 'agent/hold', params: { busy: true } });

    terminals.noteAgentLiveness(tab.id, false);
    await settle();
    expect(calls.at(-1)).toMatchObject({
      method: 'agent/release',
      params: { agentId: 'claude-code', sessionId: 's-1' },
    });
  });

  // The real order: the agent is launched with an id we named (`pending`),
  // and its hook reports the session afterwards.
  it('holds a session its hook reports after the tab opened', async () => {
    const { calls, sessions } = harness();
    const tab = terminal({ agentSession: session({ pending: true }) });
    sessions.start();
    await settle();
    expect(calls).toEqual([]);
    terminals.recordAgentSession(tab.id, 'claude', { id: 's-7', capturedAt: 2 });
    await settle();
    expect(calls.at(-1)).toMatchObject({
      method: 'agent/hold',
      params: { agentId: 'claude-code', sessionId: 's-7' },
    });
  });

  // A restored tab's shell starts when its workspace is shown; after a reload
  // of the window, the tab re-attaches to its running shell.
  it('holds a restored tab’s session once its shell runs', async () => {
    const shells = new SvelteSet<string>();
    const client = new BridgeClientStore();
    client.status = { state: 'connected' } as BridgeClientStore['status'];
    const calls: string[] = [];
    client.call = vi.fn(async (method: string) => {
      if (method === 'agent/holds') return { holds: [] } as never;
      calls.push(method);
      return {} as never;
    }) as BridgeClientStore['call'];
    const sessions = new TerminalSessions({
      client,
      chatStore: new ChatStore(client),
      stopAgent: async () => undefined,
      ptyRunning: (id) => shells.has(id),
    });
    const tab = terminal();
    sessions.start();
    await settle();
    expect(calls).toEqual([]);
    expect(sessions.continueAsChatState(tab)).toBe('ready');
    shells.add(tab.id);
    await settle();
    expect(calls).toEqual(['agent/hold']);
  });

  // The bridge keeps a desktop's holds for its connection, which outlives a
  // reload of the window: what no tab holds any more is let go on start.
  it('lets go of what the bridge still keeps that no tab holds', async () => {
    terminal();
    bridgeHolds = [hold('s-1'), hold('s-stale')];
    const { calls, sessions } = harness();
    sessions.start();
    await settle();
    await settle();
    expect(calls.filter((c) => c.method === 'agent/release').map((c) => c.params.sessionId)).toEqual([
      's-stale',
    ]);
  });

  it('says everything again after a reconnect (the bridge dropped it)', async () => {
    const { client, calls, sessions } = harness();
    terminal();
    sessions.start();
    await settle();
    client.status = { state: 'connecting' } as BridgeClientStore['status'];
    client.applyStatus({ state: 'connected' } as BridgeClientStore['status']);
    await settle();
    expect(calls.filter((c) => c.method === 'agent/hold')).toHaveLength(2);
  });
});

describe('letting a session go', () => {
  it('when asked and the agent is idle: close it, release, answer released', async () => {
    const { client, calls, stopped, sessions } = harness();
    const tab = terminal();
    sessions.start();
    await settle();
    client.dispatch({
      method: 'stream/agent/handoffRequested',
      params: { agentId: 'claude-code', sessionId: 's-1', requestId: 'r-1', from: 'Pixel' },
    });
    await settle();
    await settle();
    expect(stopped).toEqual([tab.id]);
    expect(tab.agentSession?.live).toBe(false);
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('agent/release');
    expect(calls.at(-1)).toMatchObject({
      method: 'agent/handoffAnswer',
      params: { requestId: 'r-1', outcome: 'released' },
    });
  });

  it('when asked while the agent works: nothing is closed, the answer is busy', async () => {
    const { client, calls, stopped, sessions } = harness();
    terminal({ working: true });
    sessions.start();
    await settle();
    client.dispatch({
      method: 'stream/agent/handoffRequested',
      params: { agentId: 'claude-code', sessionId: 's-1', requestId: 'r-2', from: 'Pixel' },
    });
    await settle();
    expect(stopped).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ params: { requestId: 'r-2', outcome: 'busy' } });
  });
});

describe('terminal ⇄ chat', () => {
  it('continue as chat: the agent is closed, then a conversation continues its session', async () => {
    const { calls, stopped, sessions } = harness();
    const tab = terminal({ customTitle: 'Payment refactor' });
    expect(sessions.continueAsChatState(tab)).toBe('ready');
    await sessions.continueAsChat(tab.id);
    expect(stopped).toEqual([tab.id]);
    const start = calls.find((c) => c.method === 'thread/start');
    expect(start?.params).toMatchObject({
      agentId: 'claude-code',
      cwd: '/repo',
      agentSessionId: 's-1',
      title: 'Payment refactor',
    });
    const opened = [...terminals.tabsWithWorkspace()].find(({ tab: t }) => t.kind === 'chat');
    expect(opened?.tab).toMatchObject({ kind: 'chat', threadId: 'th-1' });
  });

  it('never under a working agent, and an exited one still leaves its session to continue', async () => {
    const { sessions, stopped } = harness();
    const busy = terminal({ working: true });
    expect(sessions.continueAsChatState(busy)).toBe('busy');
    await sessions.continueAsChat(busy.id);
    expect(stopped).toEqual([]);
    const exited = terminal({ agentSession: session({ live: false }) });
    expect(sessions.continueAsChatState(exited)).toBe('ready');
    expect(sessions.continueAsChatState(terminal({ agentSession: session({ pending: true }) }))).toBe('unavailable');
    expect(sessions.continueAsChatState(terminal({ agentSession: session({ agent: 'goose' }) }))).toBe(
      'unavailable',
    );
  });

  it('open in terminal: only a resumable session, not while the agent works or a terminal holds it', () => {
    const { chatStore, sessions } = harness();
    const thread = (extra: Partial<Thread>): Thread => ({
      id: 'th-9',
      projectId: 'p',
      title: 't',
      status: 'active',
      turnCount: 1,
      createdAt: 1,
      updatedAt: 1,
      cwd: '/repo',
      agentId: 'claude-code',
      agentSessionId: 's-9',
      ...extra,
    });
    expect(sessions.openInTerminalState(thread({}))).toBe('ready');
    expect(sessions.openInTerminalState(thread({ agentId: 'zero' }))).toBe('unavailable');
    expect(sessions.openInTerminalState(thread({ agentSessionId: undefined }))).toBe('unavailable');
    chatStore.apply({
      method: 'stream/agent/held',
      params: {
        agentId: 'claude-code',
        sessionId: 's-9',
        hold: { agentId: 'claude-code', sessionId: 's-9', holder: { kind: 'terminal', name: 'Mac' }, heldAgoMs: 0, busy: false },
      },
    });
    expect(sessions.openInTerminalState(thread({}))).toBe('unavailable');
  });

  it('open in terminal: the agent’s own profile reopens the session, and the tab carries it', () => {
    const { sessions } = harness();
    app.settings.agentProfiles = [{ id: 'cc', name: 'Claude', command: 'claude', args: ['--model', 'opus'], env: [] }];
    const opened = sessions.openInTerminal({
      id: 'th-9',
      projectId: 'p',
      title: 'Payment refactor',
      status: 'active',
      turnCount: 1,
      createdAt: 1,
      updatedAt: 1,
      cwd: '/repo',
      agentId: 'claude-code',
      agentSessionId: 's-9',
    });
    expect(opened).toBe(true);
    const tab = [...terminals.tabsWithWorkspace()]
      .map(({ tab: t }) => t)
      .find((t): t is TerminalTab => t.kind === 'terminal' && t.agentSession?.id === 's-9');
    expect(tab?.runCommand).toContain('--resume s-9');
    expect(tab?.runCommand).toContain('--model opus');
    expect(tab?.runCommand).not.toContain('--session-id');
    expect(tab?.agentSession).toMatchObject({ agent: 'claude', id: 's-9', live: true, pending: false });
  });
});
