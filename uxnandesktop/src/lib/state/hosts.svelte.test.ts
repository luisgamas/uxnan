/**
 * Bringing hosts back at startup, and knowing which incarnation each one is.
 *
 * Both exist for the same reason: after a restart or a window reload the app
 * shows projects, panels and a save button that all need a live session, and
 * until now nothing asked for one unless the user opened Settings → Hosts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { hosts } from './hosts.svelte';
import { sessions } from './sessions.svelte';

function host(id: string, needsPrompt = false) {
  return {
    id,
    label: id,
    hostname: `${id}.example`,
    port: 22,
    user: 'dev',
    identityFiles: [],
    identitiesOnly: false,
    forwardAgent: false,
    needsPrompt,
  };
}

let backend: FakeBackend;
let connected: { hostId: string; generation: number }[];
let resumable: string[];

beforeEach(() => {
  connected = [];
  resumable = ['silent', 'already'];
  backend = installFakeBackend({
    ssh_hosts_list: () => [host('silent'), host('asks', true), host('already')],
    // The backend is the one that knows which hosts can be reached without a
    // dialog — a host key it has never seen can only end in the trust prompt.
    ssh_hosts_resumable: () => resumable,
    ssh_hosts_connected: () => connected,
    ssh_host_connect: (args) => {
      connected = [...connected, { hostId: String(args.hostId), generation: 3 }];
      return { status: 'connected', generation: 3, attempted: [] };
    },
    ssh_host_inventory: () => ({ os: 'linux', home: '/home/dev', git: '2.4', multiplexer: '', agents: {}, shell: 'posix' }),
  });
  hosts.hosts = [];
  hosts.connected = [];
  sessions.replace([]);
});

describe('hosts.resume', () => {
  it('connects the hosts that let us in without asking', async () => {
    await hosts.resume();

    const asked = backend.callsTo('ssh_host_connect').map((c) => c.args.hostId);
    expect(asked).toContain('silent');
    // A machine that wanted a password last time would greet the user with a
    // stack of credential dialogs at launch. It connects when they ask.
    expect(asked).not.toContain('asks');
  });

  it('connects nobody the backend did not clear', async () => {
    // Including the case the frontend cannot see: a host registered moments ago
    // carries the same "did not need a prompt" as one that has connected for
    // weeks, and reaching it would raise the trust dialog at launch.
    resumable = [];

    await hosts.resume();

    expect(backend.callsTo('ssh_host_connect')).toHaveLength(0);
  });

  it('leaves a session the backend never dropped alone', async () => {
    connected = [{ hostId: 'already', generation: 9 }];

    await hosts.resume();

    expect(backend.callsTo('ssh_host_connect').map((c) => c.args.hostId)).not.toContain('already');
    // And its incarnation is known without reconnecting, which is what a save
    // prepared after a reload has to carry.
    expect(hosts.generationOf('already')).toBe(9);
  });

  it('reports no generation for a host that is not connected', async () => {
    // `undefined` is the signal a mutation must refuse on — never a zero, which
    // is an expectation nobody issued.
    await hosts.resume();
    expect(hosts.generationOf('asks')).toBeUndefined();
  });
});
