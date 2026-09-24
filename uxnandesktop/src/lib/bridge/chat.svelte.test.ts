/**
 * The desktop's copy of the bridge's conversations: the list every client
 * converges on, and the actions a chat tab takes on a thread.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '$shared/models/thread';
import { BridgeClientStore } from './client.svelte';
import { ChatStore, normalizeCwd, provisionalTitle } from './chat.svelte';
import { bridgeAgentForCommand, bridgeAgentLogo, isUserFacingAgent } from './agents';

function thread(id: string, cwd: string, updatedAt: number, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: 'p',
    title: id,
    status: 'active',
    turnCount: 0,
    createdAt: 1,
    updatedAt,
    cwd,
    agentId: 'claude-code',
    ...extra,
  };
}

/** A chat store over a client whose `call` is a scripted fake. */
function harness(responses: Record<string, unknown> = {}) {
  const client = new BridgeClientStore();
  const calls: { method: string; params: unknown }[] = [];
  client.call = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method in responses) return responses[method] as never;
    return {} as never;
  }) as BridgeClientStore['call'];
  const store = new ChatStore(client);
  return { client, store, calls };
}

describe('ChatStore', () => {
  it('lists the threads of one folder, newest first and archived last', async () => {
    const { store } = harness({
      'thread/list': {
        threads: [
          thread('old', '/repo', 1),
          thread('new', '/repo/', 5),
          thread('gone', '/repo', 9, { status: 'archived' }),
          thread('elsewhere', '/other', 7),
        ],
      },
    });
    await store.loadThreads();
    expect(store.threadsFor('/repo').map((t) => t.id)).toEqual(['new', 'old', 'gone']);
    expect(store.threadsFor('C:\\repo').map((t) => t.id)).toEqual([]);
  });

  it('adopts threads created, renamed and deleted by another client', () => {
    const { store } = harness();
    store.apply({ method: 'stream/thread/updated', params: { thread: thread('p1', '/repo', 3) } });
    expect(store.threads.get('p1')?.title).toBe('p1');
    store.apply({
      method: 'stream/thread/updated',
      params: { thread: thread('p1', '/repo', 4, { title: 'Named on the phone' }) },
    });
    expect(store.threads.get('p1')?.title).toBe('Named on the phone');
    store.apply({ method: 'stream/thread/deleted', params: { threadId: 'p1' } });
    expect(store.threads.has('p1')).toBe(false);
  });

  it('routes timeline notifications to the open conversation only', () => {
    const { store } = harness();
    const open = store.conversation('t1');
    store.apply({
      method: 'stream/queue/updated',
      params: { threadId: 't1', queuedTurnIds: ['q'], paused: false },
    });
    store.apply({
      method: 'stream/queue/updated',
      params: { threadId: 'not-open', queuedTurnIds: ['z'], paused: true },
    });
    expect(open.queue.turnIds).toEqual(['q']);
  });

  it('starts a thread in a folder with a fixed agent and the phone-default access', async () => {
    const { store, calls } = harness({
      'project/resolve': { id: 'proj_1', name: 'repo', cwd: '/repo' },
      'thread/start': thread('new', '/repo', 1),
    });
    const started = await store.startThread({ cwd: '/repo', agentId: 'codex', model: 'gpt-5' });
    expect(started.id).toBe('new');
    expect(calls[0]).toEqual({ method: 'project/resolve', params: { cwd: '/repo' } });
    expect(calls[1]).toEqual({
      method: 'thread/start',
      params: { projectId: 'proj_1', agentId: 'codex', cwd: '/repo', model: 'gpt-5' },
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'thread/setAccessMode')).toBe(true),
    );
    expect(store.threads.has('new')).toBe(true);
  });

  it('sends with an echo id and titles a new thread from its first message', async () => {
    const { store, calls } = harness();
    const conversation = store.conversation('t1');
    conversation.loaded = true;
    await store.send('t1', '  fix the flaky test  ', { options: { reasoning: 'high' } });
    const send = calls.find((c) => c.method === 'turn/send');
    const params = send?.params as { clientTurnId: string; text: string; options: unknown };
    expect(params.text).toBe('fix the flaky test');
    expect(params.options).toEqual({ reasoning: 'high' });
    expect(conversation.pending.map((p) => p.clientTurnId)).toEqual([params.clientTurnId]);
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'thread/rename')?.params).toEqual({
        threadId: 't1',
        title: 'fix the flaky test',
        source: 'prompt',
      }),
    );
  });

  it('keeps a failed send on screen with the reason', async () => {
    const { store, client } = harness();
    client.call = vi.fn(async () => {
      throw new Error('thread not found');
    }) as BridgeClientStore['call'];
    await store.send('t1', 'hello');
    expect(store.conversation('t1').pending[0]?.error).toBe('thread not found');
  });

  it('answers an approval at once and tells the bridge', async () => {
    const { store, calls } = harness();
    await store.answerApproval('t1', 'ap', 'approve');
    expect(store.conversation('t1').approvals.ap?.decision).toBe('approve');
    expect(calls.at(-1)).toEqual({
      method: 'turn/send',
      params: { threadId: 't1', approvalResponse: { approvalId: 'ap', decision: 'approve' } },
    });
  });

  it('hides the development echo agent and deprecated ones', async () => {
    const { store } = harness({
      'agent/list': {
        agents: [
          { agentId: 'echo', displayName: 'Echo', available: true },
          { agentId: 'codex', displayName: 'Codex', available: true },
          { agentId: 'opencode', displayName: 'OpenCode', available: false, deprecated: true },
        ],
      },
    });
    await store.loadAgents();
    expect(store.agents.map((a) => a.agentId)).toEqual(['codex']);
  });

  it('caches models per agent', async () => {
    const { store, calls } = harness({ 'agent/models': { models: [{ id: 'opus', displayName: 'Opus' }] } });
    await store.modelsFor('claude-code');
    await store.modelsFor('claude-code');
    expect(calls.filter((c) => c.method === 'agent/models')).toHaveLength(1);
    expect(store.cachedModels('claude-code').map((m) => m.id)).toEqual(['opus']);
  });
});

