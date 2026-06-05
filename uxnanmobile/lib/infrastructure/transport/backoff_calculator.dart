import 'dart:math';

/// Computes exponential backoff delays for reconnection attempts.
///
/// Sequence (spec 02c §11.3): ~1s, 2s, 4s, 8s, 16s, 32s, then capped at 60s,
/// each with up to ±30% jitter to avoid a thundering herd.
class BackoffCalculator {
  /// Creates a [BackoffCalculator]. A custom [random] can be injected for
  /// deterministic tests.
  BackoffCalculator({Random? random}) : _random = random ?? Random();

  final Random _random;

  static const int _baseDurationSec = 1;
  static const int _maxDurationSec = 60;
  static const double _jitterFactorMax = 0.3;

  /// The un-jittered base delay (in seconds) for a 1-based [attempt].
  static double baseSeconds(int attempt) {
    final exp = _baseDurationSec * pow(2, attempt - 1).toDouble();
    return min(exp, _maxDurationSec.toDouble());
  }

  /// Computes the (jittered) delay for a 1-based [attempt].
  Duration compute(int attempt) {
    final base = baseSeconds(attempt);
    final jitter = base * _jitterFactorMax * (_random.nextDouble() * 2 - 1);
    final millis = ((base + jitter) * 1000).round();
    return Duration(milliseconds: max(0, millis));
  }
}
