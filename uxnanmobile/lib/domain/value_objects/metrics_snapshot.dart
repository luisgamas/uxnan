import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';

/// Per-agent conversation tally from a bridge metrics snapshot.
class MetricsAgentUsage extends Equatable {
  /// Creates a [MetricsAgentUsage].
  const MetricsAgentUsage({required this.agentId, required this.conversations});

  /// Parses one entry from the `metrics/get` `byAgent` array.
  factory MetricsAgentUsage.fromJson(Map<String, dynamic> json) =>
      MetricsAgentUsage(
        agentId: json['agentId'] as String? ?? '',
        conversations: _int(json['conversations']),
      );

  /// The agent's wire id (e.g. `claude-code`).
  final String agentId;

  /// Conversations started with this agent on the PC.
  final int conversations;

  /// Serializes for the on-device snapshot cache.
  Map<String, dynamic> toJson() =>
      {'agentId': agentId, 'conversations': conversations};

  @override
  List<Object?> get props => [agentId, conversations];
}

/// One local-day activity bucket from a bridge snapshot. Counts are split by
/// category so any [ActivityMetric] renders without another round-trip.
class MetricsActivityDay extends Equatable {
  /// Creates a [MetricsActivityDay].
  const MetricsActivityDay({
    required this.day,
    required this.conversations,
    required this.messages,
    required this.work,
  });

  /// Parses one entry from the `metrics/get` `activity` array.
  factory MetricsActivityDay.fromJson(Map<String, dynamic> json) =>
      MetricsActivityDay(
        day: _int(json['day']),
        conversations: _int(json['conversations']),
        messages: _int(json['messages']),
        work: _int(json['work']),
      );

  /// The calendar date this bucket covers, as **UTC-midnight epoch ms** (of the
  /// bridge host's local date). UTC-midnight encoding is timezone-stable, so
  /// the heatmap maps it to the right cell in any phone timezone.
  final int day;

  /// Conversations started that day.
  final int conversations;

  /// Messages exchanged that day.
  final int messages;

  /// Git/work actions that day.
  final int work;

  /// The count for [metric] (combined sums the three streams).
  int forMetric(ActivityMetric metric) => switch (metric) {
        ActivityMetric.combined => conversations + messages + work,
        ActivityMetric.conversations => conversations,
        ActivityMetric.messages => messages,
        ActivityMetric.work => work,
      };

  /// Serializes for the on-device snapshot cache.
  Map<String, dynamic> toJson() => {
        'day': day,
        'conversations': conversations,
        'messages': messages,
        'work': work,
      };

  @override
  List<Object?> get props => [day, conversations, messages, work];
}

/// One PC's aggregated metrics as reported by the bridge (`metrics/get`).
///
/// The bridge is the source of truth (these survive an app uninstall, unlike
/// the old phone-local aggregation). The phone caches one snapshot per PC and
/// sums across PCs for the all-PCs profile — see [aggregateSnapshots].
class MetricsSnapshot extends Equatable {
  /// Creates a [MetricsSnapshot].
  const MetricsSnapshot({
    required this.deviceId,
    required this.conversations,
    required this.agentsUsed,
    required this.modelsUsed,
    required this.messages,
    required this.gitActions,
    required this.sessions,
    required this.totalConnectedMs,
    required this.longestSessionMs,
    required this.relaySessions,
    required this.directSessions,
    required this.byAgent,
    required this.activity,
    this.memberSince,
  });

  /// Parses a `metrics/get` result.
  factory MetricsSnapshot.fromJson(Map<String, dynamic> json) =>
      MetricsSnapshot(
        deviceId: json['deviceId'] as String? ?? '',
        conversations: _int(json['conversations']),
        agentsUsed: _int(json['agentsUsed']),
        modelsUsed: _int(json['modelsUsed']),
        messages: _int(json['messages']),
        gitActions: _int(json['gitActions']),
        sessions: _int(json['sessions']),
        totalConnectedMs: _int(json['totalConnectedMs']),
        longestSessionMs: _int(json['longestSessionMs']),
        relaySessions: _int(json['relaySessions']),
        directSessions: _int(json['directSessions']),
        byAgent: _parseList(json['byAgent'], MetricsAgentUsage.fromJson),
        activity: _parseList(json['activity'], MetricsActivityDay.fromJson),
        memberSince:
            json['memberSince'] == null ? null : _int(json['memberSince']),
      );

  /// The PC's `macDeviceId` this snapshot belongs to.
  final String deviceId;

  /// Total conversations started on this PC.
  final int conversations;

  /// Distinct agents used.
  final int agentsUsed;

  /// Distinct models used.
  final int modelsUsed;

  /// Total messages exchanged.
  final int messages;

  /// Total git actions performed.
  final int gitActions;

  /// Connection sessions recorded.
  final int sessions;

  /// Cumulative connected time, ms.
  final int totalConnectedMs;

  /// Single longest connection session, ms.
  final int longestSessionMs;

  /// Sessions over the relay.
  final int relaySessions;

  /// Sessions over a direct LAN/Tailscale host.
  final int directSessions;

  /// Per-agent conversation tallies, most-used first.
  final List<MetricsAgentUsage> byAgent;

  /// Per-day activity buckets for the heatmap.
  final List<MetricsActivityDay> activity;

  /// Earliest conversation creation (epoch ms), or null when there are none.
  final int? memberSince;

