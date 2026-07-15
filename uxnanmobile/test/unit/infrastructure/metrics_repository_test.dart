import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/connection_session.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/infrastructure/repositories/drift_connection_session_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_git_action_log_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_metrics_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

void main() {
  late UxnanDatabase db;
  late DriftConnectionSessionRepository sessions;
  late DriftGitActionLogRepository git;
  late DriftMetricsRepository metrics;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    sessions = DriftConnectionSessionRepository(db);
    git = DriftGitActionLogRepository(db);
    metrics = DriftMetricsRepository(db, sessions);
  });

  tearDown(() => db.close());

  ConnectionSession session(
    String id, {
    required DateTime start,
    required DateTime end,
    ConnectionTransport transport = ConnectionTransport.direct,
    String deviceId = 'mac-1',
  }) =>
      ConnectionSession(
        id: id,
        deviceId: deviceId,
        transport: transport,
        startedAt: start,
        lastActiveAt: end,
        endedAt: end,
      );

  GitActionLogEntry action(
    String id, {
    required DateTime at,
    String threadId = 't1',
    GitActionKind kind = GitActionKind.commit,
  }) =>
      GitActionLogEntry(
        id: id,
        threadId: threadId,
        kind: kind,
        succeeded: true,
        paramsJson: '{}',
        startedAt: at,
      );

  test('loadMetrics aggregates connection + git stats', () async {
    await sessions.startSession(
      session(
        's1',
        start: DateTime(2026, 7, 1, 10),
        end: DateTime(2026, 7, 1, 11),
      ),
    );
    await sessions.startSession(
      session(
        's2',
        start: DateTime(2026, 7, 2, 10),
        end: DateTime(2026, 7, 2, 12, 30),
        transport: ConnectionTransport.relay,
      ),
    );
    await git.record(action('g1', at: DateTime(2026, 7, 1, 10, 5)));

    final m = await metrics.loadMetrics();

    expect(m.sessions, 2);
    expect(m.totalConnected, const Duration(hours: 3, minutes: 30));
    expect(m.longestSession, const Duration(hours: 2, minutes: 30));
    expect(m.directSessions, 1);
    expect(m.relaySessions, 1);
    // Tie (1 vs 1) resolves to direct.
    expect(m.mostUsedTransport, ConnectionTransport.direct);
    expect(m.gitActions, 1);
  });

  test('activityByDay buckets Git work by calendar day (UTC-keyed)', () async {
    await git.record(action('g1', at: DateTime(2026, 7, 2, 9)));
    await git.record(
      action('g2', at: DateTime(2026, 7, 2, 18), kind: GitActionKind.push),
    );
    await git.record(action('g3', at: DateTime(2026, 7, 4, 12)));

    final counts = await metrics.activityByDay(
      from: DateTime(2026),
      to: DateTime(2027).subtract(const Duration(milliseconds: 1)),
      metric: ActivityMetric.work,
    );

    // Days are keyed by UTC midnight of the local calendar date (timezone-stable,
    // matching the bridge snapshot keys and the heatmap cells).
    expect(counts[DateTime.utc(2026, 7, 2)], 2);
    expect(counts[DateTime.utc(2026, 7, 4)], 1);
    expect(counts.containsKey(DateTime.utc(2026, 7, 3)), isFalse);
  });

  test('empty database yields zeroed metrics', () async {
    final m = await metrics.loadMetrics();
    expect(m.conversations, 0);
    expect(m.sessions, 0);
    expect(m.totalConnected, Duration.zero);
    expect(m.mostUsedTransport, isNull);
    expect(m.byAgent, isEmpty);
  });
}
