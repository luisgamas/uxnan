/**
 * The desktop's copy of the bridge's conversations: the list every client
 * converges on, and the actions a chat tab takes on a thread.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Thread, TurnList } from '$shared/models/thread';
import type { SeenMarks, SeenStore } from './activity.svelte';
import { BridgeClientStore } from './client.svelte';
import { ChatStore, normalizeCwd, sessionKey, type ReplicaChange } from './chat.svelte';
import type { SyncChanges } from '$shared/models/sync';
import {
  bridgeAgentForCommand,
  bridgeAgentLogo,
  hookAgentForBridgeAgent,
  isUserFacingAgent,
} from './agents';

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
function harness(responses: Record<string, unknown> = {}, seen: SeenStore = memorySeenStore()) {
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
  const store = new ChatStore(client, seen);
  return { client, store, calls };
}

/** What the desktop has seen, kept in memory instead of the window's storage. */
function memorySeenStore(initial: SeenMarks | null = null): SeenStore & { marks: () => SeenMarks | null } {
  let saved = initial;
  return {
    load: () => (saved ? structuredClone(saved) : null),
    save: (marks) => {
      saved = structuredClone(marks);
    },
    marks: () => saved,
  };
}

function changes(extra: Partial<SyncChanges> = {}): SyncChanges {
  return {
    storeId: 's1',
    rev: 10,
    reset: true,
    settings: { home: '/Users/me', name: 'Studio', relay: null, hosts: [] },
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

  it('starts a thread in a folder with a fixed agent, leaving its access mode to the bridge', async () => {
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
    // The bridge starts it in its agent's default mode; the desktop sets none.
    expect(calls.some((c) => c.method === 'thread/setAccessMode')).toBe(false);
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
    // An image-only message is its images: no placeholder words.
    expect(conversation.pending.at(-1)?.text).toBe('');
    expect(conversation.pending.at(-1)?.request.attachments).toEqual([image]);

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

  it('sends a failed message again as it was written', async () => {
    const { store, client, calls } = harness();
    const call = client.call;
    client.call = vi.fn(async () => {
      throw new Error('bridge unreachable');
    }) as BridgeClientStore['call'];
    await store.send('t1', 'hello', { options: { reasoning: 'high' } });
    const [failed] = store.conversation('t1').pending;
    expect(failed?.error).toBe('bridge unreachable');

    client.call = call;
    await store.retry('t1', failed!.clientTurnId);
    expect(calls.at(-1)).toEqual({
      method: 'turn/send',
      params: {
        threadId: 't1',
        text: 'hello',
        options: { reasoning: 'high' },
        clientTurnId: failed!.clientTurnId,
      },
    });
    expect(store.conversation('t1').pending[0]?.error).toBeUndefined();
  });

  it('asks the bridge for a message image once, and again only after a failure', async () => {
    let fail = true;
    const { store, calls } = harness({
      'turn/attachment': () => {
        if (fail) {
          fail = false;
          throw new Error('bridge unreachable');
        }
        return { mimeType: 'image/png', base64Data: 'AAAA' };
      },
    });
    await expect(store.attachment('t1', 'a-0.png')).rejects.toThrow('bridge unreachable');
    expect(await store.attachment('t1', 'a-0.png')).toBe('data:image/png;base64,AAAA');
    expect(await store.attachment('t1', 'a-0.png')).toBe('data:image/png;base64,AAAA');
    expect(calls.filter((c) => c.method === 'turn/attachment')).toHaveLength(2);
    expect(calls.at(-1)?.params).toEqual({ threadId: 't1', attachmentId: 'a-0.png' });
  });

  it('forgets what a deleted thread had waiting', async () => {
    const { store, client } = harness();
    client.call = vi.fn(async () => {
      throw new Error('bridge unreachable');
    }) as BridgeClientStore['call'];
    await store.send('t1', 'hello');
    store.apply({ method: 'stream/thread/deleted', params: { threadId: 't1' } });
    expect(store.conversation('t1').pending).toEqual([]);
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

  it('keeps a finished chat nobody opened as done after a restart, asking the bridge only for its last turn', async () => {
    const seen = memorySeenStore({ baseline: 100, threads: {} });
    const lastPage: TurnList = {
      turns: [
        {
          id: 'u2',
          threadId: 'u',
          seq: 2,
          status: 'completed',
          messages: [{ id: 'm', turnId: 'u2', role: 'assistant', content: 'done', createdAt: 170 }],
          createdAt: 160,
          completedAt: 175,
        },
      ],
      total: 2,
    };
    const { store, calls } = harness(
      {
        'sync/changes': changes({
          threads: [thread('u', '/r', 180, { turnCount: 2 }), thread('s', '/r', 90, { turnCount: 1 })],
        }),
        'turn/list': lastPage,
      },
      seen,
    );
    await store.sync();
    await vi.waitFor(() => expect(store.activity.of('u')).toBe('done'));
    expect(store.activity.of('s')).toBe('idle');
    expect(calls.filter((c) => c.method === 'turn/list')).toEqual([
      { method: 'turn/list', params: { threadId: 'u', limit: 1, fromEnd: true } },
    ]);
    expect(store.statusesAt('/r')).toEqual([{ status: 'done', at: 180 }]);

    store.markSeen('u');
    expect(store.activity.of('u')).toBe('idle');
    expect(seen.marks()?.threads.u).toBe(180);
    store.markSeen('missing');
    expect(Object.keys(seen.marks()?.threads ?? {})).toEqual(['u']);
  });

  it('caches models per agent', async () => {
    const { store, calls } = harness({ 'agent/models': { models: [{ id: 'opus', displayName: 'Opus' }] } });
    await store.modelsFor('claude-code');
    await store.modelsFor('claude-code');
    expect(calls.filter((c) => c.method === 'agent/models')).toHaveLength(1);
    expect(store.cachedModels('claude-code').map((m) => m.id)).toEqual(['opus']);
  });

  it('asks again for the cached models after a reconnect, keeping them until answered', async () => {
    // The bridge on the other end of a reconnect may be a newer one listing
    // other models (a bridge update): the cached list must not outlive it.
    let answer: unknown = {
      models: [
        { id: 'opus', displayName: 'Opus 5.5' },
        { id: 'claude-opus-5-5', displayName: 'Opus 5.5' },
      ],
    };
    const { store, calls } = harness({ 'agent/models': () => answer });
    await store.modelsFor('claude-code');
    answer = { models: [{ id: 'opus', displayName: 'Opus 5.5' }] };
    await store.resync();
    expect(calls.filter((c) => c.method === 'agent/models')).toHaveLength(2);
    expect(store.cachedModels('claude-code').map((m) => m.id)).toEqual(['opus']);
    // A bridge that cannot answer leaves the last list in place.
    answer = Promise.reject(new Error('gone'));
    await store.resync();
    expect(store.cachedModels('claude-code').map((m) => m.id)).toEqual(['opus']);
  });
});

describe('agent sessions (architecture/02a §5.8.19)', () => {
  const hold = {
    agentId: 'claude-code',
    sessionId: 's-1',
    holder: { kind: 'terminal' as const, name: 'Studio' },
    heldAgoMs: 0,
    busy: false,
  };

  it('mirrors the holds the bridge announces, and reloads them after a reconnect', async () => {
    const { store } = harness({ 'agent/holds': { holds: [hold] } });
    await store.loadHolds();
    expect(store.holds.get(sessionKey('claude-code', 's-1'))).toEqual(hold);
    expect(store.holdOf(thread('t', '/r', 1, { agentSessionId: 's-1' }))).toEqual(hold);
    expect(store.holdOf(thread('t', '/r', 1))).toBeUndefined();

    store.apply({ method: 'stream/agent/held', params: { agentId: 'claude-code', sessionId: 's-1' } });
    expect(store.holds.size).toBe(0);
    store.apply({ method: 'stream/agent/held', params: { agentId: 'codex', sessionId: 'c', hold: { ...hold, agentId: 'codex', sessionId: 'c' } } });
    expect(store.holds.get('codex:c')?.agentId).toBe('codex');
    // Malformed: ignored.
    store.apply({ method: 'stream/agent/held', params: { sessionId: 'x' } });
    expect(store.holds.size).toBe(1);
  });

  it('lists a folder’s sessions, continues one, and asks a terminal to let one go', async () => {
    const { store, calls } = harness({
      'agent/sessions': { sessions: [], unlisted: ['antigravity-cli'] },
      'agent/requestHandoff': { outcome: 'released' },
      'thread/start': thread('th-1', '/r', 1, { agentSessionId: 's-1' }),
    });
    expect((await store.listAgentSessions('/r')).unlisted).toEqual(['antigravity-cli']);
    expect(await store.requestHandoff({ agentId: 'claude-code', sessionId: 's-1' })).toBe('released');
    await store.startThread({ cwd: '/r', agentId: 'claude-code', agentSessionId: 's-1', title: 'Old work' });
    expect(calls.find((c) => c.method === 'thread/start')?.params).toEqual({
      agentId: 'claude-code',
      cwd: '/r',
      title: 'Old work',
      agentSessionId: 's-1',
    });
    expect(calls.find((c) => c.method === 'agent/sessions')?.params).toEqual({ cwd: '/r' });
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

  it('maps a bridge agent back to the terminal agent that reopens its sessions', () => {
    expect(hookAgentForBridgeAgent('claude-code')).toBe('claude');
    expect(hookAgentForBridgeAgent('pi-agent')).toBe('pi');
    expect(hookAgentForBridgeAgent('antigravity-cli')).toBe('antigravity');
    // Zero's terminal UI cannot resume a session.
    expect(hookAgentForBridgeAgent('zero')).toBeNull();
    expect(hookAgentForBridgeAgent(undefined)).toBeNull();
    expect(sessionKey('codex', 'abc')).toBe('codex:abc');
  });
});
