import 'package:drift/drift.dart';

/// drift table backing turns within a thread (spec 02c section 10.1).
@DataClassName('TurnRow')
@TableIndex(name: 'idx_turns_thread_id', columns: {#threadId})
class TurnsTable extends Table {
  /// Unique turn id (primary key).
  TextColumn get id => text()();

  /// Owning thread id.
  TextColumn get threadId => text()();

  /// `TurnStatus` serialized as its enum name.
  TextColumn get status => text()();

  /// Git action progress serialized as JSON, if any.
  TextColumn get gitProgressJson => text().nullable()();

  /// Subagent state serialized as JSON, if any.
  TextColumn get subagentStateJson => text().nullable()();

  /// Plan-mode state serialized as JSON, if any.
  TextColumn get planStateJson => text().nullable()();

  /// Start timestamp in epoch milliseconds.
  IntColumn get startedAtMs => integer()();

  /// Completion timestamp in epoch milliseconds, if completed.
  IntColumn get completedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
