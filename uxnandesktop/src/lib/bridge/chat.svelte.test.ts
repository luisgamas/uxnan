/**
 * The desktop's copy of the bridge's conversations: the list every client
 * converges on, and the actions a chat tab takes on a thread.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '$shared/models/thread';
import { BridgeClientStore } from './client.svelte';
import { ChatStore, normalizeCwd, type ReplicaChange } from './chat.svelte';
import type { SyncChanges } from '$shared/models/sync';
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
    if (method in responses) {
      const answer = responses[method];
      return (typeof answer === 'function' ? (answer as () => unknown)() : answer) as never;
    }
    return {} as never;
  }) as BridgeClientStore['call'];
  const store = new ChatStore(client);
  return { client, store, calls };
}

function changes(extra: Partial<SyncChanges> = {}): SyncChanges {
  return {
    storeId: 's1',
    rev: 10,
    reset: true,
    settings: { home: '/Users/me', name: 'Studio' },
    projects: [],
    removedProjectIds: [],
    threads: [],
    removedThreadIds: [],
    clients: [],
    devices: [],
    ...extra,
  };
}

describe('ChatStore', () => {
  it('lists the threads of one folder, newest first and archived last', async () => {
    const { store } = harness({
      'sync/changes': changes({
        threads: [
          thread('old', '/repo', 1),
          thread('new', '/repo/', 5),
          thread('gone', '/repo', 9, { status: 'archived' }),
          thread('elsewhere', '/other', 7),
        ],
      }),
    });
    await store.sync();
    expect(store.threadsFor('/repo').map((t) => t.id)).toEqual(['new', 'old', 'gone']);
    expect(store.threadsFor('C:\\repo').map((t) => t.id)).toEqual([]);
  });

  it('is a replica: it catches up from the last revision, and a snapshot replaces it', async () => {
    const { store, calls } = harness({ 'sync/changes': changes() });
    await store.sync();
    expect(calls[0]).toEqual({ method: 'sync/changes', params: {} });
    expect(store.settings?.home).toBe('/Users/me');
    expect(store.threadsLoaded).toBe(true);
    // The next sync asks only for what came after.
    await store.sync();
    expect(calls[1]).toEqual({ method: 'sync/changes', params: { since: 10, storeId: 's1' } });

    // A snapshot drops what the bridge no longer has; an incremental answer
    // applies deletions and changes only.
    store.applySync(changes({ threads: [thread('a', '/r', 1), thread('b', '/r', 1)] }));
    store.applySync(
      changes({ reset: false, rev: 12, threads: [thread('c', '/r', 1)], removedThreadIds: ['a'] }),
    );
    expect([...store.threads.keys()].sort()).toEqual(['b', 'c']);
    store.applySync(changes({ rev: 13, threads: [thread('d', '/r', 1)] }));
    expect([...store.threads.keys()]).toEqual(['d']);
  });

  it('catches up when a revision skips one, and ignores a stale one', async () => {
    let answers = 0;
    const { store, calls } = harness({
      'sync/changes': () =>
        answers++ === 0
          ? changes({ rev: 5 })
          : changes({ reset: false, rev: 9, threads: [thread('y', '/r', 1, { rev: 9 })] }),
    });
    await store.sync();
    const synced = () => calls.filter((c) => c.method === 'sync/changes').length;
    store.apply({ method: 'stream/thread/updated', params: { thread: thread('x', '/r', 1, { rev: 6 }) } });
    expect(store.threads.has('x')).toBe(true);
    expect(synced()).toBe(1);
    store.apply({ method: 'stream/thread/updated', params: { thread: thread('y', '/r', 1, { rev: 9 }) } });
    await vi.waitFor(() => expect(synced()).toBe(2));
    store.apply({
      method: 'stream/thread/updated',
      params: { thread: thread('x', '/r', 1, { rev: 3, title: 'old' }) },
    });
    expect(store.threads.get('x')?.title).toBe('x');
  });

  it('mirrors projects, settings, presence and agents as they change', async () => {
    const { store } = harness({ 'sync/changes': changes({ rev: 1 }) });
    await store.sync();
    const seen: ReplicaChange[] = [];
    store.onReplicaChange((c) => seen.push(c));
    const project = { id: 'proj_a', name: 'app', cwd: '/w/app', rev: 2 };
    store.apply({ method: 'stream/project/updated', params: { project } });
    expect(store.projectList().map((p) => p.name)).toEqual(['app']);
    store.apply({ method: 'stream/project/removed', params: { projectId: 'proj_a', rev: 3 } });
    expect(store.projects.size).toBe(0);
    expect(seen.map((c) => [c.projects.length, c.removed.map((p) => p.id)])).toEqual([
      [1, []],
      [0, ['proj_a']],
    ]);
    store.apply({ method: 'stream/settings/updated', params: { settings: { home: '/p' }, rev: 4 } });
    expect(store.settings?.home).toBe('/p');
    const phone = { id: 'dev1', kind: 'phone' as const, name: 'Pixel', since: 1 };
    store.apply({ method: 'stream/presence/updated', params: { clients: [phone] } });
    expect(store.clients).toEqual([phone]);
    store.apply({
      method: 'stream/agents/updated',
      params: { agents: [{ agentId: 'zero', displayName: 'Zero', available: true }] },
    });
    expect(store.agents.map((a) => a.agentId)).toEqual(['zero']);
  });

  it('keeps the paired phones and renames them and the PC for every client', async () => {
    const phone = { deviceId: 'p1', displayName: 'Pixel 9', publicKey: 'k', pairedAt: 1 };
    const { store, calls } = harness({
      'sync/changes': changes({ devices: [phone] }),
      'device/rename': { ...phone, displayName: 'Work phone', nameSource: 'user' },
      'settings/set': { home: '/Users/me', name: 'Desk' },
    });
    await store.sync();
    expect(store.devices.map((d) => d.displayName)).toEqual(['Pixel 9']);
    expect(store.settings?.name).toBe('Studio');

    await store.renamePhone('p1', 'Work phone');
    expect(calls.at(-1)).toEqual({
      method: 'device/rename',
      params: { deviceId: 'p1', name: 'Work phone' },
    });
    expect(store.devices[0]?.displayName).toBe('Work phone');

    await store.setPcName('Desk');
    expect(calls.at(-1)).toEqual({ method: 'settings/set', params: { name: 'Desk' } });
    expect(store.settings?.name).toBe('Desk');

    store.apply({ method: 'stream/devices/updated', params: { devices: [] } });
    expect(store.devices).toEqual([]);

    await store.removePhone('p1');
    expect(calls.at(-1)).toEqual({
      method: 'bridge/removeTrustedDevice',
      params: { deviceId: 'p1' },
    });
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
    expect(store.peekConversation('t1')).toBeUndefined();
    const open = store.conversation('t1');
    expect(store.peekConversation('t1')).toBe(open);
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
    const { store, calls } = harness({ 'thread/start': thread('new', '/repo', 1) });
    const started = await store.startThread({
      cwd: '/repo',
      agentId: 'codex',
      model: 'gpt-5',
      title: ' Named tab ',
    });
    expect(started.id).toBe('new');
    // The folder decides the project; a name given before the first message
    // travels with the start, as the user's.
    expect(calls[0]).toEqual({
      method: 'thread/start',
      params: { agentId: 'codex', cwd: '/repo', model: 'gpt-5', title: 'Named tab' },
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'thread/setAccessMode')).toBe(true),
    );
    expect(store.threads.has('new')).toBe(true);
  });

  it('sends with an echo id and leaves naming the thread to the bridge', async () => {
    const { store, calls } = harness();
    const conversation = store.conversation('t1');
    conversation.loaded = true;
    await store.send('t1', '  fix the flaky test  ', { options: { reasoning: 'high' } });
    const send = calls.find((c) => c.method === 'turn/send');
    const params = send?.params as { clientTurnId: string; text: string; options: unknown };
    expect(params.text).toBe('fix the flaky test');
    expect(params.options).toEqual({ reasoning: 'high' });
    expect(conversation.pending.map((p) => p.clientTurnId)).toEqual([params.clientTurnId]);
    expect(calls.some((c) => c.method === 'thread/rename')).toBe(false);
  });

  it('sends a picked command without text, and images along with a message', async () => {
    const { store, calls } = harness({
      'agent/commands': { commands: [{ name: 'compact', source: 'builtin' }] },
    });
    const conversation = store.conversation('t1');
    conversation.loaded = true;
    await store.send('t1', '/compact now', { command: { name: 'compact', args: 'now' } });
    const cmd = calls.find((c) => c.method === 'turn/send')?.params as Record<string, unknown>;
    expect(cmd.command).toEqual({ name: 'compact', args: 'now' });
    expect('text' in cmd).toBe(false);
    expect(conversation.pending[0]?.text).toBe('/compact now');

    const image = { type: 'image' as const, mimeType: 'image/png', base64Data: 'AAAA' };
    await store.send('t1', '', { attachments: [image] });
    const pic = calls.filter((c) => c.method === 'turn/send').at(-1)?.params as Record<string, unknown>;
    expect(pic.attachments).toEqual([image]);
    expect(conversation.pending.at(-1)?.text).toBe('[1 image attachment]');

    // Commands are asked for once per agent and folder.
    expect((await store.commandsFor('claude-code', '/repo')).map((c) => c.name)).toEqual(['compact']);
    await store.commandsFor('claude-code', '/repo');
    expect(calls.filter((c) => c.method === 'agent/commands')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'agent/commands')?.params).toEqual({
      agentId: 'claude-code',
      cwd: '/repo',
    });
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
