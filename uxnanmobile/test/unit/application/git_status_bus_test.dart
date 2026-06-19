import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 10));

void main() {
  test('emit broadcasts to every current listener', () async {
    final bus = GitStatusBus();
    final received = <GitStatusChange>[];
    final subA = bus.changes.listen(received.add);
    final subB = bus.changes.listen((_) {});

    bus.emit(GitStatusChange(
      cwd: '/repo',
      state: const GitRepoState(branch: 'main'),
    ));
    await _settle();

    expect(received, hasLength(1));
    expect(received.single.cwd, '/repo');
    expect(received.single.state.branch, 'main');

    await subA.cancel();
    await subB.cancel();
    await bus.dispose();
  });

  test('late subscribers do not receive a replay', () async {
    final bus = GitStatusBus();
    bus.emit(GitStatusChange(
      cwd: '/repo',
      state: const GitRepoState(branch: 'main'),
    ));
    await _settle();

    final received = <GitStatusChange>[];
    final sub = bus.changes.listen(received.add);
    await _settle();

    expect(received, isEmpty);
    await sub.cancel();
    await bus.dispose();
  });

  test('emit is a no-op after dispose', () async {
    final bus = GitStatusBus();
    await bus.dispose();
    expect(
      () => bus.emit(GitStatusChange(
        cwd: '/repo',
        state: const GitRepoState(branch: 'main'),
      )),
      returnsNormally,
    );
  });

  test('payload preserves the full GitRepoState', () async {
    final bus = GitStatusBus();
    final state = const GitRepoState(
      branch: 'feat/x',
      upstream: 'origin/feat/x',
      isDirty: true,
      ahead: 2,
      behind: 1,
    );
    GitStatusChange? captured;
    final sub = bus.changes.listen((c) => captured = c);

    bus.emit(GitStatusChange(cwd: '/repo', state: state));
    await _settle();

    expect(captured, isNotNull);
    expect(captured!.state, equals(state));
    expect(captured!.state.ahead, 2);
    expect(captured!.state.behind, 1);

    await sub.cancel();
    await bus.dispose();
  });

  test('multiple emits are delivered in order to the same listener', () async {
    final bus = GitStatusBus();
    final received = <GitStatusChange>[];
    final sub = bus.changes.listen(received.add);

    for (var i = 0; i < 3; i++) {
      bus.emit(GitStatusChange(
        cwd: '/repo',
        state: GitRepoState(
          branch: 'main',
          changedFiles: [
            if (i > 0)
              const GitChangedFile(
                path: 'a.dart',
                status: GitFileStatus.modified,
              ),
          ],
        ),
      ));
    }
    await _settle();

    expect(received, hasLength(3));
    expect(received[1].state.changedFiles, hasLength(1));
    expect(received[2].state.changedFiles, hasLength(1));

    await sub.cancel();
    await bus.dispose();
  });
}
