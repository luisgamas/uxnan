import 'package:drift/drift.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/domain/repositories/i_git_action_log_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed implementation of [IGitActionLogRepository] (spec 02c §10.1).
class DriftGitActionLogRepository implements IGitActionLogRepository {
  /// Creates a [DriftGitActionLogRepository] over the given database.
  const DriftGitActionLogRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<void> record(GitActionLogEntry entry) async {
    await _db
        .into(_db.gitActionLogTable)
        .insertOnConflictUpdate(_toCompanion(entry));
  }

  @override
  Future<List<GitActionLogEntry>> getForThread(String threadId) async {
    final rows = await (_db.select(_db.gitActionLogTable)
          ..where((t) => t.threadId.equals(threadId))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAtMs)]))
        .get();
    return rows.map(_rowToEntry).toList();
  }

  @override
  Stream<List<GitActionLogEntry>> watchForThread(String threadId) {
    return (_db.select(_db.gitActionLogTable)
          ..where((t) => t.threadId.equals(threadId))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAtMs)]))
        .watch()
        .map((rows) => rows.map(_rowToEntry).toList());
  }

  GitActionLogTableCompanion _toCompanion(GitActionLogEntry entry) {
    return GitActionLogTableCompanion(
      id: Value(entry.id),
      threadId: Value(entry.threadId),
      kind: Value(entry.kind.name),
      status: Value(entry.succeeded ? 'completed' : 'error'),
      paramsJson: Value(entry.paramsJson),
      resultJson: Value(entry.resultJson),
      errorMessage: Value(entry.errorMessage),
      startedAtMs: Value(entry.startedAt.millisecondsSinceEpoch),
      completedAtMs: Value(entry.completedAt?.millisecondsSinceEpoch),
    );
  }

  GitActionLogEntry _rowToEntry(GitActionLogRow row) {
    return GitActionLogEntry(
      id: row.id,
      threadId: row.threadId,
      kind: _kind(row.kind),
      succeeded: row.status == 'completed',
      paramsJson: row.paramsJson,
      resultJson: row.resultJson,
      errorMessage: row.errorMessage,
      startedAt: DateTime.fromMillisecondsSinceEpoch(row.startedAtMs),
      completedAt: row.completedAtMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(row.completedAtMs!),
    );
  }

  static GitActionKind _kind(String name) {
    for (final value in GitActionKind.values) {
      if (value.name == name) return value;
    }
    return GitActionKind.commit;
  }
}
