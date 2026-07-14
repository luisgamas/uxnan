/// How often the profile's "Usage & credit" section auto-refreshes provider
/// usage while a PC is connected. Persisted; the data is always kept in memory
/// so scrolling never reloads it — this only controls background polling.
enum UsageRefreshInterval {
  /// Never poll automatically — only the manual refresh button fetches. The
  /// default (usage is only fetched when you open the profile or tap refresh).
  manual,

  /// Every 5 minutes.
  every5m,

  /// Every 10 minutes.
  every10m,

  /// Every 20 minutes.
  every20m,

  /// Every hour.
  every1h,
}

/// Convenience accessors for [UsageRefreshInterval].
extension UsageRefreshIntervalX on UsageRefreshInterval {
  /// The polling period, or null for [UsageRefreshInterval.manual].
  Duration? get duration => switch (this) {
        UsageRefreshInterval.manual => null,
        UsageRefreshInterval.every5m => const Duration(minutes: 5),
        UsageRefreshInterval.every10m => const Duration(minutes: 10),
        UsageRefreshInterval.every20m => const Duration(minutes: 20),
        UsageRefreshInterval.every1h => const Duration(hours: 1),
      };

  /// Parses a stored name back to an interval, defaulting to [manual].
  static UsageRefreshInterval fromName(String? name) {
    for (final value in UsageRefreshInterval.values) {
      if (value.name == name) return value;
    }
    return UsageRefreshInterval.manual;
  }
}
