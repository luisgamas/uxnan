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

/// US dollars for a total: cents under $100, whole dollars past it, and
/// `<$0.01` for a trace.
String fmtUsd(double n, {String? locale}) {
  if (n > 0 && n < 0.01) return r'<$0.01';
  return NumberFormat.currency(
    locale: locale,
    symbol: r'$',
    decimalDigits: n >= 100 ? 0 : 2,
  ).format(n);
}

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
