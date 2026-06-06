import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/infrastructure/repositories/trusted_device_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
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

TrustedDevice _device(String id, {Uint8List? key}) => TrustedDevice(
      macDeviceId: id,
      displayName: 'Device $id',
      macIdentityPublicKey:
          key ?? Uint8List.fromList(List<int>.generate(32, (i) => i)),
      relayUrl: 'wss://relay.test',
      sessionId: 'session-$id',
      pairedAt: DateTime(2026),
    );

void main() {
  late UxnanDatabase db;
  late _InMemorySecureStore secureStore;
  late TrustedDeviceRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    secureStore = _InMemorySecureStore();
    repo = TrustedDeviceRepository(db, secureStore);
  });

  tearDown(() async {
    await db.close();
  });

  group('TrustedDeviceRepository', () {
    test('saves metadata in drift and the identity key in secure storage',
        () async {
      final key =
          Uint8List.fromList(List<int>.generate(32, (i) => i * 2 % 256));
      await repo.saveDevice(_device('mac-1', key: key));

      // The identity key must not be stored in the database row.
      expect(secureStore.data.values.any((v) => v.isNotEmpty), isTrue);

      final loaded = await repo.getDevice('mac-1');
      expect(loaded, isNotNull);
      expect(loaded!.displayName, 'Device mac-1');
      expect(loaded.macIdentityPublicKey, key);
      expect(loaded.relayUrl, 'wss://relay.test');
    });

    test('getDevice returns null for an unknown id', () async {
      expect(await repo.getDevice('missing'), isNull);
    });

    test('getDevices returns all saved devices', () async {
      await repo.saveDevice(_device('a'));
      await repo.saveDevice(_device('b'));
      final devices = await repo.getDevices();
      expect(devices.map((d) => d.macDeviceId).toSet(), {'a', 'b'});
    });

    test('deleteDevice removes both the row and the stored key', () async {
      await repo.saveDevice(_device('a'));
      await repo.deleteDevice('a');
      expect(await repo.getDevice('a'), isNull);
      expect(secureStore.data.isEmpty, isTrue);
    });

    test('getDevice returns null when the identity key is missing', () async {
      await repo.saveDevice(_device('a'));
      await secureStore.clearAll(); // simulate lost secret
      expect(await repo.getDevice('a'), isNull);
    });
  });
}
