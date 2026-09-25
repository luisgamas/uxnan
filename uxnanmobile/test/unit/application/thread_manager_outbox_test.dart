import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_action_outbox.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_bridge_replica_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Future<void> _settle() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// A conversation action while the conversation's PC is out of reach waits in
/// the outbox; while it is the connected PC, it goes right away
/// (architecture/02a §5.8.17).
void main() {
  late UxnanDatabase db;
  late DriftThreadRepository threads;
  late DriftBridgeReplicaRepository replica;
  late StreamController<DomainEvent> events;
  late StreamController<ConnectionPhase> phases;
  late ThreadManager manager;
  late List<String> sent;
  late FutureOr<RpcMessage> Function(String method) answer;
  String? connectedPc;

  setUp(() async {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    threads = DriftThreadRepository(db);
    replica = DriftBridgeReplicaRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    phases = StreamController<ConnectionPhase>.broadcast();
    sent = [];
    connectedPc = 'pc-1';
    answer = (_) => const RpcMessage(id: '1', result: <String, dynamic>{});
    manager = ThreadManager(
      threadRepository: threads,
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      connectionPhases: phases.stream,
      currentDeviceId: () => connectedPc,
      outbox: ThreadActionOutbox(repository: replica),
      sendRequest: (method, [params]) async {
        sent.add(method);
        return answer(method);
      },
    );
    for (final (id, pc) in [('t1', 'pc-1'), ('t2', 'pc-2')]) {
      await manager.applyReplicaThreads(
        deviceId: pc,
        threads: [
          {'id': id, 'title': 'T', 'agentId': 'codex', 'status': 'active'},
        ],
        removedIds: const [],
        reset: false,
      );
    }
    phases.add(ConnectionPhase.connected);
    await _settle();
  });

  tearDown(() async {
    await manager.dispose();
    await events.close();
    await phases.close();
    await db.close();
  });

  Future<List<String>> waiting(String pc) async => [
        for (final a in await replica.pendingThreadActions(pc))
          '${a.threadId}:${a.kind.name}',
      ];

  test('goes right away to the connected PC', () async {
    await manager.archiveThread('t1');
    expect(sent, ['thread/archive']);
    expect(await waiting('pc-1'), isEmpty);
  });

  test('waits while no PC is reachable, and still shows here', () async {
    phases.add(ConnectionPhase.disconnected);
    await _settle();
    await manager.renameThread('t1', 'Offline name');
    await manager.archiveThread('t1');

    expect(sent, isEmpty);
    expect(await waiting('pc-1'), ['t1:rename', 't1:archive']);
    final stored = await threads.getThread('t1');
    expect(stored?.title, 'Offline name');
    expect(stored?.status, ThreadStatus.archived);
  });

  test('a conversation of another PC waits for that PC, not this one',
      () async {
    await manager.deleteThread('t2');
    expect(sent, isEmpty);
    expect(await waiting('pc-2'), ['t2:delete']);
    expect(await threads.getThread('t2'), isNull);
  });

  test('one lost on the way waits; one the bridge refuses does not', () async {
    answer = (_) => throw TimeoutException('lost');
    await manager.unarchiveThread('t1');
    expect(await waiting('pc-1'), ['t1:unarchive']);

    answer = (_) => const RpcMessage(
          id: '1',
          error: RpcError(code: -32008, message: 'thread not found'),
        );
    await manager.renameThread('t1', 'Named');
    expect(await waiting('pc-1'), ['t1:unarchive']);
  });
}
