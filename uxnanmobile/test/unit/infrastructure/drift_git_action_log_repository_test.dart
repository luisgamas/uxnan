import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/infrastructure/repositories/drift_git_action_log_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

GitActionLogEntry _entry(
  String id, {
  required GitActionKind kind,
  required bool succeeded,
  String threadId = 'th1',
  int startedAtMs = 1000,
}) =>
    GitActionLogEntry(
      id: id,
      threadId: threadId,
      kind: kind,
      succeeded: succeeded,
      paramsJson: '{"cwd":"/repo"}',
      resultJson: succeeded ? '{"sha":"abc"}' : null,
      errorMessage: succeeded ? null : 'boom',
      startedAt: DateTime.fromMillisecondsSinceEpoch(startedAtMs),
      completedAt: DateTime.fromMillisecondsSinceEpoch(startedAtMs + 50),
    );

void main() {
  late UxnanDatabase db;
  late DriftGitActionLogRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftGitActionLogRepository(db);
  });

  tearDown(() => db.close());

  test('records and reads back an entry, preserving fields', () async {
    await repo.record(
      _entry('a', kind: GitActionKind.commit, succeeded: true),
    );

    final entries = await repo.getForThread('th1');
    expect(entries, hasLength(1));
    expect(entries.single.kind, GitActionKind.commit);
    expect(entries.single.succeeded, isTrue);
    expect(entries.single.resultJson, '{"sha":"abc"}');
  });

  test('getForThread returns entries most recent first', () async {
    await repo.record(
      _entry('old', kind: GitActionKind.commit, succeeded: true),
    );
    await repo.record(
      _entry(
        'new',
        kind: GitActionKind.push,
        succeeded: true,
        startedAtMs: 2000,
      ),
    );

    final entries = await repo.getForThread('th1');
    expect(entries.map((e) => e.id).toList(), ['new', 'old']);
  });

  test('scopes entries by thread', () async {
    await repo.record(
      _entry('a', kind: GitActionKind.commit, succeeded: true),
    );
    await repo.record(
      _entry('b', kind: GitActionKind.push, succeeded: false, threadId: 'th2'),
    );

    expect(await repo.getForThread('th1'), hasLength(1));
    final other = await repo.getForThread('th2');
    expect(other.single.succeeded, isFalse);
    expect(other.single.errorMessage, 'boom');
  });

  test('watchForThread emits on change', () async {
    final emissions = <int>[];
    final sub = repo
        .watchForThread('th1')
        .listen((entries) => emissions.add(entries.length));
    await Future<void>.delayed(const Duration(milliseconds: 20));

    await repo.record(
      _entry('a', kind: GitActionKind.commit, succeeded: true),
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));

    await sub.cancel();
    expect(emissions, contains(1));
  });
}
