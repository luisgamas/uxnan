import 'package:drift/drift.dart';

/// drift table of actions taken while the PC they belong to was out of reach,
/// kept until they are sent (architecture/02a §5.8.17). The id orders them.
@DataClassName('PendingActionRow')
class PendingActionsTable extends Table {
  /// Insertion order.
  IntColumn get id => integer().autoIncrement()();

  /// `macDeviceId` of the PC.
  TextColumn get deviceId => text()();

  /// `PendingActionKind.name`.
  TextColumn get kind => text()();

  /// What it was done to: a conversation id, or the PC's own id.
  TextColumn get targetId => text()();

  /// The new name, for a rename.
  TextColumn get value => text().nullable()();

  /// When the user decided it (this phone's clock).
  DateTimeColumn get decidedAt => dateTime()();
}
