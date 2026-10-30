/**
 * The catalog agents found here and turning them on: the one owner Settings →
 * Agents and the welcome tour share.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installFakeBackend } from '../../test/tauri';
import { app } from '$lib/state/app.svelte';
import { AGENT_CATALOG } from '$lib/agentCatalog';
import { catalogAgents, profileKey } from './catalogAgents.svelte';

const claude = AGENT_CATALOG.find((c) => c.command === 'claude')!;
const codex = AGENT_CATALOG.find((c) => c.command === 'codex')!;
const saved = () => ({ version: 1, repos: [], settings: {}, agentCache: [] });

afterEach(() => {
  app.settings.agentProfiles = [];
  catalogAgents.installed = null;
});

describe('catalogAgents', () => {
  it('matches commands the way a person types them', () => {
    expect(profileKey('  Claude ')).toBe('claude');
    expect(profileKey('open code')).toBe('opencode');
  });

  it('detects what is installed, and reads no backend as nothing found', async () => {
    installFakeBackend({ agents_detect: () => ['claude', 'codex'] });
    await catalogAgents.detect();
    expect(catalogAgents.found.map((c) => c.command)).toEqual(
      AGENT_CATALOG.filter((c) => c.command === 'claude' || c.command === 'codex').map((c) => c.command),
    );
    installFakeBackend({
      agents_detect: () => {
        throw new Error('no backend');
      },
    });
    await catalogAgents.detect();
    expect(catalogAgents.found).toEqual([]);
    expect(catalogAgents.detecting).toBe(false);
  });

  it('adds only what is not set up yet, and saves once', async () => {
    const backend = installFakeBackend({ agents_detect: () => ['claude', 'codex'], update_settings: saved });
    await catalogAgents.detect();
    app.settings.agentProfiles = [
      { id: 'x', name: 'Mine', command: ' CLAUDE', args: [], terminalProfileId: null, icon: null },
    ];
    expect(catalogAgents.isConfigured(claude)).toBe(true);
    expect(catalogAgents.addable).toEqual([codex]);
    expect(catalogAgents.add([claude, codex])).toBe(1);
    expect(app.settings.agentProfiles.map((p) => p.command)).toEqual([' CLAUDE', 'codex']);
    expect(app.settings.agentProfiles[1]).toMatchObject({ name: codex.name, args: [], icon: codex.logo });
    expect(catalogAgents.addAllInstalled()).toBe(0);
    expect(backend.calls.filter((c) => c.command === 'update_settings').length).toBe(1);
  });
});
