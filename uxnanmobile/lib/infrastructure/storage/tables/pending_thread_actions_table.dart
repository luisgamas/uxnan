import 'package:drift/drift.dart';

/// drift table of conversation actions taken while their PC was out of reach,
/// kept until they are sent (architecture/02a §5.8.17). The id orders them.
@DataClassName('PendingThreadActionRow')
class PendingThreadActionsTable extends Table {
  /// Insertion order.
  IntColumn get id => integer().autoIncrement()();

  /// `macDeviceId` of the conversation's PC.
  TextColumn get deviceId => text()();

  /// The conversation.
  TextColumn get threadId => text()();

  /// `PendingThreadActionKind.name`.
  TextColumn get kind => text()();

  /// The new title, for a rename.
  TextColumn get title => text().nullable()();

  /// When the user decided it (this phone's clock).
  DateTimeColumn get decidedAt => dateTime()();
}
