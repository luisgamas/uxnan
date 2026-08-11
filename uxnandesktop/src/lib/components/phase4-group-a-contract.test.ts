import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('phase-four settings group A contracts', () => {
  it('uses the shared settings navigation role and keeps provider tabs scrollable', () => {
    const settings = source('Settings.svelte');
    expect(settings).toContain('row.settingsNav');
    expect(settings).toContain('max-w-full shrink-0 justify-start gap-1 overflow-x-auto');
    expect(settings).not.toContain('"flex h-8 items-center gap-2 rounded-md px-2 text-left');
  });

  it('keeps hooks usable at narrow widths with standard controls', () => {
    const hooks = source('AgentHooksPanel.svelte');
    expect(hooks).toContain('flex min-w-0 flex-col gap-4 md:flex-row');
    expect(hooks).toContain('w-full min-w-0 overflow-y-auto md:w-44');
    expect(hooks).toContain('row.settingsNav');
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
