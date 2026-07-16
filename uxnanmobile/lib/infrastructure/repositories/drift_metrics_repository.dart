import 'package:drift/drift.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/repositories/i_connection_session_repository.dart';
import 'package:uxnan/domain/repositories/i_metrics_repository.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed [IMetricsRepository]: aggregates the phone's already-persisted
/// data (threads, messages, git actions) plus the connection-session log into
/// the profile / per-PC metrics. All local — no wire call.
class DriftMetricsRepository implements IMetricsRepository {
  /// Creates a [DriftMetricsRepository].
  const DriftMetricsRepository(this._db, this._connectionSessions);

  final UxnanDatabase _db;
  final IConnectionSessionRepository _connectionSessions;

  @override
  Future<ProfileMetrics> loadMetrics({String? deviceId}) async {
    // Threads (optionally scoped to one PC) drive conversations, distinct
    // agents/models, member-since and the per-agent breakdown. Threads are one
    // row per conversation (few), so loading them in full is cheap.
    final threadsQuery = _db.select(_db.threadsTable);
    if (deviceId != null) {
      threadsQuery.where((t) => t.deviceId.equals(deviceId));
    }
    final threads = await threadsQuery.get();

    final agents = <String>{};
    final models = <String>{};
    final byAgent = <String, int>{};
    DateTime? memberSince;
    for (final t in threads) {
      agents.add(t.agentId);
      final model = t.model;
      if (model != null) models.add(model);
      byAgent[t.agentId] = (byAgent[t.agentId] ?? 0) + 1;
      final created = DateTime.fromMillisecondsSinceEpoch(t.createdAtMs);
      if (memberSince == null || created.isBefore(memberSince)) {
        memberSince = created;
      }
    }

    // Messages / git actions key off threadId (not deviceId), so per-PC scope
    // filters by this PC's thread ids. Counted with an aggregate, never
    // loading any bodies.
    final threadIds =
        deviceId == null ? null : threads.map((t) => t.id).toList();
    final messages = await _countRows(
      _db.messagesTable,
      _db.messagesTable.id,
      threadIds == null ? null : _db.messagesTable.threadId.isIn(threadIds),
    );
    final gitActions = await _countRows(
      _db.gitActionLogTable,
      _db.gitActionLogTable.id,
      threadIds == null ? null : _db.gitActionLogTable.threadId.isIn(threadIds),
    );

    // Connection sessions (optionally scoped to the PC).
    final sessions = (await _connectionSessions.getAll())
        .where((s) => deviceId == null || s.deviceId == deviceId)
        .toList();
    var total = Duration.zero;
    var longest = Duration.zero;
    var relay = 0;
    var direct = 0;
    for (final s in sessions) {
      final d = s.duration;
      total += d;
      if (d > longest) longest = d;
      if (s.transport == ConnectionTransport.relay) {
        relay++;
      } else {
        direct++;
      }
    }

    final byAgentSorted = byAgent.entries
        .map((e) => AgentUsage(agentId: e.key, conversations: e.value))
        .toList()
      ..sort((a, b) => b.conversations.compareTo(a.conversations));

    return ProfileMetrics(
      conversations: threads.length,
      agentsUsed: agents.length,
      modelsUsed: models.length,
      messages: messages,
      gitActions: gitActions,
      sessions: sessions.length,
      totalConnected: total,
      longestSession: longest,
      relaySessions: relay,
      directSessions: direct,
      byAgent: byAgentSorted,
      memberSince: memberSince,
      mostUsedTransport: sessions.isEmpty
          ? null
          : (relay > direct
              ? ConnectionTransport.relay
              : ConnectionTransport.direct),
    );
  }

  @override
  Future<Map<DateTime, int>> activityByDay({
    required DateTime from,
    required DateTime to,
    required ActivityMetric metric,
    String? deviceId,
  }) async {
    final fromMs = from.millisecondsSinceEpoch;
    final toMs = to.millisecondsSinceEpoch;

    // Per-PC scope: resolve this PC's thread ids once (messages / git actions
    // carry a threadId, not a deviceId).
    List<String>? threadIds;
    if (deviceId != null) {
      final idCol = _db.threadsTable.id;
      final query = _db.selectOnly(_db.threadsTable)
        ..addColumns([idCol])
        ..where(_db.threadsTable.deviceId.equals(deviceId));
      threadIds = (await query.get()).map((r) => r.read(idCol)!).toList();
    }

    final buckets = <DateTime, int>{};
    void bump(int ms) {
      final d = DateTime.fromMillisecondsSinceEpoch(ms);
      // Key by UTC midnight of the local calendar date: timezone-stable, so it
      // matches the heatmap cells and the bridge-snapshot day keys.
      final day = DateTime.utc(d.year, d.month, d.day);
      buckets[day] = (buckets[day] ?? 0) + 1;
    }

    final wantsConversations = metric == ActivityMetric.combined ||
        metric == ActivityMetric.conversations;
    final wantsMessages =
        metric == ActivityMetric.combined || metric == ActivityMetric.messages;
    final wantsWork =
        metric == ActivityMetric.combined || metric == ActivityMetric.work;

    if (wantsConversations) {
      final tsCol = _db.threadsTable.createdAtMs;
      final query = _db.selectOnly(_db.threadsTable)
        ..addColumns([tsCol])
        ..where(tsCol.isBetweenValues(fromMs, toMs));
      if (deviceId != null) {
        query.where(_db.threadsTable.deviceId.equals(deviceId));
      }
      for (final row in await query.get()) {
        bump(row.read(tsCol)!);
      }
    }
    if (wantsMessages) {
      final tsCol = _db.messagesTable.createdAtMs;
      final query = _db.selectOnly(_db.messagesTable)
        ..addColumns([tsCol])
        ..where(tsCol.isBetweenValues(fromMs, toMs));
      if (threadIds != null) {
        query.where(_db.messagesTable.threadId.isIn(threadIds));
      }
      for (final row in await query.get()) {
        bump(row.read(tsCol)!);
      }
    }
    if (wantsWork) {
      final tsCol = _db.gitActionLogTable.startedAtMs;
      final query = _db.selectOnly(_db.gitActionLogTable)
        ..addColumns([tsCol])
        ..where(tsCol.isBetweenValues(fromMs, toMs));
      if (threadIds != null) {
        query.where(_db.gitActionLogTable.threadId.isIn(threadIds));
      }
      for (final row in await query.get()) {
        bump(row.read(tsCol)!);
      }
    }
    return buckets;
  }

  /// Counts rows of [table] via `COUNT(idColumn)`, optionally filtered,
  /// without loading any row bodies.
  Future<int> _countRows(
    TableInfo<Table, dynamic> table,
    GeneratedColumn<Object> idColumn,
    Expression<bool>? filter,
  ) async {
    final countExp = idColumn.count();
    final query = _db.selectOnly(table)..addColumns([countExp]);
    if (filter != null) query.where(filter);
    final row = await query.getSingle();
    return row.read(countExp) ?? 0;
  }
}
