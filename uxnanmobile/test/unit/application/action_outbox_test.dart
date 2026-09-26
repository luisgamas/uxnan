import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/action_outbox.dart';
import 'package:uxnan/domain/value_objects/pending_action.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_bridge_replica_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

const _ok = RpcMessage(id: '1', result: <String, dynamic>{});

void main() {
  late UxnanDatabase db;
  late DriftBridgeReplicaRepository repo;
  late DateTime now;
  late ActionOutbox outbox;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftBridgeReplicaRepository(db);
    now = DateTime(2026, 9, 25, 12);
    outbox = ActionOutbox(repository: repo, clock: () => now);
  });

  tearDown(() => db.close());

  Future<void> keep(
    String target,
    PendingActionKind kind, {
    String deviceId = 'pc-1',
    String? value,
  }) =>
      outbox.keep(
        PendingAction(
          deviceId: deviceId,
          kind: kind,
          targetId: target,
          value: value,
          decidedAt: now,
        ),
      );

  Future<List<String>> pending([String deviceId = 'pc-1']) async => [
        for (final a in await repo.pendingActions(deviceId))
          '${a.targetId}:${a.kind.name}${a.value == null ? '' : '=${a.value}'}',
      ];

  test('keeps only what still matters for each target', () async {
    await keep('a', PendingActionKind.renameThread, value: 'One');
    await keep('a', PendingActionKind.archiveThread);
    await keep('a', PendingActionKind.renameThread, value: 'Two');
    await keep('b', PendingActionKind.archiveThread);
    await keep('b', PendingActionKind.unarchiveThread);
    await keep('c', PendingActionKind.renameThread, value: 'Gone');
    await keep('c', PendingActionKind.deleteThread);
    await keep('pc-1', PendingActionKind.renamePc, value: 'Desk');
    await keep('pc-1', PendingActionKind.renamePc, value: 'Studio');
    await keep('z', PendingActionKind.archiveThread, deviceId: 'pc-2');

    expect(
      await pending(),
      [
        'a:archiveThread',
        'a:renameThread=Two',
        'b:unarchiveThread',
        'c:deleteThread',
        'pc-1:renamePc=Studio',
      ],
    );
    expect(await pending('pc-2'), ['z:archiveThread']);
  });

  test('sends in order, dated by how long ago each was decided', () async {
    await keep('a', PendingActionKind.renameThread, value: 'Offline');
    now = now.add(const Duration(minutes: 2));
    await keep('pc-1', PendingActionKind.renamePc, value: 'Studio');
    now = now.add(const Duration(minutes: 3));

    final sent = <(String, Map<String, dynamic>?)>[];
    final ok = await outbox.flush('pc-1', (method, [params]) async {
      sent.add((method, params));
      return _ok;
    });

    expect(ok, isTrue);
    expect(sent.map((s) => s.$1), ['thread/rename', 'settings/set']);
    expect(sent[0].$2, {'threadId': 'a', 'title': 'Offline', 'ageMs': 300000});
    expect(sent[1].$2, {'name': 'Studio', 'ageMs': 180000});
    expect(await pending(), isEmpty);
  });

  test('drops what the bridge refuses: there is nothing to retry', () async {
    await keep('gone', PendingActionKind.archiveThread);
    final ok = await outbox.flush(
      'pc-1',
      (method, [params]) async => const RpcMessage(
        id: '1',
        error: RpcError(code: -32008, message: 'thread not found'),
      ),
    );
    expect(ok, isTrue);
    expect(await pending(), isEmpty);
  });

  test('stops and keeps the rest when the PC is out of reach again', () async {
    await keep('a', PendingActionKind.archiveThread);
    await keep('b', PendingActionKind.archiveThread);
    var calls = 0;
    final ok = await outbox.flush('pc-1', (method, [params]) async {
      calls++;
      if (calls == 2) throw TimeoutException('lost');
      return _ok;
    });
    expect(ok, isFalse);
    expect(await pending(), ['b:archiveThread']);
  });

  test('deliver sends when reachable and keeps otherwise, or when lost',
      () async {
    final action = PendingAction(
      deviceId: 'pc-1',
      kind: PendingActionKind.renamePc,
      targetId: 'pc-1',
      value: 'Studio',
      decidedAt: now,
    );
    final sent = <String>[];
    await outbox.deliver(
      action,
      (method, [params]) async {
        sent.add(method);
        return _ok;
      },
      reachable: true,
    );
    expect(sent, ['settings/set']);
    expect(await pending(), isEmpty);

    await outbox.deliver(
      action,
      (method, [params]) async => _ok,
      reachable: false,
    );
    expect(await pending(), ['pc-1:renamePc=Studio']);

    await repo.removeAction((await repo.pendingActions('pc-1')).single.id!);
    await outbox.deliver(
      action,
      (method, [params]) async => throw TimeoutException('lost'),
      reachable: true,
    );
    expect(await pending(), ['pc-1:renamePc=Studio']);
  });

  test('forgetting a PC drops its waiting actions', () async {
    await keep('a', PendingActionKind.archiveThread);
    await repo.forgetDevice('pc-1');
    expect(await pending(), isEmpty);
  });
}
