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

/// Inserts one row in each thread-owned child table for [threadId] (a message,
/// a turn, the composer draft and a git-action-log entry) so cascade deletes
/// can be asserted.
Future<void> _insertChildren(UxnanDatabase db, String threadId) async {
  await db.into(db.messagesTable).insert(
        MessagesTableCompanion.insert(
          id: 'm-$threadId',
          threadId: threadId,
          turnId: 'tn-$threadId',
          role: 'user',
          contentsJson: '[]',
          deliveryState: 'sent',
          orderIndex: 0,
          createdAtMs: 0,
        ),
      );
  await db.into(db.turnsTable).insert(
        TurnsTableCompanion.insert(
          id: 'tn-$threadId',
          threadId: threadId,
          status: 'completed',
          startedAtMs: 0,
        ),
      );
  await db.into(db.composerDraftsTable).insert(
        ComposerDraftsTableCompanion.insert(
          threadId: threadId,
          draft: 'wip',
          updatedAtMs: 0,
        ),
      );
  await db.into(db.gitActionLogTable).insert(
        GitActionLogTableCompanion.insert(
          id: 'g-$threadId',
          threadId: threadId,
          kind: 'commit',
          status: 'completed',
          paramsJson: '{}',
          startedAtMs: 0,
        ),
      );
}

/// Total number of child rows still keyed to [threadId] across all four
/// dependent tables.
Future<int> _childCount(UxnanDatabase db, String threadId) async {
  final messages = await (db.select(db.messagesTable)
        ..where((m) => m.threadId.equals(threadId)))
      .get();
  final turns = await (db.select(db.turnsTable)
        ..where((t) => t.threadId.equals(threadId)))
      .get();
  final drafts = await (db.select(db.composerDraftsTable)
        ..where((d) => d.threadId.equals(threadId)))
      .get();
  final gitLog = await (db.select(db.gitActionLogTable)
        ..where((g) => g.threadId.equals(threadId)))
      .get();
  return messages.length + turns.length + drafts.length + gitLog.length;
}

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

    test('deleteThread cascades to every dependent table', () async {
      await repo.saveThread(_thread('t1', lastActivityMs: 1));
      await _insertChildren(db, 't1');
      expect(await _childCount(db, 't1'), 4);

      await repo.deleteThread('t1');

      expect(await repo.getThread('t1'), isNull);
      expect(await _childCount(db, 't1'), 0);
    });

    test('deleteThread leaves other threads and their rows intact', () async {
      await repo.saveThread(_thread('t1', lastActivityMs: 1));
      await repo.saveThread(_thread('t2', lastActivityMs: 2));
      await _insertChildren(db, 't1');
      await _insertChildren(db, 't2');

      await repo.deleteThread('t1');

      expect(await repo.getThread('t2'), isNotNull);
      expect(await _childCount(db, 't1'), 0);
      expect(await _childCount(db, 't2'), 4);
    });

    test('deleteThreadsByDeviceId wipes a device threads + all child rows',
        () async {
      await repo.saveThread(_thread('a', deviceId: 'mac-1', lastActivityMs: 1));
      await repo.saveThread(_thread('b', deviceId: 'mac-1', lastActivityMs: 2));
      await repo.saveThread(_thread('c', deviceId: 'mac-2', lastActivityMs: 3));
      // Child rows under a mac-1 thread (a) and a mac-2 thread (c).
      await _insertChildren(db, 'a');
      await _insertChildren(db, 'c');

      await repo.deleteThreadsByDeviceId('mac-1');

      // Only mac-2's thread and its dependent rows survive.
      expect((await repo.getThreads()).map((t) => t.id).toList(), ['c']);
      expect(await _childCount(db, 'a'), 0);
      expect(await _childCount(db, 'c'), 4);
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
