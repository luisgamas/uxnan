import 'package:drift/drift.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/infrastructure/storage/secure_store.dart';

/// [ITrustedDeviceRepository] with split storage: non-secret fields in drift,
/// the bridge identity key in [SecureStore] (spec 02b §5.2 / 02c §10.1 note).
class TrustedDeviceRepository implements ITrustedDeviceRepository {
  /// Creates a [TrustedDeviceRepository].
  const TrustedDeviceRepository(this._db, this._secureStore);

  final UxnanDatabase _db;
  final SecureStore _secureStore;

  String _keyFor(String macDeviceId) =>
      'uxnan.device.$macDeviceId.mac_identity_public_key';

  @override
  Future<void> saveDevice(TrustedDevice device) async {
    await _db.into(_db.trustedDevicesTable).insertOnConflictUpdate(
          TrustedDevicesTableCompanion(
            macDeviceId: Value(device.macDeviceId),
            displayName: Value(device.displayName),
            relayUrl: Value(device.relayUrl),
            hosts: Value(_encodeHosts(device.hosts)),
            sessionId: Value(device.sessionId),
            pairedAtMs: Value(device.pairedAt.millisecondsSinceEpoch),
            lastSeenMs: Value(device.lastSeen?.millisecondsSinceEpoch),
          ),
        );
    await _secureStore.write(
      _keyFor(device.macDeviceId),
      device.macIdentityPublicKey.toHex(),
    );
  }

  @override
  Future<TrustedDevice?> getDevice(String macDeviceId) async {
    final row = await (_db.select(_db.trustedDevicesTable)
          ..where((d) => d.macDeviceId.equals(macDeviceId)))
        .getSingleOrNull();
    if (row == null) return null;
    final keyHex = await _secureStore.read(_keyFor(macDeviceId));
    if (keyHex == null) return null;
    return _rowToDevice(row, keyHex.fromHex());
  }

  @override
  Future<List<TrustedDevice>> getDevices() async {
    final rows = await _db.select(_db.trustedDevicesTable).get();
    final devices = <TrustedDevice>[];
    for (final row in rows) {
      final keyHex = await _secureStore.read(_keyFor(row.macDeviceId));
      if (keyHex != null) {
        devices.add(_rowToDevice(row, keyHex.fromHex()));
      }
    }
    return devices;
  }

  @override
  Stream<List<TrustedDevice>> watchDevices() {
    return _db.select(_db.trustedDevicesTable).watch().asyncMap((rows) async {
      final devices = <TrustedDevice>[];
      for (final row in rows) {
        final keyHex = await _secureStore.read(_keyFor(row.macDeviceId));
        if (keyHex != null) {
          devices.add(_rowToDevice(row, keyHex.fromHex()));
        }
      }
      return devices;
    });
  }

  @override
  Future<void> deleteDevice(String macDeviceId) async {
    await (_db.delete(_db.trustedDevicesTable)
          ..where((d) => d.macDeviceId.equals(macDeviceId)))
        .go();
    await _secureStore.delete(_keyFor(macDeviceId));
  }

  TrustedDevice _rowToDevice(TrustedDeviceRow row, Uint8List macKey) =>
      TrustedDevice(
        macDeviceId: row.macDeviceId,
        displayName: row.displayName,
        macIdentityPublicKey: macKey,
        relayUrl: row.relayUrl,
        hosts: _decodeHosts(row.hosts),
        sessionId: row.sessionId,
        pairedAt: DateTime.fromMillisecondsSinceEpoch(row.pairedAtMs),
        lastSeen: row.lastSeenMs != null
            ? DateTime.fromMillisecondsSinceEpoch(row.lastSeenMs!)
            : null,
      );

  /// Serializes hosts newline-separated; `null` for an empty list so older rows
  /// and relay-only devices stay indistinguishable on read.
  static String? _encodeHosts(List<String> hosts) =>
      hosts.isEmpty ? null : hosts.join('\n');

  static List<String> _decodeHosts(String? raw) {
    if (raw == null || raw.isEmpty) return const [];
    return raw.split('\n').where((h) => h.isNotEmpty).toList(growable: false);
  }
}
