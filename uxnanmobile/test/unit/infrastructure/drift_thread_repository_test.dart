import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Thread _thread(String id, {String? projectId, int? lastActivityMs}) => Thread(
      id: id,
      title: 'Thread $id',
      agentId: 'codex',
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      projectId: projectId,
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
