import 'package:drift/drift.dart';

/// drift table recording how far this phone's copy of each PC's bridge has
/// caught up (`sync/changes`, architecture/02a §5.8.17).
@DataClassName('ReplicaCursorRow')
class ReplicaCursorsTable extends Table {
  /// `macDeviceId` of the PC.
  TextColumn get deviceId => text()();

  /// The bridge's state-directory identity the revision belongs to.
  TextColumn get storeId => text()();

  /// The last sync revision applied.
  IntColumn get rev => integer()();

  /// The PC's shared start folder, when known.
  TextColumn get home => text().nullable()();

  @override
  Set<Column> get primaryKey => {deviceId};
}
