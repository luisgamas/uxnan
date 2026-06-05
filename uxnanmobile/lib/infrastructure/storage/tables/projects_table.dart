import 'package:drift/drift.dart';

/// drift table backing projects (spec 02c section 10.1).
@DataClassName('ProjectRow')
class ProjectsTable extends Table {
  /// Unique project id (primary key).
  TextColumn get id => text()();

  /// Human readable project name.
  TextColumn get displayName => text()();

  /// Project working directory on the PC.
  TextColumn get cwd => text()();

  /// Wire identifier of the configured agent.
  TextColumn get agentId => text()();

  /// `AgentConfig` serialized as JSON.
  TextColumn get agentConfigJson => text()();

  /// Last active timestamp in epoch milliseconds, if any.
  IntColumn get lastActiveMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