  /// Serializes for the on-device snapshot cache.
  Map<String, dynamic> toJson() => {
        'deviceId': deviceId,
        'conversations': conversations,
        'agentsUsed': agentsUsed,
        'modelsUsed': modelsUsed,
        'messages': messages,
        'gitActions': gitActions,
        'sessions': sessions,
        'totalConnectedMs': totalConnectedMs,
        'longestSessionMs': longestSessionMs,
        'relaySessions': relaySessions,
        'directSessions': directSessions,
        'byAgent': [for (final a in byAgent) a.toJson()],
        'activity': [for (final a in activity) a.toJson()],
        if (memberSince != null) 'memberSince': memberSince,
      };

  /// Maps this single-PC snapshot to a [ProfileMetrics] for the per-PC screen.
  ProfileMetrics toProfileMetrics() => ProfileMetrics(
        conversations: conversations,
        agentsUsed: agentsUsed,
        modelsUsed: modelsUsed,
        messages: messages,
        gitActions: gitActions,
        sessions: sessions,
        totalConnected: Duration(milliseconds: totalConnectedMs),
        longestSession: Duration(milliseconds: longestSessionMs),
        relaySessions: relaySessions,
        directSessions: directSessions,
        byAgent: [
          for (final a in byAgent)
            AgentUsage(agentId: a.agentId, conversations: a.conversations),
        ],
        memberSince: memberSince == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(memberSince!),
        mostUsedTransport:
            _transportFrom(sessions, relaySessions, directSessions),
      );

  @override
  List<Object?> get props => [
        deviceId,
        conversations,
        agentsUsed,
        modelsUsed,
        messages,
        gitActions,
        sessions,
        totalConnectedMs,
        longestSessionMs,
        relaySessions,
        directSessions,
        byAgent,
        activity,
        memberSince,
      ];
}

/// Combines several PC snapshots into one all-PCs [ProfileMetrics].
///
/// Counts sum; the longest session is the max; member-since is the earliest.
/// Distinct **agents** are unioned across PCs by id (correct); distinct
/// **models** are summed (a slight over-count only when the same model is used
/// on multiple PCs — the snapshot has no model ids to dedupe; the common
/// single-PC case is exact).
ProfileMetrics aggregateSnapshots(Iterable<MetricsSnapshot> snapshots) {
  final list = snapshots.toList();
  if (list.isEmpty) return const ProfileMetrics.empty();

  var conversations = 0;
  var modelsUsed = 0;
  var messages = 0;
  var gitActions = 0;
  var sessions = 0;
  var totalConnectedMs = 0;
  var longestSessionMs = 0;
  var relaySessions = 0;
  var directSessions = 0;
  int? memberSince;
  final agents = <String>{};
  final byAgent = <String, int>{};

  for (final s in list) {
    conversations += s.conversations;
    modelsUsed += s.modelsUsed;
    messages += s.messages;
    gitActions += s.gitActions;
    sessions += s.sessions;
    totalConnectedMs += s.totalConnectedMs;
    if (s.longestSessionMs > longestSessionMs) {
      longestSessionMs = s.longestSessionMs;
    }
    relaySessions += s.relaySessions;
    directSessions += s.directSessions;
    if (s.memberSince != null &&
        (memberSince == null || s.memberSince! < memberSince)) {
      memberSince = s.memberSince;
    }
    for (final a in s.byAgent) {
      agents.add(a.agentId);
      byAgent[a.agentId] = (byAgent[a.agentId] ?? 0) + a.conversations;
    }
  }

  final byAgentSorted = byAgent.entries
      .map((e) => AgentUsage(agentId: e.key, conversations: e.value))
      .toList()
    ..sort((a, b) => b.conversations.compareTo(a.conversations));

  return ProfileMetrics(
    conversations: conversations,
    agentsUsed: agents.length,
    modelsUsed: modelsUsed,
    messages: messages,
    gitActions: gitActions,
    sessions: sessions,
    totalConnected: Duration(milliseconds: totalConnectedMs),
    longestSession: Duration(milliseconds: longestSessionMs),
    relaySessions: relaySessions,
    directSessions: directSessions,
    byAgent: byAgentSorted,
    memberSince: memberSince == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(memberSince),
    mostUsedTransport: _transportFrom(sessions, relaySessions, directSessions),
  );
}

/// Buckets [snapshots]' activity by calendar day for [metric] within [year],
/// summing across PCs. Days are keyed by **UTC midnight** (timezone-stable, so
/// the count matches the heatmap cell regardless of the phone's timezone). Days
/// with a zero count are omitted (the heatmap fills them as empty).
Map<DateTime, int> aggregateActivity(
  Iterable<MetricsSnapshot> snapshots, {
  required int year,
  required ActivityMetric metric,
}) {
  final buckets = <DateTime, int>{};
  for (final snapshot in snapshots) {
    for (final entry in snapshot.activity) {
      // The wire `day` is UTC midnight of a calendar date — read it back in UTC
      // so its (y,m,d) is the same in any timezone (matching the heatmap).
      final day = DateTime.fromMillisecondsSinceEpoch(entry.day, isUtc: true);
      if (day.year != year) continue;
      final value = entry.forMetric(metric);
      if (value == 0) continue;
      final key = DateTime.utc(day.year, day.month, day.day);
      buckets[key] = (buckets[key] ?? 0) + value;
    }
  }
  return buckets;
}

ConnectionTransport? _transportFrom(int sessions, int relay, int direct) {
  if (sessions == 0) return null;
  return relay > direct
      ? ConnectionTransport.relay
      : ConnectionTransport.direct;
}

int _int(Object? value) => (value as num?)?.toInt() ?? 0;

/// Parses a wire array of JSON objects into a typed list, dropping non-maps.
List<T> _parseList<T>(Object? raw, T Function(Map<String, dynamic>) fromJson) {
  if (raw is! List) return <T>[];
  return [
    for (final item in raw)
      if (item is Map) fromJson(item.cast<String, dynamic>()),
  ];
}
