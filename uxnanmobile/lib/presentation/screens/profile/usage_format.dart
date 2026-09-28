import 'package:intl/intl.dart';

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
/// `$4.20`, `$9,559`, `<$0.01`, `€4.20`, `120 credits`. The same rule as the
/// desktop's `formatMoney`: amounts are written the way their currency is (US
/// dollars as `$1,234.56` in every UI language — providers bill in them), with
/// cents under 100 and whole units from 100 on, and a trace as `<$0.01`.
/// `credits` is a count, not a currency.
String fmtMoney(double amount, [String currency = 'USD']) {
  if (currency.toLowerCase() == 'credits') return '${amount.round()} credits';
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
