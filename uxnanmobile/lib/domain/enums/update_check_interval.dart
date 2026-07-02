/// How often the app-update checker runs an automatic store check.
///
/// The user picks one of these in the Updates settings section; the controller
/// throttles its automatic [maybeCheck] by the matching [minGap]. Manual checks
/// ("Check now") always run, regardless of the interval.
enum UpdateCheckInterval {
  /// Check on every launch / resume (no throttle).
  everyLaunch,

  /// Check at most once every 6 hours.
  every6h,

  /// Check at most once every 12 hours.
  every12h,

  /// Check at most once every 24 hours (the default).
  every24h,

  /// Check at most once every 48 hours.
  every48h,

  /// Check at most once a week.
  weekly,

  /// Check at most once a month (~30 days).
  monthly;

  /// The default interval when the user has not chosen one.
  static const UpdateCheckInterval defaultInterval =
      UpdateCheckInterval.every24h;
}

/// The minimum gap between automatic checks for each [UpdateCheckInterval].
extension UpdateCheckIntervalGap on UpdateCheckInterval {
  /// The minimum time that must elapse since the last check before an
  /// automatic check runs again. [UpdateCheckInterval.everyLaunch] is
  /// [Duration.zero] (never throttled).
  Duration get minGap => switch (this) {
        UpdateCheckInterval.everyLaunch => Duration.zero,
        UpdateCheckInterval.every6h => const Duration(hours: 6),
        UpdateCheckInterval.every12h => const Duration(hours: 12),
        UpdateCheckInterval.every24h => const Duration(hours: 24),
        UpdateCheckInterval.every48h => const Duration(hours: 48),
        UpdateCheckInterval.weekly => const Duration(days: 7),
        UpdateCheckInterval.monthly => const Duration(days: 30),
      };
}
