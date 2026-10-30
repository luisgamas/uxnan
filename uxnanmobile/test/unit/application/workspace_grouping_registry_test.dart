import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';

/// A conversation belongs to a project when its `projectId` is in the PC's
/// registry (architecture/02a §5.8.17). Removing a project keeps its
/// conversations, but they must not keep heading a group of their own under
/// the old folder's name — that group read as the project still being there.
void main() {
  Thread thread(String id, {String? cwd, String? projectId}) => Thread(
        id: id,
        title: id,
        agentId: 'codex',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        cwd: cwd,
        projectId: projectId,
      );

  const app = Project(id: 'proj_app', name: 'App', cwd: '/dev/app');

  test("a removed project's conversations go to Other, never under its folder",
      () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('kept', cwd: '/dev/app', projectId: 'proj_app'),
        thread('orphan1', cwd: '/dev/gone', projectId: 'proj_gone'),
        thread('orphan2', cwd: '/dev/gone/sub', projectId: 'proj_gone'),
        thread('nofolder'),
      ],
      projects: const [app],
      registryLoaded: true,
    );

    expect(groups.map((g) => g.key), containsAll(['/dev/app', kOtherGroupKey]));
    expect(groups.any((g) => g.key.contains('gone')), isFalse);
    final other = groups.firstWhere((g) => g.isOther);
    expect(other.threads.map((t) => t.id), ['orphan1', 'orphan2']);
    expect(other.projectId, isNull);
    expect(other.path, isNull);
  });

  test('a worktree conversation of a registered project stays in its folder',
      () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('wt', cwd: '/dev/worktrees/app/feat', projectId: 'proj_app'),
      ],
      projects: const [app],
      registryLoaded: true,
    );
    expect(groups.map((g) => g.key), contains('/dev/worktrees/app/feat'));
    expect(groups.any((g) => g.isOther), isFalse);
  });

  test('before the registry has loaded nothing collapses into Other', () {
    final groups = groupThreadsByWorkspace(
      threads: [thread('t', cwd: '/dev/gone', projectId: 'proj_gone')],
      projects: const [],
    );
    expect(groups.single.key, '/dev/gone');
    expect(groups.single.isOther, isFalse);
  });
}
