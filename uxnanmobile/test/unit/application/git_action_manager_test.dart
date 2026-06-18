import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_git_action_log_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

const _statusResult = <String, dynamic>{
  'branch': 'main',
  'upstream': 'origin/main',
  'isDirty': true,
  'ahead': 2,
  'behind': 0,
  'diffTotals': {
    'additions': 10,
    'deletions': 3,
    'binaryFiles': 0,
    'changedFileCount': 1,
  },
  'changedFiles': [
    {
      'path': 'lib/main.dart',
      'status': 'modified',
      'additions': 10,
      'deletions': 3,
    },
  ],
};

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 60));

void main() {
  late UxnanDatabase db;
  late DriftGitActionLogRepository logRepo;
  late StreamController<DomainEvent> events;
  late List<String> sentMethods;
  late Completer<RpcMessage> pushCompleter;
  late GitStatusBus bus;
  late List<GitStatusChange> busEvents;
  late StreamSubscription<GitStatusChange> busSub;
  late GitActionManager manager;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    logRepo = DriftGitActionLogRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    sentMethods = [];
    pushCompleter = Completer<RpcMessage>();
    bus = GitStatusBus();
    busEvents = <GitStatusChange>[];
    busSub = bus.changes.listen(busEvents.add);
    manager = GitActionManager(
      domainEvents: events.stream,
      actionLog: logRepo,
      statusBus: bus,
      sendRequest: (method, [params]) {
        sentMethods.add(method);
        return switch (method) {
          'git/status' =>
            Future.value(RpcMessage.response(id: '1', result: _statusResult)),
          'git/commit' => Future.value(
              RpcMessage.response(
                id: '1',
                result: const {'sha': 'abc123', 'message': 'feat: x'},
              ),
            ),
          'git/push' => pushCompleter.future,
          _ => Future.value(
              RpcMessage.response(id: '1', result: const <String, dynamic>{}),
            ),
        };
      },
    );
  });

  tearDown(() async {
    await busSub.cancel();
    await manager.dispose();
    await bus.dispose();
    await events.close();
    await db.close();
  });

  test('refreshStatus parses and publishes the repo state', () async {
    final state = await manager.refreshStatus('/repo');

    expect(state, isNotNull);
    expect(state!.branch, 'main');
    expect(state.upstream, 'origin/main');
    expect(state.isDirty, isTrue);
    expect(state.ahead, 2);
    expect(state.diffTotals.changedFileCount, 1);
    expect(state.changedFiles.single.path, 'lib/main.dart');
    expect(state.changedFiles.single.status, GitFileStatus.modified);
    expect(manager.repoState, equals(state));
  });

  test('commit sends git/commit, records the log and refreshes status',
      () async {
    final result = await manager.commit(
      const GitCommitParams(
        cwd: '/repo',
        message: 'feat: x',
        threadId: 'th1',
      ),
    );

    expect(result?.sha, 'abc123');
    expect(sentMethods, containsAllInOrder(['git/commit', 'git/status']));
    expect(manager.activeAction, isNull);

    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.commit);
    expect(log.single.succeeded, isTrue);
  });

  test('push accumulates phase progress then clears on completion', () async {
    final future = manager.push(
      const GitPushParams(cwd: '/repo', branch: 'main', threadId: 'th1'),
    );
    await _settle();

    expect(manager.activeAction?.kind, GitActionKind.push);

    events
      ..add(
        const GitProgressEvent(
          phase: 'resolving',
          status: GitActionPhaseStatus.running,
        ),
      )
      ..add(
        const GitProgressEvent(
          phase: 'uploading',
          status: GitActionPhaseStatus.running,
        ),
      );
    await _settle();

    final progress = manager.activeAction;
    expect(progress!.phases.map((p) => p.name).toList(), [
      'resolving',
      'uploading',
    ]);
    // Starting a later phase marks the earlier running phase complete.
    expect(progress.phases.first.status, GitActionPhaseStatus.completed);
    expect(progress.currentPhase?.name, 'uploading');

    pushCompleter.complete(
      RpcMessage.response(
        id: '1',
        result: const {'branch': 'main', 'remote': 'origin'},
      ),
    );
    final result = await future;
    await _settle();

    expect(result?.branch, 'main');
    expect(manager.activeAction, isNull);
    expect(sentMethods, contains('git/status'));

    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.push);
    expect(log.single.succeeded, isTrue);
  });

  test('push surfaces an error and records a failed log entry', () async {
    final future = manager.push(
      const GitPushParams(cwd: '/repo', branch: 'main', threadId: 'th1'),
    );
    await _settle();

    pushCompleter.completeError(Exception('network down'));

    await expectLater(future, throwsA(isA<Exception>()));
    expect(manager.activeAction?.hasError, isTrue);

    final log = await logRepo.getForThread('th1');
    expect(log.single.succeeded, isFalse);
    expect(log.single.errorMessage, contains('network down'));
  });

  test('pull sends git/pull and refreshes status', () async {
    final result = await manager.pull(
      const GitPullParams(cwd: '/repo', threadId: 'th1'),
    );

    expect(result, isNotNull);
    expect(sentMethods, containsAllInOrder(['git/pull', 'git/status']));
    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.pull);
  });

  test('checkout sends git/checkout and refreshes status', () async {
    await manager.checkout(
      const GitCheckoutParams(cwd: '/repo', branch: 'dev', threadId: 'th1'),
    );

    expect(sentMethods, containsAllInOrder(['git/checkout', 'git/status']));
    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.checkout);
  });

  test('createBranch sends git/createBranch and refreshes status', () async {
    await manager.createBranch(
      const GitBranchParams(cwd: '/repo', name: 'feat/x', threadId: 'th1'),
    );

    expect(sentMethods, containsAllInOrder(['git/createBranch', 'git/status']));
    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.createBranch);
  });

  test('createWorktree sends git/createWorktree and refreshes status',
      () async {
    await manager.createWorktree(
      const GitWorktreeParams(
        cwd: '/repo',
        branch: 'feat/x',
        path: '/repo-feat-x',
        threadId: 'th1',
      ),
    );

    expect(
      sentMethods,
      containsAllInOrder(['git/createWorktree', 'git/status']),
    );
    final log = await logRepo.getForThread('th1');
    expect(log.single.kind, GitActionKind.createWorktree);
  });

  test('refreshStatus emits a GitStatusChange on the bus', () async {
    await manager.refreshStatus('/repo');
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(busEvents, hasLength(1));
    expect(busEvents.single.cwd, '/repo');
    expect(busEvents.single.state.branch, 'main');
    expect(busEvents.single.state.isDirty, isTrue);
    expect(
      busEvents.single.state.changedFiles.single.path,
      'lib/main.dart',
    );
    expect(
      busEvents.single.state.changedFiles.single.status,
      GitFileStatus.modified,
    );
  });

  test('commit refreshes status which propagates through the bus', () async {
    await manager.commit(
      const GitCommitParams(
        cwd: '/repo',
        message: 'feat: x',
        threadId: 'th1',
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(busEvents, hasLength(1));
    expect(busEvents.single.cwd, '/repo');
  });
}
