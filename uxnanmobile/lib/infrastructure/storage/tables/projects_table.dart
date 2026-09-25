import 'package:drift/drift.dart';

/// drift table holding each paired PC's project registry (architecture/02a
/// §5.8.17) — the phone's copy of the list Uxnan Desktop shows on that PC.
///
/// Keyed by PC and project id together: the id derives from the folder, so two
/// PCs with a project at the same path would otherwise collide.
@DataClassName('ProjectRow')
class ProjectsTable extends Table {
  /// `macDeviceId` of the PC whose registry this entry belongs to.
  TextColumn get deviceId => text()();

  /// The bridge's project id.
  TextColumn get id => text()();

  /// Display name.
  TextColumn get name => text()();

  /// Folder on the PC.
  TextColumn get cwd => text()();

  /// Pinned agent wire id, if any.
  TextColumn get agentId => text().nullable()();

  /// How it entered the registry (`user`, `desktop`, `thread`, `config`).
  TextColumn get source => text().nullable()();

  @override
  Set<Column> get primaryKey => {deviceId, id};
}
