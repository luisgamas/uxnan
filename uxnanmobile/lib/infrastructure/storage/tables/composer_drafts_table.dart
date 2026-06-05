import 'package:drift/drift.dart';

/// drift table backing per-thread composer drafts (spec 02c section 10.1).
@DataClassName('ComposerDraftRow')
class ComposerDraftsTable extends Table {
  /// Owning thread id (primary key — one draft per thread).
  TextColumn get threadId => text()();

  /// The draft text.
  TextColumn get draft => text()();

  /// Last update timestamp in epoch milliseconds.
  IntColumn get updatedAtMs => integer()();

  @override
  Set<Column> get primaryKey => {threadId};
}
