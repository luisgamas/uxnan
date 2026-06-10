import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Thread _thread(
  String id, {
  String? projectId,
  String? deviceId,
  int? lastActivityMs,
}) =>
    Thread(
      id: id,
      title: 'Thread $id',
      agentId: 'codex',
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      projectId: projectId,
      deviceId: deviceId,
      lastActivity: lastActivityMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(lastActivityMs),
    );

void main() {
  late UxnanDatabase db;
  late DriftThreadRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftThreadRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('DriftThreadRepository', () {
    test('saves and reads back a thread', () async {
      await repo.saveThread(_thread('t1', lastActivityMs: 1000));

      final loaded = await repo.getThread('t1');
      expect(loaded, isNotNull);
      expect(loaded!.title, 'Thread t1');
      expect(loaded.agentId, 'codex');
      expect(loaded.syncState, ThreadSyncState.synced);
      expect(loaded.status, ThreadStatus.active);
    });

    test('getThread returns null for unknown id', () async {
      expect(await repo.getThread('missing'), isNull);
    });

    test('round-trips the model column', () async {
      await repo.saveThread(
        _thread('t1', lastActivityMs: 1).copyWith(model: 'gpt-5'),
      );
      final loaded = await repo.getThread('t1');
      expect(loaded!.model, 'gpt-5');
    });

    test('getThreads orders by last activity descending', () async {
      await repo.saveThread(_thread('old', lastActivityMs: 1000));
      await repo.saveThread(_thread('new', lastActivityMs: 2000));

      final threads = await repo.getThreads();
      expect(threads.map((t) => t.id).toList(), ['new', 'old']);
    });

    test('getThreads filters by projectId', () async {
      await repo.saveThread(_thread('a', projectId: 'p1', lastActivityMs: 1));
      await repo.saveThread(_thread('b', projectId: 'p2', lastActivityMs: 2));

      final threads = await repo.getThreads(projectId: 'p1');
      expect(threads.map((t) => t.id).toList(), ['a']);
    });

    test('saveThread upserts on conflicting id', () async {
      await repo.saveThread(_thread('t1', lastActivityMs: 1));
      await repo.saveThread(
        _thread('t1', lastActivityMs: 1).copyWith(title: 'Renamed'),
      );

      final loaded = await repo.getThread('t1');
      expect(loaded!.title, 'Renamed');
      final all = await repo.getThreads();
      expect(all.length, 1);
    });

    test('deleteThread removes the row', () async {
      await repo.saveThread(_thread('t1', lastActivityMs: 1));
      await repo.deleteThread('t1');
      expect(await repo.getThread('t1'), isNull);
    });

    test('deleteThreadsByDeviceId wipes a device threads + messages + turns',
        () async {
      await repo.saveThread(_thread('a', deviceId: 'mac-1', lastActivityMs: 1));
      await repo.saveThread(_thread('b', deviceId: 'mac-1', lastActivityMs: 2));
      await repo.saveThread(_thread('c', deviceId: 'mac-2', lastActivityMs: 3));
      // A message + turn under a mac-1 thread (a) and a mac-2 thread (c).
      await db.into(db.messagesTable).insert(
            MessagesTableCompanion.insert(
              id: 'm-a',
              threadId: 'a',
              turnId: 'tn-a',
              role: 'user',
              contentsJson: '[]',
              deliveryState: 'sent',
              orderIndex: 0,
              createdAtMs: 0,
            ),
          );
      await db.into(db.messagesTable).insert(
            MessagesTableCompanion.insert(
              id: 'm-c',
              threadId: 'c',
              turnId: 'tn-c',
              role: 'user',
              contentsJson: '[]',
              deliveryState: 'sent',
              orderIndex: 0,
              createdAtMs: 0,
            ),
          );
      await db.into(db.turnsTable).insert(
            TurnsTableCompanion.insert(
              id: 'tn-a',
              threadId: 'a',
              status: 'completed',
              startedAtMs: 0,
            ),
          );
      await db.into(db.turnsTable).insert(
            TurnsTableCompanion.insert(
              id: 'tn-c',
              threadId: 'c',
              status: 'completed',
              startedAtMs: 0,
            ),
          );

      await repo.deleteThreadsByDeviceId('mac-1');

      // Only mac-2's thread and its dependent rows survive.
      expect((await repo.getThreads()).map((t) => t.id).toList(), ['c']);
      final msgIds =
          (await db.select(db.messagesTable).get()).map((m) => m.id).toList();
      expect(msgIds, ['m-c']);
      final turnIds =
          (await db.select(db.turnsTable).get()).map((t) => t.id).toList();
      expect(turnIds, ['tn-c']);
    });

    test('deleteThreadsByDeviceId is a no-op when no thread matches', () async {
      await repo.saveThread(_thread('a', deviceId: 'mac-1', lastActivityMs: 1));
      await repo.deleteThreadsByDeviceId('mac-unknown');
      expect((await repo.getThreads()).length, 1);
    });

    test('watchThreads emits on changes', () async {
      final emissions = <int>[];
      final sub = repo.watchThreads().listen((ts) => emissions.add(ts.length));

      await repo.saveThread(_thread('t1', lastActivityMs: 1));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await repo.saveThread(_thread('t2', lastActivityMs: 2));
      await Future<void>.delayed(const Duration(milliseconds: 50));

      await sub.cancel();
      expect(emissions.last, 2);
    });
  });
}
