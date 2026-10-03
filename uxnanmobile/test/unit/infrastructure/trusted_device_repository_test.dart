import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
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

const _relay = RelayEndpoint(
  url: 'wss://uxnan-relay.example.workers.dev',
  routingId: '0123456789abcdef0123456789abcdef',
  enabled: true,
);

TrustedDevice _device(
  String id, {
  Uint8List? key,
  RelayEndpoint? relay = _relay,
  List<String> hosts = const [],
  int lastAppliedBridgeOutboundSeq = 0,
}) =>
    TrustedDevice(
      macDeviceId: id,
      displayName: 'Device $id',
      macIdentityPublicKey:
          key ?? Uint8List.fromList(List<int>.generate(32, (i) => i)),
      relay: relay,
      hosts: hosts,
      sessionId: 'session-$id',
      pairedAt: DateTime(2026),
      lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
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
    // A PC renamed on the desktop kept coming back under its old name: the
    // connection wrote the whole record back from an older copy each time it
    // advanced its cursor or stamped "last seen".
    test('each setter writes its own field, never undoing a rename', () async {
      await repo.saveDevice(_device('mac-1', lastAppliedBridgeOutboundSeq: 4));
      await repo.rename('mac-1', 'MacBook');
      await repo.recordLastSeen('mac-1', DateTime(2026, 9, 27, 22));
      await repo.recordBridgeOutboundSeq('mac-1', 9);

      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.displayName, 'MacBook');
      expect(loaded.lastSeen, DateTime(2026, 9, 27, 22));
      expect(loaded.lastAppliedBridgeOutboundSeq, 9);
      expect(loaded.sessionId, 'session-mac-1');
    });

    test('the bridge sequence never goes back', () async {
      await repo.saveDevice(_device('mac-1', lastAppliedBridgeOutboundSeq: 9));
      await repo.recordBridgeOutboundSeq('mac-1', 5);
      expect((await repo.getDevice('mac-1'))!.lastAppliedBridgeOutboundSeq, 9);
    });

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
      expect(loaded.relay, _relay);
    });

    test("stores the PC's relay as it changes, and clears it", () async {
      await repo.saveDevice(_device('mac-1', relay: null));
      expect((await repo.getDevice('mac-1'))!.relay, isNull);

      await repo.recordLastSeen('mac-1', DateTime(2026, 10));
      await repo.recordRelay('mac-1', _relay);
      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.relay, _relay);
      expect(loaded.lastSeen, DateTime(2026, 10));

      const off = RelayEndpoint(
        url: 'wss://uxnan-relay.example.workers.dev',
        routingId: 'fedcba9876543210fedcba9876543210',
        enabled: false,
      );
      await repo.recordRelay('mac-1', off);
      expect((await repo.getDevice('mac-1'))!.relay, off);

      await repo.recordRelay('mac-1', null);
      expect((await repo.getDevice('mac-1'))!.relay, isNull);
    });

    test('round-trips direct LAN/Tailscale hosts', () async {
      await repo.saveDevice(
        _device('mac-1', hosts: const ['192.168.1.5:8765', '100.64.0.2:8765']),
      );
      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.hosts, ['192.168.1.5:8765', '100.64.0.2:8765']);
    });

    test('a relay-only device loads with empty hosts', () async {
      await repo.saveDevice(_device('mac-1'));
      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.hosts, isEmpty);
    });

    test('round-trips the last applied bridge outbound seq', () async {
      await repo.saveDevice(_device('mac-1', lastAppliedBridgeOutboundSeq: 42));
      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.lastAppliedBridgeOutboundSeq, 42);
    });

    test('an older device (no seq stored) loads as 0', () async {
      await repo.saveDevice(_device('mac-1'));
      final loaded = await repo.getDevice('mac-1');
      expect(loaded!.lastAppliedBridgeOutboundSeq, 0);
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
