/**
 * A host's own page: the connection check, what the machine has, and the
 * terminals its engine holds.
 *
 * The check is worded from `ssh_host_doctor`, which never signs in to find out.
 * So the page has to say which steps it could not see yet — "connect to check"
 * — rather than drawing them as passed or failed, and a terminal it ends is
 * ended against the connection the user saw, never a guessed one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { hosts } from '$lib/state/hosts.svelte';
import { sessions } from '$lib/state/sessions.svelte';
import type { HostDoctor, HostSession } from '$lib/types';
import HostDetailsDialog from './HostDetailsDialog.svelte';

const HOST = {
  id: 'h1',
  label: 'build-box',
  hostname: '10.0.0.5',
  port: 22,
  user: 'dev',
  identityFiles: [],
  identitiesOnly: false,
  forwardAgent: true,
  needsPrompt: false,
};

/** What the check reports before anyone has signed in. */
const BEFORE_SIGN_IN: HostDoctor = {
  hops: ['10.0.0.5'],
  proxyCommand: false,
  routeError: null,
  reachMs: 12,
  reachError: null,
  keySettled: false,
  connected: false,
  shell: null,
  engine: null,
  engineError: null,
  roundTripMs: null,
  forwardAgent: true,
};

const SIGNED_IN: HostDoctor = {
  ...BEFORE_SIGN_IN,
  hops: ['jump.example', '10.0.0.5'],
  keySettled: true,
  connected: true,
  shell: 'bash',
  engine: { version: '0.1.0', protocol: 14, os: 'linux', arch: 'x86_64' },
  roundTripMs: 80,
};

const HELD: HostSession[] = [
  { session: 7, label: 'shell', cwd: '/srv/app', alive: true, startedAgoMs: 60_000, tab: null },
  { session: 3, label: 'shell', cwd: '/srv/old', alive: false, startedAgoMs: 120_000, tab: null },
];

function open(commands: Record<string, (args: Record<string, unknown>) => unknown>) {
  return mountWithProviders(HostDetailsDialog, {
    props: { open: true, host: HOST, onforget: () => {} },
    commands,
  });
}

beforeEach(() => {
  hosts.hosts = [HOST];
  hosts.inventories = {};
});

afterEach(() => {
  hosts.connected = [];
  sessions.replace([]);
});

describe('HostDetailsDialog — the check', () => {
  it('says which steps need a connection instead of passing or failing them', async () => {
    hosts.connected = [];
    const { screen, backend } = open({ ssh_host_doctor: () => BEFORE_SIGN_IN });

    expect(await screen.findByText('12 ms')).toBeInTheDocument();
    expect(screen.getByText('Not on file yet — you will be asked to confirm it')).toBeInTheDocument();
    // Sign-in, shell, engine and round trip: none of them is known yet.
    expect(screen.getAllByText('Connect to check')).toHaveLength(4);
    // And it does not ask an engine it has no session to for its terminals.
    expect(screen.getByText('Connect to see the terminals its engine holds.')).toBeInTheDocument();
    expect(backend.called('ssh_host_sessions')).toBe(false);
  });

  it('shows the route, the engine and the round trip once signed in', async () => {
    hosts.connected = ['h1'];
    sessions.replace([{ hostId: 'h1', generation: 4, label: 'build-box', latencyMs: 80 }]);
    const { screen } = open({ ssh_host_doctor: () => SIGNED_IN, ssh_host_sessions: () => [] });

    expect(await screen.findByText('Through jump.example → 10.0.0.5')).toBeInTheDocument();
    expect(screen.getByText('uxnan-host 0.1.0 · linux/x86_64')).toBeInTheDocument();
    expect(screen.getByText('80 ms')).toBeInTheDocument();
    expect(screen.getByText(/Connected · 80 ms · dev@10\.0\.0\.5/)).toBeInTheDocument();
  });

  it('reports a route that cannot be resolved as the error it is', async () => {
    const { screen } = open({
      ssh_host_doctor: () => ({ ...BEFORE_SIGN_IN, routeError: 'ProxyJump loops back to itself' }),
    });

    expect(await screen.findByText('ProxyJump loops back to itself')).toBeInTheDocument();
  });
});

describe('HostDetailsDialog — the host’s terminals', () => {
  it('lists what the engine holds, and ends one against the live connection', async () => {
    hosts.connected = ['h1'];
    sessions.replace([{ hostId: 'h1', generation: 4, label: 'build-box' }]);
    const { screen, user, backend } = open({
      ssh_host_doctor: () => SIGNED_IN,
      ssh_host_sessions: () => HELD,
      ssh_host_session_end: () => null,
    });

    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    // Only the live one can be ended; the other already is.
    const end = screen.getAllByRole('button', { name: 'End' });
    expect(end).toHaveLength(1);

    await user.click(end[0]);
    expect(await screen.findByText('End the terminal in app?')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'End' }).at(-1)!);

    await until(() => backend.called('ssh_host_session_end'), { label: 'the end call' });
    expect(backend.lastCallTo('ssh_host_session_end')?.args).toEqual({
      hostId: 'h1',
      session: 7,
      expect: { targetId: 'ssh:h1', generation: 4 },
    });
    // And the list is read again, so the ended one is drawn as ended.
    await until(() => backend.callsTo('ssh_host_sessions').length >= 2, { label: 'the reload' });
  });
});

describe('HostDetailsDialog — what carries the connection', () => {
  it('says the system ssh carries a session, and why, in the person’s words', async () => {
    hosts.connected = ['h1'];
    sessions.replace([
      {
        hostId: 'h1',
        generation: 4,
        label: 'build-box',
        systemSsh: { code: 'securityKey', file: '~/.ssh/id_ed25519_sk' },
      },
    ]);
    const { screen } = open({
      ssh_host_doctor: () => SIGNED_IN,
      ssh_host_sessions: () => [],
      ssh_host_carrier: () => ({ carrier: 'auto', system: null }),
    });

    expect(
      await screen.findByText(
        'Connected through the system ssh, because its key ~/.ssh/id_ed25519_sk is a FIDO2 security key.',
      ),
    ).toBeInTheDocument();
  });

  it('says what would carry it before connecting, and explains automatic', async () => {
    const { screen } = open({
      ssh_host_doctor: () => BEFORE_SIGN_IN,
      ssh_host_carrier: () => ({ carrier: 'auto', system: null }),
    });

    expect(await screen.findByText('Connects with the built-in client.')).toBeInTheDocument();
    expect(screen.getByText(/Automatic uses the system ssh only when/)).toBeInTheDocument();
  });

  it('pins the carrier the person picks', async () => {
    const { screen, user, backend } = open({
      ssh_host_doctor: () => BEFORE_SIGN_IN,
      ssh_host_carrier: () => ({ carrier: 'auto', system: null }),
      ssh_host_set_carrier: (args) => ({ ...HOST, carrier: args.carrier }),
    });

    await screen.findByText('Connects with the built-in client.');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('System ssh'));
    await until(() => backend.called('ssh_host_set_carrier'), { label: 'the carrier call' });
    expect(backend.lastCallTo('ssh_host_set_carrier')?.args).toEqual({
      hostId: 'h1',
      carrier: 'system',
    });
  });
});
