import 'package:drift/drift.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/repositories/i_bridge_replica_repository.dart';
import 'package:uxnan/domain/value_objects/pending_thread_action.dart';
import 'package:uxnan/domain/value_objects/replica_cursor.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed implementation of [IBridgeReplicaRepository]
/// (architecture/02a §5.8.17).
class DriftBridgeReplicaRepository implements IBridgeReplicaRepository {
  /// Creates a [DriftBridgeReplicaRepository] over the given database.
  const DriftBridgeReplicaRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<ReplicaCursor?> cursor(String deviceId) async {
    final row = await (_db.select(_db.replicaCursorsTable)
          ..where((c) => c.deviceId.equals(deviceId)))
        .getSingleOrNull();
    if (row == null) return null;
    return ReplicaCursor(storeId: row.storeId, rev: row.rev, home: row.home);
  }

  @override
  Future<void> saveCursor(String deviceId, ReplicaCursor cursor) async {
    await _db.into(_db.replicaCursorsTable).insertOnConflictUpdate(
          ReplicaCursorsTableCompanion(
            deviceId: Value(deviceId),
            storeId: Value(cursor.storeId),
            rev: Value(cursor.rev),
            home: Value(cursor.home),
          ),
        );
  }

  @override
  Stream<List<Project>> watchProjects(String deviceId) {
    final query = _db.select(_db.projectsTable)
      ..where((p) => p.deviceId.equals(deviceId))
      ..orderBy([(p) => OrderingTerm.asc(p.name.collate(Collate.noCase))]);
    return query.watch().map((rows) => rows.map(_rowToProject).toList());
  }

  @override
  Future<void> upsertProjects(String deviceId, List<Project> projects) async {
    if (projects.isEmpty) return;
    await _db.batch((batch) {
      batch.insertAllOnConflictUpdate(_db.projectsTable, [
        for (final project in projects) _companion(deviceId, project),
      ]);
    });
  }

  @override
  Future<void> deleteProjects(String deviceId, List<String> ids) async {
    if (ids.isEmpty) return;
    await (_db.delete(_db.projectsTable)
          ..where((p) => p.deviceId.equals(deviceId) & p.id.isIn(ids)))
        .go();
  }

  @override
  Future<void> replaceProjects(String deviceId, List<Project> projects) async {
    await _db.transaction(() async {
      await (_db.delete(_db.projectsTable)
            ..where((p) => p.deviceId.equals(deviceId)))
          .go();
      await upsertProjects(deviceId, projects);
    });
  }

  @override
  Future<void> enqueueThreadAction(PendingThreadAction action) async {
    final moot = switch (action.kind) {
      PendingThreadActionKind.rename => [PendingThreadActionKind.rename],
      PendingThreadActionKind.archive || PendingThreadActionKind.unarchive => [
          PendingThreadActionKind.archive,
          PendingThreadActionKind.unarchive,
        ],
      PendingThreadActionKind.delete => PendingThreadActionKind.values,
    };
    await _db.transaction(() async {
      await (_db.delete(_db.pendingThreadActionsTable)
            ..where(
              (a) =>
                  a.deviceId.equals(action.deviceId) &
                  a.threadId.equals(action.threadId) &
                  a.kind.isIn(moot.map((k) => k.name)),
            ))
          .go();
      await _db.into(_db.pendingThreadActionsTable).insert(
            PendingThreadActionsTableCompanion.insert(
              deviceId: action.deviceId,
              threadId: action.threadId,
              kind: action.kind.name,
              title: Value(action.title),
              decidedAt: action.decidedAt,
            ),
          );
    });
  }

  @override
  Future<List<PendingThreadAction>> pendingThreadActions(
    String deviceId,
  ) async {
    final rows = await (_db.select(_db.pendingThreadActionsTable)
          ..where((a) => a.deviceId.equals(deviceId))
          ..orderBy([(a) => OrderingTerm.asc(a.id)]))
        .get();
    return [
      for (final row in rows)
        if (PendingThreadActionKind.fromName(row.kind) case final kind?)
          PendingThreadAction(
            id: row.id,
            deviceId: row.deviceId,
            threadId: row.threadId,
            kind: kind,
            title: row.title,
            decidedAt: row.decidedAt,
          ),
    ];
  }

  @override
  Future<void> removeThreadAction(int id) async {
    await (_db.delete(_db.pendingThreadActionsTable)
          ..where((a) => a.id.equals(id)))
        .go();
  }

  @override
  Future<void> forgetDevice(String deviceId) async {
    await _db.transaction(() async {
      await (_db.delete(_db.projectsTable)
            ..where((p) => p.deviceId.equals(deviceId)))
          .go();
      await (_db.delete(_db.replicaCursorsTable)
            ..where((c) => c.deviceId.equals(deviceId)))
          .go();
      await (_db.delete(_db.pendingThreadActionsTable)
            ..where((a) => a.deviceId.equals(deviceId)))
          .go();
    });
  }

  ProjectsTableCompanion _companion(String deviceId, Project project) =>
      ProjectsTableCompanion(
        deviceId: Value(deviceId),
        id: Value(project.id),
        name: Value(project.name),
        cwd: Value(project.cwd),
        agentId: Value(project.agentId),
        source: Value(project.source),
      );

  Project _rowToProject(ProjectRow row) => Project(
        id: row.id,
        name: row.name,
        cwd: row.cwd,
        agentId: row.agentId,
        source: row.source,
      );
}
