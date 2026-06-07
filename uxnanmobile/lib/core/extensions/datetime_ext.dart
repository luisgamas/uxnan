/// Convenience helpers on [DateTime] used across the app.
extension DateTimeExt on DateTime {
  /// This instant as Unix epoch milliseconds in UTC.
  int get epochMs => toUtc().millisecondsSinceEpoch;

  /// Whether this instant is within [tolerance] of [other] in either
  /// direction. Used to validate handshake timestamps against clock skew.
  bool isWithin(Duration tolerance, DateTime other) {
    return difference(other).abs() <= tolerance;
  }

  /// Whether this instant is strictly in the past relative to the current
  /// wall-clock time.
  bool get isPast => isBefore(DateTime.now());
}

/// Builds a [DateTime] from Unix epoch [milliseconds] in UTC.
DateTime dateTimeFromEpochMs(int milliseconds) =>
    DateTime.fromMillisecondsSinceEpoch(milliseconds, isUtc: true);
