/**
 * Settings → Hosts: what a host reports about itself.
 *
 * The agents a machine has used to be a comma-joined list of names under its
 * address. That row fits about three before truncating, and a truncated list of
 * names is worse than no list — it reads as "this host has three agents". So
 * they are logos, the rest collapse into `+N`, and the full picture (every
 * agent, its version, the OS and the multiplexer) lives one click away.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { hosts } from '$lib/state/hosts.svelte';
import HostsSettings from './HostsSettings.svelte';

const HOST = {
  id: 'h1',
  label: 'Workspace Gamas',
  hostname: '10.0.0.5',
  port: 22,
  user: 'gamas',
  identityFiles: [],
  identitiesOnly: false,
  forwardAgent: false,
  needsPrompt: false,
};

/** Seven agents: two more than the strip shows, so `+N` has to appear. */
const MANY = {
  os: 'windows',
  home: 'C:/Users/gamas',
  git: 'git version 2.54.0',
  multiplexer: '',
  shell: 'powershell',
  agents: {
    claude: '2.1.233 (Claude Code)',
    codex: '0.9.1',
    opencode: '1.2.0',
    pi: '3.0',
    grok: '0.4',
    goose: '1.1',
    mycli: '0.1',
  },
};

beforeEach(() => {
  hosts.hosts = [HOST];
  hosts.connected = ['h1'];
  hosts.inventories = { h1: MANY };
});

describe('HostsSettings — what a host has', () => {
  it('shows logos instead of names, and collapses the rest into +N', async () => {
    const { screen } = mountWithProviders(HostsSettings, {
      commands: { ssh_hosts_list: () => [HOST], ssh_hosts_connected: () => [] },
    });

    // Five logos, then the overflow — never seven names in a one-line row.
    await until(() => screen.container.querySelectorAll('img, svg').length > 0, {
      label: 'the agent strip',
    });
    expect(await screen.findByText('+2')).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code, Codex/)).toBeNull();
  });

  it('opens the full list with the versions the host reported', async () => {
    // The versions are the reason the popover is worth opening: they were read
    // on that machine and are shown nowhere else in the app.
    const { screen, user } = mountWithProviders(HostsSettings, {
      commands: { ssh_hosts_list: () => [HOST], ssh_hosts_connected: () => [] },
    });

    await user.click(await screen.findByLabelText('Agents on Workspace Gamas'));

    expect(await screen.findByText('2.1.233 (Claude Code)')).toBeInTheDocument();
    // Including the one the catalog has never heard of — it is installed there.
    expect(await screen.findByText('mycli')).toBeInTheDocument();
  });

  it('says so plainly when the host answered and has none', async () => {
    hosts.inventories = { h1: { ...MANY, agents: {} } };
    const { screen } = mountWithProviders(HostsSettings, {
      commands: { ssh_hosts_list: () => [HOST], ssh_hosts_connected: () => [] },
    });

    expect(await screen.findByText(/no agents/i)).toBeInTheDocument();
  });
});
