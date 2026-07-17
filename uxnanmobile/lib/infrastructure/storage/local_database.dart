import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:uxnan/infrastructure/storage/tables/composer_drafts_table.dart';
import 'package:uxnan/infrastructure/storage/tables/connection_sessions_table.dart';
import 'package:uxnan/infrastructure/storage/tables/git_action_log_table.dart';
import 'package:uxnan/infrastructure/storage/tables/messages_table.dart';
import 'package:uxnan/infrastructure/storage/tables/projects_table.dart';
import 'package:uxnan/infrastructure/storage/tables/threads_table.dart';
import 'package:uxnan/infrastructure/storage/tables/trusted_devices_table.dart';
import 'package:uxnan/infrastructure/storage/tables/turns_table.dart';

part 'local_database.g.dart';

/// The app's local SQLite database (drift).
///
/// Schema and pragmas follow `architecture/02c-implementation-guide.md`
/// (section 10.2). The default constructor opens the on-device file; use
/// [UxnanDatabase.forTesting] with an in-memory executor in tests.
@DriftDatabase(
  tables: [
    ThreadsTable,
    MessagesTable,
    TurnsTable,
    ProjectsTable,
    TrustedDevicesTable,
    ComposerDraftsTable,
    GitActionLogTable,
    ConnectionSessionsTable,
  ],
)
class UxnanDatabase extends _$UxnanDatabase {
  /// Opens the on-device database file.
  UxnanDatabase() : super(_openConnection());

  /// Creates a database over the given [executor]. Intended for tests.
  UxnanDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 6;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          // v2: threads carry the agent's model (nullable).
          if (from < 2) {
            await m.addColumn(threadsTable, threadsTable.model);
          }
          // v3: threads are scoped to a paired device; purge the old UI-demo
          // sample data (a fake PC + sample claude/codex threads).
          if (from < 3) {
            await m.addColumn(threadsTable, threadsTable.deviceId);
            const demoThreadIds = ['demo-thread', 'demo-thread-2'];
            await (delete(threadsTable)..where((t) => t.id.isIn(demoThreadIds)))
                .go();
            await (delete(trustedDevicesTable)
                  ..where((d) => d.macDeviceId.equals('demo-mac')))
                .go();
          }
          // v4: trusted devices carry direct LAN/Tailscale hosts (nullable) so
          // the phone can connect directly before falling back to the relay.
          if (from < 4) {
            await m.addColumn(trustedDevicesTable, trustedDevicesTable.hosts);
          }
          // v5: trusted devices remember the last bridge→phone seq applied
          // (nullable) so a reconnect can request seq-based catch-up.
          if (from < 5) {
            await m.addColumn(
              trustedDevicesTable,
              trustedDevicesTable.lastAppliedBridgeOutboundSeq,
            );
          }
          // v6: phone-only connection-session log powering the connection
          // metrics (time connected, longest session, sessions count,
          // relay-vs-direct split) on the profile / per-PC screens.
          if (from < 6) {
            await m.createTable(connectionSessionsTable);
          }
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA journal_mode=WAL');
          await customStatement('PRAGMA foreign_keys=ON');
          await customStatement('PRAGMA synchronous=NORMAL');
        },
      );

  static QueryExecutor _openConnection() {
    return driftDatabase(
      name: 'uxnan_local',
      native: const DriftNativeOptions(shareAcrossIsolates: true),
    );
  }
}
