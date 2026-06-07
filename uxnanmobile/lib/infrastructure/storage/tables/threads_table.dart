import 'package:drift/drift.dart';

/// drift table backing conversation threads (spec 02c section 10.1).
@DataClassName('ThreadRow')
class ThreadsTable extends Table {
  /// Unique thread id (primary key).
  TextColumn get id => text()();

  /// Human readable title.
  TextColumn get title => text()();

  /// Owning project id, if any.
  TextColumn get projectId => text().nullable()();

  /// `macDeviceId` of the paired PC this thread belongs to, if known. Lets the
  /// threads list be scoped to the selected device.
  TextColumn get deviceId => text().nullable()();

  /// Working directory on the PC, if known.
  TextColumn get cwd => text().nullable()();

  /// Backing git worktree path, if any.
  TextColumn get worktreePath => text().nullable()();

  /// Wire identifier of the handling agent.
  TextColumn get agentId => text()();

  /// Model the agent runs (bridge id / display name), if known.
  TextColumn get model => text().nullable()();

  /// `ThreadSyncState` serialized as its enum name.
  TextColumn get syncState => text()();

  /// `ThreadStatus` serialized as its enum name.
  TextColumn get status => text()();

  /// Last activity timestamp in epoch milliseconds, if any.
  IntColumn get lastActivityMs => integer().nullable()();

  /// Row creation timestamp in epoch milliseconds.
  IntColumn get createdAtMs => integer()();

  @override
  Set<Column> get primaryKey => {id};
}
