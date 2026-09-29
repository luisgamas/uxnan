import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/core/utils/clock_format.dart';

/// Every clock time the app shows is on the 24-hour clock, in every language.
/// The same moment used to read `00:25` in one list and `12:25 AM` beside it.
void main() {
  final afternoon = DateTime(2026, 9, 12, 14, 30);
  final pastMidnight = DateTime(2026, 9, 12, 0, 25);

  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('es');
  });

  tearDown(() => Intl.defaultLocale = null);

  test('the clock is 24-hour in every language', () {
    for (final locale in ['en', 'es']) {
      Intl.defaultLocale = locale;
      expect(formatClock(afternoon), '14:30', reason: locale);
      expect(formatClock(pastMidnight), '00:25', reason: locale);
    }
  });

  test('today reads as a time, an earlier day as a date', () {
    Intl.defaultLocale = 'en';
    final now = DateTime(2026, 9, 12, 20);
    expect(formatWhen(afternoon, now: now), '14:30');
    expect(formatWhen(afternoon, now: DateTime(2026, 9, 14)), 'Sep 12');
  });

  test('an earlier day can keep its time when the line must say when', () {
    Intl.defaultLocale = 'en';
    expect(
      formatWhen(afternoon, keepClock: true, now: DateTime(2026, 9, 14)),
      'Sep 12, 14:30',
    );
  });
}
