import { describe, expect, it } from 'vitest';
import { app } from '$lib/state/app.svelte';
import { DEFAULT_SETTINGS } from './types';
import { balanceLabel, formatAmount, formatBalanceFigure, windowLabel } from './usageLabels';

describe('windowLabel', () => {
  it('localizes the ids every provider shares, and a model-scoped week', () => {
    app.settings = { ...DEFAULT_SETTINGS, language: 'es' };
    expect(windowLabel({ id: 'session5h', label: 'Session (5h)', usedPercent: 1 })).toBe(
      'Sesión (5 h)',
    );
    expect(windowLabel({ id: 'weekly_all', label: 'Weekly', usedPercent: 1 })).toBe('Semanal');
    expect(windowLabel({ id: '3p-weekly', label: 'Claude and GPT models', usedPercent: 1 })).toBe(
      'Modelos Claude y GPT',
    );
    expect(
      windowLabel({
        id: 'weekly_fable',
        label: 'Fable (weekly)',
        model: 'Fable',
        windowMinutes: 10_080,
        usedPercent: 0,
      }),
    ).toBe('Fable (semanal)');
    app.settings = { ...DEFAULT_SETTINGS, language: 'en' };
  });

  it("falls back to the bridge's English label for an id it does not know", () => {
    expect(windowLabel({ id: 'limit7', label: 'Something new', usedPercent: 1 })).toBe(
      'Something new',
    );
  });
});

describe('balances', () => {
  it('word credits in the UI language, singular and plural', () => {
    app.settings = { ...DEFAULT_SETTINGS, language: 'es' };
    const credits = (available: number) =>
      formatBalanceFigure({ used: 0, available, currency: 'credits', period: 'AI credits' });
    expect(credits(1)).toBe('1 crédito disponible');
    expect(credits(120)).toBe('120 créditos disponibles');
    expect(formatAmount(2, 'credits')).toBe('2 créditos');
    expect(balanceLabel({ used: 0, currency: 'USD', period: 'Budget', scope: 'Model One' })).toBe(
      'Presupuesto · Model One',
    );
    app.settings = { ...DEFAULT_SETTINGS, language: 'en' };
    expect(credits(1)).toBe('1 credit available');
  });

  it('shows money left, or spent of its limit; an unknown name as is', () => {
    expect(
      formatBalanceFigure({ used: 0, available: 25, currency: 'USD', period: 'Prepaid' }),
    ).toBe('$25.00 available');
    expect(formatBalanceFigure({ used: 12.5, limit: 50, currency: 'USD', period: 'Budget' })).toBe(
      '$12.50 / $50.00',
    );
    expect(balanceLabel({ used: 0, currency: 'USD', period: 'Something new' })).toBe(
      'Something new',
    );
  });
});
