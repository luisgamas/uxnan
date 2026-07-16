import 'package:drift/drift.dart';

/// drift table logging each phone→PC connection session (phone-only), powering
/// the connection metrics on the profile / per-PC screens.
@DataClassName('ConnectionSessionRow')
class ConnectionSessionsTable extends Table {
  /// Unique session id (primary key).
  TextColumn get id => text()();

  /// The `macDeviceId` of the PC this session connected to.
  TextColumn get deviceId => text()();

  /// `ConnectionTransport` serialized as its enum name (`direct` / `relay`).
  TextColumn get transport => text()();

  /// The real URL the channel used (winning direct host, or the relay), if
  /// known.
  TextColumn get endpoint => text().nullable()();

  /// When the live channel was committed, in epoch milliseconds.
  IntColumn get startedAtMs => integer()();

  /// Last moment the channel was confirmed alive (heartbeat), in epoch ms.
  IntColumn get lastActiveAtMs => integer()();

  /// When the session was torn down, in epoch ms, or null while still open.
  IntColumn get endedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
