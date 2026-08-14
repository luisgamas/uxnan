import { describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../../../test/render';
import { toast } from 'svelte-sonner';
import Toaster from './sonner.svelte';

describe('Toaster', () => {
  it('wears the shell surface rather than a coloured card', async () => {
    // sonner's `richColors` paints a saturated, full-bleed card per type, which
    // is a different design language from this app: neutral surfaces, quiet
    // hairlines, 12–13px text. Next to a panel it read as a web notification
    // dropped into a tool.
    mountWithProviders(Toaster, { props: { position: 'bottom-right' } });
    toast.error('git error: cannot change to that folder');

    await until(() => document.querySelector('[data-sonner-toast]') !== null, {
      label: 'the toast',
    });
    const el = document.querySelector<HTMLElement>('[data-sonner-toast]')!;

    expect(el.className).toContain('bg-[var(--ux-elevated)]');
    expect(el.className).toContain('border-border/60');
    expect(el.className).toContain('rounded-lg');
    expect(el.className).toContain('text-[13px]');
    // The type is said by the icon, never by the card.
    expect(el.className).toContain('[&_[data-icon]]:text-destructive');
    expect(el.dataset.richColors).not.toBe('true');
  });
});
