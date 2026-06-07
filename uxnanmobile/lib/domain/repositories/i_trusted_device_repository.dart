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

  /// Inserts or updates [device].
  Future<void> saveDevice(TrustedDevice device);

  /// Deletes the device with [macDeviceId].
  Future<void> deleteDevice(String macDeviceId);
}
