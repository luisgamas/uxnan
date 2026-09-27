import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/presentation/screens/profile/usage_format.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';

UsageWindow _window(double used, {required Duration left, int minutes = 300}) =>
    UsageWindow(
      id: 'w',
      label: 'Session',
      usedPercent: used,
      windowMinutes: minutes,
      resetsAt: DateTime(2026, 9, 26, 12).add(left),
    );

void main() {
  final now = DateTime(2026, 9, 26, 12);

  test('spending faster than the window passes: when the limit is hit', () {
    // 3 of 5 hours passed, 72% used → 1% per 2.5 min → 28% more in 70 min,
    // before the reset in 2 h.
    final pace =
        WindowPace.of(_window(72, left: const Duration(hours: 2)), now)!;
    expect(pace.elapsed, closeTo(0.6, 1e-9));
    expect(pace.runsOutIn, const Duration(minutes: 70));
  });

  test('slower than the window passes: on pace, no warning', () {
    final pace =
        WindowPace.of(_window(20, left: const Duration(hours: 2)), now)!;
    expect(pace.runsOutIn, isNull);
  });

  test('no length, no reset, or barely begun: nothing to say', () {
    expect(
      WindowPace.of(
        const UsageWindow(id: 'w', label: 'x', usedPercent: 50),
        now,
      ),
      isNull,
    );
    expect(
      WindowPace.of(_window(1, left: const Duration(minutes: 299)), now),
      isNull,
    );
  });

  test('a spent window has hit its limit', () {
    final pace =
        WindowPace.of(_window(100, left: const Duration(hours: 1)), now)!;
    expect(pace.runsOutIn, Duration.zero);
  });

  test('durations and figures, short', () {
    expect(shortDuration(const Duration(minutes: 45)), '45min');
    expect(shortDuration(const Duration(hours: 6, minutes: 30)), '6h 30min');
    expect(shortDuration(const Duration(days: 3, hours: 4)), '3d 4h');
    expect(fmtTokens(980), '980');
    expect(fmtTokens(12400), '12K');
    expect(fmtTokens(3100000), '3.1M');
    expect(fmtTokens(12.7e9), '13B');
    expect(fmtUsd(0.004), r'<$0.01');
    expect(fmtUsd(12.5, locale: 'en_US'), r'$12.50');
    expect(fmtUsd(4384.2, locale: 'en_US'), r'$4,384');
  });
}
