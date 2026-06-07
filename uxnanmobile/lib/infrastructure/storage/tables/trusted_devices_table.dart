import 'package:drift/drift.dart';

/// drift table backing trusted bridge devices (spec 02c section 10.1).
///
/// Note: `macIdentityPublicKey` is intentionally not stored here — it lives in
/// secure storage. This table holds only non-secret metadata.
@DataClassName('TrustedDeviceRow')
class TrustedDevicesTable extends Table {
  /// Bridge device id (primary key).
  TextColumn get macDeviceId => text()();

  /// Human readable device name.
  TextColumn get displayName => text()();

  /// Relay URL used to reach the bridge.
  TextColumn get relayUrl => text()();

  /// Session id established during pairing.
  TextColumn get sessionId => text()();

  /// Pairing timestamp in epoch milliseconds.
  IntColumn get pairedAtMs => integer()();

  /// Last seen timestamp in epoch milliseconds, if any.
  IntColumn get lastSeenMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {macDeviceId};
}
