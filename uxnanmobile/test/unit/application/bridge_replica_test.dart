import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/bridge_replica.dart';
import 'package:uxnan/application/managers/thread_action_outbox.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/client_kind.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/pending_thread_action.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_bridge_replica_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

Map<String, dynamic> _thread(String id, {int? rev, String title = 'T'}) => {
      'id': id,
      'title': title,
      'agentId': 'codex',
      'status': 'active',
      if (rev != null) 'rev': rev,
    };

Map<String, dynamic> _changes({
  int rev = 10,
  bool reset = true,
  String storeId = 's1',
  List<Map<String, dynamic>> threads = const [],
  List<String> removedThreadIds = const [],
  List<Map<String, dynamic>> projects = const [],
  List<String> removedProjectIds = const [],
  String home = '/Users/me',
  List<Map<String, dynamic>> clients = const [],
}) =>
    {
      'storeId': storeId,
      'rev': rev,
      'reset': reset,
      'settings': {'home': home},
      'threads': threads,
      'removedThreadIds': removedThreadIds,
      'projects': projects,
      'removedProjectIds': removedProjectIds,
      'clients': clients,
    };

void main() {
  late UxnanDatabase db;
  late DriftThreadRepository threadRepo;
  late DriftBridgeReplicaRepository replicaRepo;
  late StreamController<DomainEvent> events;
  late StreamController<ConnectionPhase> phases;
  late ThreadManager threads;
  late BridgeReplica replica;
  late List<(String, Map<String, dynamic>?)> calls;
  late List<Map<String, dynamic>> answers;
  late String? deviceId;
  late ThreadActionOutbox outbox;
  // When set, a request for this method is lost on the way.
  String? lose;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    threadRepo = DriftThreadRepository(db);
    replicaRepo = DriftBridgeReplicaRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    phases = StreamController<ConnectionPhase>.broadcast();
    calls = [];
    answers = [];
    deviceId = 'pc-1';
    lose = null;
    outbox = ThreadActionOutbox(repository: replicaRepo);
    Future<RpcMessage> send(String method, [Map<String, dynamic>? params]) {
      calls.add((method, params));
      if (method == lose) return Future.error(TimeoutException('lost'));
      final Object result = switch (method) {
        'sync/changes' => answers.isEmpty ? _changes() : answers.removeAt(0),
        'project/add' => {
            'id': 'proj_new',
            'name': 'new',
            'cwd': params?['cwd'],
          },
        'settings/set' => {'home': params?['home']},
        _ => <String, dynamic>{},
      };
      return Future.value(RpcMessage.response(id: '1', result: result));
    }

    threads = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      sendRequest: send,
      currentDeviceId: () => deviceId,
    );
    replica = BridgeReplica(
      repository: replicaRepo,
      threadManager: threads,
      sendRequest: send,
      domainEvents: events.stream,
      currentDeviceId: () => deviceId,
      connectionPhases: phases.stream,
      outbox: outbox,
    );
  });

  tearDown(() async {
    await replica.dispose();
    await threads.dispose();
    await events.close();
    await phases.close();
    await db.close();
  });

  List<Map<String, dynamic>?> syncParams() => [
        for (final (method, params) in calls)
          if (method == 'sync/changes') params,
      ];

  test('a first sync takes the snapshot, then asks only for what came after',
      () async {
    answers.add(
      _changes(
        threads: [_thread('a')],
        projects: [
          {'id': 'proj_a', 'name': 'app', 'cwd': '/w/app'},
        ],
      ),
    );
    await replica.sync();
    expect(syncParams().single, isEmpty);
    expect((await threadRepo.getThread('a'))?.deviceId, 'pc-1');
    expect(
      (await replica.projectsOf('pc-1').first).map((p) => p.name),
      ['app'],
    );
    expect(await replica.homeStream.first, '/Users/me');
    expect((await replicaRepo.cursor('pc-1'))?.rev, 10);

    answers.add(
      _changes(
        rev: 12,
        reset: false,
        threads: [_thread('b')],
        removedThreadIds: ['a'],
        removedProjectIds: ['proj_a'],
      ),
    );
    await replica.sync();
    expect(syncParams().last, {'since': 10, 'storeId': 's1'});
    expect(await threadRepo.getThread('a'), isNull);
    expect(await threadRepo.getThread('b'), isNotNull);
    expect(await replica.projectsOf('pc-1').first, isEmpty);
  });

  test('a snapshot replaces the projects of that PC', () async {
    answers
      ..add(
        _changes(
          projects: [
            {'id': 'proj_a', 'name': 'a', 'cwd': '/a'},
            {'id': 'proj_b', 'name': 'b', 'cwd': '/b'},
          ],
        ),
      )
      ..add(
        _changes(
          rev: 20,
          storeId: 's2',
          projects: [
            {'id': 'proj_c', 'name': 'c', 'cwd': '/c'},
          ],
        ),
      );
    await replica.sync();
    await replica.sync();
    expect(
      (await replica.projectsOf('pc-1').first).map((p) => p.id),
      ['proj_c'],
    );
  });

  test('connecting syncs; disconnecting clears who is there', () async {
    answers.add(
      _changes(
        clients: [
          {'id': 'local:desktop', 'kind': 'desktop', 'name': 'studio'},
        ],
      ),
    );
    phases.add(ConnectionPhase.connected);
    await _settle();
    expect(syncParams(), hasLength(1));
    expect(replica.desktopLinked, isTrue);
    expect(
      (await replica.presenceStream.first).single.kind,
      ClientKind.desktop,
    );

    phases.add(ConnectionPhase.disconnected);
    await _settle();
    expect(replica.desktopLinked, isFalse);
  });

  group('notifications', () {
    setUp(() async {
      answers.add(_changes(rev: 5, threads: [_thread('x', title: 'x')]));
      await replica.sync();
      calls.clear();
    });

    test('the next revision is applied without a sync', () async {
      events.add(
        ThreadUpdatedEvent(thread: _thread('x', rev: 6, title: 'renamed')),
      );
      await _settle();
      expect((await threadRepo.getThread('x'))?.title, 'renamed');
      expect(syncParams(), isEmpty);
      expect((await replicaRepo.cursor('pc-1'))?.rev, 6);
    });

    test('a stale revision is dropped', () async {
      events.add(
        ThreadUpdatedEvent(thread: _thread('x', rev: 4, title: 'old')),
      );
      await _settle();
      expect((await threadRepo.getThread('x'))?.title, 'x');
    });

    test('a skipped revision applies the change and catches up', () async {
      answers.add(_changes(rev: 9, reset: false, threads: [_thread('y')]));
      events.add(ThreadUpdatedEvent(thread: _thread('z', rev: 9)));
      await _settle();
      expect(await threadRepo.getThread('z'), isNotNull);
      expect(await threadRepo.getThread('y'), isNotNull);
      expect(syncParams().first, {'since': 5, 'storeId': 's1'});
    });

    test('deletions, projects, settings, presence and agents', () async {
      final agents = <void>[];
      final sub = replica.agentsChanged.listen(agents.add);
      events
        ..add(const ThreadDeletedEvent(threadId: 'x', rev: 6))
        ..add(
          const ProjectUpdatedEvent(
            project: {'id': 'proj_a', 'name': 'app', 'cwd': '/a', 'rev': 7},
          ),
        )
        ..add(const SettingsUpdatedEvent(home: '/work', rev: 8))
        ..add(
          const PresenceUpdatedEvent(
            clients: [
              {'id': 'dev1', 'kind': 'phone', 'name': 'Pixel', 'since': 1},
            ],
          ),
        )
        ..add(const AgentsUpdatedEvent());
      await _settle();
      expect(await threadRepo.getThread('x'), isNull);
      expect(
        (await replica.projectsOf('pc-1').first).map((p) => p.id),
        ['proj_a'],
      );
      expect(await replica.homeStream.first, '/work');
      expect((await replicaRepo.cursor('pc-1'))?.home, '/work');
      expect(replica.desktopLinked, isFalse);
      expect(agents, hasLength(1));
      events.add(const ProjectRemovedEvent(projectId: 'proj_a', rev: 9));
      await _settle();
      expect(await replica.projectsOf('pc-1').first, isEmpty);
      await sub.cancel();
    });
  });

  test('adding a project registers it on the PC and keeps it here', () async {
    final project = await replica.addProject('/Users/me/app');
    expect(calls.single.$1, 'project/add');
    expect(calls.single.$2, {'cwd': '/Users/me/app'});
    expect(project?.id, 'proj_new');
    expect(
      (await replica.projectsOf('pc-1').first).map((p) => p.cwd),
      ['/Users/me/app'],
    );
  });

  test('changing the start folder goes to the PC and is shown', () async {
    await replica.setHome('/work');
    expect(calls.single.$1, 'settings/set');
    expect(calls.single.$2, {'home': '/work'});
    expect(await replica.homeStream.first, '/work');
  });

  test('forgetting a PC drops what was kept for it', () async {
    answers.add(
      _changes(
        projects: [
          {'id': 'proj_a', 'name': 'a', 'cwd': '/a'},
        ],
      ),
    );
    await replica.sync();
    await replica.forgetDevice('pc-1');
    expect(await replicaRepo.cursor('pc-1'), isNull);
    expect(await replica.projectsOf('pc-1').first, isEmpty);
  });

  test('what was done offline reaches the bridge before its state is read',
      () async {
    await outbox.keep(
      deviceId: 'pc-1',
      threadId: 'x',
      kind: PendingThreadActionKind.archive,
    );
    await replica.sync();
    expect(calls.map((c) => c.$1), ['thread/archive', 'sync/changes']);
    expect(calls.first.$2?['ageMs'], isA<int>());
    expect(await replicaRepo.pendingThreadActions('pc-1'), isEmpty);
  });

  test('if the PC is lost again, nothing is read over what it did not hear',
      () async {
    await outbox.keep(
      deviceId: 'pc-1',
      threadId: 'x',
      kind: PendingThreadActionKind.delete,
    );
    lose = 'thread/delete';
    await replica.sync();
    expect(syncParams(), isEmpty);
    expect(await replicaRepo.pendingThreadActions('pc-1'), hasLength(1));
  });

  test('without a connected PC nothing is asked', () async {
    deviceId = null;
    await replica.sync();
    expect(calls, isEmpty);
  });
}
