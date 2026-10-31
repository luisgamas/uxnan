import 'package:intl/intl.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// A token count, compact: `840`, `1.2K`, `231K`, `1.5M`, `12B`.
String fmtTokens(num n) {
  const units = [(1e12, 'T'), (1e9, 'B'), (1e6, 'M'), (1e3, 'K')];
  for (final (size, unit) in units) {
    if (n >= size) {
      final v = n / size;
      final text = v >= 10
          ? '${v.round()}'
          : v.toStringAsFixed(1).replaceFirst(RegExp(r'\.0$'), '');
      return '$text$unit';
    }
  }
  return '${n.round()}';
}

/// Every amount of money the app shows, in one place (spend, cost, credit):
/// `$4.20`, `$9,559`, `<$0.01`, `€4.20`. The same rule as the desktop's
/// `formatMoney`: amounts are written the way their currency is (US dollars as
/// `$1,234.56` in every UI language — providers bill in them), with cents
/// under 100 and whole units from 100 on, and a trace as `<$0.01`. A count of
/// `credits` is not money: [balanceFigure] words it.
String fmtMoney(double amount, [String currency = 'USD']) {
  final code = currency.toUpperCase();
  if (amount > 0 && amount < 0.01) return '<${_money(code, 2).format(0.01)}';
  return _money(code, amount.abs() >= 100 ? 0 : 2).format(amount);
}

NumberFormat _money(String code, int digits) => NumberFormat.currency(
      locale: 'en_US',
      name: code,
      symbol: NumberFormat.simpleCurrency(locale: 'en_US', name: code)
          .currencySymbol,
      decimalDigits: digits,
    );

/// A duration, short: `45min`, `6h 30min`, `3d 4h`.
String shortDuration(Duration d) {
  if (d.inDays >= 1) {
    final h = d.inHours % 24;
    return h == 0 ? '${d.inDays}d' : '${d.inDays}d ${h}h';
  }
  final hours = d.inHours;
  final minutes = d.inMinutes % 60;
  if (hours == 0) return '${minutes}min';
  return minutes == 0 ? '${hours}h' : '${hours}h ${minutes}min';
}

/// A quota window's name in the UI language: a stable id the bridge sends
/// localized, a model-scoped weekly window as "{model} (weekly)", anything
/// else the bridge's English label. The desktop's `windowLabel`
/// (`usageLabels.ts`) follows the same table.
String windowLabel(AppLocalizations l10n, UsageWindow window) {
  final known = switch (window.id) {
    'session' || 'session5h' || 'five_hour' => l10n.usageWindowSession,
    'daily' => l10n.usageWindowDaily,
    'weekly' || 'weekly_all' || 'seven_day' => l10n.usageWindowWeekly,
    'monthly' => l10n.usageWindowMonthly,
    'chat' => l10n.usageWindowChat,
    'completions' => l10n.usageWindowCompletions,
    'premium_interactions' => l10n.usageWindowPremium,
    'individual' => l10n.usageWindowSpendLimit,
    'gemini-weekly' => l10n.usageWindowGeminiModels,
    '3p-weekly' => l10n.usageWindowClaudeGptModels,
    _ => null,
  };
  if (known != null) return known;
  final model = window.model;
  if (model != null && window.windowMinutes == 10080) {
    return l10n.usageWindowModelWeekly(model);
  }
  return window.label;
}

/// A balance's name, localized when the bridge names a known one, with what
/// it covers when narrower than the account ("Budget · Model One").
String balanceLabel(AppLocalizations l10n, CreditBalance balance) {
  final name = switch (balance.period) {
    'Monthly credits' => l10n.usageBalanceMonthlyCredits,
    'Credits' => l10n.usageBalanceCredits,
    'On-demand' => l10n.usageBalanceOnDemand,
    'Prepaid' => l10n.usageBalancePrepaid,
    'AI credits' => l10n.usageBalanceAiCredits,
    'Budget' => l10n.usageBalanceBudget,
    _ => balance.period,
  };
  final scope = balance.scope;
  return scope == null ? name : '$name · $scope';
}

/// An amount in a balance's unit: money through [fmtMoney], a count of
/// credits as words ("1 credit", "120 créditos").
String fmtAmount(AppLocalizations l10n, double amount, String currency) =>
    currency.toLowerCase() == 'credits'
        ? l10n.usageCredits(amount.round())
        : fmtMoney(amount, currency);

/// A balance's figure: what is left when that is all the provider says
/// ("$25.00 available", "120 credits available"), else spent of its limit
/// ("$12.50 / $50.00").
String balanceFigure(AppLocalizations l10n, CreditBalance balance) {
  final available = balance.available;
  final limit = balance.limit;
  if (limit == null && available != null) {
    return balance.currency.toLowerCase() == 'credits'
        ? l10n.usageCreditsAvailable(available.round())
        : l10n.usageCreditAvailable(fmtMoney(available, balance.currency));
  }
  final used = fmtAmount(l10n, balance.used, balance.currency);
  return limit == null
      ? used
      : '$used / ${fmtAmount(l10n, limit, balance.currency)}';
}
