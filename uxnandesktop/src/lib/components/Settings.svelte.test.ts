/**
 * Settings → Browser. The per-agent MCP toggles are the browser half of the
 * "one row per agent" language Settings → Hooks uses, and they render from the
 * backend's own catalog (`mcp_info`), so what is tested here is that contract:
 * every agent the backend offers gets a row with its config file and a switch,
 * and the switch writes the agent's id into `mcpDisabledAgents`.
 *
 * They used to be a wrapped grid of bare switches inside a single settings row,
 * with no test at all — a shape that could disappear without anything noticing.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { app } from '$lib/state/app.svelte';
import Settings from './Settings.svelte';

function browserCommands() {
  return {
    mcp_info: () => ({
      endpoint: 'http://127.0.0.1:5599/mcp',
      token: 'tok',
      tokenEnv: 'UXNAN_MCP_TOKEN',
      serverName: 'uxnan-browser',
      agents: [
        { id: 'claude', label: 'Claude Code', configPath: '/home/u/.claude.json' },
        { id: 'codex', label: 'Codex', configPath: '/home/u/.codex/config.toml' },
      ],
    }),
    save_settings: () => undefined,
  };
}

describe('Settings → Browser', () => {
  beforeEach(() => {
    app.settingsOpen = true;
    app.settingsSection = 'browser';
    app.settings.browser = undefined;
    document.body.style.pointerEvents = '';
  });

  it('lists every agent the backend offers, with the file its entry lands in', async () => {
    const { screen } = mountWithProviders(Settings, { commands: browserCommands() });
    await until(() => screen.queryAllByText('Claude Code').length > 0, { label: 'agent rows' });
    expect(screen.getByText('Codex')).toBeInTheDocument();
    // The path is the row's own metadata, not something only the docs know.
    expect(screen.getByText('/home/u/.claude.json')).toBeInTheDocument();
    expect(screen.getByText('/home/u/.codex/config.toml')).toBeInTheDocument();
  });

  it("turns one agent's injection off without touching the others", async () => {
    const { screen, user } = mountWithProviders(Settings, { commands: browserCommands() });
    await until(() => screen.queryAllByRole('switch', { name: /Codex/ }).length > 0, {
      label: 'agent rows',
    });
    // Every agent is on until it is explicitly disabled.
    expect(app.settings.browser?.mcpDisabledAgents ?? []).toEqual([]);
    await user.click(
      screen.getByRole('switch', { name: 'Set up the browser tools for Codex' }),
    );
    await until(() => (app.settings.browser?.mcpDisabledAgents ?? []).length > 0, {
      label: 'disabled list',
    });
    expect(app.settings.browser?.mcpDisabledAgents).toEqual(['codex']);
  });
});
