import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';

MetricsSnapshot _snap({
  String deviceId = 'pc-1',
  int conversations = 0,
  int agentsUsed = 0,
  int modelsUsed = 0,
  int messages = 0,
  int gitActions = 0,
  int sessions = 0,
  int totalConnectedMs = 0,
  int longestSessionMs = 0,
  int relaySessions = 0,
  int directSessions = 0,
  List<MetricsAgentUsage> byAgent = const [],
  List<MetricsActivityDay> activity = const [],
  int? memberSince,
}) {
  return MetricsSnapshot(
    deviceId: deviceId,
    conversations: conversations,
    agentsUsed: agentsUsed,
    modelsUsed: modelsUsed,
    messages: messages,
    gitActions: gitActions,
    sessions: sessions,
    totalConnectedMs: totalConnectedMs,
    longestSessionMs: longestSessionMs,
    relaySessions: relaySessions,
    directSessions: directSessions,
    byAgent: byAgent,
    activity: activity,
    memberSince: memberSince,
  );
}

MetricsActivityDay _act(int day, {int c = 0, int m = 0, int w = 0}) =>
    MetricsActivityDay(day: day, conversations: c, messages: m, work: w);

void main() {
  group('MetricsSnapshot.fromJson / toJson', () {
    test('parses a full wire result and round-trips through toJson', () {
      final json = {
        'version': 1,
        'deviceId': 'pc-1',
        'conversations': 5,
        'agentsUsed': 2,
        'modelsUsed': 3,
        'messages': 40,
        'gitActions': 7,
        'sessions': 4,
        'totalConnectedMs': 60000,
        'longestSessionMs': 30000,
        'relaySessions': 1,
        'directSessions': 3,
        'byAgent': [
          {'agentId': 'claude-code', 'conversations': 3},
          {'agentId': 'codex', 'conversations': 2},
        ],
        'activity': [
          {'day': 1000, 'conversations': 1, 'messages': 4, 'work': 2},
        ],
        'memberSince': 12345,
        'updatedAt': 99999,
      };
      final snap = MetricsSnapshot.fromJson(json);
      expect(snap.deviceId, 'pc-1');
      expect(snap.conversations, 5);
      expect(snap.agentsUsed, 2);
      expect(snap.messages, 40);
      expect(snap.byAgent.length, 2);
      expect(snap.byAgent.first.agentId, 'claude-code');
      expect(snap.activity.single.messages, 4);
      expect(snap.memberSince, 12345);

      // toJson → fromJson yields an equal snapshot (Equatable value equality).
      expect(MetricsSnapshot.fromJson(snap.toJson()), snap);
    });

    test('tolerates missing / malformed fields (zeros, empty, null)', () {
      final snap = MetricsSnapshot.fromJson(const {'deviceId': 'pc-9'});
      expect(snap.conversations, 0);
      expect(snap.byAgent, isEmpty);
      expect(snap.activity, isEmpty);
      expect(snap.memberSince, isNull);
    });

    test('coerces numeric fields sent as doubles', () {
      final snap = MetricsSnapshot.fromJson(const {
        'deviceId': 'pc-1',
        'totalConnectedMs': 1500.0,
        'messages': 3.0,
      });
      expect(snap.totalConnectedMs, 1500);
      expect(snap.messages, 3);
    });
  });

  group('MetricsSnapshot.toProfileMetrics', () {
    test('maps counts, durations, member-since and transport', () {
      final snap = _snap(
        conversations: 5,
        agentsUsed: 2,
        modelsUsed: 3,
        messages: 40,
        gitActions: 7,
        sessions: 4,
        totalConnectedMs: 60000,
        longestSessionMs: 30000,
        relaySessions: 3,
        directSessions: 1,
        byAgent: const [MetricsAgentUsage(agentId: 'codex', conversations: 2)],
        memberSince: 1700000000000,
      );
      final metrics = snap.toProfileMetrics();
      expect(metrics.conversations, 5);
      expect(metrics.totalConnected, const Duration(milliseconds: 60000));
      expect(metrics.longestSession, const Duration(milliseconds: 30000));
      expect(metrics.byAgent.single.agentId, 'codex');
      expect(
        metrics.memberSince,
        DateTime.fromMillisecondsSinceEpoch(1700000000000),
      );
      // relay (3) > direct (1) → relay is the most-used transport.
      expect(metrics.mostUsedTransport, ConnectionTransport.relay);
    });

    test('no sessions → null most-used transport', () {
      expect(_snap().toProfileMetrics().mostUsedTransport, isNull);
    });
  });

  group('aggregateSnapshots', () {
    test('empty → the empty ProfileMetrics', () {
      expect(aggregateSnapshots(const []).conversations, 0);
      expect(aggregateSnapshots(const []).sessions, 0);
    });

    test('sums counts, unions agents, maxes longest, earliest member-since',
        () {
      final a = _snap(
        conversations: 3,
        modelsUsed: 2,
        messages: 20,
        gitActions: 4,
        sessions: 2,
        totalConnectedMs: 10000,
        longestSessionMs: 6000,
        relaySessions: 2,
        byAgent: const [
          MetricsAgentUsage(agentId: 'claude-code', conversations: 3),
        ],
        memberSince: 2000,
      );
      final b = _snap(
        deviceId: 'pc-2',
        conversations: 1,
        modelsUsed: 1,
        messages: 5,
        gitActions: 1,
        sessions: 3,
        totalConnectedMs: 5000,
        longestSessionMs: 9000,
        directSessions: 3,
        byAgent: const [
          MetricsAgentUsage(agentId: 'claude-code', conversations: 1),
          MetricsAgentUsage(agentId: 'codex', conversations: 1),
        ],
        memberSince: 1000,
      );
      final agg = aggregateSnapshots([a, b]);
      expect(agg.conversations, 4);
      expect(agg.messages, 25);
      expect(agg.gitActions, 5);
      expect(agg.sessions, 5);
      expect(agg.totalConnected, const Duration(milliseconds: 15000));
      // Longest is the max across PCs, not the sum.
      expect(agg.longestSession, const Duration(milliseconds: 9000));
      // Distinct agents are unioned by id → claude-code + codex = 2.
      expect(agg.agentsUsed, 2);
      // byAgent merges per id: claude-code 3+1=4, codex 1.
      expect(
        agg.byAgent.firstWhere((u) => u.agentId == 'claude-code').conversations,
        4,
      );
      // Member-since is the earliest across PCs.
      expect(agg.memberSince, DateTime.fromMillisecondsSinceEpoch(1000));
      // relay (2) vs direct (3) → direct is most-used overall.
      expect(agg.mostUsedTransport, ConnectionTransport.direct);
    });
  });

  group('aggregateActivity', () {
    // Wire day keys are UTC midnight of a calendar date (timezone-stable).
    final key = DateTime.utc(2026, 7, 15);
    final dayMs = key.millisecondsSinceEpoch;

    test('sums a metric across PCs, keyed by UTC calendar day', () {
      final a = _snap(activity: [_act(dayMs, c: 1, m: 4, w: 2)]);
      final b = _snap(activity: [_act(dayMs, c: 2, m: 1)]);
      final combined = aggregateActivity(
        [a, b],
        year: 2026,
        metric: ActivityMetric.combined,
      );
      // (1+4+2) + (2+1+0) = 10 on that day, keyed by UTC midnight.
      expect(combined[key], 10);
      expect(combined.keys.single.isUtc, isTrue);

      final messages = aggregateActivity(
        [a, b],
        year: 2026,
        metric: ActivityMetric.messages,
      );
      expect(messages[key], 5); // 4 + 1
    });

    test('excludes other years and zero-count days', () {
      final outside = DateTime.utc(2025).millisecondsSinceEpoch;
      final snap = _snap(
        activity: [_act(dayMs), _act(outside, c: 5, m: 5, w: 5)],
      );
      final result = aggregateActivity(
        [snap],
        year: 2026,
        metric: ActivityMetric.combined,
      );
      // The in-year day has a zero count (omitted); the other-year day is
      // filtered out — so nothing remains.
      expect(result, isEmpty);
    });

    test('day key is timezone-stable (matches the heatmap cell key)', () {
      // A bridge in any timezone encodes the date at UTC midnight. The heatmap
      // keys each cell with DateTime.utc(y, m, d); aggregateActivity must use
      // the same, so the cell paints regardless of the phone's timezone.
      final snap = _snap(activity: [_act(dayMs, c: 3)]);
      final result = aggregateActivity(
        [snap],
        year: 2026,
        metric: ActivityMetric.conversations,
      );
      expect(result[DateTime.utc(2026, 7, 15)], 3);
    });
  });
}
