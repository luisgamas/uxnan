import 'package:drift/drift.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed implementation of [IThreadRepository] (spec 02c section 10.3).
class DriftThreadRepository implements IThreadRepository {
  /// Creates a [DriftThreadRepository] over the given database.
  const DriftThreadRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<List<Thread>> getThreads({String? projectId}) async {
    final query = _db.select(_db.threadsTable);
    if (projectId != null) {
      query.where((t) => t.projectId.equals(projectId));
    }
    query.orderBy([(t) => OrderingTerm.desc(t.lastActivityMs)]);
    final rows = await query.get();
    return rows.map(_rowToThread).toList();
  }

  @override
  Future<Thread?> getThread(String id) async {
    final query = _db.select(_db.threadsTable)..where((t) => t.id.equals(id));
    final row = await query.getSingleOrNull();
    return row != null ? _rowToThread(row) : null;
  }

  @override
  Future<void> saveThread(Thread thread) async {
    await _db.into(_db.threadsTable).insertOnConflictUpdate(
          ThreadsTableCompanion(
            id: Value(thread.id),
            title: Value(thread.title),
            projectId: Value(thread.projectId),
            deviceId: Value(thread.deviceId),
            cwd: Value(thread.cwd),
            worktreePath: Value(thread.worktreePath),
            agentId: Value(thread.agentId),
            model: Value(thread.model),
            syncState: Value(thread.syncState.name),
            status: Value(thread.status.name),
            lastActivityMs: Value(thread.lastActivity?.millisecondsSinceEpoch),
            // Preserve the real creation time (from the bridge) instead of
            // stamping `now()` on every update, so "newest first" is stable.
            createdAtMs: Value(
              thread.createdAt?.millisecondsSinceEpoch ??
                  DateTime.now().millisecondsSinceEpoch,
            ),
          ),
        );
  }

  @override
  Future<void> deleteThread(String id) async {
    await (_db.delete(_db.threadsTable)..where((t) => t.id.equals(id))).go();
  }

  @override
  Future<void> deleteThreadsByDeviceId(String deviceId) async {
    // Wipe the device's threads and their dependent rows in one transaction.
    // Messages/turns key off threadId with no DB cascade, so clear them
    // explicitly to avoid orphan rows when a whole PC is removed.
    await _db.transaction(() async {
      final ids = await (_db.select(_db.threadsTable)
            ..where((t) => t.deviceId.equals(deviceId)))
          .map((row) => row.id)
          .get();
      if (ids.isEmpty) return;
      await (_db.delete(_db.messagesTable)..where((m) => m.threadId.isIn(ids)))
          .go();
      await (_db.delete(_db.turnsTable)..where((t) => t.threadId.isIn(ids)))
          .go();
      await (_db.delete(_db.threadsTable)
            ..where((t) => t.deviceId.equals(deviceId)))
          .go();
    });
  }

  @override
  Stream<List<Thread>> watchThreads({String? projectId}) {
    final query = _db.select(_db.threadsTable);
    if (projectId != null) {
      query.where((t) => t.projectId.equals(projectId));
    }
    query.orderBy([(t) => OrderingTerm.desc(t.lastActivityMs)]);
    return query.watch().map((rows) => rows.map(_rowToThread).toList());
  }

  Thread _rowToThread(ThreadRow row) => Thread(
        id: row.id,
        title: row.title,
        projectId: row.projectId,
        deviceId: row.deviceId,
        cwd: row.cwd,
        worktreePath: row.worktreePath,
        agentId: row.agentId,
        model: row.model,
        syncState: ThreadSyncState.values.byName(row.syncState),
        status: ThreadStatus.values.byName(row.status),
        lastActivity: row.lastActivityMs != null
            ? DateTime.fromMillisecondsSinceEpoch(row.lastActivityMs!)
            : null,
        createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs),
      );
}
