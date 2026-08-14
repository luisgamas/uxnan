import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('phase-four settings group A contracts', () => {
  it('uses the shared settings navigation role and keeps provider tabs scrollable', () => {
    const settings = source('Settings.svelte');
    expect(settings).toContain('row.settingsNav');
    expect(settings).toContain('max-w-full shrink-0 justify-start gap-1 overflow-x-auto');
    expect(settings).not.toContain('"flex h-8 items-center gap-2 rounded-md px-2 text-left');
    // The browser-MCP agents are settings rows, not a wrapped grid of bare
    // switches: one row per agent, its switch on the right like every other
    // setting — the same shape the hooks list uses.
    expect(settings).not.toContain('flex flex-wrap gap-x-6 gap-y-2.5');
    expect(settings).toContain('i18n.t("browser.mcpAgentAria"');
    expect(settings).toContain('<AgentSettingsRow');
  });

  it('lists hook agents in the shared settings surfaces, with no nav rail of its own', () => {
    const hooks = source('AgentHooksPanel.svelte');
    expect(hooks).toContain('panel.settingsBody');
    expect(hooks).toContain('<SettingsRow');
    // Both agent lists go through the same row component, so the browser and
    // hooks lists cannot drift apart into two different shapes again.
    expect(hooks).toContain('<AgentSettingsRow');
    // A rail here nested a second navigation surface inside a pane that already
    // has one, and hid the per-agent state the panel exists to show.
    expect(hooks).not.toContain('row.settingsNav');
    expect(hooks).not.toContain('md:w-44');
    expect(hooks).not.toContain('size="xs"');
  });

  it('keeps settings editors free of undersized interactive geometry', () => {
    for (const name of [
      'ProviderUsageEditor.svelte',
      'QuickCommandsSettings.svelte',
      'OpenWithSettings.svelte',
      'GithubSettings.svelte',
    ]) {
      const content = source(name);
      expect(content, name).not.toMatch(/class=[^\n>]*\bh-[67]\b/);
    }
    expect(source('QuickCommandsSettings.svelte')).toContain('grid-cols-1 gap-3 sm:grid-cols-2');
    expect(source('OpenWithSettings.svelte')).toContain('density="compact"');
    expect(source('ProviderUsageEditor.svelte')).toContain(
      'aria-label={i18n.t("providers.removeProvider")}',
    );
    expect(source('GithubSettings.svelte')).toContain(
      'aria-label={i18n.t("github.settings.poll")}',
    );
  });

  it('shares settings surfaces and aligns theme and agent content', () => {
    const themes = source('ThemeSettings.svelte');
    const pets = source('PetsSettings.svelte');
    const resources = source('ResourceSettings.svelte');
    const resourceMode = source('ResourceModeSection.svelte');
    const agent = source('AgentProfileEditor.svelte');

    expect(themes.match(/panel\.settingsPreview/g)?.length).toBeGreaterThanOrEqual(4);
    expect(pets).toContain('panel.settingsBody');
    expect(pets).not.toContain('triggerClass="w-56"');
    expect(resources.match(/panel\.settingsBody/g)?.length).toBe(3);
    expect(resourceMode.match(/panel\.settingsBody/g)?.length).toBe(3);
    expect(agent).toContain('size="icon-xs"');
    expect(agent).toContain('class="size-5"');
  });
});
