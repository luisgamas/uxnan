import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';

/// The whole project → workspace hierarchy is inferred from paths, so these
/// cases are the awkward real ones: Windows separators, casing, nested roots,
/// and the worktree layout that deliberately does NOT resolve yet.
void main() {
  Thread thread(String id, {String? cwd}) => Thread(
        id: id,
        title: id,
        agentId: 'claude-code',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        cwd: cwd,
      );

  Project project(String id, String cwd) => Project(id: id, name: id, cwd: cwd);

  test('conversations in one folder become one group', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: '/dev/app'),
        thread('t2', cwd: '/dev/app'),
      ],
      projects: const [],
    );

    expect(groups, hasLength(1));
    expect(groups.single.label, 'app');
    expect(groups.single.threads.map((t) => t.id), ['t1', 't2']);
  });

  test('a folder that is a configured root takes the project name', () {
    // Friendlier than the basename, which is often a build-tool artefact.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/checkouts/app-main')],
      projects: [project('uxnan', '/dev/checkouts/app-main')],
    );

    expect(groups.single.label, 'uxnan');
  });

  test('Windows separators and casing are the same folder', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: r'C:\Dev\App'),
        thread('t2', cwd: 'c:/dev/app/'),
      ],
      projects: const [],
    );

    expect(
      groups,
      hasLength(1),
      reason: 'two spellings of one path must not become two rows',
    );
    expect(groups.single.threads, hasLength(2));
  });

  test('the displayed path is the one that was reported, not the folded key',
      () {
    // The key is lower-cased for matching; a user must never read that.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: r'C:\Dev\App')],
      projects: const [],
    );

    expect(groups.single.path, r'C:\Dev\App');
    expect(groups.single.key, isNot(contains('D')));
  });

  test('a sibling worktree is simply its own folder', () {
    // No project level to fall out of: `…/app` and `…/app--feature` are two
    // folders, which is exactly what the phone can honestly say about them.
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('main', cwd: '/dev/app'),
        thread('wt', cwd: '/dev/app--feature'),
      ],
      projects: [project('app', '/dev/app')],
    );

    expect(groups.map((g) => g.label), ['app', 'app--feature']);
  });

  test('a thread with no folder groups on its own', () {
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1')],
      projects: const [],
    );

    expect(groups.single.key, isEmpty);
    expect(groups.single.threads.map((t) => t.id), ['t1']);
  });

  test('a configured root with no conversations is not drawn', () {
    // The screen lists work, not the bridge's configuration.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/app')],
      projects: [project('app', '/dev/app'), project('idle', '/dev/idle')],
    );

    expect(groups, hasLength(1));
  });

  test("thread order inside a folder is the caller's", () {
    // The screen sorts before grouping; grouping must not undo it.
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('third', cwd: '/dev/app'),
        thread('first', cwd: '/dev/app'),
      ],
      projects: const [],
    );

    expect(groups.single.threads.map((t) => t.id), ['third', 'first']);
  });
}
