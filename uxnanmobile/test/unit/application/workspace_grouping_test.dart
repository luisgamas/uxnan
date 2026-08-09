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

  test('a thread lands under the root its folder sits in', () {
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/app/lib')],
      projects: [project('app', '/dev/app')],
    );

    expect(groups, hasLength(1));
    expect(groups.single.id, 'app');
    expect(groups.single.workspaces.single.label, 'lib');
    expect(groups.single.threads.map((t) => t.id), ['t1']);
  });

  test('a root itself is a workspace, not just its children', () {
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/app')],
      projects: [project('app', '/dev/app')],
    );

    expect(groups.single.workspaces.single.label, 'app');
  });

  test('nested roots resolve to the closest one, not the first listed', () {
    // A bridge can be configured with both a parent and a child folder. The
    // deeper one is the answer; matching the first would file the thread under
    // a project that merely contains it.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/mono/packages/api/src')],
      projects: [
        project('mono', '/dev/mono'),
        project('api', '/dev/mono/packages/api'),
      ],
    );

    expect(groups.single.id, 'api');
  });

  test('Windows separators and casing are the same folder', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: r'C:\Dev\App\lib'),
        thread('t2', cwd: 'c:/dev/app/lib/'),
      ],
      projects: [project('app', r'C:\Dev\App')],
    );

    expect(
      groups.single.workspaces,
      hasLength(1),
      reason: 'two spellings of one path must not become two rows',
    );
    expect(groups.single.workspaces.single.threads, hasLength(2));
  });

  test('a sibling worktree falls to "other" — the known gap', () {
    // `…/app` and `…/app--branch` are siblings, so the worktree matches no
    // root. Documented rather than papered over: closing it needs the bridge to
    // report worktrees (`git/worktrees`).
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('main', cwd: '/dev/app'),
        thread('wt', cwd: '/dev/app--feature'),
      ],
      projects: [project('app', '/dev/app')],
    );

    expect(groups.map((g) => g.id), ['app', kOtherProjectId]);
    expect(groups.last.threads.map((t) => t.id), ['wt']);
  });

  test('a prefix that is not a path boundary does not match', () {
    // `/dev/apples` starts with `/dev/app` as a STRING but is a different
    // folder; only a `/` boundary counts.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/apples')],
      projects: [project('app', '/dev/app')],
    );

    expect(groups.single.id, kOtherProjectId);
  });

  test('a thread with no folder still has a home', () {
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1')],
      projects: [project('app', '/dev/app')],
    );

    expect(groups.single.id, kOtherProjectId);
    expect(groups.single.threads.map((t) => t.id), ['t1']);
  });

  test('a project with no conversations is not drawn at all', () {
    // The screen lists work, not the bridge's configuration.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/app')],
      projects: [project('app', '/dev/app'), project('idle', '/dev/idle')],
    );

    expect(groups.map((g) => g.id), ['app']);
  });

  test('projects keep the bridge order; "other" always comes last', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('loose', cwd: '/elsewhere'),
        thread('b', cwd: '/dev/b'),
        thread('a', cwd: '/dev/a'),
      ],
      projects: [project('a', '/dev/a'), project('b', '/dev/b')],
    );

    expect(groups.map((g) => g.id), ['a', 'b', kOtherProjectId]);
  });

  test("thread order inside a workspace is the caller's", () {
    // The screen sorts before grouping; grouping must not undo it.
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('third', cwd: '/dev/app'),
        thread('first', cwd: '/dev/app'),
      ],
      projects: [project('app', '/dev/app')],
    );

    expect(
      groups.single.workspaces.single.threads.map((t) => t.id),
      ['third', 'first'],
    );
  });

  test('a thread whose project the bridge no longer lists is still shown', () {
    // Losing a root from the config must not make conversations disappear.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/gone/away')],
      projects: const [],
    );

    expect(groups.single.threads.map((t) => t.id), ['t1']);
  });
}
