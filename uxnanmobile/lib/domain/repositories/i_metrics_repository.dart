import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';

/// Read-only aggregation over the phone's local data (threads, messages, git
/// actions, connection sessions) for the profile / per-PC metrics screens.
///
/// All results are derived on the phone; nothing here crosses the wire. Scope
/// to a single PC by passing its `deviceId`, or omit it for the whole profile.
abstract class IMetricsRepository {
  /// Aggregate totals + connection stats + per-agent breakdown. When
  /// [deviceId] is given, everything is scoped to that PC.
  Future<ProfileMetrics> loadMetrics({String? deviceId});

  /// Activity counts bucketed by **local calendar day** over
  /// [from]..[to] (inclusive), for [metric]. Days with no activity are absent
  /// (the widget fills them as "empty"). When [deviceId] is given, only that
  /// PC's activity is counted.
  Future<Map<DateTime, int>> activityByDay({
    required DateTime from,
    required DateTime to,
    required ActivityMetric metric,
    String? deviceId,
  });
}
