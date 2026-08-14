/**
 * Settings → Agents → Hooks. The pane renders whatever the backend registry
 * returns, so what is tested here is that contract holding up: every agent the
 * backend reports gets a row, the ones on this machine lead, and the row's
 * switch reaches install / uninstall with the right agent id.
 *
 * It matters more than it looks: the list used to be a hard-coded tab strip, so
 * a newly wired agent existed in the backend and was invisible in the UI.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { app } from '$lib/state/app.svelte';
import AgentHooksPanel from './AgentHooksPanel.svelte';

function entry(id: string, present: boolean, installed: boolean) {
  return {
    id,
    present,
    configPath: `/home/u/.${id}/settings.json`,
    status: {
      installed,
      fileExists: true,
      unavailable: false,
      detail: `settings.json at /home/u/.${id}/settings.json`,
    },
  };
}

/** A machine with Claude and Cursor on it, and Kimi known but not installed. */
function baseCommands() {
  return {
    get_hook_install: () => ({
      dir: '/home/u/.local/share/uxnan/hooks',
      statusRelayScript: '',
      codexHookSh: '',
      codexHookCmd: '',
      opencodePluginScript: '',
      piExtensionScript: '',
      eventHookSh: '',
      eventHookCmd: '',
      wrapperBash: '/home/u/.local/share/uxnan/hooks/uxnan-hook-wrapper.sh',
      wrapperPowershell: '',
      wrapperCmd: '',
      wrapperFish: '',
      browserShimBash: '',
      browserShimCmd: '',
      claudeSettingsPath: '',
      codexHooksPath: '',
      opencodePluginPath: '',
      piExtensionPath: '',
      grokHooksPath: '',
      antigravityHooksPath: '',
    }),
    get_hook_scripts: () => null,
    list_agent_hooks: () => [
      entry('claude', true, true),
      entry('cursor', true, false),
      entry('kimi', false, false),
    ],
    install_agent_hooks: () => entry('cursor', true, true).status,
    uninstall_agent_hooks: () => entry('claude', true, false).status,
    render_agent_hooks_config: () => '{\n  "version": 1\n}',
  };
}

describe('AgentHooksPanel', () => {
  beforeEach(() => {
    app.settings.autoInstallHooks = true;
    document.body.style.pointerEvents = '';
  });

  it('lists the agents on this machine, product-named, in their own group', async () => {
    const { screen } = mountWithProviders(AgentHooksPanel, { commands: baseCommands() });
    await until(() => screen.queryAllByText('Claude Code').length > 0, { label: 'agent list' });
    // Product names, not hook ids — `claude` is `claudecode` in the catalog.
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    // The group headers tell "yours" from "the rest".
    expect(screen.getByText('On this machine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Other agents/ })).toBeInTheDocument();
  });

  it('folds the agents this machine does not have, and opens them on demand', async () => {
    const { screen, user } = mountWithProviders(AgentHooksPanel, { commands: baseCommands() });
    await until(() => screen.queryAllByText('Claude Code').length > 0, { label: 'agent list' });
    // Closed by default: the long tail must not push your own agents down.
    // Queried by role, which is what the collapsed content is hidden from —
    // Bits UI keeps it mounted and marks it `hidden` rather than unmounting.
    expect(screen.queryByRole('switch', { name: /Kimi/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Other agents/ }));
    await until(() => screen.queryAllByRole('switch', { name: /Kimi/ }).length > 0, {
      label: 'others group',
    });
    expect(screen.getByText(/weren’t found on your machine/)).toBeInTheDocument();
  });

  it("installs from the row's switch, by id", async () => {
    const { screen, backend, user } = mountWithProviders(AgentHooksPanel, {
      commands: baseCommands(),
    });
    await until(() => screen.queryAllByRole('switch', { name: /Cursor/ }).length > 0, {
      label: 'agent list',
    });
    await user.click(screen.getByRole('switch', { name: 'Install the reporter for Cursor' }));
    await until(() => backend.called('install_agent_hooks'), { label: 'install' });
    expect(backend.lastCallTo('install_agent_hooks')?.args.agent).toBe('cursor');
  });

  it('uninstalls when the switch of an installed agent is turned off', async () => {
    const { screen, backend, user } = mountWithProviders(AgentHooksPanel, {
      commands: baseCommands(),
    });
    await until(() => screen.queryAllByRole('switch', { name: /Claude Code/ }).length > 0, {
      label: 'agent list',
    });
    await user.click(screen.getByRole('switch', { name: 'Install the reporter for Claude Code' }));
    await until(() => backend.called('uninstall_agent_hooks'), { label: 'uninstall' });
    expect(backend.lastCallTo('uninstall_agent_hooks')?.args.agent).toBe('claude');
  });

  it('renders the config, and its path, only when asked for it', async () => {
    const { screen, backend, user } = mountWithProviders(AgentHooksPanel, {
      commands: baseCommands(),
    });
    await until(() => screen.queryAllByText('Claude Code').length > 0, { label: 'agent list' });
    // The file its reporter lands in is the row's own metadata, always visible…
    expect(screen.getByText('/home/u/.claude/settings.json')).toBeInTheDocument();
    // …but rendering the config is not one round-trip per agent up front.
    expect(backend.called('render_agent_hooks_config')).toBe(false);
    // The first row's disclosure is Claude Code's, the machine-first group.
    await user.click(screen.getAllByRole('button', { name: 'Show config' })[0]);
    await until(() => backend.called('render_agent_hooks_config'), { label: 'config' });
    expect(backend.lastCallTo('render_agent_hooks_config')?.args.agent).toBe('claude');
    await until(() => screen.queryAllByText(/"version": 1/).length > 0, { label: 'rendered' });
  });
});
