// The localized names the usage UI shows — a window's name, a balance's name and
// figure — in one place, so Settings → Providers and the status-bar popover
// always say the same thing in the same language. The bridge sends stable ids
// and English fallbacks (`shared/src/models/usage.ts`); the phone's
// `usage_format.dart` follows the same tables.

import { i18n } from './i18n';
import { formatMoney } from './usageFormat';

import type { MessageKey } from './i18n/locales/en';
import type { CreditBalance, UsageWindow } from './types';

/** Window ids every provider shares, by what they measure. */
const WINDOW_KEYS: Record<string, MessageKey> = {
  session: 'providers.window.session',
  session5h: 'providers.window.session',
  five_hour: 'providers.window.session',
  daily: 'providers.window.daily',
  weekly: 'providers.window.weekly',
  weekly_all: 'providers.window.weekly',
  seven_day: 'providers.window.weekly',
  monthly: 'providers.window.monthly',
  chat: 'providers.window.chat',
  completions: 'providers.window.completions',
  premium_interactions: 'providers.window.premium',
  individual: 'providers.window.spendLimit',
  'gemini-weekly': 'providers.window.geminiModels',
  '3p-weekly': 'providers.window.claudeGptModels',
};

/** A window's name in the UI language: a known id localized, a model-scoped
 *  weekly window as "{model} (weekly)", anything else the bridge's English
 *  label. The phone's `windowLabel` follows the same table. */
export function windowLabel(window: UsageWindow): string {
  const key = WINDOW_KEYS[window.id];
  if (key) return i18n.t(key);
  if (window.model && window.windowMinutes === 10_080) {
    return i18n.t('providers.window.modelWeekly', { model: window.model });
  }
  return window.label;
}

/** What each balance the bridge names is, in the UI language. */
const BALANCE_KEYS: Record<string, MessageKey> = {
  'Monthly credits': 'providers.balance.monthlyCredits',
  Credits: 'providers.balance.credits',
  'On-demand': 'providers.balance.onDemand',
  Prepaid: 'providers.balance.prepaid',
  'AI credits': 'providers.balance.aiCredits',
  Budget: 'providers.balance.budget',
};

/** A balance's name, localized when the bridge names a known one, with what
 *  it covers when that is narrower than the account ("Budget · Model One"). */
export function balanceLabel(balance: CreditBalance): string {
  const key = BALANCE_KEYS[balance.period];
  const name = key ? i18n.t(key) : balance.period;
  return balance.scope ? `${name} · ${balance.scope}` : name;
}

/** An amount in a balance's unit: money through {@link formatMoney}, a count
 *  of credits as words ("1 credit", "120 créditos"). */
export function formatAmount(amount: number, currency: string): string {
  if (currency.toLowerCase() === 'credits') {
    return i18n.plural(Math.round(amount), 'providers.creditsOne', 'providers.creditsOther');
  }
  return formatMoney(amount, currency);
}

/** A balance's figure: what is left when that is all the provider says
 *  ("$25.00 available", "120 credits available"), else spent of its limit
 *  ("$12.50 / $50.00"). */
export function formatBalanceFigure(balance: CreditBalance): string {
  if (balance.limit == null && balance.available != null) {
    if (balance.currency.toLowerCase() === 'credits') {
      return i18n.plural(
        Math.round(balance.available),
        'providers.creditsAvailableOne',
        'providers.creditsAvailableOther',
      );
    }
    return i18n.t('providers.moneyAvailable', {
      amount: formatMoney(balance.available, balance.currency),
    });
  }
  const used = formatAmount(balance.used, balance.currency);
  return balance.limit != null
    ? `${used} / ${formatAmount(balance.limit, balance.currency)}`
    : used;
}
