import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/utils/elapsed_format.dart';

void main() {
  group('formatElapsed', () {
    test('says seconds under a minute', () {
      expect(formatElapsed(Duration.zero), '0s');
      expect(formatElapsed(const Duration(seconds: 45)), '45s');
      expect(formatElapsed(const Duration(milliseconds: 59999)), '59s');
    });

    test('says minutes and seconds under an hour', () {
      expect(formatElapsed(const Duration(minutes: 1, seconds: 3)), '1m 3s');
      expect(formatElapsed(const Duration(minutes: 5, seconds: 52)), '5m 52s');
      expect(
        formatElapsed(const Duration(minutes: 59, seconds: 59)),
        '59m 59s',
      );
    });

    test('says hours and minutes from an hour on', () {
      expect(formatElapsed(const Duration(hours: 2, minutes: 5)), '2h 5m');
      expect(formatElapsed(const Duration(hours: 1, seconds: 30)), '1h 0m');
    });

    test('is never negative', () {
      expect(formatElapsed(const Duration(seconds: -5)), '0s');
    });
  });
}
