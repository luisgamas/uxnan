import 'package:uuid/uuid.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/storage/secure_store.dart';

/// Loads or creates the phone's permanent Ed25519 identity.
///
/// The identity is generated once and persisted in [SecureStore]; subsequent
/// launches reuse it (spec 02b RF-PAIR-08 / §5.2). The private seed never leaves
/// secure storage.
class PhoneIdentityStore {
  /// Creates a [PhoneIdentityStore] over the given secure `store`.
  PhoneIdentityStore(
    this._store, {
    KeyGeneration? keyGeneration,
    Uuid? uuid,
  })  : _keyGen = keyGeneration ?? KeyGeneration(),
        _uuid = uuid ?? const Uuid();

  final SecureStore _store;
  final KeyGeneration _keyGen;
  final Uuid _uuid;

  /// Returns the existing identity, generating and persisting one if needed.
  Future<PhoneIdentity> loadOrCreate() async {
    final publicHex = await _store.read(SecureStore.phonePublicKey);
    final privateHex = await _store.read(SecureStore.phonePrivateKey);
    final deviceId = await _store.read(SecureStore.phoneDeviceId);

    if (publicHex != null && privateHex != null && deviceId != null) {
      return PhoneIdentity(
        phoneDeviceId: deviceId,
        publicKey: publicHex.fromHex(),
        privateSeed: privateHex.fromHex(),
      );
    }

    final keyPair = await _keyGen.generateIdentityKeyPair();
    final newDeviceId = _uuid.v4();
    await _store.write(
      SecureStore.phonePublicKey,
      keyPair.publicKey.toHex(),
    );
    await _store.write(
      SecureStore.phonePrivateKey,
      keyPair.privateSeed.toHex(),
    );
    await _store.write(SecureStore.phoneDeviceId, newDeviceId);

    return PhoneIdentity(
      phoneDeviceId: newDeviceId,
      publicKey: keyPair.publicKey,
      privateSeed: keyPair.privateSeed,
    );
  }
}
