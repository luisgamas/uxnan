import 'package:uxnan/domain/value_objects/provider_usage.dart';

/// Where a usage window stands: how much of its time has passed, and — when
/// the pace so far would use the rest before it resets — how soon the limit
/// is reached.
class WindowPace {
  /// Creates a [WindowPace].
  const WindowPace({required this.elapsed, this.runsOutIn});

  /// The share of the window's time that has passed, 0–1.
  final double elapsed;

  /// How soon the limit is reached at the pace so far, when before the reset.
  final Duration? runsOutIn;

  /// The pace of [window] at [now], or null when the window gives no length
  /// or reset, or has barely begun (too early to say).
  static WindowPace? of(UsageWindow window, DateTime now) {
    final minutes = window.windowMinutes;
    final reset = window.resetsAt;
    if (minutes == null || minutes <= 0 || reset == null) return null;
    final length = Duration(minutes: minutes);
    final left = reset.difference(now);
    if (left.isNegative || left > length) return null;
    final passed = length - left;
    final elapsed = passed.inSeconds / length.inSeconds;
    if (elapsed < 0.05) return null;
    final used = window.usedPercent.clamp(0, 100).toDouble();
    if (used <= 0) return WindowPace(elapsed: elapsed);
    if (used >= 100) {
      return WindowPace(elapsed: elapsed, runsOutIn: Duration.zero);
    }
    final secondsPerPercent = passed.inSeconds / used;
    final toLimit =
        Duration(seconds: ((100 - used) * secondsPerPercent).round());
    return WindowPace(
      elapsed: elapsed,
      runsOutIn: toLimit < left ? toLimit : null,
    );
  }
}

/// The window of a plan most worth a glance, with its pace: one the pace runs
/// out first, else the fullest. Null when the plan reports no window.
({UsageWindow window, WindowPace? pace})? pressingWindow(
  ProviderUsage? usage,
  DateTime now,
) {
  if (usage == null ||
      usage.status != UsageStatus.ok ||
      usage.windows.isEmpty) {
    return null;
  }
  final rows = [
    for (final w in usage.windows) (window: w, pace: WindowPace.of(w, now)),
  ];
  final hot = rows.where((r) => r.pace?.runsOutIn != null).toList()
    ..sort((a, b) => a.pace!.runsOutIn!.compareTo(b.pace!.runsOutIn!));
  if (hot.isNotEmpty) return hot.first;
  return (rows
        ..sort((a, b) => b.window.usedPercent.compareTo(a.window.usedPercent)))
      .first;
}

/// The plan an agent's usage counts against, when the bridge reads one.
UsageProvider? usageProviderForAgent(String? agentId) => switch (agentId) {
      'claude-code' => UsageProvider.claude,
      'codex' => UsageProvider.codex,
      'grok' => UsageProvider.grok,
      _ => null,
    };
