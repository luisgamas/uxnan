import 'package:uxnan/core/utils/logger.dart';

/// Tolerant enum decoding for values that were persisted by *another* build.
extension EnumByNameOr<T extends Enum> on Iterable<T> {
  /// Like `byName`, but returns [fallback] instead of throwing when [name] is
  /// not a value of this enum.
  ///
  /// The local database outlives any single build of the app: a row written by
  /// a build that knew an extra enum value (a newer feature, a branch build, a
  /// downgrade after a rollback) must not crash the reader that no longer
  /// knows it. Decoding degrades to [fallback] and logs once per row instead.
  T byNameOr(String name, T fallback) {
    for (final value in this) {
      if (value.name == name) return value;
    }
    AppLogger.warn('unknown ${fallback.runtimeType} "$name" → $fallback');
    return fallback;
  }
}
