import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/storage/phone_identity_store.dart';
import 'package:uxnan/infrastructure/storage/secure_store.dart';

class _InMemorySecureStore implements SecureStore {
  final Map<String, String> data = {};

  @override
  Future<void> write(String key, String value) async => data[key] = value;

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<void> delete(String key) async => data.remove(key);

  @override
  Future<void> clearAll() async => data.clear();
}

void main() {
  group('PhoneIdentityStore', () {
    test('creates and persists an identity on first load', () async {
      final store = _InMemorySecureStore();
      final identity = await PhoneIdentityStore(store).loadOrCreate();

      expect(identity.publicKey.length, 32);
      expect(identity.privateSeed.length, 32);
      expect(identity.phoneDeviceId, isNotEmpty);
      expect(store.data[SecureStore.phonePublicKey], isNotNull);
      expect(store.data[SecureStore.phonePrivateKey], isNotNull);
      expect(store.data[SecureStore.phoneDeviceId], identity.phoneDeviceId);
    });

    test('returns the same identity on subsequent loads', () async {
      final store = _InMemorySecureStore();
      final first = await PhoneIdentityStore(store).loadOrCreate();
      final second = await PhoneIdentityStore(store).loadOrCreate();

      expect(second.phoneDeviceId, first.phoneDeviceId);
      expect(second.publicKey, first.publicKey);
      expect(second.privateSeed, first.privateSeed);
    });
  });
}
