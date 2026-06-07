import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/transport/backoff_calculator.dart';

void main() {
  group('BackoffCalculator', () {
    test('base sequence is exponential and capped at 60s', () {
      expect(BackoffCalculator.baseSeconds(1), 1);
      expect(BackoffCalculator.baseSeconds(2), 2);
      expect(BackoffCalculator.baseSeconds(3), 4);
      expect(BackoffCalculator.baseSeconds(4), 8);
      expect(BackoffCalculator.baseSeconds(5), 16);
      expect(BackoffCalculator.baseSeconds(6), 32);
      expect(BackoffCalculator.baseSeconds(7), 60);
      expect(BackoffCalculator.baseSeconds(10), 60);
    });

    test('compute stays within +/-30% jitter of the base', () {
      final calc = BackoffCalculator(random: Random(42));
      for (var attempt = 1; attempt <= 8; attempt++) {
        final base = BackoffCalculator.baseSeconds(attempt);
        for (var i = 0; i < 20; i++) {
          final ms = calc.compute(attempt).inMilliseconds;
          expect(ms, greaterThanOrEqualTo((base * 0.7 * 1000).round() - 1));
          expect(ms, lessThanOrEqualTo((base * 1.3 * 1000).round() + 1));
        }
      }
    });

    test('compute never returns a negative delay', () {
      final calc = BackoffCalculator(random: Random(7));
      for (var i = 0; i < 100; i++) {
        expect(calc.compute(1).inMilliseconds, greaterThanOrEqualTo(0));
      }
    });
  });
}
