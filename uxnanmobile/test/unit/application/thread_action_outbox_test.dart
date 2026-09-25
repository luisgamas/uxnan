import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_action_outbox.dart';
import 'package:uxnan/domain/value_objects/pending_thread_action.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_bridge_replica_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

void main() {
  late UxnanDatabase db;
  late DriftBridgeReplicaRepository repo;
  late DateTime now;
  late ThreadActionOutbox outbox;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftBridgeReplicaRepository(db);
    now = DateTime(2026, 9, 25, 12);
    outbox = ThreadActionOutbox(repository: repo, clock: () => now);
  });

  tearDown(() => db.close());

  Future<void> keep(
    String threadId,
    PendingThreadActionKind kind, {
    String deviceId = 'pc-1',
    String? title,
  }) =>
      outbox.keep(
        deviceId: deviceId,
        threadId: threadId,
        kind: kind,
        title: title,
      );

  Future<List<String>> pending([String deviceId = 'pc-1']) async => [
        for (final a in await repo.pendingThreadActions(deviceId))
          '${a.threadId}:${a.kind.name}${a.title == null ? '' : '=${a.title}'}',
      ];

  test('keeps only what still matters for each conversation', () async {
    await keep('a', PendingThreadActionKind.rename, title: 'One');
    await keep('a', PendingThreadActionKind.archive);
    await keep('a', PendingThreadActionKind.rename, title: 'Two');
    await keep('b', PendingThreadActionKind.archive);
    await keep('b', PendingThreadActionKind.unarchive);
    await keep('c', PendingThreadActionKind.rename, title: 'Gone');
    await keep('c', PendingThreadActionKind.delete);
    await keep('z', PendingThreadActionKind.archive, deviceId: 'pc-2');

    expect(
      await pending(),
      ['a:archive', 'a:rename=Two', 'b:unarchive', 'c:delete'],
    );
    expect(await pending('pc-2'), ['z:archive']);
  });

  test('sends in order, dated by how long ago each was decided', () async {
    await keep('a', PendingThreadActionKind.rename, title: 'Offline');
    now = now.add(const Duration(minutes: 2));
    await keep('b', PendingThreadActionKind.delete);
    now = now.add(const Duration(minutes: 3));

    final sent = <(String, Map<String, dynamic>?)>[];
    final ok = await outbox.flush('pc-1', (method, [params]) async {
      sent.add((method, params));
      return const RpcMessage(id: '1', result: <String, dynamic>{});
    });

    expect(ok, isTrue);
    expect(sent.map((s) => s.$1), ['thread/rename', 'thread/delete']);
    expect(sent[0].$2, {'threadId': 'a', 'title': 'Offline', 'ageMs': 300000});
    expect(sent[1].$2, {'threadId': 'b', 'ageMs': 180000});
    expect(await pending(), isEmpty);
  });

  test('drops what the bridge refuses: there is nothing to retry', () async {
    await keep('gone', PendingThreadActionKind.archive);
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
    await keep('a', PendingThreadActionKind.archive);
    await keep('b', PendingThreadActionKind.archive);
    var calls = 0;
    final ok = await outbox.flush('pc-1', (method, [params]) async {
      calls++;
      if (calls == 2) throw TimeoutException('lost');
      return const RpcMessage(id: '1', result: <String, dynamic>{});
    });
    expect(ok, isFalse);
    expect(await pending(), ['b:archive']);
  });

  test('forgetting a PC drops its waiting actions', () async {
    await keep('a', PendingThreadActionKind.archive);
    await repo.forgetDevice('pc-1');
    expect(await pending(), isEmpty);
  });
}
