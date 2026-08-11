import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('phase five work-surface batch B contracts', () => {
  it('keeps browser chrome on shared controls without changing native-window lifecycle code', () => {
    const browser = source('BrowserPanel.svelte');

    expect(browser).toContain('import { Button } from "$lib/components/ui/button"');
    expect(browser).toContain('import { Input } from "$lib/components/ui/input"');
    expect(browser).toContain('import { focus, icon } from "$lib/design"');
    expect(browser).toContain('size="icon-xs"');
    expect(browser).toContain('density="compact"');
    expect(browser).toContain('overlayCovers(r)');
    expect(browser).toContain('browserWindowSetBounds');
    expect(browser).not.toMatch(/<button\b/);
  });

  it('uses Bits Tabs for file-view and staged selectors', () => {
    const fileTabs = source('FileTabView.svelte');

    expect(fileTabs).toContain('import * as Tabs from "$lib/components/ui/tabs"');
    expect(fileTabs).toContain('tabStyle.segmentedList');
    expect(fileTabs).toContain('tabStyle.segmentedTrigger');
    expect(fileTabs).toContain('value="unstaged"');
    expect(fileTabs).toContain('value="staged"');
    expect(fileTabs).toContain('value={shown}');
    expect(fileTabs).not.toMatch(/class=\{cn\([^\n]*\bh-6\b/);
  });

  it('keeps diff actions and mode switching accessible at compact density', () => {
    const diff = source('DiffView.svelte');

    expect(diff).toContain('import { Button } from "$lib/components/ui/button"');
    expect(diff).toContain('import * as Tabs from "$lib/components/ui/tabs"');
    expect(diff).toContain('tabStyle.segmentedList');
    expect(diff).toContain('size="icon-xs"');
    expect(diff).toContain('size="xs"');
    expect(diff).toContain('focus.ring');
    expect(diff).not.toMatch(/<button\b/);
  });

  it('keeps editor notices and preview actions on shared target primitives', () => {
    const editor = source('FileEditor.svelte');
    const preview = source('FilePreview.svelte');
    const directory = source('DirectoryBrowser.svelte');

    expect(editor).not.toMatch(/class=\{cn\([^\n]*\bh-6\b/);
    expect(preview).toContain('import { Button } from "$lib/components/ui/button"');
    expect(preview).toContain('size="icon-xs"');
    expect(preview).not.toMatch(/<button\b/);
    expect(directory).toContain('row.list');
    expect(directory).toContain('density="compact"');
  });
});
