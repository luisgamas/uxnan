/**
 * Settings → Agents → Hooks. The pane renders whatever the backend registry
 * returns, so what is tested here is that contract holding up: every agent the
 * backend reports gets a row, the ones on this machine lead, and install /
 * uninstall reach the generic commands with the right agent id.
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
      geminiSettingsPath: '',
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

  it('lists every agent the backend reports, machine-first', async () => {
    const { screen } = mountWithProviders(AgentHooksPanel, { commands: baseCommands() });
    await until(() => screen.queryAllByRole('button', { name: /Claude Code/ }).length > 0, {
      label: 'agent list',
    });
    // Product names, not hook ids — `claude` is `claudecode` in the catalog.
    expect(screen.getByRole('button', { name: /Claude Code/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cursor/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kimi/ })).toBeInTheDocument();
    // The group headers tell "yours" from "the rest".
    expect(screen.getByText('On this machine')).toBeInTheDocument();
    expect(screen.getByText('Other agents')).toBeInTheDocument();
  });

  it('opens on an agent this machine actually has', async () => {
    const { screen } = mountWithProviders(AgentHooksPanel, { commands: baseCommands() });
    await until(() => screen.queryAllByText(/\.claude\/settings\.json/).length > 0, {
      label: 'detail pane',
    });
    // The detail pane shows the selected agent's config path.
    expect(screen.getByText('/home/u/.claude/settings.json')).toBeInTheDocument();
  });

  it('installs the agent you selected, by id', async () => {
    const { screen, backend, user } = mountWithProviders(AgentHooksPanel, {
      commands: baseCommands(),
    });
    await until(() => screen.queryAllByRole('button', { name: /Cursor/ }).length > 0, {
      label: 'agent list',
    });
    await user.click(screen.getByRole('button', { name: /Cursor/ }));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await until(() => backend.called('install_agent_hooks'), { label: 'install' });
    expect(backend.lastCallTo('install_agent_hooks')?.args.agent).toBe('cursor');
  });

  it('says when a listed agent is not on this machine', async () => {
    const { screen, user } = mountWithProviders(AgentHooksPanel, { commands: baseCommands() });
    await until(() => screen.queryAllByRole('button', { name: /Kimi/ }).length > 0, {
      label: 'agent list',
    });
    await user.click(screen.getByRole('button', { name: /Kimi/ }));
    expect(screen.getByText(/wasn’t found on your machine/)).toBeInTheDocument();
  });

  it('renders the config only when asked for it', async () => {
    const { screen, backend, user } = mountWithProviders(AgentHooksPanel, {
      commands: baseCommands(),
    });
    await until(() => screen.queryAllByRole('button', { name: /Claude Code/ }).length > 0, {
      label: 'agent list',
    });
    // Not one round-trip per agent up front…
    expect(backend.called('render_agent_hooks_config')).toBe(false);
    await user.click(screen.getByRole('button', { name: /Show config/ }));
    await until(() => backend.called('render_agent_hooks_config'), { label: 'config' });
    expect(backend.lastCallTo('render_agent_hooks_config')?.args.agent).toBe('claude');
  });
});
