import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Encrypted key/value storage for secrets (spec 02a §5.3.3).
///
/// Backed by the OS keystore: Keychain on iOS, EncryptedSharedPreferences /
/// Keystore on Android. An interface so the identity store and session
/// repositories can be unit-tested against an in-memory double.
abstract class SecureStore {
  /// Writes [value] under [key].
  Future<void> write(String key, String value);

  /// Reads the value stored under [key], or `null` if absent.
  Future<String?> read(String key);

  /// Deletes the value stored under [key].
  Future<void> delete(String key);

  /// Removes all stored values.
  Future<void> clearAll();

  /// Storage key for the phone's Ed25519 private seed.
  static const String phonePrivateKey = 'uxnan.phone.private_key';

  /// Storage key for the phone's Ed25519 public key.
  static const String phonePublicKey = 'uxnan.phone.public_key';

  /// Storage key for the phone's stable device id.
  static const String phoneDeviceId = 'uxnan.phone.device_id';

  /// Storage key for the push notification secret.
  static const String notificationSecret = 'uxnan.push.notification_secret';
}

/// [SecureStore] backed by `flutter_secure_storage`.
class FlutterSecureStore implements SecureStore {
  /// Creates a [FlutterSecureStore], optionally injecting [storage].
  FlutterSecureStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);

  @override
  Future<void> clearAll() => _storage.deleteAll();
}
