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

  /// Relay URL used to reach the bridge (empty for a LAN/Tailscale-only device).
  TextColumn get relayUrl => text()();

  /// Direct `host:port` addresses (LAN / Tailscale) advertised in the pairing
  /// QR, stored newline-separated. Nullable/absent for older rows (schema < 4).
  TextColumn get hosts => text().nullable()();

  /// Session id established during pairing.
  TextColumn get sessionId => text()();

  /// Pairing timestamp in epoch milliseconds.
  IntColumn get pairedAtMs => integer()();

  /// Last seen timestamp in epoch milliseconds, if any.
  IntColumn get lastSeenMs => integer().nullable()();

  /// Highest bridge→phone `seq` this phone has applied for this device, sent on
  /// reconnect as `clientHello.resumeState.lastAppliedBridgeOutboundSeq` so the
  /// bridge replays only what was missed (spec 02a §5.9.2). Nullable/absent for
  /// older rows (schema < 5); treated as 0.
  IntColumn get lastAppliedBridgeOutboundSeq => integer().nullable()();

  @override
  Set<Column> get primaryKey => {macDeviceId};
}
