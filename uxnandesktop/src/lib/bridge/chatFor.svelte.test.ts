/**
 * One conversation replica per machine with a bridge (`02g` §5.18).
 *
 * A host's own bridge has its own threads, its own clock and its own unsent
 * messages. A replica shared with this machine's would mix the two lists (and
 * its activity tracker forgets every thread missing from the list it is given),
 * so each machine gets its own, and nothing of one is stored under the other.
 */

import { describe, expect, it } from 'vitest';

import { installFakeBackend } from '../../test/tauri';
import { bridges } from './client.svelte';
import { chat, chatFor, chatStatusesAt } from './chat.svelte';
import { outboxKey } from './outbox';
import { terminals, GLOBAL_WORKSPACE } from '$lib/state/terminals.svelte';

describe('chatFor', () => {
  it('keeps this machine\'s replica, and one more per host, each on its own bridge', () => {
    installFakeBackend({});
    expect(chatFor(undefined)).toBe(chat);
    expect(chatFor('local')).toBe(chat);
    const h1 = chatFor('ssh:h1');
    expect(h1).not.toBe(chat);
    expect(h1.target).toBe('ssh:h1');
    expect(chatFor('ssh:h1')).toBe(h1);
    expect(chatFor('ssh:h2')).not.toBe(h1);
    expect(bridges.for('ssh:h1').target).toBe('ssh:h1');
  });

  it('never invents a replica to answer a status read', () => {
    // Read from derived values: a host nobody has heard from has no chats.
    expect(chatStatusesAt('ssh:never-seen', '/srv/app')).toEqual([]);
  });
});

describe('outboxKey', () => {
  it('keeps a host\'s unsent messages apart from this machine\'s', () => {
    expect(outboxKey('local', 't1')).toBe('t1');
    expect(outboxKey('ssh:h1', 't1')).toBe('ssh:h1/t1');
  });
});

describe('a chat tab names its machine', () => {
  it('opens a second tab for the same thread id on another machine', () => {
    installFakeBackend({});
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.root = null;
    terminals.hydrated = true;
    const here = terminals.openChat({ cwd: '/srv/app', threadId: 't1' });
    expect(terminals.openChat({ cwd: '/srv/app', threadId: 't1' })).toBe(here);
    const there = terminals.openChat({ cwd: '/srv/app', threadId: 't1', target: 'ssh:h1' });
    expect(there).not.toBe(here);
    expect(terminals.openChat({ cwd: '/srv/app', threadId: 't1', target: 'ssh:h1' })).toBe(there);
  });
});
