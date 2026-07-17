/// How the profile's stats refresh themselves while a PC is connected.
///
/// Every mode still loads once per (re)connection and always answers the
/// profile's manual refresh button — this only picks what happens *between*
/// those two moments. Persisted.
enum MetricsRefreshInterval {
  /// Refresh whenever the profile is opened (no background polling). The
  /// default: the stats are current every time you look at them, which is what
  /// staying on a live connection otherwise never did.
  automatic,

  /// Every 5 minutes.
  every5m,

  /// Every 15 minutes.
  every15m,

  /// Every 30 minutes.
  every30m,

  /// Every hour.
  every1h,

  /// Never refresh on its own — only the profile's refresh button fetches.
  manual,
}

/// Convenience accessors for [MetricsRefreshInterval].
extension MetricsRefreshIntervalX on MetricsRefreshInterval {
  /// The polling period, or null for the non-polling modes
  /// ([MetricsRefreshInterval.automatic] and [MetricsRefreshInterval.manual]).
  Duration? get duration => switch (this) {
        MetricsRefreshInterval.automatic => null,
        MetricsRefreshInterval.every5m => const Duration(minutes: 5),
        MetricsRefreshInterval.every15m => const Duration(minutes: 15),
        MetricsRefreshInterval.every30m => const Duration(minutes: 30),
        MetricsRefreshInterval.every1h => const Duration(hours: 1),
        MetricsRefreshInterval.manual => null,
      };

  /// Whether opening the profile re-fetches the stats.
  bool get refreshesOnOpen => this == MetricsRefreshInterval.automatic;

  /// Parses a stored name back to an interval, defaulting to [automatic].
  static MetricsRefreshInterval fromName(String? name) {
    for (final value in MetricsRefreshInterval.values) {
      if (value.name == name) return value;
    }
    return MetricsRefreshInterval.automatic;
  }
}
