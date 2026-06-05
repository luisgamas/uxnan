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
            cwd: Value(thread.cwd),
            worktreePath: Value(thread.worktreePath),
            agentId: Value(thread.agentId),
            syncState: Value(thread.syncState.name),
            status: Value(thread.status.name),
            lastActivityMs: Value(thread.lastActivity?.millisecondsSinceEpoch),
            createdAtMs: Value(DateTime.now().millisecondsSinceEpoch),
          ),
        );
  }

  @override
  Future<void> deleteThread(String id) async {
    await (_db.delete(_db.threadsTable)..where((t) => t.id.equals(id))).go();
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
        cwd: row.cwd,
        worktreePath: row.worktreePath,
        agentId: row.agentId,
        syncState: ThreadSyncState.values.byName(row.syncState),
        status: ThreadStatus.values.byName(row.status),
        lastActivity: row.lastActivityMs != null
            ? DateTime.fromMillisecondsSinceEpoch(row.lastActivityMs!)
            : null,
      );
}
