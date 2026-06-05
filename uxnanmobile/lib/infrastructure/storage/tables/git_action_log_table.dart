import 'package:drift/drift.dart';

/// drift table recording executed Git actions (spec 02c section 10.1).
@DataClassName('GitActionLogRow')
class GitActionLogTable extends Table {
  /// Unique log entry id (primary key).
  TextColumn get id => text()();

  /// Owning thread id.
  TextColumn get threadId => text()();

  /// `GitActionKind` serialized as its enum name.
  TextColumn get kind => text()();

  /// Outcome status (`completed` or `error`).
  TextColumn get status => text()();

  /// Action parameters serialized as JSON.
  TextColumn get paramsJson => text()();

  /// Action result serialized as JSON, if successful.
  TextColumn get resultJson => text().nullable()();

  /// Error message, if the action failed.
  TextColumn get errorMessage => text().nullable()();

  /// Start timestamp in epoch milliseconds.
  IntColumn get startedAtMs => integer()();

  /// Completion timestamp in epoch milliseconds, if completed.
  IntColumn get completedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
