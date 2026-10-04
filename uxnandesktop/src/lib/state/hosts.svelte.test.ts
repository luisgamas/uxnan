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
    fs_list_dir: () => [],
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
  it('keeps a read tree on screen marked offline, never as if it were current', async () => {
    // A loaded folder is never listed again, so the panel once kept showing the
    // other machine's files after it was disconnected with no hint they were
    // out of date. Now what was read stays — the user keeps their place — and
    // the tree says it is offline, with when it was read.
    connected = [{ hostId: 'already', generation: 9 }];
    await hosts.load();
    fileTree.setRoot('/code', 'ssh:already');
    await until(() => !fileTree.loadingDir.has('/code'), { label: 'the first listing' });
    const listing = { '/code': [{ name: 'src', path: '/code/src', isDir: true, ignored: false }] };
    fileTree.childrenByDir = listing;
    fileTree.readAt = Date.now() - 60_000;
    fileTree.awaitingHost = false;

    await hosts.disconnect('already');

    expect(fileTree.offline).toBe(true);
    expect(fileTree.childrenByDir).toEqual(listing);
    expect(fileTree.mutable).toBe(false);
  });

  it('sends a tree that had read nothing back to waiting', async () => {
    connected = [{ hostId: 'already', generation: 9 }];
    await hosts.load();
    fileTree.setRoot(null);
    fileTree.setRoot('/code', 'ssh:already');
    await until(() => !fileTree.loadingDir.has('/code'), { label: 'the first listing' });
    fileTree.childrenByDir = {};
    fileTree.readAt = null;
    fileTree.awaitingHost = false;

    await hosts.disconnect('already');

    expect(fileTree.offline).toBe(false);
    expect(fileTree.awaitingHost).toBe(true);
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
    // The tree had read its root, so it is kept and marked offline.
    expect(fileTree.offline || fileTree.awaitingHost).toBe(true);
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

  it('shows what the system ssh said when it would not connect', async () => {
    // OpenSSH checked the key and signed in by itself; its sentence is the
    // whole story, so it is shown rather than a guess at what went wrong.
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'systemSshFailed',
        detail: 'Host key verification failed.',
        attempted: [],
      }),
    });
    await hosts.load();
    await hosts.connect('silent');

    expect(hosts.error).toMatch(/the system ssh could not connect — Host key verification failed\./);
  });
});

describe('hosts.connect — what a host (or its bastion) asks for', () => {
  beforeEach(async () => {
    hosts.pendingCredential = null;
    hosts.pendingChallenge = null;
    hosts.pendingKey = null;
    hosts.keyMismatch = null;
    hosts.error = null;
    await hosts.load();
  });

  it('asks for a bastion password naming the bastion, and sends it back for that hop', async () => {
    backend.setCommands({
      ssh_host_connect: (args) =>
        args.secret
          ? { status: 'connected', generation: 5, attempted: [] }
          : {
              status: 'needsPassword',
              hop: 'edge',
              hopKey: 'ops@edge:22',
              attempted: [],
              strict: false,
              wrong: false,
              learnedKeys: [],
            },
    });
    await hosts.connect('silent');
    expect(hosts.pendingCredential?.label).toContain('edge');
    expect(hosts.pendingCredential?.label).toContain('silent');

    await hosts.submitPendingCredential('gate');
    expect(backend.lastCallTo('ssh_host_connect')?.args.secret).toEqual({
      kind: 'password',
      hopKey: 'ops@edge:22',
      path: null,
      value: 'gate',
    });
    expect(hosts.pendingCredential).toBeNull();
  });

  it('says a passphrase was wrong, and sends the next one for that key file', async () => {
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'needsPassphrase',
        hopKey: 'dev@silent.example:22',
        path: '~/.ssh/id_locked',
        wrong: true,
        attempted: [],
        strict: false,
        learnedKeys: [],
      }),
    });
    await hosts.connect('silent');
    expect(hosts.pendingCredential?.kind).toBe('passphrase');
    expect(hosts.pendingCredential?.wrong).toBe(true);
    await hosts.submitPendingCredential('open sesame');
    expect(backend.lastCallTo('ssh_host_connect')?.args.secret).toMatchObject({
      kind: 'passphrase',
      path: '~/.ssh/id_locked',
    });
  });

  it('holds a second factor for the person and answers on the waiting connection', async () => {
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'needsAnswers',
        hopKey: 'dev@silent.example:22',
        challenge: { name: '', instructions: '', prompts: [{ text: 'Verification code: ', echo: true }] },
        attempted: [],
        strict: false,
        wrong: false,
        learnedKeys: [],
      }),
      ssh_host_answer: () => {
        connected = [{ hostId: 'silent', generation: 6 }];
        return { status: 'connected', generation: 6, attempted: [], strict: false, wrong: false, learnedKeys: [] };
      },
      ssh_host_cancel: () => true,
    });
    await hosts.connect('silent');
    expect(hosts.pendingChallenge?.challenge.prompts[0].text).toBe('Verification code: ');

    await hosts.answerPendingChallenge(['424242']);
    expect(backend.lastCallTo('ssh_host_answer')?.args).toEqual({ hostId: 'silent', answers: ['424242'] });
    expect(hosts.pendingChallenge).toBeNull();
    expect(hosts.isConnected('silent')).toBe(true);
  });

  it('drops the waiting connection when the person closes the second factor', async () => {
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'needsAnswers',
        challenge: { name: '', instructions: '', prompts: [{ text: 'Code: ', echo: true }] },
        attempted: [],
        strict: false,
        wrong: false,
        learnedKeys: [],
      }),
      ssh_host_cancel: () => true,
    });
    await hosts.connect('silent');
    await hosts.cancelPendingChallenge();
    expect(backend.callsTo('ssh_host_cancel').map((c) => c.args.hostId)).toEqual(['silent']);
    expect(hosts.pendingChallenge).toBeNull();
  });

  it('replaces a changed key only on the explicit request, then connects', async () => {
    let replaced = false;
    backend.setCommands({
      ssh_host_connect: () =>
        replaced
          ? { status: 'connected', generation: 7, attempted: [] }
          : {
              status: 'hostChanged',
              fingerprint: 'SHA256:new',
              storedFingerprint: 'SHA256:old',
              attempted: [],
              strict: false,
              wrong: false,
              learnedKeys: [],
            },
      ssh_host_replace_key: () => {
        replaced = true;
        return true;
      },
    });
    await hosts.connect('silent');
    expect(hosts.keyMismatch).toMatchObject({ presented: 'SHA256:new', stored: 'SHA256:old' });
    expect(backend.callsTo('ssh_host_replace_key')).toHaveLength(0);

    await hosts.replaceChangedKey();
    expect(backend.callsTo('ssh_host_replace_key')).toHaveLength(1);
    expect(hosts.keyMismatch).toBeNull();
    expect(backend.callsTo('ssh_host_connect')).toHaveLength(2);
  });

  it('shows an unknown key under StrictHostKeyChecking yes without offering to trust it', async () => {
    backend.setCommands({
      ssh_host_connect: () => ({
        status: 'hostUnknown',
        fingerprint: 'SHA256:abc',
        strict: true,
        attempted: [],
        wrong: false,
        learnedKeys: [],
      }),
    });
    await hosts.connect('silent');
    expect(hosts.pendingKey).toBeNull();
    expect(hosts.error).toContain('SHA256:abc');
  });
});
