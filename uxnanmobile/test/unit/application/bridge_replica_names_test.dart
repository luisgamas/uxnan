import 'dart:async';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/action_outbox.dart';
import 'package:uxnan/application/managers/bridge_replica.dart';
import 'package:uxnan/application/managers/phone_name_manager.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/repositories/i_phone_profile_repository.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/domain/value_objects/phone_details.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_bridge_replica_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

class _Pcs implements ITrustedDeviceRepository {
  final Map<String, TrustedDevice> devices = {};

  @override
  Future<void> deleteDevice(String macDeviceId) async =>
      devices.remove(macDeviceId);

  @override
  Future<TrustedDevice?> getDevice(String macDeviceId) async =>
      devices[macDeviceId];

  @override
  Future<List<TrustedDevice>> getDevices() async => devices.values.toList();

  @override
  Future<void> saveDevice(TrustedDevice device) async =>
      devices[device.macDeviceId] = device;

  @override
  Stream<List<TrustedDevice>> watchDevices() =>
      Stream.value(devices.values.toList());
}

class _Profile implements IPhoneProfileRepository {
  PhoneNameChoice? choice;

  @override
  Future<PhoneDetails> details() async =>
      const PhoneDetails(defaultName: 'Pixel 9', platform: 'android');

  @override
  Future<PhoneNameChoice?> chosenName() async => choice;

  @override
  Future<void> saveChosenName(PhoneNameChoice choice) async =>
      this.choice = choice;
}

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// Names every client shares (architecture/02a §5.8.17), as the phone applies
/// and changes them.
void main() {
  late UxnanDatabase db;
  late DriftBridgeReplicaRepository replicaRepo;
  late StreamController<DomainEvent> events;
  late StreamController<ConnectionPhase> phases;
  late ThreadManager threads;
  late BridgeReplica replica;
  late _Pcs pcs;
  late PhoneNameManager phoneName;
  late List<(String, Map<String, dynamic>?)> calls;
  late String? lose;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    replicaRepo = DriftBridgeReplicaRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    phases = StreamController<ConnectionPhase>.broadcast();
    calls = [];
    lose = null;
    pcs = _Pcs()
      ..devices['pc-1'] = TrustedDevice(
        macDeviceId: 'pc-1',
        displayName: 'MacBook-Pro.local',
        macIdentityPublicKey: Uint8List(32),
        relayUrl: '',
        sessionId: 's',
        pairedAt: DateTime(2026),
      );
    phoneName = PhoneNameManager(repository: _Profile());
    Future<RpcMessage> send(String method, [Map<String, dynamic>? params]) {
      calls.add((method, params));
      if (method == lose) return Future.error(TimeoutException('lost'));
      final Object result = switch (method) {
        'sync/changes' => {
            'storeId': 's1',
            'rev': 3,
            'reset': true,
            'settings': {'home': '/Users/me', 'name': 'Studio'},
            'threads': <Object>[],
            'removedThreadIds': <Object>[],
            'projects': <Object>[],
            'removedProjectIds': <Object>[],
            'clients': <Object>[],
            'devices': [
              {'deviceId': 'phone-1', 'displayName': 'Pixel 9'},
            ],
          },
        'device/describe' => {
            'device': {
              'deviceId': 'phone-1',
              'displayName': params?['name'],
            },
          },
        _ => <String, dynamic>{},
      };
      return Future.value(RpcMessage.response(id: '1', result: result));
    }

    threads = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      sendRequest: send,
      currentDeviceId: () => 'pc-1',
    );
    replica = BridgeReplica(
      repository: replicaRepo,
      threadManager: threads,
      sendRequest: send,
      domainEvents: events.stream,
      currentDeviceId: () => 'pc-1',
      connectionPhases: phases.stream,
      outbox: ActionOutbox(repository: replicaRepo),
      phoneName: phoneName,
      pcs: pcs,
    );
  });

  tearDown(() async {
    await replica.dispose();
    await threads.dispose();
    await phoneName.dispose();
    await events.close();
    await phases.close();
    await db.close();
  });

  List<String> methods() => [for (final (m, _) in calls) m];

  test('a sync shows the PC by its shared name and lists its phones', () async {
    await replica.sync();
    expect(pcs.devices['pc-1']?.displayName, 'Studio');
    expect(
      (await replica.devicesStream.first).map((p) => p.name),
      ['Pixel 9'],
    );
    // And this phone says what it is called, after reading.
    expect(methods(), ['sync/changes', 'device/describe']);
    expect(phoneName.selfId, 'phone-1');
  });

  test('the PC renamed anywhere is renamed here', () async {
    phases.add(ConnectionPhase.connected);
    await _settle();
    events.add(
      const SettingsUpdatedEvent(home: '/Users/me', name: 'Desk', rev: 4),
    );
    await _settle();
    expect(pcs.devices['pc-1']?.displayName, 'Desk');
  });

  test('renaming the PC here: sent while reachable, kept while not', () async {
    phases.add(ConnectionPhase.connected);
    await _settle();
    calls.clear();
    await replica.renamePc('pc-1', 'Studio');
    expect(pcs.devices['pc-1']?.displayName, 'Studio');
    expect(calls.single.$1, 'settings/set');
    expect(calls.single.$2, {'name': 'Studio'});

    phases.add(ConnectionPhase.disconnected);
    await _settle();
    calls.clear();
    await replica.renamePc('pc-1', 'Desk');
    expect(calls, isEmpty);
    expect(pcs.devices['pc-1']?.displayName, 'Desk');
    expect(
      (await replicaRepo.pendingActions('pc-1')).single.value,
      'Desk',
    );
  });

  test('renaming this phone tells the connected PC at once', () async {
    phases.add(ConnectionPhase.connected);
    await _settle();
    calls.clear();
    await replica.renameThisPhone('Travel phone');
    expect(methods(), ['device/describe']);
    expect(calls.single.$2?['name'], 'Travel phone');
    expect(calls.single.$2?['nameAgeMs'], isA<int>());
    expect(phoneName.name, 'Travel phone');
  });

  test('renamed on another client: it describes itself again', () async {
    await replica.sync();
    calls.clear();
    events.add(
      const DevicesUpdatedEvent(
        devices: [
          {
            'deviceId': 'phone-1',
            'displayName': 'Renamed on the desktop',
            'nameSource': 'user',
          },
        ],
      ),
    );
    await _settle();
    expect(methods(), ['device/describe']);
  });
}
