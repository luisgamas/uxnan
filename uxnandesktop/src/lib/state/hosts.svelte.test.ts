/**
 * Bringing hosts back at startup, and knowing which incarnation each one is.
 *
 * Both exist for the same reason: after a restart or a window reload the app
 * shows projects, panels and a save button that all need a live session, and
 * until now nothing asked for one unless the user opened Settings → Hosts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { until } from '../../test/render';
import { hosts } from './hosts.svelte';
import { sessions } from './sessions.svelte';
import { fileTree } from './fileTree.svelte';

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
    ssh_host_disconnect: (args) => {
      connected = connected.filter((s) => s.hostId !== args.hostId);
      return true;
    },
    ssh_fs_list: () => [],
  });
  hosts.hosts = [];
  hosts.connected = [];
  sessions.replace([]);
  // The store is a singleton and subscribes once; each test installs a *new*
  // fake event bus, so without this the subscription from an earlier test would
  // count as installed while listening to a bus nobody emits on any more.
  (hosts as unknown as { listening: boolean }).listening = false;
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

describe('a host that goes away', () => {
  it('sends its file tree back to waiting instead of leaving a memory on screen', async () => {
    // A loaded folder is never listed again, so without this the panel kept
    // showing the other machine's files after it was disconnected — no message,
    // no hint, a tree that was quietly out of date.
    connected = [{ hostId: 'already', generation: 9 }];
    await hosts.load();
    fileTree.setRoot('/code', 'ssh:already');
    fileTree.childrenByDir = { '/code': [{ name: 'src', path: '/code/src', isDir: true, ignored: false }] };
    fileTree.awaitingHost = false;

    await hosts.disconnect('already');

    expect(fileTree.awaitingHost).toBe(true);
    expect(fileTree.childrenByDir).toEqual({});
  });

  it("leaves another host's tree alone", async () => {
    connected = [{ hostId: 'already', generation: 9 }, { hostId: 'silent', generation: 2 }];
    await hosts.load();
    fileTree.setRoot('/code', 'ssh:silent');
    fileTree.childrenByDir = { '/code': [] };
    fileTree.awaitingHost = false;

    await hosts.disconnect('already');

    expect(fileTree.awaitingHost).toBe(false);
  });
});

describe('a session that ends on its own', () => {
  it('is noticed without anyone asking, and the panels are told', async () => {
    // What this fixes: everything about a dropped session was already right
    // *when asked*, so a host that dropped while its panel was open kept looking
    // connected until the user clicked something — and the click was how they
    // found out.
    await hosts.load();
    connected = [{ hostId: 'silent', generation: 3 }];
    await hosts.load();
    expect(sessions.isConnected('silent')).toBe(true);

    // The tree is of that host, so it has something to forget. (The store is a
    // singleton and `setRoot` no-ops on an unchanged root, so it is cleared
    // first — an earlier test in this file may have left it pointed here.)
    fileTree.setRoot(null);
    fileTree.setRoot('/home/dev/app', 'ssh:silent');
    expect(fileTree.awaitingHost).toBe(false);

    // The host goes away and the backend says so. (The subscription is
    // installed without blocking the load, so the test waits for it rather than
    // assuming it is already there.)
    await until(() => backend.listenerCount('ssh:session-ended') > 0);
    connected = [];
    backend.emit('ssh:session-ended', { hostId: 'silent', generation: 3 });
    await until(() => !sessions.isConnected('silent'));

    expect(sessions.isConnected('silent')).toBe(false);
    expect(fileTree.awaitingHost).toBe(true);
  });

  it('re-reads the live set rather than trusting the payload', async () => {
    // The event says *something changed*; two sources for one fact is how they
    // end up disagreeing. Here the payload names a host that is still up.
    await hosts.load();
    connected = [{ hostId: 'silent', generation: 3 }];
    await hosts.load();

    await until(() => backend.listenerCount('ssh:session-ended') > 0);
    backend.emit('ssh:session-ended', { hostId: 'silent', generation: 1 });
    await new Promise((r) => setTimeout(r, 0));

    expect(sessions.isConnected('silent')).toBe(true);
  });
});

describe('a host that could not be reached', () => {
  it('shows what the backend said, rather than one blanket message', async () => {
    // Asleep, no such name and nothing listening lead to different actions, so
    // the backend classifies them and the sentence it builds names the machine
    // and the port. Flattening that into "could not connect" is what made a
    // typo in a hostname look the same as a laptop with its lid shut.
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'unreachable',
        reason: 'timeout',
        detail: 'gamas:22 did not answer within 15s — the machine may be asleep or off this network',
        attempted: [],
      }),
    });
    await hosts.load();
    await hosts.connect('silent');

    expect(hosts.error).toMatch(/did not answer within 15s/);
  });
});