describe('helpers', () => {
  it('titles like the phone and the bridge do', () => {
    expect(provisionalTitle('  a   b\nc ')).toBe('a b c');
    const long = provisionalTitle('x'.repeat(100));
    expect(long).toHaveLength(72);
    expect(long.endsWith('…')).toBe(true);
  });

  it('compares folders in one spelling', () => {
    expect(normalizeCwd('C:\\repo\\')).toBe('C:/repo');
    expect(normalizeCwd('/repo//')).toBe('/repo');
  });

  it('maps bridge agent ids to the desktop catalog marks', () => {
    expect(bridgeAgentLogo('claude-code')).toBe('claudecode');
    expect(bridgeAgentLogo('pi-agent')).toBe('pi');
    expect(bridgeAgentLogo('antigravity-cli')).toBe('antigravity');
    expect(bridgeAgentLogo('echo')).toBeNull();
    expect(bridgeAgentLogo('unknown')).toBeNull();
    expect(bridgeAgentLogo(undefined)).toBeNull();
    expect(isUserFacingAgent('echo')).toBe(false);
    expect(isUserFacingAgent('grok')).toBe(true);
  });

  it('maps a desktop agent profile to the bridge agent that drives the same CLI', () => {
    expect(bridgeAgentForCommand('claude')).toBe('claude-code');
    expect(bridgeAgentForCommand('C:\\tools\\codex.cmd')).toBe('codex');
    expect(bridgeAgentForCommand('/usr/local/bin/agy')).toBe('antigravity-cli');
    expect(bridgeAgentForCommand('aider')).toBeNull();
    expect(bridgeAgentForCommand(undefined)).toBeNull();
  });
});
