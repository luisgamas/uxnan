/**
 * A host page's bridge: what the host engine reports, the one action that
 * fits it, and the LAN switch — off by default, and only ever changed on the
 * owner's say, fenced to the connection they are looking at.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { sessions } from '$lib/state/sessions.svelte';
import type { HostBridgeState } from '$lib/types';
import HostBridgeSection from './HostBridgeSection.svelte';

const HOST = {
  id: 'h1',
  label: 'build-box',
  hostname: '10.0.0.5',
  port: 22,
  user: 'dev',
  identityFiles: [],
  identitiesOnly: false,
  forwardAgent: false,
  needsPrompt: false,
};

const NOTHING: HostBridgeState = {
  node: 'v22.23.2',
  npm: '10.9.0',
  install: null,
  running: null,
  supervised: false,
  supervise: false,
  lastError: null,
  lan: false,
};

const KEPT: HostBridgeState = {
  ...NOTHING,
  install: { kind: 'managed', version: '0.0.46', cli: '/home/dev/.uxnan/bridge/lib/node_modules/uxnan-bridge/dist/src/cli.js' },
  running: 4242,
  supervised: true,
  supervise: true,
};

afterEach(() => sessions.replace([]));

describe('HostBridgeSection', () => {
  it('offers to install on a host with Node and none, fenced to the live connection', async () => {
    sessions.replace([{ hostId: 'h1', generation: 7, label: 'build-box' }]);
    let state = NOTHING;
    const { screen, user, backend } = mountWithProviders(HostBridgeSection, {
      props: { host: HOST, connected: true },
      commands: {
        host_bridge_status: () => state,
        host_bridge_install: () => {
          state = KEPT;
          return { ok: true, version: '0.0.46', tail: [] };
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Install bridge' }));
    await until(() => backend.called('host_bridge_install'), { label: 'the install' });
    expect(backend.lastCallTo('host_bridge_install')?.args).toEqual({
      hostId: 'h1',
      expect: { targetId: 'ssh:h1', generation: 7 },
    });
    expect(await screen.findByText(/Installed by Uxnan · 0\.0\.46 · running, kept running by Uxnan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('says what is missing when the host has no Node, and offers nothing it cannot do', async () => {
    const { screen } = mountWithProviders(HostBridgeSection, {
      props: { host: HOST, connected: true },
      commands: { host_bridge_status: () => ({ ...NOTHING, node: null, npm: null }) },
    });
    expect(await screen.findByText('Needs Node.js 18 or newer on this host')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install bridge' })).toBeNull();
  });

  it('keeps the LAN closed until the owner opens it, and says what that opens', async () => {
    sessions.replace([{ hostId: 'h1', generation: 3, label: 'build-box' }]);
    const { screen, user, backend } = mountWithProviders(HostBridgeSection, {
      props: { host: HOST, connected: true },
      commands: {
        host_bridge_status: () => KEPT,
        host_bridge_set_lan: () => ({ ...KEPT, lan: true }),
      },
    });

    expect(await screen.findByText(/Off: no port is opened on build-box/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: "Open on this host's network" }));
    await until(() => backend.called('host_bridge_set_lan'), { label: 'the switch' });
    expect(backend.lastCallTo('host_bridge_set_lan')?.args).toEqual({
      hostId: 'h1',
      on: true,
      expect: { targetId: 'ssh:h1', generation: 3 },
    });
    expect(await screen.findByText(/On: the bridge listens on build-box's network/)).toBeInTheDocument();
  });
});
