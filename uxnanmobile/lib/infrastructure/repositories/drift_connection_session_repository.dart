import 'package:drift/drift.dart';
import 'package:uxnan/domain/entities/connection_session.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/repositories/i_connection_session_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed [IConnectionSessionRepository] (phone-only connection log).
class DriftConnectionSessionRepository implements IConnectionSessionRepository {
  /// Creates a [DriftConnectionSessionRepository] over the given database.
  const DriftConnectionSessionRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<void> startSession(ConnectionSession session) async {
    await _db
        .into(_db.connectionSessionsTable)
        .insertOnConflictUpdate(_toCompanion(session));
  }

  @override
  Future<void> touchSession(String id, DateTime at) async {
    // Only advance sessions that are still open — never resurrect a closed one.
    await (_db.update(_db.connectionSessionsTable)
          ..where((t) => t.id.equals(id) & t.endedAtMs.isNull()))
        .write(
      ConnectionSessionsTableCompanion(
        lastActiveAtMs: Value(at.millisecondsSinceEpoch),
      ),
    );
  }

  @override
  Future<void> endSession(String id, DateTime endedAt) async {
    final ms = endedAt.millisecondsSinceEpoch;
    await (_db.update(_db.connectionSessionsTable)
          ..where((t) => t.id.equals(id) & t.endedAtMs.isNull()))
        .write(
      ConnectionSessionsTableCompanion(
        endedAtMs: Value(ms),
        lastActiveAtMs: Value(ms),
      ),
    );
  }

  @override
  Future<void> closeDanglingSessions() async {
    // Close each still-open row at its own last-active time (no inflation past
    // the last moment the channel was confirmed alive).
    final open = await (_db.select(_db.connectionSessionsTable)
          ..where((t) => t.endedAtMs.isNull()))
        .get();
    for (final row in open) {
      await (_db.update(_db.connectionSessionsTable)
            ..where((t) => t.id.equals(row.id)))
          .write(
        ConnectionSessionsTableCompanion(
          endedAtMs: Value(row.lastActiveAtMs),
        ),
      );
    }
  }

  @override
  Future<List<ConnectionSession>> getAll() async {
    final rows = await (_db.select(_db.connectionSessionsTable)
          ..orderBy([(t) => OrderingTerm.desc(t.startedAtMs)]))
        .get();
    return rows.map(_rowToEntity).toList();
  }

  @override
  Stream<List<ConnectionSession>> watchAll() {
    return (_db.select(_db.connectionSessionsTable)
          ..orderBy([(t) => OrderingTerm.desc(t.startedAtMs)]))
        .watch()
        .map((rows) => rows.map(_rowToEntity).toList());
  }

  ConnectionSessionsTableCompanion _toCompanion(ConnectionSession session) {
    return ConnectionSessionsTableCompanion(
      id: Value(session.id),
      deviceId: Value(session.deviceId),
      transport: Value(session.transport.name),
      endpoint: Value(session.endpoint),
      startedAtMs: Value(session.startedAt.millisecondsSinceEpoch),
      lastActiveAtMs: Value(session.lastActiveAt.millisecondsSinceEpoch),
      endedAtMs: Value(session.endedAt?.millisecondsSinceEpoch),
    );
  }

  ConnectionSession _rowToEntity(ConnectionSessionRow row) {
    return ConnectionSession(
      id: row.id,
      deviceId: row.deviceId,
      transport: _transport(row.transport),
      endpoint: row.endpoint,
      startedAt: DateTime.fromMillisecondsSinceEpoch(row.startedAtMs),
      lastActiveAt: DateTime.fromMillisecondsSinceEpoch(row.lastActiveAtMs),
      endedAt: row.endedAtMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(row.endedAtMs!),
    );
  }

  static ConnectionTransport _transport(String name) {
    for (final value in ConnectionTransport.values) {
      if (value.name == name) return value;
    }
    return ConnectionTransport.direct;
  }
}
