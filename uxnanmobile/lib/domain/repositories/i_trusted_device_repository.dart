import 'package:uxnan/domain/entities/trusted_device.dart';

/// Contract for persisting trusted bridge devices (spec 02a §5.1.4).
///
/// Implementations split storage: non-secret fields go to the local database,
/// while the bridge's identity public key is kept in secure storage.
abstract class ITrustedDeviceRepository {
  /// Returns all trusted devices.
  Future<List<TrustedDevice>> getDevices();

  /// Emits the trusted device list whenever it changes.
  Stream<List<TrustedDevice>> watchDevices();

  /// Returns the device with [macDeviceId], or `null` if absent.
  Future<TrustedDevice?> getDevice(String macDeviceId);

  /// Inserts or updates [device] — the whole record, so only pairing writes
  /// it this way. Everything that changes one field afterwards goes through
  /// the setters below: a whole-record write from a copy taken earlier would
  /// put back whatever else changed meanwhile (a PC renamed on the desktop
  /// kept coming back under its old name).
  Future<void> saveDevice(TrustedDevice device);

  /// Stores [name] as what this phone calls the PC [macDeviceId].
  Future<void> rename(String macDeviceId, String name);

  /// Records that the PC [macDeviceId] was last reached at [at].
  Future<void> recordLastSeen(String macDeviceId, DateTime at);

  /// Advances the last bridge sequence applied from the PC [macDeviceId] to
  /// [seq]; a lower one than stored is ignored.
  Future<void> recordBridgeOutboundSeq(String macDeviceId, int seq);

  /// Deletes the device with [macDeviceId].
  Future<void> deleteDevice(String macDeviceId);
}
